/**
 * 章末测验的纯逻辑（设计书 6.7.3）。
 * 与渲染无关，便于单元测试：抽题、判分、通过判定。
 */

import type { QuizQuestion } from './types';
import type { Rng } from './balance';

/** 通过线：答对 ≥3 题（设计书 6.7.3） */
export const QUIZ_PASS_THRESHOLD = 3;

/** 每次抽题数量 */
export const QUIZ_DRAW_COUNT = 5;

/**
 * 从题库中不放回地随机抽 count 题。
 * 题库不足时返回全部（并按原顺序），不会抛错。
 */
export function sampleQuestions(
  pool: QuizQuestion[],
  count: number = QUIZ_DRAW_COUNT,
  rng: Rng = Math.random,
): QuizQuestion[] {
  const n = Math.min(count, pool.length);
  const idx = pool.map((_, i) => i);
  // Fisher–Yates 部分洗牌
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).map((i) => pool[i]);
}

export interface QuizResult {
  correct: number;
  total: number;
  passed: boolean;
  /** 每题是否答对，顺序与传入题目一致 */
  perQuestion: boolean[];
  /** 答错题对应的知识卡 ID（供「重答前必须先看知识卡」使用） */
  knowledgeToReview: string[];
}

/**
 * 判分。picks 与 questions 等长，-1 表示未作答。
 */
export function scoreQuiz(questions: QuizQuestion[], picks: number[]): QuizResult {
  let correct = 0;
  const perQuestion: boolean[] = [];
  const review: string[] = [];
  questions.forEach((q, i) => {
    const ok = picks[i] === q.answer;
    perQuestion.push(ok);
    if (ok) correct += 1;
    else if (q.knowledge_ref && !review.includes(q.knowledge_ref)) review.push(q.knowledge_ref);
  });
  return {
    correct,
    total: questions.length,
    passed: correct >= QUIZ_PASS_THRESHOLD,
    perQuestion,
    knowledgeToReview: review,
  };
}

/**
 * 完成度评价（设计书 6.7.4 的四档文字，不给分数）。
 */
export function completionTier(pct: number): { label: string; note: string } {
  if (pct >= 100) return { label: '史实考证者', note: '事件、知识卡与隐藏内容全部收集。' };
  if (pct >= 80) return { label: '优', note: '主要脉络已经掌握。' };
  if (pct >= 60) return { label: '良', note: '主干清楚，仍有遗漏的细节与隐藏内容。' };
  if (pct >= 40) return { label: '合格', note: '走完了主线，知识卡还有不少空缺。' };
  return { label: '参与', note: '还有大量内容没有接触，可在长廊里补看知识卡。' };
}

/** 测验满分奖励（设计书 6.7.3）：解锁一张隐藏知识卡的延伸解读 */
export function perfectBonusGranted(correct: number, total: number): boolean {
  return total > 0 && correct === total;
}