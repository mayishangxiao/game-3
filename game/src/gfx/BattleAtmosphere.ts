/**
 * 第三幕（洋务运动 / 甲午海战）战场氛围层。
 *
 * 甲方要求「背景贴合洋务运动时期，并且要肃杀、黑暗，体现战斗的危险」。
 * 黑暗感**不能**靠往地面撒近黑噪点来做 —— 上一轮刚把海面瓦片的黑短划清干净
 * （甲方原话「看着很乱，全是黑点」）。这里改用大面积平滑的两层：
 *
 *   1. 冷调压暗：一层 `PALETTE.night` 低透明度覆盖全场，把暖木甲板 / 白砖厂房
 *      压成阴冷的战时色调；顶部远景带再压一层，硝烟更沉。
 *   2. 径向暗角：中心透明、四边渐暗，把视线收进战场中央，读起来像被浓烟和
 *      夜色围住，而不是给整张图蒙一块灰布。
 *
 * 三层深度都落在 `DEPTH.vignette`（99）附近：压住地面（0）与实体（20—80），
 * 但 `DEPTH.hud`（100）和 DOM 文字层在其上 —— 血条、摇杆、战役条白字完全不受影响，
 * 中心区 24×32 的小人也仍看得清。只影响 `WAR_ATMOSPHERE.acts` 里登记的幕，
 * 其余四幕一个像素都不变。
 *
 * 返回的 GameObject 数组由 LevelScene 持有，换图时自己销毁（它们不进 `worldObjects`，
 * 否则会被当成可交互物）。
 */

import Phaser from 'phaser';
import { DEPTH, VIEW_H, VIEW_W, WAR_ATMOSPHERE } from '../core/constants';

const VIGNETTE_TEX = 'fx_era_vignette';

/** 是否给这一幕叠氛围。唯一入口，测试和 LevelScene 都读它。 */
export function atmosphereEnabled(actId: string | undefined): boolean {
  return !!actId && (WAR_ATMOSPHERE.acts as readonly string[]).includes(actId);
}

function rgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${alpha})`;
}

/** 暗角纹理是全局共享的：createCanvas 一次，之后所有 LevelScene 复用同一个 key。 */
function vignetteTexture(scene: Phaser.Scene): string | null {
  if (scene.textures.exists(VIGNETTE_TEX)) return VIGNETTE_TEX;
  const tex = scene.textures.createCanvas(VIGNETTE_TEX, VIEW_W, VIEW_H);
  if (!tex) return null;
  const ctx = tex.getContext();
  const { inner, mid, edge } = WAR_ATMOSPHERE.vignette;
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  const grad = ctx.createRadialGradient(cx, cy, VIEW_H * inner, cx, cy, Math.hypot(cx, cy));
  const ink = WAR_ATMOSPHERE.cool.color;
  grad.addColorStop(0, rgba(ink, 0));
  grad.addColorStop(0.45, rgba(ink, mid));
  grad.addColorStop(1, rgba(ink, edge));
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  tex.refresh();
  return VIGNETTE_TEX;
}

/**
 * 叠氛围并返回本次创建的对象，供调用方在 `buildWorld` 重入时销毁。
 * 返回空数组 = 这一幕不叠，调用方无需任何清理。
 */
export function applyBattleAtmosphere(
  scene: Phaser.Scene,
  actId: string | undefined,
): Phaser.GameObjects.GameObject[] {
  if (!atmosphereEnabled(actId)) return [];
  const created: Phaser.GameObjects.GameObject[] = [];

  const shade = scene.add.graphics().setDepth(DEPTH.vignette - 0.3).setScrollFactor(0);
  shade.fillStyle(WAR_ATMOSPHERE.cool.color, WAR_ATMOSPHERE.cool.alpha);
  shade.fillRect(0, 0, VIEW_W, VIEW_H);
  shade.fillStyle(WAR_ATMOSPHERE.cool.color, WAR_ATMOSPHERE.skyShade);
  shade.fillRect(0, 0, VIEW_W, 64);
  created.push(shade);

  const key = vignetteTexture(scene);
  if (key) {
    created.push(
      scene.add.image(0, 0, key).setOrigin(0, 0).setDepth(DEPTH.vignette).setScrollFactor(0),
    );
  }
  return created;
}
