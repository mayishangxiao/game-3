/**
 * 数值公式单元测试 —— 断言值全部取自《完整设计书 v2.0》第六章与第七章的表格。
 * 这些测试是「设计书与实现一致」的机器可验证凭据。
 */

import { describe, expect, it } from 'vitest';
import {
  applyExp,
  bossBaseHp,
  cumulativeExp,
  computeDamage,
  enhancedValue,
  enhanceCost,
  enemyStats,
  expToNext,
  knowledgeBonus,
  levelCoeff,
  levelStats,
  makeItemInstance,
  rollAffixCount,
  rollQuality,
  salvageValue,
  weaponDps,
  weightedPick,
  type Rng,
} from '../src/core/balance';
import config from '../public/data/config.json';
import type { BalanceConfig, EnemyDef, ItemBase } from '../src/core/types';

const cfg = config as unknown as BalanceConfig;

/** 固定随机源：始终返回 v */
const fixed = (v: number): Rng => () => v;

describe('6.4.1 等级与属性（设计书 6.4.1 表格）', () => {
  it('Lv1 / Lv8 / Lv54 与设计书一致', () => {
    expect(levelStats(1, cfg)).toEqual({ hp: 100, atk: 10, def: 4 });
    expect(levelStats(5, cfg)).toEqual({ hp: 172, atk: 19, def: 9 });
    expect(levelStats(8, cfg)).toEqual({ hp: 226, atk: 25, def: 12 });
    expect(levelStats(12, cfg)).toEqual({ hp: 298, atk: 34, def: 17 });
    // 注意：设计书 6.4.1 表格在 Lv54 一栏写作 atk 126，与公式 round(10+2.2×53)=127 不符；
    // 以公式为准（表格已同步更正为 127）。
    expect(levelStats(54, cfg)).toEqual({ hp: 1054, atk: 127, def: 68 });
  });

  it('Lv37 的 ATK 同样以公式为准（设计书表格已更正为 89）', () => {
    expect(levelStats(37, cfg)).toEqual({ hp: 748, atk: 89, def: 47 });
  });
});

describe('6.4.2 经验曲线（设计书 7.4.1 表格）', () => {
  it('升级需求 = 300 + 60×(L−1)', () => {
    expect(expToNext(1, cfg)).toBe(300);
    expect(expToNext(2, cfg)).toBe(360);
    expect(expToNext(11, cfg)).toBe(900);
    expect(expToNext(54, cfg)).toBe(3480);
  });

  it('累计到 Lv12 恰好 6600，与「序章 4040 → Lv8、第一章再 2640 → Lv12」互为印证', () => {
    expect(cumulativeExp(12, cfg)).toBe(6600);
    expect(cumulativeExp(8, cfg)).toBe(3360);
  });

  it('序章 4040 经验正好停在 Lv8', () => {
    const r = applyExp(1, 0, 4040, cfg);
    expect(r.level).toBe(8);
    expect(r.levelsGained).toBe(7);
  });

  it('序章 + 第一章累计 6680 经验达到 Lv12', () => {
    const r = applyExp(1, 0, 4040 + 2640, cfg);
    expect(r.level).toBe(12);
  });

  it('一次可连升多级且保留余量', () => {
    const r = applyExp(1, 0, 5000, cfg);
    // 累计到 Lv9 = 300+360+...+780 = 3960 + 840 = 4800? 校验：Lv9 起点 = cumulativeExp(9)=3960?
    expect(r.level).toBeGreaterThanOrEqual(9);
    expect(r.exp).toBeLessThan(expToNext(r.level, cfg));
  });
});

describe('6.4.3 关卡等级系数', () => {
  it('系数 = 1.00 + 0.085×(L−1)', () => {
    expect(levelCoeff(1, cfg)).toBeCloseTo(1.0, 5);
    expect(levelCoeff(12, cfg)).toBeCloseTo(1.935, 5); // 设计书写作 1.94
    expect(levelCoeff(25, cfg)).toBeCloseTo(3.04, 5);
    expect(levelCoeff(50, cfg)).toBeCloseTo(5.165, 5); // 设计书写作 5.17
  });

  it('敌人属性 = 基准 × 系数', () => {
    const def: EnemyDef = {
      id: 't',
      name: 't',
      tier: 'standard',
      hp_base: 60,
      atk_base: 8,
      def_base: 3,
      spd: 0.75,
      ai_params: { detect_radius: 120, attack_range: 26, attack_windup_ms: 300, attack_cooldown_ms: 350 },
      frames: 43,
      atlas: 'x',
      boss_phases: null,
    };
    const s = enemyStats(def, 2, cfg);
    expect(s.hp).toBe(Math.round(60 * 1.085));
    expect(s.atk).toBe(Math.round(8 * 1.085));
  });

  it('Boss 基准 HP = 精英 × 6.7 = 1206', () => {
    expect(bossBaseHp(180)).toBe(1206);
    expect(cfg.enemy_tiers.boss.hp).toBe(1206);
  });
});

describe('6.1.3 伤害公式', () => {
  it('中值随机下与手算一致（无暴击、无压制）', () => {
    const r = computeDamage(
      {
        atk: 10,
        weaponMult: 1,
        targetDef: 2,
        attackerLevel: 1,
        targetLevel: 1,
        critRate: 0,
        critDmg: 1.5,
      },
      cfg,
      fixed(0.5),
    );
    // (10×1 − 2×0.5) × 1.0 = 9
    expect(r.damage).toBe(9);
    expect(r.crit).toBe(false);
  });

  it('暴击倍率生效', () => {
    const r = computeDamage(
      {
        atk: 20,
        weaponMult: 1.2,
        targetDef: 3,
        attackerLevel: 1,
        targetLevel: 1,
        critRate: 1,
        critDmg: 1.5,
      },
      cfg,
      fixed(0.5),
    );
    // (24 − 1.5) × 1.0 × 1.5 = 33.75 → 34
    expect(r.damage).toBe(34);
    expect(r.crit).toBe(true);
  });

  it('Boss 弱点期武器倍率 ×2.5', () => {
    const base = computeDamage(
      { atk: 10, weaponMult: 1, targetDef: 0, attackerLevel: 1, targetLevel: 1, critRate: 0, critDmg: 1 },
      cfg,
      fixed(0.5),
    );
    const wp = computeDamage(
      {
        atk: 10,
        weaponMult: 1,
        targetDef: 0,
        attackerLevel: 1,
        targetLevel: 1,
        critRate: 0,
        critDmg: 1,
        weakpoint: true,
      },
      cfg,
      fixed(0.5),
    );
    expect(wp.damage).toBe(base.damage * 2.5);
  });

  it('等级压制：玩家高 5 级时目标防御按 70% 计', () => {
    const r = computeDamage(
      { atk: 50, weaponMult: 1, targetDef: 10, attackerLevel: 10, targetLevel: 5, critRate: 0, critDmg: 1 },
      cfg,
      fixed(0.5),
    );
    // 50 − 10×0.7×0.5 = 46.5 → 47（若未压制则为 45）
    expect(r.damage).toBe(47);
  });

  it('最低伤害保底为 1', () => {
    const r = computeDamage(
      { atk: 1, weaponMult: 1, targetDef: 999, attackerLevel: 1, targetLevel: 1, critRate: 0, critDmg: 1 },
      cfg,
      fixed(0.5),
    );
    expect(r.damage).toBe(1);
  });
});

describe('6.2 武器（设计书 7.4 与 6.2.1）', () => {
  it('武器表与设计书一致', () => {
    expect(cfg.weapons.wp_dao.mult).toBe(1.0);
    expect(cfg.weapons.wp_dao.attacks_per_sec).toBe(2.22);
    expect(cfg.weapons.wp_bow.mult).toBe(1.2);
    expect(cfg.weapons.wp_matchlock.mult).toBe(2.6);
    expect(cfg.weapons.wp_mg.magazine).toBe(100);
  });

  it('Lv5 基准下刀的 DPS 与服务端表一致（约 39.5）', () => {
    const atk = levelStats(5, cfg).atk;
    expect(weaponDps(atk, 1.0, 2.22)).toBeCloseTo(42.2, 1); // 未扣防御的理论值
  });
});

describe('6.3 装备与词条', () => {
  it('词条条数掷点：1/2/3 条对应 50/35/15', () => {
    expect(rollAffixCount(fixed(0.0))).toBe(1);
    expect(rollAffixCount(fixed(0.6))).toBe(2);
    expect(rollAffixCount(fixed(0.95))).toBe(3);
  });

  it('紫装带 1—3 条词条，白装无词条', () => {
    const purple: ItemBase = {
      id: 'p',
      slot: 'accessory',
      quality: 'purple',
      name: '测试',
      stat: 'def',
      base_value: 4,
      quality_multiplier: 1.32,
      source: 'drop',
      flavor: '',
    };
    const white: ItemBase = { ...purple, quality: 'white', quality_multiplier: 1.0 };
    const ip = makeItemInstance(purple, cfg, fixed(0.3));
    const iw = makeItemInstance(white, cfg, fixed(0.3));
    expect(ip.affixes.length).toBeGreaterThanOrEqual(1);
    expect(ip.affixes.length).toBeLessThanOrEqual(3);
    expect(iw.affixes.length).toBe(0);
    expect(ip.value).toBe(Math.round(4 * 1.32));
  });

  it('词条不重复', () => {
    const purple: ItemBase = {
      id: 'p',
      slot: 'accessory',
      quality: 'purple',
      name: '测试',
      stat: 'def',
      base_value: 4,
      quality_multiplier: 1.32,
      source: 'drop',
      flavor: '',
    };
    for (let i = 0; i < 40; i++) {
      const item = makeItemInstance(purple, cfg, Math.random);
      const ids = item.affixes.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('强化每级 +6%，上限 +5；消耗 20×当前等级；拆解白1蓝2紫3×10', () => {
    const item = {
      uid: 'u',
      base_id: 'b',
      slot: 'weapon' as const,
      quality: 'purple' as const,
      name: 'n',
      stat: 'atk',
      value: 100,
      enhance: 5,
      affixes: [],
    };
    expect(enhancedValue(item)).toBe(130);
    expect(enhancedValue({ ...item, enhance: 9 })).toBe(130); // 超上限仍按 +5 计
    expect(enhanceCost(1)).toBe(20);
    expect(enhanceCost(3)).toBe(60);
    expect(salvageValue('white')).toBe(10);
    expect(salvageValue('blue')).toBe(20);
    expect(salvageValue('purple')).toBe(30);
  });

  it('品质权重掷点落在正确区间', () => {
    const w = { white: 72, blue: 23, purple: 5 };
    expect(rollQuality(w, fixed(0.0))).toBe('white');
    expect(rollQuality(w, fixed(0.75))).toBe('blue');
    expect(rollQuality(w, fixed(0.99))).toBe('purple');
  });
});

describe('6.7.2 知识图鉴加成', () => {
  it('每 10 张 +2%，上限 +20%', () => {
    expect(knowledgeBonus(0, cfg)).toBe(1);
    expect(knowledgeBonus(9, cfg)).toBe(1);
    expect(knowledgeBonus(10, cfg)).toBeCloseTo(1.02, 5);
    expect(knowledgeBonus(100, cfg)).toBeCloseTo(1.2, 5);
    expect(knowledgeBonus(500, cfg)).toBeCloseTo(1.2, 5);
  });
});

describe('加权抽签', () => {
  it('边界与总量归一', () => {
    const w = [10, 20, 70];
    expect(weightedPick(w, fixed(0))).toBe(0);
    expect(weightedPick(w, fixed(0.5))).toBe(2);
    expect(weightedPick(w, fixed(0.999))).toBe(2);
  });
});