/**
 * 黄海海战（第三幕 nd_1894_jiawu_battle）的数据锁。
 *
 * 用户 2026-11-15 的要求是「洋务运动必须要有甲午海战，并且地图是海洋」。
 * 这一关和别的关卡有三处结构性不同，都是**改回陆地就会静默失效**的那类，
 * 所以单独锁一份：
 *   1. 地图是 `tp_sea` 图集、可走区只有中间一条甲板，四周是海（碰撞层）；
 *   2. Boss 是 `body: 'ship'` 的吉野号，锚点必须落在能砍到的距离内
 *      （默认的「右端 −100px」在这儿会让敌舰停在 90 多像素外，近战 60px 够不着）；
 *   3. v2.6 我方也有军舰「致远舰」：ship_duel 数据锁住五项实力对比、逐阶段交锋、
 *      以及「致远撞向吉野」的撞舰收尾，敌方帧集换成吉野号（双烟囱 / 高速飞剪艏）；
 *   4. 文案不残留陆战词（平壤 / 城下 / 阵地 / 后路断了），
 *      否则会出现「点击开始战斗，写着平壤城下，画面上是一条军舰」。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
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
interface ShipCompareRow {
  label: string;
  ours: string;
  enemy: string;
}
interface NodeDef {
  id: string;
  title: string;
  type: string;
  map_ref: string | null;
  banner?: { time: string; place: string; scene?: string; power?: { ours: string; enemy: string; gap?: string } };
  params: { boss?: string; waves?: { spawns: { enemy: string; count: number; spawn: string }[] }[] };
  participants: string[];
  ship_duel?: {
    title: string;
    ours: { name: string; scale: number };
    enemy: { name: string; scale: number };
    rows: ShipCompareRow[];
    gap: string;
    phases: { at: number; title: string; line: string }[];
    finale: { title: string; lines: string[] };
  };
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

  it('Boss 是 ship body 的吉野号，且锚点落在近战射程内', () => {
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

/**
 * 解一张 8bit RGBA 非隔行小 PNG 的 RGB（本工程瓦片都是这个格式，不引第三方依赖）。
 * 只用来数「甲板接缝瓦片里有没有亮钉像素」，不需要 alpha。
 */
function tileRgb(rel: string): { w: number; h: number; rgb: Uint8Array } {
  const buf = readFileSync(join(ROOT, 'public', rel));
  let pos = 8;
  let idat = Buffer.alloc(0);
  let w = 0;
  let h = 0;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const tag = buf.subarray(pos + 4, pos + 8).toString('ascii');
    const body = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (tag === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
    } else if (tag === 'IDAT') {
      idat = Buffer.concat([idat, body]);
    } else if (tag === 'IEND') {
      break;
    }
  }
  const raw = inflateSync(idat);
  const stride = w * 4;
  const prev = new Uint8Array(stride);
  const rgb = new Uint8Array(w * h * 3);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = new Uint8Array(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 255;
      else if (filter === 2) line[i] = (line[i] + b) & 255;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const s = x * 4;
      rgb[o] = line[s];
      rgb[o + 1] = line[s + 1];
      rgb[o + 2] = line[s + 2];
    }
    prev.set(line);
  }
  return { w, h, rgb };
}

describe('甲板接缝不许再连成亮虚线', () => {
  it('deck_seam 瓦片里没有浅灰亮钉（GREY_L / 亮度 > 180）像素', () => {
    const { w, h, rgb } = tileRgb('art/tiles/sea/sea_deck_seam.png');
    expect([w, h]).toEqual([16, 16]);
    let bright = 0;
    for (let i = 0; i < rgb.length; i += 3) {
      if (rgb[i] > 180 && rgb[i + 1] > 180 && rgb[i + 2] > 180) bright++;
    }
    // 亮钉每 4px 一对、成列铺满整船时，实拍是一排贯穿甲板的黄色虚线
    expect(bright, `deck_seam 还剩 ${bright} 个亮钉像素`).toBe(0);
  });
});

describe('海面不许铺近黑噪点', () => {
  it('五张海面瓦片里没有 NIGHT / INK 级别的近黑像素', () => {
    for (const name of ['sea_deep_a', 'sea_deep_b', 'sea_wave', 'sea_foam', 'sea_swell']) {
      // 单图命名是 `sea_` + 瓦片 name（海面类因此是 sea_sea_*.png）
      const { rgb } = tileRgb(`art/tiles/sea/sea_${name}.png`);
      let dark = 0;
      for (let i = 0; i < rgb.length; i += 3) {
        // NIGHT(28,26,43) / INK(13,11,20) 三通道都 < 60；
        // INDIGO(42,90,138) / PLUM_D(47,43,69) / BLUE 系都够亮，不会误伤。
        if (rgb[i] < 60 && rgb[i + 1] < 60 && rgb[i + 2] < 60) dark++;
      }
      // 377 格海面 × 每格 1~2 条黑短划 = 一屏黑点（甲方 2026-11-16 截图）
      expect(dark, `${name} 还有 ${dark} 个近黑像素`).toBe(0);
    }
  });
});

describe('吉野号专属 6 帧（不再复用第一幕英舰）', () => {
  const frames = [0, 1, 2, 3, 4, 5].map((i) =>
    tileRgb(`art/ship/yoshino_${String(i).padStart(2, '0')}.png`),
  );
  type EnemyLite = { id: string; body?: string; ship_art?: string };
  const raw = read<EnemyLite[] | { enemies: EnemyLite[] }>('enemies/enemies_ch00.json');
  const list = Array.isArray(raw) ? raw : raw.enemies;

  it('数据里吉野号用 yoshino 帧集、英舰仍用 steamfrigate', () => {
    const byId = new Map(list.map((e) => [e.id, e]));
    expect(byId.get('en_boss_jp_yoshino')?.ship_art).toBe('yoshino');
    expect(byId.get('en_boss_steamfrigate')?.ship_art).toBe('steamfrigate');
  });

  it('6 帧都是 96×48、颜色数 ≥14（旧英舰只有 8 色几何占位）', () => {
    for (const f of frames) {
      expect([f.w, f.h]).toEqual([96, 48]);
      const colors = new Set<string>();
      for (let i = 0; i < f.rgb.length; i += 3) {
        colors.add(`${f.rgb[i]},${f.rgb[i + 1]},${f.rgb[i + 2]}`);
      }
      expect(colors.size, `只有 ${colors.size} 种颜色`).toBeGreaterThanOrEqual(14);
    }
  });

  it('6 帧状态各不相同（旧图几乎一样，看不出开炮 / 冒烟 / 破损）', () => {
    const base = frames[0].rgb;
    for (let k = 1; k < frames.length; k++) {
      const o = frames[k].rgb;
      let diff = 0;
      for (let i = 0; i < base.length; i += 3) {
        if (base[i] !== o[i] || base[i + 1] !== o[i + 1] || base[i + 2] !== o[i + 2]) diff++;
      }
      expect(diff, `第 ${k} 帧与 idle 只有 ${diff} 个像素不同`).toBeGreaterThanOrEqual(60);
    }
  });

  it('贴图里没有旧英舰那整条蓝色水线（水面交给地图瓦片）', () => {
    for (const f of frames) {
      let blue = 0;
      for (let i = 0; i < f.rgb.length; i += 3) {
        const [r, g, b] = [f.rgb[i], f.rgb[i + 1], f.rgb[i + 2]];
        // INDIGO(42,90,138) / BLUE(74,144,200)：旧图 y=40..47 铺满的一整条
        if ((r === 42 && g === 90 && b === 138) || (r === 74 && g === 144 && b === 200)) blue++;
      }
      expect(blue, `还残留 ${blue} 个水线像素`).toBe(0);
    }
  });

  it('挂的是日章旗（白底红日），不是第一幕的英军十字旗', () => {
    // RED(192,57,43) 只用于旗面红日；火光是 RED_B / RED_D，不会误伤
    for (const f of frames) {
      let red = 0;
      for (let i = 0; i < f.rgb.length; i += 3) {
        if (f.rgb[i] === 192 && f.rgb[i + 1] === 57 && f.rgb[i + 2] === 43) red++;
      }
      expect(red, `红日只有 ${red} 像素`).toBeGreaterThanOrEqual(15);
    }
  });
});

describe('双舰交锋剧本（v2.6：致远撞吉野）', () => {
  const duel = seaNode.ship_duel!;

  it('海战节点带 ship_duel：我方致远、敌方吉野，对照卡有名字', () => {
    expect(duel, '海战节点必须写 ship_duel，否则不会有对照卡与撞舰收尾').toBeTruthy();
    expect(duel.title).toContain('致远');
    expect(duel.title).toContain('吉野');
    expect(duel.ours.name).toBe('致远舰');
    expect(duel.enemy.name).toBe('吉野号');
    // 敌方显示倍率必须明显大于我方——舰体规模差距靠这个一眼可见
    expect(duel.enemy.scale).toBeGreaterThan(duel.ours.scale);
  });

  it('五项实力对比齐全：舰体规模 / 火力配置 / 航速 / 装甲 / 战场态势', () => {
    const labels = duel.rows.map((r) => r.label);
    expect(labels).toEqual(['舰体规模', '火力配置', '航速', '装甲', '战场态势']);
    for (const r of duel.rows) {
      expect(r.ours.length).toBeGreaterThan(0);
      expect(r.enemy.length).toBeGreaterThan(0);
    }
    // 吉野那侧要读得出速射炮 / 吨位优势，不能两边.write 一样的话
    const fire = duel.rows.find((r) => r.label === '火力配置')!;
    expect(fire.enemy).toMatch(/速射炮/);
    expect(fire.ours).toMatch(/旧炮/);
  });

  it('交锋阶段数值递减、写「交锋」，最后一句收在致远撞向吉野', () => {
    expect(duel.phases.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < duel.phases.length; i++) {
      expect(duel.phases[i].at, '阶段 at 必须递减，否则播报顺序会乱').toBeLessThan(duel.phases[i - 1].at);
    }
    for (const p of duel.phases) expect(p.title).toContain('交锋');
    const finale = duel.finale.lines.join('');
    expect(finale).toMatch(/冲上去|撞/);
    expect(duel.finale.title).toContain('致远');
    expect(duel.finale.title).toContain('吉野');
  });

  it('引擎接线：LevelScene 读 ship_duel 播对照卡与撞舰，Enemy 有阶段回调', () => {
    const scene = readFileSync(join(ROOT, 'src', 'scenes', 'LevelScene.ts'), 'utf8');
    const enemy = readFileSync(join(ROOT, 'src', 'entities', 'Enemy.ts'), 'utf8');
    expect(scene).toContain('showShipCompare(node.ship_duel');
    expect(scene).toContain('playShipFinale(duel');
    expect(scene).toContain('announceDuelPhase(duel, 0)');
    expect(enemy).toContain('this.onPhaseChange?.(this, next)');
  });
});
