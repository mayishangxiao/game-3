/**
 * 「实力感」的唯一真值：同一个敌人在**手感**上该有多重。
 *
 * 甲方反馈「光列文字不直观」，要求用角色状态、血条、命中特效、打击节奏、
 * 音效这些**不用读字**的信号把实力差距演出来。这些信号以前散落在各处的
 * if (tier === 'elite') 里，改一个档要翻五个文件；这里按 `EnemyTier` 一次定义，
 * `Enemy` / `LevelScene` / `AudioKit` 各自只读、不自己拍数字。
 *
 * 设计取舍（照甲方「避坑提醒」）：
 *   - **不做粒子系统**。气场就是一个低透明度圆 + 呼吸 tween，命中火花最多 10 个 2px
 *     小方块，堆多了会把像素画风糊掉。
 *   - **主打节奏与重量**：顿帧（hitstop）、击退抗性、震屏、音色档位，这四样成本最低、
 *     玩家潜意识感知最强。
 *   - 数值必须**逐档单调**（越强越顿、越震、越打不动），`tests/combatPresence.test.ts`
 *     锁死这条，避免以后调参调出「精英比杂鱼还软」的倒挂。
 *
 * 纯逻辑模块：不 import Phaser，node 环境可直测。
 */

import type { EnemyTier } from './types';
import { PALETTE } from './constants';

/** 打击重量档：音效与火花的粗粒度分组（细数值仍在下面各字段里） */
export type HitWeight = 'light' | 'medium' | 'heavy';

export interface PresenceDef {
  /**
   * 命中这个敌人时的全局顿帧（ms）。0 = 不顿。
   * 连击杂鱼时如果每下都顿，手感会变成卡顿；只有打硬目标才值得停一拍。
   */
  hitStopMs: number;
  /** 命中时的震屏时长 / 强度（0 = 不震） */
  shakeMs: number;
  shakeAmp: number;
  /**
   * 击退抗性 0..1：1 = 完全打不动（军舰），0 = 一打就飞（杂鱼）。
   * `damageEnemy` 用它乘配置里的击退距离，不改 `config.json`。
   */
  knockResist: number;
  /** 受击闪白时长（ms）：越硬闪得越久，读起来像「这一下他扛住了」 */
  flashMs: number;
  /** 命中火花：数量 / 尺寸倍率 / 存续 ms */
  sparkN: number;
  sparkScale: number;
  sparkMs: number;
  /** 血条底槽厚度：强者更厚重（3 → 5px） */
  barH: number;
  /** 护甲层数：多一层色块 = 多一层甲（只看图形，不写数字） */
  armorLayers: number;
  /** 死亡倒地时长（ms）与碎片数：强者死得慢、炸得碎 */
  deathMs: number;
  debris: number;
  /** 气场：半径 px / 透明度 / 颜色（半径 0 = 没有气场） */
  auraR: number;
  auraAlpha: number;
  auraColor: number;
  /** 敌人打中玩家时把玩家推开的距离（px） */
  shove: number;
  weight: HitWeight;
}

/**
 * 五档数值表。改这里之前先想清楚「玩家不看文字能不能感觉到」——
 * 感觉不到的字段就别加，加了也只是多一个没人读的配置。
 */
const PRESENCE: Record<EnemyTier, PresenceDef> = {
  // 杂鱼：一碰就散。没有顿帧（连击不卡）、没有震屏、吃满击退。
  mob: {
    hitStopMs: 0,
    shakeMs: 0,
    shakeAmp: 0,
    knockResist: 0,
    flashMs: 40,
    sparkN: 3,
    sparkScale: 0.6,
    sparkMs: 110,
    barH: 3,
    armorLayers: 0,
    deathMs: 220,
    debris: 0,
    auraR: 0,
    auraAlpha: 0,
    auraColor: PALETTE.greyPlum,
    shove: 0,
    weight: 'light',
  },
  // 正规兵：有一点分量，但还是「砍得动」的。
  standard: {
    hitStopMs: 16,
    shakeMs: 0,
    shakeAmp: 0,
    knockResist: 0.15,
    flashMs: 50,
    sparkN: 4,
    sparkScale: 0.75,
    sparkMs: 130,
    barH: 3,
    armorLayers: 0,
    deathMs: 280,
    debris: 1,
    auraR: 0,
    auraAlpha: 0,
    auraColor: PALETTE.greyPlum,
    shove: 2,
    weight: 'medium',
  },
  // 火枪/炮队：命中反馈略大（火药），但身板还是不硬。
  ranged: {
    hitStopMs: 20,
    shakeMs: 60,
    shakeAmp: 0.002,
    knockResist: 0.1,
    flashMs: 50,
    sparkN: 5,
    sparkScale: 0.85,
    sparkMs: 150,
    barH: 3,
    armorLayers: 0,
    deathMs: 260,
    debris: 1,
    auraR: 0,
    auraAlpha: 0,
    auraColor: PALETTE.star,
    shove: 3,
    weight: 'medium',
  },
  // 精英/主将：明显更硬。半抗击退、多一层护甲色块、脚下有微光。
  elite: {
    hitStopMs: 55,
    shakeMs: 90,
    shakeAmp: 0.004,
    knockResist: 0.55,
    flashMs: 80,
    sparkN: 7,
    sparkScale: 1.15,
    sparkMs: 200,
    barH: 4,
    armorLayers: 1,
    deathMs: 420,
    debris: 4,
    auraR: 16,
    auraAlpha: 0.13,
    auraColor: PALETTE.star,
    shove: 12,
    weight: 'heavy',
  },
  // Boss / 军舰：顿帧最长、震屏最强、完全打不动。气场更亮更大。
  boss: {
    hitStopMs: 90,
    shakeMs: 150,
    shakeAmp: 0.0065,
    knockResist: 1,
    flashMs: 110,
    sparkN: 10,
    sparkScale: 1.5,
    sparkMs: 260,
    barH: 5,
    armorLayers: 2,
    deathMs: 900,
    debris: 7,
    auraR: 30,
    auraAlpha: 0.18,
    auraColor: PALETTE.redBright,
    shove: 26,
    weight: 'heavy',
  },
};

/**
 * 取某一档的配置。数据里的 tier 是字符串（JSON 来的），拼错/缺字段一律
 * 当杂鱼处理——宁可「不够帅」，也不能因为一个错字让 Boss 变成没有反馈的空气。
 */
export function presenceOf(tier: EnemyTier | string | undefined | null): PresenceDef {
  if (!tier) return PRESENCE.mob;
  return (PRESENCE as Record<string, PresenceDef>)[tier] ?? PRESENCE.mob;
}

/** 这一档还剩多少击退（1 = 吃满击退，0 = 完全不动） */
export function knockScale(tier: EnemyTier | string | undefined | null): number {
  const r = presenceOf(tier).knockResist;
  return Math.max(0, Math.min(1, 1 - r));
}

/** 命中这一档要顿多久（0 表示不顿帧） */
export function hitStopFor(tier: EnemyTier | string | undefined | null): number {
  return presenceOf(tier).hitStopMs;
}

/** 全部档位，供测试与调试遍历 */
export const PRESENCE_TIERS: readonly EnemyTier[] = ['mob', 'standard', 'ranged', 'elite', 'boss'];
