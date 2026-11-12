/**
 * 波次强化（原设计：甲方要求「每波次强化系统，只对弓强化，比如弹幕变两行之类的」）。
 *
 * v1.7 起近战武器补齐同一套强化：**同一个三选一触发、同一个 6 次上限、
 * 同一本按实例隔离的状态、同一个本关内重置规则**，只是「这一级长什么样」按武器形态分派：
 *   - 弓：齐射（多行箭矢） / 火线（射速） / 穿透（箭矢多穿一个）；
 *   - 近战：齐射→横扫（扇形加宽） / 火线→攻速（同一倍率） / 穿透→破甲（挥砍伤害）。
 * 火枪、机枪等其它远程不在强化范围内（原本弹了弓卡也只对弓生效，是误导）。
 *
 * v1.8 迁移老游戏（`old game/history_game`、`game2`）的**近战攻击向进化**：近战卡池扩到 9 张，
 * 增加刃锋延展 / 背袭之刃 / 回旋斩 / 剑气纵横 / 震荡强击 / 嗜血战意，连同老游戏的组合技
 * （背袭+横扫≈全向、回旋+剑气=八方剑气、背袭+剑气=前后双向）、卡顶色条、选后头顶飘字。
 * 弓的 3 张卡、数值、文案、6 次上限**逐字不变**；详见 `design/13_melee_evolution_migration.md`。
 *
 * 这个文件是**纯逻辑**：只算「本关累积到第几级、这一级长什么样、三个候选是什么」，
 * 不碰 Phaser、不碰存档、不碰 DOM。全部规则在 node 环境用 `tests/waveUpgrade.test.ts` 钉死，
 * `LevelScene` 只负责「画卡片 / 发箭 / 挥砍 / 改速度」。
 *
 * 设计取舍（与甲方确认过）：
 *   1. 每清一波**屏幕中间弹三选一**，由玩家自己挑，不自动升级；
 *   2. 强化只作用于**当前手持的那一件武器实例**：状态按实例隔离，换武器互不带走；
 *   3. 只在本关内有效，换关清零——不写进存档，避免动存档 schema 与版本迁移。
 *
 * **向后兼容**：所有原有导出都保留，新增参数一律带默认值 `cls='bow'` /
 * `tune=DEFAULT_WAVE_UPGRADE_TUNING`，且默认值与旧版常量完全相同。
 * 不传新参数时，弓的数值、文案、候选顺序逐字不变。
 */

import { MELEE_RANGE_MAX } from './constants';
import type { WaveUpgradeTuning, WeaponDef } from './types';

/**
 * 强化条目 id。前三个是 v1.6/v1.7 的弓+近战共用档位；后六个是 v1.8 从老游戏迁来的
 * **近战专用**攻击向条目，不会出现在弓的候选池里。
 * 加新条目要同时改 defs 表、`describeNext` / `upgradeSummary` 与 README。
 */
export type UpgradeId =
  | 'volley'
  | 'haste'
  | 'pierce'
  | 'reach'
  | 'behind'
  | 'spin'
  | 'wave'
  | 'knock'
  | 'leech';

/** 一条强化的静态定义 */
export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** 卡片上的一句话说明，**要写清本级的真实数值**，别写「提升射速」这种空话 */
  desc: string;
  /** 升到满级后卡面改成「已满级」，并且这一项不再进入候选池 */
  maxLevel: number;
  /** 卡顶色条（老游戏每张进化卡有自己的主色）；缺省用原来的金色 */
  color?: number;
  /** 老游戏的「唯一 · 不可再选」：只能取一次，卡面会标注 */
  unique?: boolean;
}

/**
 * 强化类别。
 * - `bow`：猎弓（保持 v1.6 的判定 `id === 'wp_bow'`，不改成射程区间，避免把火枪算进来）；
 * - `melee`：射程不超过 `MELEE_RANGE_MAX` 的全部近战武器（腰刀 40 / 撬棍 52），
 *   用**类别判据而不是白名单**，以后配置里新增近战武器会自动覆盖；
 * - `other`：其它远程，不参与强化，也不弹卡。
 */
export type UpgradeClass = 'bow' | 'melee' | 'other';

export function upgradeClass(w: Pick<WeaponDef, 'id' | 'range'>): UpgradeClass {
  if (w.id === 'wp_bow') return 'bow';
  if (w.range <= MELEE_RANGE_MAX) return 'melee';
  return 'other';
}

/**
 * 数值统一放在 `config.json → wave_upgrade`，这里的默认值只是「配置没加载时」的兜底。
 * 抽成可注入参数而不是在纯函数里 import 数据文件，是为了让 `tests/` 仍能在 node 里跑，
 * 也方便以后只改配置就能调数值。
 */
export const DEFAULT_WAVE_UPGRADE_TUNING: WaveUpgradeTuning = {
  max_picks: 6,
  haste_per_level: 0.08,
  volley: { spread_px: 7, damage_per_row: 0.35 },
  melee: {
    sweep_arc_per_row: 0.25,
    cleave_damage: 0.25,
    // v1.8：老游戏近战进化迁移过来的攻击向参数
    reach_per_level: 0.15,
    reach_max_level: 2,
    rear_arc_scale: 0.8,
    omni_sweep_threshold: 1.5,
    spin_every: 3,
    wave_speed: 300,
    wave_damage: 0.85,
    wave_pierce: 3,
    wave_life: 0.9,
    knockback_bonus: 6,
    stun_ms: 350,
    leech_per_hit: 2,
  },
};

/**
 * v1.8 新参数在类型里是可选的（老代码/测试里的自定义 tune 可以只写原来的 4 个字段），
 * 这里统一补齐默认值，纯函数不必到处写 `??`。
 */
export interface MeleeEvolutionTuning {
  reach_per_level: number;
  reach_max_level: number;
  rear_arc_scale: number;
  omni_sweep_threshold: number;
  spin_every: number;
  wave_speed: number;
  wave_damage: number;
  wave_pierce: number;
  wave_life: number;
  knockback_bonus: number;
  stun_ms: number;
  leech_per_hit: number;
}

export function meleeEvolutionTuning(
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): MeleeEvolutionTuning {
  const m = tune.melee ?? {};
  const d = DEFAULT_WAVE_UPGRADE_TUNING.melee;
  return {
    reach_per_level: m.reach_per_level ?? d.reach_per_level ?? 0.15,
    reach_max_level: m.reach_max_level ?? d.reach_max_level ?? 2,
    rear_arc_scale: m.rear_arc_scale ?? d.rear_arc_scale ?? 0.8,
    omni_sweep_threshold: m.omni_sweep_threshold ?? d.omni_sweep_threshold ?? 1.5,
    spin_every: m.spin_every ?? d.spin_every ?? 3,
    wave_speed: m.wave_speed ?? d.wave_speed ?? 300,
    wave_damage: m.wave_damage ?? d.wave_damage ?? 0.85,
    wave_pierce: m.wave_pierce ?? d.wave_pierce ?? 3,
    wave_life: m.wave_life ?? d.wave_life ?? 0.9,
    knockback_bonus: m.knockback_bonus ?? d.knockback_bonus ?? 6,
    stun_ms: m.stun_ms ?? d.stun_ms ?? 350,
    leech_per_hit: m.leech_per_hit ?? d.leech_per_hit ?? 2,
  };
}

/**
 * 弓的强化池。顺序就是同级时的展示顺序（先齐射再火线，玩家最容易先看到「弹幕」）。
 *
 * 数值来自与甲方确认的方案：弹幕最多 3 行、攻速每级 +8%、满级穿透 1。
 */
export const WAVE_UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'volley',
    name: '齐 射',
    desc: '弓箭改为平行多行齐射（最多 3 行）',
    maxLevel: 2,
  },
  {
    id: 'haste',
    name: '火 线',
    desc: '拉弓更快，每秒射击次数 +8%',
    maxLevel: 3,
  },
  {
    id: 'pierce',
    name: '穿 透',
    desc: '箭矢可以再穿过 1 个敌人',
    maxLevel: 1,
  },
] as const;

/**
 * 近战强化池。前 3 张与弓**同 id、同 maxLevel、同顺序**（v1.7 的对称规则保留），
 * 后 6 张是 v1.8 从老游戏迁来的攻击向进化：名称、卡面主色、唯一性都照搬旧版卡池语义。
 * 9 张的满级总和远大于 6 次上限，所以「这一关选哪 6 次」是玩家自己取舍，
 * 和老游戏「池子抽干 / 唯一项只能取一次」的体验一致。
 */
export const MELEE_UPGRADES: readonly UpgradeDef[] = [
  { id: 'volley', name: '横 扫', desc: '挥砍扇形逐级加宽（最多 ×1.50）', maxLevel: 2 },
  { id: 'haste', name: '火 线', desc: '出手更快，每秒攻击次数 +8%（最多 ×1.24）', maxLevel: 3 },
  { id: 'pierce', name: '破 甲', desc: '挥砍伤害 ×1.25', maxLevel: 1 },
  {
    id: 'reach',
    name: '刃锋延展',
    desc: '攻击距离 +15%，够得着更远的敌人',
    maxLevel: 2,
    color: 0x7298ff,
  },
  {
    id: 'behind',
    name: '背袭之刃',
    desc: '每次挥砍向正后方追加一记斩击',
    maxLevel: 1,
    color: 0xf29a59,
    unique: true,
  },
  {
    id: 'spin',
    name: '回旋斩',
    desc: '每 3 刀接一记 360° 全周斩，清身侧围攻',
    maxLevel: 1,
    color: 0xd98cf2,
    unique: true,
  },
  {
    id: 'wave',
    name: '剑气纵横',
    desc: '挥砍放出穿透剑气，可与回旋 / 背袭组合',
    maxLevel: 1,
    color: 0x80f2f2,
    unique: true,
  },
  {
    id: 'knock',
    name: '震荡强击',
    desc: '击退增强，命中使敌人短暂硬直（对首领无效）',
    maxLevel: 2,
    color: 0xccccd9,
  },
  {
    id: 'leech',
    name: '嗜血战意',
    desc: '每次命中回复 2 点生命，越战越勇',
    maxLevel: 2,
    color: 0xf27399,
  },
] as const;

/** 按类别取卡片定义；'other' 不弹卡，这里回落到弓表仅为类型完备。 */
export function upgradeDefs(cls: UpgradeClass = 'bow'): readonly UpgradeDef[] {
  return cls === 'melee' ? MELEE_UPGRADES : WAVE_UPGRADES;
}

/** id → 定义（两张表的共用 id 取先出现的那条，maxLevel 两边本来就相同） */
const ALL_UPGRADE_DEFS: Record<UpgradeId, UpgradeDef> = (() => {
  const out = {} as Record<UpgradeId, UpgradeDef>;
  for (const u of [...WAVE_UPGRADES, ...MELEE_UPGRADES]) {
    if (!out[u.id]) out[u.id] = u;
  }
  return out;
})();

/** 一关内的强化累积状态（纯数据，可存档快照，但当前只在本关内存里） */
export interface UpgradeState {
  volley: number;
  haste: number;
  pierce: number;
  /** 已经选过几次（用来算等级上限与本级描述） */
  picked: number;
  /** v1.8 近战攻击向等级：可选字段，老代码里的 `{volley,haste,pierce,picked}` 字面量仍然合法 */
  reach?: number;
  behind?: number;
  spin?: number;
  wave?: number;
  knock?: number;
  leech?: number;
}

/** 一关最多能选几次强化 = 所有条目满级所需次数之和（两类都是 2 + 3 + 1 = 6） */
export const MAX_UPGRADE_PICKS = WAVE_UPGRADES.reduce((s, u) => s + u.maxLevel, 0);

export function emptyUpgradeState(): UpgradeState {
  return {
    volley: 0,
    haste: 0,
    pierce: 0,
    picked: 0,
    reach: 0,
    behind: 0,
    spin: 0,
    wave: 0,
    knock: 0,
    leech: 0,
  };
}

/** 齐射行数 / 横扫档位：0 级 1 档（原样），1 级 2 档，2 级 3 档 */
export function volleyRows(state: UpgradeState): number {
  return 1 + Math.min(2, Math.max(0, state.volley));
}

/** 火线带来的攻速倍率：每级 +8%（两类共用同一条曲线） */
export const HASTE_PER_LEVEL = DEFAULT_WAVE_UPGRADE_TUNING.haste_per_level;
export const HASTE_MAX_LEVEL = 3;
export function hasteMult(state: UpgradeState, tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING): number {
  return 1 + tune.haste_per_level * Math.min(HASTE_MAX_LEVEL, Math.max(0, state.haste));
}

/** 穿透加成：满级 +1（弓原本 pierce = 0）；近战把它映射成破甲倍率 */
export function bonusPierce(state: UpgradeState): number {
  return Math.min(1, Math.max(0, state.pierce));
}

/**
 * 近战「横扫」：扇形角度倍率。复用 `volleyRows` 的 1/2/3 档，
 * 每档 +`melee.sweep_arc_per_row`（默认 0.25）→ ×1.00 / ×1.25 / ×1.50。
 * 判定角度与刀光角度同时乘它，玩家看到的弧线就是真实命中范围。
 */
export function sweepArcMult(
  state: UpgradeState,
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): number {
  return 1 + tune.melee.sweep_arc_per_row * (volleyRows(state) - 1);
}

/** 近战「破甲」：挥砍伤害倍率，满级 ×1.25（对应弓满级 +1 穿透）。 */
export function cleaveDmgMult(
  state: UpgradeState,
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): number {
  return 1 + tune.melee.cleave_damage * bonusPierce(state);
}

/* ==================== v1.8：老游戏「近战攻击向进化」纯函数 ====================
 * 全部返回「这一刀该怎么打」的数据，不碰 Phaser；LevelScene.playerAttack 照着执行。
 * 0 级一律是单位元 / 空数组 / false，所以未选这些卡时近战手感一字不变。
 */

/** 刃锋延展：攻击距离倍率，判定半径与刀光半径同时乘它。 */
export function meleeReachMult(
  state: UpgradeState,
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): number {
  const t = meleeEvolutionTuning(tune);
  return 1 + t.reach_per_level * Math.min(t.reach_max_level, Math.max(0, state.reach ?? 0));
}

export function hasRearSlash(state: UpgradeState): boolean {
  return (state.behind ?? 0) > 0;
}
export function hasSpin(state: UpgradeState): boolean {
  return (state.spin ?? 0) > 0;
}
export function hasSwordWave(state: UpgradeState): boolean {
  return (state.wave ?? 0) > 0;
}

/** 回旋斩：每 `spin_every` 次挥砍接一记全周斩（老游戏是每 3 刀）。 */
export function shouldSpin(
  state: UpgradeState,
  swingCount: number,
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): boolean {
  const t = meleeEvolutionTuning(tune);
  return hasSpin(state) && swingCount > 0 && t.spin_every > 0 && swingCount % t.spin_every === 0;
}

/** 老游戏组合技：背袭 + 扇形够宽 → 前后都覆盖，近似 360° 全向命中。 */
export function isOmniSlash(
  state: UpgradeState,
  sweepMult: number,
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): boolean {
  const t = meleeEvolutionTuning(tune);
  // 老游戏只判「本次不是回旋刀 + 背袭 + 扇形够宽」，**不要求没选过回旋斩**：
  // 两卡都拿了时，非回旋的普通刀照样是近似全向，回旋那一刀另走八方剑气环。
  return hasRearSlash(state) && sweepMult >= t.omni_sweep_threshold;
}

export interface MeleeHitArc {
  /** 扇形中心角（弧度） */
  center: number;
  /** 半角（弧度）；Math.PI 表示全周 */
  half: number;
}

/**
 * 这一刀的命中扇形列表。全周斩或「背袭+横扫」组合时直接给一整圈（避免同一敌人被前后各判一次）。
 * 老游戏用点积阈值判扇形，这里沿用当前项目的角度判据，语义一致。
 */
export function meleeHitArcs(
  state: UpgradeState,
  baseAngle: number,
  arcRad: number,
  opts: { spin: boolean; sweepMult: number },
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): MeleeHitArc[] {
  const t = meleeEvolutionTuning(tune);
  if (opts.spin || isOmniSlash(state, opts.sweepMult, tune)) {
    return [{ center: baseAngle, half: Math.PI }];
  }
  const arcs: MeleeHitArc[] = [{ center: baseAngle, half: arcRad / 2 }];
  if (hasRearSlash(state)) {
    arcs.push({ center: baseAngle + Math.PI, half: (arcRad * t.rear_arc_scale) / 2 });
  }
  return arcs;
}

/**
 * 剑气方向（相对挥砍基准角的偏移，弧度）。照搬老游戏的三组组合：
 * 回旋→八方剑气环；背袭+横扫→四向剑气扇；背袭→前后双向；否则正前方一道。
 */
export function swordWaveOffsets(
  state: UpgradeState,
  opts: { spin: boolean; sweepMult: number },
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): number[] {
  if (!hasSwordWave(state)) return [];
  const n = opts.spin ? 8 : isOmniSlash(state, opts.sweepMult, tune) ? 4 : hasRearSlash(state) ? 2 : 1;
  return Array.from({ length: n }, (_, i) => (i * Math.PI * 2) / n);
}

export function meleeKnockbackBonus(
  state: UpgradeState,
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): number {
  return (state.knock ?? 0) * meleeEvolutionTuning(tune).knockback_bonus;
}
export function meleeStunMs(
  state: UpgradeState,
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): number {
  return (state.knock ?? 0) > 0 ? meleeEvolutionTuning(tune).stun_ms : 0;
}
export function meleeLeech(
  state: UpgradeState,
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): number {
  return (state.leech ?? 0) * meleeEvolutionTuning(tune).leech_per_hit;
}

/**
 * 相邻两行箭矢之间的横向/纵向间距（像素）。
 *
 * 为什么是「垂直于飞行方向偏移 7px」而不是固定上下两行：
 * 弓的判定半径是 16px（`updateProjectiles` 里的距离判定），偏 7px 既不会两颗箭落在
 * 同一个敌人身上白给，也不会偏到打不中——斜着朝右上射时，固定上下两行会有一行完全错开。
 */
export const VOLLEY_SPREAD_PX = DEFAULT_WAVE_UPGRADE_TUNING.volley.spread_px;

/**
 * 一次齐射的全部箭矢方向与出口偏移。
 *
 * 返回的每一项都是「相对于玩家、沿垂直于 dir 的方向偏移 offset 像素」。
 * 3 行时是 -7 / 0 / +7，2 行时是 -3.5 / +3.5，1 行时是 0。
 */
export function volleyOffsets(rows: number, tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING): number[] {
  const spread = tune.volley.spread_px;
  const r = Math.max(1, Math.min(3, Math.round(rows)));
  if (r === 1) return [0];
  if (r === 2) return [-spread / 2, spread / 2];
  return [-spread, 0, spread];
}

/**
 * 这一级强化会变成什么样（卡片上用）。
 * 返回**升级之后**的值，而不是「+1 行」这种增量——玩家看到的是结果。
 */
export function describeNext(
  state: UpgradeState,
  id: UpgradeId,
  cls: UpgradeClass = 'bow',
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): string {
  const next: UpgradeState = { ...state, [id]: (state[id] ?? 0) + 1, picked: state.picked + 1 };
  if (cls === 'melee') {
    switch (id) {
      case 'volley':
        return `挥砍扇形 ×${sweepArcMult(next, tune).toFixed(2)}，横扫更宽`;
      case 'haste':
        // 近战基础攻速按武器不同（腰刀 2.22 / 撬棍 0.95），纯函数不知道当前武器，
        // 所以只写倍率，不写「每秒 N 次」——写了就会对撬棍说谎。
        return `出手更快，攻速 ×${hasteMult(next, tune).toFixed(2)}`;
      case 'pierce':
        return `挥砍伤害 ×${cleaveDmgMult(next, tune).toFixed(2)}`;
      case 'reach':
        return `攻击距离 ×${meleeReachMult(next, tune).toFixed(2)}，够得更远`;
      case 'behind':
        return '背后追加一记斩击';
      case 'spin':
        return `每 ${meleeEvolutionTuning(tune).spin_every} 刀一记全周斩`;
      case 'wave':
        return '剑气穿透，可及远处';
      case 'knock':
        return `击退 +${meleeKnockbackBonus(next, tune).toFixed(0)}，命中硬直`;
      case 'leech':
        return `每次命中回复 ${meleeLeech(next, tune).toFixed(0)} 点生命`;
      default:
        return '';
    }
  }
  switch (id) {
    case 'volley':
      return `箭矢 ${volleyRows(next)} 行平行齐射，覆盖更宽`;
    case 'haste':
      return `射速 ×${hasteMult(next, tune).toFixed(2)}（每秒 ${fmtRate(1.67 * hasteMult(next, tune))} 次）`;
    case 'pierce':
      // 注意这里写的是「+N 层穿透」而不是「穿透 N 个」：弓本身 pierce = 0，
      // 拿满后是 1 层，卡片上要讲清「还能多穿过一个」才和 HUD 摘要对得上。
      return `箭矢额外穿透 +${bonusPierce(next)}（可再穿过 1 个敌人）`;
    default:
      return '';
  }
}

function fmtRate(v: number): string {
  return (Math.round(v * 100) / 100).toFixed(2);
}

/**
 * 本次该给玩家哪三个候选。
 *
 * 规则：
 *   - 已满级的条目**不出现在池子里**（否则会出现「选了个没用的」）；
 *   - 池子够 3 个就取前 3 个；不够就都返回（例如最后只剩一项没满级，就只弹这一项）；
 *   - 用调用方传入的 `rng` 打乱，便于测试注入固定随机数。**不在这里调用 Math.random**，
 *     否则单测没法断言顺序。
 * 两类共用同一组 id / maxLevel，所以「上限与重置规则」天然一致，只是卡面名字随类别变。
 */
export function pickUpgradeChoices(
  state: UpgradeState,
  rng: () => number,
  cls: UpgradeClass = 'bow',
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): UpgradeDef[] {
  // 近战扩到 9 张后，卡池本身不可能在 6 次内被抽干，必须由「本关 6 次上限」收口。
  // 弓的 3 张卡满级之和正好也是 6，所以这一条对弓完全等价、行为不变。
  if (upgradesExhausted(state, cls, tune)) return [];
  const pool = upgradeDefs(cls).filter((u) => (state[u.id] ?? 0) < u.maxLevel);
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, 3);
}

/** 选中一条强化（返回新状态，不改原对象——避免场景里持有旧引用到处改） */
export function applyUpgrade(
  state: UpgradeState,
  id: UpgradeId,
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): UpgradeState {
  const def = ALL_UPGRADE_DEFS[id];
  if (!def) return state;
  const cur = state[id] ?? 0;
  // 已满级 / 本关 6 次已用完就当没点：防止 E2E 与键盘连点把等级刷过上限。
  // `picked` 也不涨 —— 一次没生效的点击不该算进「本关已选次数」。
  if (cur >= def.maxLevel || state.picked >= tune.max_picks) return state;
  return { ...state, [id]: cur + 1, picked: state.picked + 1 };
}

/** 是否已经不能再弹卡：本关 6 次用完，或该类别的条目全部满级。 */
export function upgradesExhausted(
  state: UpgradeState,
  cls: UpgradeClass = 'bow',
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): boolean {
  if (state.picked >= tune.max_picks) return true;
  return upgradeDefs(cls).every((u) => (state[u.id] ?? 0) >= u.maxLevel);
}

/**
 * HUD / 卡片 / toast 上那一行强化摘要，例：`齐射 2 行 · 射速 ×1.08`。没强化过就返回空串。
 * 玩家需要能随时看到「我现在强到什么程度」，只靠一波一次的 toast 会记不住。
 */
export function upgradeSummary(
  state: UpgradeState,
  cls: UpgradeClass = 'bow',
  tune: WaveUpgradeTuning = DEFAULT_WAVE_UPGRADE_TUNING,
): string {
  // 判空看「有没有真的等级」，不只看 picked：调试注入 / 脏存档可能只给了等级没给 picked，
  // 那时玩家明明吃着强化，卡片摘要却显示空白。
  const anyLevel =
    state.picked > 0 ||
    ['volley', 'haste', 'pierce', 'reach', 'behind', 'spin', 'wave', 'knock', 'leech'].some(
      (k) => (state[k as keyof UpgradeState] ?? 0) > 0,
    );
  if (!anyLevel) return '';
  const parts: string[] = [];
  if (cls === 'melee') {
    if (state.volley > 0) parts.push(`横扫 ×${sweepArcMult(state, tune).toFixed(2)}`);
    if (state.haste > 0) parts.push(`攻速 ×${hasteMult(state, tune).toFixed(2)}`);
    if (state.pierce > 0) parts.push(`伤害 ×${cleaveDmgMult(state, tune).toFixed(2)}`);
    if ((state.reach ?? 0) > 0) parts.push(`距离 ×${meleeReachMult(state, tune).toFixed(2)}`);
    if (hasRearSlash(state)) parts.push('背袭');
    if (hasSpin(state)) parts.push('回旋');
    if (hasSwordWave(state)) parts.push('剑气');
    if ((state.knock ?? 0) > 0) parts.push('震荡');
    if ((state.leech ?? 0) > 0) parts.push('嗜血');
    return parts.join(' · ');
  }
  if (state.volley > 0) parts.push(`齐射 ${volleyRows(state)} 行`);
  if (state.haste > 0) parts.push(`射速 ×${hasteMult(state, tune).toFixed(2)}`);
  if (state.pierce > 0) parts.push(`穿透 +${bonusPierce(state)}`);
  return parts.join(' · ');
}

/**
 * 状态隔离的容器：一把武器实例一份状态。
 *
 * 放在纯逻辑层而不是场景里散落几个字段，是为了让「换武器不带走强化、换回来还在、
 * 换关全清」这三条能被单测直接钉死。key 由场景按装备 uid（或武器 ref 兜底）生成。
 */
export class UpgradeBook {
  private readonly states = new Map<string, UpgradeState>();

  get(key: string): UpgradeState {
    return this.states.get(key) ?? emptyUpgradeState();
  }

  set(key: string, state: UpgradeState): UpgradeState {
    this.states.set(key, state);
    return state;
  }

  /** 选中一条并落回同一个 key，返回新状态；不改旧对象 */
  pick(key: string, id: UpgradeId): UpgradeState {
    return this.set(key, applyUpgrade(this.get(key), id));
  }

  clear(): void {
    this.states.clear();
  }

  /** 调试 / 探针快照：返回副本，外部改它不会污染真值 */
  snapshot(): Record<string, UpgradeState> {
    return Object.fromEntries([...this.states].map(([k, v]) => [k, { ...v }]));
  }

  get size(): number {
    return this.states.size;
  }
}
