/**
 * CodexScene —— 知识图鉴（设计书 6.7）。
 * 显示已收集的知识卡；每收集 10 张全属性 +2%（上限 +20%），此处展示该加成。
 */

import Phaser from 'phaser';
import { DEPTH, PALETTE, VIEW_H, VIEW_W } from '../core/constants';
import { dataLoader } from '../core/DataLoader';
import { knowledgeBonus } from '../core/balance';
import { getSave } from './BootScene';
import { FONT_UI } from '../gfx/TextStyle';
import { hideOverlay } from '../systems/DomUi';

export class CodexScene extends Phaser.Scene {
  private index = 0;
  private owned: string[] = [];
  private titleText!: Phaser.GameObjects.Text;
  private bodyText!: Phaser.GameObjects.Text;
  private metaText!: Phaser.GameObjects.Text;
  private pageText!: Phaser.GameObjects.Text;

  constructor() {
    super('Codex');
  }

  create(): void {
    hideOverlay();
    const s = getSave();
    this.owned = [...s.knowledge];

    this.cameras.main.setBackgroundColor(PALETTE.night);
    this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W - 16, VIEW_H - 20, PALETTE.ink, 0.92).setStrokeStyle(1, PALETTE.greyPlum);

    this.add
      .text(16, 16, '知识图鉴', { fontFamily: FONT_UI, fontSize: '14px', color: '#F2EDE4', fontStyle: 'bold' })
      .setDepth(DEPTH.hud);

    const bonusPct = Math.round((knowledgeBonus(this.owned.length, dataLoader.getBalance()) - 1) * 100);
    this.add
      .text(VIEW_W - 16, 18, `已收集 ${this.owned.length} / ${dataLoader.getKnowledge().length}　全属性 +${bonusPct}%`, {
        fontFamily: FONT_UI,
        fontSize: '9px',
        color: '#F0C419',
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH.hud);

    this.titleText = this.add.text(16, 40, '', {
      fontFamily: FONT_UI,
      fontSize: '12px',
      color: '#F0C419',
      wordWrap: { width: VIEW_W - 32 },
    });

    this.metaText = this.add.text(16, 68, '', {
      fontFamily: FONT_UI,
      fontSize: '9px',
      color: '#948DAB',
    });

    this.bodyText = this.add.text(16, 88, '', {
      fontFamily: FONT_UI,
      fontSize: '10px',
      color: '#F2EDE4',
      lineSpacing: 4,
      wordWrap: { width: VIEW_W - 32 },
    });

    this.pageText = this.add
      .text(VIEW_W / 2, VIEW_H - 14, '', { fontFamily: FONT_UI, fontSize: '9px', color: '#6B6489' })
      .setOrigin(0.5);

    this.add
      .text(16, VIEW_H - 14, '← → 翻页　Esc 返回长廊', {
        fontFamily: FONT_UI,
        fontSize: '9px',
        color: '#6B6489',
      })
      .setOrigin(0, 0.5);

    const kb = this.input.keyboard;
    kb?.on('keydown-LEFT', () => this.move(-1));
    kb?.on('keydown-A', () => this.move(-1));
    kb?.on('keydown-RIGHT', () => this.move(1));
    kb?.on('keydown-D', () => this.move(1));
    kb?.on('keydown-ESC', () => this.back());

    this.add
      .rectangle(VIEW_W - 40, VIEW_H - 16, 56, 16, PALETTE.plumMid, 0.95)
      .setStrokeStyle(1, PALETTE.ink)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.back());
    this.add
      .text(VIEW_W - 40, VIEW_H - 16, '返回', { fontFamily: FONT_UI, fontSize: '9px', color: '#F2EDE4' })
      .setOrigin(0.5);

    this.render();
  }

  private move(delta: number): void {
    if (this.owned.length === 0) return;
    this.index = (this.index + delta + this.owned.length) % this.owned.length;
    this.render();
  }

  private render(): void {
    if (this.owned.length === 0) {
      this.titleText.setText('还没有收集到知识卡');
      this.metaText.setText('在关卡中与人物交谈、完成事件即可获得。');
      this.bodyText.setText('');
      this.pageText.setText('');
      return;
    }
    const id = this.owned[this.index];
    const card = dataLoader.findKnowledge(id);
    if (!card) {
      this.titleText.setText(id);
      return;
    }
    this.titleText.setText(card.title);
    this.metaText.setText(`来源：${card.source || '—'}　标签：${card.tags.join(' / ') || '—'}`);
    const s = getSave();
    const unlocked = s.knowledge.length >= 10;
    const detail = card.detail && unlocked ? `\n\n【延伸】${card.detail}` : '';
    this.bodyText.setText(`${card.summary}${detail}`);
    this.pageText.setText(`${this.index + 1} / ${this.owned.length}`);
  }

  private back(): void {
    this.scene.start('Hub', { chapterId: getSave().progress.chapter || 'ch00' });
  }
}