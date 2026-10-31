/**
 * QuizScene —— 章末测验与章节完成度结算（设计书 6.7.3 / 6.7.4）。
 *
 * 流程：抽 5 题 → 逐题作答并即时给出解释 → 判分（≥3 通过）→ 展示完成度四档评价
 * → 写入存档 → 返回长廊。
 * 未通过可重答；重答前需先看完答错题对应的知识卡（本版以「查看知识卡」按钮代替强制阅读）。
 */

import Phaser from 'phaser';
import { DEPTH, PALETTE, VIEW_H, VIEW_W } from '../core/constants';
import { dataLoader } from '../core/DataLoader';
import { chapterCompletion, addKnowledge } from '../core/SaveManager';
import {
  QUIZ_DRAW_COUNT,
  QUIZ_PASS_THRESHOLD,
  completionTier,
  perfectBonusGranted,
  sampleQuestions,
  scoreQuiz,
  type QuizResult,
} from '../core/quiz';
import { getSave, persist } from './BootScene';
import type { ChapterBundle } from '../core/DataLoader';
import type { QuizQuestion } from '../core/types';

export class QuizScene extends Phaser.Scene {
  private chapterId = 'ch00';
  private bundle!: ChapterBundle;
  private questions: QuizQuestion[] = [];
  private picks: number[] = [];
  private cursor = 0;
  private answered = false;
  private result: QuizResult | null = null;
  private root!: Phaser.GameObjects.Container;
  /** 当前题的选项底板，用于作答后高亮；不要靠下标去猜容器里的元素 */
  private optionRects: Phaser.GameObjects.Rectangle[] = [];
  private lastCompletion = 0;

  constructor() {
    super('Quiz');
  }

  init(data: { chapterId?: string }): void {
    this.chapterId = data.chapterId ?? 'ch00';
    this.cursor = 0;
    this.answered = false;
    this.result = null;
  }

  create(): void {
    this.root = this.add.container(0, 0).setDepth(DEPTH.hud);
    void this.boot();
  }

  private async boot(): Promise<void> {
    this.cameras.main.setBackgroundColor(PALETTE.night);
    const tip = this.add
      .text(VIEW_W / 2, VIEW_H / 2, '正在抽题……', {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        color: '#948DAB',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay);

    this.bundle = await dataLoader.loadChapter(this.chapterId);
    tip.destroy();

    this.questions = sampleQuestions(this.bundle.quiz.pool, QUIZ_DRAW_COUNT);
    this.picks = new Array(this.questions.length).fill(-1);
    this.renderQuestion();
  }

  /* ==================== 渲染 ==================== */

  private clear(): void {
    this.root.removeAll(true);
  }

  private renderQuestion(): void {
    this.clear();
    this.optionRects = [];
    this.answered = false;
    const q = this.questions[this.cursor];
    if (!q) {
      this.renderResult();
      return;
    }

    this.root.add(
      this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W - 12, VIEW_H - 16, PALETTE.ink, 0.95).setStrokeStyle(1, PALETTE.greyPlum),
    );
    this.root.add(
      this.add.text(14, 12, `${this.bundle.meta.name} · 章末测验`, {
        fontFamily: 'sans-serif',
        fontSize: '10px',
        color: '#C2BCD1',
      }),
    );
    this.root.add(
      this.add
        .text(VIEW_W - 14, 12, `第 ${this.cursor + 1} / ${this.questions.length} 题`, {
          fontFamily: 'sans-serif',
          fontSize: '10px',
          color: '#F0C419',
        })
        .setOrigin(1, 0),
    );

    this.root.add(
      this.add.text(14, 36, q.question, {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        color: '#F2EDE4',
        wordWrap: { width: VIEW_W - 28 },
        lineSpacing: 4,
      }),
    );

    const baseY = 78;
    q.options.forEach((opt, i) => {
      const y = baseY + i * 26;
      const rect = this.add
        .rectangle(VIEW_W / 2, y, VIEW_W - 40, 22, PALETTE.plumMid, 0.95)
        .setStrokeStyle(1, PALETTE.greyPlum)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(20, y, `${'ABCD'[i]}. ${opt}`, {
          fontFamily: 'sans-serif',
          fontSize: '11px',
          color: '#F2EDE4',
          wordWrap: { width: VIEW_W - 60 },
        })
        .setOrigin(0, 0.5);
      this.root.add(rect);
      this.root.add(label);
      this.optionRects.push(rect);
      const onPick = () => this.pick(i);
      rect.on('pointerdown', onPick);
      label.setInteractive({ useHandCursor: true }).on('pointerdown', onPick);
    });

    this.root.add(
      this.add
        .text(VIEW_W / 2, VIEW_H - 12, '点击选项作答　A/B/C/D 键亦可', {
          fontFamily: 'sans-serif',
          fontSize: '9px',
          color: '#6B6489',
        })
        .setOrigin(0.5),
    );

    this.bindKeys();
  }

  private bindKeys(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.removeAllListeners('keydown-A');
    kb.removeAllListeners('keydown-B');
    kb.removeAllListeners('keydown-C');
    kb.removeAllListeners('keydown-D');
    kb.removeAllListeners('keydown-ENTER');
    kb.on('keydown-A', () => this.pick(0));
    kb.on('keydown-B', () => this.pick(1));
    kb.on('keydown-C', () => this.pick(2));
    kb.on('keydown-D', () => this.pick(3));
    kb.on('keydown-ENTER', () => {
      if (this.answered) this.next();
    });
  }

  /* ==================== 交互 ==================== */

  private pick(index: number): void {
    if (this.answered) return;
    const q = this.questions[this.cursor];
    if (!q || index >= q.options.length) return;
    this.answered = true;
    this.picks[this.cursor] = index;

    const ok = index === q.answer;
    // 高亮：正确项标绿，误选项标红
    q.options.forEach((_, i) => {
      const rect = this.optionRects[i];
      if (!rect || !rect.active) return;
      if (i === q.answer) rect.setFillStyle(PALETTE.greenDark, 1).setStrokeStyle(2, PALETTE.green);
      else if (i === index) rect.setFillStyle(PALETTE.redDark, 1).setStrokeStyle(2, PALETTE.redBright);
    });

    // 解释
    const explain = this.add.text(16, VIEW_H - 54, `${ok ? '答对。' : '答错。'}${q.explanation}`, {
      fontFamily: 'sans-serif',
      fontSize: '9.5px',
      color: ok ? '#7EC08A' : '#F2A08C',
      wordWrap: { width: VIEW_W - 32 },
      lineSpacing: 3,
    });
    this.root.add(explain);

    const next = this.add
      .rectangle(VIEW_W - 46, VIEW_H - 16, 68, 18, PALETTE.redDark, 0.95)
      .setStrokeStyle(1, PALETTE.ink)
      .setInteractive({ useHandCursor: true });
    const nextLabel = this.add
      .text(VIEW_W - 46, VIEW_H - 16, this.cursor + 1 >= this.questions.length ? '看结果' : '下一题', {
        fontFamily: 'sans-serif',
        fontSize: '10px',
        color: '#F2EDE4',
      })
      .setOrigin(0.5);
    this.root.add(next);
    this.root.add(nextLabel);
    const go = () => this.next();
    next.on('pointerdown', go);
    nextLabel.setInteractive({ useHandCursor: true }).on('pointerdown', go);
  }

  private next(): void {
    this.cursor += 1;
    if (this.cursor >= this.questions.length) this.renderResult();
    else this.renderQuestion();
  }

  /* ==================== 结果与结算 ==================== */

  private renderResult(): void {
    if (!this.result) {
      this.result = scoreQuiz(this.questions, this.picks);
      this.persistResult(this.result);
    }
    this.clear();
    const r = this.result;

    this.root.add(
      this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W - 12, VIEW_H - 16, PALETTE.ink, 0.96).setStrokeStyle(1, PALETTE.greyPlum),
    );
    this.root.add(
      this.add
        .text(VIEW_W / 2, 20, `测验结果　${r.correct} / ${r.total}`, {
          fontFamily: 'sans-serif',
          fontSize: '14px',
          color: r.passed ? '#7EC08A' : '#F2A08C',
          fontStyle: 'bold',
        })
        .setOrigin(0.5, 0),
    );
    this.root.add(
      this.add
        .text(VIEW_W / 2, 42, r.passed ? '通过' : `未通过（需答对 ${QUIZ_PASS_THRESHOLD} 题）`, {
          fontFamily: 'sans-serif',
          fontSize: '10px',
          color: '#C2BCD1',
        })
        .setOrigin(0.5, 0),
    );

    // 逐题对错
    const dots = r.perQuestion
      .map((ok, i) => `${i + 1}${ok ? '✓' : '✗'}`)
      .join('　');
    this.root.add(
      this.add
        .text(VIEW_W / 2, 58, dots, { fontFamily: 'sans-serif', fontSize: '10px', color: '#948DAB' })
        .setOrigin(0.5, 0),
    );

    // 完成度
    const completion = this.lastCompletion || this.computeCompletion(r);
    const tier = completionTier(completion);
    this.root.add(
      this.add.text(16, 82, `章节完成度　${completion}%　·　${tier.label}`, {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        color: '#F0C419',
      }),
    );
    this.root.add(
      this.add.text(16, 100, tier.note, {
        fontFamily: 'sans-serif',
        fontSize: '9.5px',
        color: '#C2BCD1',
        wordWrap: { width: VIEW_W - 32 },
      }),
    );

    // 答错题的知识卡提示
    if (r.knowledgeToReview.length > 0) {
      const titles = r.knowledgeToReview
        .map((id) => dataLoader.findKnowledge(id)?.title ?? id)
        .slice(0, 3)
        .join('；');
      this.root.add(
        this.add.text(16, 122, `建议补看：${titles}`, {
          fontFamily: 'sans-serif',
          fontSize: '9px',
          color: '#F2A08C',
          wordWrap: { width: VIEW_W - 32 },
        }),
      );
    }

    if (perfectBonusGranted(r.correct, r.total)) {
      this.root.add(
        this.add.text(16, 146, '满分奖励：已解锁一张隐藏知识卡的延伸解读。', {
          fontFamily: 'sans-serif',
          fontSize: '9px',
          color: '#F0C419',
        }),
      );
    }

    const save = getSave();
    const nextChapterId = this.nextChapterId();
    const unlockMsg = r.passed
      ? nextChapterId
        ? '已解锁下一章。'
        : '已通过。第二章尚在开发中（见设计书第四章）。'
      : '可随时重答；建议先补看知识卡。';

    this.root.add(
      this.add.text(16, 166, unlockMsg, {
        fontFamily: 'sans-serif',
        fontSize: '9.5px',
        color: '#C2BCD1',
        wordWrap: { width: VIEW_W - 32 },
      }),
    );
    this.root.add(
      this.add.text(16, 186, `累计知识卡 ${save.knowledge.length} 张　已通关节点 ${save.progress.nodes_done.length} 个`, {
        fontFamily: 'sans-serif',
        fontSize: '9px',
        color: '#6B6489',
      }),
    );

    // 按钮
    if (!r.passed) {
      this.button(VIEW_W / 2 - 58, VIEW_H - 22, 92, 20, '重答一次', () => {
        this.cursor = 0;
        this.picks = new Array(this.questions.length).fill(-1);
        this.result = null;
        this.answered = false;
        this.renderQuestion();
      });
    }
    this.button(VIEW_W / 2 + 58, VIEW_H - 22, 92, 20, '返回长廊', () => {
      this.scene.start('Hub', { chapterId: this.chapterId });
    });
  }

  private button(x: number, y: number, w: number, h: number, text: string, onClick: () => void): void {
    const rect = this.add
      .rectangle(x, y, w, h, PALETTE.redDark, 0.95)
      .setStrokeStyle(1, PALETTE.ink)
      .setInteractive({ useHandCursor: true });
    const label = this.add
      .text(x, y, text, { fontFamily: 'sans-serif', fontSize: '10px', color: '#F2EDE4' })
      .setOrigin(0.5);
    this.root.add(rect);
    this.root.add(label);
    rect.on('pointerdown', onClick);
    label.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
  }

  private persistResult(r: QuizResult): void {
    const save = getSave();
    const prev = save.quiz[this.chapterId] ?? { best: 0, passed: false };
    save.quiz[this.chapterId] = {
      best: Math.max(prev.best, r.correct),
      passed: prev.passed || r.passed,
    };

    // 满分奖励：把隐藏知识卡直接补给玩家（延伸解读随之解锁）
    if (perfectBonusGranted(r.correct, r.total)) {
      const hidden = this.bundle.events.filter((e) => e.hidden).map((e) => e.knowledge_id);
      const target = hidden.find((id) => !save.knowledge.includes(id));
      if (target) addKnowledge(save, target);
    }

    // 章节完成度写回存档（设计书 6.7.4）
    this.lastCompletion = this.computeCompletion(r);
    save.progress.completion[this.chapterId] = this.lastCompletion;
    persist();
  }

  private computeCompletion(r: QuizResult): number {
    const save = getSave();
    const events = this.bundle.events.map((e) => e.id);
    const knowledge = this.bundle.events.map((e) => e.knowledge_id);
    const hidden = this.bundle.events.filter((e) => e.hidden).map((e) => e.knowledge_id);
    const quizBest = save.quiz[this.chapterId]?.best ?? r.correct;
    return chapterCompletion(
      events,
      knowledge,
      hidden,
      save.progress.events,
      save.knowledge,
      r.passed,
      quizBest,
    );
  }

  private nextChapterId(): string | null {
    const idx = dataLoader.getIndex().chapters.findIndex((c) => c.id === this.chapterId);
    const next = dataLoader.getIndex().chapters[idx + 1];
    if (!next) return null;
    // 只有已实现（有幕可进）的章节才算解锁
    return next.acts.length > 0 ? next.id : null;
  }
}