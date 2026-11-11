/**
 * 战斗内切换武器 —— 纯逻辑层（设计书 4.3.8）。
 *
 * 单独拆一个文件的原因：`LevelScene` 是 Phaser 场景，`vitest.config.ts` 跑在 node 环境，
 * import 不了。把「什么时候能开」「背包里哪些武器能换」「换完背包和装备槽长什么样」
 * 「失败了怎么回滚」全放这里，用单测锁死；场景只负责画面板、播提示、把结果喂给 Player。
 *
 * 真值源只有一份：武器手感（射程 / 攻速 / 倍率 / 近远程形态）由
 * `save.equipment.weapon.weapon_ref → cfg.weapons` 决定，和 v1.5 的
 * `LevelScene.applyEquippedWeapon()` 完全同一条链。这里不引入「临时覆盖武器」的
 * 第二套状态，否则回长廊 / 重进关卡后手感会跳回去。
 */

import { compareWithEquipped, enhancedValue, formatStatDelta } from './balance';
import { MELEE_RANGE_MAX } from './constants';
import type { BalanceConfig, ItemBase, ItemInstance, Quality, SaveData } from './types';

/** 拒绝原因。UI 一律走 `SWAP_REJECT_TEXT`，不在场景里散落中文。 */
export type WeaponSwapReject =
  | 'not_combat'
  | 'world_busy'
  | 'player_dead'
  | 'panel_conflict'
  | 'scene_inactive'
  | 'data_missing'
  | 'already_equipped'
  | 'unknown_option'
  | 'weapon_unavailable'
  | 'weapon_ref_invalid'
  | 'bag_full'
  | 'stale_option'
  | 'switch_failed';

export const SWAP_REJECT_TEXT: Record<WeaponSwapReject, string> = {
  not_combat: '只有战斗中才能切换武器',
  world_busy: '当前战斗状态不允许切换武器',
  player_dead: '角色已阵亡，无法切换武器',
  panel_conflict: '切换面板已经打开',
  scene_inactive: '关卡未在运行',
  data_missing: '装备数据未就绪',
  already_equipped: '已经是当前武器',
  unknown_option: '这件武器已不在背包里',
  weapon_unavailable: '该武器配置不存在，暂不可用',
  weapon_ref_invalid: '这件装备没有对应的武器配置',
  bag_full: '背包已满，换下的武器无处存放',
  stale_option: '背包数据已变化，请重新选择',
  switch_failed: '切换失败，已恢复原武器',
};

/** 关卡里算「正在打」的两种模式：普通战斗与护送（护送同样会刷敌人） */
export function isCombatPlayable(mode: string): boolean {
  return mode === 'combat' || mode === 'escort';
}

/**
 * 打开面板前 / 面板开着时每帧都要过一遍的门禁快照。
 * 场景把 Phaser 状态拍平传进来，这里不碰任何引擎对象。
 */
export interface WeaponBagGate {
  mode: string;
  nodeBusy: boolean;
  transitioning: boolean;
  storyFailOpen: boolean;
  dungeonResultOpen: boolean;
  introOpen: boolean;
  upgradeOpen: boolean;
  cardOpen: boolean;
  dialogueActive: boolean;
  playerAlive: boolean;
  sceneActive: boolean;
  scenePaused: boolean;
  cfgLoaded: boolean;
  /** 面板是否已经开着（重复打开） */
  bagOpen: boolean;
}

export interface GateResult {
  ok: boolean;
  reason: WeaponSwapReject | null;
  message: string;
}

/** 持续校验时把 `bagOpen` 置 false 再调一次，就能拿到「该不该自动收起」的答案 */
export function canOpenWeaponBag(g: WeaponBagGate): GateResult {
  const reject = (reason: WeaponSwapReject): GateResult => ({
    ok: false,
    reason,
    message: SWAP_REJECT_TEXT[reason],
  });
  if (!g.sceneActive || g.scenePaused) return reject('scene_inactive');
  if (g.bagOpen) return reject('panel_conflict');
  if (!g.cfgLoaded) return reject('data_missing');
  if (!isCombatPlayable(g.mode)) return reject('not_combat');
  if (!g.playerAlive) return reject('player_dead');
  if (
    g.nodeBusy ||
    g.transitioning ||
    g.storyFailOpen ||
    g.dungeonResultOpen ||
    g.introOpen ||
    g.upgradeOpen ||
    g.cardOpen ||
    g.dialogueActive
  ) {
    return reject('world_busy');
  }
  return { ok: true, reason: null, message: '' };
}

/** 面板上一行：当前已装备的那件 + 背包里的每件武器 */
export interface WeaponOption {
  /** 'equipped:<uid>' / 'bag:<uid>'，面板与键盘选择都用它 */
  id: string;
  uid: string;
  name: string;
  quality: Quality;
  /** 'ATK 15' */
  statText: string;
  /** 相对当前装备的差值，例 'ATK +5 ▲' */
  deltaText: string;
  weaponRef: string | null;
  weaponName: string;
  /** '近战' / '远程' / '—' */
  kindText: string;
  source: 'equipped' | 'bag';
  current: boolean;
  available: boolean;
  reason: WeaponSwapReject | null;
}

/**
 * 老存档（v1.5 之前生成）的 `ItemInstance` 没有 `weapon_ref`，
 * 但模板表里有。按 `base_id` 补一次，让老存档也能换武器而不是全灰。
 */
export function resolveWeaponRef(item: ItemInstance, templates: readonly ItemBase[]): string | null {
  if (item.weapon_ref) return item.weapon_ref;
  return templates.find((t) => t.id === item.base_id)?.weapon_ref ?? null;
}

export function listWeaponOptions(
  save: SaveData,
  cfg: BalanceConfig,
  templates: readonly ItemBase[] = [],
): WeaponOption[] {
  const out: WeaponOption[] = [];
  const bag = Array.isArray(save.bag?.items) ? save.bag.items : [];
  const equipped = save.equipment?.weapon ?? null;

  const describe = (item: ItemInstance): Pick<WeaponOption, 'weaponRef' | 'weaponName' | 'kindText'> => {
    const ref = resolveWeaponRef(item, templates);
    const w = ref ? cfg.weapons?.[ref] : undefined;
    return {
      weaponRef: ref,
      weaponName: w?.name ?? (ref ? '未知武器' : '未配置武器'),
      kindText: w ? (w.range > MELEE_RANGE_MAX ? '远程' : '近战') : '—',
    };
  };

  if (equipped) {
    out.push({
      id: `equipped:${equipped.uid}`,
      uid: equipped.uid,
      name: equipped.name,
      quality: equipped.quality,
      statText: `${equipped.stat.toUpperCase()} ${enhancedValue(equipped)}`,
      deltaText: '当前武器',
      ...describe(equipped),
      source: 'equipped',
      current: true,
      available: false,
      reason: 'already_equipped',
    });
  }

  for (const item of bag) {
    if (item.slot !== 'weapon') continue;
    if (equipped && item.uid === equipped.uid) continue; // 脏存档：同一件不该出现两次
    const d = describe(item);
    const reason: WeaponSwapReject | null = !d.weaponRef
      ? 'weapon_ref_invalid'
      : !cfg.weapons?.[d.weaponRef]
        ? 'weapon_unavailable'
        : null;
    out.push({
      id: `bag:${item.uid}`,
      uid: item.uid,
      name: item.name,
      quality: item.quality,
      statText: `${item.stat.toUpperCase()} ${enhancedValue(item)}`,
      deltaText: formatStatDelta(compareWithEquipped(item, save.equipment ?? {})),
      ...d,
      source: 'bag',
      current: false,
      available: reason === null,
      reason,
    });
  }
  return out;
}

export interface WeaponSwapPlan {
  optionId: string;
  uid: string;
  weaponRef: string;
  weaponName: string;
  deltaText: string;
  item: ItemInstance;
  prev: ItemInstance | null;
}

export type PlanResult =
  | { ok: true; plan: WeaponSwapPlan }
  | { ok: false; reason: WeaponSwapReject; message: string };

/** 只做校验与预算，不改存档；通过后再交给 `commitWeaponSwap` 原子写入。 */
export function planWeaponSwap(
  save: SaveData,
  cfg: BalanceConfig,
  optionId: string,
  templates: readonly ItemBase[] = [],
): PlanResult {
  const reject = (reason: WeaponSwapReject): PlanResult => ({
    ok: false,
    reason,
    message: SWAP_REJECT_TEXT[reason],
  });
  const opt = listWeaponOptions(save, cfg, templates).find((o) => o.id === optionId);
  if (!opt) return reject('unknown_option');
  if (opt.current) return reject('already_equipped');
  if (!opt.available) return reject(opt.reason ?? 'weapon_unavailable');
  if (!opt.weaponRef || !cfg.weapons?.[opt.weaponRef]) return reject('weapon_ref_invalid');

  const bag = Array.isArray(save.bag?.items) ? save.bag.items : [];
  const item = bag.find((i) => i.uid === opt.uid);
  if (!item || item.slot !== 'weapon') return reject('stale_option');

  const prev = save.equipment?.weapon ?? null;
  const slots = Number.isFinite(save.bag?.slots) ? save.bag.slots : 60;
  // 从背包取一件、把换下的那件放回去：净变化 0；但若旧装备已经不在背包（正常情况）
  // 而目标来自别处，可能 +1。这里提前算，避免写了一半才发现放不下。
  const nextLen = bag.length - 1 + (prev && prev.uid !== item.uid ? 1 : 0);
  if (nextLen > slots) return reject('bag_full');

  return {
    ok: true,
    plan: {
      optionId: opt.id,
      uid: opt.uid,
      weaponRef: opt.weaponRef,
      weaponName: opt.weaponName,
      deltaText: opt.deltaText,
      item,
      prev,
    },
  };
}

/** 提交前的内存态快照，`persist()` 抛错时用它把存档恢复成原样 */
export interface WeaponSwapSnapshot {
  weapon: ItemInstance | null;
  bag: ItemInstance[];
  /** 提交时给老存档补过 `weapon_ref` 的那件，回滚时也要把字段还原 */
  refUid: string;
  refBefore: string | undefined;
}

export type CommitResult =
  | { ok: true; item: ItemInstance; prev: ItemInstance | null; snapshot: WeaponSwapSnapshot }
  | { ok: false; reason: WeaponSwapReject; message: string };

export function rollbackWeaponSwap(save: SaveData, snapshot: WeaponSwapSnapshot): void {
  if (!save.bag || !save.equipment) return;
  const target = snapshot.bag.find((i) => i.uid === snapshot.refUid);
  if (target) {
    if (snapshot.refBefore === undefined) delete target.weapon_ref;
    else target.weapon_ref = snapshot.refBefore;
  }
  save.equipment.weapon = snapshot.weapon;
  save.bag.items = snapshot.bag;
}

/**
 * 原子提交：先把所有前置条件复查一遍，再一次写完 `bag.items` 与 `equipment.weapon`。
 * 任何一步异常都走 `rollbackWeaponSwap`，绝不留下「装备换了、背包没换」的半状态。
 */
export function commitWeaponSwap(save: SaveData, plan: WeaponSwapPlan): CommitResult {
  const fail = (reason: WeaponSwapReject): CommitResult => ({
    ok: false,
    reason,
    message: SWAP_REJECT_TEXT[reason],
  });
  if (!save.bag || !Array.isArray(save.bag.items) || !save.equipment) return fail('data_missing');

  const snapshot: WeaponSwapSnapshot = {
    weapon: save.equipment.weapon ?? null,
    bag: save.bag.items.slice(),
    refUid: plan.item.uid,
    refBefore: plan.item.weapon_ref,
  };
  const rollback = (): void => rollbackWeaponSwap(save, snapshot);

  try {
    const curUid = save.equipment.weapon?.uid ?? null;
    const prevUid = plan.prev?.uid ?? null;
    if (curUid !== prevUid) return fail('stale_option');
    const idx = save.bag.items.findIndex((i) => i.uid === plan.uid);
    if (idx < 0 || save.bag.items[idx].slot !== 'weapon') return fail('stale_option');

    const item = save.bag.items[idx];
    const nextBag = save.bag.items.filter((i) => i.uid !== plan.uid);
    if (plan.prev && plan.prev.uid !== item.uid) nextBag.push(plan.prev);
    const slots = Number.isFinite(save.bag.slots) ? save.bag.slots : 60;
    if (nextBag.length > slots) return fail('bag_full');

    // 老存档的实例没有 weapon_ref：补上，让 applyEquippedWeapon() 这次就能换手感，
    // 同时把这件装备的数据一次性修好（后续进关卡也生效）。
    if (!item.weapon_ref) item.weapon_ref = plan.weaponRef;
    save.bag.items = nextBag;
    save.equipment.weapon = item;
    return { ok: true, item, prev: plan.prev, snapshot };
  } catch {
    rollback();
    return fail('switch_failed');
  }
}
