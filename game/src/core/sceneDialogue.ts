/**
 * 场景对白的「谁在场 / 谁在说 / 收尾要不要播」——纯函数，不依赖 Phaser。
 *
 * v1.8.7 之前，一段对白只有一个块级 `speaker`，多人对话全靠正文自己写名字，
 * 战斗一结束又直接跳面板，玩家分不清刚才谁在说话、这一场到底有谁。
 * 现在把三件事收敛到这里，对话框渲染、场景流程、数据测试共用同一份判据：
 *   1. `resolveDialogueCast()`：在场人物（声明优先，逐句 speaker 兜底补齐）
 *   2. `lineSpeaker()`：某一句到底归谁说
 *   3. `shouldPlayOutro()`：结算前是否还要插一段收尾对白（每个场景只插一次）
 */

import type { DialogueBlock } from './types';

/** 去重保序地合并若干人物 id 列表 */
function merge(ids: (string | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * 一段对白的在场人物。
 *
 * `participants` 是数据里声明的「这一场有谁」（可能包含只听不说的角色），
 * 逐句 `speaker` 与块级默认 `speaker` 是实际开口的人；两路合并，
 * 老数据没写 `participants` 时也能从台词里推出来，不会显示成空。
 */
export function resolveDialogueCast(block: DialogueBlock): string[] {
  return merge([
    ...(block.participants ?? []),
    ...block.lines.map((line) => line.speaker),
    block.speaker,
  ]);
}

/** 一个场景（开场 + 收尾）的全部对话人物，顺序按首次出现 */
export function sceneCast(intro?: DialogueBlock, outro?: DialogueBlock): string[] {
  return merge([
    ...(intro ? resolveDialogueCast(intro) : []),
    ...(outro ? resolveDialogueCast(outro) : []),
  ]);
}

/** 第 index 句的说话人：逐句 speaker 优先，缺省继承块级 speaker */
export function lineSpeaker(block: DialogueBlock, index: number): string {
  return block.lines[index]?.speaker ?? block.speaker;
}

/** 对白框右上角的「在场」标签；没有人物时返回空串（不占位） */
export function castLabel(ids: string[], names: Record<string, string>): string {
  if (ids.length === 0) return '';
  return `在场：${ids.map((id) => names[id] ?? id).join(' · ')}`;
}

/**
 * 收尾对白闸门：同一个场景的重试 / 二次结算不能把收尾台词再播一遍。
 * `playedFor` 记的是「上一次已经播过收尾的场景 id」，换场景（或重开节点）时由调用方清空。
 */
export function shouldPlayOutro(
  ref: string | null | undefined,
  sceneId: string,
  playedFor: string | null,
): boolean {
  return !!ref && playedFor !== sceneId;
}
