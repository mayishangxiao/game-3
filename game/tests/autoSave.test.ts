/**
 * 自动存档节奏的单元测试。
 *
 * 目标不是测 `localStorage` 本身（save.test.ts 已经覆盖），而是钉住调度契约：
 * 周期 60 秒、击杀经验 900ms debounce、同步 persist 不重复写、
 * 页面隐藏强制写、导入/重置后旧定时器不能把旧档写回去。
 */
import { describe, expect, it } from 'vitest';
import {
  AUTO_SAVE_DEBOUNCE_MS,
  AUTO_SAVE_INTERVAL_MS,
  AutoSaver,
  type AutoSaveReason,
} from '../src/core/autoSave';

interface FakeTimer {
  id: number;
  ms: number;
  fn: () => void;
}

function harness() {
  let seq = 0;
  let clock = 1_000;
  const timers = new Map<number, FakeTimer>();
  const writes: number[] = [];
  const notified: AutoSaveReason[] = [];
  const set = (fn: () => void, ms: number): number => {
    const id = ++seq;
    timers.set(id, { id, ms, fn });
    return id;
  };
  const clear = (id: unknown): void => {
    timers.delete(id as number);
  };
  const saver = new AutoSaver({
    save: () => writes.push(clock),
    notify: (r) => notified.push(r),
    setInterval: set,
    clearInterval: clear,
    setTimeout: set,
    clearTimeout: clear,
    now: () => clock,
  });
  const fire = (id: number): boolean => {
    const t = timers.get(id);
    if (!t) return false;
    timers.delete(id);
    t.fn();
    return true;
  };
  const byMs = (ms: number): FakeTimer[] => [...timers.values()].filter((t) => t.ms === ms);
  const advance = (ms: number): void => {
    clock += ms;
  };
  return { saver, timers, writes, notified, set, byMs, fire, advance };
}

describe('自动存档调度', () => {
  it('启动后挂一个 60 秒周期定时器，到点写一次并记录时间', () => {
    const h = harness();
    h.saver.start();
    expect(h.byMs(AUTO_SAVE_INTERVAL_MS)).toHaveLength(1);
    expect(h.writes).toHaveLength(0);

    h.advance(AUTO_SAVE_INTERVAL_MS);
    const [timer] = h.byMs(AUTO_SAVE_INTERVAL_MS);
    expect(h.fire(timer.id)).toBe(true);
    expect(h.writes).toEqual([61_000]);
    expect(h.saver.lastSaved).toBe(61_000);
    expect(h.notified).toEqual(['interval']);
  });

  it('重复 start 不会挂第二个周期定时器', () => {
    const h = harness();
    h.saver.start();
    h.saver.start();
    expect([...h.timers.values()].filter((t) => t.ms === AUTO_SAVE_INTERVAL_MS)).toHaveLength(1);
  });

  it('击杀经验打标后 900ms 才写，期间连打只写一次', () => {
    const h = harness();
    h.saver.markDirty();
    const first = h.byMs(AUTO_SAVE_DEBOUNCE_MS)[0];
    h.saver.markDirty();
    const second = h.byMs(AUTO_SAVE_DEBOUNCE_MS)[0];
    expect(second.id).toBeGreaterThan(first.id);
    expect(h.fire(first.id)).toBe(false); // 旧 debounce 已撤销

    h.advance(AUTO_SAVE_DEBOUNCE_MS);
    expect(h.fire(second.id)).toBe(true);
    expect(h.writes).toHaveLength(1);
    expect(h.notified).toEqual(['dirty']);
    expect(h.saver.isDirty).toBe(false);
  });

  it('场景已经同步 persist 过时，clearPending 只撤队列不重复写盘', () => {
    const h = harness();
    h.saver.markDirty();
    const [timer] = h.byMs(AUTO_SAVE_DEBOUNCE_MS);
    h.saver.clearPending();

    expect(h.fire(timer.id)).toBe(false);
    expect(h.saver.flush('dirty')).toBe(false);
    expect(h.writes).toHaveLength(0);
    expect(h.notified).toEqual([]);
  });

  it('页面隐藏强制写：即使没打标也落盘', () => {
    const h = harness();
    expect(h.saver.flush('pagehide', true)).toBe(true);
    expect(h.writes).toHaveLength(1);
    expect(h.notified).toEqual(['pagehide']);
    // 再次离开仍然写，保证「刚写完又被直接改过」的旧代码路径也有兜底
    expect(h.saver.flush('pagehide', true)).toBe(true);
    expect(h.writes).toHaveLength(2);
  });

  it('周期保存会顺带清掉未到点的 debounce，不再写第二遍', () => {
    const h = harness();
    h.saver.start();
    h.saver.markDirty();
    const [debounce] = h.byMs(AUTO_SAVE_DEBOUNCE_MS);
    const [interval] = h.byMs(AUTO_SAVE_INTERVAL_MS);

    h.fire(interval.id);
    expect(h.writes).toHaveLength(1);
    expect(h.fire(debounce.id)).toBe(false);
    expect(h.writes).toHaveLength(1);
  });

  it('stop 清掉所有定时器，且可以再次 start', () => {
    const h = harness();
    h.saver.start();
    h.saver.markDirty();
    const ids = [...h.timers.values()].map((t) => t.id);
    h.saver.stop();

    for (const id of ids) expect(h.fire(id)).toBe(false);
    expect(h.saver.isDirty).toBe(false);
    h.saver.start();
    expect(h.byMs(AUTO_SAVE_INTERVAL_MS)).toHaveLength(1);
  });
});
