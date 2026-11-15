/**
 * 兵种小人的「帧动画」纯函数层 —— 设计书 7.1「单位行走与攻击动画帧 ⬜ 未做」。
 *
 * 为什么要在运行时派生帧，而不是再要一套图：
 *   1. `art/units/*.png` 是甲方一张张出的整图（24×32，四朝向，共 8 个兵种），
 *      没有分件、没有骨骼，`CharacterRig` 只能整体上下浮动 + 歪 2°——甲方原话
 *      「为什么一开始的小人动作很流畅，贴上图就不行了」，根因就在这。
 *   2. 重出图不可行；但**像素图可以按行/列重排**：小人下半身永远是两条腿（正面）
 *      或一条腿带（侧面），把其中一条腿抬 1px、或把上身往前错 1px，就是标准的
 *      两帧步态和出手帧——这正是手绘 24×32 跑步循环的画法。
 *   3. 派生出来的帧在浏览器里一次性烘成纹理（`gfx/UnitFrames.ts`），不占资源、
 *      不改任何数据，缺图/贴图模式关闭时自动不生效。
 *
 * 本模块只做**数组运算**，不 import Phaser，所以能在 node 里断言：
 *   `tests/unitFrames.test.ts` 用合成掩膜验证「腿带识别」「抬腿帧只动腿」「出手帧只动上身」。
 */

/** 二值掩膜：`a[i] = 1` 表示该像素不透明。行优先，长度 `w * h`。 */
export interface Mask {
  w: number;
  h: number;
  a: Uint8Array;
}

/** 一行里连续不透明像素的区间（含首尾） */
export interface Span {
  x0: number;
  x1: number;
}

export interface FramePlan {
  /** 腿带第一行：`[legTop, h)` 这段是腿 */
  legTop: number;
  /** 腿带里检测到的实心段。正面 2 段（两条腿），侧面 1 段（前后腿叠在一起） */
  spans: Span[];
  /** 只有一段 → 侧面视角，帧的做法改成「左右错 1px」而不是「抬一条腿」 */
  side: boolean;
}

export function emptyMask(w: number, h: number): Mask {
  return { w, h, a: new Uint8Array(w * h) };
}

export function maskAt(m: Mask, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return 0;
  return m.a[y * m.w + x];
}

export function cloneMask(m: Mask): Mask {
  return { w: m.w, h: m.h, a: m.a.slice() };
}

/** 某一行里所有不透明段（从左到右） */
export function rowSpans(m: Mask, y: number): Span[] {
  const out: Span[] = [];
  let start = -1;
  for (let x = 0; x < m.w; x++) {
    const on = maskAt(m, x, y) !== 0;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      out.push({ x0: start, x1: x - 1 });
      start = -1;
    }
  }
  if (start >= 0) out.push({ x0: start, x1: m.w - 1 });
  return out;
}

/** 行内不透明像素总宽度（用来区分「腿带」和「躯干」：腿一定比躯干窄） */
export function rowInk(m: Mask, y: number): number {
  let n = 0;
  for (let x = 0; x < m.w; x++) if (maskAt(m, x, y) !== 0) n++;
  return n;
}

/** 最底下一行有像素的行号；整张空图返回 -1 */
export function bottomRow(m: Mask): number {
  for (let y = m.h - 1; y >= 0; y--) if (rowInk(m, y) > 0) return y;
  return -1;
}

/**
 * 识别腿带。
 *
 * 判据只有两条，都是像素小人身上稳定成立的：
 *   ① 从脚底往上走，只要「段数」与「墨迹宽度」跟脚底那行一致，就还算腿；
 *   ② 一旦变宽（撞上躯干下摆）或段数变化（撞上躯干），腿带到此为止。
 *
 * 取脚底往上第 2 行当基准，不取最底一行：最底一行常常是鞋（比腿宽 1px），
 * 拿它当基准会把腿带判宽，抬腿帧就会连躯干一起抬。
 */
export function planFrames(m: Mask): FramePlan | null {
  const bottom = bottomRow(m);
  if (bottom < 4) return null;
  const baseY = bottom - 1 >= 0 ? bottom - 1 : bottom;
  const baseSpans = rowSpans(m, baseY);
  if (baseSpans.length === 0) return null;
  const baseInk = rowInk(m, baseY);

  let top = baseY;
  for (let y = baseY - 1; y >= 0; y--) {
    const spans = rowSpans(m, y);
    const ink = rowInk(m, y);
    // 段数变了（两腿 → 躯干）或明显变宽（下摆/手臂）就停
    if (spans.length !== baseSpans.length) break;
    if (ink > baseInk + 1) break;
    if (ink < baseInk) break;
    top = y;
  }
  // 腿带长度得「像腿」：短于 3 行没地方抬脚，长过全高的 55% 那是整块色块（不是人）
  const legH = bottom - top + 1;
  if (legH < 3 || legH > Math.max(4, Math.round(m.h * 0.55))) return null;
  // 整个人还得够高（≥ 画布 60%）：只有一截腿的色块同样不认，否则抬腿帧等于把这块平移掉
  let figTop = bottom;
  for (let y = 0; y <= bottom; y++) {
    if (rowInk(m, y) > 0) {
      figTop = y;
      break;
    }
  }
  if (bottom - figTop + 1 < Math.round(m.h * 0.6)) return null;
  return { legTop: top, spans: baseSpans, side: baseSpans.length === 1 };
}

/**
 * 把 `[x0,x1] × [y0,y1]` 这块像素整体平移 `(dx,dy)`，源位置清空。
 * 越界的部分丢掉（像素图就是这么处理的，不做环绕）。
 */
export function translateMask(m: Mask, x0: number, y0: number, x1: number, y1: number, dx: number, dy: number): Mask {
  const out = cloneMask(m);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      out.a[y * m.w + x] = 0;
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      if (maskAt(m, x, y) === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      out.a[ny * m.w + nx] = 1;
    }
  }
  return out;
}

export interface StepFrames {
  /** 迈左脚：正面抬左腿；侧面整条腿带往左错 1px */
  stepA: Mask;
  /** 迈右脚 */
  stepB: Mask;
  /** 出手：上半身（腿带以上）朝朝向错 1px —— 配 `CharacterRig` 的前冲位移就是「压身上前」 */
  swing: Mask;
}

/**
 * 生成两帧步态 + 一帧出手。
 *
 * `dir` 是朝向在 x 轴上的符号（朝右 +1 / 朝左 -1 / 上下给 +1）。
 * 正面与背面（两段腿）抬腿时把那条腿整体上移 1px：像素画里「脚离地一格」就是一步。
 * 侧面（一段腿）两条腿叠在一起，改成整条腿带左右错 1px——前腿出去、后腿留在地上。
 */
export function buildStepFrames(m: Mask, plan: FramePlan, dir: 1 | -1 = 1): StepFrames | null {
  const [a, b] = plan.spans;
  const bottom = bottomRow(m);
  if (!a || bottom < 0) return null;

  if (plan.side) {
    // 侧面：腿带整体前后错 1px（上边留 1 行接住胯部，不然腿会脱开身体）
    const y0 = Math.min(plan.legTop + 1, bottom);
    const stepA = translateMask(m, a.x0, y0, a.x1, bottom, dir, 0);
    const stepB = translateMask(m, a.x0, y0, a.x1, bottom, -dir as 1 | -1, 0);
    const swing = translateMask(m, 0, 0, m.w - 1, plan.legTop - 1, dir, 0);
    return { stepA, stepB, swing };
  }

  if (!b) return null;
  // 正面/背面：抬一条腿 1px（抬腿时脚底离地，视觉上就是迈步）
  const lift = (s: Span, m0: Mask): Mask => translateMask(m0, s.x0, plan.legTop, s.x1, bottom, 0, -1);
  const swing = translateMask(m, 0, 0, m.w - 1, plan.legTop - 1, dir, 0);
  return { stepA: lift(a, m), stepB: lift(b, m), swing };
}

/** 掩膜是否为空（派生帧失败时用来兜底） */
export function isEmptyMask(m: Mask): boolean {
  for (let i = 0; i < m.a.length; i++) if (m.a[i]) return false;
  return true;
}
