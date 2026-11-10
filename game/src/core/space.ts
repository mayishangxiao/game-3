/**
 * 纯几何工具：把「卡在不可走区域里的人」挪到最近的空地。
 *
 * 为什么单独放一个模块：玩家反馈「闪现到军舰碾出来的水坑里就走不出去」，
 * 根因是海面**不是地图碰撞格**，而是运行时的额外禁区（`Player.setBlocker`）。
 * 原来的脱困函数只检测 `map.isSolidAtWorld`，对海面永远返回 false，于是从来没生效。
 * 这里把「找最近空地」抽成纯函数：不 import Phaser，可以单测，
 * 也顺手把「往左退 6px」这种只对一个方向有效的写法换成了环形搜索。
 */

export interface OpenPointQuery {
  /** 地图列数 / 行数 */
  cols: number;
  rows: number;
  /** 一格多少世界像素 */
  tile: number;
  /** 该点是否不可站（撞墙 或 海面） */
  blocked: (px: number, py: number) => boolean;
  /** 最多搜几圈（一圈 = 一格） */
  maxRing?: number;
}

/** 该瓦片中心的世界坐标 */
export function tileCenter(gx: number, gy: number, tile: number): { x: number; y: number } {
  return { x: gx * tile + tile / 2, y: gy * tile + tile / 2 };
}

/**
 * 敌人脚部占位盒（身体原点 = 脚底中心，y 向下为正）。
 *
 * 之前 `Enemy.footBlocked()` 和场景的「这里能不能站人」是两套判据：
 * 场景只看身体**中心那一个像素**，移动却查脚盒四个角。于是出生点抖动
 * 只要把小兵推到贴右边界墙（x=461，脚盒右角 467 已进 col 29 的墙），
 * 中心仍算「可站」，但之后每一帧四个角都压墙 → 两轴移动全被拒 →
 * 小兵贴墙一动不动；每帧兜底又只看中心，判定安全，永远不救援。
 * 甲方截图「这两个小兵卡住了」就是这个。判据收敛到这里，别再各写一套。
 */
export const ENEMY_FOOT = { w: 12, h: 8, offsetY: 10 } as const;

/** 脚盒四角的世界坐标（左上 / 右上 / 左下 / 右下） */
export function footCorners(
  cx: number,
  cy: number,
  foot: { w: number; h: number; offsetY: number } = ENEMY_FOOT,
): [number, number][] {
  const left = cx - foot.w / 2;
  const right = cx + foot.w / 2;
  const top = cy + foot.offsetY - foot.h / 2;
  const bottom = cy + foot.offsetY + foot.h / 2;
  return [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ];
}

/**
 * 以 (cx, cy) 为身体原点时是否踩进禁区：中心点 + 脚盒四角，任意一个被挡就算不可站。
 * `blocked` 由调用方给（地图碰撞格 / 运行时海面 / 人群都算）。
 */
export function isFootBlocked(
  cx: number,
  cy: number,
  blocked: (px: number, py: number) => boolean,
  foot: { w: number; h: number; offsetY: number } = ENEMY_FOOT,
): boolean {
  if (blocked(cx, cy)) return true;
  return footCorners(cx, cy, foot).some(([px, py]) => blocked(px, py));
}

export interface MoveState {
  /** 连续「两个轴都走不动」的累计时长（ms） */
  stuckMs: number;
  /** 沿墙绕行优先走哪一侧（±1） */
  slideSign: number;
}

export interface MoveResult {
  x: number;
  y: number;
  state: MoveState;
}

/**
 * 朝 (tx, ty) 迈一步：先分轴滑动；两个轴都被挡（撞墙角）时沿切线贴墙绕。
 *
 * `blocked(cx, cy)` 问的是「以该点为身体原点能不能站」，调用方应传
 * `isFootBlocked` 包好的判据，而不是 `map.isSolidAtWorld` 的单点判定。
 * 抽成纯函数是为了能在 node 环境里跑「所有地图出生点都不会卡死」的回归，
 * 不必 import Phaser 实体。
 */
export function advanceWithCollision(
  x: number,
  y: number,
  tx: number,
  ty: number,
  step: number,
  dtMs: number,
  blocked: (cx: number, cy: number) => boolean,
  state: MoveState,
): MoveResult {
  const dx = tx - x;
  const dy = ty - y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (dx / len) * step;
  const ny = (dy / len) * step;
  let px = x;
  let py = y;

  // 「真的走动了」要看**位移量**，不能看「某个轴没被挡」：
  //   1. 分量为 0 的轴必须跳过，否则 `blocked(px, py + 0)` 恒为 false；
  //   2. 目标几乎水平时 ny 可能只有 0.02px，敌人贴着墙原地蹭却每帧都算「在动」，
  //      卡住检测与贴墙绕行就永远不触发。实际位移不足 step 的三分之一就当作卡住。
  const minProgress = step * 0.35;
  if (nx !== 0 && !blocked(px + nx, py)) px += nx;
  if (ny !== 0 && !blocked(px, py + ny)) py += ny;
  if (Math.hypot(px - x, py - y) >= minProgress) {
    return { x: px, y: py, state: { stuckMs: 0, slideSign: state.slideSign } };
  }
  // 那一丁点位移别留着，从原点重新走切向，避免墙边逐帧抖动
  px = x;
  py = y;

  // 两轴全堵：沿垂直于追击方向的切线试滑，优先走上次成功的那一侧，
  // 避免两个方向来回抽。逐轴检查，只走通得过的分量，绝不穿墙或瞬移。
  const order = state.slideSign > 0 ? [1, -1] : [-1, 1];
  for (const sign of order) {
    const sx = (-dy / len) * step * sign;
    const sy = (dx / len) * step * sign;
    let qx = px;
    let qy = py;
    if (sx !== 0 && !blocked(qx + sx, qy)) qx += sx;
    if (sy !== 0 && !blocked(qx, qy + sy)) qy += sy;
    if (Math.hypot(qx - x, qy - y) >= minProgress) {
      return { x: qx, y: qy, state: { stuckMs: 0, slideSign: sign } };
    }
  }

  // 四面都走不了（多半脚盒本身嵌墙）：累计到阈值就翻面再试；场景侧每帧
  // 救援会用同一脚盒判据把这种人捞回合法空地。
  let stuckMs = state.stuckMs + dtMs;
  let slideSign = state.slideSign;
  if (stuckMs > 700) {
    slideSign = -slideSign;
    stuckMs = 0;
  }
  return { x: px, y: py, state: { stuckMs, slideSign } };
}

/**
 * 从 (x, y) 出发，按「一圈一圈往外」找最近的可站点，返回那个瓦片的中心。
 *
 * 搜索顺序刻意先看**左右**再看上下：本作里海面是从右侧军舰往前压出来的，
 * 玩家最需要的是往岸上（左）退，先找到左边的空地读起来最自然。
 * 同圈里按「左、右、上、下」排序，保证结果确定（可测）。
 */
export function nearestOpenPoint(x: number, y: number, q: OpenPointQuery): { x: number; y: number } | null {
  const maxRing = q.maxRing ?? 14;
  const gx = Math.floor(x / q.tile);
  const gy = Math.floor(y / q.tile);

  const tryTile = (cx: number, cy: number): { x: number; y: number } | null => {
    if (cx < 0 || cy < 0 || cx >= q.cols || cy >= q.rows) return null;
    const p = tileCenter(cx, cy, q.tile);
    return q.blocked(p.x, p.y) ? null : p;
  };

  const inMap = (cx: number, cy: number): boolean => cx >= 0 && cy >= 0 && cx < q.cols && cy < q.rows;

  // 自己脚下先看一次（可能只是脚尖压到了海面）
  const self = tryTile(gx, gy);
  if (self && !q.blocked(x, y)) return { x, y };

  for (let ring = 1; ring <= maxRing; ring++) {
    // 优先序：左列（同一行先）→ 右列 → 上行 → 下行。
    // 海面是从右侧、上方压过来的，玩家最该往左退，所以左列排在最前。
    const dyOrder: number[] = [0];
    for (let d = 1; d <= ring; d++) dyOrder.push(-d, d);
    const cands: Array<[number, number]> = [];
    for (const dy of dyOrder) cands.push([gx - ring, gy + dy]);
    for (const dy of dyOrder) cands.push([gx + ring, gy + dy]);
    for (let dx = -ring + 1; dx <= ring - 1; dx++) cands.push([gx + dx, gy - ring]);
    for (let dx = -ring + 1; dx <= ring - 1; dx++) cands.push([gx + dx, gy + ring]);
    for (const [cx, cy] of cands) {
      if (!inMap(cx, cy)) continue;
      const p = tryTile(cx, cy);
      if (p) return p;
    }
  }
  return null;
}