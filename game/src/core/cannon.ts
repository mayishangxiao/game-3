/**
 * 【虎门重炮】纯逻辑层（不 import Phaser，跑在 node 环境的 vitest 里）。
 *
 * 设计意图（老师给的第一章要求）：
 * - 打普通英兵一发秒杀 → 显示岸炮对小兵的有效性
 * - 打精英郭富准将高伤但不秒杀 → 精英要有「挨一炮还站着」的存在感
 * - 打 BOSS 英军舰船伤害极低 → 木船岸炮对蒸汽铁壳舰，优势不在我们这边
 * - 长冷却 + 小概率炸膛自伤 → 不能无脑按
 * - 我方炮弹不抵消敌方炮弹：本模块只做伤害结算，从不碰敌弹，
 *   所以「炮弹对撞」这种破坏史实观感的设定在代码层面就不存在（tests/cannon.test.ts 有断言）
 */

import type { CannonParams, EnemyTier } from './types';

/** 清王朝血条上限（老师要求的第一段历史总线） */
export const DYNASTY_MAX = 100;

export interface CannonTarget {
  id: string;
  tier: EnemyTier;
  hp: number;
  maxHp: number;
}

export interface CannonHit {
  id: string;
  damage: number;
  /** 这一炮会不会把它打死（精英与 Boss 恒为 false） */
  lethal: boolean;
}

export type CannonResult =
  | { kind: 'misfire'; selfDamage: number }
  | { kind: 'fire'; hits: CannonHit[] };

/** 冷却是否结束（剩余毫秒） */
export function cannonReady(cooldownLeftMs: number): boolean {
  return cooldownLeftMs <= 0;
}

/** 冷却剩余秒数，给按钮提示用 */
export function cooldownSeconds(leftMs: number): number {
  return Math.max(0, Math.ceil(leftMs / 1000));
}

function damageFor(t: CannonTarget, p: CannonParams): CannonHit {
  if ((p.kill_tiers as EnemyTier[]).includes(t.tier)) {
    return { id: t.id, damage: Math.max(1, t.hp), lethal: true };
  }
  if (t.tier === 'boss') {
    const dmg = Math.max(1, Math.round((t.maxHp * p.boss_hp_pct) / 100));
    // Boss 不会一炮而死（船体太厚），伤害按比例且封顶到当前血量的 90%
    return { id: t.id, damage: Math.min(dmg, Math.max(1, t.hp - 1)), lethal: false };
  }
  const dmg = Math.max(1, Math.round((t.maxHp * p.elite_hp_pct) / 100));
  // 精英「高伤不秒杀」：伤害再大也至少留 1 点血
  return { id: t.id, damage: Math.min(dmg, Math.max(1, t.hp - 1)), lethal: false };
}

/**
 * 结算一发炮弹。
 * @param targets 已经被场景筛过（射程 + 溅射范围）的目标
 * @param p 技能参数
 * @param playerMaxHp 炸膛时按玩家的最大生命值扣
 * @param roll01 0–1 的随机数（炸膛判定）；测试里可以固定
 */
export function planCannonShot(
  targets: CannonTarget[],
  p: CannonParams,
  playerMaxHp: number,
  roll01: number,
): CannonResult {
  const misfireChance = Math.max(0, Math.min(100, p.misfire_chance_pct)) / 100;
  if (roll01 < misfireChance) {
    const selfDamage = Math.max(1, Math.round((playerMaxHp * p.misfire_self_pct) / 100));
    return { kind: 'misfire', selfDamage };
  }
  return { kind: 'fire', hits: targets.map((t) => damageFor(t, p)) };
}

/** 距离是否在半径内（场景用来筛溅射目标） */
export function within(ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  return Math.hypot(ax - bx, ay - by) <= radius;
}

/** 清王朝血条扣减（夹在 0..DYNASTY_MAX） */
export function applyDynastyDelta(current: number, delta: number): number {
  return Math.max(0, Math.min(DYNASTY_MAX, current + delta));
}