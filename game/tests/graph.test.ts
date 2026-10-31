/**
 * 知识图谱纯逻辑单元测试 —— 对应设计书 5.9.3。
 *
 * 图谱的价值全在「数据是否连得起来」：如果 links 漏写，玩家会看到一座孤岛，
 * 而这个玩法本身不含新内容，错了就没法用「加章节」自动长大。
 * 所以这里既测算法，也测真实数据。
 */

import { describe, expect, it } from 'vitest';
import {
  attemptEdge,
  buildRequiredEdges,
  connectedComponents,
  edgeKey,
  graphProgress,
  linkable,
  neighbours,
} from '../src/core/graph';
import events from '../public/data/events/events_ch00.json';
import knowledge from '../public/data/knowledge/knowledge_all.json';
import type { EventCard, KnowledgeCard } from '../src/core/types';

const cards = (events as unknown as { events: EventCard[] }).events;
const knowledgeCards = (knowledge as unknown as { cards: KnowledgeCard[] }).cards;

/** 造一张最小可用的知识卡 */
function kc(id: string, links: string[] = []): KnowledgeCard {
  return {
    id,
    chapter_id: 'ch00',
    title: id,
    summary: id,
    detail: id,
    source: 'test',
    tags: [],
    links,
    hidden: false,
    unlock_hint: null,
  } as unknown as KnowledgeCard;
}

describe('无向边键', () => {
  it('两端顺序不同但键相同', () => {
    expect(edgeKey('a', 'b')).toBe(edgeKey('b', 'a'));
  });

  it('自指的键也是稳定的', () => {
    expect(edgeKey('a', 'a')).toBe('a|a');
  });

  it('不会把不同节点对混成同一个键', () => {
    expect(edgeKey('a1', 'b')).not.toBe(edgeKey('a', '1b'));
  });
});

describe('构建必需边', () => {
  const evA = { id: 'e_a', knowledge_id: 'k_a' } as EventCard;
  const evB = { id: 'e_b', knowledge_id: 'k_b' } as EventCard;
  const evC = { id: 'e_c', knowledge_id: 'k_c' } as EventCard;

  it('知识卡的 links 变成事件卡之间的边', () => {
    const r = buildRequiredEdges([evA, evB], [kc('k_a', ['e_b']), kc('k_b')]);
    expect(r.edges).toEqual([{ a: 'e_a', b: 'e_b' }]);
    expect(r.keys.has(edgeKey('e_a', 'e_b'))).toBe(true);
  });

  it('自指引用被丢弃并记录', () => {
    const r = buildRequiredEdges([evA, evB], [kc('k_a', ['e_a'])]);
    expect(r.edges).toHaveLength(0);
    expect(r.dropped).toEqual([{ from: 'e_a', to: 'e_a', reason: 'self' }]);
  });

  it('指向不存在事件卡的引用被丢弃（不抛错）', () => {
    const r = buildRequiredEdges([evA], [kc('k_a', ['e_ghost'])]);
    expect(r.edges).toHaveLength(0);
    expect(r.dropped[0]).toEqual({ from: 'e_a', to: 'e_ghost', reason: 'dangling' });
  });

  it('事件卡找不到对应知识卡时跳过，不产生边也不报错', () => {
    const r = buildRequiredEdges([evA, evB], [kc('k_b')]);
    expect(r.edges).toHaveLength(0);
    expect(r.dropped).toHaveLength(0);
  });

  it('双向声明只算一条边（去重）', () => {
    const r = buildRequiredEdges([evA, evB], [kc('k_a', ['e_b']), kc('k_b', ['e_a'])]);
    expect(r.edges).toHaveLength(1);
  });

  it('同一知识卡重复写同一条 link 也只算一条', () => {
    const r = buildRequiredEdges([evA, evB], [kc('k_a', ['e_b', 'e_b'])]);
    expect(r.edges).toHaveLength(1);
  });

  it('度数按边累计', () => {
    const r = buildRequiredEdges(
      [evA, evB, evC],
      [kc('k_a', ['e_b', 'e_c']), kc('k_b', ['e_c']), kc('k_c')],
    );
    expect(r.edges).toHaveLength(3);
    expect(r.degree['e_c']).toBe(2);
    expect(r.degree['e_a']).toBe(2);
    expect(r.degree['e_b']).toBe(2);
  });

  it('links 缺失时不崩', () => {
    const noLinks = {
      id: 'k_a',
      chapter_id: 'ch00',
      title: 'x',
      summary: 'x',
      detail: 'x',
      source: 'x',
      tags: [],
      hidden: false,
      unlock_hint: null,
    } as unknown as KnowledgeCard;
    const r = buildRequiredEdges([evA, evB], [noLinks]);
    expect(r.edges).toHaveLength(0);
  });
});

describe('连线判定', () => {
  const required = { keys: new Set([edgeKey('e_a', 'e_b')]) };
  const known = new Set(['e_a', 'e_b', 'e_c']);

  it('同一个节点返回 self', () => {
    expect(attemptEdge(required, new Set(), 'e_a', 'e_a', known)).toBe('self');
  });

  it('未知节点返回 unknown-node', () => {
    expect(attemptEdge(required, new Set(), 'e_a', 'e_x', known)).toBe('unknown-node');
  });

  it('不在必需集合里的边返回 invalid', () => {
    expect(attemptEdge(required, new Set(), 'e_a', 'e_c', known)).toBe('invalid');
  });

  it('正确且未连过返回 ok', () => {
    expect(attemptEdge(required, new Set(), 'e_b', 'e_a', known)).toBe('ok');
  });

  it('已连过的边（反向也算）返回 duplicate', () => {
    expect(attemptEdge(required, new Set([edgeKey('e_a', 'e_b')]), 'e_b', 'e_a', known)).toBe(
      'duplicate',
    );
  });

  it('判定顺序：先看自指，再看节点是否存在', () => {
    const none: typeof required = { keys: new Set<string>() };
    expect(attemptEdge(none, new Set(), 'zz', 'zz', known)).toBe('self');
  });
});

describe('进度', () => {
  it('空图谱不算完成（避免 0/0 被当成通关）', () => {
    expect(graphProgress(new Set(), new Set())).toEqual({
      done: 0,
      total: 0,
      pct: 0,
      complete: false,
    });
  });

  it('按比例给整百分比', () => {
    const req = new Set(['a|b', 'b|c', 'c|d', 'd|e']);
    expect(graphProgress(req, new Set(['a|b'])).pct).toBe(25);
    expect(graphProgress(req, new Set(['a|b', 'b|c', 'c|d'])).pct).toBe(75);
  });

  it('只统计在必需集合里的边，多余的不算', () => {
    const req = new Set(['a|b']);
    const p = graphProgress(req, new Set(['a|b', 'x|y']));
    expect(p.done).toBe(1);
    expect(p.pct).toBe(100);
  });

  it('全部连上即完成', () => {
    const req = new Set(['a|b', 'b|c']);
    expect(graphProgress(req, new Set(['a|b', 'b|c'])).complete).toBe(true);
  });
});

describe('邻接与连通性', () => {
  const edges = [
    { a: 'a', b: 'b' },
    { a: 'b', b: 'c' },
  ];

  it('邻接列表不分方向', () => {
    expect(neighbours('b', edges).sort()).toEqual(['a', 'c']);
    expect(neighbours('a', edges)).toEqual(['b']);
    expect(neighbours('c', edges)).toEqual(['b']);
  });

  it('孤立节点没有邻居', () => {
    expect(neighbours('z', edges)).toEqual([]);
  });

  it('链式结构是一整个连通分量', () => {
    expect(connectedComponents(['a', 'b', 'c'], edges)).toBe(1);
  });

  it('孤立节点各自成岛（数据校对用）', () => {
    expect(connectedComponents(['a', 'b', 'c', 'z'], edges)).toBe(2);
  });

  it('无节点时为 0 个分量', () => {
    expect(connectedComponents([], [])).toBe(0);
  });
});

describe('只有已收集的事件可以连线', () => {
  it('两端都收集才可连', () => {
    const got = new Set(['e_a']);
    expect(linkable('e_a', 'e_a', got)).toBe(true);
    expect(linkable('e_a', 'e_b', got)).toBe(false);
    expect(linkable('e_b', 'e_c', got)).toBe(false);
  });
});

describe('真实数据校对（ch00 序章）', () => {
  const req = buildRequiredEdges(cards, knowledgeCards);

  it('事件卡与知识卡一一对应，没有找不到知识卡的事件', () => {
    const ids = new Set(knowledgeCards.map((k) => k.id));
    const orphan = cards.filter((e) => !ids.has(e.knowledge_id)).map((e) => e.id);
    expect(orphan).toEqual([]);
  });

  it('没有自指引用', () => {
    expect(req.dropped.filter((d) => d.reason === 'self')).toEqual([]);
  });

  it('没有悬挂引用（links 指向了不存在的事件卡）', () => {
    expect(req.dropped.filter((d) => d.reason === 'dangling')).toEqual([]);
  });

  it('序章图谱至少有 3 条边，否则算不上「图谱」', () => {
    expect(req.edges.length).toBeGreaterThanOrEqual(3);
  });

  it('图谱不出现孤岛：所有连出边的节点同属一个历史脉络', () => {
    const touched = Object.keys(req.degree);
    expect(connectedComponents(touched, req.edges)).toBe(1);
  });

  it('每条边两端都真实存在', () => {
    const ids = new Set(cards.map((e) => e.id));
    for (const e of req.edges) {
      expect(ids.has(e.a)).toBe(true);
      expect(ids.has(e.b)).toBe(true);
    }
  });

  it('键集合与边数组长度一致（无重复）', () => {
    expect(req.keys.size).toBe(req.edges.length);
  });
});