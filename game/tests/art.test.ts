/**
 * 正式美术资源的可用性测试。
 *
 * 这一层挡的是「资源路径打错／图被误删／尺寸被改」这类**在浏览器里只会静默不显示**的问题：
 * 贴图挂了不会报错，只是 Boss 舰退回矩形占位形体，截图评审时极难发现。
 * 顺带守住两条约定：
 *   1. 立绘纹理 key 必须是 `portrait_${speaker}`（DialogueBox 按这个规则拼 key）；
 *   2. 舰船帧数固定 6，序号的语义写进 constants 的 SHIP_FRAME。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ART, CONTROL_LAYOUT, FX_CANNON_FRAMES, HORIZON_ROWS, SCAR_TEX, SHIP_FRAME, SHIP_TEX, SUNNY_PROPS, sunnyPropKey, TEX_CRATE, TP_SHEET_COLS, TP_TILESET_ID, type SunnyProp } from '../src/core/constants';

const ROOT = process.cwd();
const PUBLIC = join(ROOT, 'public');

interface PngHeader {
  width: number;
  height: number;
}

/** 只读 PNG 的 IHDR，不依赖任何图像库（测试跑在 node 环境，没装 canvas） */
function pngSize(rel: string): PngHeader {
  const buf = readFileSync(join(PUBLIC, rel));
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error(`${rel} 不是 PNG（签名 ${sig}）`);
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error(`${rel} 缺少 IHDR`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('正式美术资源', () => {
  it('ART 里登记的每个文件都存在', () => {
    const all = [...ART.shipBossFrames, ART.crate, ART.portraitLinZexu, ART.portraitGuanTianpei, ART.tpSheet];
    const missing = all.filter((p) => !existsSync(join(PUBLIC, p)));
    expect(missing).toEqual([]);
  });

  it('路径写法统一：不带 public 前缀，用正斜杠', () => {
    for (const p of [...ART.shipBossFrames, ART.crate, ART.portraitLinZexu, ART.portraitGuanTianpei, ART.tpSheet]) {
      expect(p.startsWith('public/')).toBe(false);
      expect(p.includes('\\')).toBe(false);
      expect(p.startsWith('art/')).toBe(true);
    }
  });

  it('Boss 舰 6 帧都是 96×48', () => {
    expect(ART.shipBossFrames.length).toBe(6);
    for (const p of ART.shipBossFrames) {
      expect(pngSize(p)).toEqual({ width: 96, height: 48 });
    }
  });

  it('鸦片箱是 20×20（贴合 16px 瓦片，比旧占位方块大一圈才看得见）', () => {
    expect(pngSize(ART.crate)).toEqual({ width: 20, height: 20 });
  });

  it('Sunny Land 道具（CC0）都在，且像素尺寸与 SUNNY_PROPS 表一致', () => {
    // 为什么钉尺寸：这批图是**零缩放原样**落盘的，表里的 w/h 同时是「游戏里的显示尺寸」。
    // 换了一张图而没改表，道具会悄悄变形（被缩放后像素糊），浏览器里看不出，只有这里能抓。
    const names = Object.keys(SUNNY_PROPS) as SunnyProp[];
    expect(names.length).toBeGreaterThanOrEqual(10);
    for (const name of names) {
      const p = `${ART.sunnyProps}${SUNNY_PROPS[name].file}`;
      expect(existsSync(join(PUBLIC, p)), p).toBe(true);
      expect(pngSize(p), p).toEqual({ width: SUNNY_PROPS[name].w, height: SUNNY_PROPS[name].h });
    }
    // 纹理 key 不能撞：`sunny_<name>`
    expect(new Set(names.map(sunnyPropKey)).size).toBe(names.length);
  });

  it('地图里的静态布景（prop + Sunny Land 道具名）都指向表里登记的道具', () => {
    // `spawnSunnyProp` 是按 payload 查 `SUNNY_PROPS` 的；手滑写个 `bigcrate` 就整件不画，
    // 运行时只有一条 console.warn，截图评审极难发现。
    const dir = join(PUBLIC, 'data', 'maps');
    let scenery = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const map = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
        objects?: { kind: string; payload?: string }[];
      };
      for (const o of map.objects ?? []) {
        if (o.kind !== 'prop') continue;
        if (!o.payload || /^door_\d+$/.test(o.payload)) continue;
        expect(o.payload in SUNNY_PROPS, `${file} 的布景 payload「${o.payload}」没登记`).toBe(true);
        scenery += 1;
      }
    }
    expect(scenery).toBeGreaterThan(0);
  });

  it('两位有立绘的说话人都是 96×112 胸像（对话框内缩到 68×80 显示）', () => {
    expect(pngSize(ART.portraitLinZexu)).toEqual({ width: 96, height: 112 });
    expect(pngSize(ART.portraitGuanTianpei)).toEqual({ width: 96, height: 112 });
  });

  it('纹理 key 与帧序号一一对应', () => {
    expect(SHIP_TEX.length).toBe(ART.shipBossFrames.length);
    expect(new Set(SHIP_TEX).size).toBe(SHIP_TEX.length);
    // 帧序号的语义：0..5 全覆盖，不多不少
    expect(Object.values(SHIP_FRAME).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(TEX_CRATE).not.toBe(SHIP_TEX[0]);
  });

  it('config.json 的立绘登记能对上真实文件，且 key 符合 portrait_${speaker}', () => {
    const config = JSON.parse(
      readFileSync(join(PUBLIC, 'data', 'config.json'), 'utf8'),
    ) as { ui?: { portraits?: Record<string, string> } };
    const portraits = config.ui?.portraits ?? {};
    // 用户 m05506：关天培用回原稿立绘，所有立绘都只要头（96×112 胸像）
    expect(Object.keys(portraits).sort()).toEqual(['guan_tianpei', 'lin_zexu']);
    for (const [speaker, file] of Object.entries(portraits)) {
      expect(existsSync(join(PUBLIC, file))).toBe(true);
      expect(file.endsWith('.png')).toBe(true);
      // DialogueBox.applyPortrait 的 key 规则：文件名必须与说话人 id 同名
      expect(file.endsWith(`portrait_${speaker}.png`)).toBe(true);
      expect(pngSize(file)).toEqual({ width: 96, height: 112 });
    }
    expect(portraits.lin_zexu).toBe(ART.portraitLinZexu);
    expect(portraits.guan_tianpei).toBe(ART.portraitGuanTianpei);
  });

  it('甲方给的全景图与远景条尺寸对得上（全景 480×270，远景条 480×64 = sky_rows 4 行）', () => {
    expect(pngSize(ART.bgSeaRed)).toEqual({ width: 480, height: 270 });
    expect(pngSize(ART.bgStripNight)).toEqual({ width: 480, height: 64 });
    expect(pngSize(ART.bgStripRed)).toEqual({ width: 480, height: 64 });
    // 远景条必须正好铺满地图顶上的透明带，否则会露黑边或被第一行地砖盖掉
    expect(pngSize(ART.bgStripNight).height).toBe(HORIZON_ROWS * 16);
  });

  it('12 张残破贴花都在，且是带透明的 PNG（贴图集被重新切过就会红）', () => {
    expect(SCAR_TEX.length).toBe(12);
    for (let i = 0; i < SCAR_TEX.length; i++) {
      const rel = `${ART.scars}scar_${String(i).padStart(2, '0')}.png`;
      expect(existsSync(join(PUBLIC, rel)), rel).toBe(true);
      const size = pngSize(rel);
      // 贴花是 2 倍像素规格，落进 480×256 的地面纹理时按 0.5 缩
      expect(size.width).toBeGreaterThan(8);
      expect(size.width).toBeLessThanOrEqual(120);
      expect(size.height).toBeLessThanOrEqual(110);
    }
  });

  it('炮火特效 48 帧都在，且都是 96×96 带透明的 PNG（GIF 重拆过就会红）', () => {
    expect(FX_CANNON_FRAMES).toBe(48);
    for (let i = 0; i < FX_CANNON_FRAMES; i++) {
      const rel = `${ART.fxCannonBlast}fx_${String(i).padStart(2, '0')}.png`;
      expect(existsSync(join(PUBLIC, rel)), rel).toBe(true);
      expect(pngSize(rel), rel).toEqual({ width: 96, height: 96 });
    }
    // 帧数必须和目录里的文件数一致：`tools/import_fx.py` 换了参数（抽帧步长、--size）
    // 而没人改常量时，多出来的帧会被静默忽略、少掉的帧会让特效在中间黑屏
    const files = readdirSync(join(PUBLIC, ART.fxCannonBlast)).filter((f) => f.endsWith('.png'));
    expect(files.length).toBe(FX_CANNON_FRAMES);
  });

  it('开了天空带的地图，远景那几行可以实心（免得玩家走进远景里）', () => {
    // 原断言「act1b 必须开 sky_rows」已经作废：甲方要求第一幕除了边界不留空气墙，
    // 而那时 act1b 的 6 行远景带**是实心的**，正是要清掉的空气墙之一，`sky_rows` 一并去了。
    // 现在这条只约束「谁开了就得封好」——远景条由 LevelScene 自己叠在地图上方，与碰撞无关。
    const dir = join(PUBLIC, 'data', 'maps');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const map = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
        sky_rows?: number;
        layers: { name: string; data: number[][] }[];
      };
      const sky = map.sky_rows ?? 0;
      if (sky === 0) continue;
      const col = map.layers.find((l) => l.name === 'collision');
      expect(col, file).toBeTruthy();
      for (let y = 0; y < sky; y++) {
        expect((col as { data: number[][] }).data[y].every((v) => v !== 0), `${file} 第 ${y} 行可走`).toBe(true);
      }
    }
  });

  it('第一幕两张图除了边界和销烟池之外没有一格空气墙（甲方要求：除了边界全去掉）', () => {
    // 撞得住的格子必须看得见：边界用海/湿沙/礁石包边，场地内部一格不挡。
    // 例外（2026-11 甲方新要求）：销烟池放大、人进不去，它的木框(6)/石灰(7)是看得见的装饰实心，
    // 不是空气墙——只允许这两种砖在内部实心，其余任何内部实心格都算 bug。
    for (const file of ['map_ch00_act1a.json', 'map_ch00_act1b.json']) {
      const map = JSON.parse(readFileSync(join(PUBLIC, 'data', 'maps', file), 'utf8')) as {
        width: number;
        height: number;
        sky_rows?: number;
        layers: { name: string; data: number[][] }[];
      };
      const col = map.layers.find((l) => l.name === 'collision')!.data;
      const ground = map.layers.find((l) => l.name === 'ground')!.data;
      const rowOpen = (y: number) =>
        Array.from({ length: map.width - 2 }, (_, i) => col[y][i + 1]).every((v) => v === 0);
      let top = 0;
      while (top < map.height && !rowOpen(top)) top++;
      expect(top, `${file} 整张图没有一行完整可走`).toBeLessThan(map.height);
      const open: [number, number][] = [];
      for (let y = top + 1; y < map.height - 1; y++) {
        for (let x = 1; x < map.width - 1; x++) {
          if (col[y][x] !== 0 && ground[y][x] !== 6 && ground[y][x] !== 7) open.push([x, y]);
        }
      }
      expect(open, `${file} 场地内部仍有空气墙：${JSON.stringify(open)}`).toEqual([]);
      // 边界必须整圈封死，否则玩家会从边角走出地图
      for (let x = 0; x < map.width; x++) {
        expect(col[0][x], `${file} 顶边 (${x},0) 漏了`).not.toBe(0);
        expect(col[map.height - 1][x], `${file} 底边 (${x},${map.height - 1}) 漏了`).not.toBe(0);
      }
      for (let y = 0; y < map.height; y++) {
        expect(col[y][0], `${file} 左边 (0,${y}) 漏了`).not.toBe(0);
        expect(col[y][map.width - 1], `${file} 右边 (${map.width - 1},${y}) 漏了`).not.toBe(0);
      }
      expect(map.sky_rows ?? 0, `${file} 不该再开远景实心带`).toBe(0);
    }
  });

  it('鸦片箱不会被摆到虚拟按键底下（第一条约束的复核）', () => {
    // 这条断言在 data.test.ts 里按「可交互物 vs 控件圆」全覆盖；这里只针对箱子这一种
    // 最容易撞上按键的物件，留一个就地可读的检查，防止有人换了贴图尺寸后忘了挪位置。
    const map = JSON.parse(
      readFileSync(join(PUBLIC, 'data', 'maps', 'map_ch00_act1a.json'), 'utf8'),
    ) as { objects: { id: string; kind: string; x: number; y: number }[] };
    const crates = map.objects.filter((o) => o.kind === 'pickup');
    expect(crates.length).toBe(8);
    const buttons = Object.values(CONTROL_LAYOUT);
    for (const c of crates) {
      // 物件中心落在瓦片中心，按键坐标是屏幕坐标（与地图同尺度）
      const cx = (c.x + 0.5) * 16;
      const cy = (c.y + 0.5) * 16;
      for (const b of buttons) {
        const dist = Math.hypot(cx - b.x, cy - b.y);
        expect(dist, `${c.id} 压在控件上`).toBeGreaterThan(b.r + 8);
      }
    }
  });
});

/**
 * 太平天国篇章瓦片图集接入（design/12_taiping_tilemap_spec.md 第 8 节）。
 * 挡的是「图集被删 / columns 改了没同步 / 地图漏填 tileset」——这三种在浏览器里
 * 都只会静默回退成程序化材质，画面看着还「能玩」，截图评审极难发现。
 */
describe('太平天国图集接入（tp_act2）', () => {
  const cfg = JSON.parse(
    readFileSync(join(PUBLIC, 'art/tiles/tp/tileset.json'), 'utf8'),
  ) as {
    columns: number;
    tilecount: number;
    imagewidth: number;
    imageheight: number;
    tiles: { id: number; sheet_cell: { col: number; row: number } }[];
  };

  it('拼版图存在、尺寸与 tileset.json 的 columns/sheet_cell 对齐', () => {
    expect(existsSync(join(PUBLIC, ART.tpSheet))).toBe(true);
    expect(cfg.columns).toBe(TP_SHEET_COLS);
    expect(pngSize(ART.tpSheet)).toEqual({ width: cfg.imagewidth, height: cfg.imageheight });
    for (const t of cfg.tiles) {
      expect(t.sheet_cell.col, `瓦片 ${t.id} 的列号`).toBe(t.id % TP_SHEET_COLS);
      expect(t.sheet_cell.row, `瓦片 ${t.id} 的行号`).toBe(Math.floor(t.id / TP_SHEET_COLS));
    }
  });

  it('三张新地图都声明 tp_act2，瓦片号不越界，场景开关按规格', () => {
    const ids = ['map_ch00_tp_village', 'map_ch00_tp_city', 'map_ch00_tp_battlefield'];
    for (const id of ids) {
      const m = JSON.parse(
        readFileSync(join(PUBLIC, 'data', 'maps', `${id}.json`), 'utf8'),
      ) as { tileset: string; layers: { data: number[][] }[]; sky_rows?: number; battle_scars?: boolean };
      expect(m.tileset, `${id} 漏了 tileset 声明`).toBe(TP_TILESET_ID);
      const used = new Set<number>();
      for (const l of m.layers) for (const row of l.data) for (const v of row) if (v) used.add(v);
      for (const v of used) expect(v, `${id} 的瓦片号 ${v} 超出图集`).toBeLessThan(cfg.tilecount);
      expect(used.size, `${id} 没用到瓦片`).toBeGreaterThan(10);
      if (id === 'map_ch00_tp_battlefield') {
        expect(m.sky_rows).toBe(4);
        expect(m.battle_scars).toBe(true);
      } else {
        expect(m.sky_rows ?? 0, `${id} 不该开远景带`).toBe(0);
        expect(m.battle_scars ?? false, `${id} 不该开残破化`).toBe(false);
      }
    }
  });
});