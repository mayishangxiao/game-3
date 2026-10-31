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
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ART, CONTROL_LAYOUT, HORIZON_ROWS, SCAR_TEX, SHIP_FRAME, SHIP_TEX, TEX_CRATE } from '../src/core/constants';

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
    const all = [...ART.shipBossFrames, ART.crate, ART.portraitLinZexu, ART.portraitGuanTianpei];
    const missing = all.filter((p) => !existsSync(join(PUBLIC, p)));
    expect(missing).toEqual([]);
  });

  it('路径写法统一：不带 public 前缀，用正斜杠', () => {
    for (const p of [...ART.shipBossFrames, ART.crate, ART.portraitLinZexu, ART.portraitGuanTianpei]) {
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

  it('地图开了 sky_rows 就必须把那几行做成实心（否则玩家会走进远景带）', () => {
    for (const file of ['map_ch00_act1b.json']) {
      const map = JSON.parse(
        readFileSync(join(PUBLIC, 'data', 'maps', file), 'utf8'),
      ) as {
        sky_rows?: number;
        layers: { name: string; data: number[][] }[];
      };
      const sky = map.sky_rows ?? 0;
      expect(sky, `${file} 应该开远景`).toBeGreaterThan(0);
      const col = map.layers.find((l) => l.name === 'collision');
      expect(col).toBeTruthy();
      for (let y = 0; y < sky; y++) {
        expect((col as { data: number[][] }).data[y].every((v) => v !== 0), `${file} 第 ${y} 行可走`).toBe(true);
      }
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