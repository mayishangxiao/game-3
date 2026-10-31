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
  /** 战斗音效（目前没有 BGM，但留一个闸门：演出开始时统一静音） */
  private battleSilenced = false;

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
    if (this.master) this.master.gain.value = v ? 0 : 0.85;
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

  /** 只给测试与调试用：把内部状态复位 */
  reset(): void {
    this.muted = false;
    this.battleSilenced = false;
    if (this.master) this.master.gain.value = 0.85;
  }
}

export const audio = new AudioKitImpl();