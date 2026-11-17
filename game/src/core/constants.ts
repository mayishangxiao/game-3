/**
 * 《党史像素 RPG》全局常量
 * 依据《完整设计书 v2.0》6.1.1 操作布局、8.1 调色板、8.2 图集与瓦片规范
 */

/** 内部分辨率（16:9），整数倍放大 */
export const VIEW_W = 480;
export const VIEW_H = 270;

/**
 * 近 / 远程武器的分界射程（世界像素）。
 *
 * 原来 60 这个数在 `playerAttack`（命中形态）、`weaponSwap`（面板文案）、
 * 波次强化（类别判定）里各写一遍，加近战武器时漏改一处就会出现
 * 「面板写近战、实际按远程发射」这类错。统一到这一个常量：
 * `range <= 60` → 近战扇形判定；`range > 60` → 投射物。
 */
export const MELEE_RANGE_MAX = 60;

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

/**
 * 剧情 NPC 小人的脚底相对「格中心」的偏移：`spawnWorldObject()` 把 24×32 贴图
 * 以 `origin(0.5, 1)` 放在 `(格心 x, 格心 y + 8)`，也就是脚踩在格心下方半格。
 * 它决定人物包围盒的上沿（脚底 - CHAR_H），改这里要同步 `tests/humenPool.test.ts`。
 */
export const NPC_FOOT_OFFSET_Y = 8;

/** 战场区格数 */
export const FIELD_COLS = VIEW_W / TILE; // 30
export const FIELD_ROWS = FIELD_H / TILE; // 16

/**
 * 虎门销烟池：全场唯一的那一个长方体，7 × 4 格。
 *
 * v1.8.8 之前是「两个长方体」：地面层 6/7 瓦片画了一块木框石灰池（7×4），
 * `obj_pool` 又在池子下方另画了一个 40×26 的小池，玩家看着像两个池子。
 * 现在地面装饰已删除，只剩 `obj_pool` 画的这一个；尺寸与碰撞层那 28 个
 * 6/7 实心格严格对齐（x=15..21, y=8..11），中心即 `obj_pool` 的格坐标。
 * 改这里要同步 `map_ch00_act1a.json` 的碰撞层与 `tests/humenPool.test.ts`。
 */
export const HUMEN_POOL = {
  cols: 7,
  rows: 4,
  w: 7 * TILE,
  h: 4 * TILE,
} as const;

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
  /** 暂停面板：canvas 世界内的最上层（DOM 里另有更高的 #dom-pause-screen） */
  pause: 120,
} as const;

/**
 * DOM 层内部分层（都在 `#dom-ui` 里，数值越大越靠上）。
 *
 * 以前 `#dom-dialogue` 与 `#dom-hud` 只靠 DOM 先后顺序叠，暂停面板画在 UIScene 的
 * canvas 上，结果被 94% 不透明的对白底板盖住半截（甲方截图「音效/返回主菜单被挡」）。
 * 现在按用途固定：对白 < HUD/情境卡 < 暂停，暂停层自己吃点击和键盘，绝不穿透。
 *
 * 系统层不在这里：横屏提示 200 / 旋转按钮 250 / 点入闸 300 在 `#game-root` 之外，
 * 本来就压在所有游戏界面之上，不应该被游戏内的暂停盖掉。
 */
export const DOM_Z = {
  dialogue: 20,
  hud: 30,
  /** HUD 盒内的次级顺序：顶部按钮 < toast < 情境卡/面板 */
  hudButtons: 1,
  toast: 2,
  overlay: 3,
  /** 游戏内最高层：全屏、pointer-events:auto */
  pause: 100,
} as const;

/**
 * 站着的人物（玩家 / 敌人 / 剧情 NPC）统一按脚底 y 排序的深度。
 *
 * 静态布景一律在 `DEPTH.deco + N`（10—13），所以人物永远不会被池水、白沫、
 * 池沿之类的装饰盖住；人物彼此之间仍按 y 正确地前后遮挡。
 * v1.8.9 之前 NPC 小人用 `DEPTH.deco + 1`(11)，站在销烟池边时被 12/13 的
 * 池水与池沿盖掉整个头。与 `Player` / `Enemy` / `CharacterRig` 里的
 * `20 + y * 0.01` 是同一条公式，这里收成唯一真值。
 */
export const entityDepth = (footY: number): number => DEPTH.entityBase + footY * 0.01;

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
  /**
   * 闪避键从 (440,244) 上移到 (452,228)（2026-11-14「右侧被遮挡的按键」）。
   *
   * 旧位置视觉圆下缘 262 已压进底部 HUD 条（HUD 顶边 = 256），命中区下缘正好贴
   * 画布底 270；扁视口下「闪」下半直接被裁掉。新位置视觉下缘 246，离 HUD 10px。
   *
   * x 同时右移 12 不是随手调的：attack(404,192) 命中半径 26+8=34，dodge 命中半径
   * 18+8=26，圆心距 √((452-404)²+(228-192)²)=60 = 34+26 —— 两命中区**恰好外切**。
   * 只上移不右移会让它们重叠 8~10px，`pick()` 按注册顺序先判 attack，点「闪」
   * 左上沿就会变成普通攻击。CONTROL_LAYOUT 是视觉、命中和数据测试的共享真值，
   * 改这一处三者同步。
   */
  dodge: { x: 452, y: 228, r: 18 },
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
  /**
   * 第三幕敌方「吉野号」6 帧：同规格 96×48、同一套 SHIP_FRAME 语义。
   * v2.6 从「松岛舰」换成吉野号 —— 致远最后要撞的是第一游击队旗舰吉野，
   * 松岛那门 320mm 巨炮会把「火力 / 航速 / 舰龄」三项对比全画反。
   * 吉野是 4150 吨 / 23 节的新式防护巡洋舰：飞剪艏、双烟囱、11 门带盾速射炮、
   * 两座 152mm 炮塔、日章旗。
   */
  yoshinoFrames: [
    `${ART_ROOT}/ship/yoshino_00.png`,
    `${ART_ROOT}/ship/yoshino_01.png`,
    `${ART_ROOT}/ship/yoshino_02.png`,
    `${ART_ROOT}/ship/yoshino_03.png`,
    `${ART_ROOT}/ship/yoshino_04.png`,
    `${ART_ROOT}/ship/yoshino_05.png`,
  ],
  /**
   * 第三幕我方「致远舰」3 帧（0 完整 / 1 带伤 / 2 冲刺）：2300 吨 / 18 节，
   * 短一截的旧式圆艏、单烟囱、7 门裸露旧炮、黄龙旗。
   * 用在开场「双舰对照」卡、战场远景与我方舰影、结算「致远撞向吉野」演出。
   */
  zhiyuanFrames: [
    `${ART_ROOT}/ship/zhiyuan_00.png`,
    `${ART_ROOT}/ship/zhiyuan_01.png`,
    `${ART_ROOT}/ship/zhiyuan_02.png`,
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
  /**
   * 1864 天京陷落（城破之战）专用远景条：480×64，火光四起 / 战火映照 / 浓烟弥漫。
   * 只在 `tileset === TP_TILESET_ID` 且 `sky_rows > 0` 的关卡启用（当前仅城破之战），
   * 其余关卡仍走 `bgStripDusk` 默认分支。由 `tools/gen_tianjing_fall_bg.py` 从
   * `tools/_art_in/tianjing_fall_src.png` 生成，锁 24 色盘、顶部压暗保 HUD 可读。
   */
  bgStripTianjingFall: `${ART_ROOT}/bg/bg_strip_tianjing_fall.png`,
  /**
   * 第三幕（洋务 / 甲午）专用战时远景条：480×64，铅灰浓云 + 蒸汽铁甲舰剪影
   * （烟囱 / 桅杆 / 炮塔，**不是帆船**）+ 煤烟硝烟 + 中弹火光。
   * 由 `tools/gen_jiawu_sky.py` 纯标准库生成，锁 24 色盘、顶部压暗保 HUD 可读。
   * 甲方要求「背景贴合洋务运动时期，肃杀黑暗、体现战斗的危险」——旧的
   * `bgStripDusk` 是淡紫黄昏 + 黄帆船，年代与氛围都不对。
   */
  bgStripJiawu: `${ART_ROOT}/bg/bg_strip_jiawu.png`,
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
  /**
   * 黄海海战（第三幕 1894.9）瓦片图集：8 列 × 4 行，每格 16×16，id 0 为透明。
   * 海面 / 甲板 / 舷墙 / 舰炮 / 海面杂物，由 `tools/gen_sea_tiles.py` 纯标准库生成。
   * 与 tp_act2 同一套取帧规则（`col = id % 8`），但**不共享纹理**：
   * 一张图集管一个场景，换图/回退互不影响。
   */
  seaSheet: `${ART_ROOT}/tiles/sea/tp_sea_sheet.png`,
  /**
   * 洋务运动及之后（1861—1912）瓦片图集：8 列 × 5 行，每格 16×16，id 0 为透明。
   * 青砖巷 / 灰瓦门楼 / 机器厂房 / 近代街景，由 `tools/gen_late_qing_tiles.py` 生成，
   * 供江南制造总局、北京南海会馆、武昌总督衙门三张地图共用。
   * 这三张图原来全复用第二幕（太平天国）的 `tp_act2` 天京城，草坡山林和机器局对不上年代。
   */
  lateQingSheet: `${ART_ROOT}/tiles/late_qing/tp_late_qing_sheet.png`,
} as const;

/** 太平天国图集的运行时开关常量（纯字符串/数字，core 层不依赖 Phaser） */
export const TP_TILESET_ID = 'tp_act2';
export const TP_SHEET_TEX = 'tp_act2_sheet';
export const TP_SHEET_COLS = 8;

/**
 * 海战图集的运行时开关常量。
 *
 * 为什么不复用 `TP_*`：两张图集的瓦片 id 语义完全不同（tp 的 10 是护城河，
 * sea 的 10 是甲板舷墙），共用一个常量就会出现「地图写着 sea、渲染按 tp 取帧」
 * 这种错位，表现是一片乱码地砖而不是黑屏，极难在截图里看出来。
 */
export const SEA_TILESET_ID = 'tp_sea';
export const SEA_SHEET_TEX = 'tp_sea_sheet';
export const SEA_SHEET_COLS = 8;

/** 晚清近代（第三～五幕陆地地图）图集的运行时开关；同样不复用 `TP_*`。 */
export const LQ_TILESET_ID = 'tp_late_qing';
export const LQ_SHEET_TEX = 'tp_late_qing_sheet';
export const LQ_SHEET_COLS = 8;

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
  /** 1864 天京城破之战专用远景条；缺图时由 horizonImage 自动回退到 horizonDusk */
  horizonCityFall: 'art_bg_strip_tianjing_fall',
  /** 第三幕洋务 / 甲午战时阴云远景条；缺图回退 horizonDusk */
  horizonJiawu: 'art_bg_strip_jiawu',
  skyDusk: 'art_bg_sky_dusk',
} as const;

/**
 * 第三幕（洋务 / 甲午）战场氛围 —— 甲方要求「肃杀、黑暗、体现战斗的危险」。
 *
 * 为什么不直接改瓦片：上一轮刚把海面瓦片的近黑短划清干净（甲方投诉「全是黑点」），
 * 黑暗感必须靠**大面积平滑的冷调与暗角**做，不能往地面撒噪点。这三层的深度都在
 * `DEPTH.vignette`（99）附近：压住地面与实体，但 `DEPTH.hud`（100）与 DOM 文字层
 * 在其上，所以血条、摇杆、战役条白字一律不受影响，中心区的小人也仍看得清。
 *
 * 只有 `acts` 里登记的幕启用；其它四幕画面一个像素都不变。
 */
export const WAR_ATMOSPHERE = {
  /** 启用氛围的幕 id（当前只有第三幕：江南制造总局 + 黄海海战） */
  acts: ['ch00_act3'] as const,
  /** 全场冷调压暗：把暖木甲板 / 白砖厂房压成阴冷色 */
  cool: { color: PALETTE.night, alpha: 0.22 },
  /** 径向暗角：中心 transparent → 中段微暗 → 四边沉下去 */
  vignette: { inner: 0.36, mid: 0.18, edge: 0.62 },
  /** 顶部远景带（天空 / 厂房上沿）再压一层，硝烟更沉 */
  skyShade: 0.16,
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
  // v1.9.1：第二幕与三个副本的兵种（以前没图，战斗里退回纯色方块）。
  // 全部由 `tools/gen_units.py` 程序生成，尺寸/朝向/调色板由 `tests/unitArt.test.ts` 锁住。
  xiang_army: `${ART_ROOT}/units/xiang_army`,
  xiang_rifle: `${ART_ROOT}/units/xiang_rifle`,
  bandit: `${ART_ROOT}/units/bandit`,
  bandit_chief: `${ART_ROOT}/units/bandit_chief`,
  bandit_crossbow: `${ART_ROOT}/units/bandit_crossbow`,
  patrol: `${ART_ROOT}/units/patrol`,
  dock_boss: `${ART_ROOT}/units/dock_boss`,
  informant: `${ART_ROOT}/units/informant`,
  overseer: `${ART_ROOT}/units/overseer`,
  thug: `${ART_ROOT}/units/thug`,
  qing_cavalry: `${ART_ROOT}/units/qing_cavalry`,
  uk_officer: `${ART_ROOT}/units/uk_officer`,
  // v2.0（洋务/戊戌/辛亥三幕）：日军步兵与大尉
  jp_infantry: `${ART_ROOT}/units/jp_infantry`,
  jp_officer: `${ART_ROOT}/units/jp_officer`,
};

/**
 * 敌人 id → 兵种贴图。没登记的一律用英军步兵（红衣服至少能看出是敌军），
 * 清军系（湘军/绿营/马队/把总）统一用清军小人。
 */
export function unitArtOf(enemyId: string): string {
  // v1.9.1 起每个敌兵都有自己的脸：以前 `en_bandit` / `en_thug` / `en_concession_patrol`
  // 这些第二幕角色统统落到 `uk_infantry`（一身红衣），在战场上和英军分不出来。
  // 判据在 `tests/unitArt.test.ts`：数据里出现的每个敌人 id 都必须映射到**存在**的兵种。
  switch (enemyId) {
    case 'en_gough':
      return 'gough';
    case 'en_uk_officer':
      return 'uk_officer';
    case 'en_uk_grenadier':
      return 'uk_grenadier';
    case 'en_qing_batou':
      return 'qing_batou';
    case 'en_qing_cavalry':
      return 'qing_cavalry';
    case 'en_boss_xiangarmy_a':
      return 'xiang_army';
    case 'en_boss_xiangarmy_b':
      return 'xiang_rifle';
    case 'en_bandit':
      return 'bandit';
    case 'en_boss_bandit_chief':
      return 'bandit_chief';
    case 'en_bandit_crossbow':
      return 'bandit_crossbow';
    case 'en_concession_patrol':
      return 'patrol';
    case 'en_elite_dock':
      return 'dock_boss';
    case 'en_elite_informant':
      return 'informant';
    case 'en_factory_overseer':
      return 'overseer';
    case 'en_gang_thug':
    case 'en_thug':
      return 'thug';
    case 'en_boss_steamfrigate':
      return 'uk_infantry';
    // 甲午（第三幕）与辛亥革命（第五幕）的兵种
    case 'en_jp_infantry':
      return 'jp_infantry';
    case 'en_jp_officer':
    // 吉野号是 ship body，实体本身走 YOSHINO_TEX，这个映射只保证「万一退回小人」
    // 也是一身日军军官的皮，而不是默认的英军步兵（历史上最不该出现的错）。
    case 'en_boss_jp_yoshino':
      return 'jp_officer';
    case 'en_boss_qing_zhitong':
      return 'qing_batou';
    default:
      break;
  }
  if (enemyId.startsWith('en_qing')) return 'qing_green';
  return 'uk_infantry';
}

/** 所有兵种贴图 key（预载与测试共用一份，防止漏图） */
export const UNIT_KEYS = Object.keys(UNIT_ART);

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

/** 吉野号 6 帧的纹理 key（与 ART.yoshinoFrames 一一对应） */
export const YOSHINO_TEX = ART.yoshinoFrames.map((_, i) => `ship_yoshino_${i}`);

/** 致远舰 3 帧的纹理 key（与 ART.zhiyuanFrames 一一对应） */
export const ZHIYUAN_TEX = ART.zhiyuanFrames.map((_, i) => `ship_zhiyuan_${i}`);

/**
 * `body:'ship'` 的敌人按 `ship_art` 选帧集：第一幕英舰走 steamfrigate，
 * 第三幕吉野号走 yoshino。两套都是 6 帧 / 96×48 / 同一套 SHIP_FRAME 语义，
 * 未登记或拼错一律回落英舰帧，绝不出现空贴图。
 *
 * `zhiyuan` **不在**这张表里：致远是我方舰，不是敌人，不会由 `CharacterRig`
 * 驱动 SHIP_FRAME 状态机；它由 `LevelScene` 直接以静态 Image / 演出精灵使用。
 */
export const SHIP_ART_SETS: Record<string, readonly string[]> = {
  steamfrigate: SHIP_TEX,
  yoshino: YOSHINO_TEX,
};

/** 纹理 key：鸦片箱 */
export const TEX_CRATE = 'prop_opium_chest';

/** 移动端视口抖动处理时的节流（ms） */
export const RESIZE_THROTTLE = 120;