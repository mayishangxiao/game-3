/**
 * 《党史像素 RPG》全局常量
 * 依据《完整设计书 v2.0》6.1.1 操作布局、8.1 调色板、8.2 图集与瓦片规范
 */

/** 内部分辨率（16:9），整数倍放大 */
export const VIEW_W = 480;
export const VIEW_H = 270;

/**
 * 渲染超采样倍数 —— 后缓冲实际是 `GAME_W × GAME_H`，不是 480×270。
 *
 * 为什么必须这么做（实测，不是推测）：
 *   Phaser 3.90 的 `ScaleManager` 直接把 `canvas.width` 设成 config 里的宽高
 *   （`phaser.js` 里没有任何 `resolution` / `autoDensity` 处理），
 *   `scale.zoom` 只改 CSS 显示尺寸，**不会改后缓冲**。
 *   于是在 dpr=3 的手机上，画布永远只有 480×270 个物理像素，浏览器再把它拉到
 *   2079×1170 铺满屏幕——放大 4.33 倍，9px 的中文必然糊成一团。
 *   `TextStyle.TEXT_RESOLUTION` 的 3 倍栅格因此完全白费：字是高清的，
 *   画到 480 宽的小画布上就被压没了。
 *
 * 做法：把后缓冲放大 R 倍，然后**每个场景的摄像机 `setZoom(R)`**。
 * 场景内部的逻辑坐标仍然是 480×270（所有 Text/Graphics 一行不用改），
 * 只是 1 个逻辑像素 = R 个后缓冲像素，字最终落屏前只被缩 1.x 倍而不是 4.x 倍。
 *
 * R 取「屏幕上一个逻辑像素实际占几个物理像素」并**四舍五入**，再被两道闸夹住：
 *   1) 硬上限 5（字已经和物理像素基本一一对应，再高只是浪费）；
 *   2) 后缓冲总像素预算 `MAX_BUFFER_PIXELS`，防止平板/大屏把填充率打爆。
 * 手机横屏 844×390 @dpr3 → 390*3/270 = 4.33 → R=4（1920×1080，约 2.07M 像素）；
 * 桌面 1280×720 @dpr1 → 720/270 = 2.67 → 3（1440×810）；
 * 低端机/小窗 → 1（等于不超采样，绝不比现在更差）。
 * 只在前端算，node 里的测试环境拿不到 window，回落到 1。
 *
 * **为什么是四舍五入而不是上取整（实测，两次翻车）**：
 *  - 向下取整不行：R 小于「设备像素/逻辑像素」时，浏览器要把后缓冲**放大**铺屏，
 *    整屏（包括已经按高清栅格画好的中文）一起发虚。之前封顶 3 就是死在这一步——
 *    手机真实需要 4.33，留了 1.44 倍放大，甲方说「文字不清晰」。
 *  - 向上取整也不行：`ceil(4.33)=5` → 2400×1350 = 3.24M 像素，比屏幕本身还大，
 *    同一台机器实测战斗帧率 51 → 29。取 4 只留 1.08 倍放大，肉眼看不出，
 *    像素却少画三分之一。
 */

/** 后缓冲像素预算：超过这个数就降 R（低端 GPU 填充率优先） */
/**
 * 后缓冲像素预算。超采样是**平方级**代价：R 翻倍 = 要画的像素翻四倍，
 * 手机 GPU 的填充率和显存都吃这一项，所以按总面积倒推一个最大倍数。
 * 2.2 MP ≈ 1920×1080，正好覆盖 iPhone 15 Pro 横屏的物理像素（2080×1170）。
 */
const MAX_BUFFER_PIXELS = 2_200_000;

function pickRenderScale(): number {
  if (typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio || 1;
  const vw = window.innerWidth || VIEW_W;
  const vh = window.innerHeight || VIEW_H;
  // FIT 模式下画布按比例撑满视口，取宽高比更受限的那一边
  const cssH = Math.min(vh, (vw * VIEW_H) / VIEW_W);
  const need = (cssH * dpr) / VIEW_H;
  // 用 round 而不是 ceil（实测）：iPhone 15 Pro 横屏 need=4.78，
  // `ceil` 给 5 → 后缓冲 2400×1350 = 324 万像素，比屏幕本身还大，白白多画三分之一，
  // 同一台机器上战斗帧率从 51 掉到 29。
  // `round` 给 4 → 1920×1080 = 207 万，浏览器只把画布放大 1.08 倍，肉眼已看不出糊。
  return Math.max(1, Math.min(5, Math.round(need), Math.floor(Math.sqrt(MAX_BUFFER_PIXELS / (VIEW_W * VIEW_H)))));
}

export let RENDER_SCALE = pickRenderScale();

/** 后缓冲尺寸（= 摄像机的视口尺寸）。注意：游戏逻辑坐标仍然是 VIEW_W × VIEW_H */
export let GAME_W = VIEW_W * RENDER_SCALE;
export let GAME_H = VIEW_H * RENDER_SCALE;

/**
 * 视口变了之后重算超采样倍数。返回 true 表示真的变了，调用方要按新的
 * `GAME_W/GAME_H` 调整后缓冲并给所有摄像机重新 setZoom。
 * 这三个是 `export let`（ESM 活绑定）：`boot.ts` / `InputSystem` / `OrientationGate` /
 * `DefeatCinematic` 运行时读到的都是最新值，不用各自再算一遍。
 */
export function refreshRenderScale(): boolean {
  const next = pickRenderScale();
  if (next === RENDER_SCALE) return false;
  RENDER_SCALE = next;
  GAME_W = VIEW_W * next;
  GAME_H = VIEW_H * next;
  return true;
}


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

/** 24 色锁定调色板 v2（户外明亮版，2026-11）
 *  key名保持不变以兼容现有代码；色值已更新为星露谷风明亮户外色盘。
 *  设计书 design/10_art_spec_opium.md 第5节为唯一色盘表。
 */
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
  red: 0xc0392b,
  redBright: 0xe85c4a,
  redSoft: 0xf2a08c,
  greenDark: 0x4a7a2e,   // 深草绿（原墨绿）
  green: 0x7ba84a,       // 草绿主色（原军绿）
  greenLight: 0xa8d070,  // 亮草绿（原浅绿）
  indigo: 0x2a5a8a,      // 深海蓝（原深靛）
  blue: 0x4a90c8,        // 中海蓝（原中蓝）
  blueLight: 0x7bc0e8,   // 浪花蓝（原浅蓝）
  star: 0xd4a840,        // 金黄（原星黄，官服装饰用）
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
  /**
   * 甲方 m12276 再给的那张「黄昏海面 · 双舰冒烟」全景裁出来的远景条（480×64）。
   *
   * 和 `bgStripNight` 的区别：这张的舰影更密、海平线更低、上下沿做了羽化，
   * 叠在瓦片顶上不会出现一条硬色带。竖屏手机上方留白处就用它。
   */
  bgStripDusk: `${ART_ROOT}/bg/bg_strip_dusk.png`,
  /** 同一张全景的天空段（480×128），给开场情境卡当底图 */
  bgSkyDusk: `${ART_ROOT}/bg/bg_sky_dusk.png`,
  /** 地面残破贴花目录前缀（scar_00.png…scar_11.png，逐个按 0.5 缩放进地面纹理） */
  scars: `${ART_ROOT}/scars/`,
  /** 甲方给的炮火特效（金闪 → 爆开 → 火球 → 烟散）逐帧目录前缀，见 `FX_TEX` */
  fxCannonBlast: `${ART_ROOT}/fx/cannon_blast/`,
  /** 甲方给的围观百姓小图目录（door_0.png …），每种 6×13 像素、放大 3 倍显示，见 `CROWD_TEX` */
  crowd: `${ART_ROOT}/crowd/`,
  /** Sunny Land 场景道具目录（CC0 / Pixel Frog），文件名见 `SUNNY_PROPS` */
  sunnyProps: `${ART_ROOT}/props/`,
  /**
   * 太平天国篇章瓦片图集：8 列 × 5 行，每格 16×16，id 0 为透明。
   * `MapRenderer` 在 `tileset === TP_TILESET_ID` 时按 `sheet_cell` 取帧；
   * 图没加载到位就自动回退到 `tile_colors` 的程序化材质，不会黑屏。
   * 详见 `design/12_taiping_tilemap_spec.md` 第 8 节。
   */
  tpSheet: `${ART_ROOT}/tiles/tp/tp_act2_sheet.png`,
} as const;

/** 太平天国图集的运行时开关常量（纯字符串/数字，core 层不依赖 Phaser） */
export const TP_TILESET_ID = 'tp_act2';
export const TP_SHEET_TEX = 'tp_act2_sheet';
export const TP_SHEET_COLS = 8;

/**
 * Sunny Land（CC0 1.0 / Pixel Frog）的场景道具：木箱、石墩、门、灌木、枯骨、路牌…
 *
 * 用来替掉「`kind:'prop'` 但 payload 不是 door_N 的物件一律画成 12×12 色块」的占位。
 * 像素图**不做任何缩放**：文件里就是 16/22/32 px 的原尺寸，缩放只会糊；
 * 尺寸由 `tests/art.test.ts` 逐个钉死（改了图没改表会直接红）。
 * 来源与许可见 `art_ref/art_credits.json`，导入脚本 `art_ref/import_sunny_props.py`。
 */
export const SUNNY_PROPS = {
  crate: { file: 'sunny_crate.png', w: 16, h: 16 },
  bigCrate: { file: 'sunny_big_crate.png', w: 32, h: 32 },
  block: { file: 'sunny_block.png', w: 16, h: 16 },
  blockBig: { file: 'sunny_block_big.png', w: 32, h: 32 },
  door: { file: 'sunny_door.png', w: 22, h: 33 },
  doorOpened: { file: 'sunny_door_opened.png', w: 22, h: 33 },
  rock: { file: 'sunny_rock.png', w: 28, h: 15 },
  bush: { file: 'sunny_bush.png', w: 46, h: 28 },
  skulls: { file: 'sunny_skulls.png', w: 16, h: 10 },
  spikeSkull: { file: 'sunny_spike_skull.png', w: 17, h: 12 },
  sign: { file: 'sunny_sign.png', w: 18, h: 20 },
  shrooms: { file: 'sunny_shrooms.png', w: 16, h: 15 },
  spikes: { file: 'sunny_spikes.png', w: 15, h: 10 },
} as const;

export type SunnyProp = keyof typeof SUNNY_PROPS;

/** 纹理 key：`sunny_<道具名>`（预加载与摆放共用，防止拼错 key 后静默不显示） */
export function sunnyPropKey(name: SunnyProp): string {
  return `sunny_${name}`;
}

/**
 * 沉进地面的道具：底色偏暗、会被地砖盖掉一半，摆放时下压几像素。
 *
 * `bush`/`blockBig` 不在里面——灌木和石台是立起来的，压进地面会像陷进坑里。
 */
export const SUNNY_GROUND_PROPS: ReadonlySet<SunnyProp> = new Set<SunnyProp>([
  'rock',
  'skulls',
  'spikeSkull',
  'shrooms',
  'spikes',
  'sign',
]);

/**
 * 围观百姓：虎门销烟现场的看热闹人群（甲方 m11885 给的 5 个小人）。
 *
 * 原图是 480×96 的条带，5 个 6×12 的像素小人（放大 6 倍画上去的），
 * 用 `tools/import_crowd.py` 按像素网格还原回 6×12 的原始大小再落盘。
 * 为什么还原：6×12 放大 3 倍 = 18×36，和玩家小人（24×32）同一量级；
 * 直接按原图 36×72 摆进 480×270 的战场会把路堵死。
 *
 * 数组顺序就是素材编号：`door_0.png` … `door_4.png`。
 */
export const CROWD_TEX = {
  /** 蓝布短褂（前排看客） */
  blue: 'crowd_blue',
  /** 灰布长衫（后排） */
  grey: 'crowd_grey',
  /** 白布巾 + 棕褐长衫（脖子上搭着汗巾） */
  scarf: 'crowd_scarf',
  /** 矮一个头的小孩（站最前面，别被挡住） */
  boy: 'crowd_boy',
  /** 藕荷色衣裙的妇人 */
  woman: 'crowd_woman',
} as const;

/** 围观百姓的显示放大倍数：6×12 → 18×36 */
export const CROWD_SCALE = 3;

/**
 * 炮火特效帧：`public/art/fx/cannon_blast/fx_00.png … fx_47.png`（每帧 96×96）。
 *
 * 来源是甲方的一段 GIF（57 帧 / 40ms 一帧），用 `tools/import_fx.py` 拆出来：
 * 统一缩放 0.478 倍 + 逐帧把不透明包围盒居中。别手工往这个目录塞帧，
 * 帧数一变就要同步这里和 `FX_FRAME_MS`（`tests/art.test.ts` 会逐个查文件存在）。
 */
export const FX_TEX = {
  cannonBlast: 'fx_cannon_blast',
} as const;

/** 炮火特效共几帧（与 `FX_DIR` 里的文件数一致） */
export const FX_CANNON_FRAMES = 48;

/** 每帧显示时长：源 GIF 是 40ms，游戏里放慢到 45ms —— 爆炸全流程约 2.2 秒，足够看清又不拖节奏 */
export const FX_FRAME_MS = 45;

/** 爆炸特效绘制时的深度（`gfx/Depth.ts` 的 fx 层：压在人身上、浮在地面上） */
export const FX_TEX_SIZE = 96;

/** 背景贴图的纹理 key（Backdrop 优先用它们，缺图自动退回程序化绘制） */
export const BG_TEX = {
  intro: 'art_bg_sea_red',
  horizon: 'art_bg_strip_night',
  horizonAlt: 'art_bg_strip_red',
  /** 甲方 m12276 的黄昏全景：远景条 + 天空段，战斗关卡优先用它 */
  horizonDusk: 'art_bg_strip_dusk',
  skyDusk: 'art_bg_sky_dusk',
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