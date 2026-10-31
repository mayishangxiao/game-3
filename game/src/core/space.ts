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