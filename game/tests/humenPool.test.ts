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
import {
  CHAR_H, CHAR_W, CONTROL_HIT_PAD, CONTROL_LAYOUT, DEPTH, entityDepth,
  HUMEN_POOL, NPC_FOOT_OFFSET_Y, TILE,
} from '../src/core/constants';

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
  it('8 个鸦片箱 / 出口仍在原坐标；林则徐是唯一为「不被遮挡」而挪动的物件', () => {
    const snapshot: Record<string, [number, number]> = {
      obj_crate_1: [7, 11], obj_crate_2: [10, 12], obj_crate_3: [13, 11],
      obj_crate_4: [23, 7], obj_crate_5: [10, 13], obj_crate_6: [9, 12],
      obj_crate_7: [7, 14], obj_crate_8: [25, 6],
      // v1.8.9：旧 (15,12) 的头顶插进池子被池水盖掉；见下一组断言
      obj_linzexu: [17, 13.5], obj_exit_fort: [27, 4],
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

/**
 * v1.8.9「林则徐被销烟池挡住半个人」的数据契约。
 *
 * 两层原因：① **层级**——NPC 小人原来用 `DEPTH.deco + 1`(11)，而池水 / 白沫 /
 * 池沿是 12/13，静态布景压在人物身上；现在人物统一走 `entityDepth(脚底y)`。
 * ② **定位**——旧 `(15,12)` 的 24×32 贴图上沿落在 y=176，正好插进池子
 * (128..192)；现在整个人形包围盒都在池下沿之外。
 *
 * 尺寸（池 112×64、人物 24×32）与碰撞层 28 格都没动：它们各有自己的真值，
 * 为「让人露出来」去缩池子会把玩家能站的位置一起改坏。
 */
describe('林则徐完整可见：层级关系 / 站位 / 尺寸', () => {
  const npc = map.objects.find((o) => o.id === 'obj_linzexu')!;
  const pool = pools[0];
  const cx = (npc.x + 0.5) * TILE;
  const footY = (npc.y + 0.5) * TILE + NPC_FOOT_OFFSET_Y;
  const bounds = {
    left: cx - CHAR_W / 2, right: cx + CHAR_W / 2,
    top: footY - CHAR_H, bottom: footY,
  };
  const pcx = (pool.x + 0.5) * TILE;
  const pcy = (pool.y + 0.5) * TILE;
  const poolRect = {
    left: pcx - HUMEN_POOL.w / 2, right: pcx + HUMEN_POOL.w / 2,
    top: pcy - HUMEN_POOL.h / 2, bottom: pcy + HUMEN_POOL.h / 2,
  };

  it('尺寸仍是各自的真值：池 112×64、人物 24×32（不为露脸去缩池子）', () => {
    expect([HUMEN_POOL.w, HUMEN_POOL.h]).toEqual([112, 64]);
    expect([CHAR_W, CHAR_H]).toEqual([24, 32]);
    expect(poolRect).toEqual({ left: 240, right: 352, top: 128, bottom: 192 });
    expect([bounds.right - bounds.left, bounds.bottom - bounds.top]).toEqual([24, 32]);
  });

  it('人形包围盒完全在池子之外，且离池下沿留出呼吸空间', () => {
    // 池沿下沿那条 2px 暗线会占到 y=193，所以要求 ≥4px 而不是「相切即可」
    expect(bounds.top).toBeGreaterThanOrEqual(poolRect.bottom + 4);
    expect(bounds.bottom).toBeLessThan(256); // 底部 HUD 顶边，人物不能被 HUD 切掉脚
  });

  it('NPC 层级高于池子所有静态装饰，但仍在特效/HUD 之下', () => {
    const d = entityDepth(footY);
    expect(d).toBeGreaterThan(DEPTH.deco + 3); // 池水 12 / 白沫·池沿 13
    expect(d).toBeLessThan(DEPTH.projectile);
    expect(d).toBeLessThan(DEPTH.hud);
    // 与 Player / Enemy / CharacterRig 的 20 + y*0.01 是同一条公式
    expect(d).toBeCloseTo(DEPTH.entityBase + footY * 0.01, 10);
  });

  it('站位可走，且没压在任何虚拟按键命中圈上', () => {
    expect(collision[Math.floor(npc.y)][Math.floor(npc.x)]).toBe(0);
    for (const [name, b] of Object.entries(CONTROL_LAYOUT)) {
      const dist = Math.hypot(cx - b.x, footY - b.y);
      expect(dist, `${name} 键会盖住林则徐`).toBeGreaterThan(b.r + CONTROL_HIT_PAD);
    }
  });

  it('不与其它物件（箱子 / 出口）包围盒重叠', () => {
    for (const o of map.objects) {
      if (o.id === npc.id || o.kind === 'deposit') continue;
      const ox = (o.x + 0.5) * TILE;
      const oy = (o.y + 0.5) * TILE;
      const half = o.kind === 'exit' ? 7 : 10;
      const overlapX = Math.min(bounds.right, ox + half) - Math.max(bounds.left, ox - half);
      const overlapY = Math.min(bounds.bottom, oy + half) - Math.max(bounds.top, oy - half);
      expect(overlapX <= 0 || overlapY <= 0, `${o.id} 与林则徐重叠`).toBe(true);
    }
  });

  it('玩家仍走得到并触发交谈（26px 交互半径内有可走格）', () => {
    const stand = { x: 16, y: 14 };
    const px = (stand.x + 0.5) * TILE;
    const py = (stand.y + 0.5) * TILE;
    expect(Math.hypot(px - cx, py - footY)).toBeLessThan(26);
    expect(collision[stand.y][stand.x]).toBe(0);
  });
});
