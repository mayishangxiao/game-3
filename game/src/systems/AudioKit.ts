/**
 * 合成音效：不引入任何音频素材，用 Web Audio 现场合成。
 *
 * 为什么这么做：设计书 D-3 一直挂着「音频未接入 / 素材未筛选」，而这次甲方要的是
 * 「先炮火余响、再一声沉重的城破」——这类低频轰鸣用合成比找素材更快、更可控，
 * 体积是 0，不会让首屏再大几百 KB（手机经隧道加载，每一 KB 都疼）。
 *
 * 三条铁律：
 *   1. **必须懒创建**：`AudioContext` 在用户手势之前创建会被浏览器挂起，这里等到第一次播放才建。
 *   2. **任何异常都吞掉**：iOS/微信里 `AudioContext` 各种限制（采样率、自动播放策略），
 *      音效失败绝不能把演出流程炸掉，所以每个入口都 try/catch。
 *   3. **一次演出只建一条链**：master gain 复用一个，避免每次播放都往 graph 里塞节点。
 */

type Ctx = AudioContext;

class AudioKitImpl {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private muted = false;
  /** 音效总线音量，来自存档 `settings.sound`（缺省 0.8） */
  private sfxVolume = 0.8;
  /** 战斗音效（目前没有 BGM，但留一个闸门：演出开始时统一静音） */
  private battleSilenced = false;
  /** 每个音效上一次播放的时间戳，用来做最小间隔防叠音 */
  private lastAt: Record<string, number> = {};

  /** 建/取音频上下文；失败返回 null（后续所有播放静默跳过） */
  private ensure(): Ctx | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      return ctx;
    } catch {
      return null;
    }
  }

  /** 微信/iOS 上上下文可能是 suspended，播放前试一次 resume（非手势里会静默失败） */
  private wake(ctx: Ctx): void {
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        /* 不允许就算了，静默 */
      });
    }
  }

  setMuted(v: boolean): void {
    this.muted = v;
    if (this.master) this.master.gain.value = v ? 0 : this.sfxVolume * 0.85;
  }

  /**
   * 音效总线音量 0..1（暂停菜单里的「音效」开关写 0 / 0.8）。
   * 与 BGM 是两条独立总线：关掉音乐要还能听见刀声，反过来也一样。
   */
  setVolume(v: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.sfxVolume * 0.85;
  }

  get currentVolume(): number {
    return this.sfxVolume;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** 演出开始时调用：把战斗层音效闸门关上（将来接了 BGM 就从这里停） */
  silenceBattle(): void {
    this.battleSilenced = true;
  }

  resumeBattle(): void {
    this.battleSilenced = false;
  }

  get battleOn(): boolean {
    return !this.battleSilenced;
  }

  /** 一段白噪声，越低通越像远处的炮火/风声 */
  private noise(ctx: Ctx, seconds: number, cutoff: number, gain: number, delay = 0): void {
    if (!this.master) return;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // 白噪声 + 缓慢包络：直接给白噪声会像收音机静电
      const env = Math.sin((i / frames) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start(ctx.currentTime + delay);
    src.stop(ctx.currentTime + delay + seconds + 0.02);
  }

  /** 一声闷响：低频正弦下滑 + 一点噪声敲击 */
  private thud(ctx: Ctx, fromHz: number, toHz: number, seconds: number, gain: number, delay = 0): void {
    if (!this.master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(fromHz, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(12, toHz), t0 + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + seconds + 0.05);
  }

  /** 炮火余响：远处滚过的一串闷雷（演出第一拍，留白之后） */
  cannonAftermath(): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    this.wake(ctx);
    this.noise(ctx, 1.6, 260, 0.5);
    this.thud(ctx, 90, 42, 1.1, 0.35, 0.05);
    this.thud(ctx, 70, 34, 0.9, 0.22, 0.55);
  }

  /** 城破：一记重锤 + 砖石坍塌 */
  cityFall(): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    this.wake(ctx);
    this.thud(ctx, 110, 26, 1.8, 0.75);
    this.noise(ctx, 0.5, 900, 0.42);
    this.noise(ctx, 1.4, 380, 0.3, 0.18);
    // 碎石：几记短促的敲击，位置错开，听感才像坍塌而不是一声闷响
    for (let i = 0; i < 6; i++) {
      this.noise(ctx, 0.12, 2600, 0.12, 0.32 + i * 0.11 + Math.random() * 0.06);
    }
  }

  /** 丧钟：三个下行音，压住整段演出的尾音 */
  bell(times = 3): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    this.wake(ctx);
    for (let i = 0; i < times; i++) {
      this.thud(ctx, 196 - i * 18, 130 - i * 14, 1.6, 0.22, i * 0.6);
      this.thud(ctx, 392 - i * 36, 260 - i * 28, 1.1, 0.08, i * 0.6);
    }
  }

  /* ==================== 通用音效（v1.9.0） ====================
   *
   * 演出音之外的「一按一响」都在这里，全部控制在 150ms 内：长音会盖住下一次按键，
   * 玩家会觉得手柄延迟。战败演出期间（`battleSilenced`）一律不响，否则丧钟里掺刀声。
   */

  /** 取一条可用的音频链；静音、演出静默、上下文建不起来都返回 null */
  private ready(): Ctx | null {
    if (this.muted || this.battleSilenced) return null;
    const ctx = this.ensure();
    if (!ctx) return null;
    this.wake(ctx);
    return ctx;
  }

  /** 同一音效最小间隔；连击同帧命中时不会叠成爆音 */
  private throttle(key: string, ms: number): boolean {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - (this.lastAt[key] ?? 0) < ms) return false;
    this.lastAt[key] = now;
    return true;
  }

  /** 一个短音：给 UI 点击、拾取这类「音高本身就是信息」的提示 */
  private tone(
    ctx: Ctx,
    freq: number,
    seconds: number,
    gain: number,
    type: OscillatorType = 'square',
    delay = 0,
  ): void {
    if (!this.master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + seconds + 0.02);
  }

  /** 一段扫过去的带通噪声：挥刀、箭矢、落水都用它 */
  private swish(
    ctx: Ctx,
    fromHz: number,
    toHz: number,
    seconds: number,
    gain: number,
    delay = 0,
  ): void {
    if (!this.master) return;
    const t0 = ctx.currentTime + delay;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      const env = Math.sin((i / frames) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(fromHz, t0);
    bp.frequency.exponentialRampToValueAtTime(Math.max(60, toHz), t0 + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + seconds + 0.02);
  }

  /** UI 点击：短、干，别让玩家点一次菜单就听一段音 */
  click(): void {
    if (!this.throttle('click', 40)) return;
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, 920, 0.045, 0.12, 'square');
  }

  /** 确认（买装备、确认强化）：比点击高一度，听起来是「成了」 */
  confirm(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, 784, 0.07, 0.14, 'square');
    this.tone(ctx, 1175, 0.09, 0.12, 'square', 0.06);
  }

  /** 取消 / 无效操作 */
  cancel(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, 220, 0.09, 0.12, 'square');
  }

  /** 挥刀：刀风的带通噪声，从 3kHz 扫到 700Hz */
  swing(): void {
    if (!this.throttle('swing', 70)) return;
    const ctx = this.ready();
    if (!ctx) return;
    this.swish(ctx, 3000, 700, 0.12, 0.16);
  }

  /** 命中：一记短闷响 + 一点金属噪声，和挥刀分开，玩家能听出「砍到了」 */
  hit(): void {
    if (!this.throttle('hit', 45)) return;
    const ctx = this.ready();
    if (!ctx) return;
    this.thud(ctx, 260, 120, 0.1, 0.18);
    this.swish(ctx, 4200, 2400, 0.05, 0.08);
  }

  /** 玩家受伤：低频下滑，比命中更闷更长一点 */
  hurt(): void {
    if (!this.throttle('hurt', 140)) return;
    const ctx = this.ready();
    if (!ctx) return;
    this.thud(ctx, 220, 80, 0.28, 0.3);
    this.swish(ctx, 900, 300, 0.16, 0.1);
  }

  /** 捡起 / 抱起箱子：两个上行音，短到不打断节奏 */
  pickup(): void {
    if (!this.throttle('pickup', 90)) return;
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, 622, 0.06, 0.1, 'triangle');
    this.tone(ctx, 933, 0.08, 0.1, 'triangle', 0.055);
  }

  /** 投箱 / 落水：低通噪声裹一层闷响 */
  splash(): void {
    if (!this.throttle('splash', 120)) return;
    const ctx = this.ready();
    if (!ctx) return;
    this.swish(ctx, 1200, 200, 0.34, 0.22);
    this.thud(ctx, 140, 60, 0.32, 0.2);
  }

  /** 升级 / 开箱：三音上行，是全局唯一「明显变强」的听觉信号 */
  levelUp(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((hz, i) => this.tone(ctx, hz, 0.14, 0.13, 'triangle', i * 0.075));
  }

  /** 开炮：一声闷响 + 一团爆裂噪声，比 cannonAftermath 短、脆、近 */
  cannonShot(): void {
    if (!this.throttle('cannon', 180)) return;
    const ctx = this.ready();
    if (!ctx) return;
    this.thud(ctx, 120, 40, 0.5, 0.45);
    this.swish(ctx, 2400, 300, 0.3, 0.24);
  }

  /** 只给测试与调试用：把内部状态复位 */
  reset(): void {
    this.muted = false;
    this.battleSilenced = false;
    this.sfxVolume = 0.8;
    this.lastAt = {};
    if (this.master) this.master.gain.value = 0.8 * 0.85;
  }
}

export const audio = new AudioKitImpl();