/**
 * 第三幕（洋务 / 甲午）战场氛围的回归锁。
 *
 * 甲方 2026-11-16：「背景要贴合洋务运动时期，并且要肃杀、黑暗，体现战斗的危险」。
 * 原来海战远景用的是 `bg_strip_dusk.png`：淡紫黄昏 + 黄色**帆船**（鸦片战争年代），
 * 明亮祥和，既不贴题也不危险。这一轮换成蒸汽铁甲舰 + 浓云煤烟 + 中弹火光，
 * 并给第三幕战斗场景叠冷调压暗 + 径向暗角。
 *
 * 两条最容易「改回去就复发」的界线：
 *   1. 黑暗必须靠**大面积平滑的低明度**做，不能往地面撒近黑噪点 —— 上一轮刚
 *      把海面瓦片的黑短划清干净（甲方原话「看着很乱，全是黑点」）。
 *   2. 只影响第三幕，且压暗层必须在 HUD/DOM 之下 —— 否则白字和血条一起变灰。
 *
 * 运行时入口 `gfx/BattleAtmosphere.ts` 依赖 Phaser，node 测试环境不加载它，
 * 接线关系改用「读源码」锁（与 `chronicle.test.ts` 锁 showEnding 同一套做法）。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { ART, BG_TEX, DEPTH, HORIZON_ROWS, PALETTE_LIST, WAR_ATMOSPHERE } from '../src/core/constants';

const ROOT = process.cwd();
const src = (rel: string): string => readFileSync(join(ROOT, 'src', rel), 'utf8');
const png = (rel: string): Buffer => readFileSync(join(ROOT, 'public', rel));

/** 解码 8bit RGBA PNG（filter 0—4），只取 RGB。 */
function decodeRgb(rel: string): { w: number; h: number; rgb: Uint8Array } {
  const buf = png(rel);
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
    } else if (tag === 'IEND') break;
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

const strip = decodeRgb(ART.bgStripJiawu);
const at = (x: number, y: number): [number, number, number] => {
  const o = (y * strip.w + x) * 3;
  return [strip.rgb[o], strip.rgb[o + 1], strip.rgb[o + 2]];
};
const lum = (c: [number, number, number]): number => (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000;
const avgLum = (x0: number, x1: number, y0: number, y1: number): number => {
  let sum = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += lum(at(x, y));
  return sum / ((x1 - x0) * (y1 - y0));
};
const isInk = (x: number, y: number): boolean => {
  const c = at(x, y);
  return c[0] === 0x0d && c[1] === 0x0b && c[2] === 0x14;
};

describe('甲午战时远景条：年代对、气氛暗', () => {
  it('480×64 = sky_rows 4 行，且没有覆盖旧的 dusk 回退图', () => {
    expect(existsSync(join(ROOT, 'public', ART.bgStripJiawu))).toBe(true);
    expect([strip.w, strip.h]).toEqual([480, HORIZON_ROWS * 16]);
    expect(existsSync(join(ROOT, 'public', ART.bgStripDusk))).toBe(true);
    expect(png(ART.bgStripJiawu).equals(png(ART.bgStripDusk))).toBe(false);
    expect(BG_TEX.horizonJiawu).toBe('art_bg_strip_jiawu');
  });

  it('全图只用 24 色盘（硬边像素风，不引入新色）', () => {
    const legal = new Set(PALETTE_LIST.map((n) => `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`));
    for (let y = 0; y < strip.h; y++) {
      for (let x = 0; x < strip.w; x++) {
        const c = at(x, y);
        expect(legal.has(`${c[0]},${c[1]},${c[2]}`), `非 24 色盘 @(${x},${y})`).toBe(true);
      }
    }
  });

  it('顶部 HUD 区与可见区都够暗，亮色只剩零星炮口闪光', () => {
    expect(avgLum(0, 480, 0, 10)).toBeLessThan(32);
    // 1.6 倍放大 + 水平居中裁切后，真正看得见的是原图 x=90..390 / y=0..40
    expect(avgLum(90, 390, 16, 40)).toBeLessThan(62);
    let bright = 0;
    for (let y = 0; y < strip.h; y++) for (let x = 0; x < strip.w; x++) {
      if (lum(at(x, y)) > 150) bright++;
    }
    expect(bright, `亮色像素 ${bright}，旧图就是亮成黄昏旅游照`).toBeLessThan(120);
  });

  it('有火光但不是一整块红：中弹舰的暗红只在云底零星出现', () => {
    const warm = new Set(['140,28,28', '192,57,43', '232,92,74', '78,47,26', '122,79,42']);
    let n = 0;
    for (let y = 0; y < strip.h; y++) for (let x = 0; x < strip.w; x++) {
      const c = at(x, y);
      if (warm.has(`${c[0]},${c[1]},${c[2]}`)) n++;
    }
    // 第一版按距离连续染色铺出 2276 像素的大红三角，像贴了面旗子
    expect(n).toBeGreaterThan(300);
    expect(n).toBeLessThan(3000);
  });

  it('画的是蒸汽铁甲舰：船体与烟囱剪影都在，不是旧式帆船', () => {
    let hull = 0;
    for (let x = 90; x < 390; x++) if (isInk(x, 38)) hull++;
    expect(hull, `y=38 船体墨色像素 ${hull}`).toBeGreaterThan(120);
    let stacks = 0;
    for (let x = 90; x < 390; x++) if (isInk(x, 24)) stacks++;
    expect(stacks, `烟囱竖条 ${stacks} 段`).toBeGreaterThanOrEqual(6);
    // 帆船的识别物是成片亮黄帆布：可见区不能有亮黄的大色块
    let sails = 0;
    for (let y = 16; y < 40; y++) for (let x = 90; x < 390; x++) {
      const [r, g, b] = at(x, y);
      if (r > 180 && g > 140 && b < 120) sails++;
    }
    expect(sails, `可见区亮黄帆布 ${sails} 像素`).toBeLessThan(40);
  });
});

describe('战场氛围：只压第三幕、且不压到 HUD', () => {
  it('启用名单只有第三幕，其余四幕一个像素都不变', () => {
    expect([...WAR_ATMOSPHERE.acts]).toEqual(['ch00_act3']);
    for (const id of ['ch00_act1', 'ch00_act2', 'ch00_act4', 'ch00_act5']) {
      expect(WAR_ATMOSPHERE.acts.includes(id as 'ch00_act3')).toBe(false);
    }
  });

  it('参数是「压暗但看得清」的区间，不是把整屏蒙死', () => {
    expect(WAR_ATMOSPHERE.cool.alpha).toBeGreaterThan(0.1);
    expect(WAR_ATMOSPHERE.cool.alpha).toBeLessThan(0.35);
    expect(WAR_ATMOSPHERE.vignette.mid).toBeGreaterThan(0);
    expect(WAR_ATMOSPHERE.vignette.mid).toBeLessThan(WAR_ATMOSPHERE.vignette.edge);
    expect(WAR_ATMOSPHERE.vignette.edge).toBeLessThan(0.8);
    expect(WAR_ATMOSPHERE.skyShade).toBeGreaterThan(0);
    // 压暗层必须低于 canvas HUD，DOM 文字层天生在其上
    expect(DEPTH.vignette).toBeLessThan(DEPTH.hud);
  });

  it('LevelScene 接线完整：换图先销毁旧氛围、只给第三幕应用', () => {
    const level = src('scenes/LevelScene.ts');
    expect(level).toContain('applyBattleAtmosphere(this, this.act?.id)');
    expect(level).toContain('this.atmosphereObjects.forEach((o) => o.destroy())');
    expect(level).toContain('atmosphereEnabled(this.act?.id)');
    expect(level).toContain('SEA_TILESET_ID');
    expect(level).toContain("'jiawu'");
    expect(level).toContain('BG_TEX.horizonJiawu');
    expect(level).toContain('ART.bgStripJiawu');
  });

  it('horizonImage 的 jiawu 分支首选用新图、缺图仍回退 dusk', () => {
    const backdrop = src('gfx/Backdrop.ts');
    expect(backdrop).toContain("jiawu: [BG_TEX.horizonJiawu, BG_TEX.horizonDusk, BG_TEX.horizon]");
    expect(backdrop).toMatch(/'cityfall'\s*\|\s*'jiawu'/);
  });
});
