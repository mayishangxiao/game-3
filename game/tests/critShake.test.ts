/**
 * 暴击震屏回归测试 —— 2026-11-13「太平天国运动环节暴击震动力度过大」。
 *
 * 这条反馈的设计意图：暴击要有打击反馈，但不能晃到影响体验。所以最容易被「顺手改回去」
 * 的两件事各有断言守着：把强度调到 0（完全没反馈）和调回旧值 0.002（又晃飞）。
 * 另外太平天国战场敌群密集、近战有多段命中，一串暴击必须合并成一次轻震。
 *
 * 测试读的是真实的 public/data/config.json，不复制 fixture —— 复制的那份永远和线上不一致。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRIT_SHAKE_AMP_DIVISOR,
  CRIT_SHAKE_COOLDOWN_MS,
  CRIT_SHAKE_DURATION_MS,
  CRIT_SHAKE_MAX_INTENSITY,
  CRIT_SHAKE_MIN_INTENSITY,
  critShakeIntensity,
  nextCritShakeReadyAt,
  shouldCritShake,
} from '../src/core/critShake';

const config = JSON.parse(
  readFileSync(join(process.cwd(), 'public/data/config.json'), 'utf8').replace(/^\uFEFF/, ''),
);
const amp: number = config.combat_feedback.screenshake_amp;
const OLD_INTENSITY = 2 / CRIT_SHAKE_AMP_DIVISOR; // 修复前：amp=2 → shake(60, 0.002)

describe('暴击震屏：轻微但不为零', () => {
  it('修复前的强度（amp=2 → 0.002）现在会被上限压住，不会再晃飞', () => {
    expect(OLD_INTENSITY).toBe(0.002);
    expect(critShakeIntensity(2)).toBe(CRIT_SHAKE_MAX_INTENSITY);
    expect(critShakeIntensity(2)).toBeLessThan(OLD_INTENSITY);
  });

  it('线上配置算出的强度落在舒适区：> 0 且不超过上限', () => {
    const v = critShakeIntensity(amp);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeGreaterThanOrEqual(CRIT_SHAKE_MIN_INTENSITY);
    expect(v).toBeLessThanOrEqual(CRIT_SHAKE_MAX_INTENSITY);
  });

  it('配置值已下调，不再是修复前那个偏重的 2', () => {
    expect(amp).not.toBe(2);
    expect(critShakeIntensity(amp)).toBeLessThan(OLD_INTENSITY);
  });

  it('下限 > 0：配置填 0 / 负数 / NaN / Infinity / undefined 也不会把震动完全关掉', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      const v = critShakeIntensity(bad as number);
      expect(v).toBeGreaterThan(0);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(CRIT_SHAKE_MIN_INTENSITY);
    }
  });

  it('上限挡住配置误填把画面晃飞', () => {
    expect(critShakeIntensity(1000)).toBe(CRIT_SHAKE_MAX_INTENSITY);
    expect(critShakeIntensity(Number.MAX_SAFE_INTEGER)).toBe(CRIT_SHAKE_MAX_INTENSITY);
  });

  it('正常区间内强度随配置值单调变化，amp=1 即 0.001', () => {
    expect(critShakeIntensity(0.5)).toBeLessThan(critShakeIntensity(1));
    expect(critShakeIntensity(1)).toBe(0.001);
  });
});

describe('合并窗口：敌群里的一串暴击只震一次', () => {
  it('首次触发时 now >= readyAt', () => {
    expect(shouldCritShake(0, 0)).toBe(true);
    expect(shouldCritShake(500, 0)).toBe(true);
  });

  it('窗口内的后续暴击被合并（不会反复 shake 续命）', () => {
    const now = 1000;
    const readyAt = nextCritShakeReadyAt(now);
    expect(readyAt).toBe(now + CRIT_SHAKE_COOLDOWN_MS);
    expect(shouldCritShake(now + 1, readyAt)).toBe(false);
    expect(shouldCritShake(now + CRIT_SHAKE_COOLDOWN_MS - 1, readyAt)).toBe(false);
  });

  it('窗口边界一到就恢复，不会永久哑火', () => {
    const now = 1000;
    const readyAt = nextCritShakeReadyAt(now);
    expect(shouldCritShake(now + CRIT_SHAKE_COOLDOWN_MS, readyAt)).toBe(true);
    expect(shouldCritShake(now + CRIT_SHAKE_COOLDOWN_MS + 1, readyAt)).toBe(true);
  });

  it('模拟一次横扫连中 5 个且全部暴击：只落 1 次震动，隔窗后能再震', () => {
    let readyAt = 0;
    let fires = 0;
    const t0 = 2000;
    for (let i = 0; i < 5; i++) {
      const now = t0 + i * 10;
      if (shouldCritShake(now, readyAt)) {
        readyAt = nextCritShakeReadyAt(now);
        fires++;
      }
    }
    expect(fires).toBe(1);
    const later = t0 + CRIT_SHAKE_COOLDOWN_MS + 10;
    if (shouldCritShake(later, readyAt)) fires++;
    expect(fires).toBe(2);
  });

  it('震动时长短于合并窗口，且比旧的 60ms 更短促', () => {
    expect(CRIT_SHAKE_DURATION_MS).toBeGreaterThan(0);
    expect(CRIT_SHAKE_DURATION_MS).toBeLessThan(CRIT_SHAKE_COOLDOWN_MS);
    expect(CRIT_SHAKE_DURATION_MS).toBeLessThan(60);
  });
});
