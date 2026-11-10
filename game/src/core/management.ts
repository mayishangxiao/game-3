/**
 * 天京经营模块的纯逻辑 —— 设计书 3.3.2「场景 B：天京经营」。
 *
 * 设计意图（必须靠机制表达，而不是靠文案）：
 *   总点数固定 6 点，逐月上涨的消耗使它**无论怎么分都不够**。
 *   玩家必然要牺牲一项——这就是「农民阶级的局限性」：
 *   不是不努力，而是没有能力建立一套科学的社会制度。
 *
 * 因此本模块的可测性质是：**任何分配策略最终都会崩**。
 */

export interface ManageTrack {
  /** 粮草 */
  food: number;
  /** 兵员 */
  troops: number;
  /** 民心 */
  morale: number;
}

export interface MonthReport {
  month: number;
  alloc: ManageTrack;
  decay: number;
  stockAfter: ManageTrack;
  events: string[];
  /** 本月三项是否都 ≥ 2（设计书中的「盛世」） */
  golden: boolean;
}

export interface ManageState {
  month: number;
  stock: ManageTrack;
  history: MonthReport[];
  done: boolean;
}

/** 共推进 8 个月（史实上太平天国定都天京后由盛转衰的压缩表达） */
export const MANAGE_MONTHS = 8;
/** 每月可分配点数 */
export const MONTHLY_POINTS = 6;
/** 起始储备 */
export const INITIAL_STOCK: ManageTrack = { food: 4, troops: 4, morale: 4 };
/** 触发负面事件的阈值 */
export const TRACK_THRESHOLD = 2;
/** 单项每月最多可分配 */
export const TRACK_MAX = 4;

export function createManageState(): ManageState {
  return {
    month: 1,
    stock: { ...INITIAL_STOCK },
    history: [],
    done: false,
  };
}

/**
 * 每月消耗随月份上涨：第 1—3 月为 2，第 4—6 月为 3，第 7—8 月为 4。
 * 而每月只有 6 点可分——所以总供给永远追不上总消耗，只能此消彼长。
 */
export function decayFor(month: number): number {
  return 2 + Math.floor((Math.max(1, month) - 1) / 3);
}

export function allocTotal(a: ManageTrack): number {
  return a.food + a.troops + a.morale;
}

export function validateAlloc(a: ManageTrack): { ok: boolean; reason?: string } {
  const values = [a.food, a.troops, a.morale];
  if (values.some((v) => !Number.isInteger(v) || v < 0)) {
    return { ok: false, reason: '分配值必须是不小于 0 的整数' };
  }
  if (values.some((v) => v > TRACK_MAX)) {
    return { ok: false, reason: `单项最多分配 ${TRACK_MAX} 点` };
  }
  if (allocTotal(a) !== MONTHLY_POINTS) {
    return { ok: false, reason: `必须正好分配 ${MONTHLY_POINTS} 点` };
  }
  return { ok: true };
}

/**
 * 结算一个月：新值 = max(0, 旧值 + 分配 − 消耗)，随后按阈值触发事件。
 */
export function settleMonth(state: ManageState, alloc: ManageTrack): MonthReport {
  const check = validateAlloc(alloc);
  if (!check.ok) throw new Error(`非法分配：${check.reason}`);

  const decay = decayFor(state.month);
  const next: ManageTrack = {
    food: Math.max(0, state.stock.food + alloc.food - decay),
    troops: Math.max(0, state.stock.troops + alloc.troops - decay),
    morale: Math.max(0, state.stock.morale + alloc.morale - decay),
  };

  const events: string[] = [];
  // 粮草告急 → 兵员流失
  if (next.food < TRACK_THRESHOLD) {
    events.push('粮草告急，兵员流失');
    next.troops = Math.max(0, next.troops - 1);
  }
  // 兵员不足 → 城防失修
  if (next.troops < TRACK_THRESHOLD) {
    events.push('兵员不足，城墙失修');
  }
  // 民心离散 → 逃亡，粮草与兵员同时下降
  if (next.morale < TRACK_THRESHOLD) {
    events.push('人心离散，出现逃亡');
    next.food = Math.max(0, next.food - 1);
    next.troops = Math.max(0, next.troops - 1);
  }

  const golden = next.food >= TRACK_THRESHOLD && next.troops >= TRACK_THRESHOLD && next.morale >= TRACK_THRESHOLD;
  if (golden) events.push('三事俱备，天京暂安');

  const report: MonthReport = {
    month: state.month,
    alloc: { ...alloc },
    decay,
    stockAfter: { ...next },
    events,
    golden,
  };

  state.stock = next;
  state.history.push(report);
  state.month += 1;
  if (state.month > MANAGE_MONTHS) state.done = true;
  return report;
}

/** 当前是否还能继续分配；返回剩余点数提示 */
export function remainingPoints(alloc: ManageTrack): number {
  return MONTHLY_POINTS - allocTotal(alloc);
}

/** 用给定策略一次性跑完全程（供测试与「自动推演」使用） */
export function simulate(strategy: (state: ManageState) => ManageTrack): ManageState {
  const state = createManageState();
  let guard = 0;
  while (!state.done && guard < MANAGE_MONTHS + 2) {
    const alloc = strategy(state);
    settleMonth(state, alloc);
    guard += 1;
  }
  return state;
}

export interface ManageVerdict {
  title: string;
  body: string;
  goldenMonths: number;
  /** 结束时三项总和 */
  finalSum: number;
}

/**
 * 结算评语。设计书要求：**无论玩家怎么分，结算文案都是「天京的粮仓渐渐空了」**。
 * 三项总值只影响补充的一句，不改变结论。
 */
export function finalVerdict(state: ManageState): ManageVerdict {
  const goldenMonths = state.history.filter((h) => h.golden).length;
  const finalSum = state.stock.food + state.stock.troops + state.stock.morale;

  let body: string;
  if (state.stock.morale < TRACK_THRESHOLD) {
    body = '人心散了，粮再多也留不住人。';
  } else if (state.stock.troops < TRACK_THRESHOLD) {
    body = '城墙上没有兵了，粮草堆在仓里也只是别人的。';
  } else if (state.stock.food < TRACK_THRESHOLD) {
    body = '兵还在，人心还在，可是锅里没有米了。';
  } else {
    body = '守住了，但每个人都知道这样守不了太久。';
  }

  return {
    title: '天京的粮仓渐渐空了',
    body,
    goldenMonths,
    finalSum,
  };
}

/* ==================== 面板几何（v1.6.3） ==================== */
/**
 * 经营面板在 480×270 逻辑画布里的**唯一坐标源**。
 *
 * canvas 图元（Phaser rectangle）与 DOM 文字层（showOverlay 的绝对定位 div）
 * 以前各写各的魔数：确认按钮矩形中心是 x=200，文字层却写 left:200;width:120
 * （中心 260），整行字偏出 60px；右上预算条用 right:46 顶出了面板右边界；
 * 加减号文字没给宽度，text-align:center 对 shrink-to-fit 的盒子等于没写。
 * 手机竖屏把画面整体旋转 90° 后，这些偏移被放大成「字配歪了」。
 * 两边共用这里的数字，配合 managementTextLayout() 的同心文字盒即可杜绝。
 */
export const MANAGE_LAYOUT = {
  /** 面板矩形：中心 + 尺寸 → x 20..380, y 17..247 */
  panel: { cx: 200, cy: 132, w: 360, h: 230 },
  /** 三行卡片：首行中心 y、行距、行矩形尺寸 */
  row: { y0: 66, step: 34, w: 332, h: 30 },
  /** 行内名称 / 库存文字的 left */
  nameX: 48,
  stockX: 96,
  /** 4 个分配点格子 */
  pips: { x0: 206, step: 16, size: 12 },
  /** 减 / 加按钮中心 x 与尺寸 */
  minusX: 300,
  plusX: 326,
  btnW: 20,
  btnH: 22,
  /** 确认按钮：中心 + 尺寸 → x 140..260, y 221..243 */
  confirm: { cx: 200, cy: 232, w: 120, h: 22 },
} as const;

export interface TextBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** DOM 文字盒：全部落在面板内，且与同名的 canvas 图元同心。 */
export function managementTextLayout() {
  const L = MANAGE_LAYOUT;
  const pad = 14;
  const innerLeft = L.panel.cx - L.panel.w / 2 + pad; // 34
  const innerRight = L.panel.cx + L.panel.w / 2 - pad; // 366
  const innerW = innerRight - innerLeft; // 332
  const rowY = (i: number) => L.row.y0 + i * L.row.step;
  const centered = (cx: number, w: number, cy: number, h: number): TextBox => ({
    left: cx - w / 2,
    top: cy - h / 2,
    width: w,
    height: h,
  });
  return {
    innerLeft,
    innerRight,
    innerW,
    title: { left: innerLeft, top: 16, width: 170, height: 18 },
    budget: { left: innerRight - 156, top: 16, width: 156, height: 18 },
    // 提示行必须在第一行卡片（顶边 51）之上收住，且用 nowrap + 窄字号保证整句不越界
    hint: { left: innerLeft, top: 35, width: innerW, height: 15 },
    rows: [0, 1, 2].map((i) => ({
      name: { left: L.nameX, top: rowY(i) - L.row.h / 2, width: 44, height: L.row.h },
      stock: { left: L.stockX, top: rowY(i) - L.row.h / 2, width: 96, height: L.row.h },
      minus: centered(L.minusX, L.btnW, rowY(i), L.btnH),
      plus: centered(L.plusX, L.btnW, rowY(i), L.btnH),
    })),
    // 结算 / 结语统一占 172..212，按钮顶边 221，互不压字
    report: { left: innerLeft, top: 172, width: innerW - 2, height: 40 },
    verdict: { left: innerLeft, top: 172, width: innerW - 2, height: 40 },
    confirmLabel: centered(L.confirm.cx, L.confirm.w, L.confirm.cy, L.confirm.h),
  };
}