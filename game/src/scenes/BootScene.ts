/**
 * BootScene —— 加载全局数据（index / config / 装备 / 掉落 / 知识卡），
 * 初始化存档，然后进入标题画面。
 * 对应设计书 7.1.2 加载流程的前半段。
 */

import Phaser from 'phaser';
import { PALETTE, VIEW_H, VIEW_W } from '../core/constants';
import { dataLoader } from '../core/DataLoader';
import { SaveManager } from '../core/SaveManager';
import type { SaveData } from '../core/types';
import { FONT_UI } from '../gfx/TextStyle';

/**
 * 开局引导层（index.html 的 #tap-gate）的「浏览器里已经重新开始了」标记。
 *
 * 为什么需要它：引导层是 DOM 层的「点一下屏幕开始」，它挂在 `pointerdown/click` 上、
 * 用 `{ once: true }` 只吃第一下。桌面浏览器（或任何刷新后不在全屏的场合）这一下是
 * 玩家为了关引导层点的，之后不该再拦任何事。
 *
 * 但 Phaser 的 `scene.restart()` **不会重新加载页面**：标题页「重新开始」调它以后，
 * 新画出来的标题按钮会被这个还挂着的引导层吃掉第一下——玩家看到的就是「点了没反应」。
 * 所以挂一个「已经点过引导层」的标记，BootScene 每次起来时按它决定要不要关掉引导层。
 */
export const GATE_SKIP_KEY = 'dsp_gate_started';

/** 记住「引导层点过了」。sessionStorage 之外再压一份 localStorage：隐私模式下前者会抛。 */
export function rememberGateStarted(): void {
  try {
    sessionStorage.setItem(GATE_SKIP_KEY, '1');
  } catch {
    /* 隐私模式 */
  }
  try {
    localStorage.setItem(GATE_SKIP_KEY, '1');
  } catch {
    /* 隐私模式 / 配额满 */
  }
}

/** 这台机器上已经点过引导层了吗？ */
export function hasGateBeenStarted(): boolean {
  try {
    if (sessionStorage.getItem(GATE_SKIP_KEY) === '1') return true;
  } catch {
    /* 隐私模式 */
  }
  try {
    return localStorage.getItem(GATE_SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

export const saveManager = new SaveManager();
export let SAVE: SaveData | null = null;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const cx = VIEW_W / 2;
    this.cameras.main.setBackgroundColor(PALETTE.ink);
    this.add
      .text(cx, VIEW_H / 2, '正在唤醒一八四〇年', {
        fontFamily: FONT_UI,
        fontSize: '13px',
        color: '#6B6489',
      })
      .setOrigin(0.5);

    void this.boot();
  }

  private async boot(): Promise<void> {
    try {
      await dataLoader.loadGlobals();
      SAVE = saveManager.init(dataLoader.getBalance());

      // 隐藏 HTML 层的启动提示
      const hint = document.getElementById('boot-hint');
      if (hint) {
        hint.classList.add('hidden');
        window.setTimeout(() => hint.remove(), 400);
      }

      // 这次是「页内重新开始」（不是刷新）：引导层已经点过了，别再盖住新画出来的标题页。
      if (hasGateBeenStarted()) this.dismissGate();

      this.scene.start('Title');
    } catch (err) {
      console.error(err);
      this.add
        .text(VIEW_W / 2, VIEW_H / 2 + 24, `数据加载失败：${String(err)}\n请检查 public/data 是否完整`, {
          fontFamily: FONT_UI,
          fontSize: '10px',
          color: '#E85C4A',
          align: 'center',
        })
        .setOrigin(0.5);
    }
  }

  /** 把开局引导层当作已经点过：淡出、铺满层叠树之下（330ms 后彻底 display:none） */
  private dismissGate(): void {
    const gate = document.getElementById('tap-gate');
    if (!gate) return;
    gate.classList.add('hidden');
    document.documentElement.classList.add('started');
    // 同步 OrientationGate 的状态：`tapped` 为假的话，它下面挂的 onTap 还会吃掉第一下点击
    const st = (window as unknown as { __dshGate?: Record<string, unknown> }).__dshGate;
    if (st) st.tapped = true;
    // 立刻不再吃点击：`.hidden` 只做淡出，340ms 内仍盖在游戏上面。
    // 一个「点了没反应」正是这么来的：引导层已经淡出、玩家点到的其实是它。
    gate.style.pointerEvents = 'none';
    window.setTimeout(() => {
      gate.style.display = 'none';
    }, 340);
  }
}

/** 取得存档（保证已初始化） */
export function getSave(): SaveData {
  if (!SAVE) throw new Error('存档尚未初始化');
  return SAVE;
}

export function persist(): void {
  if (SAVE) saveManager.save(SAVE);
}

/**
 * 从 localStorage 重新读一遍存档。
 * 只在「导入存档」之后用：那时候磁盘已经换成别人给的进度，但模块里的 SAVE 还是旧的，
 * 不重读的话界面显示的还是导入前的数据。
 */
export function reloadSave(): SaveData {
  SAVE = saveManager.init(dataLoader.getBalance());
  return SAVE;
}