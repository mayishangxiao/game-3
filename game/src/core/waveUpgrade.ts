/**
 * 波次强化（设计：甲方要求「每波次强化系统，只对弓强化，比如弹幕变两行之类的」）。
 *
 * 这个文件是**纯逻辑**：只算出「本关累积到第几级强化、这一级的弓长什么样、
 * 三个候选分别是什么」，不碰 Phaser、不碰存档、不碰 DOM。
 * 好处是全部规则都能在 node 环境用 `tests/waveUpgrade.test.ts` 钉死，
 * `LevelScene` 只负责「画卡片 / 发箭 / 改速度」。
 *
 * 设计取舍（与甲方确认过）：
 *   1. 每清一波**屏幕中间弹三选一**，由玩家自己挑，不自动升级；
 *   2. 强化只作用于弓（甲方原话「只对弓强化」），刀/火枪/机枪不受影响；
 *   3. 只在本关内有效，换关清零——不写进存档，避免动存档 schema 与版本迁移。
 */

/** 强化条目 id。加新条目要同时改 `WAVE_UPGRADES`、`applyUpgrade` 与 README。 */
export type UpgradeId = 'volley' | 'haste' | 'pierce';

/** 一条强化的静态定义 */
export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** 卡片上的一句话说明，**要写清本级的真实数值**，别写「提升射速」这种空话 */
  desc: string;
  /** 升到满级后卡面改成「已满级」，并且这一项不再进入候选池 */
  maxLevel: number;
}

/**
 * 强化池。顺序就是同级时的展示顺序（先齐射再火线，玩家最容易先看到「弹幕」）。
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

/** 一关内的强化累积状态（纯数据，可存档快照，但当前只在本关内存里） */
export interface UpgradeState {
  volley: number;
  haste: number;
  pierce: number;
  /** 已经选过几次（用来算等级上限与本级描述） */
  picked: number;
}

/** 一关最多能选几次强化 = 所有条目满级所需次数之和 */
export const MAX_UPGRADE_PICKS = WAVE_UPGRADES.reduce((s, u) => s + u.maxLevel, 0);

export function emptyUpgradeState(): UpgradeState {
  return { volley: 0, haste: 0, pierce: 0, picked: 0 };
}

/** 齐射行数：0 级 1 行（原样单发），1 级 2 行，2 级 3 行 */
export function volleyRows(state: UpgradeState): number {
  return 1 + Math.min(2, Math.max(0, state.volley));
}

/** 火线带来的攻速倍率：每级 +8% */
export const HASTE_PER_LEVEL = 0.08;
export function hasteMult(state: UpgradeState): number {
  return 1 + HASTE_PER_LEVEL * Math.min(3, Math.max(0, state.haste));
}

/** 穿透加成：满级 +1（弓原本 pierce = 0） */
export function bonusPierce(state: UpgradeState): number {
  return Math.min(1, Math.max(0, state.pierce));
}

/**
 * 相邻两行箭矢之间的横向/纵向间距（像素）。
 *
 * 为什么是「垂直于飞行方向偏移 7px」而不是固定上下两行：
 * 弓的判定半径是 16px（`updateProjectiles` 里的距离判定），偏 7px 既不会两颗箭落在
 * 同一个敌人身上白给，也不会偏到打不中——斜着朝右上射时，固定上下两行会有一行完全错开。
 */
export const VOLLEY_SPREAD_PX = 7;

/**
 * 一次齐射的全部箭矢方向与出口偏移。
 *
 * 返回的每一项都是「相对于玩家、沿垂直于 dir 的方向偏移 offset 像素」。
 * 3 行时是 -7 / 0 / +7，2 行时是 -3.5 / +3.5，1 行时是 0。
 */
export function volleyOffsets(rows: number): number[] {
  const r = Math.max(1, Math.min(3, Math.round(rows)));
  if (r === 1) return [0];
  if (r === 2) return [-VOLLEY_SPREAD_PX / 2, VOLLEY_SPREAD_PX / 2];
  return [-VOLLEY_SPREAD_PX, 0, VOLLEY_SPREAD_PX];
}

/**
 * 这一级强化会变成什么样（卡片上用）。
 * 返回**升级之后**的值，而不是「+1 行」这种增量——玩家看到的是结果。
 */
export function describeNext(state: UpgradeState, id: UpgradeId): string {
  const next: UpgradeState = { ...state, [id]: (state[id] ?? 0) + 1, picked: state.picked + 1 };
  switch (id) {
    case 'volley':
      return `箭矢 ${volleyRows(next)} 行平行齐射，覆盖更宽`;
    case 'haste':
      return `射速 ×${hasteMult(next).toFixed(2)}（每秒 ${fmtRate(1.67 * hasteMult(next))} 次）`;
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
 */
export function pickUpgradeChoices(state: UpgradeState, rng: () => number): UpgradeDef[] {
  const pool = WAVE_UPGRADES.filter((u) => (state[u.id] ?? 0) < u.maxLevel);
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, 3);
}

/** 选中一条强化（返回新状态，不改原对象——避免场景里持有旧引用到处改） */
export function applyUpgrade(state: UpgradeState, id: UpgradeId): UpgradeState {
  const def = WAVE_UPGRADES.find((u) => u.id === id);
  if (!def) return state;
  const cur = state[id] ?? 0;
  // 已满级就当没点：防止 E2E / 键盘连点把等级刷过上限
  if (cur >= def.maxLevel) return { ...state, picked: state.picked + 1 };
  return { ...state, [id]: cur + 1, picked: state.picked + 1 };
}

/** 是否已经满级（三张卡全满后就不再弹卡） */
export function upgradesExhausted(state: UpgradeState): boolean {
  return WAVE_UPGRADES.every((u) => (state[u.id] ?? 0) >= u.maxLevel);
}

/**
 * HUD 上那一行强化摘要，例：`齐射 2 行 · 射速 ×1.08`。没强化过就返回空串。
 * 玩家需要能随时看到「我现在强到什么程度」，只靠一波一次的 toast 会记不住。
 */
export function upgradeSummary(state: UpgradeState): string {
  if (state.picked === 0) return '';
  const parts: string[] = [];
  if (state.volley > 0) parts.push(`齐射 ${volleyRows(state)} 行`);
  if (state.haste > 0) parts.push(`射速 ×${hasteMult(state).toFixed(2)}`);
  if (state.pierce > 0) parts.push(`穿透 +${bonusPierce(state)}`);
  return parts.join(' · ');
}