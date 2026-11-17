/**
 * 空气墙回归锁（v2.9.6）：场地内部不许再长出「四邻皆空的单格阻挡」。
 *
 * 与 tools/clear_airwalls.py 用同一套判定：排除最外圈、销烟池 6/7、海战图、
 * sky_rows 远景行、objects 格，以及整图唯一的叙事装置。重跑任何地图生成器后，
 * 若散点被写回来，这里必须红——清理解耦在 tools/clear_airwalls.py。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mapsDir = fileURLToPath(new URL('../public/data/maps/', import.meta.url));
type Layer = { name: string; collidable?: boolean; data: number[][] };
type MapDef = {
  id: string;
  sky_rows?: number;
  layers: Layer[];
  objects?: { x: number; y: number }[];
};

function load(id: string): MapDef {
  return JSON.parse(fs.readFileSync(path.join(mapsDir, `${id}.json`), 'utf8')) as MapDef;
}

function collision(def: MapDef): number[][] {
  const layer = def.layers.find((l) => l.name === 'collision' && l.collidable);
  if (!layer) throw new Error(`${def.id} 缺 collision 层`);
  return layer.data;
}

/** 可清理的孤立阻挡；规则和 tools/clear_airwalls.py 保持一致 */
function clearableBlockers(def: MapDef): [number, number][] {
  if (def.id === 'map_ch00_act3_sea') return [];
  const col = collision(def);
  const h = col.length;
  const w = col[0].length;
  const sky = Math.max(1, Number(def.sky_rows ?? 0));
  const occupied = new Set((def.objects ?? []).map((o) => `${o.x},${o.y}`));
  const counts = new Map<number, number>();
  for (const layer of def.layers) {
    if (layer.name === 'collision') continue;
    for (const row of layer.data) {
      for (const v of row) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  const out: [number, number][] = [];
  for (let y = sky; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v = col[y][x];
      if (!v || v === 6 || v === 7 || occupied.has(`${x},${y}`)) continue;
      const around = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      if (around.some(([nx, ny]) => col[ny]?.[nx])) continue;
      const onTop = def.layers
        .filter((l) => l.name !== 'collision')
        .map((l) => l.data[y][x])
        .filter((n) => n > 0);
      if (onTop.some((n) => (counts.get(n) ?? 0) <= 1)) continue;
      out.push([x, y]);
    }
  }
  return out;
}

describe('空气墙清理', () => {
  it('所有现行地图都没有可清理的孤立阻挡', () => {
    const bad: string[] = [];
    for (const file of fs.readdirSync(mapsDir).filter((f) => f.endsWith('.json'))) {
      const def = load(path.basename(file, '.json'));
      const blockers = clearableBlockers(def);
      if (blockers.length) bad.push(`${def.id}: ${JSON.stringify(blockers.slice(0, 8))}`);
    }
    expect(bad, '重跑生成器后请先执行 python tools/clear_airwalls.py').toEqual([]);
  });

  it('第一幕销烟池 28 格碰撞完整保留（不是空气墙，删了会穿池子）', () => {
    const col = collision(load('map_ch00_act1a'));
    const pool = col.flat().filter((v) => v === 6 || v === 7);
    expect(pool).toHaveLength(28);
  });

  it('第一幕战场除边界与池子外没有内部实心格', () => {
    const def = load('map_ch00_act1b');
    const col = collision(def);
    const inner = col.slice(1, -1).flatMap((row) => row.slice(1, -1)).filter(Boolean);
    expect(inner).toHaveLength(0);
  });

  it('五幕主线图的外圈边界整圈封闭，玩家不会掉出地图', () => {
    for (const id of [
      'map_ch00_act1a', 'map_ch00_act1b', 'map_ch00_tp_village', 'map_ch00_tp_city',
      'map_ch00_tp_battlefield', 'map_ch00_act3_factory', 'map_ch00_act3_sea',
      'map_ch00_act4_beijing', 'map_ch00_act5_wuchang',
    ]) {
      const col = collision(load(id));
      const h = col.length;
      const w = col[0].length;
      const edge = [
        ...col[0], ...col[h - 1],
        ...col.slice(1, -1).map((row) => row[0]),
        ...col.slice(1, -1).map((row) => row[w - 1]),
      ];
      expect(edge.every(Boolean), `${id} 边界有缺口`).toBe(true);
    }
  });

  it('海战图仍是海洋：实心格过半且甲板可走', () => {
    const col = collision(load('map_ch00_act3_sea'));
    const flat = col.flat();
    expect(flat.filter(Boolean).length / flat.length).toBeGreaterThan(0.5);
    expect(col[7][14]).toBe(0);
  });

  it('太平战场 sky_rows 远景带仍整行实心（不是空气墙）', () => {
    const def = load('map_ch00_tp_battlefield');
    const col = collision(def);
    for (let y = 0; y < Number(def.sky_rows); y++) {
      expect(col[y].every(Boolean), `第 ${y} 行天空带被误清`).toBe(true);
    }
  });

  it('叙事装置未被误清：会馆灯笼、武昌军旗仍在', () => {
    const tileIds = (id: string): Set<number> => {
      const def = load(id);
      const set = new Set<number>();
      for (const l of def.layers) {
        if (l.name === 'collision') continue;
        for (const row of l.data) for (const v of row) if (v) set.add(v);
      }
      return set;
    };
    // 武昌图 ID 31 = flag（见 gen_late_qing_maps.py 的 NAMES 顺序）
    expect(tileIds('map_ch00_act5_wuchang').has(31)).toBe(true);
    // 会馆图 ID 18 = lantern
    expect(tileIds('map_ch00_act4_beijing').has(18)).toBe(true);
  });
});
