/**
 * 战斗「看得见的重量」：命中火花、死亡碎片、强者气场。
 *
 * 为什么不用 Phaser 的粒子系统：这套游戏是 24 色像素风，粒子发射器的随机尺寸/旋转/
 * alpha 会把画面糊成一片半透明噪点（甲方上一轮刚报过「海面全是黑点」）。这里全部是
 * **整数像素的小方块 + 位移 tween**，数量按档位封顶（最多 10 个），一眼是「像素火花」
 * 而不是「烟雾」。真正的重量感交给 `core/combatPresence.ts` 的顿帧与击退，火花只是
 * 让「打到了」这件事在画面上有个落点。
 */

import Phaser from 'phaser';
import { DEPTH, PALETTE } from '../core/constants';
import type { PresenceDef } from '../core/combatPresence';

/** 所有火花/碎片的深度：在实体之上、前景暗角之下 */
const FX_DEPTH = DEPTH.fx;

/**
 * 命中火花：从命中点朝四周甩出 n 个 2px 小方块，边飞边淡出。
 *
 * @param scale 尺寸倍率（0.6 = 杂鱼的一小闪，1.5 = 砍在军舰装甲上）
 * @param ms    存续时间，与 `PresenceDef.sparkMs` 同源
 */
export function spawnHitSpark(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number,
  n: number,
  scale: number,
  ms: number,
): void {
  const count = Math.max(0, Math.min(12, Math.round(n)));
  if (count === 0) return;
  const size = Math.max(1, Math.round(2 * scale));
  const reach = 8 + 10 * scale;
  for (let i = 0; i < count; i++) {
    // 均匀分布在圆周上，再叠一点固定抖动：不用随机数，避免同一帧连击时火花完全重合
    const ang = (Math.PI * 2 * i) / count + (i % 3) * 0.21;
    const dist = reach * (0.65 + ((i * 7) % 5) * 0.09);
    const px = x + Math.cos(ang) * 3;
    const py = y + Math.sin(ang) * 3;
    const dot = scene.add
      .rectangle(px, py, size, size, i % 4 === 0 ? PALETTE.paper : color)
      .setDepth(FX_DEPTH);
    scene.tweens.add({
      targets: dot,
      x: px + Math.cos(ang) * dist,
      y: py + Math.sin(ang) * dist,
      alpha: 0,
      duration: ms,
      ease: 'Quad.easeOut',
      onComplete: () => dot.destroy(),
    });
  }
}

/**
 * 死亡碎片：强者倒下时炸出几块甲片/木屑，弱者没有（`debris = 0`）。
 * 与火花同一套实现，但带一点「往下掉」的位移，读起来像被打碎而不是被打退。
 */
export function spawnDebris(
  scene: Phaser.Scene,
  x: number,
  y: number,
  n: number,
  color: number,
): void {
  const count = Math.max(0, Math.min(10, Math.round(n)));
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + 0.4;
    const w = 2 + (i % 2);
    const h = 2 + ((i + 1) % 2);
    const px = x + Math.cos(ang) * 4;
    const py = y + Math.sin(ang) * 3;
    const bit = scene.add.rectangle(px, py, w, h, color).setDepth(FX_DEPTH);
    scene.tweens.add({
      targets: bit,
      x: px + Math.cos(ang) * (10 + (i % 3) * 4),
      // 轻微下坠：末位移比初位移低 6～10px，视觉上「掉在地上」
      y: py + Math.sin(ang) * 8 + 6 + (i % 3) * 2,
      alpha: 0,
      angle: (i % 2 === 0 ? 1 : -1) * 90,
      duration: 380 + (i % 3) * 60,
      ease: 'Quad.easeOut',
      onComplete: () => bit.destroy(),
    });
  }
}

/**
 * 强者的气场：脚下一圈细描边光环 + 一层极淡内芯，缓慢呼吸。
 *
 * 只给 `auraR > 0` 的档位（精英 16px / Boss 30px）。**不用大块实心圆**——
 * 实心圆被船体/身体挡住上半边后，剩下的大半圆读起来是「一块色块」甚至「水下阴影」
 * （v2.7 实拍确认过两次）。改成 1px 描边环后，露出来的那半圈像一道光，且不糊轮廓。
 *
 * 返回 Container 由调用方持有并每帧跟随。
 */
export function makePresenceAura(
  scene: Phaser.Scene,
  x: number,
  y: number,
  def: PresenceDef,
): Phaser.GameObjects.Container | null {
  if (def.auraR <= 0) return null;
  const c = scene.add.container(x, y + 8).setDepth(DEPTH.shadow - 1);
  const add = (r: number, alpha: number, stroke: boolean): void => {
    const arc = scene.add.circle(0, 0, r, def.auraColor, stroke ? 0 : alpha);
    // 2px 描边：1px 在木甲板/砖地上几乎读不出来（实拍确认过）。
    if (stroke) arc.setStrokeStyle(2, def.auraColor, alpha);
    // 加色混合：低透明度叠在深蓝海面/暗色地砖上才像「透出来的光」，
    // 普通混合会混成脏紫灰。
    arc.setBlendMode(Phaser.BlendModes.ADD);
    if (!stroke) arc.setAlpha(alpha);
    c.add(arc);
  };
  // 外圈描边最亮，内芯只留一点点，避免整块发亮
  add(def.auraR, Math.min(0.7, def.auraAlpha * 3.2), true);
  add(def.auraR * 0.62, def.auraAlpha * 1.1, false);
  scene.tweens.add({
    targets: c,
    alpha: { from: 0.72, to: 1 },
    scaleX: { from: 1, to: 1.06 },
    scaleY: { from: 1, to: 1.06 },
    duration: 1100,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
  return c;
}
