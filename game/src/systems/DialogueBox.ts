/**
 * 对话框 —— 底部浮层 + 打字机效果（设计书 6.9.1 / 6.9.2）。
 * 每行最多 18 个汉字、最多 3 行；点击或按 E/Enter 推进。
 *
 * v1.8.7：说话人归属改为**逐句**。`lines[].speaker` 覆盖 `block.speaker`，
 * 每推进一句就同步换名字与立绘；右上角的「在场」列出本场全部对话人物。
 * 老数据没写逐句 speaker / participants 时，一律回落到块级默认，行为与以前一致。
 */

import { castLabel, lineSpeaker, resolveDialogueCast } from '../core/sceneDialogue';
import { setInputEnabled } from '../core/EventBus';
import type { DialogueAction, DialogueBlock, DialogueLine } from '../core/types';
import {
  hideDialogue,
  setDialogueBody,
  setDialogueCast,
  setDialoguePortrait,
  setDialogueSpeaker,
  setDialogueTyping,
  showDialogue,
} from './DomUi';

export class DialogueBox {
  private portraits: Record<string, string> = {};
  /** 当前显示在 `#dom-dlg-portrait` 里的图（null = 这一句没人可画）。只写不读，供探针判定素材是否到位。 */
  portraitUrl: string | null = null;

  private lines: DialogueLine[] = [];
  private block: DialogueBlock | null = null;
  private index = 0;
  private typed = 0;
  private typing = false;
  private typeTimer = 0;
  private charDelay: number;
  private active = false;
  private onDone: (() => void) | null = null;
  private onAction: ((a: DialogueAction) => void) | null = null;
  private speakerNames: Record<string, string> = {};
  private lastAdvance = 0;
  private currentSpeaker = '';
  private speakerLabel = '';

  constructor(charDelayMs = 40, portraits: Record<string, string> = {}) {
    this.charDelay = charDelayMs;
    this.portraits = portraits;
    // 底板 / 文字 / 立绘全在 DOM（DomUi）里，canvas 上不画对话框的任何零件：
    // 底板是 94% 不透明的深色块，画在它"下面"的东西一律被压暗（立绘曾经就是这样发黑的）。
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
    this.block = block;
    this.lines = block.lines;
    this.index = 0;
    this.speakerNames = speakerNames;
    this.onAction = onAction;
    this.onDone = onDone;
    this.active = true;
    // 强制首行重画立绘：上一段对白可能停在同一说话人上，DOM 里的 img 状态不能直接复用。
    this.currentSpeaker = '';
    showDialogue();
    // 这一场的参与人物整段固定，只设一次；逐句切换的是「谁在说」，不是「谁在场」。
    setDialogueCast(castLabel(resolveDialogueCast(block), speakerNames));
    setInputEnabled(false);
    this.renderLine();
  }

  private renderLine(): void {
    const line = this.lines[this.index];
    if (!line || !this.block) {
      this.finish();
      return;
    }
    const speaker = lineSpeaker(this.block, this.index);
    this.speakerLabel = this.speakerNames[speaker] ?? speaker;
    // 同一人连说几句时别反复销毁/重建立绘（异步加载的贴图会闪）。
    if (speaker !== this.currentSpeaker) {
      this.currentSpeaker = speaker;
      this.applyPortrait(speaker);
    }
    setDialogueSpeaker(this.speakerLabel, !!this.portraits[speaker]);
    setDialogueBody('');
    this.typed = 0;
    this.typing = true;
    this.typeTimer = 0;
    setDialogueTyping(true);
  }

  /**
   * 说话人立绘：config.json → ui.portraits 里登记了才显示，具体由 DOM 层的
   * `#dom-dlg-portrait` 画（浏览器自己加载图片，不占 canvas，也不会被底板压暗）。
   * 旁白与没登记素材的人只是收起图，文字会靠左——padding 由 `setDialogueSpeaker` 配套控制。
   */
  private applyPortrait(speaker: string): void {
    const file = this.portraits[speaker] ?? null;
    this.portraitUrl = file;
    setDialoguePortrait(file);
  }

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
    hideDialogue();
    // 立绘跟着底板一起收：DOM 的 #dom-dialogue 已经 display:none，
    // 但清掉 src 能让浏览器立刻释放这张图，下一段对白换人时不会闪一下上一张。
    this.portraitUrl = null;
    setDialoguePortrait(null);
    setDialogueCast('');
    setInputEnabled(true);
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }

  hide(): void {
    if (this.active) this.finish();
  }
}
