/**
 * 知识图谱的纯逻辑 —— 设计书 5.9.3「知识图谱」终章玩法。
 *
 * 节点 = 事件卡；因果边来自知识卡的 `links` 字段。
 * 也就是说：**图谱不是新写的内容，而是把已有知识卡之间的关系显式画出来**，
 * 越往后加章节，这张图自动变大，不需要额外设计工作。
 */

import type { EventCard, KnowledgeCard } from './types';

export interface GraphEdge {
  a: string;
  b: string;
}

/** 无向边的规范化键：两端排序后拼接，保证 (a,b) 与 (b,a) 同键 */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface RequiredGraph {
  /** 去重后的边 */
  edges: GraphEdge[];
  /** 规范化键集合，用于 O(1) 判定 */
  keys: Set<string>;
  /** 每个节点的度数 */
  degree: Record<string, number>;
  /** 被丢弃的引用（自指、悬挂），便于数据校对 */
  dropped: { from: string; to: string; reason: 'self' | 'dangling' }[];
}

/**
 * 由事件卡与知识卡构建必需边。
 *
 * 规则：
 * 1. 只在**存在的事件卡**之间连边（悬挂引用直接丢弃并记录，不抛错）
 * 2. 自指（event 的 links 里写了它自己）丢弃
 * 3. 无向、去重
 */
export function buildRequiredEdges(
  events: EventCard[],
  knowledge: KnowledgeCard[],
): RequiredGraph {
  const eventIds = new Set(events.map((e) => e.id));
  const byId = new Map(knowledge.map((k) => [k.id, k]));
  const keys = new Set<string>();
  const edges: GraphEdge[] = [];
  const dropped: RequiredGraph['dropped'] = [];

  const add = (from: string, to: string) => {
    if (from === to) {
      dropped.push({ from, to, reason: 'self' });
      return;
    }
    if (!eventIds.has(from) || !eventIds.has(to)) {
      dropped.push({ from, to, reason: 'dangling' });
      return;
    }
    const key = edgeKey(from, to);
    if (keys.has(key)) return;
    keys.add(key);
    edges.push({ a: from, b: to });
  };

  for (const ev of events) {
    const card = byId.get(ev.knowledge_id);
    if (!card) continue;
    for (const link of card.links ?? []) {
      add(ev.id, link);
    }
  }

  const degree: Record<string, number> = {};
  for (const e of edges) {
    degree[e.a] = (degree[e.a] ?? 0) + 1;
    degree[e.b] = (degree[e.b] ?? 0) + 1;
  }

  return { edges, keys, degree, dropped };
}

export type EdgeAttempt = 'ok' | 'duplicate' | 'invalid' | 'self' | 'unknown-node';

/**
 * 判定一次连线尝试。
 * 已连过的边返回 duplicate（不扣分、不重复计），未在必需集合里的返回 invalid。
 */
export function attemptEdge(
  required: { keys: Set<string>; },
  accepted: Set<string>,
  a: string,
  b: string,
  known: Set<string>,
): EdgeAttempt {
  if (a === b) return 'self';
  if (!known.has(a) || !known.has(b)) return 'unknown-node';
  const key = edgeKey(a, b);
  if (!required.keys.has(key)) return 'invalid';
  if (accepted.has(key)) return 'duplicate';
  return 'ok';
}

export interface GraphProgress {
  done: number;
  total: number;
  pct: number;
  complete: boolean;
}

export function graphProgress(requiredKeys: Set<string>, accepted: Set<string>): GraphProgress {
  const total = requiredKeys.size;
  let done = 0;
  for (const k of accepted) if (requiredKeys.has(k)) done += 1;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct, complete: total > 0 && done >= total };
}

/** 与某节点相邻的节点列表 */
export function neighbours(id: string, edges: GraphEdge[]): string[] {
  const out: string[] = [];
  for (const e of edges) {
    if (e.a === id) out.push(e.b);
    else if (e.b === id) out.push(e.a);
  }
  return out;
}

/**
 * 连通分量数。用于数据校对：图谱应当是一整条连贯的历史，
 * 如果出现孤立的小岛，说明某些知识卡的 links 漏写了。
 */
export function connectedComponents(nodeIds: string[], edges: GraphEdge[]): number {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    adj.get(e.a)?.push(e.b);
    adj.get(e.b)?.push(e.a);
  }
  const seen = new Set<string>();
  let comps = 0;
  for (const id of nodeIds) {
    if (seen.has(id)) continue;
    comps += 1;
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const n of adj.get(cur) ?? []) if (!seen.has(n)) stack.push(n);
    }
  }
  return comps;
}

/** 只保留已收集事件参与连线的判断 */
export function linkable(a: string, b: string, collected: Set<string>): boolean {
  return collected.has(a) && collected.has(b);
}