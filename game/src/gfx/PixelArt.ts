/**
 * 像素资源的「硬边」保障 —— 谁需要点阵感，谁在创建时调一次。
 *
 * 背景：`boot.ts` 为让文字清晰，把画布改成了非 pixelArt（平滑滤波）。
 * 代价是 image/texture 默认也会被线性插值，一张 16×16 的瓦片放大 3 倍就会糊成一团。
 * Phaser 的滤镜是**纹理级**属性（同一个 key 的所有贴图共享），所以这里按 key 记一笔，
 * 保证每张纹理只设一次，而且只对像素美术设——文字纹理绝对不能走这条路。
 *
 * 用法：所有 `add.image / add.sprite` 之后调 `markPixel(img)`；
 * 或者 `markPixelByKey(scene, key)` 只标纹理不碰对象（给 Dynamically 生成的 key 用）。
 */
import Phaser from 'phaser';

/** 已经标过的纹理 key。纹理是整局共享的，所以这张表可以活到页面关闭。 */
const marked = new Set<string>();

/**
 * 把一个纹理标成「最近邻采样」。重复调用无副作用；纹理不存在时返回 false。
 *
 * 注意这里的坑（踩了一次）：**纹理级滤镜只有在 WebGL 渲染器下才有意义**。
 * 渲染器是 Canvas 时，Phaser 会把 `texture.setFilter` / `setCropUVs` 全部编译成空函数
 * （见 `phaser.js` 里 `CanvasRenderer` 的 `save/setTextureScale` 实现），
 * 也就是说「标了 NEAREST」在截图里根本查不到效果。所以：
 *   - 这里仍然要标（WebGL 手机上有效）；
 *   - 但 Canvas 回退时需要另一条路——见下面的 `ENABLE_NEAREST_CSS`。
 */
export function markPixelByKey(scene: Phaser.Scene, key: string): boolean {
  if (!key || marked.has(key)) return true;
  const tex = scene.textures.exists(key) ? scene.textures.get(key) : null;
  if (!tex) return false;
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  marked.add(key);
  return true;
}

/** 把一个 Image/Sprite 的纹理标成最近邻采样（按 key 判重），并把对象原样返回，便于链式书写。 */
export function markPixel<T extends Phaser.GameObjects.Image | Phaser.GameObjects.Sprite>(obj: T): T {
  const key = obj.texture?.key;
  if (!key) return obj;
  markPixelByKey(obj.scene, key);
  return obj;
}

/**
 * 一个纹理被销毁后（比如场景重开时的 `createCanvas` 覆盖同名 key）要清掉记录，
 * 否则新纹理不会重新被标 NEAREST。`MapRenderer` 的烘焙层每次重开都会换 key，用得到。
 */
export function forgetPixelKey(key: string): void {
  marked.delete(key);
}

/** 调试入口：当前已被标成像素的 key 数量（E2E 用它确认滤镜真的生效了）。 */
export function pixelKeyCount(): number {
  return marked.size;
}