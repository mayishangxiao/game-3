/**
 * 存档系统单元测试 —— 对应设计书 6.8.2 与 6.7.4。
 */

import { describe, expect, it } from 'vitest';
import {
  addKnowledge,
  addToBag,
  chapterCompletion,
  createDefaultSave,
  equipItem,
  markNodeDone,
  migrate,
  SaveManager,
  unlockWeapon,
} from '../src/core/SaveManager';
import { SAVE_VERSION } from '../src/core/constants';
import config from '../public/data/config.json';
import type { BalanceConfig, ItemInstance } from '../src/core/types';

const cfg = config as unknown as BalanceConfig;

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
    ...over,
  };
}

describe('默认存档', () => {
  it('Lv1 属性取自数值配置', () => {
    const s = createDefaultSave(cfg);
    expect(s.player.level).toBe(1);
    expect(s.player.hp).toBe(100);
    expect(s.player.atk).toBe(10);
    expect(s.weapons).toEqual(['wp_dao']);
    expect(s.version).toBe(SAVE_VERSION);
  });
});

describe('存档迁移（绝不清档）', () => {
  it('缺字段用默认值补齐', () => {
    const old = { version: 1, player: { level: 7 } } as unknown;
    const s = migrate(old, cfg);
    expect(s.player.level).toBe(7);
    expect(s.player.hp).toBe(100); // 默认值兜底
    expect(s.bag.slots).toBe(60);
    expect(Array.isArray(s.knowledge)).toBe(true);
    expect(s.version).toBe(SAVE_VERSION);
  });

  it('垃圾输入返回全新存档而不是抛错', () => {
    expect(migrate(null, cfg).player.level).toBe(1);
    expect(migrate('oops', cfg).player.level).toBe(1);
  });

  it('空武器数组会被默认值纠回，避免玩家无武器', () => {
    const s = migrate({ weapons: [] }, cfg);
    expect(s.weapons).toEqual(['wp_dao']);
  });
});

describe('SaveManager 读写（Node 环境退化为内存实现）', () => {
  it('存-读-导出-导入闭环', () => {
    const m = new SaveManager();
    m.init(cfg);
    const s = m.load(cfg);
    s.player.level = 9;
    s.knowledge.push('kc_1839_humen');
    m.save(s);

    const back = m.load(cfg);
    expect(back.player.level).toBe(9);
    expect(back.knowledge).toContain('kc_1839_humen');

    const exported = m.exportString(back);
    const imported = m.importString(exported, cfg);
    expect(imported.player.level).toBe(9);
  });

  it('reset 后回到初始状态', () => {
    const m = new SaveManager();
    m.init(cfg);
    const s = m.load(cfg);
    s.player.level = 20;
    m.save(s);
    const fresh = m.reset(cfg);
    expect(fresh.player.level).toBe(1);
  });
});

describe('背包与装备', () => {
  it('同款同品质超过 5 件转为零件', () => {
    const s = createDefaultSave(cfg);
    for (let i = 0; i < 5; i++) {
      expect(addToBag(s, item({ uid: `u${i}` }))).toBe('ok');
    }
    expect(addToBag(s, item({ uid: 'u6' }))).toBe('converted');
  });

  it('背包满时紫装不被丢弃（设计书 6.3.6）', () => {
    const s = createDefaultSave(cfg);
    s.bag.slots = 1;
    s.bag.items.push(item({ uid: 'a' }));
    expect(addToBag(s, item({ uid: 'b', quality: 'purple', base_id: 'eq_acc_linzexu_purple_01' }))).toBe('ok');
    expect(s.bag.items.some((i) => i.quality === 'purple')).toBe(true);
  });

  it('装备替换返回旧装备', () => {
    const s = createDefaultSave(cfg);
    const old = equipItem(s, item({ uid: 'old' }));
    expect(old).toBeNull();
    const prev = equipItem(s, item({ uid: 'new' }));
    expect(prev?.uid).toBe('old');
    expect(s.equipment.weapon?.uid).toBe('new');
  });

  it('节点去重、知识卡去重、武器去重', () => {
    const s = createDefaultSave(cfg);
    markNodeDone(s, 'nd_a');
    markNodeDone(s, 'nd_a');
    expect(s.progress.nodes_done).toEqual(['nd_a']);

    expect(addKnowledge(s, 'kc_1')).toBe(true);
    expect(addKnowledge(s, 'kc_1')).toBe(false);
    expect(s.knowledge).toEqual(['kc_1']);

    expect(unlockWeapon(s, 'wp_bow')).toBe(true);
    expect(unlockWeapon(s, 'wp_bow')).toBe(false);
  });
});

describe('6.7.4 章节完成度', () => {
  it('全收集 + 测验满分 = 100', () => {
    const pct = chapterCompletion(
      ['e1', 'e2'],
      ['k1', 'k2'],
      ['h1'],
      ['e1', 'e2'],
      ['k1', 'k2', 'h1'],
      true,
      5,
    );
    expect(pct).toBe(100);
  });

  it('只通关事件、无知识无测验时约 44（隐藏类无卡则从分母剔除）', () => {
    const pct = chapterCompletion(['e1', 'e2'], ['k1', 'k2'], [], ['e1', 'e2'], [], false, 0);
    // 有效权重 = 事件 .4 + 知识 .3 + 测验 .2 = .9；得分 = .4 → 44
    expect(pct).toBe(44);
  });

  it('空集合并返回 0 而不是 NaN', () => {
    const pct = chapterCompletion([], [], [], [], [], false, 0);
    expect(pct).toBe(0);
    expect(Number.isFinite(pct)).toBe(true);
  });
});