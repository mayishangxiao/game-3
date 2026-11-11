/**
 * 波次强化规则的单元测试（纯逻辑，node 环境）。
 *
 * 这些用例挡的是「强化算错」这类**在浏览器里只会表现为手感不对**的问题：
 * 弹幕行数错一行、射速乘错、或者满级之后还一直弹卡，截图里全都看不出来。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WAVE_UPGRADE_TUNING,
  MAX_UPGRADE_PICKS,
  MELEE_UPGRADES,
  UpgradeBook,
  WAVE_UPGRADES,
  VOLLEY_SPREAD_PX,
  applyUpgrade,
  bonusPierce,
  cleaveDmgMult,
  describeNext,
  emptyUpgradeState,
  hasteMult,
  pickUpgradeChoices,
  sweepArcMult,
  upgradeClass,
  upgradeDefs,
  upgradeSummary,
  upgradesExhausted,
  volleyOffsets,
  volleyRows,
  type UpgradeState,
} from '../src/core/waveUpgrade';
import { MELEE_RANGE_MAX } from '../src/core/constants';

/** 固定顺序的伪随机：总是返回同一个值，测试里只关心「池子内容」时会用到 */
const rngZero = () => 0;

/** 配置里的真实武器表：用数据本身验「所有近战武器类型都被覆盖」，不写死白名单 */
const cfg = JSON.parse(readFileSync(join(process.cwd(), 'public/data/config.json'), 'utf8')) as {
  weapons: Record<string, { id: string; range: number }>;
  wave_upgrade: typeof DEFAULT_WAVE_UPGRADE_TUNING;
};

describe('波次强化：初始状态', () => {
  it('空状态是单发弓、无射速加成、无穿透', () => {
    const s = emptyUpgradeState();
    expect(volleyRows(s)).toBe(1);
    expect(hasteMult(s)).toBe(1);
    expect(bonusPierce(s)).toBe(0);
    expect(upgradeSummary(s)).toBe('');
  });

  it('一关最多选几次 = 各条目满级之和（2 + 3 + 1 = 6）', () => {
    expect(MAX_UPGRADE_PICKS).toBe(6);
  });
});

describe('波次强化：各条目的数值', () => {
  it('齐射：1 级 2 行、2 级 3 行，再往上封顶 3 行', () => {
    const s = emptyUpgradeState();
    expect(volleyRows({ ...s, volley: 1 })).toBe(2);
    expect(volleyRows({ ...s, volley: 2 })).toBe(3);
    // 数据里不会给出 3 级，但防御性地封顶：万一被脚本刷过头也不该变成 4 行
    expect(volleyRows({ ...s, volley: 9 })).toBe(3);
  });

  it('火线：每级 +8%，三级是 ×1.24', () => {
    const s = emptyUpgradeState();
    expect(hasteMult({ ...s, haste: 1 })).toBeCloseTo(1.08, 5);
    expect(hasteMult({ ...s, haste: 2 })).toBeCloseTo(1.16, 5);
    expect(hasteMult({ ...s, haste: 3 })).toBeCloseTo(1.24, 5);
    expect(hasteMult({ ...s, haste: 5 })).toBeCloseTo(1.24, 5);
  });

  it('穿透：最多 +1', () => {
    const s = emptyUpgradeState();
    expect(bonusPierce({ ...s, pierce: 1 })).toBe(1);
    expect(bonusPierce({ ...s, pierce: 3 })).toBe(1);
  });
});

describe('波次强化：齐射要真的分开', () => {
  it('1 行只有正中一支，2 行对称错开，3 行是 -7 / 0 / +7', () => {
    expect(volleyOffsets(1)).toEqual([0]);
    const two = volleyOffsets(2);
    expect(two.length).toBe(2);
    expect(two[0] + two[1]).toBeCloseTo(0, 5);
    expect(volleyOffsets(3)).toEqual([-VOLLEY_SPREAD_PX, 0, VOLLEY_SPREAD_PX]);
  });

  it('间距小于箭矢的判定半径 16px，否则多出来的箭会空放', () => {
    for (const o of volleyOffsets(3)) expect(Math.abs(o)).toBeLessThan(16);
  });
});

describe('波次强化：候选池', () => {
  it('开局三个候选全在池子里', () => {
    const picks = pickUpgradeChoices(emptyUpgradeState(), rngZero);
    expect(picks.map((p) => p.id).sort()).toEqual(['haste', 'pierce', 'volley']);
  });

  it('满级的条目不再出现', () => {
    const s: UpgradeState = { ...emptyUpgradeState(), pierce: 1 };
    const picks = pickUpgradeChoices(s, rngZero);
    expect(picks.map((p) => p.id)).not.toContain('pierce');
    expect(picks.length).toBe(2);
  });

  it('池子被抽干后返回空数组（场景据此不再弹卡）', () => {
    const full: UpgradeState = { volley: 2, haste: 3, pierce: 1, picked: 6 };
    expect(upgradesExhausted(full)).toBe(true);
    expect(pickUpgradeChoices(full, rngZero)).toEqual([]);
  });

  it('同一状态下多次抽，只会换顺序、不会换内容', () => {
    const s = emptyUpgradeState();
    const a = pickUpgradeChoices(s, rngZero).map((p) => p.id).sort();
    const b = pickUpgradeChoices(s, () => 0.99).map((p) => p.id).sort();
    expect(a).toEqual(b);
  });
});

describe('波次强化：选择与摘要', () => {
  it('applyUpgrade 不改原对象', () => {
    const s = emptyUpgradeState();
    const t = applyUpgrade(s, 'volley');
    expect(s.volley).toBe(0);
    expect(t.volley).toBe(1);
    expect(t.picked).toBe(1);
  });

  it('满级后继续点不会超过上限（连点 / 键盘重复触发）', () => {
    let s = emptyUpgradeState();
    for (let i = 0; i < 5; i++) s = applyUpgrade(s, 'pierce');
    expect(s.pierce).toBe(1);
  });

  it('卡片描述写的是「升级之后」的结果，不是增量', () => {
    const s = emptyUpgradeState();
    expect(describeNext(s, 'volley')).toContain('2 行');
    expect(describeNext({ ...s, volley: 1 }, 'volley')).toContain('3 行');
    expect(describeNext(s, 'pierce')).toContain('再穿过 1 个');
  });

  it('摘要按选过的项目拼，没选过的项目不出现', () => {
    const s: UpgradeState = { volley: 1, haste: 0, pierce: 1, picked: 2 };
    const text = upgradeSummary(s);
    expect(text).toContain('齐射 2 行');
    expect(text).toContain('穿透 +1');
    expect(text).not.toContain('射速');
  });

  it('三条强化的名字与描述都不为空（卡片上不能出现空按钮）', () => {
    for (const u of WAVE_UPGRADES) {
      expect(u.name.trim().length).toBeGreaterThan(0);
      expect(u.desc.trim().length).toBeGreaterThan(0);
      expect(u.maxLevel).toBeGreaterThan(0);
    }
  });
});

/* ==================== v1.7：近战武器补齐同类强化 ==================== */

describe('近战强化：类别判定覆盖所有近战武器', () => {
  it('config.json 里每一把 range ≤ 60 的武器都会拿到 melee 强化', () => {
    const melee = Object.values(cfg.weapons).filter((w) => w.range <= MELEE_RANGE_MAX);
    // 用数据本身当清单，而不是在测试里写死白名单：以后配置新增近战会自动进这条断言
    expect(melee.map((w) => w.id).sort()).toEqual(['wp_crowbar', 'wp_dao']);
    for (const w of melee) expect(upgradeClass(w), `${w.id} 没被判成近战`).toBe('melee');
  });

  it('弓仍按 id 判定，其它远程不参与强化', () => {
    expect(upgradeClass(cfg.weapons.wp_bow)).toBe('bow');
    expect(upgradeClass(cfg.weapons.wp_matchlock)).toBe('other');
    expect(upgradeClass(cfg.weapons.wp_mg)).toBe('other');
  });

  it('两类用同一组 id / 同一组满级上限 / 同一个 6 次上限', () => {
    expect(MELEE_UPGRADES.map((u) => [u.id, u.maxLevel])).toEqual(
      WAVE_UPGRADES.map((u) => [u.id, u.maxLevel]),
    );
    expect(MELEE_UPGRADES.reduce((s, u) => s + u.maxLevel, 0)).toBe(MAX_UPGRADE_PICKS);
    expect(upgradeDefs('melee')).toBe(MELEE_UPGRADES);
    expect(upgradeDefs('bow')).toBe(WAVE_UPGRADES);
  });

  it('config.json 的数值与纯逻辑默认值逐字段一致', () => {
    expect(cfg.wave_upgrade).toEqual(DEFAULT_WAVE_UPGRADE_TUNING);
    expect(cfg.wave_upgrade.max_picks).toBe(MAX_UPGRADE_PICKS);
    expect(VOLLEY_SPREAD_PX).toBe(cfg.wave_upgrade.volley.spread_px);
  });
});

describe('近战强化：效果与弓共用同一条曲线', () => {
  const s = emptyUpgradeState();

  it('0 级时所有倍率都是 1 —— 近战基础手感一字不变', () => {
    expect(sweepArcMult(s)).toBe(1);
    expect(cleaveDmgMult(s)).toBe(1);
    expect(hasteMult(s)).toBe(1);
    expect(volleyOffsets(1)).toEqual([0]);
  });

  it('横扫：复用齐射的 1/2/3 档 → ×1.00 / ×1.25 / ×1.50，越界封顶', () => {
    expect(sweepArcMult({ ...s, volley: 1 })).toBeCloseTo(1.25, 5);
    expect(sweepArcMult({ ...s, volley: 2 })).toBeCloseTo(1.5, 5);
    expect(sweepArcMult({ ...s, volley: 9 })).toBeCloseTo(1.5, 5);
  });

  it('破甲：满级挥砍伤害 ×1.25，连点不叠加', () => {
    expect(cleaveDmgMult({ ...s, pierce: 1 })).toBeCloseTo(1.25, 5);
    expect(cleaveDmgMult({ ...s, pierce: 5 })).toBeCloseTo(1.25, 5);
  });

  it('火线：近战与弓共用 hasteMult，三级仍为 ×1.24', () => {
    expect(hasteMult({ ...s, haste: 3 })).toBeCloseTo(1.24, 5);
    expect(upgradeSummary({ ...s, haste: 3 }, 'melee')).toContain('×1.24');
  });

  it('换配置就能改数值（横扫 / 破甲 / 攻速 / 箭矢间距都从 tuning 读）', () => {
    const tune = {
      ...DEFAULT_WAVE_UPGRADE_TUNING,
      haste_per_level: 0.1,
      volley: { spread_px: 10, damage_per_row: 0.5 },
      melee: { sweep_arc_per_row: 0.5, cleave_damage: 0.4 },
    };
    expect(sweepArcMult({ ...s, volley: 1 }, tune)).toBeCloseTo(1.5, 5);
    expect(cleaveDmgMult({ ...s, pierce: 1 }, tune)).toBeCloseTo(1.4, 5);
    expect(hasteMult({ ...s, haste: 1 }, tune)).toBeCloseTo(1.1, 5);
    expect(volleyOffsets(3, tune)).toEqual([-10, 0, 10]);
  });
});

describe('近战强化：卡片文案与摘要', () => {
  const s = emptyUpgradeState();

  it('近战候选来自近战表，弓候选仍来自弓表，id 集合相同', () => {
    const m = pickUpgradeChoices(s, rngZero, 'melee');
    const b = pickUpgradeChoices(s, rngZero, 'bow');
    expect(m.map((u) => u.id).sort()).toEqual(b.map((u) => u.id).sort());
    for (const u of m) expect(MELEE_UPGRADES.includes(u)).toBe(true);
    for (const u of b) expect(WAVE_UPGRADES.includes(u)).toBe(true);
  });

  it('满级条目同样退出近战候选池，抽干后返回空数组', () => {
    const half: UpgradeState = { ...s, pierce: 1 };
    expect(pickUpgradeChoices(half, rngZero, 'melee').map((u) => u.id)).not.toContain('pierce');
    expect(pickUpgradeChoices({ volley: 2, haste: 3, pierce: 1, picked: 6 }, rngZero, 'melee')).toEqual([]);
  });

  it('卡片描述写「升级之后」的结果；近战不写死每秒次数（撬棍攻速不是 1.67）', () => {
    expect(describeNext(s, 'volley', 'melee')).toContain('1.25');
    expect(describeNext(s, 'haste', 'melee')).toContain('1.08');
    expect(describeNext(s, 'haste', 'melee')).not.toContain('每秒');
    expect(describeNext(s, 'pierce', 'melee')).toContain('1.25');
    // 弓的原文案不受影响
    expect(describeNext(s, 'volley')).toContain('2 行');
    expect(describeNext(s, 'haste')).toContain('每秒');
  });

  it('近战摘要与弓摘要各说各的，不会串成「齐射」', () => {
    const full: UpgradeState = { volley: 1, haste: 2, pierce: 1, picked: 4 };
    const m = upgradeSummary(full, 'melee');
    expect(m).toContain('横扫 ×1.25');
    expect(m).toContain('攻速 ×1.16');
    expect(m).toContain('伤害 ×1.25');
    expect(m).not.toContain('齐射');
    expect(upgradeSummary(full)).toContain('齐射 2 行');
    expect(upgradeSummary(s, 'melee')).toBe('');
  });
});

describe('近战强化：不同武器实例状态独立、上限与重置一致', () => {
  const A = 'uid:eq_wp_dao_white_01';
  const B = 'uid:eq_wp_dao_bandit_blue_01';
  const C = 'uid:eq_wp_bow_white_01';

  it('同一 ref 的两件装备各自累积，互不带走', () => {
    const book = new UpgradeBook();
    book.pick(A, 'volley');
    book.pick(A, 'volley');
    expect(book.get(A).volley).toBe(2);
    expect(book.get(B).volley).toBe(0);
    expect(book.get(B).picked).toBe(0);
    expect(book.get(C).picked).toBe(0);
    expect(book.size).toBe(1);
  });

  it('每个实例都各自封顶 6 次，连点不会灌进别人的状态', () => {
    const book = new UpgradeBook();
    const ids = ['volley', 'haste', 'pierce'] as const;
    for (let i = 0; i < 20; i++) book.pick(A, ids[i % 3]);
    expect(upgradesExhausted(book.get(A))).toBe(true);
    expect(book.get(A).volley).toBe(2);
    expect(book.get(A).haste).toBe(3);
    expect(book.get(A).pierce).toBe(1);
    expect(book.get(A).picked).toBeLessThanOrEqual(MAX_UPGRADE_PICKS);
    expect(book.get(B).picked).toBe(0);
    expect(book.get(C).picked).toBe(0);
  });

  it('pick 返回新状态、不改旧对象；snapshot 是副本', () => {
    const book = new UpgradeBook();
    const before = book.get(A);
    const after = book.pick(A, 'haste');
    expect(before.haste).toBe(0);
    expect(after.haste).toBe(1);
    const snap = book.snapshot();
    snap[A].haste = 99;
    expect(book.get(A).haste).toBe(1);
  });

  it('clear 一次清空全部实例（换关 / 重进关卡）', () => {
    const book = new UpgradeBook();
    book.pick(A, 'volley');
    book.pick(B, 'haste');
    book.pick(C, 'pierce');
    expect(book.size).toBe(3);
    book.clear();
    expect(book.size).toBe(0);
    for (const k of [A, B, C]) {
      expect(book.get(k)).toEqual(emptyUpgradeState());
      expect(upgradesExhausted(book.get(k))).toBe(false);
    }
  });
});