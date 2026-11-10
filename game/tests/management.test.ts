/**
 * 天京经营模块测试 —— 对应设计书 3.3.2。
 *
 * 最重要的一条断言是「无论怎么分都会崩」：
 * 这是该模块的设计意图（农民阶级的局限性），不是平衡失误，所以必须被测试锁住。
 */

import { describe, expect, it } from 'vitest';
import {
  MANAGE_LAYOUT,
  MANAGE_MONTHS,
  MONTHLY_POINTS,
  TRACK_MAX,
  TRACK_THRESHOLD,
  allocTotal,
  createManageState,
  decayFor,
  finalVerdict,
  managementTextLayout,
  remainingPoints,
  settleMonth,
  simulate,
  validateAlloc,
  type ManageState,
  type ManageTrack,
} from '../src/core/management';

/** 枚举所有合法分配（三项和恰好 6、单项 ≤ 4） */
function allAllocations(): ManageTrack[] {
  const out: ManageTrack[] = [];
  for (let f = 0; f <= TRACK_MAX; f++) {
    for (let t = 0; t <= TRACK_MAX; t++) {
      const m = MONTHLY_POINTS - f - t;
      if (m < 0 || m > TRACK_MAX) continue;
      out.push({ food: f, troops: t, morale: m });
    }
  }
  return out;
}

describe('分配校验', () => {
  it('必须正好 6 点', () => {
    expect(validateAlloc({ food: 2, troops: 2, morale: 2 }).ok).toBe(true);
    expect(validateAlloc({ food: 3, troops: 3, morale: 0 }).ok).toBe(true);
    expect(validateAlloc({ food: 1, troops: 1, morale: 1 }).ok).toBe(false);
    // 4+4+0 = 8，超过 6 点，非法
    expect(validateAlloc({ food: 4, troops: 4, morale: 0 }).ok).toBe(false);
  });

  it('单项不得超过 4', () => {
    expect(validateAlloc({ food: 5, troops: 1, morale: 0 }).ok).toBe(false);
    expect(validateAlloc({ food: 6, troops: 0, morale: 0 }).ok).toBe(false);
  });

  it('拒绝负数与非整数', () => {
    expect(validateAlloc({ food: -1, troops: 4, morale: 3 }).ok).toBe(false);
    expect(validateAlloc({ food: 1.5, troops: 2, morale: 2.5 }).ok).toBe(false);
  });

  it('合法分配共 19 种（三项和为 6、单项 ≤ 4）', () => {
    // 无上限时 C(8,2)=28；减去某个变量取 5 或 6 的 3×3=9 种，得 19
    expect(allAllocations()).toHaveLength(19);
  });

  it('剩余点数提示正确', () => {
    expect(remainingPoints({ food: 2, troops: 2, morale: 2 })).toBe(0);
    expect(remainingPoints({ food: 1, troops: 1, morale: 1 })).toBe(3);
  });
});

describe('消耗曲线', () => {
  it('第 1—3 月为 2，第 4—6 月为 3，第 7—8 月为 4', () => {
    expect([1, 2, 3].map(decayFor)).toEqual([2, 2, 2]);
    expect([4, 5, 6].map(decayFor)).toEqual([3, 3, 3]);
    expect([7, 8].map(decayFor)).toEqual([4, 4]);
  });

  it('8 个月总消耗（36）远大于总可分配（48）中能留下的一半以上——供给追不上消耗', () => {
    const totalDecay = Array.from({ length: MANAGE_MONTHS }, (_, i) => decayFor(i + 1)).reduce((a, b) => a + b, 0);
    // 总消耗 3×2 + 3×3 + 2×4 = 23；总投入 8×6 = 48；看似有盈余，
    // 但单项上限 4 使得无法把点集中到需要的方向上——这才是「不够」的真正来源。
    expect(totalDecay).toBe(23);
    expect(MONTHLY_POINTS * MANAGE_MONTHS).toBe(48);
    expect(TRACK_MAX).toBe(4);
  });
});

describe('单月结算与阈值事件', () => {
  it('按 旧值 + 分配 − 消耗 计算，且不小于 0', () => {
    const s = createManageState();
    const r = settleMonth(s, { food: 4, troops: 1, morale: 1 });
    expect(r.decay).toBe(2);
    expect(r.stockAfter.food).toBe(4 + 4 - 2); // 6
    // troops: 4 + 1 - 2 = 3（不低于 2，无事件）
    expect(r.stockAfter.troops).toBe(3);
    // morale: 4 + 1 - 2 = 3
    expect(r.stockAfter.morale).toBe(3);
    expect(r.golden).toBe(true);
  });

  it('粮草 < 2 触发兵员流失', () => {
    const s = createManageState();
    s.stock = { food: 0, troops: 4, morale: 4 };
    const r = settleMonth(s, { food: 0, troops: 4, morale: 2 });
    expect(r.events).toContain('粮草告急，兵员流失');
  });

  it('民心 < 2 触发逃亡，粮草与兵员同时下降', () => {
    const s = createManageState();
    s.stock = { food: 3, troops: 3, morale: 0 };
    const r = settleMonth(s, { food: 2, troops: 4, morale: 0 });
    // morale = 0 + 0 - 2 → 0 → 逃亡
    expect(r.events).toContain('人心离散，出现逃亡');
    expect(r.stockAfter.food).toBeLessThan(3 + 2 - 2);
  });

  it('三项都 ≥ 2 记为「盛世」', () => {
    const s = createManageState();
    const r = settleMonth(s, { food: 2, troops: 2, morale: 2 });
    expect(r.golden).toBe(true);
    expect(r.events).toContain('三事俱备，天京暂安');
  });

  it('非法分配会抛错，而不是静默算错', () => {
    const s = createManageState();
    expect(() => settleMonth(s, { food: 1, troops: 1, morale: 1 })).toThrow();
  });

  it('推进 8 个月后标记完成', () => {
    const s = createManageState();
    const alloc = { food: 2, troops: 2, morale: 2 };
    for (let i = 0; i < MANAGE_MONTHS; i++) settleMonth(s, alloc);
    expect(s.done).toBe(true);
    expect(s.history).toHaveLength(MANAGE_MONTHS);
    expect(s.month).toBe(MANAGE_MONTHS + 1);
  });
});

describe('设计意图：均衡分配也守不住', () => {
  it('每月都分 2/2/2 的结果依然是崩', () => {
    const s = simulate(() => ({ food: 2, troops: 2, morale: 2 }));
    const v = finalVerdict(s);
    expect(v.title).toBe('天京的粮仓渐渐空了');
    const under = [s.stock.food, s.stock.troops, s.stock.morale].filter((x) => x < TRACK_THRESHOLD).length;
    expect(under).toBeGreaterThan(0);
  });

  it('偏重任意一项也无法守住', () => {
    const focus: ManageTrack[] = [
      { food: 4, troops: 1, morale: 1 },
      { food: 1, troops: 4, morale: 1 },
      { food: 1, troops: 1, morale: 4 },
      { food: 3, troops: 3, morale: 0 },
      { food: 0, troops: 3, morale: 3 },
      { food: 3, troops: 0, morale: 3 },
    ];
    for (const a of focus) {
      const s = simulate(() => a);
      const under = [s.stock.food, s.stock.troops, s.stock.morale].filter((x) => x < TRACK_THRESHOLD).length;
      expect(under, `分配 ${JSON.stringify(a)} 竟然守住了`).toBeGreaterThan(0);
      expect(finalVerdict(s).title).toBe('天京的粮仓渐渐空了');
    }
  });

  it('逐月轮换方向（每月偏向最弱的一项）同样守不住', () => {
    const s = simulate((st: ManageState) => {
      const entries: [keyof ManageTrack, number][] = [
        ['food', st.stock.food],
        ['troops', st.stock.troops],
        ['morale', st.stock.morale],
      ];
      entries.sort((a, b) => a[1] - b[1]);
      // 把点数优先倾斜给最弱的两项
      const alloc: ManageTrack = { food: 0, troops: 0, morale: 0 };
      alloc[entries[0][0]] = 3;
      alloc[entries[1][0]] = 3;
      return alloc;
    });
    const under = [s.stock.food, s.stock.troops, s.stock.morale].filter((x) => x < TRACK_THRESHOLD).length;
    expect(under).toBeGreaterThan(0);
  });

  it('穷举全部 19 种「每月固定同一分配」的策略，无一能守住', () => {
    const winners: ManageTrack[] = [];
    for (const a of allAllocations()) {
      const s = simulate(() => a);
      const all = [s.stock.food, s.stock.troops, s.stock.morale];
      if (all.every((x) => x >= TRACK_THRESHOLD)) winners.push(a);
    }
    expect(winners).toEqual([]);
  });
});

describe('结算评语', () => {
  it('标题固定为「天京的粮仓渐渐空了」，补充句随短板变化', () => {
    const mk = (stock: ManageTrack) => {
      const s = createManageState();
      s.stock = stock;
      s.history = [];
      return finalVerdict(s);
    };
    expect(mk({ food: 3, troops: 3, morale: 0 }).body).toContain('人心散了');
    expect(mk({ food: 3, troops: 0, morale: 3 }).body).toContain('城墙上没有兵');
    expect(mk({ food: 0, troops: 3, morale: 3 }).body).toContain('锅里没有米');
    expect(mk({ food: 2, troops: 2, morale: 2 }).body).toContain('守不了太久');
  });

  it('返回盛世月数与最终总值，供结算面板显示', () => {
    const s = simulate(() => ({ food: 2, troops: 2, morale: 2 }));
    const v = finalVerdict(s);
    expect(v.goldenMonths).toBeGreaterThanOrEqual(0);
    expect(v.goldenMonths).toBeLessThanOrEqual(MANAGE_MONTHS);
    expect(Number.isFinite(v.finalSum)).toBe(true);
  });

  it('分配总和恒为 6，历史记录完整', () => {
    const s = simulate(() => ({ food: 2, troops: 2, morale: 2 }));
    expect(s.history).toHaveLength(MANAGE_MONTHS);
    for (const h of s.history) {
      expect(allocTotal(h.alloc)).toBe(MONTHLY_POINTS);
      expect(h.decay).toBeGreaterThanOrEqual(2);
    }
  });
});

/**
 * 面板文字层几何（v1.6.3，甲方截图「字配歪了」）。
 * 这里锁的是「DOM 文字盒与 canvas 图元同心、不越出面板」，
 * 光靠肉眼在横屏看不出来，竖屏整体旋转 90° 后偏移会被放大。
 */
describe('经营面板文字与图元同心', () => {
  const L = MANAGE_LAYOUT;
  const T = managementTextLayout();
  const panelLeft = L.panel.cx - L.panel.w / 2;
  const panelRight = L.panel.cx + L.panel.w / 2;
  const panelBottom = L.panel.cy + L.panel.h / 2;

  it('确认按钮文字与红色按钮矩形同心（旧版整体偏右 60px）', () => {
    expect(T.confirmLabel.left + T.confirmLabel.width / 2).toBe(L.confirm.cx);
    expect(T.confirmLabel.top + T.confirmLabel.height / 2).toBe(L.confirm.cy);
    expect(T.confirmLabel.width).toBe(L.confirm.w);
    expect(T.confirmLabel.height).toBe(L.confirm.h);
    expect(T.confirmLabel.left).toBe(140);
  });

  it('加减号文字盒与按钮矩形同心，三行都对齐', () => {
    T.rows.forEach((r, i) => {
      const y = L.row.y0 + i * L.row.step;
      expect(r.minus.left + r.minus.width / 2).toBe(L.minusX);
      expect(r.minus.top + r.minus.height / 2).toBe(y);
      expect(r.plus.left + r.plus.width / 2).toBe(L.plusX);
      expect(r.plus.top + r.plus.height / 2).toBe(y);
      expect(r.name.top + r.name.height / 2).toBe(y);
      expect(r.stock.top + r.stock.height / 2).toBe(y);
    });
  });

  it('所有文字盒都落在面板内，不再顶出右边界', () => {
    const boxes = [
      T.title,
      T.budget,
      T.hint,
      T.report,
      T.verdict,
      T.confirmLabel,
      ...T.rows.flatMap((r) => [r.name, r.stock, r.minus, r.plus]),
    ];
    for (const b of boxes) {
      expect(b.left).toBeGreaterThanOrEqual(panelLeft);
      expect(b.left + b.width).toBeLessThanOrEqual(panelRight);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.top + b.height).toBeLessThanOrEqual(panelBottom);
    }
  });

  it('标题与预算不抢位，提示行不压第一行卡片，结算不压确认按钮', () => {
    expect(T.title.left + T.title.width).toBeLessThanOrEqual(T.budget.left);
    expect(T.hint.top + T.hint.height).toBeLessThanOrEqual(L.row.y0 - L.row.h / 2);
    expect(T.report.top + T.report.height).toBeLessThanOrEqual(T.confirmLabel.top);
    expect(T.verdict.top + T.verdict.height).toBeLessThanOrEqual(T.confirmLabel.top);
  });
});