/**
 * BGM 曲目表与乐理工具——纯数据 + 纯函数，不依赖 Phaser、不依赖 Web Audio。
 *
 * 为什么是「数据」而不是音频文件：设计书 D-3 一直挂着「BGM 素材未接入」，而这条路
 * 与 `systems/AudioKit.ts` 的合成音效是同一套思路——首屏不多一个字节，手机上不用等
 * 音频下载，情绪也能按场景调。真给了成品 BGM 时，只需要把 `systems/Bgm.ts` 的
 * 播放器换掉，这里的曲目表可以原样留着当参考谱。
 *
 * 编曲约定：
 *   - 一小节 4 拍、一拍 2 步（八分音符），一小节 8 步；
 *   - 和弦用 `root`（MIDI）+ `tones`（相对 root 的音程，0 是大三度/小三度由音程决定）；
 *   - 每首歌 4 小节一循环，正好 32 步，循环点落在和弦回到主和弦那一拍上。
 */

/** 六个场景各一首，别再加：多一首就多一份「这里该怎么响」的判断成本 */
export type BgmId = 'title' | 'hub' | 'humen' | 'taiping' | 'battle' | 'sorrow';

/** 合成音色：低音 / 铺底 / 主旋律 / 底鼓 / 沙锤 */
export type BgmInstrument = 'bass' | 'pad' | 'lead' | 'drum' | 'hat';

export interface BgmNote {
  /** 小节内的八分音符序号，0..steps-1 */
  step: number;
  /** MIDI 音高；打击乐忽略该值（播放器按固定音高合成） */
  midi: number;
  /** 持续多少步（1 = 八分音符） */
  len: number;
  /** 相对同轨的额外音量，0..1，缺省 1 */
  gain?: number;
}

export interface BgmTrack {
  instrument: BgmInstrument;
  /** 该轨整体音量（已经做过混音平衡，别在播放器里再乘） */
  gain: number;
  notes: BgmNote[];
}

export interface BgmSong {
  id: BgmId;
  bpm: number;
  /** 总步数（= 小节数 × 8），播放器在这里回绕 */
  steps: number;
  tracks: BgmTrack[];
}

/** 每拍两步：八分音符网格 */
export const STEPS_PER_BEAT = 2;
/** 一小节 4 拍 */
export const STEPS_PER_BAR = STEPS_PER_BEAT * 4;

/** MIDI → 频率（A4 = 69 = 440Hz） */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** 一步多少秒 */
export function stepSeconds(song: BgmSong): number {
  return 60 / song.bpm / STEPS_PER_BEAT;
}

/** 一遍完整循环多少秒 */
export function songSeconds(song: BgmSong): number {
  return stepSeconds(song) * song.steps;
}

/** 和弦：根音 + 相对音程（0,3,7 = 小三和弦；0,4,7 = 大三和弦） */
interface Chord {
  root: number;
  tones: number[];
}

interface SongSpec {
  id: BgmId;
  bpm: number;
  /** 每小节一个和弦，长度就是小节数 */
  chords: Chord[];
  /** 主旋律落在每小节的第几步；缺省 0/2/4/6（八分音符琶音） */
  leadSteps?: number[];
  /** 主旋律整体高八度：0 原样、12 高一个八度 */
  leadOct?: number;
  /** 底鼓落在每小节的第几步；缺省 0/4 */
  drumSteps?: number[];
  /** 沙锤落在每小节的第几步；缺省 1/3/5/7 */
  hatSteps?: number[];
  /** 铺底音量（慢曲更响一点，战斗曲压低让位给节奏） */
  padGain?: number;
}

/**
 * 把「和弦进行 + 节奏型」展开成音符表。
 *
 * 手写 32 步 × 5 轨 × 6 首 = 960 个音符既写不对也改不动，所以统一用这个展开器：
 * 低音走根音（低八度）每半小节一次，铺底是根音（高八度）长音，主旋律按音程循环琶音。
 */
function buildSong(spec: SongSpec): BgmSong {
  const bars = spec.chords.length;
  const steps = bars * STEPS_PER_BAR;
  const bass: BgmNote[] = [];
  const pad: BgmNote[] = [];
  const lead: BgmNote[] = [];
  const drum: BgmNote[] = [];
  const hat: BgmNote[] = [];
  const leadSteps = spec.leadSteps ?? [0, 2, 4, 6];
  const drumSteps = spec.drumSteps ?? [0, 4];
  const hatSteps = spec.hatSteps ?? [1, 3, 5, 7];
  // 八分音符铺满的曲子（战斗）每个音只占一步，否则相邻两个音的包络会叠在一起发闷；
  // 稀疏的曲子（标题、战败）给两拍，听起来才有延音
  const leadLen = leadSteps.length >= STEPS_PER_BAR ? 1 : 2;

  spec.chords.forEach((chord, bar) => {
    const base = bar * STEPS_PER_BAR;
    // 低音优先下探一个八度；但低于 E1(28 = 41Hz) 之后手机小喇叭根本推不出来，
    // 只剩「占着能量不说话」，所以那几首（战斗的 Bm / Em、悲剧的 Dm）退回根音本身。
    const bassRoot = chord.root - 12 >= 28 ? chord.root - 12 : chord.root;
    bass.push(
      { step: base, midi: bassRoot, len: 4 },
      { step: base + 4, midi: bassRoot, len: 4 },
    );
    pad.push({ step: base, midi: chord.root + 12, len: STEPS_PER_BAR, gain: 0.6 });
    leadSteps.forEach((s, i) => {
      const tone = chord.tones[i % chord.tones.length];
      lead.push({
        step: base + s,
        midi: chord.root + (spec.leadOct ?? 12) + tone,
        // 最后一小节的最后一个音可能只剩一步就到循环点，别让它跨过去
        len: Math.min(leadLen, steps - (base + s)),
        gain: 0.85,
      });
    });
    for (const s of drumSteps) drum.push({ step: base + s, midi: 36, len: 1 });
    for (const s of hatSteps) hat.push({ step: base + s, midi: 0, len: 1, gain: 0.5 });
  });

  return {
    id: spec.id,
    bpm: spec.bpm,
    steps,
    // 空轨直接丢掉：标题与战败曲没有沙锤，留一条 0 音符的轨只会让调度器白扫一遍
    tracks: ([
      { instrument: 'bass', gain: 0.5, notes: bass },
      { instrument: 'pad', gain: spec.padGain ?? 0.22, notes: pad },
      { instrument: 'lead', gain: 0.2, notes: lead },
      { instrument: 'drum', gain: 0.45, notes: drum },
      { instrument: 'hat', gain: 0.1, notes: hat },
    ] as BgmTrack[]).filter((t) => t.notes.length > 0),
  };
}

/**
 * 幕数据里的 `bgm` 字段（`ch00_act1.json` 写的 `bgm_ch00_act1`）→ 本模块的曲目 id。
 *
 * 这个字段从设计书第一版就写着，一直没人接：`bgm: "bgm_ch00_act1"` 只是个占位名。
 * 现在把它当唯一入口——加一幕只需要在幕数据里写名字、在这里登记一行，不用改场景代码。
 */
export const ACT_SONG: Record<string, BgmId> = {
  bgm_ch00_act1: 'humen',
  bgm_ch00_act2: 'taiping',
  // 洋务运动：三十年「自强」，底色是稳态的长廊曲
  bgm_ch00_act3: 'hub',
  // 戊戌：变法失败、六君子就义，用最慢的丧钟调
  bgm_ch00_act4: 'sorrow',
  // 辛亥：武昌起义一夜开枪，用战斗曲
  bgm_ch00_act5: 'battle',
};

/** 幕 → 曲目；没登记的幕按鸦片战争的氛围兜底（不抛错，剧情照样能走） */
export function songIdOfAct(bgm: string | null | undefined): BgmId {
  return (bgm && ACT_SONG[bgm]) || 'humen';
}

/** D 小三和弦 / 降 B 大三 / F 大三 / A 大三 —— 低、暗，适合标题与悲剧 */
const Dm: Chord = { root: 50, tones: [0, 3, 7] };
const Bb: Chord = { root: 46, tones: [0, 4, 7] };
const F: Chord = { root: 41, tones: [0, 4, 7] };
const A: Chord = { root: 45, tones: [0, 4, 7] };
/** A 小调家族：长廊与鸦片战争第一幕 */
const Am: Chord = { root: 45, tones: [0, 3, 7] };
const C: Chord = { root: 48, tones: [0, 4, 7] };
const G: Chord = { root: 43, tones: [0, 4, 7] };
const Em: Chord = { root: 40, tones: [0, 3, 7] };
const D: Chord = { root: 38, tones: [0, 4, 7] };
const Bm: Chord = { root: 35, tones: [0, 3, 7] };
/** 太平天国：G 小调，比鸦片战争更「行进」一些 */
const Gm: Chord = { root: 43, tones: [0, 3, 7] };
const Eb: Chord = { root: 39, tones: [0, 4, 7] };

export const BGM_SONGS: Record<BgmId, BgmSong> = {
  // 标题：几乎只有低音与铺底，留白给「点击屏幕开始」的那一下
  title: buildSong({
    id: 'title',
    bpm: 58,
    chords: [Dm, Bb, F, A],
    leadSteps: [0, 4],
    leadOct: 24,
    drumSteps: [0],
    hatSteps: [],
    padGain: 0.3,
  }),
  // 长廊（时间轴）：稳、不抢戏，玩家要在这里读事件卡、点幕门
  hub: buildSong({
    id: 'hub',
    bpm: 84,
    chords: [C, G, Am, F],
    leadSteps: [0, 2, 4, 6],
    drumSteps: [0, 4],
  }),
  // 鸦片战争第一幕：慢板小调，砖墙、海风、销烟池
  humen: buildSong({
    id: 'humen',
    bpm: 72,
    chords: [Am, F, C, G],
    leadSteps: [0, 2, 4, 6],
    drumSteps: [0, 4],
  }),
  // 太平天国：行进感更重，底鼓多一下
  taiping: buildSong({
    id: 'taiping',
    bpm: 96,
    chords: [Gm, Eb, Bb, F],
    leadSteps: [0, 2, 4, 6],
    drumSteps: [0, 3, 4, 6],
    padGain: 0.18,
  }),
  // 战斗：快、密，八分音符全铺满；铺底压到最低，把中间频段让给刀声与炮声
  battle: buildSong({
    id: 'battle',
    bpm: 132,
    chords: [Em, C, D, Bm],
    leadSteps: [0, 1, 2, 3, 4, 5, 6, 7],
    drumSteps: [0, 2, 4, 6],
    hatSteps: [1, 3, 5, 7],
    padGain: 0.12,
  }),
  // 战败 / 城破：极慢，几乎只剩低音与一声鼓
  sorrow: buildSong({
    id: 'sorrow',
    bpm: 50,
    chords: [Dm, A, Bb, Dm],
    leadSteps: [0, 4],
    leadOct: 12,
    drumSteps: [0],
    hatSteps: [],
    padGain: 0.32,
  }),
};
