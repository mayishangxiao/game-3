/**
 * 「像素中文字体」的**判定规则**（设计书 4.9.2 方案 ②：1px 描边 + 点阵化常规字体）。
 *
 * 这里只有纯函数，真正的绘制在 `gfx/PixelFont.ts`（要碰 Phaser），
 * 之所以拆开，是因为「哪些字该点阵化」这件事必须能用单元测试钉住——
 * 它同时受两条互相矛盾的约束：
 *
 *  - 设计书 4.9.2：「标题 16px 像素字、数值 10px 数字像素字」，要求像素感；
 *  - 甲方 m01507 / m14676：「游戏内所有文字像素感太强了，用清晰的标准字体」、
 *    「我只要清晰的文字」，要求**没有**像素感。
 *
 * 两者的分歧点其实是字号，不是「要不要像素」。14px 以下的中文点阵化之后
 * 只剩横竖两三条笔画，字会糊成一团（甲方投诉的就是这个）；而 14px 以上的短标题
 * 点阵化之后笔画数还够，且「块状」正是设计书想要的年代感。
 * 所以规则定为：**只给「大字号 + 短文本」点阵化，正文与小字一律保持清晰**。
 *
 * 于是设计书要求的那格与甲方的两次投诉可以同时成立——这是本轮做的一个明确取舍，
 * 不是折中：正文可读性优先，标题风格其次。
 */

/**
 * 点阵化最小字号。低于它的中文（正文 / HUD / 对白 / 卡片标题）保持系统黑体的清晰栅格。
 *
 * 取 16 是照设计书 4.9.2 的原话「标题 16 px 像素字」。试过放到 14px：
 * 升级三选一的卡名、图鉴页标题都是 14px，点阵化之后被 60px 宽的卡片挤成一团，
 * 反而比清晰字难认——那正是甲方 m01507 投诉的观感，所以门槛不再往下放。
 */
export const PIXEL_MIN_SIZE = 16;

/**
 * 点阵化最长文本（按 Unicode 码点计）。
 * 超过这个长度的基本是正文或弹窗说明，整段点阵化只会更难读。
 * 取 18 与设计书「对白每行 18 个汉字」对齐，一眼能判断。
 */
export const PIXEL_MAX_CHARS = 18;

/** 点阵字的描边宽度（逻辑像素）。1px × RENDER_SCALE 3 已经是 3 个屏幕像素，再宽会吃掉笔画。 */
export const PIXEL_STROKE = 1;

/**
 * 点阵字的文字画布分辨率：**故意取 1**。
 *
 * 全局 `textResolution()` 是 ≥4 的超采样（为了让小字清晰）。点阵化正好相反：
 * 画布就按 1 像素栅格生成，再由渲染器放大 RENDER_SCALE 倍——每一个栅格像素
 * 变成一整块，这才是「点阵字」。若也跟着超采样，放大后看到的仍是抗锯齿边缘。
 */
export const PIXEL_RESOLUTION = 1;

/** 描边色：与游戏底板同色系的最深色（`PALETTE.ink`），压在浅色字外面一圈提对比。 */
export const PIXEL_STROKE_COLOR = '#0D0B14';

/** 点阵字样式（与 Phaser 的 TextStyle 兼容，但不 import Phaser，便于 node 里断言）。 */
export interface PixelTextStyle {
  fontSize: string;
  resolution: number;
  stroke: string;
  strokeThickness: number;
  fontStyle?: string;
  color?: string;
}

/** 把 `'14px'` / `14` / `'1.5em'` 一律读成像素数；读不出来返回 0。 */
export function parseFontSize(size: number | string | undefined): number {
  if (typeof size === 'number') return Number.isFinite(size) ? size : 0;
  if (!size) return 0;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(size);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 这段字该不该点阵化。
 *
 * 三条都要满足：字号够大、文本非空、长度不超过 `PIXEL_MAX_CHARS`。
 * 长度按**码点**算（`[...text].length`），否则「𠀀」这类扩展区汉字会被算成两个字。
 */
export function shouldPixelate(size: number | string | undefined, text: string): boolean {
  const px = parseFontSize(size);
  if (!(px >= PIXEL_MIN_SIZE)) return false;
  const chars = [...text].length;
  return chars > 0 && chars <= PIXEL_MAX_CHARS;
}

/**
 * 点阵字的字号必须落在整数像素网格上：26.5px 的字画成 1 倍栅格时，
 * 每一行字的高度会在 26 与 27 之间跳，放大后看着就是「歪的」。
 * 同时夹到 `PIXEL_MIN_SIZE` 以上（调用点手滑写成 10px 也不会画出糊字）。
 */
export function snapFontSize(size: number | string | undefined): number {
  const px = parseFontSize(size);
  return Math.max(PIXEL_MIN_SIZE, Math.round(px));
}

/**
 * 组装点阵字样式。
 *
 * `resolution` 显式写 1 是**给 `gfx/TextResolution.ts` 的信号**：
 * 那个包装器看到 `style.resolution` 已被显式指定，就不再套超采样，
 * 转而把纹理标成最近邻（详见那里）。调用点因此只需写 `pixelTextStyle()`。
 */
export function pixelTextStyle(
  size: number | string | undefined,
  color?: string,
  opts: { fontStyle?: string; stroke?: string } = {},
): PixelTextStyle {
  const style: PixelTextStyle = {
    fontSize: `${snapFontSize(size)}px`,
    resolution: PIXEL_RESOLUTION,
    stroke: opts.stroke ?? PIXEL_STROKE_COLOR,
    strokeThickness: PIXEL_STROKE,
  };
  if (opts.fontStyle) style.fontStyle = opts.fontStyle;
  if (color) style.color = color;
  return style;
}
