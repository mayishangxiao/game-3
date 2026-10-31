/**
 * 数据加载器 —— 对应《完整设计书 v2.0》7.1.2 加载流程。
 * 所有内容以 JSON 驱动，改内容不动代码。
 */

import { DATA_ROOT } from './constants';
import type {
  ActDef,
  ChapterDef,
  ChapterMeta,
  DialogueBlock,
  DropTable,
  DungeonDef,
  EnemyDef,
  EventCard,
  GameIndex,
  ItemBase,
  KnowledgeCard,
  MapDef,
  NodeDef,
  QuizDef,
  BalanceConfig,
} from './types';

const cache = new Map<string, unknown>();

async function fetchJson<T>(relPath: string): Promise<T> {
  const key = relPath;
  if (cache.has(key)) return cache.get(key) as T;
  const url = `${DATA_ROOT}/${relPath}`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`[DataLoader] 加载失败 ${url} (HTTP ${res.status})`);
  }
  const json = (await res.json()) as T;
  cache.set(key, json);
  return json;
}

/** 清空缓存（调试用） */
export function clearDataCache(): void {
  cache.clear();
}

export interface ChapterBundle {
  meta: ChapterMeta;
  def: ChapterDef;
  events: EventCard[];
  nodes: NodeDef[];
  enemies: EnemyDef[];
  dialogues: DialogueBlock[];
  /** 说话人 ID → 显示名 */
  npcs: Record<string, string>;
  maps: MapDef[];
  quiz: QuizDef;
}

export class DataLoader {
  private index: GameIndex | null = null;
  private balance: BalanceConfig | null = null;
  private items: ItemBase[] = [];
  private drops: DropTable | null = null;
  private knowledge: KnowledgeCard[] = [];

  /** 全局数据：index + config + 装备模板 + 掉落表 + 全部知识卡 */
  async loadGlobals(): Promise<void> {
    const [index, balance, items, drops, knowledge] = await Promise.all([
      fetchJson<GameIndex>('index.json'),
      fetchJson<BalanceConfig>('config.json'),
      fetchJson<{ items: ItemBase[] }>('equipment/items_base.json'),
      fetchJson<DropTable>('equipment/drops.json'),
      fetchJson<{ cards: KnowledgeCard[] }>('knowledge/knowledge_all.json'),
    ]);
    this.index = index;
    this.balance = balance;
    this.items = items.items;
    this.drops = drops;
    this.knowledge = knowledge.cards;
  }

  getIndex(): GameIndex {
    if (!this.index) throw new Error('[DataLoader] 未加载全局数据');
    return this.index;
  }

  getBalance(): BalanceConfig {
    if (!this.balance) throw new Error('[DataLoader] 未加载全局数据');
    return this.balance;
  }

  getDrops(): DropTable {
    if (!this.drops) throw new Error('[DataLoader] 未加载全局数据');
    return this.drops;
  }

  getItems(): ItemBase[] {
    return this.items;
  }

  getKnowledge(): KnowledgeCard[] {
    return this.knowledge;
  }

  findItemBase(id: string): ItemBase | undefined {
    return this.items.find((i) => i.id === id);
  }

  findKnowledge(id: string): KnowledgeCard | undefined {
    return this.knowledge.find((k) => k.id === id);
  }

  getChapterMeta(chapterId: string): ChapterMeta | undefined {
    return this.getIndex().chapters.find((c) => c.id === chapterId);
  }

  /** 进入章节时加载该章数据包 */
  async loadChapter(chapterId: string): Promise<ChapterBundle> {
    const meta = this.getChapterMeta(chapterId);
    if (!meta) throw new Error(`[DataLoader] 未知章节 ${chapterId}`);

    const [def, events, nodes, enemies, dlg, quiz] = await Promise.all([
      fetchJson<ChapterDef>(`chapters/${chapterId}.json`),
      fetchJson<{ events: EventCard[] }>(`events/events_${chapterId}.json`),
      fetchJson<{ nodes: NodeDef[] }>(`nodes/nodes_${chapterId}.json`),
      fetchJson<{ enemies: EnemyDef[] }>(`enemies/enemies_${chapterId}.json`),
      fetchJson<{ dialogues: DialogueBlock[]; npcs?: Record<string, string> }>(`dialogues/dlg_${chapterId}.json`),
      fetchJson<QuizDef>(`quiz/quiz_${chapterId}.json`),
    ]);

    return {
      meta,
      def,
      events: events.events,
      nodes: nodes.nodes,
      enemies: enemies.enemies,
      dialogues: dlg.dialogues,
      npcs: dlg.npcs ?? {},
      maps: [],
      quiz,
    };
  }

  /** 进入幕时加载地图 */
  async loadMap(mapId: string): Promise<MapDef> {
    return fetchJson<MapDef>(`maps/${mapId}.json`);
  }

  async loadAct(actId: string): Promise<ActDef> {
    return fetchJson<ActDef>(`acts/${actId}.json`);
  }

  /** 副本表（全作共用一份，体量很小） */
  async loadDungeons(): Promise<DungeonDef[]> {
    const j = await fetchJson<{ dungeons: DungeonDef[] }>('dungeons/dungeons.json');
    return j.dungeons;
  }

  async loadDungeon(dungeonId: string): Promise<DungeonDef> {
    const all = await this.loadDungeons();
    const def = all.find((d) => d.id === dungeonId);
    if (!def) throw new Error(`未知副本 ${dungeonId}`);
    return def;
  }
}

export const dataLoader = new DataLoader();