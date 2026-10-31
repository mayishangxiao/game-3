/**
 * 数值与公式 —— 《完整设计书 v2.0》第六章 6.1.3 / 6.3 / 6.4 的纯函数实现。
 * 本模块不依赖 Phaser，可直接单元测试（tests/balance.test.ts）。
 */

import type { BalanceConfig, EnemyDef, EnemyTier, ItemBase, ItemInstance, Quality, Slot } from './types';

/** 随机源：[0,1) 均匀分布。测试时注入可控实现 */
export type Rng = () => number;

export const defaultRng: Rng = () => Math.random();

/** 在 [min,max) 内取随机浮点 */
export function randRange(min: number, max: number, rng: Rng = defaultRng): number {
  return min + (max - min) * rng();
}

/** 在 [min,max] 内取随机整数（含端点） */
export function randInt(min: number, max: number, rng: Rng = defaultRng): number {
  return Math.floor(min + (max - min + 1) * rng());
}

/** 按权重抽取一项，返回索引 */
export function weightedPick(weights: number[], rng: Rng = defaultRng): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/* ============================ 6.4.1 等级与属性 ============================ */

export interface LevelStats {
  hp: number;
  atk: number;
  def: number;
}

/** HP(L) = base + per_level × (L−1) 等三式 */
export function levelStats(level: number, cfg: BalanceConfig): LevelStats {
  const l = Math.max(1, Math.floor(level));
  return {
    hp: Math.round(cfg.hp_formula.base + cfg.hp_formula.per_level * (l - 1)),
    atk: Math.round(cfg.atk_formula.base + cfg.atk_formula.per_level * (l - 1)),
    def: Math.round(cfg.def_formula.base + cfg.def_formula.per_level * (l - 1)),
  };
}

/** EXP(L → L+1) = base + slope × (L−1) */
export function expToNext(level: number, cfg: BalanceConfig): number {
  const l = Math.max(1, Math.floor(level));
  return Math.round(cfg.exp_curve.base + cfg.exp_curve.slope * (l - 1));
}

/** 累计升到 level 所需总经验（含中间各级） */
export function cumulativeExp(level: number, cfg: BalanceConfig): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += expToNext(l, cfg);
  return sum;
}

export interface ExpResult {
  level: number;
  exp: number;
  levelsGained: number;
  stats: LevelStats;
}

/** 结算经验，支持一次升多级；多余经验保留在 exp 字段 */
export function applyExp(level: number, exp: number, gain: number, cfg: BalanceConfig): ExpResult {
  let lv = Math.max(1, Math.floor(level));
  let cur = exp + Math.max(0, gain);
  let gained = 0;
  // 防御性上限，避免配置错误导致死循环
  while (gained < 200 && cur >= expToNext(lv, cfg)) {
    cur -= expToNext(lv, cfg);
    lv += 1;
    gained += 1;
  }
  return { level: lv, exp: Math.round(cur), levelsGained: gained, stats: levelStats(lv, cfg) };
}

/* ============================ 6.4.3 关卡等级系数与敌人属性 ============================ */

/** 系数 = 1.00 + per_level × (L − 1) */
export function levelCoeff(level: number, cfg: BalanceConfig): number {
  const l = Math.max(1, Math.floor(level));
  return cfg.level_coeff.base + cfg.level_coeff.per_level * (l - 1);
}

/** 敌人实际属性 = 基准 × 关卡系数 */
export function enemyStats(def: EnemyDef, recommendedLevel: number, cfg: BalanceConfig): LevelStats {
  const k = levelCoeff(recommendedLevel, cfg);
  return {
    hp: Math.round(def.hp_base * k),
    atk: Math.round(def.atk_base * k),
    def: Math.round(def.def_base * k),
  };
}

/** Boss 基准 HP = 精英基准 × 6.7（设计书 6.4.3）：180 × 6.7 = 1206 */
export function bossBaseHp(eliteHp: number): number {
  return Math.round(eliteHp * 6.7);
}

/* ============================ 6.1.3 伤害公式 ============================ */

export interface DamageInput {
  atk: number;
  weaponMult: number;
  skillMult?: number;
  targetDef: number;
  attackerLevel: number;
  targetLevel: number;
  critRate: number;
  critDmg: number;
  /** 是否处于 Boss 弱点期 */
  weakpoint?: boolean;
}

export interface DamageResult {
  damage: number;
  crit: boolean;
}

/**
 * 最终伤害 = max(1, round((ATK × 武器倍率 × 技能倍率 − DEF目标 × 0.5) × 随机(0.95,1.05) × 暴击倍率))
 * 防御做减法；等级压制时 DEF 按 70% 计；Boss 弱点期武器倍率 ×2.5
 */
export function computeDamage(input: DamageInput, cfg: BalanceConfig, rng: Rng = defaultRng): DamageResult {
  const {
    atk,
    weaponMult,
    skillMult = 1,
    targetDef,
    attackerLevel,
    targetLevel,
    critRate,
    critDmg,
    weakpoint = false,
  } = input;

  const suppress =
    attackerLevel - targetLevel >= cfg.damage.level_suppress_threshold
      ? cfg.damage.level_suppress_def_factor
      : 1;

  const wp = weakpoint ? cfg.damage.boss_weakpoint_mult : 1;
  const raw = atk * weaponMult * skillMult * wp - targetDef * suppress * cfg.damage.def_factor;
  const jitter = randRange(cfg.damage.random_min, cfg.damage.random_max, rng);

  const crit = rng() < critRate;
  const critMult = crit ? critDmg : 1;

  const damage = Math.max(1, Math.round(raw * jitter * critMult));
  return { damage, crit };
}

/* ============================ 6.2 武器 ============================ */

/** 武器理论 DPS（用于平衡校验，不含防御与暴击） */
export function weaponDps(atk: number, weaponMult: number, attacksPerSec: number): number {
  return atk * weaponMult * attacksPerSec;
}

/** 武器攻击间隔（ms） */
export function weaponIntervalMs(attacksPerSec: number): number {
  return Math.round(1000 / attacksPerSec);
}

/* ============================ 6.3.3 词条 ============================ */

const AFFIX_ROLL = [
  { count: 1, weight: 50 },
  { count: 2, weight: 35 },
  { count: 3, weight: 15 },
];

/** 掷出词条条数：1 条 50% / 2 条 35% / 3 条 15% */
export function rollAffixCount(rng: Rng = defaultRng): number {
  return AFFIX_ROLL[weightedPick(AFFIX_ROLL.map((a) => a.weight), rng)].count;
}

/** 按权重无放回抽词条，同一装备不重复 */
export function rollAffixes(cfg: BalanceConfig, rng: Rng = defaultRng): { id: string; value: number }[] {
  const count = rollAffixCount(rng);
  const pool = cfg.affixes.map((a) => ({ ...a }));
  const picked: { id: string; value: number }[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = weightedPick(pool.map((p) => p.weight), rng);
    const a = pool.splice(idx, 1)[0];
    picked.push({ id: a.id, value: randInt(a.min, a.max, rng) });
  }
  return picked;
}

/* ============================ 6.3.4 掉落 ============================ */

/** 按来源掷品质 */
export function rollQuality(weights: Record<Quality, number>, rng: Rng = defaultRng): Quality {
  const order: Quality[] = ['white', 'blue', 'purple'];
  const idx = weightedPick(order.map((q) => weights[q]), rng);
  return order[idx];
}

/** 按槽位权重掷槽位 */
export function rollSlot(weights: Record<Slot, number>, rng: Rng = defaultRng): Slot {
  const order: Slot[] = ['weapon', 'head', 'body', 'legs', 'accessory'];
  const idx = weightedPick(order.map((s) => weights[s]), rng);
  return order[idx];
}

/** 紫装保底加成：同一副本连续 5 次未出紫，第 6 次紫概率 +25 */
export function applyPity(
  weights: Record<Quality, number>,
  missCount: number,
  pity: { threshold: number; boost: number },
): Record<Quality, number> {
  if (missCount < pity.threshold) return weights;
  const boosted = { ...weights };
  const take = Math.min(boosted.white, pity.boost);
  boosted.white -= take;
  boosted.purple += take;
  return boosted;
}

/** 由模板生成一件实体装备；紫装附带随机词条 */
export function makeItemInstance(
  base: ItemBase,
  cfg: BalanceConfig,
  rng: Rng = defaultRng,
  uid?: string,
): ItemInstance {
  const value = Math.round(base.base_value * base.quality_multiplier);
  return {
    uid: uid ?? `${base.id}_${Math.floor(rng() * 1e9).toString(36)}`,
    base_id: base.id,
    slot: base.slot,
    quality: base.quality,
    name: base.name,
    stat: base.stat,
    value,
    enhance: 0,
    affixes: base.quality === 'purple' ? rollAffixes(cfg, rng) : [],
  };
}

/** 强化后主属性：每级 +6%（设计书 6.3.5），上限 +5 */
export function enhancedValue(item: ItemInstance): number {
  const lv = Math.min(5, Math.max(0, item.enhance));
  return Math.round(item.value * (1 + 0.06 * lv));
}

/** 强化消耗零件：20 × 当前强化等级 */
export function enhanceCost(currentEnhance: number): number {
  return 20 * Math.max(1, currentEnhance);
}

/** 拆解返还零件：白 1 / 蓝 2 / 紫 3，×10 */
export function salvageValue(quality: Quality): number {
  const k = quality === 'purple' ? 3 : quality === 'blue' ? 2 : 1;
  return k * 10;
}

/* ============================ 6.7.2 知识图鉴加成 ============================ */

/** 每收集 10 张知识卡全属性 +2%，上限 +20% → 返回倍率 1.0—1.2 */
export function knowledgeBonus(count: number, cfg: BalanceConfig): number {
  const steps = Math.floor(Math.max(0, count) / 10);
  const pct = Math.min(cfg.knowledge.bonus_cap, steps * cfg.knowledge.bonus_per_10);
  return 1 + pct / 100;
}

/* ============================ 6.3.1 装备聚合成总属性 ============================ */

const STAT_KEYS = ['atk', 'def', 'hp', 'spd'] as const;

/** 把五槽位装备的主属性与词条折算为总加成 */
export function aggregateEquipment(
  equipped: Partial<Record<Slot, ItemInstance | null>>,
): { atk: number; def: number; hp: number; spd: number; crit: number; critDmg: number; lifesteal: number } {
  const out = { atk: 0, def: 0, hp: 0, spd: 0, crit: 0, critDmg: 0, lifesteal: 0 };
  for (const item of Object.values(equipped)) {
    if (!item) continue;
    const v = enhancedValue(item);
    if ((STAT_KEYS as readonly string[]).includes(item.stat)) {
      out[item.stat as (typeof STAT_KEYS)[number]] += v;
    }
    for (const af of item.affixes) {
      switch (af.id) {
        case 'af_crit':
          out.crit += af.value;
          break;
        case 'af_critdmg':
          out.critDmg += af.value;
          break;
        case 'af_lifesteal':
          out.lifesteal += af.value;
          break;
        case 'af_speed':
          // 移速词条按百分比折算为绝对值（基准 72 px/s）
          out.spd += Math.round(72 * (af.value / 100));
          break;
        default:
          break;
      }
    }
  }
  return out;
}

/** 计算玩家最终属性：等级基础 × 知识加成 + 装备加成 */
export function effectiveStats(
  level: number,
  knowledgeCount: number,
  equipped: Partial<Record<Slot, ItemInstance | null>>,
  cfg: BalanceConfig,
): LevelStats & { crit: number; critDmg: number; spd: number } {
  const base = levelStats(level, cfg);
  const kb = knowledgeBonus(knowledgeCount, cfg);
  const eq = aggregateEquipment(equipped);
  return {
    hp: Math.round(base.hp * kb) + eq.hp,
    atk: Math.round(base.atk * kb) + eq.atk,
    def: Math.round(base.def * kb) + eq.def,
    crit: 5 + eq.crit,
    critDmg: 150 + eq.critDmg,
    spd: 72 + eq.spd,
  };
}

/** 按 tier 取出敌人基准表 */
export function tierBase(tier: EnemyTier, cfg: BalanceConfig): { hp: number; atk: number; def: number } {
  return cfg.enemy_tiers[tier];
}