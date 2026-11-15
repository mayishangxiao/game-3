/**
 * 对话立绘完整性（v2.2）。
 *
 * 用户这轮的要求：「生成对话系统中的人物头像，除关天培和林则徐的头像外
 * 全部替换为新头像，且画风须与现有林则徐头像保持统一」。
 *
 * 换之前 `ui.portraits` 只登记 22 人，其中 20 张是 `gen_portraits.py` 旧版拼出来的
 * 16～18 色几何色块（600～740 字节），另外 10 个实际会开口说话的 NPC 干脆没有立绘，
 * 对话框只会显示名字、左边空着。这里把三条都钉死：
 *   ① 每个会说话的人都有登记，且文件真的存在；
 *   ② 每张图都是 96×112 RGBA、颜色数 ≥ 400（旧占位图只有 16～18 色，会当场露馅）；
 *   ③ 林则徐 / 关天培两张用 md5 锁住 —— 它们是画风基准，不许被批量重绘覆盖。
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'public');
const cfg = JSON.parse(readFileSync(join(ROOT, 'data/config.json'), 'utf8')) as {
  ui: { portraits: Record<string, string> };
};
const dlg = JSON.parse(readFileSync(join(ROOT, 'data/dialogues/dlg_ch00.json'), 'utf8')) as {
  npcs: Record<string, string>;
  dialogues: { lines: { speaker: string }[] }[];
};

const KEEP_MD5: Record<string, string> = {
  lin_zexu: 'fbebd529d4ba49a02595c3fffd5e517d',
  guan_tianpei: 'bc0a05b550320dbd04e445a8263d6b92',
};

/** 解 PNG（8bit RGB/RGBA + filter 0..4），只为数「不透明像素有多少种颜色」。 */
function pngInfo(path: string): { w: number; h: number; ct: number; colors: number } {
  const b = readFileSync(path);
  let pos = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat: Buffer[] = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const tag = b.toString('ascii', pos + 4, pos + 8);
    const body = b.subarray(pos + 8, pos + 8 + len);
    if (tag === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      ct = body[9];
    } else if (tag === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const colors = new Set<number>();
  let prev = Buffer.alloc(stride);
  let i = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[i++];
    const line = Buffer.from(raw.subarray(i, i + stride));
    i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const bb = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (ft === 1) line[x] = (line[x] + a) & 255;
      else if (ft === 2) line[x] = (line[x] + bb) & 255;
      else if (ft === 3) line[x] = (line[x] + ((a + bb) >> 1)) & 255;
      else if (ft === 4) {
        const p = a + bb - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - bb);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
        line[x] = (line[x] + pr) & 255;
      }
    }
    for (let x = 0; x < w; x++) {
      const a = bpp === 4 ? line[x * 4 + 3] : 255;
      if (a > 0) colors.add((line[x * bpp] << 16) | (line[x * bpp + 1] << 8) | line[x * bpp + 2]);
    }
    prev = line;
  }
  return { w, h, ct, colors: colors.size };
}

const speakers = new Set(dlg.dialogues.flatMap((d) => d.lines.map((l) => l.speaker)));
const portraits = cfg.ui.portraits;

describe('对话立绘：人人有脸、画风统一、两张基准不动', () => {
  it('除旁白外，每个登记在案的 NPC 都有立绘', () => {
    const missing = Object.keys(dlg.npcs).filter((id) => id !== 'narrator' && !portraits[id]);
    expect(missing, `缺立绘的 NPC：${missing.join(', ')}`).toEqual([]);
  });

  it('每个真正开口说过话的人都有立绘（旁白除外）', () => {
    const missing = [...speakers].filter((s) => s !== 'narrator' && !portraits[s]);
    expect(missing, `对白里有台词却没头像：${missing.join(', ')}`).toEqual([]);
  });

  it('旁白不该有立绘（否则每句旁白都挂一张脸）', () => {
    expect(portraits.narrator).toBeUndefined();
  });

  it('登记表数量 = NPC 数 - 旁白，且每个文件都存在', () => {
    expect(Object.keys(portraits)).toHaveLength(Object.keys(dlg.npcs).length - 1);
    const missing = Object.entries(portraits).filter(([, rel]) => !existsSync(join(ROOT, rel)));
    expect(missing.map(([k]) => k), '登记了但文件不存在').toEqual([]);
  });

  it('每张立绘都是 96×112 RGBA，且颜色数 ≥ 400（挡回 16 色几何占位图）', () => {
    const bad: string[] = [];
    for (const [id, rel] of Object.entries(portraits)) {
      const p = join(ROOT, rel);
      const info = pngInfo(p);
      if (info.w !== 96 || info.h !== 112 || info.ct !== 6) {
        bad.push(`${id}: ${info.w}x${info.h} colortype=${info.ct}`);
      } else if (info.colors < 400) {
        bad.push(`${id}: 只有 ${info.colors} 色`);
      }
    }
    expect(bad, '不合格立绘：\n' + bad.join('\n')).toEqual([]);
  });

  it('非基准图的文件都明显大于旧占位图（>5KB，渐变像素画）', () => {
    const small = Object.entries(portraits)
      .filter(([id]) => !(id in KEEP_MD5))
      .filter(([, rel]) => statSync(join(ROOT, rel)).size <= 5000)
      .map(([id]) => id);
    expect(small, '疑似还是 600 字节占位图').toEqual([]);
  });

  it('林则徐 / 关天培两张基准图 md5 不变（画风基准不许被批量重绘）', () => {
    for (const [id, md5] of Object.entries(KEEP_MD5)) {
      const got = createHash('md5').update(readFileSync(join(ROOT, portraits[id]))).digest('hex');
      expect(got, `${id} 被改过了`).toBe(md5);
    }
  });
});
