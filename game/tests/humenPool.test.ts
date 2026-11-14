/**
 * 虎门销烟池「只有一个大长方体」的数据契约（v1.8.8，2026-11-14 截图反馈）。
 *
 * 修之前画面里是**两个**长方体：
 *   ① `ground` 层 x=15..21 / y=8..11 的 6(木框)/7(石灰) 瓦片，被程序化材质画成
 *      一大块砖砌矩形；
 *   ② `obj_pool` 这枚 deposit 对象又在 y=12 另画一个 40×26 的小池子。
 * 玩家看到的是上下两个池子。现在地面装饰删掉，只剩 ② 放大成 7×4 格的大长方体，
 * 且 `obj_pool` 的格坐标就是池中心。
 *
 * 这里锁住的是「数据与渲染常量对齐」：`HUMEN_POOL` 的尺寸必须等于碰撞层那 28 个
 * 实心格的像素范围，否则池子会盖不住碰撞区、或压到旁边别的物件上。
 * 光看截图很难发现差半格，但玩家会看到「站在池沿里 / 池边一圈墙皮」。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HUMEN_POOL, TILE } from '../src/core/constants';

const DATA = join(process.cwd(), 'public', 'data');

interface MapLike {
  id: string;
  width: number;
  height: number;
  layers: Array<{ name: string; data: number[][]; collidable?: boolean }>;
  objects: Array<{ id: string; kind: string; x: number; y: number }>;
}

const readMap = (name: string): MapLike =>
  JSON.parse(readFileSync(join(DATA, 'maps', name), 'utf8')) as MapLike;

const map = readMap('map_ch00_act1a.json');
const ground = map.layers.find((l) => l.name === 'ground')!.data;
const collision = map.layers.find((l) => l.name === 'collision')!.data;
const pools = map.objects.filter((o) => o.kind === 'deposit');

/** 池沿的碰撞格：与 `HUMEN_POOL` 一一对应 */
const X0 = 15;
const X1 = 21;
const Y0 = 8;
const Y1 = 11;

describe('虎门销烟池：地面不能再画第二个池子', () => {
  it('ground 层里已经没有 6/7 瓦片', () => {
    const leftovers: string[] = [];
    ground.forEach((row, y) =>
      row.forEach((v, x) => {
        if (v === 6 || v === 7) leftovers.push(`${x},${y}=${v}`);
      }),
    );
    expect(leftovers, `地面层还留着装饰池瓦片：${leftovers.join(' ')}`).toEqual([]);
  });

  it('整张地图只有一个 deposit 对象', () => {
    expect(pools).toHaveLength(1);
    expect(pools[0].id).toBe('obj_pool');
  });

  it('其它地图的地面层不受影响（没有 6/7 被顺手改掉）', () => {
    // 这个断言的存在意义：改地图时用脚本批量替换很容易误伤同色号的别张图。
    const other = readMap('map_ch00_act1b.json');
    const g = other.layers.find((l) => l.name === 'ground')!.data;
    expect(g.flat().some((v) => v === 6 || v === 7)).toBe(false); // 炮台图本就没有池子
    expect(other.objects.filter((o) => o.kind === 'deposit')).toHaveLength(0);
  });
});

describe('虎门销烟池：唯一的大长方体与碰撞区严格对齐', () => {
  it('碰撞层 6/7 仍是完整的 7×4 格（池子依旧挡人，其它碰撞未动）', () => {
    const cells: string[] = [];
    for (let y = Y0; y <= Y1; y++) {
      for (let x = X0; x <= X1; x++) {
        if (collision[y][x] === 6 || collision[y][x] === 7) cells.push(`${x},${y}`);
      }
    }
    expect(cells).toHaveLength(28);

    const outside = collision.flatMap((row, y) =>
      row.flatMap((v, x) =>
        (v === 6 || v === 7) && (x < X0 || x > X1 || y < Y0 || y > Y1) ? [`${x},${y}`] : [],
      ),
    );
    expect(outside).toEqual([]);
  });

  it('HUMEN_POOL 的宽高正好等于那 28 格的像素范围', () => {
    expect(HUMEN_POOL.cols).toBe(X1 - X0 + 1);
    expect(HUMEN_POOL.rows).toBe(Y1 - Y0 + 1);
    expect(HUMEN_POOL.w).toBe((X1 - X0 + 1) * TILE);
    expect(HUMEN_POOL.h).toBe((Y1 - Y0 + 1) * TILE);
  });

  it('obj_pool 的格坐标落在池区几何中心', () => {
    const p = pools[0];
    // 世界像素中心：(x + 0.5) * TILE；池区像素范围 [X0*TILE, (X1+1)*TILE]
    const expectX = ((X0 + X1 + 1) / 2 - 0.5);
    const expectY = ((Y0 + Y1 + 1) / 2 - 0.5);
    expect(p.x).toBe(expectX);
    expect(p.y).toBe(expectY);
    expect((p.x + 0.5) * TILE).toBe((X0 * TILE + (X1 + 1) * TILE) / 2);
    expect((p.y + 0.5) * TILE).toBe((Y0 * TILE + (Y1 + 1) * TILE) / 2);
  });
});

describe('虎门销烟池：场景里其它物件没被挪动', () => {
  it('8 个鸦片箱 / 林则徐 / 出口仍在原坐标', () => {
    const snapshot: Record<string, [number, number]> = {
      obj_crate_1: [7, 11], obj_crate_2: [10, 12], obj_crate_3: [13, 11],
      obj_crate_4: [23, 7], obj_crate_5: [10, 13], obj_crate_6: [9, 12],
      obj_crate_7: [7, 14], obj_crate_8: [25, 6],
      obj_linzexu: [15, 12], obj_exit_fort: [27, 4],
    };
    for (const [id, [x, y]] of Object.entries(snapshot)) {
      const o = map.objects.find((m) => m.id === id);
      expect(o, `少了 ${id}`).toBeDefined();
      expect([o!.x, o!.y], `${id} 被挪动了`).toEqual([x, y]);
    }
    // 没有物件落进池区（池子是实心的，站不进去）
    const inPool = map.objects.filter(
      (o) => o.id !== 'obj_pool' && o.x >= X0 && o.x <= X1 && o.y >= Y0 && o.y <= Y1,
    );
    expect(inPool.map((o) => o.id)).toEqual([]);
  });
});
