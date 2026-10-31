/**
 * 《党史像素 RPG》全局常量
 * 依据《完整设计书 v2.0》6.1.1 操作布局、8.1 调色板、8.2 图集与瓦片规范
 */

/** 内部分辨率（16:9），整数倍放大 */
export const VIEW_W = 480;
export const VIEW_H = 270;

/** 战场区（30 × 16 瓦片），底部 14px 归 HUD */
export const FIELD_H = 256;
export const HUD_H = VIEW_H - FIELD_H;

/** 瓦片与角色尺寸 */
export const TILE = 16;
export const CHAR_W = 24;
export const CHAR_H = 32;

/** 战场区格数 */
export const FIELD_COLS = VIEW_W / TILE; // 30
export const FIELD_ROWS = FIELD_H / TILE; // 16

/** 24 色锁定调色板（设计书 8.1） */
export const PALETTE = {
  ink: 0x0d0b14,
  night: 0x1c1a2b,
  plumDark: 0x2f2b45,
  plumMid: 0x4a4468,
  plumLight: 0x6b6489,
  greyPlum: 0x948dab,
  greyLight: 0xc2bcd1,
  paper: 0xf2ede4,
  cream: 0xe8cfa8,
  sand: 0xcfa26a,
  brown: 0xa8763f,
  brownDark: 0x7a4f2a,
  brownDeep: 0x4e2f1a,
  redDark: 0x8c1c1c,
  red: 0xc62828,
  redBright: 0xe85c4a,
  redSoft: 0xf2a08c,
  greenDark: 0x1f5c3a,
  green: 0x2f8f5b,
  greenLight: 0x7ec08a,
  indigo: 0x1b3a6b,
  blue: 0x2f6ba8,
  blueLight: 0x7fb2d9,
  star: 0xf0c419,
} as const;

/** 调色板色值数组，供「硬阴影也必须落在 24 色内」的取色使用 */
export const PALETTE_LIST: number[] = Object.values(PALETTE);

function lum(c: number): number {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function dist2(a: number, b: number): number {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff);
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff);
  const db = (a & 0xff) - (b & 0xff);
  return dr * dr + dg * dg + db * db;
}

/**
 * 取「同色相的下两档 / 上两档」。
 * 设计书 8.1.2 要求阴影不用半透明、不用任意新色，只在 24 色内做硬阴影，
 * 因此这里从调色板里挑一个更暗/更亮且色相最接近的颜色，而不是做数值加减。
 */
export function darkerOf(color: number): number {
  const base = lum(color);
  let best = color;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const p of PALETTE_LIST) {
    const l = lum(p);
    if (l >= base - 1) continue;
    const score = dist2(p, color) + (base - l) * 60;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export function lighterOf(color: number): number {
  const base = lum(color);
  let best = color;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const p of PALETTE_LIST) {
    const l = lum(p);
    if (l <= base + 1) continue;
    const score = dist2(p, color) + (l - base) * 60;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** 品质配色（设计书 8.1.1：紫由两色 + 描边组合，不新增色号） */
export const QUALITY_COLORS = {
  white: { base: PALETTE.greyLight, hi: PALETTE.paper, outline: PALETTE.plumLight },
  blue: { base: PALETTE.blue, hi: PALETTE.blueLight, outline: PALETTE.indigo },
  purple: { base: PALETTE.plumMid, hi: PALETTE.greyPlum, outline: PALETTE.ink },
} as const;

/** 渲染层级 */
export const DEPTH = {
  ground: 0,
  deco: 10,
  shadow: 15,
  /** 实体按 y 排序，落在 20—80 之间 */
  entityBase: 20,
  projectile: 90,
  fx: 95,
  foreground: 98,
  vignette: 99,
  hud: 100,
  overlay: 110,
} as const;

/** 存档键名与版本 */
export const SAVE_KEY = 'dsp_save_v1';
export const SAVE_VERSION = 1;

/**
 * 屏幕控件占位（设计书 6.1.1）。放在纯逻辑层，是因为「地图上的可交互物不能摆到按钮底下」
 * 这条约束要在 node 环境的 data.test.ts 里断言——手机上被按钮盖住的箱子，玩家根本找不到。
 * 坐标是 480×270 内部坐标系的屏幕坐标（控件带 setScrollFactor(0)）。
 */
export const CONTROL_LAYOUT = {
  stick: { x: 56, y: 200, r: 34 },
  attack: { x: 404, y: 192, r: 26 },
  /**
   * 虎门重炮：只有配了炮的关卡才显示（`node.params.cannon === true`）。
   * 位置从原来的 (348,238) 挪到 (330,222)——去掉「技」之后这里空出一块，
   * 炮离「攻」远一点，拇指横扫时不会误触。
   */
  cannon: { x: 330, y: 222, r: 24 },
  dodge: { x: 440, y: 244, r: 18 },
  interact: { x: 240, y: 240, r: 18 },
} as const;

/** 可点区域比视觉尺寸外扩的像素（设计书 6.1.1 移动端要点） */
export const CONTROL_HIT_PAD = 8;

/** 数据根路径（vite public 目录） */
export const DATA_ROOT = 'data';

/**
 * 正式美术资源（第一批：Boss 舰、鸦片箱、林则徐立绘）。
 *
 * 路径写在纯逻辑层而不是散在场景里，是因为 `tests/art.test.ts` 要在 node 环境里
 * 逐个 `fs.existsSync` + 读 PNG 头部的宽高——资源路径打错在浏览器里只表现为「不显示」，
 * 极难在截图里发现。注意 public/ 下的路径不带 `public` 前缀。
 */
const ART_ROOT = 'art';

export const ART = {
  /** Boss 蒸汽炮舰 6 帧：0 待机 / 1 后坐 / 2 冒烟 / 3 舷炮齐射 / 4 破损 A / 5 破损 B */
  shipBossFrames: [
    `${ART_ROOT}/ship/boss_steamfrigate_00.png`,
    `${ART_ROOT}/ship/boss_steamfrigate_01.png`,
    `${ART_ROOT}/ship/boss_steamfrigate_02.png`,
    `${ART_ROOT}/ship/boss_steamfrigate_03.png`,
    `${ART_ROOT}/ship/boss_steamfrigate_04.png`,
    `${ART_ROOT}/ship/boss_steamfrigate_05.png`,
  ],
  /** 鸦片箱 20×20（地图可捡物） */
  crate: `${ART_ROOT}/props/opium_chest.png`,
  /** 林则徐立绘 96×112（config.json → ui.portraits 引用）；全部立绘都是「只要头」的胸像 */
  portraitLinZexu: `${ART_ROOT}/portrait_lin_zexu.png`,
  /** 关天培立绘 96×112（用户 m05506 要求恢复原稿） */
  portraitGuanTianpei: `${ART_ROOT}/portrait_guan_tianpei.png`,
  /** 甲方给的全景海战图：480×270（原图 960×540 减半），用作开场情境卡底图 */
  bgSeaRed: `${ART_ROOT}/bg/bg_sea_red.png`,
  /** 从全景里裁出来的远景条：480×64（天空下沿 + 舰影 + 水线），战场顶部那条带 */
  bgStripNight: `${ART_ROOT}/bg/bg_strip_night.png`,
  bgStripRed: `${ART_ROOT}/bg/bg_strip_red.png`,
  /** 地面残破贴花目录前缀（scar_00.png…scar_11.png，逐个按 0.5 缩放进地面纹理） */
  scars: `${ART_ROOT}/scars/`,
} as const;

/** 背景贴图的纹理 key（Backdrop 优先用它们，缺图自动退回程序化绘制） */
export const BG_TEX = {
  intro: 'art_bg_sea_red',
  horizon: 'art_bg_strip_night',
  horizonAlt: 'art_bg_strip_red',
} as const;

/**
 * 远景条占几行瓦片（= 地图 `sky_rows`，= `Backdrop.HORIZON_H / 16`）。
 *
 * 一处写死会被三处用到：`Backdrop.HORIZON_H`、地图数据的 `sky_rows`、`tests/art.test.ts`。
 * 改这个数必须同步重跑 `tools/gen_strips.py`（它会把顶上前 N 行碰撞改成实心）。
 */
export const HORIZON_ROWS = 4;

/** 12 张残破贴花的纹理 key（顺序与 `tools/prep_art_assets.py` 的输出一致） */
export const SCAR_TEX = [
  'scar_00',
  'scar_01',
  'scar_02',
  'scar_03',
  'scar_04',
  'scar_05',
  'scar_06',
  'scar_07',
  'scar_08',
  'scar_09',
  'scar_10',
  'scar_11',
] as const;

/**
 * 兵种小人贴图（24×32，四朝向：`<unit>_down|up|left|right.png`）。
 *
 * 为什么不写进数据：贴图是表现，`en_uk_infantry` 的血量攻速才是数据；
 * 换皮不该动关卡数据。缺图时 CharacterRig 自动退回矩形小人。
 */
export const UNIT_ART: Record<string, string> = {
  qing_officer: `${ART_ROOT}/units/qing_officer`,
  qing_green: `${ART_ROOT}/units/qing_green`,
  qing_batou: `${ART_ROOT}/units/qing_batou`,
  uk_infantry: `${ART_ROOT}/units/uk_infantry`,
  uk_grenadier: `${ART_ROOT}/units/uk_grenadier`,
  gough: `${ART_ROOT}/units/gough`,
  // 剧情 NPC 也用同一套小人贴图（林则徐、关天培）
  lin_zexu: `${ART_ROOT}/units/lin_zexu`,
  guan_tianpei: `${ART_ROOT}/units/guan_tianpei`,
};

/**
 * 敌人 id → 兵种贴图。没登记的一律用英军步兵（红衣服至少能看出是敌军），
 * 清军系（湘军/绿营/马队/把总）统一用清军小人。
 */
export function unitArtOf(enemyId: string): string {
  if (enemyId === 'en_gough' || enemyId === 'en_uk_officer') return 'gough';
  if (enemyId === 'en_uk_grenadier') return 'uk_grenadier';
  if (enemyId === 'en_qing_batou') return 'qing_batou';
  if (enemyId.startsWith('en_qing') || enemyId.startsWith('en_boss_xiangarmy')) return 'qing_green';
  if (enemyId === 'en_boss_steamfrigate') return 'uk_infantry';
  return 'uk_infantry';
}

/**
 * 分件小人（「积木小人」）：头 / 身 / 臂 / 腿 / 兵器 五张图，运行时按锚点拼装、按轴摆动。
 *
 * 为什么要有这一层：整张 24×32 的小人只有一张图，走路时只能整体上下浮动，
 * 甲方原话「为什么一开始的小人动作很流畅，贴上图就不行了」——就是缺可摆动的关节。
 * 图由甲方（豆包）出，`tools/import_parts.py` 抠品红底 + 切件 + 缩到目标尺寸。
 *
 * 命名：`<unit>_<front|side>_<part>.png`；四个朝向只出正/侧两种，
 * 朝左用侧面镜像，朝上用正面（帽子挡着，看不出脸）。
 */
export const PART_NAMES = ['head', 'torso', 'arm', 'leg', 'weapon'] as const;
export type PartName = (typeof PART_NAMES)[number];
export type PartFacing = 'front' | 'side';

/**
 * 哪些兵种用「积木小人」分件（头/身/臂/腿）。
 *
 * **现在是空的**：用户要求全库统一回 `art/units/` 那套整张贴图风格
 * （24×32，方头、红制服、2 头身——就是 `uk_grenadier_down.png` 那个样子），
 * 分件小人不再使用。分件机制本身完整保留：往这里填 `{ 兵种: ['head', …] }`
 * 就会自动切回可摆手的积木小人，`CharacterRig` 不用动。
 *
 * 分件图仍在 `public/art/parts/`，`import_parts.py` 也还在——只是不再加载。
 */
export const PART_ART: Record<string, PartName[]> = {};

/**
 * 兵器不走贴图，用矩形现画。
 *
 * 甲方给的分件里兵器是 18px 长、带一块 5px 金护手，斜着一挎就有半个身子高，
 * 在 24×32 的小人上像抱了根竹竿；而且各兵种长度不一，拼出来比例不齐。
 * 现画的兵器只有 2–3px 宽、11–14px 长，跟原稿的细刀一个调子，缩放也不会糊。
 */
export const WEAPON_KIND: Record<string, 'saber' | 'musket' | 'none'> = {
  qing_officer: 'saber',
  qing_green: 'saber',
  qing_batou: 'saber',
  uk_infantry: 'musket',
  uk_grenadier: 'musket',
  gough: 'saber',
  lin_zexu: 'none',
};

export const PART_ART_ROOT = `${ART_ROOT}/parts`;

/** 分件纹理 key：`<unit>_<facing>_<part>`（加载与取用共用一份，防止静默失配） */
export function partKey(unit: string, facing: PartFacing, part: PartName): string {
  return `${unit}_${facing}_${part}`;
}

/**
 * 地图上的 NPC → 兵种贴图（同样走 `art/units/<unit>_down.png`）。
 *
 * 甲方反馈「林则徐局内没有小人，只有个深蓝色方块」——NPC 以前统一画成 12×12 方块，
 * 在手机上和石头分不出来。没登记的 NPC 继续用方块兜底。
 */
export const NPC_ART: Record<string, string> = {
  obj_linzexu: 'lin_zexu',
  obj_guan_tianpei: 'guan_tianpei',
};

/** 舰船帧序号，避免到处写魔法数字 */
export const SHIP_FRAME = {
  idle: 0,
  recoil: 1,
  smoke: 2,
  broadside: 3,
  brokenA: 4,
  brokenB: 5,
} as const;

/**
 * 纹理 key 与 ART 里的帧路径一一对应。
 * 预加载和创建舰船时都用这一份，避免「加载时叫 ship_boss_0、使用时叫 boss_ship_0」这类静默失配。
 */
export const SHIP_TEX = ART.shipBossFrames.map((_, i) => `ship_boss_${i}`);

/** 纹理 key：鸦片箱 */
export const TEX_CRATE = 'prop_opium_chest';

/** 移动端视口抖动处理时的节流（ms） */
export const RESIZE_THROTTLE = 120;