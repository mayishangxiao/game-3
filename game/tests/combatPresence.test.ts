/**
 * 「实力感」分层的回归锁。
 *
 * 甲方 2026-11-17：光用文字列五项对比不直观，要用角色状态、血条、命中特效、
 * 打击节奏与音效**演**出差距。分层数值收在 `src/core/combatPresence.ts`，
 * 这里锁三件最容易改坏的事：
 *
 *   1. **不许倒挂**：越强的档位，顿帧/震屏/护甲/碎片/闪白/击退抗性只能不降。
 *      调参时手一抖把精英调得比杂鱼还软，玩家立刻能感觉到「这游戏坏了」。
 *   2. **杂鱼不许顿帧**：mob 的 hitStop 必须是 0。连击杂鱼每下都停一拍 = 卡顿。
 *   3. **Boss 必须打不动**：knockResist = 1，且场景侧确实乘了 knockScale。
 *
 * 另外锁「不用粒子系统」——这套 24 色像素风经不起半透明噪点，上一轮刚清完
 * 海面黑点（甲方原话「看着很乱，全是黑点」）。火花只能是整数像素小方块。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRESENCE_TIERS,
  hitStopFor,
  knockScale,
  presenceOf,
} from '../src/core/combatPresence';

const ROOT = process.cwd();
const src = (rel: string): string => readFileSync(join(ROOT, 'src', rel), 'utf8');

describe('实力感分档：五档齐全且逐档更重', () => {
  it('五个 tier 都有配置，字段在合法范围内', () => {
    for (const tier of PRESENCE_TIERS) {
      const p = presenceOf(tier);
      expect(p, `${tier} 缺少配置`).toBeTruthy();
      expect(p.barH, `${tier} 血条厚度应在 3—5px`).toBeGreaterThanOrEqual(3);
      expect(p.barH).toBeLessThanOrEqual(5);
      expect(p.armorLayers, `${tier} 护甲层数最多 2`).toBeGreaterThanOrEqual(0);
      expect(p.armorLayers).toBeLessThanOrEqual(2);
      expect(p.knockResist).toBeGreaterThanOrEqual(0);
      expect(p.knockResist).toBeLessThanOrEqual(1);
      expect(p.sparkN).toBeLessThanOrEqual(10);
    }
  });

  it('顿帧 / 震屏 / 护甲 / 碎片 / 闪白 / 火花尺寸随档位不降', () => {
    // `ranged` 与 `standard` 是同一级（远程版正规兵），不参与严格单调；
    // 真正要防倒挂的是这条主强度轴：杂鱼 → 正规兵 → 精英 → Boss。
    const axis = ['mob', 'standard', 'elite', 'boss'] as const;
    const rows = axis.map((t) => ({ t, p: presenceOf(t) }));
    const keys = [
      'hitStopMs',
      'shakeAmp',
      'armorLayers',
      'debris',
      'flashMs',
      'sparkScale',
      'deathMs',
      'knockResist',
    ] as const;
    for (let i = 1; i < rows.length; i++) {
      for (const k of keys) {
        expect(
          rows[i].p[k],
          `${rows[i].t}.${k} 比 ${rows[i - 1].t} 还小，档位倒挂了`,
        ).toBeGreaterThanOrEqual(rows[i - 1].p[k]);
      }
    }
  });

  it('远程兵不越级：比杂鱼有反馈，但既不顿得比精英久、也没有护甲', () => {
    const r = presenceOf('ranged');
    expect(r.hitStopMs).toBeGreaterThan(presenceOf('mob').hitStopMs);
    expect(r.hitStopMs).toBeLessThan(presenceOf('elite').hitStopMs);
    expect(r.armorLayers).toBe(0);
    expect(r.auraR).toBe(0);
  });

  it('杂鱼不顿帧、Boss 完全打不动', () => {
    // 杂鱼每下都顿 = 连击时卡顿；这条是手感底线，不是调参空间
    expect(presenceOf('mob').hitStopMs).toBe(0);
    expect(presenceOf('mob').auraR).toBe(0);
    expect(presenceOf('boss').knockResist).toBe(1);
    expect(knockScale('boss')).toBe(0);
    // 精英要明显「退得少」但还退得动，否则玩家会觉得没反馈
    expect(knockScale('elite')).toBeGreaterThan(0);
    expect(knockScale('elite')).toBeLessThan(knockScale('mob'));
  });

  it('音色档位：杂鱼轻、精英与 Boss 重', () => {
    expect(presenceOf('mob').weight).toBe('light');
    expect(presenceOf('elite').weight).toBe('heavy');
    expect(presenceOf('boss').weight).toBe('heavy');
  });

  it('未知 / 缺失 tier 一律回落杂鱼，绝不崩', () => {
    expect(presenceOf(undefined)).toBe(presenceOf('mob'));
    expect(presenceOf(null)).toBe(presenceOf('mob'));
    // 数据里拼错一个字母，宁可「不够帅」也不能没有反馈
    expect(presenceOf('bosss' as unknown as string)).toBe(presenceOf('mob'));
    expect(knockScale('nope' as unknown as string)).toBe(1);
    expect(hitStopFor('nope' as unknown as string)).toBe(0);
  });
});

describe('引擎接线：分档数值真的被用上', () => {
  it('Enemy 按档位画血条护甲层、抖动与气场', () => {
    const enemy = src('entities/Enemy.ts');
    expect(enemy).toContain('presenceOf(def.tier)');
    expect(enemy).toContain('hpArmor');
    expect(enemy).toContain('this.barShake = this.presence.knockResist < 1 ? 1 : 0');
    expect(enemy).toContain('makePresenceAura');
    // 死亡时长按档位走，别再写死 300
    expect(enemy).toContain('this.rig.playDeath(undefined, this.presence.deathMs)');
    expect(enemy).toContain('spawnDebris');
  });

  it('LevelScene 有顿帧闸门、按档位震屏、击退抗性', () => {
    const scene = src('scenes/LevelScene.ts');
    expect(scene).toContain('private hitStopMs = 0');
    expect(scene).toContain('if (this.hitStopMs > 0) {');
    expect(scene).toContain('this.hitStopMs = Math.max(this.hitStopMs, p.hitStopMs)');
    expect(scene).toContain('knockScale(e.def.tier)');
    expect(scene).toContain('spawnHitSpark');
    // 玩家被强敌击中要推退（复用敌人脚盒判据，别把人推进海里）
    expect(scene).toContain('foe.shove');
    expect(scene).toContain('this.player.rig.knockback');
  });

  it('音效按重量分档，敌人出手也有声音', () => {
    const audio = src('systems/AudioKit.ts');
    expect(audio).toContain("swing(weight: HitWeight = 'light')");
    expect(audio).toContain("hit(weight: HitWeight = 'light')");
    expect(audio).toContain("weight === 'heavy'");
    const scene = src('scenes/LevelScene.ts');
    expect(scene).toContain('audio.swing(presenceOf(from.def.tier).weight)');
    expect(scene).toContain('audio.hit(p.weight)');
  });

  it('特效层不使用粒子系统（像素风会被半透明噪点糊掉）', () => {
    const fx = src('gfx/CombatFx.ts');
    expect(fx).not.toMatch(/add\.particles|ParticleEmitter/);
    // 火花数量必须封顶
    expect(fx).toContain('Math.min(12');
  });
});

describe('尸体延时清理与相机基准（v2.8 巡检挖出的两个回归）', () => {
  it('死亡后的显示对象按档位延时销毁，不许写死 320ms 抢在倒地动画前面', () => {
    const scene = src('scenes/LevelScene.ts');
    // 唯一入口
    expect(scene).toContain('private scheduleCorpseCleanup(e: Enemy): void');
    expect(scene).toContain('presenceOf(e.def.tier).deathMs + 80');
    // 旧的写死时长必须彻底消失（它把精英 420 / Boss 900 全吃掉）
    expect(scene).not.toContain('delayedCall(320, () => {\n      e.destroy();');
    // 判空的同一帧也不能直接销毁尸体
    expect(scene).toMatch(/clearDeadEnemies\(\): void \{[\s\S]{0,260}scheduleCorpseCleanup/);
    // 换图/重开时必须连尸体一起清，否则上一张图的敌人挂在新地图上
    expect(scene).toMatch(/clearEnemies\(\): void \{[\s\S]{0,220}this\.dyingEnemies\.forEach/);
  });

  it('军舰沉没不许套人形 90° 倒地（船体会在 900ms 里竖起来）', () => {
    const rig = src('gfx/CharacterRig.ts');
    expect(rig).toMatch(/if \(this\.isShip\) \{[\s\S]{0,420}angle: this\.facing === 'left' \? -7 : 7/);
    expect(rig).toContain('y: this.y + 10');
  });

  it('相机推镜的基准是 RENDER_SCALE，不是 1（回 1 会缩成左上角 1/R²）', () => {
    const scene = src('scenes/LevelScene.ts');
    expect(scene).toContain('this.cameras.main.setZoom(RENDER_SCALE)');
    expect(scene).toContain('const baseZoom = RENDER_SCALE');
    expect(scene).toContain('cam.zoomTo(baseZoom * 1.06');
    expect(scene).toContain('cam.zoomTo(baseZoom, 520');
    // 硬编码 1 的两处都是线上事故现场，别再写回来
    expect(scene).not.toContain('cameras.main.setZoom(1)');
    expect(scene).not.toContain('cam.zoomTo(1, 520');
  });
});
