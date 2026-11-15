/**
 * BGM 播放器：按 `core/bgm.ts` 的曲目表现场合成循环，不加载任何音频文件。
 *
 * 与 `AudioKit`（一次性音效）分家的理由：
 *   - 音效是「一按一响」，建节点、放完就丢；
 *   - BGM 是「一直响、按拍调度」，需要提前排期，否则 setInterval 抖动会听出节奏不稳。
 *
 * 所以这里是一个标准的 lookahead 调度器：每 60ms 醒一次，把未来 0.35s 内的音符
 * 按精确时间挂到 AudioContext 上，循环点按 `song.steps` 回绕。
 *
 * 三条铁律与 AudioKit 一致：
 *   1. 懒创建上下文（用户手势之前建会被浏览器挂起）；
 *   2. 任何异常都吞掉——音乐失败绝不能把场景切换炸掉；
 *   3. 单例，全游戏一条音乐总线，切场景只换曲目不换总线。
 */

import {
  BGM_SONGS,
  midiToHz,
  stepSeconds,
  type BgmId,
  type BgmInstrument,
  type BgmNote,
  type BgmSong,
} from '../core/bgm';

/** 音乐总电平：BGM 要压在音效下面，0.35 是「听得到但不抢」的那一档 */
const LEVEL = 0.35;
/** 调度提前量（秒）：雨刷一次的间隔要比它小，才不会断 */
const LOOKAHEAD = 0.35;
/** 调度间隔（毫秒） */
const TICK_MS = 60;

interface StepEvent {
  instrument: BgmInstrument;
  gain: number;
  note: BgmNote;
}

class BgmImpl {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private song: BgmSong | null = null;
  private nextStep = 0;
  private nextTime = 0;
  /** 切歌竞态令牌：连续切场景时只有最后一次的 setTimeout 生效 */
  private token = 0;
  /** 0..1；0 = 关（暂停菜单里的「音乐」开关） */
  private volume = 0.6;
  /** 每首曲子的「第几步 → 该响什么」索引，play 时建一次 */
  private steps = new Map<BgmId, Map<number, StepEvent[]>>();

  get currentId(): BgmId | null {
    return this.song?.id ?? null;
  }

  get currentVolume(): number {
    return this.volume;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      if (typeof window === 'undefined') return null;
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.volume * LEVEL;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      return ctx;
    } catch {
      return null;
    }
  }

  private wake(ctx: AudioContext): void {
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        /* 不允许就静默 */
      });
    }
  }

  /** 把曲目摊平成「按步索引」，调度时只查表，不再每次遍历全部音符 */
  private indexSong(song: BgmSong): Map<number, StepEvent[]> {
    const map = new Map<number, StepEvent[]>();
    for (const track of song.tracks) {
      for (const note of track.notes) {
        const list = map.get(note.step) ?? [];
        list.push({ instrument: track.instrument, gain: track.gain, note });
        map.set(note.step, list);
      }
    }
    return map;
  }

  private tick = (): void => {
    const ctx = this.ctx;
    const song = this.song;
    const master = this.master;
    if (!ctx || !song || !master) return;
    try {
      const dur = stepSeconds(song);
      const index = this.steps.get(song.id);
      if (!index) return;
      // 暂停菜单关掉音乐时仍然按拍走，只是总线静音——恢复时不会「补播一堆」
      while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
        const step = this.nextStep % song.steps;
        const events = index.get(step);
        if (events) {
          for (const ev of events) this.playNote(ev, this.nextTime, dur);
        }
        this.nextStep += 1;
        this.nextTime += dur;
      }
    } catch {
      /* 合成失败不要在循环里抛 */
    }
  };

  private playNote(ev: StepEvent, at: number, stepDur: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const peak = Math.max(0.0001, ev.gain * (ev.note.gain ?? 1));
    const g = ctx.createGain();
    g.connect(master);

    if (ev.instrument === 'drum') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, at);
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.14);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(g);
      osc.start(at);
      osc.stop(at + 0.18);
      return;
    }

    if (ev.instrument === 'hat') {
      const src = ctx.createBufferSource();
      src.buffer = this.noise();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6000;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak * 0.5, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      src.connect(hp);
      hp.connect(g);
      src.start(at);
      src.stop(at + 0.06);
      return;
    }

    const osc = ctx.createOscillator();
    const dur = Math.max(0.08, ev.note.len * stepDur);
    let attack = 0.01;
    let release = 0.18;
    if (ev.instrument === 'pad') {
      // 铺底不做滤波：正弦本来就干净，长音只要慢起慢落
      osc.type = 'sine';
      attack = 0.16;
      release = Math.min(0.9, dur * 0.9);
      osc.connect(g);
    } else {
      // 低音用三角波压掉高频，主旋律用方波但收在 2.2kHz 以内，避免刺耳
      const bass = ev.instrument === 'bass';
      osc.type = bass ? 'triangle' : 'square';
      attack = bass ? 0.012 : 0.006;
      release = bass ? 0.32 : 0.14;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = bass ? 620 : 2200;
      osc.connect(lp);
      lp.connect(g);
    }

    osc.frequency.setValueAtTime(midiToHz(ev.note.midi), at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur + release);
    osc.start(at);
    osc.stop(at + dur + release + 0.05);
  }

  /** 0.1s 的白噪声，沙锤复用，避免每个音符都 new 一个 buffer */
  private noise(): AudioBuffer {
    const ctx = this.ctx!;
    if (this.noiseBuf && this.noiseBuf.sampleRate === ctx.sampleRate) return this.noiseBuf;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * 0.1));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return buf;
  }

  private fade(to: number, seconds: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const target = Math.max(0.0001, to * LEVEL * this.volume);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(target, ctx.currentTime + seconds);
    } catch {
      /* 静默 */
    }
  }

  private start(song: BgmSong, ctx: AudioContext): void {
    if (!this.steps.has(song.id)) this.steps.set(song.id, this.indexSong(song));
    this.song = song;
    this.nextStep = 0;
    // 留一点提前量，第一次 tick 不会因为 nextTime 已过期而瞬间补发
    this.nextTime = ctx.currentTime + 0.06;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(this.tick, TICK_MS);
    this.tick();
    this.fade(1, 0.45);
  }

  /**
   * 切曲目。同曲目重复调用是空操作——场景重开、试炼反复进出都靠这一条保持连续。
   * `force` 只给「同一首但要从头来」的场合用（目前没有调用方，留着给结局重播）。
   */
  play(id: BgmId, force = false): void {
    const song = BGM_SONGS[id];
    if (!song) return;
    if (!force && this.song?.id === id && this.timer) return;
    const ctx = this.ensure();
    if (!ctx) return;
    this.wake(ctx);

    const token = ++this.token;
    if (this.song && this.timer) {
      // 先淡出 0.25s 再切，硬切会在换场时「咔」一下
      this.fade(0, 0.25);
      clearInterval(this.timer);
      this.timer = null;
      setTimeout(() => {
        if (token !== this.token) return;
        const live = this.ensure();
        if (live) this.start(song, live);
      }, 260);
      return;
    }
    this.start(song, ctx);
  }

  stop(): void {
    this.token += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.song = null;
    if (this.ctx && this.master) {
      try {
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      } catch {
        /* 静默 */
      }
    }
  }

  /** 0..1。暂停菜单的「音乐」开关直接写 0 / 0.6 */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const target = Math.max(0.0001, this.volume * LEVEL);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
    } catch {
      /* 静默 */
    }
  }

  /** 只给测试与调试用 */
  reset(): void {
    this.stop();
    this.volume = 0.6;
  }
}

export const bgm = new BgmImpl();
