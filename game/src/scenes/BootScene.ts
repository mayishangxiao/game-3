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
        fontFamily: 'sans-serif',
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

      this.scene.start('Title');
    } catch (err) {
      console.error(err);
      this.add
        .text(VIEW_W / 2, VIEW_H / 2 + 24, `数据加载失败：${String(err)}\n请检查 public/data 是否完整`, {
          fontFamily: 'sans-serif',
          fontSize: '10px',
          color: '#E85C4A',
          align: 'center',
        })
        .setOrigin(0.5);
    }
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