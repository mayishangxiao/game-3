/**
 * 黄海海战（第三幕 nd_1894_jiawu_battle）的数据锁。
 *
 * 用户 2026-11-15 的要求是「洋务运动必须要有甲午海战，并且地图是海洋」。
 * 这一关和别的关卡有三处结构性不同，都是**改回陆地就会静默失效**的那类，
 * 所以单独锁一份：
 *   1. 地图是 `tp_sea` 图集、可走区只有中间一条甲板，四周是海（碰撞层）；
 *   2. Boss 是 `body: 'ship'` 的松岛舰，锚点必须落在能砍到的距离内
 *      （默认的「右端 −100px」在这儿会让敌舰停在 90 多像素外，近战 60px 够不着）；
 *   3. 文案不残留陆战词（平壤 / 城下 / 阵地 / 后路断了），
 *      否则会出现「点击开始战斗，写着平壤城下，画面上是一条军舰」。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MELEE_RANGE_MAX, SEA_SHEET_COLS, SEA_TILESET_ID, TILE } from '../src/core/constants';

const ROOT = process.cwd();
const DATA = join(ROOT, 'public', 'data');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(DATA, rel), 'utf8')) as T;

interface MapDef {
  id: string;
  width: number;
  height: number;
  tileset: string;
  sky_rows?: number;
  boss_anchor?: { x: number; y: number };
  spawn: { x: number; y: number };
  layers: { name: string; data: number[][]; collidable: boolean }[];
}
interface NodeDef {
  id: string;
  title: string;
  type: string;
  map_ref: string | null;
  banner?: { time: string; place: string; scene?: string; power?: { ours: string; enemy: string; gap?: string } };
  params: { boss?: string; waves?: { spawns: { enemy: string; count: number; spawn: string }[] }[] };
  participants: string[];
}
interface EnemyDef {
  id: string;
  name: string;
  tier: string;
  body?: string;
  size?: { w: number; h: number };
}
interface DlgFile {
  npcs: Record<string, string>;
  dialogues: { id: string; participants?: string[]; lines: { speaker: string; text: string }[] }[];
}

const map = read<MapDef>('maps/map_ch00_act3_sea.json');
const nodes = read<{ nodes: NodeDef[] }>('nodes/nodes_ch00.json').nodes;
const enemies = read<{ enemies: EnemyDef[] }>('enemies/enemies_ch00.json').enemies;
const dlg = read<DlgFile>('dialogues/dlg_ch00.json');

const seaNode = nodes.find((n) => n.id === 'nd_1894_jiawu_battle') as NodeDef;
const ground = map.layers.find((l) => l.name === 'ground')!.data;
const collision = map.layers.find((l) => l.name === 'collision')!.data;
const walkable = (x: number, y: number): boolean => collision[y][x] === 0;

/** 甲板可走格（碰撞层为 0 的格）的边界 */
function deckBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!walkable(x, y)) continue;
      xs.push(x);
      ys.push(y);
    }
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('海战地图：一张海洋，中间一条甲板', () => {
  it('用的是 tp_sea 图集、30×16、顶上 4 行留给远景条', () => {
    expect(map.id).toBe('map_ch00_act3_sea');
    expect(map.tileset).toBe(SEA_TILESET_ID);
    expect(map.width).toBe(30);
    expect(map.height).toBe(16);
    // sky_rows 必须等于 HORIZON_ROWS（4）：远景条是 480×64，行数一变就对不齐
    expect(map.sky_rows).toBe(4);
  });

  it('可走区是一条连续的甲板，四周与上下都是海', () => {
    const b = deckBounds();
    // 甲板不能铺满全图：左右各留海、上下留海，否则又变回「陆地战场换个配色」
    expect(b.minX).toBeGreaterThanOrEqual(3);
    expect(b.maxX).toBeLessThanOrEqual(map.width - 10);
    expect(b.minY).toBeGreaterThanOrEqual(5);
    expect(b.maxY).toBeLessThanOrEqual(map.height - 3);

    // 海面占可视面积（去掉天空带）的一半以上 —— 「地图是海洋」的量化判据
    const playableRows = map.height - (map.sky_rows ?? 0);
    let sea = 0;
    for (let y = map.sky_rows ?? 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) if (!walkable(x, y)) sea += 1;
    }
    expect(sea / (playableRows * map.width)).toBeGreaterThan(0.5);
  });

  it('从出生点能走到每一格甲板（没有障碍把甲板封死）', () => {
    const seen = new Set<string>();
    const queue: [number, number][] = [[map.spawn.x, map.spawn.y]];
    seen.add(`${map.spawn.x},${map.spawn.y}`);
    while (queue.length) {
      const [x, y] = queue.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        if (!walkable(nx, ny)) continue;
        const k = `${nx},${ny}`;
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
    let total = 0;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (walkable(x, y)) total += 1;
    expect(seen.size, '有可走格到不了（甲板被障碍切开）').toBe(total);
    // 出生点本身必须是可走的
    expect(walkable(map.spawn.x, map.spawn.y)).toBe(true);
  });

  it('地面层用到的瓦片 id 都在 tp_sea 登记表里', () => {
    const sheet = JSON.parse(
      readFileSync(join(ROOT, 'public', 'art', 'tiles', 'sea', 'tileset.json'), 'utf8'),
    ) as { columns: number; imagewidth: number; imageheight: number; tiles: { id: number; file: string }[] };
    expect(sheet.columns).toBe(SEA_SHEET_COLS);
    expect(sheet.imagewidth).toBe(SEA_SHEET_COLS * TILE);
    expect(sheet.imageheight % TILE).toBe(0);

    const ids = new Set(sheet.tiles.map((t) => t.id));
    const used = new Set<number>();
    for (const row of ground) for (const v of row) if (v) used.add(v);
    const unknown = [...used].filter((id) => !ids.has(id)).sort((a, b) => a - b);
    expect(unknown, '地图用了图集里不存在的瓦片 id，渲染会留空洞').toEqual([]);
    // 天空带必须是空的（0），否则远景条会被地砖盖住
    for (let y = 0; y < (map.sky_rows ?? 0); y++) {
      expect(ground[y].every((v) => v === 0), `第 ${y} 行是远景带，不能画地砖`).toBe(true);
    }
    // 每张单图都在
    for (const t of sheet.tiles) {
      expect(existsSync(join(ROOT, 'public', 'art', 'tiles', 'sea', t.file)), t.file).toBe(true);
    }
  });
});

describe('海战节点：Boss 是一艘船，而且砍得到', () => {
  it('第三幕的战斗节点指向海图，开场卡是海战背景', () => {
    expect(seaNode.title).toBe('黄海海战');
    expect(seaNode.type).toBe('combat');
    expect(seaNode.map_ref).toBe(map.id);
    expect(seaNode.banner?.scene).toBe('sea');
    expect(seaNode.banner?.place).toContain('黄海');
    // 战力对比必须写「炮」而不是「枪」：这一关是舰队对轰
    expect(seaNode.banner?.power?.ours).toMatch(/炮/);
  });

  it('Boss 是 ship body 的松岛舰，且锚点落在近战射程内', () => {
    const bossId = seaNode.params.boss as string;
    const boss = enemies.find((e) => e.id === bossId) as EnemyDef;
    expect(boss, `节点引用的 Boss ${bossId} 不存在`).toBeTruthy();
    expect(boss.body).toBe('ship');
    expect(boss.tier).toBe('boss');
    // 96×48：和第一幕的蒸汽炮舰同一套贴图规格
    expect(boss.size).toEqual({ w: 96, h: 48 });

    const anchor = map.boss_anchor;
    expect(anchor, '海图必须给 Boss 一个固定落点，否则会飘在够不到的海面上').toBeTruthy();
    const b = deckBounds();
    const bossX = (anchor!.x + 0.5) * TILE;
    const deckRightX = (b.maxX + 0.5) * TILE;
    // 船心到甲板最右可走格的距离必须在近战射程内，否则玩家永远打不到它
    expect(Math.abs(bossX - deckRightX)).toBeLessThan(MELEE_RANGE_MAX);
    // 而且不能把船锚在甲板里（船是浮在水上的）
    expect(anchor!.x).toBeGreaterThan(b.maxX);
  });

  it('出怪点落在甲板右舷，不会掉进海里', () => {
    const waves = seaNode.params.waves ?? [];
    expect(waves.length).toBeGreaterThanOrEqual(3);
    for (const w of waves) {
      for (const s of w.spawns) {
        expect(enemies.some((e) => e.id === s.enemy), `波次引用了不存在的敌人 ${s.enemy}`).toBe(true);
        expect(s.spawn).toBe('right');
      }
    }
  });
});

describe('海战文案：不许残留陆战措辞', () => {
  const block = (id: string) => dlg.dialogues.find((d) => d.id === id)!;

  it('开场与收尾的说话人与节点登记一致', () => {
    const speakers = new Set<string>();
    for (const id of ['dlg_ch00_act3_jiawu_intro', 'dlg_ch00_act3_jiawu_outro']) {
      for (const l of block(id).lines) speakers.add(l.speaker);
    }
    expect([...speakers].sort()).toEqual([...(seaNode.participants ?? [])].sort());
  });

  it('全是海战语汇，没有「平壤 / 城下 / 阵地 / 后路断了」', () => {
    const text = ['dlg_ch00_act3_jiawu_intro', 'dlg_ch00_act3_jiawu_outro']
      .flatMap((id) => block(id).lines.map((l) => l.text))
      .join('');
    for (const land of ['平壤', '城下', '阵地', '后路']) {
      expect(text.includes(land), `海战对白里还有陆战词「${land}」`).toBe(false);
    }
    expect(text).toMatch(/黄海|定远|致远|威海卫/);
  });

  it('事件卡与知识卡也改成海战口径', () => {
    const events = read<{ events: { id: string; title: string; place: string; result: string }[] }>(
      'events/events_ch00.json',
    ).events;
    const ev = events.find((e) => e.id === 'ev_1894_jiawu')!;
    expect(ev.title).toBe('黄海海战');
    expect(ev.place).toContain('大东沟');
    expect(ev.result).toContain('邓世昌');

    const cards = read<{ cards: { id: string; title: string; summary: string }[] }>(
      'knowledge/knowledge_all.json',
    ).cards;
    const kc = cards.find((c) => c.id === 'kc_1894_jiawu')!;
    expect(kc.title).toContain('黄海海战');
    expect(kc.summary).toContain('北洋');
  });
});
