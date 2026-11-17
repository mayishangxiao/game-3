/**
 * 自动存档调度器（纯逻辑，不 import Phaser、不碰 DOM）。
 *
 * 设计书 `design/03_systems.md` 4.8.2 要求：每次节点完成、每次返回长廊、
 * 每 60 秒一次节流保存。前两项本来就在各场景里直接 `persist()`；本模块补齐
 * 后两项——周期保存，以及页面隐藏/关闭前的最后一次落盘。
 *
 * 为什么独立成纯模块：定时器、写盘、提示都从外面注入，node 环境能用假定时器
 * 把「周期到了写一次 / 连点只写一次 / 离开时强制写一次」钉死，不用起浏览器。
 *
 * 不修改存档结构、不改 SAVE_VERSION：写的内容仍是 `SaveManager.save(SAVE)` 那份。
 */

export const AUTO_SAVE_INTERVAL_MS = 60_000;
export const AUTO_SAVE_DEBOUNCE_MS = 900;

/** 触发来源，只用于提示文案与测试断言，不影响写入内容 */
export type AutoSaveReason = 'interval' | 'dirty' | 'pagehide' | 'flush';

export interface AutoSaveEnv {
  /** 真正写盘；由 BootScene 传 `saveManager.save(SAVE)` */
  save: () => void;
  /** 写盘成功后的一次提示（可接受 DOM 环境缺失） */
  notify?: (reason: AutoSaveReason) => void;
  /** 以下四个只为测试注入；缺省用全局定时器 */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  now?: () => number;
}

export class AutoSaver {
  private intervalId: unknown = null;
  private debounceId: unknown = null;
  private dirty = false;
  private started = false;
  private lastSavedAt = 0;

  constructor(private readonly env: AutoSaveEnv) {}

  get isDirty(): boolean {
    return this.dirty;
  }

  get lastSaved(): number {
    return this.lastSavedAt;
  }

  /** 启动 60 秒周期保存。重复调用无效（BootScene 只起一次）。 */
  start(): void {
    if (this.started) return;
    this.started = true;
    const set = this.env.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
    this.intervalId = set(() => this.flush('interval', true), AUTO_SAVE_INTERVAL_MS);
  }

  /** 停止全部定时器；页面卸载时其实不必调，保留给测试与将来可能的场景切换。 */
  stop(): void {
    const clearI = this.env.clearInterval ?? ((id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>));
    const clearT = this.env.clearTimeout ?? ((id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>));
    if (this.intervalId !== null) clearI(this.intervalId);
    if (this.debounceId !== null) clearT(this.debounceId);
    this.intervalId = null;
    this.debounceId = null;
    this.started = false;
    this.dirty = false;
  }

  /**
   * 存档内存态被改过、但调用方选择不立刻 `persist()` 时打标。
   * 900ms 后写一次；期间再打标会重新计时（真正的 debounce），避免击杀连点刷写盘。
   */
  markDirty(): void {
    this.dirty = true;
    const clear = this.env.clearTimeout ?? ((id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>));
    const set = this.env.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    if (this.debounceId !== null) clear(this.debounceId);
    this.debounceId = set(() => {
      this.debounceId = null;
      this.flush('dirty');
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  /**
   * 调用方已经同步写过盘（场景里的 `persist()`）时，只撤掉待写队列并记干净，
   * 不重复写第二遍。
   */
  clearPending(): void {
    const clear = this.env.clearTimeout ?? ((id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>));
    if (this.debounceId !== null) clear(this.debounceId);
    this.debounceId = null;
    this.dirty = false;
  }

  /**
   * 立即落盘。
   * @param force true 时即使没有脏标记也写——页面隐藏/关闭前必须兜底，
   *              因为直接改 `SAVE` 的旧代码路径并不会打标。
   */
  flush(reason: AutoSaveReason, force = false): boolean {
    if (!force && !this.dirty) return false;
    this.clearPending();
    this.env.save();
    this.lastSavedAt = (this.env.now ?? (() => Date.now()))();
    this.env.notify?.(reason);
    return true;
  }
}
