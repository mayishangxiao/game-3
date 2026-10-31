/**
 * TitleScene —— 标题画面。
 * 按设计书 6.9.4 第 2 条：「开始」按钮同时承担 iOS 音频解锁手势。
 */

import Phaser from 'phaser';
import { DEPTH, PALETTE, VIEW_H, VIEW_W } from '../core/constants';
import { dataLoader } from '../core/DataLoader';
import { getSave, persist, reloadSave, saveManager } from './BootScene';
import { emitToast } from '../core/EventBus';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    const cx = VIEW_W / 2;
    this.cameras.main.setBackgroundColor(PALETTE.ink);

    // 远景：破碎山河（占位色块分层）
    const sky = this.add.rectangle(cx, VIEW_H * 0.34, VIEW_W, VIEW_H * 0.68, PALETTE.plumDark).setDepth(0);
    const far = this.add.rectangle(cx, VIEW_H * 0.55, VIEW_W, 40, PALETTE.plumMid).setDepth(1);
    const near = this.add.rectangle(cx, VIEW_H * 0.68, VIEW_W, 26, PALETTE.brownDeep).setDepth(2);
    void sky;
    void far;
    void near;

    // 太阳/星黄的点
    this.add.circle(VIEW_W - 74, 58, 12, PALETTE.star, 0.85).setDepth(2);

    this.add
      .text(cx, 66, '党史像素 RPG', {
        fontFamily: 'sans-serif',
        fontSize: '26px',
        color: '#F2EDE4',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.add
      .text(cx, 94, '序 章 · 觉 醒 年 代  1840 — 1921', {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        color: '#C2BCD1',
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.add
      .text(cx, 116, '你扮演历史中的人，亲手把每一件大事「做」一遍', {
        fontFamily: 'sans-serif',
        fontSize: '9px',
        color: '#948DAB',
      })
      .setOrigin(0.5)
      .setDepth(10);

    const hasSave = saveManager.hasSave();
    const buttons: { label: string; action: () => void }[] = [];

    buttons.push({ label: hasSave ? '继 续' : '开 始', action: () => this.startGame(hasSave) });
    if (hasSave) {
      buttons.push({
        label: '重 新 开 始',
        action: () => {
          saveManager.reset(dataLoader.getBalance());
          this.scene.restart();
        },
      });
    }
    buttons.push({
      label: '导 出 存 档',
      action: () => {
        const s = getSave();
        const str = saveManager.exportString(s);
        void navigator.clipboard?.writeText(str);
        emitToast('存档已复制到剪贴板（可粘贴备份）', 2200);
      },
    });
    buttons.push({
      label: '导 入 存 档',
      action: () => {
        // 为什么要有这一条：换成另一条隧道/另一个域名，就是一个新的 localStorage，
        // 存档会「消失」。手机上又没法打开控制台，只能靠导出字符串搬过去。
        const text = window.prompt('粘贴之前导出的存档字符串');
        if (!text || !text.trim()) return;
        try {
          saveManager.save(saveManager.importString(text, dataLoader.getBalance()));
          reloadSave();
          emitToast('存档已导入', 2000);
          this.time.delayedCall(400, () => this.scene.restart());
        } catch (e) {
          emitToast(e instanceof Error ? e.message : '存档字符串无法识别', 2400);
        }
      },
    });

    buttons.forEach((b, i) => {
      const y = 152 + i * 26;
      const rect = this.add
        .rectangle(cx, y, 132, 20, PALETTE.redDark, 0.9)
        .setStrokeStyle(1, PALETTE.ink)
        .setDepth(10)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(cx, y, b.label, {
          fontFamily: 'sans-serif',
          fontSize: '12px',
          color: '#F2EDE4',
        })
        .setOrigin(0.5)
        .setDepth(11);

      const press = () => {
        rect.setScale(0.94);
        this.time.delayedCall(80, () => {
          rect.setScale(1);
          b.action();
        });
      };
      rect.on('pointerdown', press);
      label.setInteractive({ useHandCursor: true }).on('pointerdown', press);
    });

    // 「手机请横屏」只在画面确实还是竖着的时候才说。CSS 旋转兜底生效时（__dshGate.rotated）
    // window.innerHeight 仍是竖的，但玩家看到的已经是横过来的画面；而自检不过、兜底被撤销时
    // rotated 又会变回 false——那时该重新提示。所以这行字跟着 gate 状态每帧对一次表
    // （POST_UPDATE），最多晚一帧，不会抖）。
    const gate = (window as unknown as { __dshGate?: { rotated?: boolean } }).__dshGate;
    const baseHint = 'WASD / 方向键移动　J 攻击　K 技能　L 闪避　E 交互';
    const controlHint = this.add
      .text(cx, VIEW_H - 12, baseHint, { fontFamily: 'sans-serif', fontSize: '8px', color: '#6B6489' })
      .setOrigin(0.5)
      .setDepth(10);
    const syncHint = (): void => {
      const nag = window.innerHeight > window.innerWidth && !gate?.rotated;
      const want = nag ? `${baseHint}　手机请横屏` : baseHint;
      if (controlHint.text !== want) controlHint.setText(want);
    };
    syncHint();
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, syncHint);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.POST_UPDATE, syncHint);
    });

    this.input.keyboard?.on('keydown-ENTER', () => this.startGame(hasSave));
  }

  private startGame(continueGame: boolean): void {
    if (!continueGame) {
      saveManager.reset(dataLoader.getBalance());
    }
    const s = getSave();
    void persist;
    // 从存档记录的幕开始；无进度则进入第一幕
    this.scene.start('Hub', { chapterId: s.progress.chapter || 'ch00' });
  }

  override update(): void {
    void DEPTH;
  }
}