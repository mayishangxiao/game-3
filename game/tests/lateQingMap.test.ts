/**
 * 洋务运动及之后（第三～五幕）的地图资源（v2.2）。
 *
 * 用户要求「重做洋务运动时期及之后的所有地图资源，确保风格与历史背景一致」。
 * 换之前这三幕的 4 个陆地节点全复用第二幕的 `map_ch00_tp_city` / `tp_battlefield`
 * —— 那是 1851—1864 太平天国的天京：草坡、山林、护城河、木桥、营垒。
 * 现在三张图共用新图集 `tp_late_qing`，靠「摆哪些装置」区分年代：
 *   1865 江南制造总局 → 车床 / 锅炉 / 烟囱 / 窄轨
 *   1898 北京南海会馆 → 灰瓦门楼 / 朱红大门 / 门匾 / 灯笼
 *   1911 武昌总督衙门 → 石阶 / 石狮 / 沙袋街垒 / 新军旗 / 路灯
 *
 * 这里锁的不是「好看」，是**别悄悄退回旧图**和**别把关卡走死**：
 * 图集 id、三幕引用、装置分布、出生点、右端出怪点、BFS 可达。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LQ_SHEET_COLS, LQ_SHEET_TEX, LQ_TILESET_ID, TILE } from '../src/core/constants';

const ROOT = join(process.cwd(), 'public');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;

interface MapDef {
  id: string;
  width: number;
  height: number;
  tileset: string;
  sky_rows?: number;
  tile_colors: Record<string, string>;
  spawn: { x: number; y: number };
  layers: { name: string; data: number[][]; collidable: boolean }[];
}
const MAPS: Record<string, string> = {
  factory: 'data/maps/map_ch00_act3_factory.json',
  beijing: 'data/maps/map_ch00_act4_beijing.json',
  wuchang: 'data/maps/map_ch00_act5_wuchang.json',
};
const maps = Object.fromEntries(Object.entries(MAPS).map(([k, p]) => [k, read<MapDef>(p)]));

const sheet = read<{
  name: string;
  columns: number;
  tilecount: number;
  tiles: { id: number; name: string; file: string; collidable: boolean }[];
}>('art/tiles/late_qing/tileset.json');
const names = new Map(sheet.tiles.map((t) => [t.id, t.name]));
const ids = new Map(sheet.tiles.map((t) => [t.name, t.id]));

const ground = (m: MapDef) => m.layers.find((l) => l.name === 'ground')!.data;
const collision = (m: MapDef) => m.layers.find((l) => l.name === 'collision')!.data;
const walkable = (m: MapDef, x: number, y: number) => collision(m)[y]?.[x] === 0;

/** 与 LevelScene.spawnPoints('right') 同规则：从最右列往左找「本格与下一格都可走」。 */
function rightSpawnCount(m: MapDef): number {
  const c = collision(m);
  let n = 0;
  for (let col = m.width - 2; col >= 1; col--) {
    for (let y = Math.max(2, (m.sky_rows ?? 0) + 1); y < m.height - 2; y++) {
      if (c[y][col] === 0 && c[y + 1][col] === 0) n++;
    }
  }
  return n;
}

function bfs(m: MapDef): Set<string> {
  const c = collision(m);
  const seen = new Set<string>([`${m.spawn.x},${m.spawn.y}`]);
  const q: [number, number][] = [[m.spawn.x, m.spawn.y]];
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height || seen.has(key) || c[ny][nx] !== 0) continue;
      seen.add(key);
      q.push([nx, ny]);
    }
  }
  return seen;
}

describe('晚清近代图集 tp_late_qing', () => {
  it('登记表、拼版与 36 张单图都齐，取帧规则与前两套一致', () => {
    expect(sheet.name).toBe(LQ_TILESET_ID);
    expect(sheet.columns).toBe(LQ_SHEET_COLS);
    expect(sheet.tiles).toHaveLength(36);
    expect(sheet.tilecount).toBe(37);
    expect(sheet.tiles[0].id).toBe(1);
    const sheetPng = join(ROOT, 'art/tiles/late_qing/tp_late_qing_sheet.png');
    expect(existsSync(sheetPng), '拼版 png 不在').toBe(true);
    const b = readFileSync(sheetPng);
    expect(b.readUInt32BE(16)).toBe(8 * TILE);
    expect(b.readUInt32BE(20)).toBe(5 * TILE);
    const missing = sheet.tiles.filter((t) => !existsSync(join(ROOT, 'art/tiles/late_qing', t.file)));
    expect(missing.map((t) => t.file), '单图缺件').toEqual([]);
  });

  it('运行时常量登记了纹理名（core 层不许写死字符串）', () => {
    expect(LQ_SHEET_TEX).toBe('tp_late_qing_sheet');
    expect(LQ_SHEET_COLS).toBe(8);
    const renderer = readFileSync(join(process.cwd(), 'src/gfx/MapRenderer.ts'), 'utf8');
    expect(renderer, 'MapRenderer 的 SHEETS 里没登记新图集').toContain('[LQ_TILESET_ID]');
    const preload = readFileSync(join(process.cwd(), 'src/scenes/LevelScene.ts'), 'utf8');
    expect(preload, 'LevelScene.preload 没预加载新拼版').toContain('ART.lateQingSheet');
  });
});

describe('三张新地图：时代对得上、关卡走得通', () => {
  it('都是 30×16、tp_late_qing、无天空带，且瓦片 id 全在图集里', () => {
    for (const [key, m] of Object.entries(maps)) {
      expect(m.tileset, `${key} 复用了旧图集`).toBe(LQ_TILESET_ID);
      expect([m.width, m.height], `${key} 尺寸`).toEqual([30, 16]);
      expect(m.sky_rows ?? 0, `${key} 不该有天空带`).toBe(0);
      for (const row of ground(m)) {
        for (const id of row) {
          expect(names.has(id), `${key} 用了图集里不存在的瓦片 id=${id}`).toBe(true);
          expect(m.tile_colors[String(id)], `${key} 的瓦片 ${id} 缺回退配色`).toBeTruthy();
        }
      }
    }
  });

  it('出生点不在实心格上，且 BFS 能走到右端出怪区', () => {
    for (const [key, m] of Object.entries(maps)) {
      expect(walkable(m, m.spawn.x, m.spawn.y), `${key} 出生点压墙`).toBe(true);
      const seen = bfs(m);
      const reachableRight = [...seen].some((s) => Number(s.split(',')[0]) >= 26);
      expect(reachableRight, `${key} 从出生点走不到右端，敌人会卡在墙里`).toBe(true);
      expect(rightSpawnCount(m), `${key} 右侧找不到出怪点`).toBeGreaterThan(8);
    }
  });

  it('江南制造总局摆的是机器厂房：车床 / 锅炉 / 烟囱 / 窄轨', () => {
    const g = ground(maps.factory);
    const used = new Set(g.flat());
    for (const n of ['machine', 'boiler', 'chimney', 'track', 'cement', 'cannon_part', 'coal']) {
      expect(used.has(ids.get(n)!), `工厂图缺 ${n}`).toBe(true);
    }
  });

  it('北京会馆摆的是胡同门楼：朱红大门 / 门匾 / 灯笼 / 灰瓦 / 青石板', () => {
    const used = new Set(ground(maps.beijing).flat());
    for (const n of ['gate', 'plaque', 'lantern', 'tile_roof', 'stone_a', 'cobble', 'awning']) {
      expect(used.has(ids.get(n)!), `会馆图缺 ${n}`).toBe(true);
    }
  });

  it('武昌衙门摆的是起义夜：石阶 / 石狮 / 沙袋街垒 / 新军旗 / 路灯', () => {
    const used = new Set(ground(maps.wuchang).flat());
    for (const n of ['steps', 'stone_lion', 'barricade', 'flag', 'street_lamp', 'telegraph']) {
      expect(used.has(ids.get(n)!), `武昌图缺 ${n}`).toBe(true);
    }
  });
});

describe('第三～五幕不再复用太平天国地图', () => {
  const nodes = read<{ nodes: { id: string; map_ref: string | null }[] }>('data/nodes/nodes_ch00.json').nodes;
  const acts = ['ch00_act3', 'ch00_act4', 'ch00_act5'].map((id) =>
    read<{ id: string; map_refs: string[] }>(`data/acts/${id}.json`),
  );

  it('三幕的 map_refs 只指向新图（第三幕另有海战图）', () => {
    for (const a of acts) {
      for (const ref of a.map_refs) {
        expect(ref.startsWith('map_ch00_tp_'), `${a.id} 还在复用太平天国地图 ${ref}`).toBe(false);
      }
    }
    expect(acts[0].map_refs).toContain('map_ch00_act3_sea');
  });

  it('三个陆地节点的 map_ref 逐一对上新图，海战节点仍是海洋图', () => {
    const byId = new Map(nodes.map((n) => [n.id, n.map_ref]));
    expect(byId.get('nd_1865_jiangnan_manage')).toBe('map_ch00_act3_factory');
    expect(byId.get('nd_1898_coup_battle')).toBe('map_ch00_act4_beijing');
    expect(byId.get('nd_1911_wuchang_battle')).toBe('map_ch00_act5_wuchang');
    expect(byId.get('nd_1894_jiawu_battle')).toBe('map_ch00_act3_sea');
  });
});
