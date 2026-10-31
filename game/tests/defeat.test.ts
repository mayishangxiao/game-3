import { describe, expect, it } from 'vitest';
import {
  DEFEAT_BEATS,
  DEFEAT_TEXT,
  beatAt,
  beatStart,
  defeatTimeline,
  type DefeatBeatName,
} from '../src/core/defeat';

/**
 * 战败演出的时间轴。
 *
 * 甲方（用户 m06955）要的灵魂是**顺序**，不是某个具体时长：
 *   先定格留白 → 再画面/声音 → 最后才出字，且「不要直接弹出文字」。
 * 这些只能靠数据关系守住，靠看截图守不住——所以断言放在这里。
 */
describe('战败演出时间轴', () => {
  it('七个节拍齐全，顺序与播放顺序一致', () => {
    const { beats } = defeatTimeline();
    expect(beats.map((b) => b.name)).toEqual([
      'freeze',
      'pullback',
      'fleet',
      'boom',
      'text',
      'hold',
      'reveal',
    ]);
  });

  it('start 严格递增且每段时长都为正（不会出现零长节拍）', () => {
    const { beats, total } = defeatTimeline();
    for (let i = 0; i < beats.length; i += 1) {
      expect(beats[i].dur).toBeGreaterThan(0);
      if (i > 0) expect(beats[i].start).toBeGreaterThan(beats[i - 1].start);
    }
    const last = beats[beats.length - 1];
    expect(total).toBe(last.start + last.dur);
  });

  it('第一拍是「定格留白」且不短于 300ms', () => {
    const { beats } = defeatTimeline();
    expect(beats[0].name).toBe('freeze');
    // 「先短暂留白停顿」是硬要求：静默太短就变成一进入就刷动画
    expect(DEFEAT_BEATS.freeze).toBeGreaterThanOrEqual(300);
  });

  it('大字晚于城破音效（先声后字），且不早于镜头拉远', () => {
    expect(beatStart('text')).toBeGreaterThanOrEqual(beatStart('boom'));
    expect(beatStart('boom')).toBeGreaterThan(beatStart('pullback'));
  });

  it('镜头拉远在留白之后立刻开始（留白期间不移动镜头）', () => {
    expect(beatStart('pullback')).toBe(DEFEAT_BEATS.freeze);
  });

  it('总时长在 4~12 秒之间（手机上没有跳过键，太长会烦）', () => {
    const { total } = defeatTimeline();
    expect(total).toBeGreaterThanOrEqual(4000);
    expect(total).toBeLessThanOrEqual(12000);
  });

  it('beatAt 按边界归前一段，越界返回 null', () => {
    const { total } = defeatTimeline();
    expect(beatAt(-1)).toBeNull();
    expect(beatAt(total)).toBeNull();
    expect(beatAt(total + 5000)).toBeNull();
    expect(beatAt(0)).toBe('freeze');
    expect(beatAt(DEFEAT_BEATS.freeze - 1)).toBe('freeze');
    // 边界值归后一段（此刻前一拍已结束）
    expect(beatAt(DEFEAT_BEATS.freeze)).toBe('pullback');
    expect(beatAt(beatStart('text'))).toBe('text');
    expect(beatAt(total - 1)).toBe('reveal');
  });

  it('beatStart 与 beatAt 对得上（同一拍自己的起点必然命中自己）', () => {
    const names: DefeatBeatName[] = ['freeze', 'pullback', 'fleet', 'boom', 'text', 'hold', 'reveal'];
    for (const n of names) {
      expect(beatAt(beatStart(n))).toBe(n);
    }
  });

  it('兜底文案非空（没有关卡数据时也要能演出）', () => {
    expect(DEFEAT_TEXT.title.length).toBeGreaterThan(0);
    expect(DEFEAT_TEXT.line.length).toBeGreaterThan(0);
    expect(DEFEAT_TEXT.note).toMatch(/^\d{4}\s*年/);
  });
});