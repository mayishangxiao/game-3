/**
 * 开局武器选择：单一真值（v1.8）。
 *
 * 修复的是「开局拿刀、进局变弓」：`save.weapons` 只是**解锁列表**，不是「选了哪把」。
 * 旧版 `bestWeapon()` 只要列表里有 `wp_bow` 就无条件返回弓；而剧情第 2 波掉的那把猎弓
 * 会在 22px 内自动装备并把 `wp_bow` 写进解锁列表 —— 于是「这一局被换掉」＋「下一局
 * 一进关就是弓」两个现象同时出现。节点奖励解锁武器时也会立刻 `setWeapon()` 覆盖手上武器。
 *
 * 现在把「玩家选了哪把」收敛成一个字段 `save.selected_weapon`：
 *   - 只有玩家在**装备界面 / 战斗内背包**主动切换时才会改（`selectWeapon`）；
 *   - 剧情掉落、节点奖励只调 `unlockWeapon` 把它加进可选池，**绝不改选择**；
 *   - 所有进关 / 换图 / 重试 / 换装路径统一走 `resolveSelectedWeapon()` 这一个解析器。
 *
 * 这个文件是纯逻辑：不碰 Phaser、不碰 DOM、不落盘，规则由 `tests/weaponSelection.test.ts` 钉死。
 */

import type { BalanceConfig, SaveData } from './types';

/** 新存档的开局武器。与 `config.json → weapons` / `SaveManager.createDefaultSave` 保持一致。 */
export const DEFAULT_SELECTED_WEAPON = 'wp_dao';

type WeaponCfg = Pick<BalanceConfig, 'weapons'>;
type SelectionSave = Pick<SaveData, 'weapons' | 'equipment'> & { selected_weapon?: string };

/** id 必须是真实存在的 WeaponDef，脏存档里的野值不能把手上武器变成 undefined。 */
export function isValidWeaponId(id: unknown, cfg: WeaponCfg): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    Object.prototype.hasOwnProperty.call(cfg?.weapons ?? {}, id)
  );
}

/**
 * 解析「当前该拿哪把」。优先级：
 *   1. `selected_weapon`（显式选择，唯一真值）；
 *   2. 武器槽那件装备的 `weapon_ref`（迁移 v1.8 之前的老存档）；
 *   3. 解锁列表第一项（新档是 `wp_dao`）；
 *   4. `wp_dao` 兜底。
 *
 * **刻意不再有「弓优先」这条规则**：解锁过弓不等于玩家想用弓。
 */
export function resolveSelectedWeapon(save: SelectionSave, cfg: WeaponCfg): string {
  if (isValidWeaponId(save.selected_weapon, cfg)) return save.selected_weapon;
  const eqRef = save.equipment?.weapon?.weapon_ref;
  if (isValidWeaponId(eqRef, cfg)) return eqRef;
  const first = (save.weapons ?? []).find((id) => isValidWeaponId(id, cfg));
  if (first) return first;
  return DEFAULT_SELECTED_WEAPON;
}

/** 玩家主动切换武器。返回 false 表示 id 非法，调用方据此回滚。 */
export function selectWeapon(save: SaveData, id: string, cfg: WeaponCfg): boolean {
  if (!isValidWeaponId(id, cfg)) return false;
  save.selected_weapon = id;
  return true;
}

/*
 * 「解锁」不在本模块：`SaveManager.unlockWeapon(data, id)` 已经存在，只往 `data.weapons`
 * 里追加、不碰 `selected_weapon`。剧情掉落 / 节点奖励统一用它，避免两套解锁语义。
 */
