/**
 * 对话框 —— 底部浮层 + 打字机效果（设计书 6.9.1 / 6.9.2）。
 * 每行最多 18 个汉字、最多 3 行；点击或按 E/Enter 推进。
 */

import Phaser from 'phaser';
import { DEPTH, PALETTE } from '../core/constants';
import { setInputEnabled } from '../core/EventBus';
import type { DialogueAction, DialogueBlock, DialogueLine } from '../core/types';
import {
  hideDialogue,
  setDialogueBody,
  setDialogueSpeaker,
  setDialogueTyping,
  showDialogue,
} from './DomUi';

const BOX_TOP = 160;
/** 立绘画框尺寸（config.json → ui.portraits 的图按这个比例出） */
const PORTRAIT_W = 72;
const PORTRAIT_H = 84;

export class DialogueBox {
  private container: Phaser.GameObjects.Container;
  private portrait: Phaser.GameObjects.Rectangle;
  /** 说话人立绘（有素材时盖在占位框上） */
  private portraitImg: Phaser.GameObjects.Image | null = null;
  private portraits: Record<string, string> = {};

  private lines: DialogueLine[] = [];
  private index = 0;
  private typed = 0;
  private typing = false;
  private typeTimer = 0;
  private charDelay: number;
  private active = false;
  private onDone: (() => void) | null = null;
  private onAction: ((a: DialogueAction) => void) | null = null;
  private speakerNames: Record<string, string> = {};
  private scene: Phaser.Scene;
  private lastAdvance = 0;
  private currentSpeaker = '';

  constructor(scene: Phaser.Scene, charDelayMs = 40, portraits: Record<string, string> = {}) {
    this.charDelay = charDelayMs;
    this.portraits = portraits;
    this.scene = scene;

    // 对话框底板/文字已搬到 DOM（DomUi），这里只留立绘画框，其余画在 canvas 上会糊。
    this.portrait = scene.add
      .rectangle(46, BOX_TOP + 44, PORTRAIT_W, PORTRAIT_H, PALETTE.plumMid)
      .setStrokeStyle(1, PALETTE.greyPlum);

    this.container = scene.add
      .container(0, 0, [this.portrait])
      .setDepth(DEPTH.overlay)
      .setVisible(false);
  }

  get isActive(): boolean {
    return this.active;
  }

  show(
    block: DialogueBlock,
    speakerNames: Record<string, string>,
    onAction: (a: DialogueAction) => void,
    onDone: () => void,
  ): void {
    this.lines = block.lines;
    this.index = 0;
    this.speakerNames = speakerNames;
    this.speakerLabel = speakerNames[block.speaker] ?? block.speaker;
    this.currentSpeaker = block.speaker;
    this.onAction = onAction;
    this.onDone = onDone;
    this.active = true;
    this.container.setVisible(true);
    showDialogue();
    setInputEnabled(false);
    this.applyPortrait(block.speaker);
    this.renderLine();
  }

  private renderLine(): void {
    const line = this.lines[this.index];
    if (!line) {
      this.finish();
      return;
    }
    void this.speakerNames;
    setDialogueSpeaker(this.speakerLabel, !!this.portraits[this.currentSpeaker]);
    setDialogueBody('');
    this.typed = 0;
    this.typing = true;
    this.typeTimer = 0;
    setDialogueTyping(true);
    void line;
  }

  /**
   * 说话人立绘：config.json → ui.portraits 里登记了才显示。
   * 素材按需加载（首次出现时 load.image），加载完成前先显示占位框，
   * 避免对话因为等图而停一帧。
   */
  private applyPortrait(speaker: string): void {
    const file = this.portraits[speaker];
    if (this.portraitImg) {
      this.portraitImg.destroy();
      this.portraitImg = null;
    }
    if (!file) {
      // 旁白没有人可画：画框收掉，文字靠左（DOM 层 padding 由 setDialogueSpeaker 控制）
      if (speaker === 'narrator') {
        this.portrait.setVisible(false);
        return;
      }
      this.portrait.setVisible(true).setStrokeStyle(1, PALETTE.greyPlum);
      return;
    }
    const key = `portrait_${speaker}`;
    const place = () => {
      if (!this.scene.textures.exists(key)) return;
      // 底板留着当画框（深色画在深色底上会看不出边界），立绘缩进 2px 盖在上面
      this.portrait.setVisible(true).setStrokeStyle(1, PALETTE.star);
      this.portraitImg = this.scene.add
        .image(46, BOX_TOP + 44, key)
        .setDisplaySize(PORTRAIT_W - 4, PORTRAIT_H - 4)
        .setOrigin(0.5);
      // addAt(…, 2)：容器里 0=底板、1=占位框；插在 1 会被占位框盖住（踩过一次）
      this.container.addAt(this.portraitImg, 2);
    };
    if (this.scene.textures.exists(key)) {
      place();
      return;
    }
    this.portrait.setVisible(true).setStrokeStyle(1, PALETTE.greyPlum);
    this.scene.load.image(key, file);
    this.scene.load.once(Phaser.Loader.Events.COMPLETE, place);
    this.scene.load.start();
  }

  private speakerLabel = '';

  /** 每帧驱动打字机 */
  update(deltaMs: number): void {
    if (!this.active) return;
    const line = this.lines[this.index];
    if (!line) return;

    if (this.typing) {
      this.typeTimer += deltaMs;
      const full = line.text;
      const target = Math.floor(this.typeTimer / this.charDelay);
      if (target > this.typed) {
        this.typed = Math.min(full.length, target);
        setDialogueBody(full.slice(0, this.typed));
      }
      if (this.typed >= full.length) {
        this.typing = false;
        setDialogueTyping(false);
      }
    }
  }

  /** 推进一行；返回 true 表示消费了本次输入 */
  advance(): boolean {
    if (!this.active) return false;
    // 用 performance.now() 而不是 scene.time.now：
    // 后者依赖游戏循环推进，在循环被暂停/节流时会让对话框彻底无法推进。
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastAdvance < 90) return true; // 防连点
    this.lastAdvance = now;

    const line = this.lines[this.index];
    if (!line) return true;

    if (this.typing) {
      // 第一次点击直接显示整行
      this.typing = false;
      this.typed = line.text.length;
      setDialogueBody(line.text);
      setDialogueTyping(false);
      return true;
    }

    if (line.action) this.onAction?.(line.action);
    if (line.action?.type === 'end') {
      this.finish();
      return true;
    }
    if (line.branch) {
      // 分支：本版直接取第一个选项（完整分支选择在 2.4 模块中实现）
      this.index += 1;
    } else if (line.next) {
      const nextIdx = this.lines.findIndex((l) => (l as unknown as { id?: string }).id === line.next);
      this.index = nextIdx >= 0 ? nextIdx : this.index + 1;
    } else {
      this.index += 1;
    }
    this.renderLine();
    return true;
  }

  private finish(): void {
    this.active = false;
    this.container.setVisible(false);
    hideDialogue();
    setInputEnabled(true);
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }

  hide(): void {
    if (this.active) this.finish();
  }
}