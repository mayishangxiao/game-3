/**
 * core/space.ts —— 「把卡住的角色挪到最近空地」的纯函数。
 *
 * 为什么要单测：玩家实测「闪现到军舰压出来的水坑里就走不出去」，
 * 根因是脱困函数只查地图碰撞（海面不是碰撞格，永远查到 false）。
 * 这个测试把「就近、确定性、别掉出地图」三条钉死。
 */

import { describe, expect, it } from 'vitest';
import { nearestOpenPoint, tileCenter } from '../src/core/space';

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
});