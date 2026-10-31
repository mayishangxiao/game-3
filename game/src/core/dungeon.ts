/**
 * 副本刷取的纯逻辑 —— 设计书 3.4 / 4.7 / 6.3.4。
 *
 * 副本是「通关后唯一可重复的循环」：不含剧情、纯战斗、可反复刷装备。
 * 保底规则（设计书 6.3.4）：同一副本连续 5 次未出紫装，第 6 次紫装概率 +25%。
 *
 * 本模块不依赖 Phaser，便于单元测试。
 */

import type { DungeonDef, DungeonState, Quality, SaveData } from './types';

/** 保底阈值：连续多少次没出紫，下一次给保底 */
export const PITY_THRESHOLD = 5;
/** 保底加成：白装权重让 25 点给紫装 */
export const PITY_BOOST = 25;

export const DEFAULT_DUNGEON_STATE: DungeonState = { clears: 0, missPurple: 0 };

/** 取某副本的进度（不存在则返回默认值，不写回） */
export function getDungeonState(save: SaveData, dungeonId: string): DungeonState {
  const s = save.dungeons?.[dungeonId];
  return s ? { ...s } : { ...DEFAULT_DUNGEON_STATE };
}

/** 是否已达保底次数 */
export function isPityReady(state: DungeonState): boolean {
  return state.missPurple >= PITY_THRESHOLD;
}

/**
 * 按保底调整品质权重。
 * 未达阈值时原样返回；达到阈值时从白装权重里挪 PITY_BOOST 点到紫装。
 * 若白装权重不足，则按剩余量挪，绝不会产生负权重。
 */
export function pityWeights(
  base: Record<Quality, number>,
  missPurple: number,
): Record<Quality, number> {
  if (missPurple < PITY_THRESHOLD) return { ...base };
  const white = base.white ?? 0;
  const take = Math.min(white, PITY_BOOST);
  return {
    white: white - take,
    blue: base.blue ?? 0,
    purple: (base.purple ?? 0) + take,
  };
}

/** 通关后更新副本进度：clears+1；出紫则清空未出计数 */
export function updateAfterClear(state: DungeonState, gotPurple: boolean): DungeonState {
  return {
    clears: state.clears + 1,
    missPurple: gotPurple ? 0 : state.missPurple + 1,
  };
}

/** 写入存档（原地修改，返回新值以便链式调用） */
export function recordDungeonClear(save: SaveData, dungeonId: string, gotPurple: boolean): DungeonState {
  const next = updateAfterClear(getDungeonState(save, dungeonId), gotPurple);
  if (!save.dungeons) save.dungeons = {};
  save.dungeons[dungeonId] = next;
  return next;
}

/** 副本是否解锁：需要先通关指定的一幕 */
export function dungeonUnlocked(save: SaveData, def: DungeonDef): boolean {
  if (!def.unlock_act) return true;
  return save.achievements.includes(`act_cleared_${def.unlock_act}`);
}

/** 全部副本通关次数之和（用于成就/统计显示） */
export function totalDungeonClears(save: SaveData): number {
  const all = save.dungeons ?? {};
  return Object.values(all).reduce((s, d) => s + (d?.clears ?? 0), 0);
}

/** 首通是否应给独特装备 */
export function shouldGrantUnique(state: DungeonState): boolean {
  return state.clears === 0;
}

/**
 * 结算面板的一句话提示：把「还差几次保底」直接告诉玩家，
 * 让刷取有明确预期，而不是纯碰运气。
 */
export function pityHint(state: DungeonState): string {
  if (isPityReady(state)) return '下一次通关必出紫装品质加成';
  const left = PITY_THRESHOLD - state.missPurple;
  return `再刷 ${left} 次进入紫装保底`;
}