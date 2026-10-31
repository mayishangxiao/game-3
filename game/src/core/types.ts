/**
 * 数据结构定义 —— 与《完整设计书 v2.0》第七章 7.2 节 JSON Schema 一一对应。
 * 字段名与设计书保持一致，便于直接把 JSON 当作文档校对对象。
 */

/* ============ 7.2.1 index.json ============ */

export interface ChapterMeta {
  id: string;
  name: string;
  period: string;
  /** 已实现、可进入的幕 */
  acts: string[];
  /** 已设计但尚未实现的幕（长廊上显示为未开放） */
  acts_planned?: string[];
  bonus_acts?: string[];
  quiz_id: string;
  level_range: [number, number];
  unlock: string;
}

export interface GameIndex {
  version: number;
  chapters: ChapterMeta[];
}

/* ============ 7.2.2 chapters/chXX.json ============ */

export interface ChapterDef {
  id: string;
  name: string;
  subtitle: string;
  time_text: string;
  protagonist_chain: string[];
  hub_map: string | null;
  corridor_bgm: string;
  new_weapon: string | null;
  new_skill: string | null;
  completion_weight: { events: number; knowledge: number; quiz: number; hidden: number };
}

/* ============ 7.2.3 acts/chXX_actY.json ============ */

export interface ActDef {
  id: string;
  chapter_id: string;
  seq: number;
  name: string;
  avatar: string;
  events: string[];
  primary_archetype: string;
  secondary_archetypes: string[];
  map_refs: string[];
  bgm: string;
  first_clear_reward: string;
  exp_base: number;
  nodes: string[];
}

/* ============ 7.2.4 events/events_chXX.json ============ */

export interface EventCard {
  id: string;
  chapter_id: string;
  act_id: string;
  title: string;
  date: string;
  place: string;
  figures: string[];
  document: string;
  result: string;
  archetype: string;
  knowledge_id: string;
  hidden: boolean;
  unlock_condition: string | null;
  five_element_check: string[];
}

/* ============ 7.2.5 nodes/nodes_chXX.json ============ */

export type NodeType =
  | 'dialog'
  | 'combat'
  | 'assembly'
  | 'choice'
  | 'management'
  | 'rhythm'
  | 'sort'
  | 'puzzle'
  | 'stealth'
  | 'cutscene';

export interface NodeDef {
  id: string;
  event_id: string;
  archetype: string;
  type: NodeType;
  params: Record<string, unknown>;
  dialogue_ref?: string | null;
  enemy_ref?: string | null;
  map_ref?: string | null;
  /** 左上角 HUD 显示的「这一场叫什么」。缺省时退回幕名。 */
  title?: string;
  /** 史实年份（数字），显示成「1841 年」 */
  year?: number;
  /** 战斗开场「情境卡」：时间、地点、双方兵力。甲方要求背景上必须写清这三样。 */
  banner?: BannerDef;
}

/**
 * 战斗开场卡的文案。全部来自节点数据，改内容不动代码。
 *
 * 为什么要单列一个结构：老师评审时第一眼要看到「什么时候、在哪、对面多少人」，
 * 这是党史题材的知识点入口，不是装饰。
 */
export interface BannerDef {
  /** 精确到月，例如「1841 年 2 月」 */
  time: string;
  /** 地点，例如「虎门 · 威远炮台」 */
  place: string;
  /** 我方兵力/装备，例如「广东水师 · 岸炮 60 门」 */
  ours?: string;
  /** 对方兵力，例如「蒸汽炮舰 11 艘 · 陆军 2000 余人」 */
  enemy?: string;
  /** 背景图种类（现在只有程序化的海战背景，留位给美术图） */
  scene?: 'sea' | 'land';
}

/* ============ 7.2.6 maps/map_*.json ============ */

export interface MapLayer {
  name: string;
  data: number[][];
  collidable: boolean;
}

export interface MapDef {
  id: string;
  width: number;
  height: number;
  tileset: string;
  /** 瓦片号 → 颜色的映射（占位美术阶段使用；接入图集后替换为帧索引） */
  tile_colors: Record<string, string>;
  layers: MapLayer[];
  /** 出生点（格坐标） */
  spawn: { x: number; y: number };
  /** 传送点：走到即触发节点 */
  triggers: MapTrigger[];
  /** 可交互物：拾取、交付、NPC、出口 */
  objects: MapObject[];
  /**
   * 顶部几行不画地面，改叠一条远景（天空 + 海 + 敌舰剪影）。
   * 战斗地图用：那几行本来就是实心墙，玩家站不上去，拿来当「炮台外的海面」。
   */
  sky_rows?: number;
  /**
   * 战场残破化：地表加弹坑、血迹、尸骸、碎木与裂痕。
   * 只在「打烂了的战场」用（虎门炮台、码头攻坚），村道/长廊别开。
   */
  battle_scars?: boolean;
}

/** 地图上的可交互物（拾取箱、销烟池、出口等） */
export interface MapObject {
  id: string;
  kind: 'pickup' | 'deposit' | 'npc' | 'exit' | 'prop';
  /** 格坐标 */
  x: number;
  y: number;
  /** 交互按钮旁的提示文字 */
  label: string;
  color?: string;
  /** 交互后播放的对话块 */
  dialogue_ref?: string;
  /** 交互后触发的节点 */
  node_ref?: string;
  /** 任意附加标记，例如 "crate" */
  payload?: string;
}

export interface MapTrigger {
  id: string;
  /** 格坐标矩形区域 */
  x: number;
  y: number;
  w: number;
  h: number;
  node_ref: string;
  once?: boolean;
}

/* ============ 7.2.7 dialogues/dlg_chXX.json ============ */

export interface DialogueAction {
  type: 'spawn' | 'knowledge' | 'flag' | 'bgm' | 'end';
  item?: string;
  value?: string | number;
}

export interface DialogueLine {
  text: string;
  emotion?: string;
  action?: DialogueAction;
  next?: string;
  branch?: {
    prompt: string;
    options: { label: string; next: string }[];
  };
}

export interface DialogueBlock {
  id: string;
  speaker: string;
  lines: DialogueLine[];
}

/* ============ 7.2.8 enemies/enemies_chXX.json ============ */

export interface AiParams {
  detect_radius: number;
  attack_range: number;
  attack_windup_ms: number;
  attack_cooldown_ms: number;
  /**
   * 光环增益（郭富准将这类「指挥官」单位）：身边 radius 内的友军攻击力 +atk_pct%。
   * 只有存活的光环持有者才生效，死了立刻失效 —— 先打指挥官是有回报的打法。
   */
  aura?: { radius: number; atk_pct: number };
}

export interface BossPhase {
  hp_pct: [number, number];
  attacks: string[];
  adds: string | null;
  weakpoint: boolean;
}

export type EnemyTier = 'mob' | 'standard' | 'ranged' | 'elite' | 'boss';

export interface EnemyDef {
  id: string;
  name: string;
  tier: EnemyTier;
  hp_base: number;
  atk_base: number;
  def_base: number;
  spd: number;
  ai_params: AiParams;
  frames: number;
  atlas: string;
  boss_phases: BossPhase[] | null;
  /** 占位美术：主色与体型（像素） */
  color?: string;
  size?: { w: number; h: number };
  /** 占位形体：'ship' 画成铁壳蒸汽炮舰（英军 Boss），缺省人形 */
  body?: 'human' | 'ship';
}

/* ============ 7.2.9 equipment/items_base.json ============ */

export type Slot = 'weapon' | 'head' | 'body' | 'legs' | 'accessory';
export type Quality = 'white' | 'blue' | 'purple';

export interface ItemBase {
  id: string;
  slot: Slot;
  quality: Quality;
  name: string;
  stat: 'atk' | 'def' | 'hp' | 'spd';
  base_value: number;
  quality_multiplier: number;
  source: 'drop' | 'quest' | 'first_clear';
  flavor: string;
}

/** 背包中的一件实体装备 */
export interface ItemInstance {
  uid: string;
  base_id: string;
  slot: Slot;
  quality: Quality;
  name: string;
  stat: string;
  value: number;
  enhance: number;
  affixes: { id: string; value: number }[];
}

/* ============ 7.2.10 equipment/drops.json ============ */

export interface DropRule {
  source_type: EnemyTier;
  drop_chance: number;
  slot_weights: Record<Slot, number>;
  quality_weights: Record<Quality, number>;
}

export interface DropTable {
  rules: DropRule[];
  level_coeff: number;
  pity: { threshold: number; boost: number };
}

/* ============ 7.2.11 knowledge ============ */

export interface KnowledgeCard {
  id: string;
  chapter_id: string;
  title: string;
  summary: string;
  detail: string;
  source: string;
  tags: string[];
  links: string[];
  hidden: boolean;
  unlock_hint: string | null;
}

/* ============ 7.2.12 quiz ============ */

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  answer: number;
  explanation: string;
  knowledge_ref: string;
}

export interface QuizDef {
  id: string;
  chapter_id: string;
  pool: QuizQuestion[];
}

/* ============ 7.2.13 config.json ============ */

export interface BalanceConfig {
  exp_curve: { base: number; slope: number };
  hp_formula: { base: number; per_level: number };
  atk_formula: { base: number; per_level: number };
  def_formula: { base: number; per_level: number };
  damage: {
    random_min: number;
    random_max: number;
    def_factor: number;
    boss_weakpoint_mult: number;
    level_suppress_threshold: number;
    level_suppress_def_factor: number;
  };
  dodge: { invincible_ms: number; cooldown_ms: number; distance_px: number };
  level_coeff: { base: number; per_level: number };
  weapons: Record<string, WeaponDef>;
  enemy_tiers: Record<EnemyTier, { hp: number; atk: number; def: number }>;
  affixes: { id: string; name: string; min: number; max: number; weight: number }[];
  quality_multiplier: Record<Quality, number>;
  knowledge: { bonus_per_10: number; bonus_cap: number };
  combat_feedback: {
    flash_ms: number;
    knockback_melee: number;
    knockback_ranged: number;
    screenshake_amp: number;
  };
  /** 主动技能配置（按钮触发，纯数值，逻辑在 core/cannon.ts） */
  skills?: { humen_cannon: CannonParams };
  ui: {
    dialog_speed: number;
    text_chars_per_line: number;
    max_lines: number;
    /** 说话人 id → 立绘相对路径（相对 data 根）。缺省则对话框显示空头像框 */
    portraits?: Record<string, string>;
  };
}

/**
 * 【虎门重炮】参数（config.json → skills.humen_cannon）。
 * 设计意图来自老师给的第一章要求：一发带走小兵、重伤精英但不秒杀、对军舰几乎无效。
 */
export interface CannonParams {
  id: string;
  name: string;
  cooldown_ms: number;
  range_px: number;
  splash_px: number;
  /** 这些 tier 的敌人被直接打死（mob / standard） */
  kill_tiers: EnemyTier[];
  /** 精英按最大生命值扣这个百分比，且永远不致死 */
  elite_hp_pct: number;
  /** Boss 按最大生命值扣这个百分比（船体太厚） */
  boss_hp_pct: number;
  misfire_chance_pct: number;
  misfire_self_pct: number;
  desc: string;
}

export interface WeaponDef {
  id: string;
  name: string;
  mult: number;
  attacks_per_sec: number;
  range: number;
  pierce: number;
  /** 近战扇形角度（远程为 0） */
  arc_deg: number;
  /** 弹匣容量（机枪），0 表示无弹药限制 */
  magazine: number;
  reload_ms: number;
  projectile_speed: number;
}

/* ============ 副本（可重复刷） ============ */

export interface DungeonSpawn {
  enemy: string;
  count: number;
  spawn: string;
}

export interface DungeonWave {
  spawns: DungeonSpawn[];
}

export interface DungeonDef {
  id: string;
  name: string;
  chapter_id: string;
  /** 副本地图 */
  map_ref: string;
  /** 解锁条件：通关哪一幕（对应 achievements 里的 act_cleared_xxx） */
  unlock_act: string;
  recommended_level: number;
  desc: string;
  waves: DungeonWave[];
  boss: string | null;
  boss_extra?: string[];
  /** 本副本的品质权重（覆盖 drops.json 的通用值） */
  quality_weights: Record<Quality, number>;
  /** 首通必掉的独特装备 */
  unique_drop: string | null;
}

/** 单个副本的持久化进度 */
export interface DungeonState {
  /** 通关次数 */
  clears: number;
  /** 连续多少次没出紫装（用于保底） */
  missPurple: number;
}

/* ============ 6.8.2 存档 ============ */

export interface PlayerStats {
  level: number;
  exp: number;
  hp: number;
  atk: number;
  def: number;
}

export interface SaveData {
  version: number;
  created: string;
  updated: string;
  player: PlayerStats;
  progress: {
    chapter: string;
    act: string;
    events: string[];
    nodes_done: string[];
    completion: Record<string, number>;
    /** 知识图谱里已连成的边（规范化键），跨会话保留 */
    graph?: string[];
    /**
     * 清王朝的「血条」：老师要求的第一段历史总线——每一次战败、每一条不平等条约都扣它。
     * 0–100，缺省 100；贯穿鸦片战争→太平天国→洋务运动→戊戌变法→辛亥革命。
     */
    dynasty?: number;
  };
  equipment: Partial<Record<Slot, ItemInstance | null>>;
  inventory: ItemInstance[];
  bag: { slots: number; items: ItemInstance[] };
  /** 强化用零件，来自拆解装备与副本结算 */
  scrap: number;
  weapons: string[];
  skills: string[];
  knowledge: string[];
  quiz: Record<string, { best: number; passed: boolean }>;
  /** 各副本的刷取进度与保底计数 */
  dungeons: Record<string, DungeonState>;
  achievements: string[];
  settings: {
    sound: number;
    music: number;
    rhythmSlow: boolean;
    colorblind: boolean;
  };
}