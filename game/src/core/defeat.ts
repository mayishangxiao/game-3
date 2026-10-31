/**
 * 战败演出（城破）的时间轴——**纯逻辑，不 import Phaser**。
 *
 * 用户要求（m06955）参考《植物大战僵尸》的「你已被吃掉脑子」：先定格留白，再放画面与声音，
 * 最后才落到文字和剧情，靠节奏制造悲壮感。所以「什么时候放什么」不能用一串魔法数字散在
 * 场景里，而要先在这里定下来，让测试能守住两条不变式：
 *   1. 留白必须存在且在最前面（`freeze` 非零、且是第一个 beat）；
 *   2. 大字必须晚于音效（`text.start >= boom.start`），甲方明确说过「不要直接弹出文字」。
 *
 * 时间轴同时被 `tests/defeat.test.ts` 与 `DefeatCinematic` 使用；改时长只改这一处。
 */

export type DefeatBeatName = 'freeze' | 'pullback' | 'fleet' | 'boom' | 'text' | 'hold' | 'reveal';

export interface DefeatBeat {
  name: DefeatBeatName;
  /** 相对演出开始的毫秒数 */
  start: number;
  /** 持续毫秒数 */
  dur: number;
}

/**
 * 每一段的时长（毫秒）。
 *
 * `freeze` 是刻意的空镜：全场定格、什么字都不出。
 * 8 秒的静默在浏览器里读起来很长，但正是这段让后面那声炮响有分量。
 */
export const DEFEAT_BEATS: Record<DefeatBeatName, number> = {
  freeze: 420,
  pullback: 1200,
  fleet: 900,
  boom: 320,
  text: 1500,
  hold: 900,
  reveal: 420,
};

/** 演出顺序（数组顺序 = 播放顺序，`start` 由这里累加得出） */
const ORDER: DefeatBeatName[] = ['freeze', 'pullback', 'fleet', 'boom', 'text', 'hold', 'reveal'];

/** 展开成带绝对时间的 beat 列表 + 总时长 */
export function defeatTimeline(): { beats: DefeatBeat[]; total: number } {
  const beats: DefeatBeat[] = [];
  let t = 0;
  for (const name of ORDER) {
    const dur = DEFEAT_BEATS[name];
    beats.push({ name, start: t, dur });
    t += dur;
  }
  return { beats, total: t };
}

/** 查询某个时刻正在播哪一段（刚好等于边界时归前一段） */
export function beatAt(ms: number): DefeatBeatName | null {
  const { beats, total } = defeatTimeline();
  if (ms < 0 || ms >= total) return null;
  let current: DefeatBeatName | null = null;
  for (const b of beats) {
    if (ms >= b.start) current = b.name;
  }
  return current;
}

/** 某一拍开始的绝对毫秒数（写演出代码时用它，别再手算累加） */
export function beatStart(name: DefeatBeatName): number {
  return defeatTimeline().beats.find((b) => b.name === name)?.start ?? 0;
}

/**
 * 城破文案默认值。真实文案应当写在关卡数据里（`node.params.breach_title` 等），
 * 这里只是兜底——没有数据时也要能演出，不能空白。
 */
export const DEFEAT_TEXT = {
  title: '虎门城破',
  line: '守军殉国',
  note: '1841 年 2 月 26 日',
} as const;