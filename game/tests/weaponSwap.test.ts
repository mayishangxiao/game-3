/**
 * 战斗内切换武器（设计书 4.3.8）纯逻辑单测。
 *
 * 场景侧的冻结、面板、Phaser 显示对象由 E2E 探针覆盖；这里锁的是
 * 「什么时候不许切」「哪些武器不可用」「切换失败会不会留下半状态」——
 * 这些分支靠真机点很难稳定复现，必须是机器断言。
 */

import { describe, expect, it } from 'vitest';
import config from '../public/data/config.json';
import itemsBaseJson from '../public/data/equipment/items_base.json';
import { createDefaultSave } from '../src/core/SaveManager';
import {
  SWAP_REJECT_TEXT,
  canOpenWeaponBag,
  commitWeaponSwap,
  isCombatPlayable,
  listWeaponOptions,
  planWeaponSwap,
  resolveWeaponRef,
  rollbackWeaponSwap,
  type WeaponBagGate,
} from '../src/core/weaponSwap';
import type { BalanceConfig, ItemBase, ItemInstance, SaveData } from '../src/core/types';

const cfg = config as unknown as BalanceConfig;
const templates = (itemsBaseJson as unknown as { items: ItemBase[] }).items;

function item(over: Partial<ItemInstance> = {}): ItemInstance {
  return {
    uid: 'u1',
    base_id: 'eq_wp_dao_white_01',
    slot: 'weapon',
    quality: 'white',
    name: '腰刀',
    stat: 'atk',
    value: 12,
    enhance: 0,
    affixes: [],
    weapon_ref: 'wp_dao',
    ...over,
  };
}

function save(over: Partial<SaveData> = {}): SaveData {
  const s = createDefaultSave(cfg);
  s.equipment = { weapon: null, head: null, body: null, legs: null, accessory: null };
  s.bag = { slots: 60, items: [] };
  return Object.assign(s, over);
}

const OK_GATE: WeaponBagGate = {
  mode: 'combat',
  nodeBusy: false,
  transitioning: false,
  storyFailOpen: false,
  dungeonResultOpen: false,
  introOpen: false,
  upgradeOpen: false,
  cardOpen: false,
  dialogueActive: false,
  playerAlive: true,
  sceneActive: true,
  scenePaused: false,
  cfgLoaded: true,
  bagOpen: false,
};

describe('打开面板的门禁', () => {
  it('正常战斗中允许打开', () => {
    expect(canOpenWeaponBag(OK_GATE)).toEqual({ ok: true, reason: null, message: '' });
  });

  it('护送关也是战斗，探索 / 过场 / 抉择 / 经营一律拒绝', () => {
    expect(isCombatPlayable('combat')).toBe(true);
    expect(isCombatPlayable('escort')).toBe(true);
    for (const mode of ['explore', 'cutscene', 'choice', 'management']) {
      expect(canOpenWeaponBag({ ...OK_GATE, mode }).reason).toBe('not_combat');
    }
    expect(canOpenWeaponBag({ ...OK_GATE, mode: 'escort' }).ok).toBe(true);
  });

  it('世界忙 / 面板冲突 / 面板类状态各自给出对应原因', () => {
    const busy = [
      'nodeBusy',
      'transitioning',
      'storyFailOpen',
      'dungeonResultOpen',
      'introOpen',
      'upgradeOpen',
      'cardOpen',
      'dialogueActive',
    ] as const;
    for (const key of busy) {
      expect(canOpenWeaponBag({ ...OK_GATE, [key]: true }).reason).toBe('world_busy');
    }
    expect(canOpenWeaponBag({ ...OK_GATE, bagOpen: true }).reason).toBe('panel_conflict');
    expect(canOpenWeaponBag({ ...OK_GATE, playerAlive: false }).reason).toBe('player_dead');
    expect(canOpenWeaponBag({ ...OK_GATE, sceneActive: false }).reason).toBe('scene_inactive');
    expect(canOpenWeaponBag({ ...OK_GATE, scenePaused: true }).reason).toBe('scene_inactive');
    expect(canOpenWeaponBag({ ...OK_GATE, cfgLoaded: false }).reason).toBe('data_missing');
  });

  it('每个拒绝原因都有中文文案，且面板已开时不会误报 world_busy', () => {
    for (const k of Object.keys(SWAP_REJECT_TEXT)) {
      expect(SWAP_REJECT_TEXT[k as keyof typeof SWAP_REJECT_TEXT].length).toBeGreaterThan(0);
    }
    // 面板开着做持续校验时调用方会把 bagOpen 置 false，此时应仍然 ok
    expect(canOpenWeaponBag({ ...OK_GATE, bagOpen: false }).ok).toBe(true);
  });
});

describe('背包里的可用武器列表', () => {
  it('当前装备排第一且标成不可重复选择，背包武器带属性差值', () => {
    const s = save();
    const cur = item({ uid: 'cur', name: '腰刀', value: 12 });
    const bow = item({ uid: 'bow', base_id: 'eq_wp_bow_blue_01', name: '虎门猎弓', quality: 'blue', value: 15, weapon_ref: 'wp_bow' });
    s.equipment.weapon = cur;
    s.bag.items = [bow, item({ uid: 'other', slot: 'head', name: '布巾', stat: 'def', value: 4, weapon_ref: undefined })];

    const opts = listWeaponOptions(s, cfg, templates);
    expect(opts).toHaveLength(2);
    expect(opts[0]).toMatchObject({ id: 'equipped:cur', current: true, available: false, reason: 'already_equipped' });
    expect(opts[1]).toMatchObject({ id: 'bag:bow', available: true, weaponRef: 'wp_bow', weaponName: '猎弓', kindText: '远程' });
    expect(opts[1].deltaText).toBe('ATK +3 ▲');
  });

  it('老存档实例没有 weapon_ref 时按 base_id 从模板表补齐', () => {
    const s = save();
    const legacy = item({ uid: 'legacy', weapon_ref: undefined });
    expect(resolveWeaponRef(legacy, templates)).toBe('wp_dao');
    s.bag.items = [legacy];
    expect(listWeaponOptions(s, cfg, templates)[0]).toMatchObject({ available: true, weaponRef: 'wp_dao' });
    // 不传模板表才判「不可用」，这条是明确的降级边界
    expect(listWeaponOptions(s, cfg)[0].reason).toBe('weapon_ref_invalid');
  });

  it('配置里没有的武器、没有 ref 的装备都标灰且给出原因', () => {
    const s = save();
    s.bag.items = [
      item({ uid: 'bad', weapon_ref: 'wp_not_exist' }),
      item({ uid: 'none', weapon_ref: undefined }),
    ];
    const opts = listWeaponOptions(s, cfg);
    expect(opts.map((o) => o.reason)).toEqual(['weapon_unavailable', 'weapon_ref_invalid']);
    expect(opts.every((o) => !o.available)).toBe(true);
  });

  it('背包为空时只有「无武器」的提示空间，脏存档的重复 uid 不出现两次', () => {
    const s = save();
    expect(listWeaponOptions(s, cfg, templates)).toHaveLength(0);
    s.equipment.weapon = item({ uid: 'dup' });
    s.bag.items = [item({ uid: 'dup' })];
    expect(listWeaponOptions(s, cfg, templates)).toHaveLength(1);
  });

  it('当前装备为空槽时，背包武器差值等于整件净加成', () => {
    const s = save();
    s.bag.items = [item({ uid: 'bow', value: 13, weapon_ref: 'wp_bow' })];
    expect(listWeaponOptions(s, cfg, templates)[0].deltaText).toBe('ATK +13 ▲');
  });
});

describe('切换计划', () => {
  it('正常生成计划，且不改存档（纯函数）', () => {
    const s = save();
    s.equipment.weapon = item({ uid: 'cur', value: 12 });
    s.bag.items = [item({ uid: 'bow', value: 15, weapon_ref: 'wp_bow' })];
    const before = JSON.stringify(s);
    const r = planWeaponSwap(s, cfg, 'bag:bow', templates);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan).toMatchObject({ uid: 'bow', weaponRef: 'wp_bow', weaponName: '猎弓' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('重复选择当前武器 / 未知项 / 不可用武器 / 数据漂移全部拒绝', () => {
    const s = save();
    s.equipment.weapon = item({ uid: 'cur' });
    // base_id 不在模板表里：即使允许按模板补 ref，也补不出来 → 明确判「不可用」
    s.bag.items = [item({ uid: 'broken', base_id: 'eq_wp_unknown', weapon_ref: undefined })];
    expect(planWeaponSwap(s, cfg, 'equipped:cur', templates)).toMatchObject({ ok: false, reason: 'already_equipped' });
    expect(planWeaponSwap(s, cfg, 'bag:gone', templates)).toMatchObject({ ok: false, reason: 'unknown_option' });
    expect(planWeaponSwap(s, cfg, 'bag:broken', templates)).toMatchObject({ ok: false, reason: 'weapon_ref_invalid' });
  });

  it('容量校验：换下的武器放不回背包时拒绝（不产生半状态）', () => {
    // 正常换装是「取出一件、放回一件」，净变化 0；这条挡的是容量为 0 / 脏存档
    // 这类边界，保证 commit 绝不在放不下时把装备槽先改掉。
    const s = save();
    s.equipment.weapon = item({ uid: 'cur' });
    s.bag.items = [item({ uid: 'bow', weapon_ref: 'wp_bow' })];
    s.bag.slots = 0;
    const before = JSON.stringify(s);
    expect(planWeaponSwap(s, cfg, 'bag:bow', templates)).toMatchObject({ ok: false, reason: 'bag_full' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('计划与提交之间背包被改动 → stale_option', () => {
    const s = save();
    s.bag.items = [item({ uid: 'bow', weapon_ref: 'wp_bow' })];
    const r = planWeaponSwap(s, cfg, 'bag:bow', templates);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s.bag.items = [];
    expect(commitWeaponSwap(s, r.plan)).toMatchObject({ ok: false, reason: 'stale_option' });
  });
});

describe('原子提交与回滚', () => {
  it('提交后装备槽、背包、weapon_ref 三者同步', () => {
    const s = save();
    const cur = item({ uid: 'cur', name: '腰刀', value: 12 });
    const bow = item({ uid: 'bow', name: '虎门猎弓', value: 15, weapon_ref: 'wp_bow' });
    s.equipment.weapon = cur;
    s.bag.items = [bow];
    const r = planWeaponSwap(s, cfg, 'bag:bow', templates);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = commitWeaponSwap(s, r.plan);
    expect(c.ok).toBe(true);
    expect(s.equipment.weapon?.uid).toBe('bow');
    expect(s.bag.items.map((i) => i.uid)).toEqual(['cur']);
    expect(cfg.weapons[s.equipment.weapon?.weapon_ref ?? '']?.range).toBe(200);
  });

  it('老存档补上 weapon_ref，进关卡时手感才会跟着变', () => {
    const s = save();
    const legacy = item({ uid: 'legacy', weapon_ref: undefined });
    s.bag.items = [legacy];
    const r = planWeaponSwap(s, cfg, 'bag:legacy', templates);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(commitWeaponSwap(s, r.plan).ok).toBe(true);
    expect(s.equipment.weapon?.weapon_ref).toBe('wp_dao');
  });

  it('persist 失败时用快照回滚，装备与背包都回到原样', () => {
    const s = save();
    const cur = item({ uid: 'cur', value: 12 });
    const bow = item({ uid: 'bow', value: 15, weapon_ref: 'wp_bow' });
    s.equipment.weapon = cur;
    s.bag.items = [bow];
    const r = planWeaponSwap(s, cfg, 'bag:bow', templates);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = commitWeaponSwap(s, r.plan);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    // 模拟 localStorage 写入抛错后的补偿
    rollbackWeaponSwap(s, c.snapshot);
    expect(s.equipment.weapon?.uid).toBe('cur');
    expect(s.bag.items.map((i) => i.uid)).toEqual(['bow']);
  });

  it('同一件装备重复提交第二次会因 uid 已离开背包而安全拒绝', () => {
    const s = save();
    s.bag.items = [item({ uid: 'bow', weapon_ref: 'wp_bow' })];
    const r = planWeaponSwap(s, cfg, 'bag:bow', templates);
    if (!r.ok) throw new Error('plan failed');
    expect(commitWeaponSwap(s, r.plan).ok).toBe(true);
    const before = JSON.stringify(s);
    expect(commitWeaponSwap(s, r.plan)).toMatchObject({ ok: false, reason: 'stale_option' });
    expect(JSON.stringify(s)).toBe(before);
  });
});
