/**
 * 章末测验逻辑测试 —— 对应设计书 6.7.3 / 6.7.4。
 */

import { describe, expect, it } from 'vitest';
import {
  QUIZ_DRAW_COUNT,
  QUIZ_PASS_THRESHOLD,
  completionTier,
  perfectBonusGranted,
  sampleQuestions,
  scoreQuiz,
} from '../src/core/quiz';
import type { QuizQuestion } from '../src/core/types';
import quizData from '../public/data/quiz/quiz_ch00.json';

const realPool = (quizData as { pool: QuizQuestion[] }).pool;

function q(id: string, answer = 0, knowledge_ref = 'kc_x'): QuizQuestion {
  return {
    id,
    question: `Q${id}`,
    options: ['a', 'b', 'c', 'd'],
    answer,
    explanation: 'e',
    knowledge_ref,
  };
}

describe('6.7.3 抽题', () => {
  it('默认抽 5 题且互不重复', () => {
    const picked = sampleQuestions(realPool, QUIZ_DRAW_COUNT);
    expect(picked).toHaveLength(5);
    expect(new Set(picked.map((p) => p.id)).size).toBe(5);
  });

  it('不修改原题库', () => {
    const before = realPool.map((p) => p.id).join(',');
    sampleQuestions(realPool, 5);
    expect(realPool.map((p) => p.id).join(',')).toBe(before);
  });

  it('题库小于抽取数时返回全部，不抛错', () => {
    const small = [q('1'), q('2')];
    expect(sampleQuestions(small, 5)).toHaveLength(2);
    expect(sampleQuestions([], 5)).toHaveLength(0);
  });

  it('多次抽样能覆盖到题库里的不同题目（非固定顺序）', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      for (const p of sampleQuestions(realPool, 5)) seen.add(p.id);
    }
    expect(seen.size).toBe(realPool.length);
  });
});

describe('6.7.3 判分与通过线', () => {
  const questions = [q('a', 0), q('b', 1), q('c', 2), q('d', 3), q('e', 0)];

  it('全对', () => {
    const r = scoreQuiz(questions, [0, 1, 2, 3, 0]);
    expect(r.correct).toBe(5);
    expect(r.passed).toBe(true);
    expect(r.perQuestion).toEqual([true, true, true, true, true]);
  });

  it('答对 3 题即通过（通过线）', () => {
    const r = scoreQuiz(questions, [0, 1, 2, 9, 9]);
    expect(r.correct).toBe(3);
    expect(r.passed).toBe(true);
  });

  it('答对 2 题不通过', () => {
    const r = scoreQuiz(questions, [0, 1, 9, 9, 9]);
    expect(r.correct).toBe(2);
    expect(r.passed).toBe(false);
  });

  it('未作答（-1）按答错处理', () => {
    const r = scoreQuiz(questions, [-1, -1, -1, -1, -1]);
    expect(r.correct).toBe(0);
    expect(r.passed).toBe(false);
  });

  it('通过线常量为 3', () => {
    expect(QUIZ_PASS_THRESHOLD).toBe(3);
  });

  it('答错题的知识卡会去重列出，供「重答前先补看」', () => {
    const r = scoreQuiz([q('a', 0, 'kc_same'), q('b', 0, 'kc_same'), q('c', 0, 'kc_other')], [9, 9, 0]);
    expect(r.knowledgeToReview).toEqual(['kc_same']);
  });
});

describe('6.7.4 完成度四档评价', () => {
  it('分档与文字', () => {
    expect(completionTier(100).label).toBe('史实考证者');
    expect(completionTier(85).label).toBe('优');
    expect(completionTier(65).label).toBe('良');
    expect(completionTier(45).label).toBe('合格');
    expect(completionTier(10).label).toBe('参与');
  });

  it('每一档都有说明文字，不给分数', () => {
    for (const pct of [0, 39, 40, 59, 60, 79, 80, 99, 100, 120]) {
      const t = completionTier(pct);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.note.length).toBeGreaterThan(0);
      expect(t.note).not.toMatch(/\d+\s*分/);
    }
  });
});

describe('6.7.3 满分奖励', () => {
  it('仅满分才给', () => {
    expect(perfectBonusGranted(5, 5)).toBe(true);
    expect(perfectBonusGranted(4, 5)).toBe(false);
    expect(perfectBonusGranted(0, 0)).toBe(false);
  });
});

describe('测验题库数据完整性（12 题）', () => {
  it('题量不少于 12，题干/选项/解释/知识卡齐全', () => {
    expect(realPool.length).toBeGreaterThanOrEqual(12);
    for (const item of realPool) {
      expect(item.id).toMatch(/^qz_ch00_q\d+$/);
      expect(item.question.length).toBeGreaterThan(4);
      expect(item.options).toHaveLength(4);
      expect(item.answer).toBeGreaterThanOrEqual(0);
      expect(item.answer).toBeLessThan(4);
      expect(item.explanation.length).toBeGreaterThan(8);
      expect(item.knowledge_ref).toMatch(/^kc_/);
    }
  });

  it('题号唯一，正确答案不集中在同一个位置', () => {
    expect(new Set(realPool.map((p) => p.id)).size).toBe(realPool.length);
    const dist = [0, 0, 0, 0];
    realPool.forEach((p) => (dist[p.answer] += 1));
    // 不允许 12 题全部选 A
    expect(dist[0]).toBeLessThan(realPool.length);
  });
});