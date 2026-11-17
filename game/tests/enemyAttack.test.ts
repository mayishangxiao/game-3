/**
 * 攻击判定框与「挨打还手」的回归锁（v2.9）。
 *
 * 背景：v2.7 之前敌人的近战是「进入射程 → 蓄力 → 时间到**必中**」，
 * 玩家看得见刀光却躲不开，绕到背后照样掉血；屏幕上那圈刀光还是写死的 26px，
 * 精英实际射程 34px 也照画 26px —— 看得见的和打得到的不是一个东西。
 *
 * 这一层锁三件事：
 *   1. **判定框按档位递增**：杂鱼手短、精英手长且扇面更宽。改数值不许倒挂。
 *   2. **几何函数本身**：背后/超出距离必须落空，贴脸必须命中，reach 0 永不命中。
 *   3. **接线**：Enemy 里蓄力锁方向、出手用 `meleeSwingHits` 判定、被打了会还手；
 *      场景把同一个 arcDeg 交给刀光。任何一条改回「时间到必中」都要红。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { meleeSwingHits, presenceOf } from '../src/core/combatPresence';

const ROOT = process.cwd();
const src = (rel: string): string => readFileSync(join(ROOT, 'src', rel), 'utf8');

interface EnemyRow {
  id: string;
  tier: string;
  ai_params: { attack_range: number; attack_windup_ms: number };
}
const enemies: EnemyRow[] = JSON.parse(
  readFileSync(join(ROOT, 'public', 'data', 'enemies', 'enemies_ch00.json'), 'utf8'),
).enemies as EnemyRow[];

describe('判定框分档：强者够得更远、扫得更宽', () => {
  it('主强度轴的 reach / arc 逐档不降，且确实拉开差距', () => {
    const mob = presenceOf('mob');
    const std = presenceOf('standard');
    const elite = presenceOf('elite');
    expect(mob.attackReach).toBeGreaterThan(0);
    expect(std.attackReach).toBeGreaterThan(mob.attackReach);
    expect(elite.attackReach).toBeGreaterThan(std.attackReach);
    expect(std.attackArcDeg).toBeGreaterThan(mob.attackArcDeg);
    expect(elite.attackArcDeg).toBeGreaterThan(std.attackArcDeg);
    // 差距要能被身体感觉到，不是调参误差
    expect(elite.attackReach - mob.attackReach).toBeGreaterThanOrEqual(10);
    expect(elite.attackArcDeg - mob.attackArcDeg).toBeGreaterThanOrEqual(20);
  });

  it('远程兵与 Boss 不走近战判定框（各自由弹道 / 招式循环负责）', () => {
    for (const tier of ['ranged', 'boss'] as const) {
      expect(presenceOf(tier).attackReach, `${tier} 不该有近战判定框`).toBe(0);
      expect(presenceOf(tier).attackArcDeg, `${tier} 不该有近战判定框`).toBe(0);
    }
  });

  it('杂鱼与正规兵不还手，精英还手短促、Boss 只催招不缩预警', () => {
    for (const tier of ['mob', 'standard', 'ranged'] as const) {
      expect(presenceOf(tier).counterWindupMs, `${tier} 不该还手`).toBe(0);
      expect(presenceOf(tier).counterCdMs).toBe(0);
    }
    const elite = presenceOf('elite');
    // 前摇要短于数据里的正常前摇(420–520ms)才像「反手」，又不能短到看不见
    expect(elite.counterWindupMs).toBeGreaterThanOrEqual(240);
    expect(elite.counterWindupMs).toBeLessThanOrEqual(320);
    // 冷却必须够长，否则贴脸连砍会被每一刀都反，变成「越打越挨打」
    expect(elite.counterCdMs).toBeGreaterThanOrEqual(2000);
    // Boss 的反击是「把下一招提前」，不是缩预警：前摇字段必须为 0
    expect(presenceOf('boss').counterWindupMs).toBe(0);
    expect(presenceOf('boss').counterCdMs).toBeGreaterThanOrEqual(3000);
  });
});

describe('扇形判定几何', () => {
  // 精英的判定框：36px / 118°（半角 59°），目标半径 8
  const R = 36;
  const A = 118;

  it('正前方够得着，超出身位就落空', () => {
    expect(meleeSwingHits(0, 0, 0, 30, 0, R, A)).toBe(true);
    expect(meleeSwingHits(0, 0, Math.PI / 2, 0, 30, R, A)).toBe(true);
    // 36 + 目标半径 8 = 44 是硬上限
    expect(meleeSwingHits(0, 0, 0, 43, 0, R, A)).toBe(true);
    expect(meleeSwingHits(0, 0, 0, 46, 0, R, A)).toBe(false);
    expect(meleeSwingHits(0, 0, 0, 120, 0, R, A)).toBe(false);
  });

  it('走出扇形就是空挥：背后、侧后都打不到', () => {
    expect(meleeSwingHits(0, 0, 0, -30, 0, R, A)).toBe(false);
    // 侧后 120°：远超半角 59°
    expect(meleeSwingHits(0, 0, 0, -15, -26, R, A)).toBe(false);
    // 侧前方 40°：还在扇面里
    const rad = (40 * Math.PI) / 180;
    expect(meleeSwingHits(0, 0, 0, Math.cos(rad) * 30, Math.sin(rad) * 30, R, A)).toBe(true);
    // 侧方 80°：出界
    const rad2 = (80 * Math.PI) / 180;
    expect(meleeSwingHits(0, 0, 0, Math.cos(rad2) * 30, Math.sin(rad2) * 30, R, A)).toBe(false);
  });

  it('贴着身体一律命中（站在身体里反而打不到最反直觉）', () => {
    expect(meleeSwingHits(0, 0, 0, -10, 0, R, A)).toBe(true);
    expect(meleeSwingHits(0, 0, Math.PI, 10, 0, R, A)).toBe(true);
  });

  it('reach / arc 为 0 时永不命中，360° 时全向命中', () => {
    expect(meleeSwingHits(0, 0, 0, 20, 0, 0, 118)).toBe(false);
    expect(meleeSwingHits(0, 0, 0, 20, 0, 36, 0)).toBe(false);
    expect(meleeSwingHits(0, 0, 0, -30, 0, 36, 360)).toBe(true);
  });
});

describe('数据一致性：射程不能大于判定框，否则玩家站着不动也会被空挥', () => {
  it('每个近战敌人的 attack_range 都落在 attackReach + 目标半径之内', () => {
    const melee = enemies.filter(
      (e) => e.tier !== 'ranged' && e.tier !== 'boss' && e.ai_params.attack_range <= 60,
    );
    expect(melee.length).toBeGreaterThan(0);
    for (const e of melee) {
      const p = presenceOf(e.tier);
      expect(
        e.ai_params.attack_range,
        `${e.id} 在 ${e.ai_params.attack_range}px 就起手，但判定框只有 ${p.attackReach}px`,
      ).toBeLessThanOrEqual(p.attackReach + 8);
    }
  });
});

describe('接线：不许改回「时间到必中」', () => {
  it('Enemy 用扇形判定，且写死的刀光长度已删除', () => {
    const enemy = src('entities/Enemy.ts');
    expect(enemy).not.toContain('ENEMY_MELEE_REACH');
    expect(enemy).toContain('meleeSwingHits(');
    expect(enemy).toMatch(/if \(!meleeSwingHits\([\s\S]{0,160}return;/);
    // 判定必须在掉血之前
    const hit = enemy.indexOf('if (!meleeSwingHits(');
    const dmg = enemy.indexOf('cb.onPlayerHit(res.damage, this)', hit);
    expect(hit).toBeGreaterThan(0);
    expect(dmg).toBeGreaterThan(hit);
  });

  it('蓄力一开始就锁死挥砍方向（后撤 / 绕背能躲）', () => {
    const enemy = src('entities/Enemy.ts');
    expect(enemy).toMatch(
      /this\.state = 'windup';[\s\S]{0,220}this\.swingAngle = Math\.atan2\(player\.y - this\.y, player\.x - this\.x\)/,
    );
    // 出手时用锁定的方向，不许临场重新瞄准
    expect(enemy).toContain('const ang = this.swingAngle');
    expect(enemy).not.toContain('const ang = Math.atan2(player.y - this.y, player.x - this.x);\n    cb.onMeleeSwing');
  });

  it('挨打会还手：精英起短前摇、Boss 清零招式计时且过场不复燃', () => {
    const enemy = src('entities/Enemy.ts');
    expect(enemy).toContain('private provokeCounter(): void');
    expect(enemy).toContain('if (this.hp > 0) this.provokeCounter();');
    expect(enemy).toContain('this.stateTimer = p.counterWindupMs');
    expect(enemy).toContain('this.counterTellPending = true');
    // Boss 只把计时清零，不动预警（BOSS_TELEGRAPH 里没有 counter）
    expect(enemy).toContain('this.bossTimer = 0;');
    expect(enemy).toMatch(/haltActions\(\): void \{[\s\S]{0,220}this\.actionsHalted = true/);
  });

  it('场景把同一个 arcDeg 交给刀光（看得见的 = 打得到的）', () => {
    const scene = src('scenes/LevelScene.ts');
    expect(scene).toContain('onMeleeSwing: (from, ang, reach, arcDeg)');
    expect(scene).toMatch(/this\.slashAt\([\s\S]{0,220}arcDeg/);
    // 还手那一刀换成更亮的红，玩家能看出这是被激怒的反手
    expect(scene).toContain('from.isCountering ? PALETTE.redBright : PALETTE.redDark');
  });
});
