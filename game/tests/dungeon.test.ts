/**
 * 副本刷取逻辑单元测试 —— 对应设计书 3.4 / 4.7 / 6.3.4。
 *
 * 重点验证「保底」这条设计承诺：连续 5 次未出紫，第 6 次紫装概率 +25%。
 * 保底是这个游戏唯一让人愿意重复刷的机制，写错了整套循环就没人玩。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DUNGEON_STATE,
  PITY_BOOST,
  PITY_THRESHOLD,
  dungeonUnlocked,
  getDungeonState,
  isPityReady,
  pityHint,
  pityWeights,
  recordDungeonClear,
  shouldGrantUnique,
  totalDungeonClears,
  updateAfterClear,
} from '../src/core/dungeon';
import { createDefaultSave } from '../src/core/SaveManager';
import config from '../public/data/config.json';
import dungeons from '../public/data/dungeons/dungeons.json';
import type { BalanceConfig, DungeonDef, Quality } from '../src/core/types';

const cfg = config as unknown as BalanceConfig;
const defs = (dungeons as unknown as { dungeons: DungeonDef[] }).dungeons;

/** 用第一个副本自己的品质权重当基准 */
const baseWeights = { ...defs[0].quality_weights } as Record<Quality, number>;

describe('保底阈值', () => {
  it('常量与设计书一致：连续 5 次未出紫触发，加成 25 点', () => {
    expect(PITY_THRESHOLD).toBe(5);
    expect(PITY_BOOST).toBe(25);
  });

  it('未达阈值不算保底', () => {
    for (let i = 0; i < PITY_THRESHOLD; i += 1) {
      expect(isPityReady({ clears: 10, missPurple: i })).toBe(false);
    }
  });

  it('恰好达到阈值即触发', () => {
    expect(isPityReady({ clears: 10, missPurple: PITY_THRESHOLD })).toBe(true);
  });

  it('超过阈值仍然触发（不会因为多刷而失效）', () => {
    expect(isPityReady({ clears: 10, missPurple: PITY_THRESHOLD + 7 })).toBe(true);
  });
});

describe('保底权重调整', () => {
  it('未达阈值时原样返回（且是副本，不改原对象）', () => {
    const out = pityWeights(baseWeights, PITY_THRESHOLD - 1);
    expect(out).toEqual(baseWeights);
    expect(out).not.toBe(baseWeights);
  });

  it('达到阈值时白装减 25、紫装加 25，蓝装不动', () => {
    const out = pityWeights(baseWeights, PITY_THRESHOLD);
    expect(out.white).toBe(baseWeights.white - PITY_BOOST);
    expect(out.purple).toBe(baseWeights.purple + PITY_BOOST);
    expect(out.blue).toBe(baseWeights.blue);
  });

  it('总权重守恒（保底只是挪概率，不是凭空加）', () => {
    const out = pityWeights(baseWeights, PITY_THRESHOLD);
    const sum = (w: Record<Quality, number>) => w.white + w.blue + w.purple;
    expect(sum(out)).toBe(sum(baseWeights));
  });

  it('任何一种品质都不会出现负权重', () => {
    const out = pityWeights(baseWeights, PITY_THRESHOLD + 99);
    expect(out.white).toBeGreaterThanOrEqual(0);
    expect(out.blue).toBeGreaterThanOrEqual(0);
    expect(out.purple).toBeGreaterThanOrEqual(0);
  });

  it('白装权重不足 25 时只挪剩余量，不凭空造权重', () => {
    const thin = { white: 10, blue: 60, purple: 30 } as Record<Quality, number>;
    const out = pityWeights(thin, PITY_THRESHOLD);
    expect(out.white).toBe(0);
    expect(out.purple).toBe(30 + 10);
    expect(out.white + out.blue + out.purple).toBe(thin.white + thin.blue + thin.purple);
  });

  it('保底后紫装概率严格变大（玩家能感知到）', () => {
    const before = pityWeights(baseWeights, 0);
    const after = pityWeights(baseWeights, PITY_THRESHOLD);
    const total = (w: Record<Quality, number>) => w.white + w.blue + w.purple;
    expect(after.purple / total(after)).toBeGreaterThan(before.purple / total(before));
  });
});

describe('通关后进度', () => {
  it('没出紫：clears+1，missPurple+1', () => {
    expect(updateAfterClear({ clears: 3, missPurple: 2 }, false)).toEqual({
      clears: 4,
      missPurple: 3,
    });
  });

  it('出了紫：clears+1，missPurple 归零', () => {
    expect(updateAfterClear({ clears: 3, missPurple: 4 }, true)).toEqual({
      clears: 4,
      missPurple: 0,
    });
  });

  it('连续 5 次不出紫，第 6 次进保底', () => {
    let s = { ...DEFAULT_DUNGEON_STATE };
    for (let i = 0; i < PITY_THRESHOLD; i += 1) {
      s = updateAfterClear(s, false);
      expect(isPityReady(s)).toBe(i + 1 >= PITY_THRESHOLD);
    }
    expect(pityWeights(baseWeights, s.missPurple).purple).toBe(baseWeights.purple + PITY_BOOST);
  });

  it('一旦出紫，保底计数清零重新开始', () => {
    let s = { clears: 0, missPurple: PITY_THRESHOLD };
    s = updateAfterClear(s, true);
    expect(s.missPurple).toBe(0);
    expect(isPityReady(s)).toBe(false);
  });
});

describe('存档读写', () => {
  it('未通关过的副本返回默认值，且不写回存档', () => {
    const save = createDefaultSave(cfg);
    const st = getDungeonState(save, 'dg01_alley');
    expect(st).toEqual(DEFAULT_DUNGEON_STATE);
    expect(save.dungeons['dg01_alley']).toBeUndefined();
  });

  it('getDungeonState 返回副本，外部修改不影响存档', () => {
    const save = createDefaultSave(cfg);
    save.dungeons['dg01_alley'] = { clears: 2, missPurple: 1 };
    const st = getDungeonState(save, 'dg01_alley');
    st.clears = 99;
    expect(save.dungeons['dg01_alley'].clears).toBe(2);
  });

  it('recordDungeonClear 写入存档并返回新状态', () => {
    const save = createDefaultSave(cfg);
    const st = recordDungeonClear(save, 'dg01_alley', false);
    expect(st).toEqual({ clears: 1, missPurple: 1 });
    expect(save.dungeons['dg01_alley']).toEqual({ clears: 1, missPurple: 1 });
  });

  it('缺 dungeons 字段的老存档也能写入（不抛错）', () => {
    const save = createDefaultSave(cfg);
    delete (save as { dungeons?: unknown }).dungeons;
    const st = recordDungeonClear(save, 'dg03_dock', true);
    expect(st).toEqual({ clears: 1, missPurple: 0 });
    expect(save.dungeons?.['dg03_dock']).toEqual({ clears: 1, missPurple: 0 });
  });

  it('totalDungeonClears 累加所有副本', () => {
    const save = createDefaultSave(cfg);
    expect(totalDungeonClears(save)).toBe(0);
    recordDungeonClear(save, 'dg01_alley', false);
    recordDungeonClear(save, 'dg01_alley', false);
    recordDungeonClear(save, 'dg02_bandit', true);
    expect(totalDungeonClears(save)).toBe(3);
  });

  it('默认存档自带 scrap 与 dungeons 字段', () => {
    const save = createDefaultSave(cfg);
    expect(save.dungeons).toEqual({});
    expect(typeof save.scrap).toBe('number');
  });
});

describe('解锁与首通奖励', () => {
  const def = defs[0];

  it('未通关对应幕时副本上锁', () => {
    const save = createDefaultSave(cfg);
    expect(dungeonUnlocked(save, def)).toBe(false);
  });

  it('通关对应幕的成就存在时解锁', () => {
    const save = createDefaultSave(cfg);
    save.achievements.push(`act_cleared_${def.unlock_act}`);
    expect(dungeonUnlocked(save, def)).toBe(true);
  });

  it('别的幕成就不能解锁这个副本', () => {
    const save = createDefaultSave(cfg);
    save.achievements.push('act_cleared_ch00_act9');
    expect(dungeonUnlocked(save, def)).toBe(false);
  });

  it('unlock_act 为空的副本默认开放', () => {
    const save = createDefaultSave(cfg);
    expect(dungeonUnlocked(save, { ...def, unlock_act: '' })).toBe(true);
  });

  it('首通（0 次通关）才给独特装备，之后不再给', () => {
    expect(shouldGrantUnique({ clears: 0, missPurple: 0 })).toBe(true);
    expect(shouldGrantUnique({ clears: 1, missPurple: 1 })).toBe(false);
    expect(shouldGrantUnique({ clears: 9, missPurple: 0 })).toBe(false);
  });
});

describe('结算提示', () => {
  it('离保底还有几次要说清楚', () => {
    expect(pityHint({ clears: 0, missPurple: 0 })).toContain(String(PITY_THRESHOLD));
    expect(pityHint({ clears: 0, missPurple: 3 })).toContain('2');
  });

  it('已进保底时提示改为「下一次有加成」', () => {
    const hint = pityHint({ clears: 0, missPurple: PITY_THRESHOLD });
    expect(hint).toContain('紫装');
    expect(hint).not.toContain(String(PITY_THRESHOLD));
  });
});