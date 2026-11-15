/**
 * 把 `core/unitFrames.ts` 算出来的帧烘成 Phaser 纹理 —— 兵种小人的「走路 / 出手」帧动画。
 *
 * 做法：拿底图（`art/units/<unit>_<facing>.png`）的不透明掩膜算一次腿带，
 * 在离屏 canvas 上按掩膜重绘出两帧步态 + 一帧出手，注册成 `<baseKey>__stepA|stepB|swing`。
 * 全是**同尺寸、同调色板的像素重排**，所以：
 *   - 不会出现新颜色（只搬像素，不插值），`markPixelByKey` 之后依旧是硬边；
 *   - 每个 (兵种, 朝向) 只烘一次，之后走纹理缓存；
 *   - 失败（贴图没加载、跨域污染 canvas、掩膜不像人形）返回 null，`CharacterRig`
 *     继续用原来的整体浮动，**不会白屏也不会报错**。
 *
 * 为什么要烘纹理而不是每帧改 Graphics：24×32 的图每帧重绘 768 个像素 × 屏幕上十几个
 * 敌人，在手机上不划算；烘一次之后只是 `setTexture`，和原来一样便宜。
 */
import type Phaser from 'phaser';
import { buildStepFrames, cloneMask, isEmptyMask, maskAt, type Mask, planFrames } from '../core/unitFrames';
import { markPixelByKey } from './PixelArt';

export interface UnitFrameSet {
  /** 底图 key（静止/呼吸帧用） */
  base: string;
  stepA: string;
  stepB: string;
  swing: string;
}

/** `null` 也缓存：同一张不支持的图不要每次 tick 都重试一遍 */
const cache = new Map<string, UnitFrameSet | null>();

/** 单个兵种朝向最多缓存几套（8 兵种 × 4 朝向起步，留足余量） */
const CACHE_LIMIT = 128;

function readMask(scene: Phaser.Scene, key: string): { mask: Mask; data: ImageData } | null {
  const tex = scene.textures.get(key);
  if (!tex || tex.key === '__MISSING') return null;
  const src = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined;
  if (!src) return null;
  const w = (src as HTMLImageElement).width || tex.source[0]?.width || 0;
  const h = (src as HTMLImageElement).height || tex.source[0]?.height || 0;
  if (!w || !h) return null;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    // 跨域图会污染 canvas：宁可不动，也不要抛出去把整个渲染循环带崩
    return null;
  }
  const mask: Mask = { w, h, a: new Uint8Array(w * h) };
  for (let i = 0; i < w * h; i++) mask.a[i] = data.data[i * 4 + 3] > 0 ? 1 : 0;
  return { mask, data };
}

function bake(scene: Phaser.Scene, key: string, mask: Mask, src: ImageData): string | null {
  if (isEmptyMask(mask)) return null;
  if (scene.textures.exists(key)) return key;
  const cv = document.createElement('canvas');
  cv.width = mask.w;
  cv.height = mask.h;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const out = ctx.createImageData(mask.w, mask.h);
  // 只搬不透明像素：透明处保持透明，颜色原样复制（不插值、不调色）
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (!maskAt(mask, x, y)) continue;
      const i = (y * mask.w + x) * 4;
      out.data[i] = src.data[i];
      out.data[i + 1] = src.data[i + 1];
      out.data[i + 2] = src.data[i + 2];
      out.data[i + 3] = src.data[i + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
  scene.textures.addCanvas(key, cv);
  markPixelByKey(scene, key);
  return key;
}

/**
 * 取某个兵种某个朝向的帧集合。`dir` 是朝向在 x 轴上的符号（左 -1 / 右 +1 / 上下 +1）。
 * 返回 null 表示这张图不支持派生帧（贴图缺失、跨域、形状不像人形）。
 */
export function unitFrameSet(scene: Phaser.Scene, baseKey: string, dir: 1 | -1): UnitFrameSet | null {
  const cacheKey = `${baseKey}|${dir}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;

  const read = readMask(scene, baseKey);
  if (!read) {
    cache.set(cacheKey, null);
    return null;
  }
  const plan = planFrames(read.mask);
  if (!plan) {
    cache.set(cacheKey, null);
    return null;
  }
  const frames = buildStepFrames(read.mask, plan, dir);
  if (!frames) {
    cache.set(cacheKey, null);
    return null;
  }
  const stepA = bake(scene, `${baseKey}__stepA`, frames.stepA, read.data);
  const stepB = bake(scene, `${baseKey}__stepB`, frames.stepB, read.data);
  const swing = bake(scene, `${baseKey}__swing`, frames.swing, read.data);
  if (!stepA || !stepB || !swing) {
    cache.set(cacheKey, null);
    return null;
  }
  const set: UnitFrameSet = { base: baseKey, stepA, stepB, swing };
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(cacheKey, set);
  return set;
}

/** 当前已经烘好的帧集合数量（调试/探针用） */
export function unitFrameCacheSize(): number {
  return cache.size;
}

/** 清缓存（换图集或热更新时用；纹理本身留在 TextureManager 里） */
export function resetUnitFrames(): void {
  cache.clear();
}

export { cloneMask };
