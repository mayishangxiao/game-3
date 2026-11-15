/**
 * 兵种贴图与「敌人 id → 兵种」映射的可用性测试（v1.9.1）。
 *
 * 挡的是「贴图没画 / 画了没登记 / 登记了但敌人没指过来」这三类**在浏览器里完全静默**
 * 的问题：`CharacterRig` 找不到纹理就退回矩形小人，不报错、不白屏，只是在手机上
 * 一片纯色方块。设计书 6.3.2 的缺口表里，「湘军统领、洋枪队长、匪兵、匪弩手、巡捕、
 * 流氓、码头把头没有贴图」这一格就是靠这个测试关掉的。
 *
 * 另外锁两条像素美术的硬约束：
 *   1. 24×32、脚底落在最后一行（`CharacterRig` 用 `origin(0.5, 1)` 对齐脚底）；
 *   2. 只有全透明和全不透明——出现半透明像素说明某一步做了抗锯齿/缩放，放大后会糊。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { UNIT_ART, unitArtOf } from '../src/core/constants';

const ROOT = process.cwd();
const PUBLIC = join(ROOT, 'public');
const ART_DIR = join(PUBLIC, 'art', 'units');
const FACINGS = ['down', 'up', 'left', 'right'] as const;

interface Decoded {
  width: number;
  height: number;
  /** 每个像素的 alpha */
  alpha: Uint8Array;
  /** 每个像素的 RGBA */
  rgba: Uint8Array;
}

/** 解 8bit RGBA 非隔行 PNG（本工程所有兵种图都是这个格式，够用且不引依赖） */
function decodePng(rel: string): Decoded {
  const buf = readFileSync(join(PUBLIC, rel));
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${rel} 不是 PNG`);
  let pos = 8;
  let idat = Buffer.alloc(0);
  let width = 0;
  let height = 0;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const tag = buf.subarray(pos + 4, pos + 8).toString('ascii');
    const body = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (tag === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const colorType = body.readUInt8(9);
      if (colorType !== 6) throw new Error(`${rel} 不是 RGBA（colorType=${colorType}）`);
    } else if (tag === 'IDAT') {
      idat = Buffer.concat([idat, body]);
    } else if (tag === 'IEND') {
      break;
    }
  }
  const raw = inflateSync(idat);
  const stride = width * 4;
  const prev = new Uint8Array(stride);
  const out = new Uint8Array(width * height * 4);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = new Uint8Array(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[i] = (line[i] + pr) & 0xff;
      }
    }
    out.set(line, y * stride);
    prev.set(line);
  }
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) alpha[i] = out[i * 4 + 3];
  return { width, height, alpha, rgba: out };
}

/** 数据里出现过的所有敌人 id */
function enemyIds(): string[] {
  const ids = new Set<string>();
  const dir = join(PUBLIC, 'data', 'enemies');
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (k === 'id' && typeof v === 'string' && v.startsWith('en_')) ids.add(v);
          else walk(v);
        }
      }
    };
    walk(raw);
  }
  return [...ids].sort();
}

describe('兵种小人贴图（v1.9.1）', () => {
  it('UNIT_ART 里每个兵种的四朝向都在磁盘上', () => {
    const missing: string[] = [];
    for (const [unit] of Object.entries(UNIT_ART)) {
      for (const f of FACINGS) {
        if (!existsSync(join(ART_DIR, `${unit}_${f}.png`))) missing.push(`${unit}_${f}.png`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('磁盘上没有未登记的兵种图（多一张就是白占包体、少一张就是静默方块）', () => {
    const onDisk = readdirSync(ART_DIR)
      .filter((f) => f.endsWith('.png') && !f.startsWith('_'))
      .map((f) => f.replace(/_(down|up|left|right)\.png$/, ''))
      .filter((unit, i, arr) => arr.indexOf(unit) === i)
      .sort();
    expect(onDisk).toEqual(Object.keys(UNIT_ART).sort());
  });

  it('全部是 24×32，且只有全透明/全不透明两种 alpha', () => {
    const problems: string[] = [];
    for (const unit of Object.keys(UNIT_ART)) {
      for (const f of FACINGS) {
        const img = decodePng(`art/units/${unit}_${f}.png`);
        if (img.width !== 24 || img.height !== 32) problems.push(`${unit}_${f}: ${img.width}×${img.height}`);
        let semi = 0;
        for (let i = 0; i < img.alpha.length; i++) {
          const a = img.alpha[i];
          if (a !== 0 && a !== 255) semi++;
        }
        if (semi > 0) problems.push(`${unit}_${f}: ${semi} 个半透明像素（放大后会糊）`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('脚底落在最后一行（否则角色会浮空/陷进地面）', () => {
    const floating: string[] = [];
    for (const unit of Object.keys(UNIT_ART)) {
      for (const f of FACINGS) {
        const img = decodePng(`art/units/${unit}_${f}.png`);
        let bottom = -1;
        for (let y = img.height - 1; y >= 0 && bottom < 0; y--) {
          for (let x = 0; x < img.width; x++) {
            if (img.alpha[y * img.width + x] > 0) {
              bottom = y;
              break;
            }
          }
        }
        if (bottom !== img.height - 1) floating.push(`${unit}_${f}: 最低一行是 ${bottom}`);
      }
    }
    expect(floating).toEqual([]);
  });

  it('数据里出现的每个敌人都能映射到一个存在的兵种', () => {
    const ids = enemyIds();
    expect(ids.length).toBeGreaterThan(15);
    const bad = ids
      .map((id) => [id, unitArtOf(id)] as const)
      .filter(([, unit]) => !(unit in UNIT_ART));
    expect(bad).toEqual([]);
  });

  it('第二幕角色不再共用英军步兵的皮（这是缺口表那一格的核心判据）', () => {
    // 以前 en_bandit / en_thug / en_concession_patrol / en_elite_dock 全落到 uk_infantry，
    // 战场上敌我分不清。这里按「角色语义」逐条钉住。
    const expectMap: Record<string, string> = {
      en_boss_xiangarmy_a: 'xiang_army',
      en_boss_xiangarmy_b: 'xiang_rifle',
      en_bandit: 'bandit',
      en_boss_bandit_chief: 'bandit_chief',
      en_bandit_crossbow: 'bandit_crossbow',
      en_concession_patrol: 'patrol',
      en_elite_dock: 'dock_boss',
      en_gang_thug: 'thug',
      en_thug: 'thug',
      en_qing_cavalry: 'qing_cavalry',
      en_uk_officer: 'uk_officer',
    };
    for (const [id, unit] of Object.entries(expectMap)) expect(unitArtOf(id), id).toBe(unit);
  });

  it('新兵种的正面图彼此不同（防止一次配色改错，几个兵种长得一模一样）', () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const unit of Object.keys(UNIT_ART)) {
      const key = Buffer.from(decodePng(`art/units/${unit}_down.png`).rgba).toString('base64');
      const prev = seen.get(key);
      if (prev) dup.push(`${prev} 与 ${unit}`);
      else seen.set(key, unit);
    }
    expect(dup).toEqual([]);
  });

  it('未知敌人 id 有兜底（不能返回空串，否则 CharacterRig 会静默退回方块）', () => {
    expect(unitArtOf('en_unknown_thing')).toBe('uk_infantry');
    expect(unitArtOf('')).toBe('uk_infantry');
  });
});
