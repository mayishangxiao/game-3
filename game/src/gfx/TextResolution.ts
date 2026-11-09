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
 */

import Phaser from 'phaser';
import { textResolution } from './TextStyle';

let installed = false;

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
  // 让墨迹回到原来的位置（内边距会把原点推开一点，按 origin 反向补偿）
  const p = obj.padding;
  const pl = p?.left ?? 0;
  const pr = p?.right ?? 0;
  const pt = p?.top ?? 0;
  const pb = p?.bottom ?? 0;
  if (style?.padding === undefined) {
    obj.x -= pl - obj.originX * (pl + pr);
    obj.y -= pt - obj.originY * (pt + pb);
  }
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
    const padded: Phaser.Types.GameObjects.Text.TextStyle = style
      ? { ...style, padding: style.padding ?? pad }
      : { padding: pad };
    const obj = original.call(this, x, y, text, padded);
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
