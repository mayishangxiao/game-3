/**
 * 开局武器选择（v1.8）纯逻辑单测。
 *
 * 锁的是「开局选刀、进局变弓」这条链路：解锁列表 ≠ 选定武器。
 * 场景侧的进关 / 换图 / 剧情掉落由 `tools/_cdp/weapon-selection.mjs` 实拍验证。
 */

import { describe, expect, it } from 'vitest';
import config from '../public/data/config.json';
import itemsBaseJson from '../public/data/equipment/items_base.json';
import {
  createDefaultSave,
  equipItem,
  migrate,
  unlockWeapon,
} from '../src/core/SaveManager';
import {
  DEFAULT_SELECTED_WEAPON,
  isValidWeaponId,
  resolveSelectedWeapon,
  selectWeapon,
} from '../src/core/weaponSelection';
import { commitWeaponSwap, planWeaponSwap, rollbackWeaponSwap } from '../src/core/weaponSwap';
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
  return { ...createDefaultSave(cfg), ...over };
}

describe('选定武器：单一真值', () => {
  it('新档开局是腰刀，且不因为解锁列表里有弓而变', () => {
    const s = save();
    expect(s.selected_weapon).toBe('wp_dao');
    expect(resolveSelectedWeapon(s, cfg)).toBe('wp_dao');
    // 复刻旧 bug 的存档：第 2 波掉弓后解锁列表被写入 wp_bow
    unlockWeapon(s, 'wp_bow');
    expect(s.weapons).toContain('wp_bow');
    expect(resolveSelectedWeapon(s, cfg)).toBe('wp_dao');
  });

  it('解锁任意武器都不改选定值（剧情掉落 / 节点奖励走同一条路径）', () => {
    const s = save();
    const before = s.selected_weapon;
    for (const id of ['wp_bow', 'wp_matchlock', 'wp_mg', 'wp_crowbar']) {
      unlockWeapon(s, id);
      expect(resolveSelectedWeapon(s, cfg)).toBe(before);
    }
    // 重复解锁返回 false，也不会顺手改选择
    expect(unlockWeapon(s, 'wp_bow')).toBe(false);
    expect(s.selected_weapon).toBe('wp_dao');
  });

  it('只有玩家主动切换才改，且换回来仍生效', () => {
    const s = save();
    expect(selectWeapon(s, 'wp_bow', cfg)).toBe(true);
    expect(resolveSelectedWeapon(s, cfg)).toBe('wp_bow');
    expect(selectWeapon(s, 'wp_crowbar', cfg)).toBe(true);
    expect(resolveSelectedWeapon(s, cfg)).toBe('wp_crowbar');
    expect(selectWeapon(s, 'wp_dao', cfg)).toBe(true);
    expect(resolveSelectedWeapon(s, cfg)).toBe('wp_dao');
  });

  it('非法 id 一律拒绝，不会把手上武器变成 undefined', () => {
    const s = save();
    expect(isValidWeaponId('wp_not_exist', cfg)).toBe(false);
    expect(isValidWeaponId(undefined, cfg)).toBe(false);
    expect(selectWeapon(s, 'wp_not_exist', cfg)).toBe(false);
    expect(resolveSelectedWeapon(s, cfg)).toBe('wp_dao');
    // 脏存档：selected_weapon 是野值 → 回退到合法来源
    expect(resolveSelectedWeapon({ ...s, selected_weapon: '???' }, cfg)).toBe('wp_dao');
  });

  it('装备槽 / 解锁列表兜底顺序正确，缺字段永不返回空', () => {
    const s = save();
    expect(resolveSelectedWeapon({ ...s, selected_weapon: undefined }, cfg)).toBe('wp_dao');
    expect(
      resolveSelectedWeapon(
        { ...s, selected_weapon: undefined, weapons: ['wp_crowbar'] },
        cfg,
      ),
    ).toBe('wp_crowbar');
    expect(
      resolveSelectedWeapon(
        {
          ...s,
          selected_weapon: undefined,
          equipment: { ...s.equipment, weapon: item({ weapon_ref: 'wp_bow' }) },
        },
        cfg,
      ),
    ).toBe('wp_bow');
    expect(
      resolveSelectedWeapon({ ...s, selected_weapon: undefined, weapons: [] }, cfg),
    ).toBe(DEFAULT_SELECTED_WEAPON);
  });
});

describe('老存档迁移不丢选择', () => {
  it('没有 selected_weapon 的档：沿用武器槽那件装备', () => {
    const raw = createDefaultSave(cfg);
    // 模拟 v1.7 及更早的存档
    const legacy = { ...raw, equipment: { ...raw.equipment, weapon: item({ weapon_ref: 'wp_bow' }) } };
    delete (legacy as Partial<SaveData>).selected_weapon;
    const s = migrate(legacy, cfg);
    expect(s.selected_weapon).toBe('wp_bow');
    expect(resolveSelectedWeapon(s, cfg)).toBe('wp_bow');
  });

  it('既没有字段也没有装备：回到腰刀，不按解锁列表推断', () => {
    const raw = createDefaultSave(cfg);
    raw.weapons = ['wp_dao', 'wp_bow'];
    delete (raw as Partial<SaveData>).selected_weapon;
    const s = migrate(raw, cfg);
    expect(s.selected_weapon).toBe('wp_dao');
  });

  it('已有 selected_weapon 的档：原样保留', () => {
    const raw = createDefaultSave(cfg);
    raw.selected_weapon = 'wp_matchlock';
    expect(migrate(raw, cfg).selected_weapon).toBe('wp_matchlock');
  });
});

describe('装备界面 / 战斗背包与选定值同步', () => {
  it('equipItem 装武器时同步，装非武器槽不动', () => {
    const s = save();
    equipItem(s, item({ uid: 'bow', weapon_ref: 'wp_bow' }));
    expect(s.selected_weapon).toBe('wp_bow');
    equipItem(s, item({ uid: 'hat', slot: 'head', weapon_ref: undefined }));
    expect(s.selected_weapon).toBe('wp_bow');
  });

  it('战斗内换武器提交后同步选定值；回滚时一并还原', () => {
    const s = save();
    const cur = item({ uid: 'cur' });
    const bow = item({ uid: 'bow', name: '虎门猎弓', value: 15, weapon_ref: 'wp_bow' });
    s.equipment.weapon = cur;
    s.bag.items = [bow];
    const plan = planWeaponSwap(s, cfg, 'bag:bow', templates);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const committed = commitWeaponSwap(s, plan.plan);
    expect(committed.ok).toBe(true);
    expect(s.selected_weapon).toBe('wp_bow');
    expect(resolveSelectedWeapon(s, cfg)).toBe('wp_bow');
    if (!committed.ok) return;
    rollbackWeaponSwap(s, committed.snapshot);
    expect(s.selected_weapon).toBe('wp_dao');
    expect(resolveSelectedWeapon(s, cfg)).toBe('wp_dao');
  });
});
