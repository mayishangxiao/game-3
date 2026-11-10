/**
 * 存档系统 —— 《完整设计书 v2.0》6.8.2。
 * localStorage，无后端；version 字段用于迁移，缺失字段用默认值补齐，绝不因版本不符清档。
 */

import { SAVE_KEY, SAVE_VERSION } from './constants';
import { levelStats } from './balance';
import type { BalanceConfig, ItemBase, ItemInstance, Quality, SaveData, Slot } from './types';

export function createDefaultSave(cfg: BalanceConfig, now = new Date()): SaveData {
  const iso = now.toISOString();
  const stats = levelStats(1, cfg);
  return {
    version: SAVE_VERSION,
    created: iso,
    updated: iso,
    player: { level: 1, exp: 0, hp: stats.hp, atk: stats.atk, def: stats.def },
    progress: {
      chapter: 'ch00',
      act: 'ch00_act1',
      events: [],
      nodes_done: [],
      completion: {},
      graph: [],
      // 清王朝血条缺省满格（core/cannon.ts 的 DYNASTY_MAX 是同一份数字）
      dynasty: 100,
    },
    equipment: { weapon: null, head: null, body: null, legs: null, accessory: null },
    inventory: [],
    bag: { slots: 60, items: [] },
    scrap: 30,
    weapons: ['wp_dao'],
    skills: [],
    knowledge: [],
    quiz: {},
    dungeons: {},
    achievements: [],
    settings: { sound: 0.8, music: 0.6, rhythmSlow: false, colorblind: false },
  };
}

/** 逐字段补齐，保证旧存档永不因缺字段而崩溃 */
export function migrate(raw: unknown, cfg: BalanceConfig): SaveData {
  const base = createDefaultSave(cfg);
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Partial<SaveData>;

  const merged: SaveData = {
    ...base,
    ...s,
    version: SAVE_VERSION,
    player: { ...base.player, ...(s.player ?? {}) },
    progress: { ...base.progress, ...(s.progress ?? {}) },
    equipment: { ...base.equipment, ...(s.equipment ?? {}) },
    bag: { ...base.bag, ...(s.bag ?? {}) },
    scrap: typeof s.scrap === 'number' ? s.scrap : base.scrap,
    settings: { ...base.settings, ...(s.settings ?? {}) },
    inventory: Array.isArray(s.inventory) ? s.inventory : [],
    weapons: Array.isArray(s.weapons) && s.weapons.length > 0 ? s.weapons : base.weapons,
    skills: Array.isArray(s.skills) ? s.skills : [],
    knowledge: Array.isArray(s.knowledge) ? s.knowledge : [],
    quiz: s.quiz && typeof s.quiz === 'object' ? s.quiz : {},
    dungeons: s.dungeons && typeof s.dungeons === 'object' ? s.dungeons : {},
    achievements: Array.isArray(s.achievements) ? s.achievements : [],
  };
  return merged;
}

/** 存档读写（浏览器 localStorage；Node 环境下退化为内存实现，便于测试） */
export class SaveManager {
  private memory: string | null = null;
  private useMemory = false;

  init(cfg: BalanceConfig): SaveData {
    this.useMemory = typeof localStorage === 'undefined';
    const raw = this.readRaw();
    const data = migrate(raw ? safeParse(raw) : null, cfg);
    return data;
  }

  private readRaw(): string | null {
    if (this.useMemory) return this.memory;
    try {
      return localStorage.getItem(SAVE_KEY);
    } catch {
      this.useMemory = true;
      return this.memory;
    }
  }

  private writeRaw(text: string): void {
    if (this.useMemory) {
      this.memory = text;
      return;
    }
    try {
      localStorage.setItem(SAVE_KEY, text);
    } catch (e) {
      // 隐私模式或配额耗尽：退回内存，不打断游戏
      console.warn('[SaveManager] localStorage 写入失败，退回内存存档', e);
      this.useMemory = true;
      this.memory = text;
    }
  }

  save(data: SaveData): void {
    data.updated = new Date().toISOString();
    this.writeRaw(JSON.stringify(data));
  }

  load(cfg: BalanceConfig): SaveData {
    const raw = this.readRaw();
    return migrate(raw ? safeParse(raw) : null, cfg);
  }

  hasSave(): boolean {
    return this.readRaw() !== null;
  }

  reset(cfg: BalanceConfig): SaveData {
    const fresh = createDefaultSave(cfg);
    this.save(fresh);
    return fresh;
  }

  /** 导出为可备份字符串（设计书 6.8.2：手动存档与导出） */
  exportString(data: SaveData): string {
    const json = JSON.stringify(data);
    return typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(json))) : json;
  }

  /** 从导出字符串恢复 */
  importString(text: string, cfg: BalanceConfig): SaveData {
    let json = text.trim();
    if (!json.startsWith('{')) {
      try {
        json = decodeURIComponent(escape(atob(json)));
      } catch {
        throw new Error('存档字符串无法识别');
      }
    }
    return migrate(safeParse(json), cfg);
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ================= 便捷读写helper ================= */

/* ==================== 装备「我还差什么」：五槽位收集进度 ==================== */

export const SLOT_ORDER: readonly Slot[] = ['weapon', 'head', 'body', 'legs', 'accessory'];

const QUALITY_RANK: Record<Quality, number> = { white: 0, blue: 1, purple: 2 };

export interface SlotProgressInfo {
  slot: Slot;
  /** 当前持有（背包 + 已装备）的最高品质；一件都没有时为 null */
  best: Quality | null;
  /** 该槽位在模板表里实际存在的最高品质 —— 一个真能达成的目标 */
  target: Quality;
  reached: boolean;
}

/**
 * 纯函数：算出五个槽位各自的「已有最高品质 / 目标品质」。
 *
 * 目标不写死为紫色：模板表里武器、头盔、腿部目前最高只到蓝，写死紫会造出
 * 三个永远达不成的假目标。数据源只有存档与传入的模板表，不改存档结构、不落盘。
 */
export function slotProgress(data: SaveData, items: ItemBase[]): Record<Slot, SlotProgressInfo> {
  const owned: (ItemInstance | null)[] = [
    ...((data.bag?.items ?? []) as ItemInstance[]),
    ...Object.values(data.equipment ?? {}),
  ];
  const out = {} as Record<Slot, SlotProgressInfo>;
  for (const slot of SLOT_ORDER) {
    const pool = items.filter((i) => i.slot === slot);
    let target: Quality = 'purple';
    if (pool.length > 0) {
      target = pool.reduce<Quality>(
        (best, i) => (QUALITY_RANK[i.quality] > QUALITY_RANK[best] ? i.quality : best),
        'white',
      );
    }
    let best: Quality | null = null;
    for (const it of owned) {
      if (!it || it.slot !== slot) continue;
      const q = it.quality as Quality;
      if (q in QUALITY_RANK && (best === null || QUALITY_RANK[q] > QUALITY_RANK[best])) best = q;
    }
    out[slot] = {
      slot,
      best,
      target,
      reached: best !== null && QUALITY_RANK[best] >= QUALITY_RANK[target],
    };
  }
  return out;
}

export function equipItem(data: SaveData, item: ItemInstance): ItemInstance | null {
  const prev = data.equipment[item.slot as Slot] ?? null;
  data.equipment[item.slot as Slot] = item;
  return prev;
}

export function addToBag(data: SaveData, item: ItemInstance): 'ok' | 'converted' {
  const sameBase = data.bag.items.filter((i) => i.base_id === item.base_id && i.quality === item.quality);
  if (sameBase.length >= 5) return 'converted';
  if (data.bag.items.length >= data.bag.slots) {
    // 设计书 6.3.6：背包满时紫装必须弹窗，不允许静默丢失
    if (item.quality === 'purple') {
      data.bag.items.push(item);
      return 'ok';
    }
    return 'converted';
  }
  data.bag.items.push(item);
  return 'ok';
}

export function markNodeDone(data: SaveData, nodeId: string): void {
  if (!data.progress.nodes_done.includes(nodeId)) data.progress.nodes_done.push(nodeId);
}

export function addKnowledge(data: SaveData, knowledgeId: string): boolean {
  if (data.knowledge.includes(knowledgeId)) return false;
  data.knowledge.push(knowledgeId);
  return true;
}

export function unlockWeapon(data: SaveData, weaponId: string): boolean {
  if (data.weapons.includes(weaponId)) return false;
  data.weapons.push(weaponId);
  return true;
}

/**
 * 章节完成度 = 事件 40% + 知识 30% + 测验 20% + 隐藏 10%（设计书 6.7.4）。
 *
 * 当某一类在本章不存在（例如序章第一幕没有隐藏卡）时，把该类从分母里剔除、
 * 权重按剩余类别归一化——否则「没有隐藏卡」反而会白送 10% 或永远封顶 90%。
 */
export function chapterCompletion(
  chapterEventIds: string[],
  chapterKnowledgeIds: string[],
  chapterHiddenIds: string[],
  doneEvents: string[],
  gotKnowledge: string[],
  quizPassed: boolean,
  quizBest: number,
): number {
  const ratio = (got: number, den: number) => (den === 0 ? null : Math.min(1, got / den));

  const categories: { weight: number; value: number | null }[] = [
    {
      weight: 0.4,
      value: ratio(chapterEventIds.filter((e) => doneEvents.includes(e)).length, chapterEventIds.length),
    },
    {
      weight: 0.3,
      value: ratio(
        chapterKnowledgeIds.filter((k) => gotKnowledge.includes(k)).length,
        chapterKnowledgeIds.length,
      ),
    },
    // 测验恒有分母（5 题），通过与否决定得分
    { weight: 0.2, value: quizPassed ? Math.min(1, quizBest / 5) : 0 },
    {
      weight: 0.1,
      value: ratio(
        chapterHiddenIds.filter((k) => gotKnowledge.includes(k)).length,
        chapterHiddenIds.length,
      ),
    },
  ];

  const active = categories.filter((c) => c.value !== null);
  const totalWeight = active.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return 0;

  const earned = active.reduce((s, c) => s + c.weight * (c.value as number), 0);
  return Math.round((earned / totalWeight) * 100);
}