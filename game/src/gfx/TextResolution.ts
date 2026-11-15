/**
 * 把文字栅格一次性装到**所有** Text 上（甲方 m01507「文字不要像素感」、m14676「我只要清晰的文字」）。
 *
 * 为什么不是在每个 `this.add.text(...)` 里补一个 `resolution` 字段：
 * 全工程有 140 多处 Text，散着写必然漏；而漏掉的那几处正是 HUD/对白这种最显眼的位置。
 * Phaser 的 `GameObjectFactory.register('text', …)` 是把方法挂在**原型**上的，
 * 所以在 `boot.ts` 里包一次原型方法，之后无论是 `scene.add.text()` 还是
 * `this.add.text()`，拿到的都是「已经按超采样栅格生成画布」的 Text，调用点一行都不用改。
 *
 * 效果：一张 10px 的字，内部画布是 `10 × textResolution()` 高再缩回 10px 绘制——
 * 屏幕上放大时看到的是缩小后的抗锯齿边缘，而不是马赛克方块。
 *
 * 注意：`resolution` 是**实例级**的，和 `PixelArt.ts` 那种纹理级滤镜互不影响，
 * 所以「像素图保持硬边 + 文字保持清晰」可以同时成立。
 *
 * ── v1.9.1 追加：**点阵字**走的是同一条路，只是结论相反 ──
 * 上面这套超采样是给「小字要清晰」用的；设计书 4.9.2 又要求标题是像素字。
 * 两者在同一处解决：包装器判一段字的「字号 + 长度」（`core/pixelFont.ts →
 * shouldPixelate`），命中就把 `resolution` 压成 1、加 1px 描边、纹理标最近邻，
 * 于是放大 RENDER_SCALE 倍后每格像素成一块方块；其余一律走超采样。
 * 好处是全工程 140 多处 `add.text` 一行都不用改，风格也不会半新半旧。
 * 想自己定的时候显式写 `style.resolution` 即可（写了包装器就不插手）。
 */

import Phaser from 'phaser';
import { parseFontSize, pixelTextStyle, shouldPixelate } from '../core/pixelFont';
import { markTextPixel, wantsPixelStyle } from './PixelFont';
import { textResolution } from './TextStyle';

let installed = false;

/**
 * 把内边距推开的那点位移补回来。
 *
 * 包装器给每段文字加了 padding（见下面 `installTextResolution` 的说明），
 * 而调用点是按「没有内边距」算位置的，所以按 origin 反向补偿。
 * 只补调用点自己没写 padding 的（写了就是它自己要把墨迹推开的，不用管）。
 */
function compensatePadding(obj: Phaser.GameObjects.Text, style: Phaser.Types.GameObjects.Text.TextStyle | undefined): void {
  if (style?.padding !== undefined) return;
  const p = obj.padding;
  const pl = p?.left ?? 0;
  const pr = p?.right ?? 0;
  const pt = p?.top ?? 0;
  const pb = p?.bottom ?? 0;
  obj.x -= pl - obj.originX * (pl + pr);
  obj.y -= pt - obj.originY * (pt + pb);
}

type TextFactory = (
  this: Phaser.GameObjects.GameObjectFactory,
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle,
) => Phaser.GameObjects.Text;

/** 给一个 Text 补上栅格（内边距 + resolution），返回是否处理过。 */
function applyResolution(obj: Phaser.GameObjects.Text, style: Phaser.Types.GameObjects.Text.TextStyle | undefined): void {
  if (!obj || typeof obj.setResolution !== 'function') return;
  compensatePadding(obj, style);
  const res = textResolution();
  obj.setResolution(res);
  // 光设 style.resolution 还不够：Phaser 只在 Text **构造时**把
  // `frame.source.resolution` 写成当时的 style.resolution（那时是 1）。
  // 之后 updateText() 会把 canvas 放大到 N 倍、`frame.setSize(Nw,Nh)`，
  // 却**不会**再同步 source.resolution —— 渲染器于是按 res=1 把大图原样画出来，
  // 字就变成 N 倍大的糊字（HUD 直接被挤出屏幕，这是实测踩到的坑）。
  // 因此这里补一次：让「图片的实际分辨率」和「声明用它的分辨率」对上。
  const src = obj.frame && obj.frame.source;
  if (src) {
    src.resolution = res;
    obj.updateText();
  }
}

/** 幂等：重复调用只生效一次（场景重启、热更新都不会叠加包装）。 */
export function installTextResolution(): void {
  if (installed) return;
  installed = true;
  const proto = Phaser.GameObjects.GameObjectFactory.prototype as unknown as { text: TextFactory };
  const original = proto.text;
  proto.text = function (this: Phaser.GameObjects.GameObjectFactory, x, y, text, style) {
    // 给每段文字留一点内边距。
    // 起因（实测）：Phaser 的字画布恰好按「量出来的宽高」创建，而中文黑体的字形墨迹
    // 常常比 font metrics 报的 ascent/descent 多出 1–2px —— 于是「清」「王」「朝」的
    // 顶横和左边的三点水会被画布边缘切掉，HUD 左上角那三行字长期缺笔画。
    // 内边距只改变画布尺寸，不改字号。
    const pad = { x: 1, y: 2 };
    // 点阵字（设计书 4.9.2 方案 ②）：只给「大字号 + 短文本」，判据与取舍理由
    // 全在 `core/pixelFont.ts`。正文 / HUD / 对白这些小字继续走下面的清晰栅格——
    // 甲方 m01507 / m14676 抱怨的正是小字被点阵化后读不出来。
    // 调用点想自己决定时可以显式写 `resolution`：写了就一律听调用点的。
    const plain = Array.isArray(text) ? text.join('\n') : String(text ?? '');
    const explicitRes = style?.resolution !== undefined;
    const autoPixel = !explicitRes && shouldPixelate(parseFontSize(style?.fontSize), plain);
    const pixel = autoPixel || wantsPixelStyle(style);

    const merged: Phaser.Types.GameObjects.Text.TextStyle = style ? { ...style } : {};
    if (autoPixel) {
      // 字号取整 + 1px 描边 + resolution 1，一次写进构造参数：
      // 建好之后再改 fontSize 会触发一次多余的 updateText()。
      const p = pixelTextStyle(merged.fontSize, undefined, { fontStyle: merged.fontStyle });
      merged.fontSize = p.fontSize;
      merged.resolution = p.resolution;
      // 调用点自己配过描边就整套沿用。例：林则徐头顶那个 `!` 是 16px + 3px 深描边，
      // 为了压在深色池水上也看得清；这里若改成 1px，标记会直接消失在水里。
      if (merged.stroke === undefined && merged.strokeThickness === undefined) {
        merged.stroke = p.stroke;
        merged.strokeThickness = p.strokeThickness;
      }
    }
    merged.padding = merged.padding ?? pad;

    const obj = original.call(this, x, y, text, merged);
    if (pixel) {
      // 1 倍栅格已由 style.resolution 定好，这里只把采样换成最近邻：
      // 渲染器放大 RENDER_SCALE 倍之后，每个栅格像素就是一块方块。
      compensatePadding(obj, style);
      markTextPixel(obj);
      return obj;
    }
    applyResolution(obj, style);
    return obj;
  };
}

/**
 * `RENDER_SCALE` 会因为横竖屏切换重算（见 `core/constants.ts` 的 `refreshRenderScale`），
 * 已经建好的 Text 还停在旧栅格上：旧栅格小于新倍率时，字会先在后缓冲里被放大一次，
 * 再被浏览器缩回去 —— 两头一叠加就又糊了，而且这次连截图都看不出是浏览器的锅。
 * 所以换倍率时必须把所有活着的 Text 重画一遍。
 */
export function retuneAllTexts(game: Phaser.Game): number {
  let n = 0;
  const res = textResolution();
  const walk = (list: readonly Phaser.GameObjects.GameObject[]): void => {
    for (const go of list) {
      const obj = go as Phaser.GameObjects.Text & { list?: readonly Phaser.GameObjects.GameObject[] };
      if (obj.type === 'Text' && obj.frame?.source && obj.frame.source.resolution !== res) {
        obj.setResolution(res);
        obj.frame.source.resolution = res;
        obj.updateText();
        n++;
      }
      if (obj.list && obj.list.length) walk(obj.list);
    }
  };
  for (const scene of game.scene.getScenes(true)) walk(scene.children?.list ?? []);
  return n;
}
