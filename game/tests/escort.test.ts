/**
 * core/escort.ts —— 护送完成门禁。
 *
 * 甲方截图：「天京经营这一幕怎么闪一下就没了」。根因是切节点的 async 窗口里
 * 旧的护送完成判定二次命中，把刚进场的经营节点直接标记完成。
 * 这里把「只有本节点真的在护送、且只结算一次」钉死。
 */

import { describe, expect, it } from 'vitest';
import { canCompleteEscort, type EscortGate } from '../src/core/escort';

const atGoal: EscortGate = {
  mode: 'escort',
  nodeMode: 'escort',
  transitioning: false,
  nodeBusy: false,
  goalX: 432,
  playerX: 436,
  allyCount: 3,
};

describe('canCompleteEscort', () => {
  it('玩家抵达终点、战士还在册 → 允许结算', () => {
    expect(canCompleteEscort(atGoal)).toBe(true);
  });

  it('还没到终点 → 不结算', () => {
    expect(canCompleteEscort({ ...atGoal, playerX: 200 })).toBe(false);
  });

  it('切节点中（startNode 的 await 窗口）→ 不结算', () => {
    expect(canCompleteEscort({ ...atGoal, transitioning: true })).toBe(false);
  });

  it('本节点已经结算过 / 还没就绪 → 不重复结算', () => {
    expect(canCompleteEscort({ ...atGoal, nodeBusy: true })).toBe(false);
  });

  it('节点数据已切到下一幕，但 mode 还残留 escort → 不结算', () => {
    expect(canCompleteEscort({ ...atGoal, nodeMode: 'management' })).toBe(false);
    expect(canCompleteEscort({ ...atGoal, nodeMode: undefined })).toBe(false);
  });

  it('mode 已经不是护送 → 不结算', () => {
    expect(canCompleteEscort({ ...atGoal, mode: 'management' })).toBe(false);
  });

  it('护送对象已被 clearAllies 收走 → 不结算（旧版正是在这里报出 0/0）', () => {
    expect(canCompleteEscort({ ...atGoal, allyCount: 0 })).toBe(false);
  });

  it('终点还没初始化（goalX = 0）→ 不结算', () => {
    expect(canCompleteEscort({ ...atGoal, goalX: 0, playerX: 0 })).toBe(false);
  });

  it('真实串幕现场：切换中 + 节点已换 + 战士清空 + 旧坐标仍在终点', () => {
    expect(
      canCompleteEscort({
        mode: 'escort',
        nodeMode: 'management',
        transitioning: true,
        nodeBusy: false,
        goalX: 432,
        playerX: 436,
        allyCount: 0,
      }),
    ).toBe(false);
  });
});
