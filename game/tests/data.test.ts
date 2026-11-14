/**
 * 数据完整性与地图可达性测试。
 *
 * 这一层测试的价值在于：它挡住的不是代码 bug，而是**内容 bug**——
 * 例如「护送目标点根本走不到」「节点引用了一个不存在的敌人/对话/知识卡」。
 * 这类问题在真机试玩前很难被发现，但会让关卡直接不可通关。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROL_HIT_PAD, CONTROL_LAYOUT, FIELD_H, SUNNY_PROPS, TILE, VIEW_H, VIEW_W } from '../src/core/constants';

// vitest 的工作目录就是工程根目录；用 process.cwd() 而不是 __dirname，
// 以免在 ESM 下没有 __dirname 而报错。
const DATA = join(process.cwd(), 'public', 'data');

function read<T>(rel: string): T {
  return JSON.parse(readFileSync(join(DATA, rel), 'utf8')) as T;
}

/* ==================== 类型（仅取用到的字段） ==================== */

interface IndexJson {
  chapters: {
    id: string;
    name: string;
    acts: string[];
    quiz_id: string;
    level_range: [number, number];
  }[];
}
interface MapLayer {
  name: string;
  data: number[][];
  collidable: boolean;
}
interface MapObj {
  id: string;
  kind: string;
  x: number;
  y: number;
  payload?: string;
}
interface MapJson {
  id: string;
  width: number;
  height: number;
  tile_colors: Record<string, string>;
  layers: MapLayer[];
  spawn: { x: number; y: number };
  objects: MapObj[];
}
interface ActJson {
  id: string;
  chapter_id: string;
  name: string;
  events: string[];
  map_refs: string[];
  first_clear_reward: string;
  exp_base: number;
  nodes: string[];
}
interface EventJson {
  id: string;
  chapter_id: string;
  act_id: string;
  title: string;
  date: string;
  place: string;
  figures: string[];
  document: string;
  result: string;
  knowledge_id: string;
  hidden: boolean;
  five_element_check: string[];
}
interface NodeJson {
  id: string;
  event_id: string;
  type: string;
  dialogue_ref: string | null;
  map_ref: string | null;
  params: Record<string, unknown>;
  /** 左上角战役条显示的场景名 */
  title?: string;
  /** 史实年份 */
  year?: number;
  /** 战斗开场情境卡：时间 / 地点 / 双方兵力 */
  banner?: { time: string; place: string; ours?: string; enemy?: string; scene?: string };
}
interface EnemyJson {
  id: string;
  name: string;
  tier: string;
  hp_base: number;
  atk_base: number;
  def_base: number;
  spd: number;
  ai_params: { detect_radius: number; attack_range: number; attack_windup_ms: number; attack_cooldown_ms: number };
  boss_phases: { hp_pct: [number, number]; attacks: string[]; adds: string | null; weakpoint: boolean }[] | null;
}
interface KnowledgeJson {
  id: string;
  title: string;
  summary: string;
  source: string;
  hidden: boolean;
}
interface ItemJson {
  id: string;
  slot: string;
  quality: string;
  weapon_ref?: string;
}
interface DlgJson {
  dialogues: { id: string; speaker: string; lines: { text: string }[] }[];
  npcs: Record<string, string>;
}
interface QuizJson {
  pool: { id: string; knowledge_ref: string }[];
}
interface DungeonSpawnJson {
  enemy: string;
  count: number;
  spawn: string;
}
interface DungeonJson {
  id: string;
  name: string;
  chapter_id: string;
  map_ref: string;
  unlock_act: string;
  recommended_level: number;
  desc: string;
  waves: { spawns: DungeonSpawnJson[] }[];
  boss: string | null;
  boss_extra?: string[];
  quality_weights: Record<string, number>;
  unique_drop: string | null;
}

const index = read<IndexJson>('index.json');
const chId = index.chapters[0].id;
const acts = index.chapters[0].acts.map((a) => read<ActJson>(`acts/${a}.json`));
const events = read<{ events: EventJson[] }>(`events/events_${chId}.json`).events;
const nodes = read<{ nodes: NodeJson[] }>(`nodes/nodes_${chId}.json`).nodes;
const enemies = read<{ enemies: EnemyJson[] }>(`enemies/enemies_${chId}.json`).enemies;
const cards = read<{ cards: KnowledgeJson[] }>('knowledge/knowledge_all.json').cards;
const items = read<{ items: ItemJson[] }>('equipment/items_base.json').items;
const dlg = read<DlgJson>(`dialogues/dlg_${chId}.json`);
const quiz = read<QuizJson>(`quiz/quiz_${chId}.json`);
const dungeons = read<{ dungeons: DungeonJson[] }>('dungeons/dungeons.json').dungeons;
const maps = acts
  .flatMap((a) => a.map_refs)
  .concat(nodes.map((n) => n.map_ref).filter((m): m is string => !!m))
  .concat(dungeons.map((d) => d.map_ref))
  .filter((v, i, arr) => arr.indexOf(v) === i)
  .map((id) => read<MapJson>(`maps/${id}.json`));

const mapById = new Map(maps.map((m) => [m.id, m]));
const nodeById = new Map(nodes.map((n) => [n.id, n]));
const enemyById = new Map(enemies.map((e) => [e.id, e]));
const cardById = new Map(cards.map((c) => [c.id, c]));
const dlgById = new Map(dlg.dialogues.map((d) => [d.id, d]));
const itemById = new Map(items.map((i) => [i.id, i]));

/* ==================== 引用完整性 ==================== */

describe('章与幕', () => {
  it('索引里的每一幕都有对应的幕定义文件', () => {
    for (const a of index.chapters[0].acts) {
      expect(existsSync(join(DATA, `acts/${a}.json`)), `${a} 缺少幕定义`).toBe(true);
    }
    // 本期只做一章两幕：章节里声明的幕就是全部内容，不再有"未开放"占位
    expect(index.chapters[0].acts.length).toBe(2);
  });

  it('已实现的幕都声明了节点、事件与地图，且经验为正', () => {
    for (const act of acts) {
      expect(act.nodes.length, `${act.id} 没有节点`).toBeGreaterThan(0);
      expect(act.events.length).toBeGreaterThan(0);
      expect(act.map_refs.length).toBeGreaterThan(0);
      expect(act.exp_base).toBeGreaterThan(0);
    }
  });

  it('幕的节点列表与节点表一致', () => {
    for (const act of acts) {
      for (const nid of act.nodes) {
        expect(nodeById.has(nid), `幕 ${act.id} 引用了不存在的节点 ${nid}`).toBe(true);
      }
    }
  });

  it('每个节点都属于本幕的事件卡', () => {
    const evToAct = new Map(events.map((e) => [e.id, e.act_id]));
    for (const n of nodes) {
      expect(evToAct.has(n.event_id), `节点 ${n.id} 的事件 ${n.event_id} 不存在`).toBe(true);
    }
    for (const act of acts) {
      const actNodeIds = new Set(act.nodes);
      for (const n of nodes.filter((x) => actNodeIds.has(x.id))) {
        expect(evToAct.get(n.event_id), `节点 ${n.id} 的事件不属于本幕`).toBe(act.id);
      }
    }
  });
});

describe('事件卡与知识卡', () => {
  it('五要素齐全且校验位已填', () => {
    for (const e of events) {
      expect(e.title.length, `${e.id} 缺标题`).toBeGreaterThan(1);
      expect(e.date.length, `${e.id} 缺时间`).toBeGreaterThan(1);
      // 地点允许为空（如「农民阶级的局限性」这类结论性卡片），但必须是显式空串
      expect(typeof e.place).toBe('string');
      expect(e.result.length, `${e.id} 缺结果`).toBeGreaterThan(10);
      expect(e.five_element_check).toHaveLength(5);
      expect(e.five_element_check.every((v) => v === 'OK'), `${e.id} 五要素未全部通过`).toBe(true);
    }
  });

  it('每个事件卡都有对应的知识卡', () => {
    for (const e of events) {
      expect(cardById.has(e.knowledge_id), `${e.id} 的知识卡 ${e.knowledge_id} 不存在`).toBe(true);
    }
  });

  it('知识卡正文与来源齐备', () => {
    for (const c of cards) {
      expect(c.title.length).toBeGreaterThan(2);
      expect(c.summary.length, `${c.id} 正文过短`).toBeGreaterThan(30);
      expect(c.source.length).toBeGreaterThan(1);
    }
  });

  it('隐藏事件卡在事件表中确实标记为 hidden', () => {
    const hiddenEvents = events.filter((e) => e.hidden);
    expect(hiddenEvents.length).toBeGreaterThan(0);
    for (const e of hiddenEvents) {
      expect(cardById.get(e.knowledge_id)?.hidden, `${e.id} 的隐藏知识卡未标 hidden`).toBe(true);
    }
  });
});

describe('节点引用', () => {
  it('对话引用存在', () => {
    for (const n of nodes) {
      if (!n.dialogue_ref) continue;
      expect(dlgById.has(n.dialogue_ref), `节点 ${n.id} 的对话 ${n.dialogue_ref} 不存在`).toBe(true);
    }
  });

  it('地图引用存在', () => {
    for (const n of nodes) {
      if (!n.map_ref) continue;
      expect(mapById.has(n.map_ref), `节点 ${n.id} 的地图 ${n.map_ref} 不存在`).toBe(true);
    }
  });

  it('波次与 Boss 引用的敌人存在', () => {
    for (const n of nodes) {
      const waves = (n.params.waves ?? []) as { spawns?: { enemy: string }[] }[];
      for (const w of waves) {
        for (const s of w.spawns ?? []) {
          expect(enemyById.has(s.enemy), `节点 ${n.id} 的敌人 ${s.enemy} 不存在`).toBe(true);
        }
      }
      const boss = n.params.boss as string | undefined;
      if (boss) expect(enemyById.has(boss), `节点 ${n.id} 的 Boss ${boss} 不存在`).toBe(true);
      for (const extra of (n.params.boss_extra ?? []) as string[]) {
        expect(enemyById.has(extra), `节点 ${n.id} 的副 Boss ${extra} 不存在`).toBe(true);
      }
    }
  });

  it('节点奖励的知识卡存在', () => {
    for (const n of nodes) {
      for (const key of ['reward_knowledge', 'hidden_knowledge']) {
        const id = n.params[key] as string | undefined;
        if (id) expect(cardById.has(id), `节点 ${n.id} 的 ${key}=${id} 不存在`).toBe(true);
      }
    }
  });

  it('首通奖励的装备存在', () => {
    for (const act of acts) {
      expect(items.some((i) => i.id === act.first_clear_reward), `幕 ${act.id} 的首通奖励不存在`).toBe(true);
    }
  });

  it('每个节点都有 HUD 用的场景名与年份', () => {
    // 左上角战役条靠这两项显示「幕名 · 这一场　年份」，缺了会退回幕名、年份空着
    for (const n of nodes) {
      expect(n.title?.trim(), `节点 ${n.id} 缺 title`).toBeTruthy();
      expect(typeof n.year, `节点 ${n.id} 缺 year`).toBe('number');
      expect(n.year ?? 0, `节点 ${n.id} 的 year 不合理：${n.year}`).toBeGreaterThanOrEqual(1839);
      expect(n.year ?? 9999, `节点 ${n.id} 的 year 不合理：${n.year}`).toBeLessThan(1949);
    }
  });

  it('战斗开场卡（banner）内容齐全：时间、地点、对方兵力', () => {
    // 甲方要求「背景上写清时间、地点、对方出兵数量」，缺一项评审时就会被问住
    for (const n of nodes) {
      if (!n.banner) continue;
      expect(n.banner.time.trim(), `节点 ${n.id} 的开场卡缺时间`).toBeTruthy();
      expect(n.banner.time, `节点 ${n.id} 的时间要写到月`).toMatch(/\d{4}\s*年\s*\d{1,2}\s*月/);
      expect(n.banner.place.trim(), `节点 ${n.id} 的开场卡缺地点`).toBeTruthy();
      expect(n.banner.enemy?.trim(), `节点 ${n.id} 的开场卡缺对方兵力`).toBeTruthy();
      if (n.banner.scene) expect(['sea', 'land']).toContain(n.banner.scene);
    }
  });

  it('序章第一幕的守炮台战必须有开场卡（演示版的核心一场）', () => {
    const battle = nodes.find((n) => n.id === 'nd_1841_humen_battle');
    expect(battle, '找不到 nd_1841_humen_battle').toBeTruthy();
    expect(battle?.banner?.place).toContain('虎门');
    expect(battle?.banner?.enemy).toMatch(/英/);
  });
});

describe('敌人数据', () => {
  it('Boss 的阶段区间连续覆盖 100%—0%，且招式名合法', () => {
    const valid = new Set(['broadside', 'landing_boat', 'ram']);
    for (const e of enemies) {
      if (!e.boss_phases) continue;
      const phases = [...e.boss_phases].sort((a, b) => b.hp_pct[0] - a.hp_pct[0]);
      expect(phases[0].hp_pct[0]).toBe(100);
      expect(phases[phases.length - 1].hp_pct[1]).toBe(0);
      for (let i = 1; i < phases.length; i++) {
        expect(phases[i].hp_pct[0]).toBe(phases[i - 1].hp_pct[1]);
      }
      for (const p of phases) {
        expect(p.attacks.length).toBeGreaterThan(0);
        for (const a of p.attacks) expect(valid.has(a), `未知招式 ${a}（${e.id}）`).toBe(true);
        if (p.adds) expect(enemyById.has(p.adds)).toBe(true);
      }
      // 至少有一个阶段暴露弱点，否则 Boss 无法被打出爆发窗口
      expect(phases.some((p) => p.weakpoint), `${e.id} 没有弱点阶段`).toBe(true);
    }
  });

  it('普通敌人的 AI 参数在合理范围内', () => {
    for (const e of enemies) {
      expect(e.hp_base, `${e.id} HP`).toBeGreaterThan(0);
      expect(e.atk_base, `${e.id} ATK`).toBeGreaterThan(0);
      expect(e.spd, `${e.id} 速度`).toBeGreaterThan(0);
      expect(e.ai_params.detect_radius, `${e.id} 发现半径过小`).toBeGreaterThanOrEqual(100);
      expect(e.ai_params.attack_range, `${e.id} 攻击距离`).toBeGreaterThan(0);
      // 设计书 6.1.6 给远程型的参数是「发现 160 / 攻击 180」，
      // 攻击距离略大于发现距离是允许的（贴上来就打），但不能悬殊到隔着半个屏幕开火。
      expect(
        e.ai_params.attack_range,
        `${e.id} 攻击距离远超发现半径，会出现"看不到就开始打"`,
      ).toBeLessThanOrEqual(e.ai_params.detect_radius + 40);
      // 前摇必须留出反应时间
      expect(e.ai_params.attack_windup_ms, `${e.id} 前摇过短`).toBeGreaterThanOrEqual(280);
      expect(e.ai_params.attack_cooldown_ms, `${e.id} 冷却`).toBeGreaterThan(0);
    }
  });

  it('按行为分类检查射程与前摇的搭配', () => {
    // 设计书 6.1.6 的四种行为型：远程/近战/冲锋/精英。
    // 关键不变量：**远距离的非投射攻击必须给足前摇**，否则玩家无法反应。
    for (const e of enemies) {
      const range = e.ai_params.attack_range;
      const windup = e.ai_params.attack_windup_ms;
      if (e.tier === 'ranged') {
        expect(range, `${e.id} 作为远程型射程太近`).toBeGreaterThanOrEqual(120);
        expect(windup, `${e.id} 作为远程型前摇过短`).toBeGreaterThanOrEqual(400);
      } else if (range <= 60) {
        // 近战型
        expect(windup, `${e.id} 近战前摇`).toBeGreaterThanOrEqual(280);
      } else {
        // 冲锋型：靠长距离突进，必须长前摇
        expect(windup, `${e.id} 是冲锋型（射程 ${range}），前摇必须足够长让玩家闪避`).toBeGreaterThanOrEqual(
          550,
        );
      }
    }
  });

  it('Boss 基准 HP 与设计书一致（湘军统领 700 / 洋枪队长 400）', () => {
    expect(enemyById.get('en_boss_xiangarmy_a')?.hp_base).toBe(700);
    expect(enemyById.get('en_boss_xiangarmy_b')?.hp_base).toBe(400);
    expect(enemyById.get('en_boss_steamfrigate')?.hp_base).toBe(1206);
  });
});

describe('对话数据', () => {
  it('每个对话行的文本不超过对话框容量（3 行 × 18 字）', () => {
    for (const d of dlg.dialogues) {
      for (const line of d.lines) {
        const rows = line.text.split('\n');
        expect(rows.length, `${d.id} 的一行文本超过 3 行`).toBeLessThanOrEqual(3);
        for (const r of rows) {
          expect(r.length, `${d.id} 有超过 18 字的行：${r}`).toBeLessThanOrEqual(18);
        }
      }
    }
  });

  it('说话人都在 npcs 表里有显示名', () => {
    for (const d of dlg.dialogues) {
      expect(dlg.npcs[d.speaker], `对话 ${d.id} 的说话人 ${d.speaker} 缺显示名`).toBeTruthy();
    }
  });
});

describe('测验与图鉴', () => {
  it('题库每题的 knowledge_ref 都存在', () => {
    for (const q of quiz.pool) {
      expect(cardById.has(q.knowledge_ref), `${q.id} 引用了不存在的知识卡`).toBe(true);
    }
  });

  it('题库数量足够抽 5 题且有余量', () => {
    expect(quiz.pool.length).toBeGreaterThanOrEqual(10);
  });
});

/* ==================== 副本数据 ==================== */

describe('副本数据', () => {
  it('副本 id 唯一，且三件套（名称/说明/推荐等级）齐全', () => {
    const ids = dungeons.map((d) => d.id);
    expect(new Set(ids).size, '副本 id 有重复').toBe(ids.length);
    for (const d of dungeons) {
      expect(d.name.length, `${d.id} 缺名称`).toBeGreaterThan(1);
      expect(d.desc.length, `${d.id} 缺说明`).toBeGreaterThan(8);
      expect(d.recommended_level, `${d.id} 推荐等级过低`).toBeGreaterThanOrEqual(1);
    }
  });

  it('副本引用的地图都存在', () => {
    for (const d of dungeons) {
      expect(mapById.has(d.map_ref), `副本 ${d.id} 的地图 ${d.map_ref} 不存在`).toBe(true);
    }
  });

  it('解锁幕必须是本章已实际实现的一幕', () => {
    const realActs = new Set(index.chapters[0].acts);
    for (const d of dungeons) {
      if (!d.unlock_act) continue;
      expect(realActs.has(d.unlock_act), `副本 ${d.id} 的解锁幕 ${d.unlock_act} 不在已实现列表中`).toBe(
        true,
      );
    }
  });

  it('波次里的敌人与数量都合法', () => {
    for (const d of dungeons) {
      expect(d.waves.length, `副本 ${d.id} 没有波次`).toBeGreaterThanOrEqual(2);
      for (const w of d.waves) {
        expect(w.spawns.length, `副本 ${d.id} 有空波次`).toBeGreaterThan(0);
        for (const s of w.spawns) {
          expect(enemyById.has(s.enemy), `副本 ${d.id} 的敌人 ${s.enemy} 不存在`).toBe(true);
          expect(s.count, `副本 ${d.id} 的 ${s.enemy} 数量非法`).toBeGreaterThan(0);
          expect(s.count, `副本 ${d.id} 的 ${s.enemy} 数量过多`).toBeLessThanOrEqual(8);
          expect(typeof s.spawn).toBe('string');
          expect(s.spawn.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('Boss 与副 Boss 引用存在', () => {
    for (const d of dungeons) {
      if (d.boss) expect(enemyById.has(d.boss), `副本 ${d.id} 的 Boss ${d.boss} 不存在`).toBe(true);
      for (const extra of d.boss_extra ?? []) {
        expect(enemyById.has(extra), `副本 ${d.id} 的副 Boss ${extra} 不存在`).toBe(true);
      }
    }
  });

  it('品质权重合法：只含三档、白装为正、总和为 100、紫装不为 0', () => {
    for (const d of dungeons) {
      const w = d.quality_weights;
      expect(Object.keys(w).sort()).toEqual(['blue', 'purple', 'white']);
      for (const [k, v] of Object.entries(w)) {
        expect(v, `副本 ${d.id} 的 ${k} 权重为负`).toBeGreaterThanOrEqual(0);
      }
      expect(w.white, `副本 ${d.id} 白装权重必须为正，否则保底无从扣减`).toBeGreaterThan(0);
      expect(w.purple, `副本 ${d.id} 紫装权重为 0，等于永远不会出`).toBeGreaterThan(0);
      expect(w.white + w.blue + w.purple, `副本 ${d.id} 权重总和不是 100`).toBe(100);
    }
  });

  it('首通独特装备存在，且互不重复', () => {
    const uniques: string[] = [];
    for (const d of dungeons) {
      if (!d.unique_drop) continue;
      expect(itemById.has(d.unique_drop), `副本 ${d.id} 的独特装备 ${d.unique_drop} 不存在`).toBe(true);
      uniques.push(d.unique_drop);
    }
    expect(new Set(uniques).size, '两个副本给了同一件独特装备').toBe(uniques.length);
  });

  it('推荐的游戏时长区间：每场副本 2—5 波，避免拖成十分钟一场', () => {
    for (const d of dungeons) {
      expect(d.waves.length, `副本 ${d.id} 波次过多，重复刷会累`).toBeLessThanOrEqual(5);
    }
  });

  it('副本地图出生点可用，且右侧找得到敌人出生点', () => {
    for (const d of dungeons) {
      const m = mapById.get(d.map_ref) as MapJson;
      const g = buildGrid(m);
      expect(g.solid[m.spawn.y][m.spawn.x], `副本 ${d.id} 的出生点在实心格上`).toBe(false);
      // 与 LevelScene.spawnPoints 同一规则
      const minCol = Math.floor(g.cols * 0.55);
      let count = 0;
      for (let step = 0; step < g.cols - 2 - minCol && count < 8; step++) {
        const col = g.cols - 2 - step;
        if (col < 1 || col >= g.cols - 1) break;
        for (let y = 2; y < g.rows - 3; y++) {
          if (!g.solid[y][col] && !g.solid[y + 1][col]) count += 1;
        }
      }
      expect(count, `副本 ${d.id} 的地图在右侧找不到敌人出生点`).toBeGreaterThan(0);
    }
  });
});

/* ==================== 地图可达性 ==================== */

interface Grid {
  cols: number;
  rows: number;
  solid: boolean[][];
}

function buildGrid(m: MapJson): Grid {
  const solid = Array.from({ length: m.height }, () => Array<boolean>(m.width).fill(false));
  for (const layer of m.layers) {
    if (!layer.collidable) continue;
    for (let y = 0; y < layer.data.length && y < m.height; y++) {
      for (let x = 0; x < layer.data[y].length && x < m.width; x++) {
        if (layer.data[y][x]) solid[y][x] = true;
      }
    }
  }
  return { cols: m.width, rows: m.height, solid };
}

/** 从起点做 BFS，返回可达格集合（键为 y*cols+x） */
function reachable(g: Grid, sx: number, sy: number): Set<number> {
  const seen = new Set<number>();
  if (g.solid[sy]?.[sx]) return seen;
  const q: [number, number][] = [[sx, sy]];
  seen.add(sy * g.cols + sx);
  while (q.length > 0) {
    const [x, y] = q.shift() as [number, number];
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
      if (g.solid[ny][nx]) continue;
      const key = ny * g.cols + nx;
      if (seen.has(key)) continue;
      seen.add(key);
      q.push([nx, ny]);
    }
  }
  return seen;
}

describe('地图可达性（防止关卡走不通）', () => {
  it('所有地图的瓦片颜色都有定义，出生点不在实心格上', () => {
    for (const m of maps) {
      expect(m.width).toBeGreaterThan(0);
      expect(m.spawn.x).toBeGreaterThanOrEqual(0);
      expect(m.spawn.x).toBeLessThan(m.width);
      expect(m.spawn.y).toBeGreaterThanOrEqual(0);
      expect(m.spawn.y).toBeLessThan(m.height);
      const g = buildGrid(m);
      expect(g.solid[m.spawn.y][m.spawn.x], `${m.id} 出生点在实心格上`).toBe(false);
      // 出现过的瓦片号都要有颜色，否则渲染出来是空洞
      const used = new Set<number>();
      for (const layer of m.layers) for (const row of layer.data) for (const v of row) if (v) used.add(v);
      for (const v of used) {
        expect(m.tile_colors[String(v)], `${m.id} 的瓦片号 ${v} 缺颜色`).toBeTruthy();
      }
    }
  });

  it('每张地图的可交互物都能被走到（本身或四邻可达）', () => {
    for (const m of maps) {
      const g = buildGrid(m);
      const seen = reachable(g, m.spawn.x, m.spawn.y);
      for (const obj of m.objects) {
        const neighbours: [number, number][] = [
          [obj.x, obj.y],
          [obj.x + 1, obj.y],
          [obj.x - 1, obj.y],
          [obj.x, obj.y + 1],
          [obj.x, obj.y - 1],
        ];
        const ok = neighbours.some(
          ([x, y]) => x >= 0 && y >= 0 && x < g.cols && y < g.rows && seen.has(y * g.cols + x),
        );
        expect(ok, `${m.id} 的可交互物 ${obj.id}（${obj.kind}）走不到`).toBe(true);
      }
    }
  });

  it('护送地图的右端可达（否则护送关卡无法完成）', () => {
    for (const n of nodes) {
      if (n.params.mode !== 'escort' || !n.map_ref) continue;
      const m = mapById.get(n.map_ref) as MapJson;
      const g = buildGrid(m);
      const seen = reachable(g, m.spawn.x, m.spawn.y);
      // 终止条件在像素 x ≥ pixelWidth-48，即第 width-3 格附近
      const targetCol = m.width - 3;
      const reached = Array.from({ length: g.rows }, (_, y) => y).some((y) =>
        [targetCol, targetCol + 1, targetCol + 2].some((x) => x < g.cols && seen.has(y * g.cols + x)),
      );
      expect(reached, `${m.id} 的右端（第 ${targetCol} 列）从出生点走不到，护送关无法完成`).toBe(true);
    }
  });

  it('战斗节点有至少一个可用的敌人出生点', () => {
    for (const n of nodes) {
      if (n.params.mode !== 'combat' || !n.map_ref) continue;
      const m = mapById.get(n.map_ref) as MapJson;
      const g = buildGrid(m);
      // 与 LevelScene.spawnPoints 的规则一致：从右侧起找可通行格
      const minCol = Math.floor(g.cols * 0.55);
      let count = 0;
      for (let step = 0; step < g.cols - 2 - minCol && count < 8; step++) {
        const col = g.cols - 2 - step;
        if (col < 1 || col >= g.cols - 1) break;
        for (let y = 2; y < g.rows - 3; y++) {
          if (!g.solid[y][col] && !g.solid[y + 1][col]) count += 1;
        }
      }
      expect(count, `${m.id} 在右侧找不到敌人出生点`).toBeGreaterThan(0);
    }
  });

  it('可交互物不能摆在虚拟按键底下（手机上会被按钮吞掉，玩家找不到）', () => {
    // 单屏地图才成立：地图不比视口大时相机不滚动，世界坐标 == 屏幕坐标。
    // 多屏地图要滚动，物件被按钮盖住只是某一瞬间的状态，不在本测试范围内。
    //
    // 鸦片箱（pickup）额外要留 10px **视觉**余量：按钮是半透明圆脸，半径 + 命中pad
    // 只是「点得到」，贴着边摆照样和按钮糊成一团。甲方两次反馈
    // 「第八个鸦片找不到」，第二次就是因为箱子离「攻」键只剩 2px。
    const PICKUP_VISUAL_MARGIN = 10;
    const zones = Object.entries(CONTROL_LAYOUT) as [string, { x: number; y: number; r: number }][];
    // 静态布景（`kind:'prop'` 且 payload 是 Sunny Land 道具名，见 SUNNY_PROPS）不算可交互物：
    // 它只画不登记（`LevelScene.spawnSunnyProp`），走近不会弹「搬起 / 投入」，压到摇杆底下
    // 也只是被按钮盖住一角，不会让玩家找不到任何能点的东西。其余 kind 一个都不放过。
    const isScenery = (o: { kind: string; payload?: string }) =>
      o.kind === 'prop' && o.payload !== undefined && o.payload in SUNNY_PROPS;
    let checked = 0;
    for (const m of maps) {
      if (m.width * TILE > VIEW_W || m.height * TILE > FIELD_H) continue;
      for (const obj of m.objects) {
        if (isScenery(obj)) continue;
        const px = (obj.x + 0.5) * TILE;
        const py = (obj.y + 0.5) * TILE;
        const margin = CONTROL_HIT_PAD + (obj.kind === 'pickup' ? PICKUP_VISUAL_MARGIN : 0);
        for (const [name, z] of zones) {
          const dist = Math.hypot(px - z.x, py - z.y);
          expect(
            dist,
            `${m.id} 的可交互物 ${obj.id}（${obj.kind}）落在「${name}」按键范围内（距离 ${dist.toFixed(1)} < ${z.r + margin}），手机上会被按钮压住看不见`,
          ).toBeGreaterThanOrEqual(z.r + margin);
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('非探索关不得残留第一幕的鸦片箱（防串幕）', () => {
    // `kind:'pickup', payload:'crate'` 是虎门海滩「搬鸦片箱投销烟池」的专属可交互物：
    // LevelScene 会给它挂金色呼吸标记，交互文案写死「抱起一箱鸦片」。
    // 它被误放进天京战场/城池/村落时，玩家看到的就是串幕的鸦片箱（真机截图反馈）。
    // 引擎侧还有一道防线（非 explore 模式自动隐藏 pickup），这里是数据层的源头约束。
    const crateNodes = new Set(
      nodes
        .filter((n) => n.params.mode === 'explore' && Number(n.params.crate_target ?? 8) > 0)
        .map((n) => n.map_ref),
    );
    for (const m of maps) {
      const crates = m.objects.filter((o) => o.kind === 'pickup' && o.payload === 'crate');
      if (crates.length === 0) continue;
      expect(
        crateNodes.has(m.id),
        `${m.id} 摆了 ${crates.length} 个鸦片箱，却没有搬箱探索节点引用它`,
      ).toBe(true);
    }
    // 太平天国三张图是纯护送 / 经营 / 战斗场景，一个可交互物都不该有
    const tpMaps = maps.filter((m) => m.id.startsWith('map_ch00_tp_'));
    expect(tpMaps).toHaveLength(3);
    for (const m of tpMaps) {
      expect(m.objects.filter((o) => o.kind === 'pickup'), `${m.id} 残留 pickup 物件`).toHaveLength(0);
    }
  });

  it('经营/过场节点不需要地图也能进行（map_ref 允许为空）', () => {
    const noMap = nodes.filter((n) => !n.map_ref);
    for (const n of noMap) {
      expect(['cutscene', 'choice', 'management']).toContain(n.type);
    }
  });
});

describe('虚拟按键布局：右侧「闪」不能被 HUD 或画布裁掉（2026-11-14 截图反馈）', () => {
  // InputSystem 的命中半径 = CONTROL_LAYOUT.r + CONTROL_HIT_PAD；视觉半径就是 r。
  // 这两层要分开量：视觉圆压到 HUD 上会「看得见但被盖」，命中区出画布会「点不到」。
  const hitR = (z: { r: number }) => z.r + CONTROL_HIT_PAD;
  const { dodge, attack, cannon } = CONTROL_LAYOUT;

  it('「闪」视觉圆完整落在战场内，且不压底部 HUD 条', () => {
    // HUD 顶边 = FIELD_H（UIScene 的 HUD_Y = VIEW_H - HUD_H = FIELD_H = 256）。
    // 原来 (440,244) 视觉下缘 262 直接压进血条/武器名那一条，扁视口下还会被裁。
    expect(dodge.y + dodge.r, '「闪」下缘压进底部 HUD 条会被血条/武器名盖住').toBeLessThan(FIELD_H - 2);
    expect(dodge.y - dodge.r).toBeGreaterThanOrEqual(0);
    expect(dodge.x - dodge.r).toBeGreaterThanOrEqual(0);
    expect(dodge.x + dodge.r, '「闪」右缘超出画布会被裁掉').toBeLessThanOrEqual(VIEW_W - 2);
    expect(dodge.y + hitR(dodge), '「闪」命中区下缘必须还在画布内').toBeLessThanOrEqual(VIEW_H);
    expect(dodge.x + hitR(dodge), '「闪」命中区右缘必须还在画布内').toBeLessThanOrEqual(VIEW_W);
  });

  it('「闪」上移后不能和「攻」/「炮」抢点击', () => {
    // 只改 y 不够：旧的 x=440 上移 16px 会钻进「攻」的命中圈。
    // 现在 (452,228) 与「攻」恰好相切（圆心距 60 = 34 + 26），互不吞点。
    for (const [name, other] of [['攻', attack], ['炮', cannon]] as const) {
      const gap = Math.hypot(dodge.x - other.x, dodge.y - other.y) - hitR(dodge) - hitR(other);
      expect(gap, `「闪」与「${name}」命中圈重叠 ${(-gap).toFixed(1)}px，会互相抢点击`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('装备存在感：weapon_ref 引用完整性与掉落形状覆盖', () => {
  it('每个 weapon_ref 都指向 config.json 里真实存在的武器', () => {
    const weapons = read<{ weapons: Record<string, unknown> }>('config.json').weapons;
    const refs = items.filter((i) => i.weapon_ref);
    expect(refs.length).toBeGreaterThanOrEqual(5);
    for (const i of refs) {
      expect(weapons, `${i.id} 的 weapon_ref 拼错了会静默失效`).toHaveProperty(i.weapon_ref!);
    }
  });

  it('weapon_ref 只出现在武器槽，非武器模板保持无字段（老存档零影响）', () => {
    for (const i of items) {
      if (i.weapon_ref) expect(i.slot).toBe('weapon');
      else expect('weapon_ref' in i).toBe(false);
    }
  });

  it('五种槽位掉落权重全 > 0，保证五种形状都能在场上出现', () => {
    const drops = read<{ rules: { slot_weights: Record<string, number> }[] }>('equipment/drops.json');
    expect(drops.rules.length).toBeGreaterThan(0);
    const slots = ['weapon', 'head', 'body', 'legs', 'accessory'];
    for (const rule of drops.rules) {
      for (const s of slots) {
        expect(Object.keys(rule.slot_weights), `掉落规则漏了 ${s} 槽`).toContain(s);
        expect(rule.slot_weights[s], `${s} 权重为 0 会导致对应形状永不出现`).toBeGreaterThan(0);
      }
    }
  });

  it('每个槽位至少有一件可掉落模板，且模板表存在可达成的品质目标', () => {
    const slots = ['weapon', 'head', 'body', 'legs', 'accessory'];
    for (const s of slots) {
      expect(items.some((i) => i.slot === s), `${s} 没有模板`).toBe(true);
    }
    expect(items.some((i) => i.quality === 'purple')).toBe(true);
  });
});