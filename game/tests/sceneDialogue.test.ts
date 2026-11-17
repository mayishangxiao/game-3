/**
 * 场景对白完整性（v1.8.7）——甲方要求「每个场景都明确包含参与对话的人物及说话人归属，
 * 覆盖开场以及战斗结束后的收尾阶段」。
 *
 * 这里锁的是**数据 + 共用判据**：
 *   - 每段对白每一句都有说话人，且说话人能在 npcs 表里查到显示名；
 *   - 每个剧情节点 / 副本都有开场与收尾两段不同的对白；
 *   - 场景声明的 `participants` 必须等于「开场人物 ∪ 收尾人物」，不许漏人也不许虚标；
 *   - 收尾闸门 `shouldPlayOutro()` 每个场景只放行一次。
 * 流程接线（`LevelScene` 的 showPanel / completeNode / finishDungeon）由 CDP 探针实拍覆盖。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  castLabel,
  isNpcInteractable,
  lineSpeaker,
  resolveDialogueCast,
  sceneCast,
  shouldPlayOutro,
} from '../src/core/sceneDialogue';
import type { DialogueBlock, DungeonDef, EventCard, NodeDef } from '../src/core/types';

const ROOT = process.cwd();
const readJson = <T>(rel: string): T =>
  JSON.parse(readFileSync(join(ROOT, rel), 'utf8').replace(/^\uFEFF/, '')) as T;

interface DialogueFile {
  npcs: Record<string, string>;
  dialogues: DialogueBlock[];
}

const dlg = readJson<DialogueFile>('public/data/dialogues/dlg_ch00.json');
const npcs = dlg.npcs;
const blocks = new Map(dlg.dialogues.map((b) => [b.id, b]));
const nodes = readJson<{ nodes: NodeDef[] }>('public/data/nodes/nodes_ch00.json').nodes;
const dungeons = readJson<{ dungeons: DungeonDef[] }>('public/data/dungeons/dungeons.json').dungeons;
const events = readJson<{ events: EventCard[] }>('public/data/events/events_ch00.json').events;
const act1a = readJson<{
  objects: { id: string; kind: string; dialogue_ref?: string | null }[];
}>('public/data/maps/map_ch00_act1a.json');

const sorted = (xs: string[]): string[] => [...xs].sort();
const sameSet = (a: string[], b: string[]): boolean =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

describe('core/sceneDialogue 纯函数', () => {
  const block: DialogueBlock = {
    id: 't',
    speaker: 'narrator',
    participants: ['narrator', 'lin_zexu'],
    lines: [
      { text: '甲', speaker: 'lin_zexu' },
      { text: '乙' },
      { text: '丙', speaker: 'guan_tianpei' },
    ],
  };

  it('在场人物 = 声明优先 + 逐句说话人兜底，去重且保序', () => {
    expect(resolveDialogueCast(block)).toEqual(['narrator', 'lin_zexu', 'guan_tianpei']);
  });

  it('老数据没写 participants 时，也能从台词推出在场的人', () => {
    const legacy: DialogueBlock = { id: 'old', speaker: 'narrator', lines: [{ text: '甲' }, { text: '乙', speaker: 'lin_zexu' }] };
    expect(resolveDialogueCast(legacy)).toEqual(['lin_zexu', 'narrator']);
  });

  it('逐句说话人覆盖块级默认，缺省时继承', () => {
    expect(lineSpeaker(block, 0)).toBe('lin_zexu');
    expect(lineSpeaker(block, 1)).toBe('narrator');
    expect(lineSpeaker(block, 2)).toBe('guan_tianpei');
    expect(lineSpeaker(block, 99)).toBe('narrator');
  });

  it('场景人物 = 开场 ∪ 收尾；在场标签用显示名，没人时为空', () => {
    const outro: DialogueBlock = {
      id: 'o',
      speaker: 'narrator',
      lines: [{ text: '收', speaker: 'xiangmin' }],
    };
    expect(sceneCast(block, outro)).toEqual(['narrator', 'lin_zexu', 'guan_tianpei', 'xiangmin']);
    expect(castLabel(['lin_zexu', 'narrator'], npcs)).toBe('在场：林则徐 · 旁白');
    expect(castLabel([], npcs)).toBe('');
  });

  it('收尾闸门：无收尾不播 / 首播一次 / 同场景不重播 / 换场景重新可播', () => {
    expect(shouldPlayOutro(null, 'n1', null)).toBe(false);
    expect(shouldPlayOutro('dlg_out', 'n1', null)).toBe(true);
    expect(shouldPlayOutro('dlg_out', 'n1', 'n1')).toBe(false);
    expect(shouldPlayOutro('dlg_out', 'n2', 'n1')).toBe(true);
  });

  it('NPC 闸门：没谈过可交互、谈过即锁死、别的 NPC 不受牵连', () => {
    // 没配 npc_talk（talkObjId 为 null）——始终可以反复搭话
    expect(isNpcInteractable('obj_x', null, false)).toBe(true);
    expect(isNpcInteractable('obj_x', null, true)).toBe(true);
    // 配了 npc_talk，但还没搭话
    expect(isNpcInteractable('obj_linzexu', 'obj_linzexu', false)).toBe(true);
    // 谈完 → 终止态：不再进交互候选、不再兜底播对白
    expect(isNpcInteractable('obj_linzexu', 'obj_linzexu', true)).toBe(false);
    // 闸门只锁那一位，其它可交互对象照旧（箱子/池子/出口）
    expect(isNpcInteractable('obj_crate_1', 'obj_linzexu', true)).toBe(true);
  });
});

describe('对白数据：每一句都找得到说话人', () => {
  it('npcs 表齐全，显示名非空', () => {
    expect(npcs.narrator).toBe('旁白');
    expect(Object.keys(npcs).length).toBeGreaterThanOrEqual(15);
    for (const [id, name] of Object.entries(npcs)) {
      expect(id.trim(), `人物 id 不能为空：${id}`).not.toBe('');
      expect(name.trim(), `${id} 缺显示名`).not.toBe('');
    }
  });

  it('每段对白非空、每行都有说话人，且说话人均在 npcs / 在场名单内', () => {
    expect(dlg.dialogues.length).toBeGreaterThanOrEqual(20);
    const ids = new Set<string>();
    for (const b of dlg.dialogues) {
      expect(ids.has(b.id), `对白块 id 重复：${b.id}`).toBe(false);
      ids.add(b.id);
      expect(b.lines.length, `${b.id} 没有台词`).toBeGreaterThan(0);
      expect(npcs[b.speaker], `${b.id} 的默认说话人 ${b.speaker} 没有显示名`).toBeTruthy();
      const cast = resolveDialogueCast(b);
      for (const [i, line] of b.lines.entries()) {
        expect(line.text.trim(), `${b.id} 第 ${i + 1} 句为空`).not.toBe('');
        expect(line.speaker?.trim(), `${b.id} 第 ${i + 1} 句没有说话人归属`).toBeTruthy();
        const speaker = lineSpeaker(b, i);
        expect(npcs[speaker], `${b.id} 第 ${i + 1} 句的 ${speaker} 没有显示名`).toBeTruthy();
        expect(cast, `${b.id} 第 ${i + 1} 句的 ${speaker} 没列进在场人物`).toContain(speaker);
      }
    }
  });
});

describe('所有场景：开场 + 收尾 + 参与人物', () => {
  const checkScene = (
    id: string,
    introRef: string | null | undefined,
    outroRef: string | null | undefined,
    participants: string[] | undefined,
  ): void => {
    expect(introRef, `${id} 缺开场对白`).toBeTruthy();
    expect(outroRef, `${id} 缺收尾对白（战斗一结束不能没有角色对话）`).toBeTruthy();
    expect(outroRef, `${id} 的开场与收尾指向了同一段对白`).not.toBe(introRef);
    const intro = blocks.get(introRef as string);
    const outro = blocks.get(outroRef as string);
    expect(intro, `${id} 的开场对白 ${introRef} 不存在`).toBeTruthy();
    expect(outro, `${id} 的收尾对白 ${outroRef} 不存在`).toBeTruthy();
    expect(participants?.length ?? 0, `${id} 没有声明参与对话的人物`).toBeGreaterThan(0);
    for (const p of participants ?? []) {
      expect(npcs[p], `${id} 的人物 ${p} 没有显示名`).toBeTruthy();
    }
    expect(
      sameSet(participants ?? [], sceneCast(intro, outro)),
      `${id} 的 participants 与「开场 ∪ 收尾」实际说话人不一致：\n  声明 ${JSON.stringify(participants)}\n  实际 ${JSON.stringify(sceneCast(intro, outro))}`,
    ).toBe(true);
    expect(shouldPlayOutro(outroRef, id, null), `${id} 的收尾对白应被结算闸门放行`).toBe(true);
  };

  it('9 个剧情节点全部覆盖（对白 / 抉择 / 经营 / 护送 / 战斗 / 过场）', () => {
    expect(nodes.length).toBeGreaterThanOrEqual(9);
    for (const n of nodes) {
      checkScene(n.id, n.dialogue_ref, n.outro_dialogue_ref, n.participants);
    }
  });

  it('3 个副本全部覆盖开场与通关收尾', () => {
    expect(dungeons.length).toBeGreaterThanOrEqual(3);
    for (const d of dungeons) {
      checkScene(d.id, d.intro_dialogue_ref, d.outro_dialogue_ref, d.participants);
    }
  });

  it('11 张事件卡的 figures 都非空且能在 npcs 里查到名字', () => {
    expect(events.length).toBeGreaterThanOrEqual(11);
    for (const e of events) {
      expect(e.figures.length, `${e.id} 没有登记历史人物`).toBeGreaterThan(0);
      for (const f of e.figures) {
        expect(npcs[f], `${e.id} 的 ${f} 没有显示名`).toBeTruthy();
      }
    }
  });
});

/**
 * v1.9.0 回归：林则徐的「谈完还能源源不断播旁白」。
 *
 * 数据上有两个对白来源叠在同一个对象身上：`npc_talk.dialogue` 是他的正台词，
 * 对象自带的 `dialogue_ref` 是这一幕的开场旁白（给进关时用的）。一旦闸门失效，
 * 第二次交互就会掉进 `dialogue_ref` 兜底。这里既锁判据，也锁「两个 ref 不能是同一段」——
 * 同段的话测试看不出问题，但玩家会听到自己的台词被当成旁白重播。
 */
describe('林则徐搭话只发生一次（v1.9.0）', () => {
  const talkNode = nodes.find((n) => (n.params as { npc_talk?: { npc?: string } }).npc_talk);
  const cfg = (talkNode?.params as { npc_talk?: { npc?: string; dialogue?: string } } | undefined)?.npc_talk;
  const npcObj = act1a.objects.find((o) => o.kind === 'npc');

  it('销烟关确实配了 npc_talk，且指向地图里那位 NPC', () => {
    expect(talkNode, '没有任何节点配置 npc_talk').toBeTruthy();
    expect(cfg?.npc).toBe('obj_linzexu');
    expect(npcObj?.id).toBe('obj_linzexu');
    expect(blocks.has(String(cfg?.dialogue))).toBe(true);
  });

  it('npc_talk 正台词与对象自带 dialogue_ref 不是同一段（否则谈完重播的是自己的台词）', () => {
    expect(npcObj?.dialogue_ref).toBeTruthy();
    expect(cfg?.dialogue).not.toBe(npcObj?.dialogue_ref);
    // 兜底那段就是开场旁白：确认它确实是旁白块，说明「重播旁白」这个症状对得上
    const fallback = blocks.get(String(npcObj?.dialogue_ref));
    expect(fallback?.speaker).toBe('narrator');
  });

  it('谈完那一刻闸门关闭，重开节点（talked 复位）又重新放行', () => {
    const id = String(npcObj?.id);
    const talkId = String(cfg?.npc);
    // 进关 → 未谈
    expect(isNpcInteractable(id, talkId, false)).toBe(true);
    // 播完正台词 → 锁死：findNearObject 跳过它、handleInteract 直接 break
    expect(isNpcInteractable(id, talkId, true)).toBe(false);
    // 重试 / 换图：startNodeInner 会把 npcTalked 复位，闸门重新打开
    expect(isNpcInteractable(id, talkId, false)).toBe(true);
  });
});

/**
 * 跨幕「无地图过场」的对白闸门（v2.9.1）——太平天国最后一节点是抉择（无地图），
 * 紧接的洋务运动首节点 nd_1861_zongli_dialog 也是 map_ref=null。
 * 旧版 updateWorld 在 `if (!this.player || !this.map) return;` 处早退，
 * DialogueBox.show() 已经把名字/立绘/空正文写进 DOM，但 update() 永远不被调用：
 * 玩家看到「倭仁」下面整块黑，点一下才硬填一行。这里锁住顺序与数据前提。
 */
describe('无地图过场对白仍要打字推进（v2.9.1）', () => {
  const sceneSrc = readFileSync(join(ROOT, 'src/scenes/LevelScene.ts'), 'utf8');
  const world = sceneSrc.slice(sceneSrc.indexOf('private updateWorld('));
  const tickAt = world.indexOf('this.dialogue?.update(delta)');
  const guardAt = world.indexOf('if (!this.player || !this.map)');

  it('updateWorld 里打字机在「有没有世界」的早退之前', () => {
    expect(tickAt, '找不到 dialogue.update()').toBeGreaterThan(-1);
    expect(guardAt, '找不到 player/map 早退').toBeGreaterThan(tickAt);
    // 早退分支里仍要能推进对白，否则玩家只能靠 canvas 的 pointerdown 硬填
    const branch = world.slice(guardAt, guardAt + 420);
    expect(branch).toContain('this.dialogue.advance()');
  });

  it('太平天国之后接的洋务首节点确实是无地图过场，且配了开场对白', () => {
    const index = readJson<{ chapters: { id: string; acts: string[] }[] }>('public/data/index.json');
    const chapter = index.chapters.find((c) => c.id === 'ch00');
    const acts = (chapter?.acts ?? []).map((id) =>
      readJson<{ id: string; nodes: string[] }>(`public/data/acts/${id}.json`),
    );
    const act3 = acts.find((a) => a.id === 'ch00_act3');
    const first = nodes.find((n) => n.id === act3?.nodes[0]);
    expect(first?.type).toBe('cutscene');
    expect(first?.map_ref ?? null).toBeNull();
    expect(blocks.has(String(first?.dialogue_ref))).toBe(true);
    expect(first?.dialogue_ref).toBe('dlg_ch00_act3_intro');
  });

  it('键盘推进直接挂场景键盘，不依赖被 dialogue 关掉的 InputSystem', () => {
    expect(sceneSrc).toContain("const DIALOGUE_KEYS = ['keydown-E', 'keydown-ENTER', 'keydown-J', 'keydown-SPACE']");
    expect(sceneSrc).toContain('this.input.keyboard?.on(key, this.handleDialogueKey)');
    expect(sceneSrc).toContain('if (event.repeat || !this.dialogue?.isActive) return;');
  });

  it('所有无地图节点都带开场对白，不能出现「有框没词」的数据前提', () => {
    const noMap = nodes.filter((n) => !n.map_ref);
    expect(noMap.length).toBeGreaterThan(0);
    for (const n of noMap) {
      expect(blocks.has(String(n.dialogue_ref)), `${n.id} 没有可用开场对白`).toBe(true);
    }
  });
});
