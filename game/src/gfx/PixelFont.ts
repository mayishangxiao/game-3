/**
 * 点阵中文字的绘制层（设计书 4.9.2 方案 ② → 取舍说明在 `core/pixelFont.ts`）。
 *
 * 真正让字「变成点阵」的只有一条：**把文字纹理的采样改成最近邻**。
 * Phaser 的 Text 是「先画到一张 canvas，再当纹理贴出来」；全局为了小字清晰，
 * 这张 canvas 按 `textResolution()`（≥4）超采样，放大 RENDER_SCALE 倍后看起来是抗锯齿的。
 * 点阵字反其道而行：画布按 1 倍栅格生成（`resolution: 1`），再由渲染器放大 3 倍，
 * 每个栅格像素就成了一整块方块——这就是「点阵」。
 *
 * 配套的 1px 描边（`core/pixelFont.ts → PIXEL_STROKE`）在浅色字外面压一圈深色，
 * 让块状边缘有轮廓，否则同色块贴在一起会糊。
 *
 * 接入点是 `TextResolution.ts` 里对 `add.text` 的包装器，**没有任何调用点需要改**：
 *   - 字号 ≥16px 且 ≤18 个字的短文本 → 自动走点阵（`shouldPixelate`）；
 *   - 其余（正文 / HUD / 对白 / 卡片）→ 继续走超采样，保持清晰；
 *   - 调用点想自己定，就在 style 里显式写 `resolution`，包装器一律不插手。
 *
 * 注意：滤镜是**纹理级**属性，但每个 Text 自带一张 canvas 源，所以这里按对象设，
 * 不会波及任何像素美术资源（那是 `PixelArt.ts → markPixelByKey` 的事）。
 */
import Phaser from 'phaser';
import { PIXEL_RESOLUTION } from '../core/pixelFont';

/**
 * 把一段 Text 的纹理标成最近邻。
 *
 * `frame.source` 是这张文字 canvas 对应的 `TextureSource`；渲染器为 Canvas 时
 * `setFilter` 会被编译成空函数（见 `PixelArt.ts` 的说明），此时点阵感靠
 * 「1 倍栅格 + 整数倍放大」本身仍然成立，只是块边缘带一点插值，不会退化。
 */
export function markTextPixel(obj: Phaser.GameObjects.Text): Phaser.GameObjects.Text {
  const source = obj.frame?.source as (Phaser.Textures.TextureSource & { setFilter?: (m: number) => void }) | undefined;
  if (source && typeof source.setFilter === 'function') {
    source.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
  return obj;
}

/** 这个 style 是不是「调用点显式要求了点阵字」（`resolution` 写成 1）。 */
export function wantsPixelStyle(style: Phaser.Types.GameObjects.Text.TextStyle | undefined): boolean {
  return style?.resolution === PIXEL_RESOLUTION;
}
