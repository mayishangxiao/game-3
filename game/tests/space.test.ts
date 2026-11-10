/**
 * core/space.ts —— 「把卡住的角色挪到最近空地」的纯函数。
 *
 * 为什么要单测：玩家实测「闪现到军舰压出来的水坑里就走不出去」，
 * 根因是脱困函数只查地图碰撞（海面不是碰撞格，永远查到 false）。
 * 这个测试把「就近、确定性、别掉出地图」三条钉死。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  advanceWithCollision,
  ENEMY_FOOT,
  footCorners,
  isFootBlocked,
  nearestOpenPoint,
  tileCenter,
  type MoveState,
} from '../src/core/space';

const TILE = 16;
const cols = 10;
const rows = 6;

/** 用一组「不可站格」构造查询，坐标按瓦片给 */
function query(blockedTiles: string[], tileBlocked?: (px: number, py: number) => boolean) {
  const set = new Set(blockedTiles);
  return {
    cols,
    rows,
    tile: TILE,
    blocked: (px: number, py: number) => {
      if (tileBlocked && tileBlocked(px, py)) return true;
      const gx = Math.floor(px / TILE);
      const gy = Math.floor(py / TILE);
      return set.has(`${gx},${gy}`);
    },
  };
}

describe('tileCenter', () => {
  it('返回瓦片中心而不是左上角', () => {
    expect(tileCenter(0, 0, TILE)).toEqual({ x: 8, y: 8 });
    expect(tileCenter(3, 2, TILE)).toEqual({ x: 56, y: 40 });
  });
});

describe('nearestOpenPoint', () => {
  it('脚下就是空地时原样返回（不抖回格心）', () => {
    const p = nearestOpenPoint(20, 20, query([]));
    expect(p).toEqual({ x: 20, y: 20 });
  });

  it('脚下被占时往相邻格挪，并落在格心', () => {
    const p = nearestOpenPoint(24, 24, query(['1,1']));
    expect(p).not.toBeNull();
    const gx = Math.floor(p!.x / TILE);
    const gy = Math.floor(p!.y / TILE);
    expect(`${gx},${gy}`).not.toBe('1,1');
    // 只允许挪一格（环 1）
    expect(Math.abs(gx - 1)).toBeLessThanOrEqual(1);
    expect(Math.abs(gy - 1)).toBeLessThanOrEqual(1);
  });

  it('同圈里先找左右：左邻空时优先回左边（岸在那侧）', () => {
    const p = nearestOpenPoint(24, 24, query(['1,1']));
    expect(p).toEqual(tileCenter(0, 1, TILE));
  });

  it('一圈之内没空地时继续往外找', () => {
    // 以 (5,3) 为中心，第一圈全堵死
    const ring1 = ['4,2', '5,2', '6,2', '4,3', '6,3', '4,4', '5,4', '6,4'];
    const p = nearestOpenPoint(88, 56, query(['5,3', ...ring1]));
    expect(p).not.toBeNull();
    const gx = Math.floor(p!.x / TILE);
    const gy = Math.floor(p!.y / TILE);
    expect(`${gx},${gy}`).not.toBe('5,3');
    expect(ring1).not.toContain(`${gx},${gy}`);
  });

  it('整张图都不可站时返回 null，而不是给一个越界坐标', () => {
    const all: string[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) all.push(`${x},${y}`);
    expect(nearestOpenPoint(24, 24, query(all))).toBeNull();
  });

  it('结果永远落在地图范围内', () => {
    // 左边和上面全是墙，只能往右下走
    const blocked = ['0,0', '0,1', '0,2', '1,0', '2,0', '1,1'];
    const p = nearestOpenPoint(8, 8, query(blocked));
    expect(p).not.toBeNull();
    expect(p!.x).toBeGreaterThan(0);
    expect(p!.x).toBeLessThan(cols * TILE);
    expect(p!.y).toBeGreaterThan(0);
    expect(p!.y).toBeLessThan(rows * TILE);
  });

  it('支持「额外禁区」：点是空地但落在禁区内（模拟海面）也要挪', () => {
    // 第 4 列之后全是水
    const inWater = (px: number) => Math.floor(px / TILE) >= 4;
    const p = nearestOpenPoint(72, 24, query([], inWater));
    expect(p).not.toBeNull();
    expect(Math.floor(p!.x / TILE)).toBeLessThan(4);
  });

  it('maxRing 限制搜索半径：够不着时返回 null', () => {
    const all: string[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) all.push(`${x},${y}`);
    expect(nearestOpenPoint(24, 24, { ...query(all), maxRing: 2 })).toBeNull();
  });

  it('起点在地图外时仍能找回地图里的空地（甲方「小兵被打出地图」的那条路）', () => {
    // 敌人被击退到右边界外 40px：gx = 12 > cols(10)。
    // 之前 LevelScene.landingNear 把 blocked 的形参当成瓦片索引用，像素值被当列号
    // → 越界 → 一律 true → 这里会返回 null，敌人就永远捞不回来。
    const p = nearestOpenPoint(cols * TILE + 40, 3 * TILE, query([]));
    expect(p).not.toBeNull();
    expect(p!.x).toBeGreaterThanOrEqual(0);
    expect(p!.x).toBeLessThan(cols * TILE);
    expect(p!.y).toBeGreaterThanOrEqual(0);
    expect(p!.y).toBeLessThan(rows * TILE);
  });

  it('blocked 收到的是像素坐标，不是瓦片索引', () => {
    const seen: number[] = [];
    const tile = 16;
    nearestOpenPoint(40, 24, {
      cols: 10,
      rows: 6,
      tile,
      blocked: (px: number) => {
        seen.push(px);
        return false;
      },
    });
    // 一旦有人又把像素当索引传，这里会出现 0~9 这种小整数
    for (const v of seen) expect(v % tile).toBe(tile / 2);
  });
});

/* ==================== 敌人脚盒：贴墙卡死回归 ==================== */

interface MiniMapDef {
  width: number;
  height: number;
  sky_rows?: number;
  layers: { name: string; collidable?: boolean; data: number[][] }[];
}

const MAP_DIR = join(process.cwd(), 'public', 'data', 'maps');

function readMap(file: string): MiniMapDef {
  return JSON.parse(readFileSync(join(MAP_DIR, file), 'utf8')) as MiniMapDef;
}

/** 与 MapRenderer.markCollision 一致：collidable 层里任何非 0 都是墙 */
function solidGrid(def: MiniMapDef): boolean[][] {
  const g: boolean[][] = Array.from({ length: def.height }, () =>
    Array<boolean>(def.width).fill(false),
  );
  for (const layer of def.layers) {
    if (!layer.collidable) continue;
    for (let y = 0; y < layer.data.length && y < def.height; y++) {
      for (let x = 0; x < layer.data[y].length && x < def.width; x++) {
        if (layer.data[y][x]) g[y][x] = true;
      }
    }
  }
  return g;
}

function tileBlocked(g: boolean[][], px: number, py: number): boolean {
  const gx = Math.floor(px / TILE);
  const gy = Math.floor(py / TILE);
  if (gx < 0 || gy < 0 || gy >= g.length || gx >= g[0].length) return true;
  return g[gy][gx];
}

/** 敌人能不能站：中心 + 脚盒四角，与 LevelScene.enemyFootUnsafe 同一判据 */
const footBlockedAt = (g: boolean[][], cx: number, cy: number): boolean =>
  isFootBlocked(cx, cy, (px, py) => tileBlocked(g, px, py));

/** 与 LevelScene.spawnPoints 一致 */
function spawnPoints(def: MiniMapDef, g: boolean[][]): { x: number; y: number }[] {
  const cols = def.width;
  const rows = def.height;
  const minCol = Math.floor(cols * 0.55);
  const topRow = Math.max(2, (def.sky_rows ?? 0) + 1);
  const pts: { x: number; y: number }[] = [];
  for (let step = 0; step < cols - 2 - minCol && pts.length < 8; step++) {
    const col = cols - 2 - step;
    if (col < 1 || col >= cols - 1) break;
    for (let ty = topRow; ty < rows - 3; ty++) {
      if (!g[ty][col] && !g[ty + 1][col]) {
        pts.push({ x: (col + 0.5) * TILE, y: (ty + 0.5) * TILE });
      }
    }
  }
  return pts;
}

/** 与 LevelScene.landingNearForEnemy 一致 */
function landingForEnemy(def: MiniMapDef, g: boolean[][], wx: number, wy: number) {
  return (
    nearestOpenPoint(wx, wy, {
      cols: def.width,
      rows: def.height,
      tile: TILE,
      blocked: (px, py) => footBlockedAt(g, px, py),
    }) ?? { x: wx, y: wy }
  );
}

/** 与 LevelScene.spawnEnemy 的落位校正一致 */
function correctedSpawn(
  def: MiniMapDef,
  g: boolean[][],
  base: { x: number; y: number },
  raw: { x: number; y: number },
) {
  let land = { ...raw };
  if (footBlockedAt(g, land.x, land.y)) {
    land = landingForEnemy(def, g, land.x, land.y);
    if (footBlockedAt(g, land.x, land.y)) land = landingForEnemy(def, g, base.x, base.y);
    if (footBlockedAt(g, land.x, land.y)) land = { ...base };
  }
  return land;
}

/** 用真实的 advanceWithCollision 跑一段追击，返回末段位移与离目标距离 */
function chase(
  g: boolean[][],
  start: { x: number; y: number },
  target: { x: number; y: number },
  frames = 320,
) {
  let x = start.x;
  let y = start.y;
  let state: MoveState = { stuckMs: 0, slideSign: 1 };
  const dt = 1000 / 60;
  const step = (44 * dt) / 1000;
  let last60 = 0;
  for (let f = 0; f < frames; f++) {
    const r = advanceWithCollision(
      x, y, target.x, target.y, step, dt,
      (cx, cy) => footBlockedAt(g, cx, cy), state,
    );
    if (f >= frames - 60) last60 += Math.hypot(r.x - x, r.y - y);
    x = r.x;
    y = r.y;
    state = r.state;
  }
  return { x, y, last60, dist: Math.hypot(target.x - x, target.y - y) };
}

describe('ENEMY_FOOT / isFootBlocked', () => {
  it('脚盒四角是 12×8、中心下沉 10px', () => {
    expect(ENEMY_FOOT).toEqual({ w: 12, h: 8, offsetY: 10 });
    expect(footCorners(100, 100)).toEqual([
      [94, 106], [106, 106], [94, 114], [106, 114],
    ]);
  });

  it('空地可站、中心在墙里不可站', () => {
    const empty = () => false;
    expect(isFootBlocked(100, 100, empty)).toBe(false);
    const centerWall = (px: number, py: number) => px >= 99 && px <= 101 && py >= 99 && py <= 101;
    expect(isFootBlocked(100, 100, centerWall)).toBe(true);
  });

  it('回归甲方「两个小兵卡住」：中心可站但右角压进边界墙，必须判为不可站', () => {
    // 真实坐标：出生点 456 抖动 +5 → 461，脚盒右角 467 已进 col 29 的边界墙。
    // 旧版 `enemySpotUnsafe` 只查中心 461（还在 col 28），判定安全，
    // 于是敌人从出生第一帧起两轴移动全被拒，贴着右墙一动不动。
    const rightWallX = 464;
    const wall = (px: number) => px >= rightWallX;
    expect(wall(461)).toBe(false);
    expect(isFootBlocked(461, 90, wall)).toBe(true);
    expect(isFootBlocked(456, 90, wall)).toBe(false);
  });

  it('两轴都被挡时 advanceWithCollision 会沿墙切向滑动', () => {
    // 右侧一整列是墙，目标在墙后；x 方向走不了，但 y 方向应该沿墙滑
    const blocked = (cx: number) => cx > 100;
    let state: MoveState = { stuckMs: 0, slideSign: 1 };
    let x = 96;
    let y = 100;
    for (let f = 0; f < 20; f++) {
      const r = advanceWithCollision(x, y, 140, 100, 1, 16.7, blocked, state);
      x = r.x;
      y = r.y;
      state = r.state;
    }
    expect(Math.abs(y - 100)).toBeGreaterThan(2);
    expect(x).toBeLessThanOrEqual(100);
  });
});

describe('所有地图的敌人出生点不得卡死', () => {
  const files = readdirSync(MAP_DIR).filter((f) => f.endsWith('.json'));

  it('每张地图都有可用出怪点', () => {
    for (const file of files) {
      const def = readMap(file);
      expect(spawnPoints(def, solidGrid(def)).length, file).toBeGreaterThan(0);
    }
  });

  it('抖动后的出生点经校正，脚盒四角必须全部合法', () => {
    for (const file of files) {
      const def = readMap(file);
      const g = solidGrid(def);
      const pts = spawnPoints(def, g);
      for (let n = 0; n < 24; n++) {
        const base = pts[n % pts.length];
        const raw = {
          x: base.x + ((n * 7) % 11) - 5,
          y: base.y + ((n * 5) % 9) - 4,
        };
        const land = correctedSpawn(def, g, base, raw);
        expect(footBlockedAt(g, land.x, land.y), `${file} #${n} @${land.x},${land.y}`).toBe(false);
      }
    }
  });

  it('校正后的敌人朝四个方向追击 5 秒，末段都不能静止在远离目标处', () => {
    const targets = [
      { x: 80, y: 120 },
      { x: 60, y: 200 },
      { x: 240, y: 200 },
      { x: 150, y: 100 },
    ];
    for (const file of files) {
      const def = readMap(file);
      const g = solidGrid(def);
      const pts = spawnPoints(def, g);
      for (let n = 0; n < Math.min(8, pts.length); n++) {
        const base = pts[n];
        const raw = {
          x: base.x + ((n * 7) % 11) - 5,
          y: base.y + ((n * 5) % 9) - 4,
        };
        const land = correctedSpawn(def, g, base, raw);
        for (const target of targets) {
          const r = chase(g, land, target);
          const stuck = r.last60 < 2 && r.dist > 30;
          expect(stuck, `${file} spawn#${n} -> ${target.x},${target.y} last60=${r.last60.toFixed(1)} dist=${r.dist.toFixed(0)}`).toBe(false);
        }
      }
    }
  });
});