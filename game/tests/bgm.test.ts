/**
 * BGM 曲目表（v1.9.0）——设计书 7.1 里「BGM 与音效素材 ⬜ 未做」的那一格。
 *
 * 这里不测声音好不好听（测不了），只锁**能被机器判错的部分**：
 *   - 六个场景都有曲子，id 与表键一致；
 *   - 音符都落在循环步数内、不跨循环点、音高在可听范围；
 *   - 同一轨同一拍不重复叠同一个音（叠了会突然变大三倍）；
 *   - 每首长度与音符数量在可控范围（手机上调度的开销）。
 *
 * 播放器（`systems/Bgm.ts`）依赖这些不变量做 lookahead 调度，越界会直接静音那一步。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACT_SONG,
  BGM_SONGS,
  STEPS_PER_BAR,
  midiToHz,
  songIdOfAct,
  songSeconds,
  stepSeconds,
  type BgmId,
} from '../src/core/bgm';

const ids: BgmId[] = ['title', 'hub', 'humen', 'taiping', 'battle', 'sorrow'];

describe('core/bgm 曲目表', () => {
  it('六个场景各有一首，键与 id 对得上', () => {
    for (const id of ids) {
      const song = BGM_SONGS[id];
      expect(song, `${id} 没有曲子`).toBeTruthy();
      expect(song.id).toBe(id);
    }
    expect(Object.keys(BGM_SONGS).sort()).toEqual([...ids].sort());
  });

  it('BPM 与结构在编曲约定内：4 小节 × 8 步 = 32 步', () => {
    for (const id of ids) {
      const song = BGM_SONGS[id];
      expect(song.bpm, `${id} 的 BPM 不合理`).toBeGreaterThanOrEqual(50);
      expect(song.bpm, `${id} 的 BPM 不合理`).toBeLessThanOrEqual(140);
      expect(song.steps, `${id} 的步数`).toBe(STEPS_PER_BAR * 4);
      expect(song.tracks.length, `${id} 的轨道太少`).toBeGreaterThanOrEqual(4);
    }
  });

  it('每个音都落在循环内、不跨循环点、音高在可听范围', () => {
    for (const id of ids) {
      const song = BGM_SONGS[id];
      for (const track of song.tracks) {
        expect(track.notes.length, `${id} 的 ${track.instrument} 轨是空的`).toBeGreaterThan(0);
        expect(track.gain).toBeGreaterThan(0);
        expect(track.gain).toBeLessThanOrEqual(1);
        for (const n of track.notes) {
          expect(n.step, `${id}/${track.instrument} step 越界`).toBeGreaterThanOrEqual(0);
          expect(n.step, `${id}/${track.instrument} step 越界`).toBeLessThan(song.steps);
          expect(n.len, `${id}/${track.instrument} len 非法`).toBeGreaterThanOrEqual(1);
          // 跨过循环点的音符会被播放器在回绕处截断，听感上是「突然闭嘴」
          expect(n.step + n.len, `${id}/${track.instrument} 的音跨了循环点`).toBeLessThanOrEqual(song.steps);
          if (track.instrument !== 'hat' && track.instrument !== 'drum') {
            expect(n.midi, `${id}/${track.instrument} 音高越界`).toBeGreaterThanOrEqual(24);
            expect(n.midi, `${id}/${track.instrument} 音高越界`).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });

  it('同一轨同一拍不重复叠同一个音（会凭空放大音量）', () => {
    for (const id of ids) {
      for (const track of BGM_SONGS[id].tracks) {
        const seen = new Set<string>();
        for (const n of track.notes) {
          const key = `${n.step}:${n.midi}`;
          expect(seen.has(key), `${id}/${track.instrument} 在 step ${n.step} 叠了音`).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it('循环长度 6–30 秒：太短会听出重复，太长手机记不住旋律', () => {
    for (const id of ids) {
      const s = songSeconds(BGM_SONGS[id]);
      expect(s, `${id} 循环太短`).toBeGreaterThan(6);
      expect(s, `${id} 循环太长`).toBeLessThan(30);
    }
  });

  it('音符总量受控（调度器每 60ms 扫一步，不能塞几百个）', () => {
    for (const id of ids) {
      const total = BGM_SONGS[id].tracks.reduce((n, t) => n + t.notes.length, 0);
      expect(total, `${id} 音符太多`).toBeLessThan(400);
    }
  });

  it('编曲意图：战斗最快、战败最慢、标题比战斗慢一半以上', () => {
    const { battle, sorrow, title } = BGM_SONGS;
    for (const id of ids) {
      if (id === 'battle') continue;
      expect(battle.bpm, `battle 应比其他曲子快`).toBeGreaterThan(BGM_SONGS[id].bpm);
    }
    for (const id of ids) {
      if (id === 'sorrow') continue;
      expect(sorrow.bpm, `sorrow 应是最慢的`).toBeLessThan(BGM_SONGS[id].bpm);
    }
    expect(battle.bpm).toBeGreaterThanOrEqual(title.bpm * 2);
  });
});

describe('幕数据 → 曲目（act.bgm 是唯一入口）', () => {
  it('五幕的 bgm 字段都有登记，映射到的曲目真实存在', () => {
    const files = [
      'public/data/acts/ch00_act1.json',
      'public/data/acts/ch00_act2.json',
      'public/data/acts/ch00_act3.json',
      'public/data/acts/ch00_act4.json',
      'public/data/acts/ch00_act5.json',
    ];
    for (const rel of files) {
      const act = JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as { bgm?: string };
      expect(act.bgm, `${rel} 没写 bgm`).toBeTruthy();
      expect(ACT_SONG[String(act.bgm)], `${rel} 的 bgm 没登记到 ACT_SONG`).toBeTruthy();
      expect(BGM_SONGS[songIdOfAct(act.bgm)]).toBeTruthy();
    }
    expect(songIdOfAct('bgm_ch00_act1')).toBe('humen');
    expect(songIdOfAct('bgm_ch00_act2')).toBe('taiping');
    // 洋务=长廊曲（稳态）、戊戌=丧钟（最慢）、辛亥=战斗曲
    expect(songIdOfAct('bgm_ch00_act3')).toBe('hub');
    expect(songIdOfAct('bgm_ch00_act4')).toBe('sorrow');
    expect(songIdOfAct('bgm_ch00_act5')).toBe('battle');
  });

  it('没登记的幕 / 空值按鸦片战争兜底，不抛错（剧情不能被音乐卡住）', () => {
    expect(songIdOfAct(undefined)).toBe('humen');
    expect(songIdOfAct(null)).toBe('humen');
    expect(songIdOfAct('bgm_future_act')).toBe('humen');
  });
});

describe('core/bgm 乐理工具', () => {
  it('midiToHz：A4=440、高八度翻倍、低八度减半', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 5);
    expect(midiToHz(81)).toBeCloseTo(880, 5);
    expect(midiToHz(57)).toBeCloseTo(220, 5);
    expect(midiToHz(60)).toBeCloseTo(261.63, 1);
  });

  it('stepSeconds 与 BPM 反比：120BPM 的八分音符是 0.25s', () => {
    const at120 = { id: 'battle' as BgmId, bpm: 120, steps: 32, tracks: [] };
    expect(stepSeconds(at120)).toBeCloseTo(0.25, 6);
    // 60BPM 时一拍 1 秒、一步 0.5 秒
    expect(stepSeconds({ ...at120, bpm: 60 })).toBeCloseTo(0.5, 6);
    expect(songSeconds(at120)).toBeCloseTo(8, 6);
  });
});
