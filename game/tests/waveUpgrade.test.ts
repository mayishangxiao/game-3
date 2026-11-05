/**
 * 波次强化规则的单元测试（纯逻辑，node 环境）。
 *
 * 这些用例挡的是「强化算错」这类**在浏览器里只会表现为手感不对**的问题：
 * 弹幕行数错一行、射速乘错、或者满级之后还一直弹卡，截图里全都看不出来。
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_UPGRADE_PICKS,
  WAVE_UPGRADES,
  VOLLEY_SPREAD_PX,
  applyUpgrade,
  bonusPierce,
  describeNext,
  emptyUpgradeState,
  hasteMult,
  pickUpgradeChoices,
  upgradeSummary,
  upgradesExhausted,
  volleyOffsets,
  volleyRows,
  type UpgradeState,
} from '../src/core/waveUpgrade';

/** 固定顺序的伪随机：总是返回同一个值，测试里只关心「池子内容」时会用到 */
const rngZero = () => 0;

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