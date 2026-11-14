/**
 * 波次强化三选一的**选择状态机**（v1.8.6）。
 *
 * 甲方反馈「玩家快速点击时误选、且不清楚已选内容」，根因是旧版把「点一张卡」
 * 和「提交结果」合成了一步：pointerdown 直接 applyUpgrade + 关界面 + 推下一波，
 * 手指一抖就把还没看清的强化定死了。
 *
 * 现在拆成两步：
 *   点选 / 数字键  →  只记录 selected，**不生效、不结算、不关闭界面**；
 *   确认键         →  把当前明确选中的那一项提交为最终结果并关闭。
 *
 * 这个文件不 import Phaser、不碰 DOM、不碰存档，只描述状态迁移，
 * 全部规则在 node 环境用 `tests/upgradeSelection.test.ts` 钉死。
 * 数值、卡池、上限、按武器实例隔离等**其它强化逻辑一律不在这里**，仍归 `waveUpgrade.ts`。
 */
import type { UpgradeId } from './waveUpgrade';

export interface UpgradeSelection {
  /** 当前明确选中的强化；`null` = 未选择 / 已取消 */
  selected: UpgradeId | null;
  /** 选择界面是否还开着；只有「确认」或「放弃」才会关 */
  open: boolean;
  /** 最终生效的强化；`null` = 尚未确认或主动放弃 */
  committed: UpgradeId | null;
}

export function emptySelection(): UpgradeSelection {
  return { selected: null, open: true, committed: null };
}

/**
 * 点一张卡：只改选中项。
 * 再点已选中的那张 = 取消选择（给玩家一个明确的反悔入口），
 * 点另一张 = 切换。无论连点多少次都不会写 committed、不会关界面。
 */
export function selectUpgrade(cur: UpgradeSelection, id: UpgradeId): UpgradeSelection {
  if (!cur.open) return cur;
  return { ...cur, selected: cur.selected === id ? null : id };
}

/** 显式取消选择；界面保持打开，玩家还能重新选。 */
export function cancelUpgrade(cur: UpgradeSelection): UpgradeSelection {
  if (!cur.open) return cur;
  return { ...cur, selected: null };
}

/** 未选中时不允许确认（点确认只应给提示，不能偷偷替玩家选一项）。 */
export function canConfirm(cur: UpgradeSelection): boolean {
  return cur.open && cur.selected !== null;
}

/**
 * 确认：唯一的「生效入口」。
 * 只有「界面还开着且已明确选中」才提交，返回 `open:false, committed:selected`。
 * 已关闭 / 未选中时原样返回，配合 `canConfirm()` 让 UI 判断是否提示。
 */
export function confirmUpgrade(cur: UpgradeSelection): UpgradeSelection {
  if (!canConfirm(cur)) return cur;
  return { selected: cur.selected, open: false, committed: cur.selected };
}

/** 放弃强化：关闭界面但不提交任何项（保留旧版「不想强化也能继续打」）。 */
export function skipUpgrade(cur: UpgradeSelection): UpgradeSelection {
  if (!cur.open) return cur;
  return { ...cur, open: false, committed: null };
}
