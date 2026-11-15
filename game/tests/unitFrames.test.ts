/**
 * 单位行走/攻击帧的纯函数测试（v1.9.1，设计书 7.1「单位行走与攻击动画帧」）。
 *
 * 被测的是 `src/core/unitFrames.ts` —— 它把兵种小人（24×32 整张贴图）切成
 * 「腿带 + 上身」，再重排出两帧步态与一帧出手。这段逻辑跑在浏览器里是看不出来的
 * （顶多觉得小人走路自然了一点），但一旦把方向搞反，表现是「腿往前迈、人往后飘」，
 * 肉眼很难定位，所以这里用合成掩膜把下面几条钉死：
 *
 *   1. 腿带识别：正面两条腿 → 两段；侧面 → 一段；实心色块/空图 → 不认（返回 null）；
 *   2. 抬腿帧只动腿：躯干行一个像素都不许变；
 *   3. 出手帧只动上身：腿带一个像素都不许变；
 *   4. 平移不许环绕、不许越界写坏别的行；
 *   5. 侧面帧按 `dir` 决定前后（朝左/朝右不能反）。
 */

import { describe, expect, it } from 'vitest';
import {
  bottomRow,
  buildStepFrames,
  cloneMask,
  emptyMask,
  isEmptyMask,
  maskAt,
  planFrames,
  rowSpans,
  translateMask,
  type Mask,
} from '../src/core/unitFrames';

const W = 24;
const H = 32;

/**
 * 用 ASCII 画一张掩膜：`#` 不透明，其它一律透明。
 * 行**贴着底部**排（最后一行落在第 31 行）——像素图都是按脚底对齐写的，
 * 这样测试里的坐标与实际贴图一致，不用每次心算偏移。
 */
function art(rows: string[]): Mask {
  const m = emptyMask(W, H);
  const top = H - Math.min(H, rows.length);
  rows.slice(-H).forEach((row, i) => {
    const y = top + i;
    for (let x = 0; x < Math.min(W, row.length); x++) {
      if (row[x] === '#') m.a[y * W + x] = 1;
    }
  });
  return m;
}

/** 正面小人：躯干 6..17 行 8..23，两条腿 24..31（x8..10 / x13..15） */
function frontFigure(): Mask {
  const m = emptyMask(W, H);
  for (let y = 8; y <= 23; y++) for (let x = 6; x <= 17; x++) m.a[y * W + x] = 1;
  for (let y = 24; y <= 31; y++) {
    for (const x of [8, 9, 10, 13, 14, 15]) m.a[y * W + x] = 1;
  }
  return m;
}

/** 侧面小人：躯干 8..15 行 8..23，腿带整体一条 9..14 行 24..31 */
function sideFigure(): Mask {
  const m = emptyMask(W, H);
  for (let y = 8; y <= 23; y++) for (let x = 8; x <= 15; x++) m.a[y * W + x] = 1;
  for (let y = 24; y <= 31; y++) for (let x = 9; x <= 14; x++) m.a[y * W + x] = 1;
  return m;
}

function inkCount(m: Mask): number {
  let n = 0;
  for (let i = 0; i < m.a.length; i++) n += m.a[i] ? 1 : 0;
  return n;
}

describe('腿带识别', () => {
  it('正面：两条腿是两段，腿带从第 24 行开始', () => {
    const plan = planFrames(frontFigure());
    expect(plan).not.toBeNull();
    expect(plan!.legTop).toBe(24);
    expect(plan!.side).toBe(false);
    expect(plan!.spans).toEqual([
      { x0: 8, x1: 10 },
      { x0: 13, x1: 15 },
    ]);
  });

  it('侧面：前后腿叠成一段', () => {
    const plan = planFrames(sideFigure());
    expect(plan).not.toBeNull();
    expect(plan!.side).toBe(true);
    expect(plan!.spans).toEqual([{ x0: 9, x1: 14 }]);
    expect(plan!.legTop).toBe(24);
  });

  it('实心色块 / 空图 / 太矮的图都不认（返回 null，调用方退回整体浮动）', () => {
    const block = emptyMask(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) block.a[y * W + x] = 1;
    expect(planFrames(block)).toBeNull();
    expect(planFrames(emptyMask(W, H))).toBeNull();

    const flat = emptyMask(W, H);
    for (let y = 28; y < H; y++) for (let x = 8; x <= 15; x++) flat.a[y * W + x] = 1;
    expect(planFrames(flat)).toBeNull();
  });

  it('鞋底比腿宽 1px 也不会把躯干算进腿带（基准取从下往上第 2 行）', () => {
    const m = frontFigure();
    for (const x of [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) m.a[31 * W + x] = 1;
    const plan = planFrames(m);
    expect(plan!.legTop).toBe(24);
  });

  it('bottomRow / rowSpans 的边界行为', () => {
    expect(bottomRow(emptyMask(W, H))).toBe(-1);
    const m = art(['##..##']);
    expect(bottomRow(m)).toBe(H - 1);
    expect(rowSpans(m, H - 1)).toEqual([
      { x0: 0, x1: 1 },
      { x0: 4, x1: 5 },
    ]);
  });
});

describe('步态帧（正面/背面）', () => {
  const m = frontFigure();
  const plan = planFrames(m)!;
  const frames = buildStepFrames(m, plan, 1)!;

  it('抬左腿：只有左腿最底一行消失，右腿与躯干都不动', () => {
    expect(maskAt(m, 9, 31)).toBe(1);
    expect(maskAt(frames.stepA, 9, 31)).toBe(0); // 左脚离地
    expect(maskAt(frames.stepA, 14, 31)).toBe(1); // 右脚还在
    expect(maskAt(frames.stepA, 9, 30)).toBe(1);
    for (let y = 0; y <= 23; y++) {
      for (let x = 0; x < W; x++) expect(maskAt(frames.stepA, x, y), `${x},${y}`).toBe(maskAt(m, x, y));
    }
  });

  it('抬右腿：跟抬左腿镜像（两帧不能是同一帧，否则等于没做）', () => {
    expect(maskAt(frames.stepB, 14, 31)).toBe(0);
    expect(maskAt(frames.stepB, 9, 31)).toBe(1);
    let diff = 0;
    for (let i = 0; i < m.a.length; i++) if (frames.stepA.a[i] !== frames.stepB.a[i]) diff++;
    expect(diff).toBeGreaterThan(0);
  });

  it('抬腿只丢最底一行的墨迹（不整块消失、不越界写坏别的行）', () => {
    expect(inkCount(frames.stepA)).toBe(inkCount(m) - 3); // 左腿 3px 宽的鞋底离地
    expect(frames.stepA.w).toBe(m.w);
    expect(frames.stepA.h).toBe(m.h);
  });

  it('出手帧只动上身：腿带一个像素都不变', () => {
    for (let y = plan.legTop; y < H; y++) {
      for (let x = 0; x < W; x++) expect(maskAt(frames.swing, x, y)).toBe(maskAt(m, x, y));
    }
    // 躯干整体右移 1px
    expect(maskAt(frames.swing, 18, 16)).toBe(1);
    expect(maskAt(frames.swing, 6, 16)).toBe(0);
    expect(inkCount(frames.swing)).toBe(inkCount(m)); // 平移不增不减
  });

  it('朝左时出手帧反方向（dir = -1）', () => {
    const left = buildStepFrames(m, plan, -1)!;
    expect(maskAt(left.swing, 5, 16)).toBe(1);
    expect(maskAt(left.swing, 17, 16)).toBe(0);
  });
});

describe('步态帧（侧面）', () => {
  const m = sideFigure();
  const plan = planFrames(m)!;

  it('腿带前后错 1px，躯干不动', () => {
    const dir1 = buildStepFrames(m, plan, 1)!;
    expect(maskAt(dir1.stepA, 15, 30)).toBe(1); // 前腿出去
    expect(maskAt(dir1.stepA, 9, 30)).toBe(0);
    const dirM1 = buildStepFrames(m, plan, -1)!;
    expect(maskAt(dirM1.stepA, 8, 30)).toBe(1); // 朝左时反方向
    withBodyUnchanged(m, plan, dir1.stepA);
    withBodyUnchanged(m, plan, dir1.stepB);
  });

  it('左右两帧不同（否则原地抖一下就没了）', () => {
    const f = buildStepFrames(m, plan, 1)!;
    let diff = 0;
    for (let i = 0; i < m.a.length; i++) if (f.stepA.a[i] !== f.stepB.a[i]) diff++;
    expect(diff).toBeGreaterThan(0);
  });
});

function withBodyUnchanged(base: Mask, plan: { legTop: number }, frame: Mask): void {
  for (let y = 0; y < plan.legTop; y++) {
    for (let x = 0; x < W; x++) expect(maskAt(frame, x, y), `${x},${y}`).toBe(maskAt(base, x, y));
  }
}

describe('translateMask', () => {
  it('平移后源位置清空、目标位置置位', () => {
    const m = art(['.....', '.###.']);
    const out = translateMask(m, 1, 31, 3, 31, 1, 0);
    expect(maskAt(out, 1, 31)).toBe(0);
    expect(maskAt(out, 4, 31)).toBe(1);
    expect(maskAt(out, 2, 31)).toBe(1);
  });

  it('越界的像素直接丢掉，不环绕到另一边', () => {
    // 最左下角的像素往左移一格：丢掉，不能绕到最右边去
    const out = translateMask(art(['#']), 0, 31, 23, 31, -1, 0);
    expect(isEmptyMask(out)).toBe(true);
    expect(maskAt(out, 23, 31)).toBe(0);
  });

  it('cloneMask 是深拷贝（改副本不能改原图）', () => {
    const m = art(['.'.repeat(W - 1) + '#']); // 右下角那个像素
    expect(m.a[H * W - 1]).toBe(1);
    const c = cloneMask(m);
    c.a[H * W - 1] = 0;
    expect(m.a[H * W - 1]).toBe(1);
  });
});
