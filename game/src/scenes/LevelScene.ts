/**
 * LevelScene —— 关卡场景，由 nodes JSON 驱动，一个场景承载全部玩法类型。
 *
 * 本版实现两种模式（对应设计书第三章序章第一幕）：
 *   explore —— 虎门海滩：和 NPC 对话、搬鸦片箱、投入销烟池、前往炮台
 *   combat  —— 威远炮台：三波敌军 + Boss 蒸汽炮舰
 * 另外实现两种轻量节点：cutscene（过场对话）与 choice（抉择，必选回正）。
 */

import Phaser from 'phaser';
import { ART, BG_TEX, CROWD_SCALE, CROWD_TEX, DEPTH, FIELD_H, FX_CANNON_FRAMES, FX_FRAME_MS, FX_TEX, MELEE_RANGE_MAX, NPC_ART, PALETTE, PART_ART, PART_ART_ROOT, partKey, SCAR_TEX, SHIP_TEX, SUNNY_GROUND_PROPS, SUNNY_PROPS, sunnyPropKey, TEX_CRATE, TILE, TP_SHEET_TEX, TP_TILESET_ID, UNIT_ART, VIEW_H, VIEW_W, type SunnyProp } from '../core/constants';
import { dataLoader, type ChapterBundle } from '../core/DataLoader';
import {
  rollQuality,
  rollSlot,
  computeDamage,
  effectiveStats,
  enemyStats,
  expToNext,
  applyExp,
  makeItemInstance,
  compareWithEquipped,
  formatStatDelta,
  statDeltaParts,
  type Rng,
} from '../core/balance';
import { bus, EV, emitHud, emitObjective, emitSceneLabel, emitToast, getControlsVisible, getHudVisible, getWeaponBagVisible, setCannonVisible, setControlsVisible, setHudVisible, setInputEnabled, setWeaponBagVisible } from '../core/EventBus';
import {
  SWAP_REJECT_TEXT,
  canOpenWeaponBag,
  commitWeaponSwap,
  isCombatPlayable,
  listWeaponOptions,
  planWeaponSwap,
  rollbackWeaponSwap,
  type WeaponBagGate,
  type WeaponOption,
} from '../core/weaponSwap';
import { DEFEAT_TEXT } from '../core/defeat';
import { DefeatCinematic } from '../systems/DefeatCinematic';
import { controls } from '../systems/InputSystem';
import { DialogueBox } from '../systems/DialogueBox';
import { hideDialogue, hideFloat, hideOverlay, hideToast, moveFloat, showFloat, showOverlay } from '../systems/DomUi';
import { MapRenderer } from '../gfx/MapRenderer';
import { backdropImage, horizonImage, HORIZON_H } from '../gfx/Backdrop';
import { isFootBlocked, nearestOpenPoint } from '../core/space';
import { canCompleteEscort } from '../core/escort';
import {
  DEFAULT_WAVE_UPGRADE_TUNING,
  UpgradeBook,
  applyUpgrade,
  bonusPierce,
  cleaveDmgMult,
  describeNext,
  hasteMult,
  pickUpgradeChoices,
  sweepArcMult,
  upgradeClass,
  upgradeSummary,
  upgradesExhausted,
  volleyOffsets,
  volleyRows,
  type UpgradeClass,
  type UpgradeId,
  type UpgradeState,
} from '../core/waveUpgrade';
import { CharacterRig } from '../gfx/CharacterRig';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import {
  MANAGE_LAYOUT,
  MANAGE_MONTHS,
  MONTHLY_POINTS,
  TRACK_MAX,
  allocTotal,
  createManageState,
  finalVerdict,
  managementTextLayout,
  settleMonth,
  validateAlloc,
  type ManageState,
  type ManageTrack,
  type TextBox,
} from '../core/management';
import { addKnowledge, addToBag, markNodeDone } from '../core/SaveManager';
import {
  DYNASTY_MAX,
  applyDynastyDelta,
  cooldownSeconds,
  planCannonShot,
  within,
  type CannonTarget,
} from '../core/cannon';
import {
  getDungeonState,
  isPityReady,
  pityHint,
  pityWeights as dungeonPityWeights,
  recordDungeonClear,
  shouldGrantUnique,
} from '../core/dungeon';
import { getSave, persist } from './BootScene';
import type {
  ActDef,
  BalanceConfig,
  BannerDef,
  DialogueAction,
  DungeonDef,
  EnemyDef,
  ItemInstance,
  MapObject,
  NodeDef,
  Quality,
  SaveData,
  WaveUpgradeTuning,
  WeaponDef,
} from '../core/types';
import { FONT_UI } from '../gfx/TextStyle';
import { markPixel } from '../gfx/PixelArt';

/** 地图物件挂的附加显示对象：光晕/箱盖是矩形，NPC 脚下的影子是椭圆，箱子头顶的指引标是三角 */
type WorldExtra =
  | Phaser.GameObjects.Rectangle
  | Phaser.GameObjects.Image
  | Phaser.GameObjects.Ellipse
  | Phaser.GameObjects.Triangle;

interface LevelInit {
  actId: string;
  chapterId: string;
  startNode?: number;
  /** 进副本时不走幕节点，直接跑一段可重复的战斗 */
  dungeonId?: string;
}

/**
 * 演示版收到的伤害折扣。
 *
 * 甲方原话：「目前难度太大了，玩家撑不到军舰就结束了，没有体验感」。
 * 数值上只动「我方承受」这一侧，敌人血量/数量不动——这样胜负仍然由走位和开炮决定，
 * 但给了足够时间看清炮的分档伤害与军舰推进，演示时不会三分钟就结束。
 */
const DEMO_INCOMING_DAMAGE_MULT = 0.55;

/**
 * 玩家出手的整体倍率（甲方要求「我方角色攻击减半」）。
 *
 * 从 `config.json → player_damage_mult` 读，读不到按 1：数据文件是内容层，
 * 改这一头不用碰代码，也不会让老配置突然变弱。配置在 `create()` 的世界构建阶段同步进来，
 * 而所有出手判定都在 `update()` 之后，所以这里用模块级变量是安全的（见 `applyPlayerDamageMult`）。
 */
let PLAYER_DMG = 1;

/** 战斗内换武器面板一屏能放几行；超出的用 ↑↓ 滚动，不分页（少一层状态） */
const WEAPON_BAG_ROWS = 4;

/** 把敌方伤害按演示倍率折一下，最少 1 点（不能因为折扣出现「打了不掉血」） */
function incoming(damage: number): number {
  return Math.max(1, Math.round(damage * DEMO_INCOMING_DAMAGE_MULT));
}

/**
 * 舰炮落点预警的参数（甲方 m12276：「系统提示落点让角色可以躲开」）。
 *
 * 为什么 `warnMs` 要 1000 而不是 400：玩家看到圈 → 判断方向 → 迈步，手机上还要按摇杆，
 * 800ms 以下实测「看懂了但走不出去」。1000ms 配合 46px 半径，横着走 2 格半就出圈。
 * `damageMult` 压在 1.15：一发躲不掉也不至于半血，连吃两发才会真的危险。
 */
const SALVO = {
  /** 预警圈半径（像素）：圈的边缘就是伤害边界，不看动画只看这一圈 */
  radiusPx: 46,
  /** 红圈收缩时长：这段时间里玩家都来得及走出去 */
  warnMs: 1000,
  /** 炮弹从上方落下的时长（视觉上必须有「掉下来」这一下，否则像凭空爆炸） */
  fallMs: 260,
  /** 炮弹起点在落点上方多少像素 */
  fallFromPx: 120,
  /** 一次齐射结束后多久才允许下一轮，避免两条预警叠在一起看不清 */
  recoverMs: 600,
  /** 预判弹打在玩家前方多少像素（冲着玩家移动方向偏，逼玩家改方向躲） */
  leadPx: 34,
  /** 落点伤害 = 敌攻 × 这个倍率 */
  damageMult: 1.15,
} as const;

interface Projectile {
  rect: Phaser.GameObjects.Rectangle;
  vx: number;
  vy: number;
  damage: number;
  fromPlayer: boolean;
  pierce: number;
  life: number;
  crit: boolean;
}

interface FloorItem {
  /** 掉落物容器：底座方块 + 槽位形状标记（+ 紫装呼吸光）。x/y/destroy 与 Rectangle 一致 */
  obj: Phaser.GameObjects.Container;
  item: ItemInstance;
  /** 紫装专属呼吸光，销毁前要 killTweensOf，避免 tween 挂在已销毁对象上 */
  glow?: Phaser.GameObjects.Arc;
}

type Mode = 'explore' | 'combat' | 'cutscene' | 'choice' | 'escort' | 'management';

/** 护送目标：跟随玩家的太平军战士 */
interface Ally {
  rig: CharacterRig;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** 环形跟随的相对角度（弧度） */
  angle: number;
}

const rng: Rng = () => Math.random();

export class LevelScene extends Phaser.Scene {
  private bundle!: ChapterBundle;
  private act!: ActDef;
  private cfg!: BalanceConfig;
  private save!: SaveData;
  private nodeIndex = 0;
  private node!: NodeDef;

  private map: MapRenderer | null = null;
  private player!: Player;
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private floorItems: FloorItem[] = [];
  private worldObjects: {
    def: MapObject;
    /** 主体：占位时是 Rectangle，正式美术到位后是 Image。两者都有 visible/x/y */
    rect: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image;
    label: Phaser.GameObjects.Text;
    /** 附加装饰（如箱盖高光、呼吸光晕），随主体一起显示/隐藏/销毁 */
    extra: WorldExtra[];
  }[] = [];

  private dialogue!: DialogueBox;
  private mode: Mode = 'explore';
  private nearObject: MapObject | null = null;
  private carrying = false;
  private cratesDelivered = 0;
  private crateTarget = 8;
  /**
   * 销烟这一幕的「先听林大人吩咐」闸门。
   *
   * 甲方要求：旁白先说完，林则徐不自动开口；玩家自己走过去点他，他才一次说完，
   * 说完才能搬箱子。所以箱子的交互被这道闸门挡住，而不是靠改对白数据糊过去。
   */
  private npcTalked = false;
  private npcTalkObjId: string | null = null;
  private npcDialogueRef: string | null = null;
  private npcMark: Phaser.GameObjects.Text | null = null;

  private waveIndex = -1;
  private wavePending = false;
  private bossSpawned = false;
  /**
   * 本关的波次强化状态，按**武器实例**隔离（`core/waveUpgrade.ts` 的 `UpgradeBook`）。
   * **只在本关内有效**：`create()` 里 clear()，不写存档 —— 一旦落盘就要处理
   * SAVE_VERSION 迁移，收益不值得这个风险。
   *
   * 为什么不是全关一份：强化卡是「给手上这把武器」的。中途换刀 / 换弓时，
   * 不能把弓的齐射等级带到刀上，也不能因为某把武器满了级，就让换过来的另一把
   * 武器这一整关再也弹不出卡。
   */
  private readonly upgradeBook = new UpgradeBook();
  /** 强化数值来自 config.json；配置还没加载时用默认值兜底（与旧版弓数值逐字一致） */
  private upgradeTuning(): WaveUpgradeTuning {
    return this.cfg?.wave_upgrade ?? DEFAULT_WAVE_UPGRADE_TUNING;
  }
  /**
   * 旧探针 / 调试用的兼容视图：读写都落到「当前武器实例」，真值只在 upgradeBook 里。
   * 故意不加 `private`：这是给浏览器探针（`L.upgrades`）用的公开调试接口。
   */
  get upgrades(): UpgradeState {
    return this.currentUpgrades();
  }
  set upgrades(s: UpgradeState) {
    this.upgradeBook.set(this.upgradeKey(), s);
  }
  /** 强化选卡正在显示（期间世界冻结，复用 `pendingCardTap` 作为「有卡可点」信号） */
  private upgradeOpen = false;
  /**
   * 清完这一波之后该不该弹强化卡。
   * 用标志位而不是每帧重算，是为了让「玩家点了跳过」只发生一次判定；
   * **注意**：某把武器满级不再把它永久置 false —— 换武器后另一把还没满级，
   * 下一波仍应能弹卡（满级判定在波次推进处按当前实例实时算）。
   */
  private pendingUpgrade = true;
  private nodeBusy = false;
  /** 城破演出（m06955）。演出结束自己销毁；重进关卡必须复位，否则镜头与 HUD 会卡在演出状态。 */
  private breachCinema: DefeatCinematic | null = null;
  /**
   * 节点切换期间为 true：startNode 里有 await（加载地图），Phaser 的 update 在这期间
   * 照常运行。不屏蔽的话，update 会拿着「上一幕的模式 + 上一幕的玩家坐标」再跑一遍
   * 完成判定，导致节点被连续跳过（天京经营幕曾因此整幕被跳掉）。
   * 由 startNode 的 try/finally 全程托管；nodeStartSeq 防止重入时旧的 finally 提前解锁。
   */
  private transitioning = false;
  private nodeStartSeq = 0;
  private enemyLevel = 1;
  private worldBuilt = false;
  /** 手动跟随的参数；null = 本幕不需要跟随（过场/经营） */
  private camFollow: { lerp: number } | null = null;
  private hudTimer = 0;

  /* 护送模式 */
  private allies: Ally[] = [];
  private escortGoalX = 0;
  private escortGoalMarker: Phaser.GameObjects.Rectangle | null = null;
  private escortStage = 0;
  private escortSurvivors = 0;
  /** 本幕初始护送人数：结算时战士可能已被 clearAllies 收走，不能拿 allies.length 当分母 */
  private escortTotal = 0;

  /* 经营模式 */
  private manage: ManageState | null = null;
  private manageAlloc: ManageTrack = { food: 2, troops: 2, morale: 2 };
  private manageUI: Phaser.GameObjects.Container | null = null;
  private manageFocus: keyof ManageTrack = 'food';

  /* 副本模式 */
  private dungeon: DungeonDef | null = null;
  private runDrops: ItemInstance[] = [];
  private dungeonResultOpen = false;
  /** 剧情关卡战败面板是否开着：开着时冻结世界更新，等玩家点「再试一次」 */
  private storyFailOpen = false;

  /* 战斗内换武器面板（设计书 4.3.8）：真值源仍是 save.equipment.weapon */
  private weaponBagOpen = false;
  private weaponBagPanel: Phaser.GameObjects.Container | null = null;
  private weaponBagOptions: WeaponOption[] = [];
  private weaponBagCursor = 0;
  private weaponBagScroll = 0;
  private weaponBagMessage = '';
  /** 开面板前的 HUD 显隐，关闭时按原值还原，不去猜别的流程设成了什么 */
  private weaponBagHudBefore = true;
  /** 面板专用键盘监听，关面板时逐个 off，避免 once 泄漏到下一场战斗 */
  private weaponBagKeys: Array<{ event: string; fn: () => void }> = [];
  /** 常驻的 B 键：开着面板时再按一次就是取消 */
  private readonly handleBagKey = (): void => {
    if (this.weaponBagOpen) this.closeWeaponBag('cancel');
    else this.openWeaponBag();
  };

  /* 演示版：虎门重炮与清王朝血条 */
  private cannonCd = 0;
  /** 本次关卡是否已经输过（战败演出后继续推进，HUD 上标出来） */
  private defeated = false;
  /** 半血必杀是否正在演出（防止演出期间又被别的伤害源触发一次） */
  private finalStrikeRunning = false;
  /** 半血剧情杀的当前阶段（'none' | 'warn' | 'hit' | 'defeat'），只给探针与截图脚本读 */
  finalStrikeStage: 'none' | 'warn' | 'hit' | 'defeat' = 'none';
  /** 全屏卡片（战败/条约/牺牲）的「点击继续」回调；E2E 可直接调 tapCard() */
  private pendingCardTap: (() => void) | null = null;
  /** Boss 军舰：停在岸边原地开炮（m12276 之后它不再前压，见 `bossCharge`） */
  private bossShip: Enemy | null = null;
  /** 战斗开场情境卡开着时冻结世界（敌人在卡片后面动起来会看不到、白挨打） */
  private introOpen = false;
  /** 运行时可碰撞的「禁区」格子（"col,row"）。军舰不前压后恒为空，入口收敛在 `isSeaAt` */
  private seaTiles = new Set<string>();
  /** 站着围观百姓的格子（"col,row"）：挡人用的是这一集合，不是海面 */
  private crowdSolids = new Set<string>();
  /**
   * 围观百姓的 Image 句柄。
   *
   * 必须自己收：它们不进 `worldObjects`（进了就会变成可交互目标，能被「搬起」），
   * 也不归 `MapRenderer` 管（那是地形图层），所以换图时没有任何人替它们清场。
   * 第一版没记句柄，销烟池那 10 个百姓就跟着进了虎门炮台那张图，见 `buildWorld`。
   */
  private crowdSprites: Phaser.GameObjects.Image[] = [];
  /**
   * Sunny Land 静态布景的句柄（只画不登记，换图时同样要自己收）。
   *
   * 和 `crowdSprites` 是同一个坑：不走 `worldObjects` 的东西没人替它清场。
   * 销烟池的木箱 / 枯骨如果留在虎门炮台那张图的沙滩上，就是「上一关的道具跑过来」。
   */
  private propSprites: Array<{ name: SunnyProp; img: Phaser.GameObjects.Image }> = [];
  /**
   * `buildWorld` 的重入票号：只有票号最新的一次才有权往下建。
   * 见 `buildWorld` 里的注释——两次重叠的构建会让旧地图的纹理与贴图变成孤儿。
   */
  private worldBuildSeq = 0;
  /** 军舰前压的节拍（毫秒）与是否正在移动 */
  private shipTimer = 0;
  private shipMoving = false;
  /** 舰炮预警齐射正在播（一轮播完前不再起新的一轮，否则圈会叠成一片红） */
  private salvoActive = false;

  constructor() {
    super('Level');
  }

  /**
   * 正式美术在这里预加载：Boss 舰 6 帧、鸦片箱、两幅立绘、六个兵种四朝向、
   * 甲方给的全景海战图与远景条、12 张地面残破贴花。
   *
   * 为什么用 preload 而不是按需加载：舰船要在 create 里就决定「用贴图还是用矩形占位」，
   * 按需加载会让 Boss 出场那一帧先闪一下占位形体。所有图加起来不到 1 MB，
   * 且只在本场景首次进入时下载一次（纹理管理器全局缓存）。
   */
  preload(): void {
    // 太平天国篇章的 36 张 16×16 瓦片拼版（128×80，8 列）。
    // 必须放 preload：buildWorld 里 new MapRenderer() 是同步烘地面纹理的，
    // 等构造时再发起异步加载就已经画完了。缺图时 MapRenderer 自动回退程序化材质。
    if (!this.textures.exists(TP_SHEET_TEX)) this.load.image(TP_SHEET_TEX, ART.tpSheet);
    ART.shipBossFrames.forEach((path, i) => {
      const key = SHIP_TEX[i] as string;
      if (!this.textures.exists(key)) this.load.image(key, path);
    });
    if (!this.textures.exists(TEX_CRATE)) this.load.image(TEX_CRATE, ART.crate);
    // 立绘的 key 必须和 DialogueBox 的 `portrait_${speaker}` 一致，
    // 否则对白会一直显示灰色占位框。每加一位有立绘的说话人：config.json 的 ui.portraits 登记 + 这里补一行。
    const portraits: Array<[string, string]> = [
      ['portrait_lin_zexu', ART.portraitLinZexu],
      ['portrait_guan_tianpei', ART.portraitGuanTianpei],
    ];
    for (const [key, path] of portraits) {
      if (!this.textures.exists(key)) this.load.image(key, path);
    }
    // 围观百姓（6×12 像素小人，游戏里放大 3 倍）。缺图时 `spawnCrowd` 会退回暗色方块。
    Object.values(CROWD_TEX).forEach((key, i) => {
      if (!this.textures.exists(key)) this.load.image(key, `${ART.crowd}door_${i}.png`);
    });
    // 兵种小人贴图（24×32，四朝向）。名字约定 `${unit}_${facing}`，与 CharacterRig 的贴图模式一致；
    // 缺哪张就退回矩形小人，不会白屏。
    for (const [unit, base] of Object.entries(UNIT_ART)) {
      for (const facing of ['down', 'up', 'left', 'right']) {
        const key = `${unit}_${facing}`;
        if (!this.textures.exists(key)) this.load.image(key, `${base}_${facing}.png`);
      }
    }
    // 分件小人的五件套（头/身/臂/腿/兵器）。整张四朝向贴图仍然加载：
    // 分件缺哪张就整只退回整张 —— 甲方再出图时只补一件也不会白屏。
    for (const [unit, parts] of Object.entries(PART_ART)) {
      for (const facing of ['front', 'side'] as const) {
        for (const part of parts) {
          const key = partKey(unit, facing, part);
          if (!this.textures.exists(key)) {
            this.load.image(key, `${PART_ART_ROOT}/${unit}_${facing}_${part}.png`);
          }
        }
      }
    }
    // 甲方给的全景海战图（960×540 减半成 480×270）与从里面裁出来的远景条（480×64）。
    // 贴图没到位时 Backdrop 会退回程序化绘制，所以这里失败也不至于白屏。
    if (!this.textures.exists(BG_TEX.intro)) this.load.image(BG_TEX.intro, ART.bgSeaRed);
    if (!this.textures.exists(BG_TEX.horizon)) this.load.image(BG_TEX.horizon, ART.bgStripNight);
    if (!this.textures.exists(BG_TEX.horizonAlt)) this.load.image(BG_TEX.horizonAlt, ART.bgStripRed);
    // 甲方 m12276 的黄昏全景：远景条（战场顶带）+ 天空段（开场情境卡底图）
    if (!this.textures.exists(BG_TEX.horizonDusk)) {
      this.load.image(BG_TEX.horizonDusk, ART.bgStripDusk);
    }
    if (!this.textures.exists(BG_TEX.skyDusk)) this.load.image(BG_TEX.skyDusk, ART.bgSkyDusk);
    // 1864 天京城破之战专用远景条（火光 / 浓烟 / 城墙）。只在 buildWorld 判定为
    // tp_act2 + sky_rows 的关卡使用；其它战斗关卡继续加载并使用 horizonDusk。
    if (!this.textures.exists(BG_TEX.horizonCityFall)) {
      this.load.image(BG_TEX.horizonCityFall, ART.bgStripTianjingFall);
    }
    // 地面残破贴花（弹坑 / 血泊 / 尸骸 / 碎砖），MapRenderer 把它们印进地面纹理
    SCAR_TEX.forEach((key, i) => {
      if (!this.textures.exists(key)) {
        this.load.image(key, `${ART.scars}scar_${String(i).padStart(2, '0')}.png`);
      }
    });
    // Sunny Land 场景道具（CC0）：给 `kind:'prop'` 的静态布景用。
    // 缺图时 `spawnSunnyProp` 不画任何东西（不画兜底方块——那个更误导），
    // 文件在不在由 `tests/art.test.ts` 兜。
    for (const name of Object.keys(SUNNY_PROPS) as SunnyProp[]) {
      const key = sunnyPropKey(name);
      if (!this.textures.exists(key)) this.load.image(key, `${ART.sunnyProps}${SUNNY_PROPS[name].file}`);
    }
    // 甲方给的炮火特效：48 帧 × 96×96（tools/import_fx.py 从 GIF 拆出）。
    // 只在「带炮的关卡」才有用，但那类关卡一进入就要开火，所以还是放 preload。
    // 缺图时 `playCannonBlast` 会退回原来的程序化冲击波，不会白屏。
    for (let i = 0; i < FX_CANNON_FRAMES; i++) {
      const key = `${FX_TEX.cannonBlast}_${i}`;
      if (!this.textures.exists(key)) {
        this.load.image(key, `${ART.fxCannonBlast}fx_${String(i).padStart(2, '0')}.png`);
      }
    }
  }

  init(data: LevelInit): void {
    this.registry.set('levelInit', data);
  }

  create(): void {
    // 每通关一幕都会 scene.start('Level')，Phaser 重启场景时复用同一个实例、
    // 不重跑字段初始化，而上一轮的显示对象已被销毁。这里显式丢弃旧引用，
    // 避免后续访问已销毁的精灵（同类 bug 已在 HubScene 上出现过）。
    this.map = null;
    this.player = null as unknown as Player;
    this.camFollow = null;
    this.dialogue = null as unknown as DialogueBox;
    this.enemies = [];
    this.projectiles = [];
    this.floorItems = [];
    this.worldObjects = [];
    this.nodeIndex = 0;
    // 副本引用必须在这里清掉：create() 复用同一个实例，若上一轮刷过副本，
    // 这一轮的 boot() 会看到残留的 this.dungeon 而重开副本，正片节点根本不会进。
    this.dungeon = null;
    this.dungeonResultOpen = false;
    // 开场情境卡也是「闸门」：上一轮若停在卡片上被重开，世界会永远冻结
    this.introOpen = false;
    this.cannonCd = 0;
    this.defeated = false;
    this.storyFailOpen = false;
    this.finalStrikeStage = 'none';
    this.finalStrikeRunning = false;
    this.bossShip = null;
    this.seaTiles.clear();
    this.shipTimer = 0;
    this.shipMoving = false;
    this.salvoActive = false;
    // 百姓句柄也要在重进关卡时清空：旧场景的 Image 已经随场景销毁，
    // 留着引用只会让 `buildWorld` 去 destroy 一堆已死的对象。
    this.crowdSprites = [];
    this.crowdSolids.clear();
    this.nearObject = null;
    this.carrying = false;
    this.cratesDelivered = 0;
    this.waveIndex = -1;
    this.wavePending = false;
    this.bossSpawned = false;
    // 波次强化只在本关内有效：重进关卡必须把**所有武器实例**一起清零，
    // 否则上一关刷满的三行齐射 / ×1.50 横扫会带过来
    this.upgradeBook.clear();
    this.upgradeOpen = false;
    this.pendingUpgrade = true;
    this.nodeBusy = false;
    // 同理：上一轮若在切节点的 await 里被打断，transitioning 会一直是 true，
    // 而 updateWorld() 开头正是 `if (this.transitioning) return;` —— 后果是波次不再推进、
    // 玩家也动不了（探针里表现为「清完第一波就永远等不到 Boss」）。
    this.transitioning = false;
    this.pendingCardTap = null;
    this.spawnedTotal = 0;
    this.hudTimer = 0;
    // 换武器面板不能跨关卡残留：显示对象随场景销毁，状态与全局开关必须自己复位
    this.weaponBagOpen = false;
    this.weaponBagPanel = null;
    this.weaponBagOptions = [];
    this.weaponBagCursor = 0;
    this.weaponBagScroll = 0;
    this.weaponBagMessage = '';
    this.weaponBagKeys = [];
    setWeaponBagVisible(false);

    void this.boot();

    // E2E / 探针用：把「敌人和地形」交出去，用来验证「小兵不会被打出地图」。
    // 甲方三次截图报这个 bug，光靠 cdp-e2e 的截图看不住，得能主动把敌人推到界外再观察。
    (window as unknown as { __dshLevel?: unknown }).__dshLevel = {
      /** 存活敌人的世界坐标（脚底） */
      enemies: () => this.enemies.filter((e) => e.alive).map((e, i) => ({ i, x: e.x, y: e.y, hp: e.hp })),
      /**
       * 场景布景的落位（E2E / 探针用）。
       *
       * 为什么要这个入口：`prop` 布景**只画不登记**，从 `worldObjects` 里查不到，
       * 截图之外没有任何办法断言「这格真的铺了块路牌而不是又回到 12×12 色块」。
       * `drawn:false` 就是贴图缺了（只在 `console.warn` 之外留痕）。
       *
       * 坐标是**世界坐标（脚底中心）**；纹理按 (0.5, 1) 锚点贴上去，所以屏幕位置不能直接当 x/y 用。
       */
      props: () =>
        this.propSprites
          .filter((p) => p.img.active)
          .map((p) => ({
            name: p.name,
            x: p.img.x,
            y: p.img.y,
            texture: p.img.texture.key,
            drawn: p.img.visible && p.img.alpha > 0,
          })),
      /** 全部敌人（含已死的），排查用 */
      allEnemies: () => this.enemies.map((e, i) => ({ i, x: e.x, y: e.y, alive: e.alive, hp: e.hp })),
      /** 地图尺寸与「这个坐标能不能站」 */
      map: () =>
        this.map
          ? {
              w: this.map.pixelWidth,
              h: this.map.pixelHeight,
              cols: this.map.def.width,
              rows: this.map.def.height,
            }
          : null,
      unsafe: (x: number, y: number) => this.enemySpotUnsafe(x, y),
      /** 排查用：中心 + 12×8 脚盒四角的完整判据（贴墙卡死就靠它区分） */
      footUnsafe: (x: number, y: number) => this.enemyFootUnsafe(x, y),
      /** 排查用：每个敌人的实时追击状态与卡住时长 */
      enemyStates: () =>
        this.enemies.map((e, i) => ({
          i,
          x: e.x,
          y: e.y,
          alive: e.alive,
          state: e.state,
          stuckMs: e.stuckTime,
        })),
      /** 排查用：碰撞格矩阵（'#' = 撞墙/海，'.' = 可站），一行一行的字符串 */
      grid: () => {
        const m = this.map;
        if (!m) return null;
        const cols = m.def.width;
        const rows = m.def.height;
        const solidRows: string[] = [];
        for (let gy = 0; gy < rows; gy++) {
          let s = '';
          for (let gx = 0; gx < cols; gx++) s += m.isSolidAtTile(gx, gy) ? '#' : '.';
          solidRows.push(s);
        }
        return { cols, rows, solidRows };
      },
      /** 排查用：从某点找最近空地的全过程（敌人被捞出界时用来定位「为什么找不到落点」） */
      traceLanding: (wx: number, wy: number) => {
        const m = this.map;
        if (!m) return null;
        const gx = Math.floor(wx / TILE);
        const gy = Math.floor(wy / TILE);
        const blocked = (cx: number, cy: number) => {
          if (this.isSeaAt(cx, cy)) return true;
          if (m.isSeaAtWorld(cx, cy)) return true;
          return m.isSolidAtTile(Math.floor(cx / TILE), Math.floor(cy / TILE));
        };
        const trail: unknown[] = [];
        for (let ring = 0; ring <= 16; ring++) {
          const cands: Array<[number, number]> = [];
          for (let d = -ring; d <= ring; d++) {
            cands.push([gx - ring, gy + d]);
            cands.push([gx + ring, gy + d]);
          }
          const hits = cands.map(([cx, cy]) => {
            const inMap = cx >= 0 && cy >= 0 && cx < m.def.width && cy < m.def.height;
            return { cx, cy, inMap, b: inMap ? blocked((cx + 0.5) * TILE, (cy + 0.5) * TILE) : null };
          });
          trail.push({ ring, open: hits.filter((h) => h.inMap && h.b === false) });
        }
        return { start: { wx, wy, gx, gy }, trail };
      },
      /** 强行把第 i 个敌人挪到 (x,y)，用来复现「被打出地图」 */
      teleport: (i: number, x: number, y: number) => {
        const e = this.enemies.filter((v) => v.alive)[i];
        if (!e) return false;
        e.teleportTo(x, y);
        return true;
      },
      /** 跑一次每帧兜底（探针等不到 update 时手动触发） */
      rescue: () => {
        this.rescueStrayEnemies();
        return this.enemies.filter((e) => e.alive).length;
      },
      // —— 波次强化（弓 + 近战，按武器实例隔离）的探查入口 ——
      /** 当前**武器实例**的强化状态 + 派生数值，探针据此断言「选完真的变了」 */
      upgrades: () => {
        const up = this.currentUpgrades();
        const cls = this.currentUpgradeClass();
        const tune = this.upgradeTuning();
        const info = this.debugWeaponInfo();
        return {
          ...up,
          rows: volleyRows(up),
          haste: hasteMult(up, tune),
          pierceBonus: bonusPierce(up),
          summary: upgradeSummary(up, cls, tune),
          cardOpen: this.upgradeOpen,
          weaponClass: cls,
          key: info.key,
          arcMult: info.arcMult,
          cleaveMult: info.cleaveMult,
        };
      },
      /** 直接塞一个强化状态（探针用；可用 key 指定别的武器实例） */
      setUpgrades: (patch: Partial<UpgradeState>, key?: string) => {
        const k = key ?? this.upgradeKey();
        return this.upgradeBook.set(k, { ...this.upgradeBook.get(k), ...patch });
      },
      /** 所有武器实例的状态快照：验「互不带走」与「换关全清」 */
      upgradeStates: () => this.upgradeBook.snapshot(),
      /** 手动整本清零（探针验重置，不必真 scene.restart） */
      resetUpgrades: () => {
        this.upgradeBook.clear();
        return true;
      },
      /** 跳过卡片：选第一项（等价于点第一张卡） */
      pickUpgrade: (i = 0) => {
        void i;
        this.pendingCardTap?.();
        return this.upgradeOpen;
      },
      /** 当前武器实时参数（字段与 v1.6 `bowInfo` 兼容，旧探针不用改） */
      bowInfo: () => this.debugWeaponInfo(),
      weaponInfo: () => this.debugWeaponInfo(),
      /** 清空当前存活敌人，直接推进到下一次波次判定（省得探针真打） */
      clearWave: () => {
        // 只翻 alive，**不要**自己 destroy rig：`clearDeadEnemies()` 会调 `e.destroy()`
        // 把 rig 一并销毁，先手动 destroy 再走一遍会抛「已销毁对象」的错
        for (const e of this.enemies) if (e.alive) e.alive = false;
        this.clearDeadEnemies();
        return this.waveIndex;
      },

      // —— 战斗内换武器（设计书 4.3.8）：E2E 不必模拟按键坐标，直接读状态 ——
      weaponBag: () => ({
        open: this.weaponBagOpen,
        message: this.weaponBagMessage,
        cursor: this.weaponBagCursor,
        options: this.weaponBagOptions.map((o) => ({
          id: o.id,
          name: o.name,
          weaponRef: o.weaponRef,
          available: o.available,
          current: o.current,
          reason: o.reason,
          deltaText: o.deltaText,
        })),
        weaponId: this.player?.weapon.id ?? null,
        weaponRange: this.player?.weapon.range ?? null,
        attacksPerSec: this.player?.weapon.attacks_per_sec ?? null,
        atk: this.player?.atk ?? null,
        hp: this.player?.hp ?? null,
        maxHp: this.player?.maxHp ?? null,
        alive: this.player?.alive ?? null,
        equippedUid: this.save?.equipment.weapon?.uid ?? null,
        bagUids: (this.save?.bag.items ?? []).filter((i) => i.slot === 'weapon').map((i) => i.uid),
        controlsVisible: getControlsVisible(),
        hudVisible: getHudVisible(),
        panelVisible: getWeaponBagVisible(),
        mode: this.mode,
        nodeBusy: this.nodeBusy,
      }),
      openWeaponBag: (): boolean => {
        this.openWeaponBag();
        return this.weaponBagOpen;
      },
      closeWeaponBag: (): boolean => {
        this.closeWeaponBag('cancel');
        return this.weaponBagOpen;
      },
      chooseWeapon: (id: string): boolean => {
        this.selectWeaponOption(id);
        return this.weaponBagOpen;
      },
      /** 模拟节点完成 / 副本结算置起的 nodeBusy，验证面板每帧兜底自动收起 */
      setNodeBusy: (v: boolean): boolean => {
        this.nodeBusy = v;
        return this.nodeBusy;
      },
    };
  }

  private async boot(): Promise<void> {
    const data = this.registry.get('levelInit') as LevelInit;
    this.cfg = dataLoader.getBalance();
    this.save = getSave();

    // DOM 层不吃 Phaser 的场景生命周期，进关卡第一件事是把上一屏没收干净的东西收掉：
    // 长廊的副本面板 + 底部四入口（#dom-overlay）、标题页大字、没关掉的对白框。
    // **必须放在第一个 await 之前**——手机上章节数据要下几百毫秒，这期间战役条已经画出来了，
    // 长廊的面板还叠在上面，甲方手机截图里的「文字重叠」就是这么来的。
    hideOverlay();
    hideDialogue();
    hideFloat();
    // 甲方「我方攻击减半」：倍率来自内容层，缺省 1（旧配置不会突然变弱）
    PLAYER_DMG = this.cfg.player_damage_mult ?? 1;

    this.cameras.main.setBackgroundColor(PALETTE.ink);
    const loading = this.add
      .text(VIEW_W / 2, VIEW_H / 2, '载入中……', {
        fontFamily: FONT_UI,
        fontSize: '11px',
        color: '#948DAB',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay);

    try {
      this.bundle = await dataLoader.loadChapter(data.chapterId);
      if (data.dungeonId) {
        this.dungeon = await dataLoader.loadDungeon(data.dungeonId);
      } else {
        this.act = await dataLoader.loadAct(data.actId);
      }
    } catch (err) {
      loading.setText(`关卡数据加载失败\n${String(err)}`);
      return;
    }

    this.dialogue = new DialogueBox(this, this.cfg.ui.dialog_speed, this.cfg.ui.portraits ?? {});
    this.scene.launch('UI');

    // 离开关卡时同样得自己收 DOM：暂停菜单「回主菜单」经常是在对白没播完时走的，
    // 不收就会把整个对白框（含立绘）留在长廊/标题上，和场景里的字叠成一片。
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // 面板可能在节点结算 / 暂停返回主菜单时还开着，先把全局界面状态还回去
      this.closeWeaponBag('auto');
      setWeaponBagVisible(false);
      bus.off(EV.OPEN_WEAPON_BAG, this.openWeaponBag, this);
      this.input.keyboard?.off('keydown-B', this.handleBagKey);
      hideDialogue();
      hideFloat();
      hideOverlay();
    });

    // UIScene 的「背包」按钮与键盘 B 走同一条门禁；这里订阅而不是在 UIScene
    // 里直接操作 Level，保持两个场景之间只有 EventBus 这一条耦合线。
    bus.on(EV.OPEN_WEAPON_BAG, this.openWeaponBag, this);
    this.input.keyboard?.on('keydown-B', this.handleBagKey);
    this.input.on('pointerdown', () => this.onAdvanceInput());

    if (this.dungeon) {
      await this.startDungeon();
    } else {
      this.nodeIndex = data.startNode ?? 0;
      await this.startNode(this.nodeIndex);
    }
    loading.destroy();
  }

  /* ==================== 副本模式（可重复刷） ==================== */

  private async startDungeon(): Promise<void> {
    this.closeWeaponBag('auto');
    const d = this.dungeon;
    if (!d) return;
    this.transitioning = true;
    try {
      this.nodeBusy = true;
      this.mode = 'combat';
      this.enemyLevel = d.recommended_level;
      this.spawnedTotal = 0;
      this.runDrops = [];
      this.dungeonResultOpen = false;
      this.waveIndex = -1;
      this.wavePending = false;
      this.bossSpawned = false;

      this.clearEnemies();
      this.clearProjectiles();
      this.clearFloorItems();
      this.clearAllies();
      this.clearWorldObjects();
      this.manageUI?.destroy();
      this.manageUI = null;
      this.manage = null;
      hideOverlay();

      await this.buildWorld(d.map_ref);

      const stats = effectiveStats(
        this.save.player.level,
        this.save.knowledge.length,
        this.save.equipment,
        this.cfg,
      );
      this.player.resetForNode(stats);
      this.applyEquippedWeapon();

      const st = getDungeonState(this.save, d.id);
      // 副本没有「幕」：左上角直接显示副本名与推荐等级年份位
      emitSceneLabel({ act: this.act.name, title: d.name, year: undefined });
      emitObjective(`${d.name}　第 ${st.clears + 1} 次`);
      emitToast(isPityReady(st) ? '保底生效：本次紫装概率提升' : d.desc, 2400);

      this.waveIndex = 0;
      this.wavePending = true;
      this.time.delayedCall(900, () => this.spawnWave(0));
      this.nodeBusy = false;
      setControlsVisible(true);
      this.pushHud();
    } finally {
      this.transitioning = false;
    }
  }

  /** 副本结算：收拢掉落、更新保底计数、弹出面板 */
  private finishDungeon(): void {
    this.closeWeaponBag('auto');
    const d = this.dungeon;
    if (!d || this.dungeonResultOpen) return;
    this.nodeBusy = true;
    this.dungeonResultOpen = true;
    setControlsVisible(false);

    const gained: ItemInstance[] = [...this.runDrops];
    for (const f of [...this.floorItems]) {
      if (addToBag(this.save, f.item) === 'ok') gained.push(f.item);
      this.destroyFloorItem(f);
    }
    this.floorItems = [];
    this.clearEnemies();
    this.clearProjectiles();

    const st = getDungeonState(this.save, d.id);
    // 首通必掉独特装备
    if (shouldGrantUnique(st) && d.unique_drop) {
      const base = dataLoader.findItemBase(d.unique_drop);
      // 本趟随机掉落可能已经掉了同一件模板：再塞一件会让结算面板出现两行一模一样的名字
      const already = gained.some((i) => i.base_id === d.unique_drop);
      if (base && !already) {
        const item = makeItemInstance(base, this.cfg, rng);
        if (addToBag(this.save, item) === 'ok') gained.push(item);
      }
    }
    const gotPurple = gained.some((i) => i.quality === 'purple');
    const next = recordDungeonClear(this.save, d.id, gotPurple);

    // 副本也给经验
    const expGain = Math.round(d.recommended_level * 40);
    this.addExp(expGain);
    persist();

    this.showDungeonResult(gained, next.missPurple, expGain);
  }

  private showDungeonResult(gained: ItemInstance[], missPurple: number, expGain: number): void {
    const d = this.dungeon;
    if (!d) return;
    const overlay = this.add.container(0, 0).setDepth(DEPTH.overlay).setScrollFactor(0);
    overlay.add(
      this.add
        .rectangle(240, 135, 400, 236, PALETTE.ink, 0.96)
        .setStrokeStyle(1, PALETTE.greyPlum)
        .setScrollFactor(0),
    );
    overlay.add(
      this.add
        .text(240, 30, `${d.name}　通关`, {
          fontFamily: FONT_UI,
          fontSize: '14px',
          color: '#F0C419',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );

    if (gained.length === 0) {
      overlay.add(
        this.add
          .text(240, 60, '这次什么都没掉。', {
            fontFamily: FONT_UI,
            fontSize: '10px',
            color: '#948DAB',
          })
          .setOrigin(0.5)
          .setScrollFactor(0),
      );
    } else {
      gained.slice(0, 6).forEach((it, i) => {
        const color =
          it.quality === 'purple' ? '#948DAB' : it.quality === 'blue' ? '#7FB2D9' : '#C2BCD1';
        const affix = it.affixes.length > 0 ? `　[${it.affixes.length} 词条]` : '';
        overlay.add(
          this.add
            .text(48, 56 + i * 15, `${qualityLabel(it.quality)}　${it.name}${affix}`, {
              fontFamily: FONT_UI,
              fontSize: '10px',
              color,
            })
            .setScrollFactor(0),
        );
        // 结算清单同样给出对比差值：这一趟刷到的是不是「比我身上的好」，一眼可见。
        // 基准是本趟开始时的已装备（结算期间 save.equipment 不变）。
        const delta = compareWithEquipped(it, this.save.equipment);
        const parts = statDeltaParts(delta);
        const tone =
          parts.length === 0
            ? '#6B6489'
            : parts.every((p) => p.positive)
              ? '#8FD19E'
              : parts.every((p) => !p.positive)
                ? '#F2A08C'
                : '#C2BCD1';
        overlay.add(
          this.add
            .text(432, 56 + i * 15, formatStatDelta(delta), {
              fontFamily: FONT_UI,
              fontSize: '9px',
              color: tone,
            })
            .setOrigin(1, 0)
            .setScrollFactor(0),
        );
      });
      if (gained.length > 6) {
        overlay.add(
          this.add
            .text(48, 56 + 6 * 15, `…另有 ${gained.length - 6} 件已入背包`, {
              fontFamily: FONT_UI,
              fontSize: '9px',
              color: '#6B6489',
            })
            .setScrollFactor(0),
        );
      }
    }

    const st = { clears: getDungeonState(this.save, d.id).clears, missPurple };
    overlay.add(
      this.add
        .text(240, 162, pityHint(st), {
          fontFamily: FONT_UI,
          fontSize: '9.5px',
          color: isPityReady(st) ? '#F0C419' : '#C2BCD1',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    overlay.add(
      this.add
        .text(240, 178, `累计通关 ${st.clears} 次　经验 +${expGain}`, {
          fontFamily: FONT_UI,
          fontSize: '9px',
          color: '#6B6489',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );

    this.dungeonButton(overlay, 240 - 62, 210, 104, 20, '再刷一次', () => {
      overlay.destroy();
      this.dungeonResultOpen = false;
      void this.startDungeon();
    });
    this.dungeonButton(overlay, 240 + 62, 210, 104, 20, '返回长廊', () => {
      overlay.destroy();
      this.leaveDungeon();
    });
  }

  /** 副本失败：不扣任何东西，可以直接重来 */
  private showDungeonFail(): void {
    this.closeWeaponBag('auto');
    const d = this.dungeon;
    if (!d || this.dungeonResultOpen) return;
    this.dungeonResultOpen = true;
    this.nodeBusy = true;
    setControlsVisible(false);

    const overlay = this.add.container(0, 0).setDepth(DEPTH.overlay).setScrollFactor(0);
    overlay.add(
      this.add
        .rectangle(240, 135, 340, 150, PALETTE.ink, 0.96)
        .setStrokeStyle(1, PALETTE.greyPlum)
        .setScrollFactor(0),
    );
    overlay.add(
      this.add
        .text(240, 90, '倒在半路上了', {
          fontFamily: FONT_UI,
          fontSize: '13px',
          color: '#F2A08C',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    overlay.add(
      this.add
        .text(240, 112, '副本不扣任何东西，重来就行。', {
          fontFamily: FONT_UI,
          fontSize: '9.5px',
          color: '#C2BCD1',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    this.dungeonButton(overlay, 240 - 62, 150, 104, 20, '再来一次', () => {
      overlay.destroy();
      this.dungeonResultOpen = false;
      void this.startDungeon();
    });
    this.dungeonButton(overlay, 240 + 62, 150, 104, 20, '返回长廊', () => {
      overlay.destroy();
      this.leaveDungeon();
    });
  }

  /**
   * 剧情关卡战败：给玩家一个明确的「再试一次」入口。
   * 副本失败走 `showDungeonFail()`，虎门炮台史实必败走 `playDefeatSequence()`，其余到这里。
   * 面板期间 `updateWorld` 整体冻结，敌人不会在弹窗后面继续围殴尸体。
   */
  private showStoryFail(): void {
    this.closeWeaponBag('auto');
    if (this.storyFailOpen || !this.scene.isActive()) return;
    this.storyFailOpen = true;
    this.nodeBusy = true;
    setInputEnabled(false);
    setControlsVisible(false);
    // 面板一开就冻结 updateWorld，HUD 不会自己再刷一次；手动把血条推到 0
    this.pushHud();

    const cx = VIEW_W / 2;
    const cy = VIEW_H / 2;
    const overlay = this.add.container(0, 0).setDepth(DEPTH.overlay).setScrollFactor(0);
    overlay.add([
      this.add.rectangle(cx, cy, VIEW_W, VIEW_H, PALETTE.ink, 0.72).setScrollFactor(0),
      this.add
        .rectangle(cx, cy, 300, 132, PALETTE.ink, 0.98)
        .setStrokeStyle(1, PALETTE.greyPlum)
        .setScrollFactor(0),
      this.add
        .text(cx, cy - 42, '战败', {
          fontFamily: FONT_UI,
          fontSize: '15px',
          color: '#F2A08C',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
      this.add
        .text(cx, cy - 18, '这一场没能守住 —— 可以从头再来。', {
          fontFamily: FONT_UI,
          fontSize: '9.5px',
          color: '#C2BCD1',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    ]);
    this.dungeonButton(overlay, cx - 62, cy + 26, 104, 22, '再试一次', () => {
      overlay.destroy();
      this.storyFailOpen = false;
      setInputEnabled(true);
      setControlsVisible(true);
      void this.startNode(this.nodeIndex);
    });
    this.dungeonButton(overlay, cx + 62, cy + 26, 104, 22, '返回长廊', () => {
      overlay.destroy();
      this.storyFailOpen = false;
      setInputEnabled(true);
      setControlsVisible(true);
      this.scene.stop('UI');
      this.scene.start('Hub', { chapterId: this.act.chapter_id });
    });
  }

  private dungeonButton(
    c: Phaser.GameObjects.Container,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    onClick: () => void,
  ): void {
    const r = this.add
      .rectangle(x, y, w, h, PALETTE.redDark, 0.95)
      .setStrokeStyle(1, PALETTE.ink)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    const t = this.add
      .text(x, y, text, { fontFamily: FONT_UI, fontSize: '10px', color: '#F2EDE4' })
      .setOrigin(0.5)
      .setScrollFactor(0);
    c.add(r);
    c.add(t);
    r.on('pointerdown', onClick);
    t.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
  }

  private leaveDungeon(): void {
    this.closeWeaponBag('auto');
    const chapterId = this.dungeon?.chapter_id ?? 'ch00';
    setInputEnabled(true);
    setControlsVisible(true);
    this.scene.stop('UI');
    this.scene.start('Hub', { chapterId });
  }

  /* ==================== 演示版：战败也继续（老师要求的闭环） ==================== */

  /**
   * 虎门炮台这一战史实上就是输的。玩家血条空了以后不走「重打一次」，
   * 而是：战败弹窗 → 《南京条约》签订演出 → 清王朝血条下跌 → 关天培牺牲 → 继续推进。
   * 整条链每一步都只往前走，不会把玩家卡在任何一个画面上。
   */
  private playDefeatSequence(): void {
    const p = this.node?.params ?? {};
    const title = String(p.defeat_title ?? '战败');
    const lines = (p.defeat_lines as string[] | undefined) ?? [];
    const treaty = (p.treaty_lines as string[] | undefined) ?? [];
    this.defeated = true;
    this.mode = 'cutscene';
    setControlsVisible(false);
    this.nodeBusy = true;
    this.player.hp = 0;

    // 甲方要求（m06955）：先放「城破」演出，再弹战败卡。演出自己负责定格、藏 HUD、
    // 镜头拉远、音效与大字；结束时把镜头与 HUD 复原，这里接着走原来的三段剧情。
    this.startBreachCinematic(p, () => this.runDefeatCards(p, title, lines, treaty));
  }

  /** 城破演出：文案优先取节点数据，缺省用 `core/defeat.ts` 的兜底 */
  private startBreachCinematic(p: Record<string, unknown>, onDone: () => void): void {
    const opts = {
      title: String(p.breach_title ?? DEFEAT_TEXT.title),
      line: String(p.breach_line ?? DEFEAT_TEXT.line),
      note: String(p.breach_note ?? DEFEAT_TEXT.note),
      onDone: () => {
        this.breachCinema = null;
        onDone();
      },
    };
    this.breachCinema?.destroyAll();
    this.breachCinema = new DefeatCinematic(this);
    this.breachCinema.play(opts);
    // 演出期间 `updateWorld` 靠 `mode === 'cutscene'` 停住，不需要额外闸门
    void this.breachCinema;
  }

  /** 城破之后的三段卡：战败经过 → 《南京条约》 → 清王朝血条下跌 → 关天培殉国 */
  private runDefeatCards(
    p: Record<string, unknown>,
    title: string,
    lines: string[],
    treaty: string[],
  ): void {
    this.showCard(title, lines, () => {
      this.showCard('《南京条约》', treaty, () => {
        const before = this.save.progress.dynasty ?? DYNASTY_MAX;
        const after = applyDynastyDelta(before, Number(p.dynasty_delta ?? 0));
        this.save.progress.dynasty = after;
        persist();
        this.pushHud();
        this.showDynastyDrop(before, after, () => {
          this.showCard(
            '关天培　虎门',
            [
              '「吾今有死而已，尔等可去。」',
              '1841 年 2 月 26 日，关天培中弹殉国，虎门炮台失守。',
              '他守的不是一座炮台，是一个已经关不上的国门。',
            ],
            () => {
              emitToast('历史继续向前', 1600);
              this.completeNode(true);
            },
          );
        });
      });
    });
  }

  private showCard(title: string, lines: string[], onDone: () => void): void {
    const overlay = this.add.container(0, 0).setDepth(DEPTH.overlay).setScrollFactor(0);
    const bg = this.add
      .rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, PALETTE.ink, 0.94)
      .setScrollFactor(0)
      .setInteractive();
    overlay.add(bg);
    // 标题带一条金色横线，读起来像「史料卡片」
    overlay.add(
      this.add
        .text(VIEW_W / 2, 56, title, {
          fontFamily: FONT_UI,
          fontSize: '18px',
          color: '#F0C419',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    overlay.add(
      this.add
        .rectangle(VIEW_W / 2, 70, 60, 1, PALETTE.star, 0.8)
        .setScrollFactor(0),
    );
    lines.slice(0, 4).forEach((ln, i) => {
      overlay.add(
        this.add
          .text(VIEW_W / 2, 96 + i * 24, ln, {
            fontFamily: FONT_UI,
            fontSize: '10.5px',
            color: '#F2EDE4',
            align: 'center',
            wordWrap: { width: VIEW_W - 60 },
          })
          .setOrigin(0.5)
          .setScrollFactor(0),
      );
    });
    const hint = this.add
      .text(VIEW_W / 2, VIEW_H - 34, '点击继续', {
        fontFamily: FONT_UI,
        fontSize: '10px',
        color: '#C2BCD1',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    overlay.add(hint);
    this.tweens.add({ targets: hint, alpha: { from: 0.35, to: 1 }, duration: 700, yoyo: true, repeat: -1 });

    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      this.pendingCardTap = null;
      overlay.destroy();
      onDone();
    };
    this.pendingCardTap = fire;
    bg.on('pointerdown', fire);
    this.input.keyboard?.once('keydown-ENTER', fire);
    this.input.keyboard?.once('keydown-SPACE', fire);
  }

  /** E2E / 键盘共用的「继续」入口 */
  tapCard(): void {
    this.pendingCardTap?.();
  }

  /**
   * 战斗开场「情境卡」：一张海战背景 + 时间、地点、双方兵力。
   *
   * 甲方（老师）的要求原话是「背景上写上时间，地点，对方出兵数量，背景是海面斗争」。
   * 卡片期间世界冻结（`introOpen`），否则敌人会在卡片后面把玩家打死。
   */
  private showBattleIntro(b: BannerDef, onDone: () => void = () => {}): void {
    this.introOpen = true;
    // 卡片是整屏的：HUD 与对白都要收起来，否则年份大字会压在战役条上
    // （第一版截图里就撞在一起了），上一节点的台词也会从卡片边上露出来。
    setHudVisible(false);
    this.dialogue?.hide();
    const c = this.add.container(0, 0).setDepth(DEPTH.overlay).setScrollFactor(0);
    // 底图按「哪张图最切题」挑：海战场景用甲方 m12276 那张黄昏双舰全景的天空段
    // （舰影冒烟、天色压暗，和开打后的战场远景是同一张图的上下两截，读起来是同一个地方）；
    // 其他场景继续用那张红色破晓全景。两张都没有时 backdropImage 会程序化画。
    const introKey = b.scene === 'sea' && this.textures.exists(BG_TEX.skyDusk) ? BG_TEX.skyDusk : null;
    const backdrop = introKey
      ? this.add
          .image(VIEW_W / 2, VIEW_H / 2, introKey)
          .setOrigin(0.5, 0.5)
          // 天空段是 480×128，铺满 480×270 要拉高，等比放大到宽度即可
          .setScale(Math.max(VIEW_W / 480, VIEW_H / 128))
          .setScrollFactor(0)
      : backdropImage(this, 0).setScrollFactor(0);
    c.add(backdrop);
    // 顶部与底部的压暗条，让文字在浪花上也读得清
    c.add(this.add.rectangle(VIEW_W / 2, 46, VIEW_W, 92, PALETTE.ink, 0.55).setScrollFactor(0));
    c.add(this.add.rectangle(VIEW_W / 2, VIEW_H - 44, VIEW_W, 88, PALETTE.ink, 0.6).setScrollFactor(0));

    // ── 文字全部走 DOM overlay（canvas 上中文在高 dpr 屏发糊）
    const powerRows = b.power
      ? [
          { tag: '我', val: b.power.ours, color: '#7FD1AE' },
          { tag: '敌', val: b.power.enemy, color: '#E85C4A' },
        ]
      : [];
    const troopRows: Array<[string, string]> = [];
    if (b.ours) troopRows.push(['我方', b.ours]);
    if (b.enemy) troopRows.push(['敌军', b.enemy]);

    const powerHtml = b.power
      ? `<div style="position:absolute;left:118px;right:46px;top:150px;">
          <div style="color:#F0C419;font-weight:bold;font-size:13px;margin-bottom:4px;">${b.power.title ?? '战力对比'}</div>
          ${powerRows
            .map(
              (r) => `<div style="margin:2px 0;"><span style="color:${r.color};font-weight:bold;font-size:14px;margin-right:8px;">${r.tag}</span><span style="font-size:14px;">${r.val}</span></div>`,
            )
            .join('')}
          ${b.power.gap ? `<div style="color:#F0C419;font-size:14px;margin-top:6px;">${b.power.gap}</div>` : ''}
        </div>`
      : '';

    const troopHtml =
      troopRows.length > 0
        ? `<div style="position:absolute;left:118px;right:46px;top:210px;background:rgba(13,11,20,.42);padding:4px 8px;">
          ${troopRows
            .map(
              ([label, value]) =>
                `<div style="margin:2px 0;"><span style="color:${label === '敌军' ? '#E85C4A' : '#C2BCD1'};font-size:12px;margin-right:12px;">${label}</span><span style="font-size:14px;">${value}</span></div>`,
            )
            .join('')}
        </div>`
        : '';

    showOverlay(
      `<div style="position:absolute;left:0;top:24px;width:100%;text-align:center;color:#F0C419;font-weight:bold;font-size:26px;">${b.time}</div>
       <div style="position:absolute;left:0;top:52px;width:100%;text-align:center;font-size:16px;">${b.place}</div>
       ${powerHtml}
       ${troopHtml}
       <div id="dom-hint" style="position:absolute;left:0;top:252px;width:100%;text-align:center;color:#F0C419;font-size:13px;animation:blink 1.4s ease-in-out infinite;">点击开始战斗</div>
       <style>@keyframes blink{0%,100%{opacity:.4}50%{opacity:1}}</style>`,
    );

    const close = () => {
      if (!this.introOpen) return;
      this.introOpen = false;
      this.pendingCardTap = null;
      c.destroy();
      hideOverlay();
      setHudVisible(true);
      // 卡片期间摇杆也收着，关掉要按当前模式重新放出来
      setControlsVisible(this.mode === 'explore' || this.mode === 'combat' || this.mode === 'escort');
      this.pushHud();
      onDone();
    };
    const bg = this.add
      .rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, PALETTE.ink, 0.001)
      .setScrollFactor(0)
      .setInteractive();
    c.add(bg);
    bg.on('pointerdown', close);
    this.input.keyboard?.once('keydown-ENTER', close);
    this.input.keyboard?.once('keydown-SPACE', close);
    // 卡片本身也注册成「点击继续」，E2E 的 tapCard() 才能推进
    this.pendingCardTap = close;
  }

  /**
   * 波次强化三选一：清完一波后屏幕中间的选卡。
   *
   * 甲方原话「每波次强化系统，只对弓强化，比如弹幕变两行之类的，以确保玩家能看到英军军舰，
   * 不然死太快了」。所以这里给的是**看得见的质变**（箭矢从 1 行变 2 行、3 行），
   * 而不是 +5% 伤害那种玩家感觉不到的数字。
   *
   * v1.7：近战武器补齐同一套卡片，标题/条目名/效果按 `upgradeClass` 分派
   * （横扫=扇形加宽、火线=攻速、破甲=挥砍伤害），状态按武器实例隔离。
   * 触发时机、三选一、上限 6 次、本关内重置与弓完全一致。
   *
   * 实现要点（都踩过）：
   *   1. 世界必须冻结 —— 复用 `introOpen`，`updateWorld` 开头 `if (this.introOpen) return;`；
   *   2. 卡开着时要让 `tapCard()` 能点，所以写 `pendingCardTap`，关的时候**必须清回 null**，
   *      否则 `setControlsVisible` 会一直以为有卡、把摇杆收着；
   *   3. 三个按钮各自 `setInteractive` 并 `on('pointerdown')`，**不要**在卡片底板上也挂点击，
   *      底板吃掉点击会让选中的那一下变成「跳过」（早期情境卡就是这么坏的）；
   *   4. 键盘 1/2/3 也能选，手柄/无触摸的环境下不至于卡死。
   */
  /**
   * 武器实例 key：优先用装备 uid（同一 `weapon_ref` 的不同装备实例各自独立），
   * 装备槽与手上武器对不上时（剧情掉落弓、老存档没 `weapon_ref`）回落到武器 ref。
   * 这样换装、捡弓、重进关卡都不会把两把武器的强化串在一起。
   */
  private upgradeKey(): string {
    const w = this.player?.weapon;
    if (!w) return 'weapon:none';
    const eq = this.save?.equipment?.weapon;
    const ref = eq?.weapon_ref ?? (eq ? dataLoader.findItemBase(eq.base_id)?.weapon_ref : undefined);
    return eq && ref === w.id ? `uid:${eq.uid}` : `ref:${w.id}`;
  }

  /** 当前手持武器实例在本关累积的强化（没有就返回全 0，不写入 book） */
  private currentUpgrades(): UpgradeState {
    return this.upgradeBook.get(this.upgradeKey());
  }

  private currentUpgradeClass(): UpgradeClass {
    return this.player ? upgradeClass(this.player.weapon) : 'other';
  }

  /** 探针用的武器实时参数快照（`bowInfo` / `weaponInfo` 共用一份，字段名向后兼容） */
  private debugWeaponInfo() {
    const w = this.player.weapon;
    const cls = this.currentUpgradeClass();
    const up = this.currentUpgrades();
    const tune = this.upgradeTuning();
    const base = 1000 / (w.attacks_per_sec || 1);
    const h = cls === 'other' ? 1 : hasteMult(up, tune);
    return {
      id: w.id,
      weaponClass: cls,
      key: this.upgradeKey(),
      baseMs: base,
      actualMs: base / h,
      arrows: cls === 'bow' ? volleyRows(up) : 1,
      arcMult: sweepArcMult(up, tune),
      cleaveMult: cleaveDmgMult(up, tune),
      summary: upgradeSummary(up, cls, tune),
    };
  }

  private showUpgradeCard(onDone: () => void): void {
    // 绑定弹卡那一刻的实例与类别：卡片期间世界冻结，但键盘连点 / 延迟回调
    // 仍可能落到「武器已经换过」的状态，用局部快照避免把强化记到别的武器上。
    const key = this.upgradeKey();
    const cls = this.currentUpgradeClass();
    const state = this.upgradeBook.get(key);
    const tune = this.upgradeTuning();
    const choices = upgradesExhausted(state) ? [] : pickUpgradeChoices(state, rng, cls);
    if (choices.length === 0) {
      // 兜底：波次推进处已经按当前实例过滤过了。这里**不能**再永久关掉 pendingUpgrade，
      // 否则玩家换一把没满级的武器后，这一关就再也弹不出卡了。
      onDone();
      return;
    }
    const isMelee = cls === 'melee';
    this.introOpen = true;
    this.upgradeOpen = true;
    setHudVisible(false);
    this.dialogue?.hide();
    // 清波常会带出「敌兵丢下一把猎弓」之类的 toast，DOM 层浮在 canvas 之上，
    // 会正好压住中间那张卡。开卡先收掉；选完的「强化：…」toast 在 finish 里另发。
    hideToast();

    const c = this.add.container(0, 0).setDepth(DEPTH.overlay).setScrollFactor(0);
    c.add(
      this.add
        .rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, PALETTE.ink, 0.82)
        .setScrollFactor(0),
    );
    c.add(
      this.add
        .text(VIEW_W / 2, 34, isMelee ? '近 战 精 进' : '弓 术 精 进', {
          fontFamily: FONT_UI,
          fontSize: '18px',
          color: '#F0C419',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    c.add(
      this.add
        .text(VIEW_W / 2, 54, `第 ${this.waveIndex} 波已清 · 选一项强化（${isMelee ? '只作用于当前近战武器' : '只作用于弓'}）`, {
          fontFamily: FONT_UI,
          fontSize: '10px',
          color: '#C2BCD1',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    // 当前已生效的强化，让玩家知道自己叠到哪一步了
    const cur = upgradeSummary(state, cls, tune);
    c.add(
      this.add
        .text(VIEW_W / 2, 70, cur ? `当前：${cur}` : isMelee ? '当前：基础挥砍' : '当前：单发弓箭', {
          fontFamily: FONT_UI,
          fontSize: '9px',
          color: '#8E88A0',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );

    const cardW = 132;
    const cardH = 96;
    const gap = 12;
    const totalW = cardW * choices.length + gap * (choices.length - 1);
    const startX = VIEW_W / 2 - totalW / 2 + cardW / 2;
    const cardY = VIEW_H / 2 + 6;

    let closed = false;
    const finish = (id: UpgradeId | null) => {
      if (closed) return;
      closed = true;
      if (id) {
        // 写回**弹卡时绑定的那个实例**，不是此刻的 this.currentUpgrades()：
        // 键盘连点或延迟回调里武器可能已被换掉，记错 key 就等于给别人加强化。
        const next = this.upgradeBook.set(key, applyUpgrade(state, id));
        // 选完立刻把新数值亮出来，玩家才知道自己刚选的东西生效了
        const sum = upgradeSummary(next, cls, tune);
        emitToast(sum ? `强化：${sum}` : '强化已生效', 1600);
      }
      this.introOpen = false;
      this.upgradeOpen = false;
      this.pendingCardTap = null;
      c.destroy();
      setHudVisible(true);
      setControlsVisible(this.mode === 'explore' || this.mode === 'combat' || this.mode === 'escort');
      this.pushHud();
      onDone();
    };

    choices.forEach((u, i) => {
      const x = startX + i * (cardW + gap);
      const box = this.add
        .rectangle(x, cardY, cardW, cardH, PALETTE.ink, 0.92)
        .setStrokeStyle(1, 0x6b2330)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      c.add(box);
      c.add(
        this.add
          .text(x, cardY - 30, u.name, {
            fontFamily: FONT_UI,
            fontSize: '14px',
            color: '#F0C419',
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setScrollFactor(0),
      );
      c.add(this.add.rectangle(x, cardY - 14, 60, 1, PALETTE.star, 0.7).setScrollFactor(0));
      c.add(
        this.add
          .text(x, cardY + 8, describeNext(state, u.id, cls, tune), {
            fontFamily: FONT_UI,
            fontSize: '9px',
            color: '#F2EDE4',
            align: 'center',
            wordWrap: { width: cardW - 16 },
          })
          .setOrigin(0.5)
          .setScrollFactor(0),
      );
      c.add(
        this.add
          .text(x, cardY + 36, `[${i + 1}] 选择`, {
            fontFamily: FONT_UI,
            fontSize: '9px',
            color: '#C2BCD1',
          })
          .setOrigin(0.5)
          .setScrollFactor(0),
      );
      box.on('pointerover', () => box.setStrokeStyle(2, 0xf0c419));
      box.on('pointerout', () => box.setStrokeStyle(1, 0x6b2330));
      box.on('pointerdown', () => finish(u.id));
    });

    // 跳过：不想强化也要能继续打（不能强制玩家选）
    const skip = this.add
      .text(VIEW_W / 2, VIEW_H - 16, '放弃强化，继续战斗（空格）', {
        fontFamily: FONT_UI,
        fontSize: '9px',
        color: '#8E88A0',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    skip.on('pointerdown', () => finish(null));
    c.add(skip);

    choices.forEach((u, i) => {
      const key = `keydown-${['ONE', 'TWO', 'THREE'][i]}`;
      if (key) this.input.keyboard?.once(key, () => finish(u.id));
    });
    this.input.keyboard?.once('keydown-SPACE', () => finish(null));
    // E2E 靠 tapCard() 推进：它只认 `pendingCardTap`，所以这里指向「选第一项」
    this.pendingCardTap = () => finish(choices[0].id);
  }

  /** 清王朝血条下跌：一根横条从 before 掉到 after，停 1.2 秒后自动继续 */
  private showDynastyDrop(before: number, after: number, next: () => void): void {
    const overlay = this.add.container(0, 0).setDepth(DEPTH.overlay).setScrollFactor(0);
    overlay.add(
      this.add
        .rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, PALETTE.ink, 0.9)
        .setScrollFactor(0)
        .setInteractive(),
    );
    overlay.add(
      this.add
        .text(VIEW_W / 2, 92, '清王朝', {
          fontFamily: FONT_UI,
          fontSize: '14px',
          color: '#F2EDE4',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    const barW = 260;
    overlay.add(
      this.add
        .rectangle(VIEW_W / 2, 122, barW + 2, 12, PALETTE.ink, 0.9)
        .setStrokeStyle(1, PALETTE.greyPlum)
        .setScrollFactor(0),
    );
    const fill = this.add
      .rectangle(VIEW_W / 2 - barW / 2, 122, Math.max(1, (barW * before) / DYNASTY_MAX), 10, PALETTE.redBright)
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    overlay.add(fill);
    const lost = Math.max(0, before - after);
    const deltaTxt = this.add
      .text(VIEW_W / 2, 146, lost > 0 ? `国运 −${lost}` : '国运已尽', {
        fontFamily: FONT_UI,
        fontSize: '11px',
        color: '#E85C4A',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    overlay.add(deltaTxt);
    overlay.add(
      this.add
        .text(VIEW_W / 2, 170, `${after} / ${DYNASTY_MAX}`, {
          fontFamily: FONT_UI,
          fontSize: '9px',
          color: '#948DAB',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );

    this.tweens.add({
      targets: fill,
      width: Math.max(1, (barW * after) / DYNASTY_MAX),
      duration: 900,
      delay: 260,
      ease: 'Quad.easeInOut',
    });
    this.time.delayedCall(1900, () => {
      overlay.destroy();
      // 让玩家手动继续，避免一眨眼就错过
      this.showCard('国运', ['每一次战败，都要在账本上记一笔。'], next);
    });
  }

  /* ==================== 节点调度 ==================== */

  /**
   * 切节点门禁：整段 async 流程（含 `await buildWorld`）都要把世界逻辑冻住。
   *
   * 旧版 startNode 在换图让出的那一帧里，mode 还是上一幕、玩家还在上一幕坐标，
   * 而 nodeBusy 已被提前置回 false —— 护送幕的「抵达终点」判定于是二次命中
   * completeNode()，把刚要进场的天京经营节点标记完成并排队跳到内讧幕。
   * 玩家看到的就是经营面板闪一下就没了（甲方截图，面板只活了约 500ms）。
   */
  private async startNode(index: number): Promise<void> {
    const ticket = ++this.nodeStartSeq;
    this.transitioning = true;
    this.nodeBusy = true;
    this.closeWeaponBag('auto');
    try {
      await this.startNodeInner(index);
    } finally {
      // 只有最后一次调用有权解锁：并发/重试时旧流程的 finally 不能提前放开门禁
      if (ticket === this.nodeStartSeq) {
        this.transitioning = false;
        // 中途抛错也不能把节点永久锁死（历史上 transitioning 卡住会让波次停摆）
        if (this.nodeBusy) this.nodeBusy = false;
      }
    }
  }

  private async startNodeInner(index: number): Promise<void> {
    const nodeId = this.act.nodes[index];
    const node = this.bundle.nodes.find((n) => n.id === nodeId);
    if (!node) {
      this.finishAct();
      return;
    }
    this.node = node;
    this.nodeIndex = index;
    // 换图是 await：模式必须在这个异步窗口之前切过去，否则让出的一帧里
    // updateWorld 仍会按上一幕的模式跑完成判定（护送 → 经营串幕的根因）。
    this.mode = ((node.params.mode as Mode) ?? 'explore') as Mode;
    // 左上角战役条：幕名 · 这一场 + 年份（老师评审时要一眼看出打的是哪一段史实）
    emitSceneLabel({
      act: this.act.name,
      title: node.title ?? this.act.name,
      year: node.year,
      // 甲方要求：背景上要写清时间、地点、对方出兵数量
      ...(node.banner
        ? { time: node.banner.time, place: node.banner.place, enemy: node.banner.enemy }
        : {}),
    });
    // nodeBusy 保持 true 直到本节点完全就绪（函数末尾统一放开）。
    // 旧版在这里提前置 false，正好把 async 换图窗口暴露给上一幕的完成判定。
    this.wavePending = false;
    this.waveIndex = -1;
    this.bossSpawned = false;
    this.enemyLevel = Number(node.params.recommended_level ?? this.save.player.level);

    // 先清理上一节点的实体，再构建/保留地图。
    // 注意顺序：buildWorld 会创建本幕的可交互物，必须在 clearWorldObjects 之后调用，
    // 否则新生成的对象会被立刻销毁（曾出现过的 bug）。
    this.clearEnemies();
    this.clearProjectiles();
    this.clearFloorItems();
    this.clearAllies();
    this.manageUI?.destroy();
    this.manageUI = null;
    this.manage = null;
    hideOverlay();

    const mapRef = (node.map_ref as string | null) ?? null;
    if (mapRef && (!this.map || this.map.def.id !== mapRef)) {
      this.clearWorldObjects();
      await this.buildWorld(mapRef);
    }

    this.carrying = false;
    this.cratesDelivered = 0;
    this.crateTarget = Number(node.params.crate_target ?? 8);
    // 上一幕的「!」标记与闸门不能带进这一幕
    this.npcTalked = false;
    this.npcTalkObjId = null;
    this.npcDialogueRef = null;
    this.npcMark?.destroy();
    this.npcMark = null;

    const stats = effectiveStats(
      this.save.player.level,
      this.save.knowledge.length,
      this.save.equipment,
      this.cfg,
    );
    this.player.resetForNode(stats);
    this.applyEquippedWeapon();
    // 重试必须回到关卡出生点：以前只把 alive 翻回 true，玩家还站在倒下的位置，
    // 看起来就是「原地诈尸」。地图没换时 buildWorld 不会重跑，这一步得在这里做。
    const spawn = this.map?.def.spawn;
    if (spawn) this.player.rig.setPosition((spawn.x + 0.5) * TILE, (spawn.y + 0.5) * TILE);

    // 第一幕「搬鸦片箱投销烟池」的 pickup 是专属可交互物，只在探索关有意义。
    // 战斗 / 经营 / 护送关里出现就会串幕（天京战场残留两箱、头顶还带金色标记）。
    // 数据层已把太平天国三张图的 pickup 换成静态布景，这里是兜底防线：
    // 任何地图误带 pickup 进非探索关，都不会被画出来、也不会出现在交互候选里
    // （findNearObject 会跳过 rect.visible === false 的物件）。
    if (this.mode !== 'explore' || this.crateTarget <= 0) {
      for (const o of this.worldObjects) {
        if (o.def.kind === 'pickup') this.hideWorldObject(o);
      }
    }

    switch (this.mode) {
      case 'explore':
        this.setupExplore();
        break;
      case 'combat':
        this.setupCombat();
        break;
      case 'escort':
        this.setupEscort();
        break;
      case 'management':
        this.setupManagement();
        break;
      case 'cutscene':
        this.setupCutscene();
        break;
      case 'choice':
        this.setupChoice();
        break;
    }

    // 虚拟摇杆与三个战斗键只在「要走动」的模式下出现。
    // 经营/抉择/过场都是纯面板操作，摇杆压上去会盖住面板文字（截图里已经发生过）。
    setControlsVisible(this.mode === 'explore' || this.mode === 'combat' || this.mode === 'escort');
    // 「炮」只在战斗幕出现（甲方要求：别的场景不该留一个按不动的技能键）
    setCannonVisible(this.mode === 'combat' && !!this.cfg.skills?.humen_cannon);

    // 节点自身的开场对话。
    // 有开场情境卡时，对白要等卡片关掉再开始——否则对白框会被卡片盖住，
    // 名字与「▼ 继续」还从卡片边上露出来（截图已见到）。
    const dref = node.dialogue_ref as string | undefined;
    const hasBanner = !!node.banner;
    if (dref && !hasBanner && this.mode !== 'cutscene' && this.mode !== 'choice') {
      this.playDialogue(dref);
    }

    // 战斗开场情境卡：时间 / 地点 / 双方兵力（甲方要求「背景上写清这三样」）。
    // 必须放在节点就绪之后、对白之前不需要——它是全屏卡片，对白会被它盖住，
    // 所以对白在卡片之后才开始读（playDialogue 只是创建实例，未 active 时不显示）。
    if (node.banner) {
      emitSceneLabel({
        act: this.act.name,
        title: node.title ?? this.act.name,
        year: node.year,
        time: node.banner.time,
        place: node.banner.place,
        enemy: node.banner.enemy,
      });
      this.showBattleIntro(node.banner, () => {
        // 卡片关掉后才真正开打（见 setupCombat 里的说明）。
        // 有开场对白的，要等对白读完再上第一波——否则敌人会在对话条后面推进来。
        const startWaves = () => {
          if (this.mode !== 'combat' || this.dungeon) return;
          this.time.delayedCall(500, () => {
            emitToast('第 1 波敌军来袭', 1400);
            this.spawnWave(0);
          });
        };
        if (dref && this.mode !== 'cutscene' && this.mode !== 'choice') {
          this.playDialogue(dref, startWaves);
        } else {
          startWaves();
        }
      });
    }

    // 世界与模式都已就绪，此时才允许本节点被完成
    this.nodeBusy = false;
    this.pushHud();
  }

  private async buildWorld(mapId: string): Promise<void> {
    // 重入保护：`buildWorld` 是 async，第一行就在等 `loadMap`。
    // 如果这期间又有人调了一次（切节点 / 重进关卡撞在一起），两个执行流会各自往下跑，
    // 后者的 `this.map?.destroy()` 看到的是**前者刚建好的实例**，把前者的地图销毁掉；
    // 而前者自己那张 map / ground 纹理、人群贴图、远景条就此失去引用，永远留在显示列表上。
    // 表现就是：虎门炮台那张图里凭空多出销烟池的 10 个围观百姓 + 3 张地面纹理。
    // 用一个序号做「最后一次调用说了算」：后来的直接让前面那个作废。
    const ticket = ++this.worldBuildSeq;
    const def = await dataLoader.loadMap(mapId);
    if (ticket !== this.worldBuildSeq) return;
    // 载入地图是异步的：这期间玩家可能已经切场景/退出关卡（场景 shutdown 会把
    // camera 管理器一起销毁），此时再往下走会抛
    // "Cannot read properties of undefined (reading 'setBounds')"。
    if (!this.scene.isActive() || !this.cameras?.main) return;
    this.map?.destroy();
    this.clearWorldObjects();
    // 围观百姓是直接 add 到显示列表的（不进 worldObjects，否则会变成可交互目标），
    // 所以换图时必须自己收：`MapRenderer.destroy()` 只清它自己的图层。
    // 漏了这一步的后果不是「多画几个人」那么轻——上一张图（销烟池）的 10 个百姓
    // 会原地留在下一张图（虎门炮台）的战场上，玩家看到一排水灵灵的大脑袋，
    // 既不能打也不能互动，还挡路。这个 bug 是截图评审抓出来的，断言全绿时它照样在。
    this.crowdSprites.forEach((s) => {
      this.tweens.killTweensOf(s);
      s.destroy();
    });
    this.crowdSprites = [];
    this.crowdSolids.clear();
    this.propSprites.forEach((p) => p.img.destroy());
    this.propSprites = [];
    this.floorItems.forEach((f) => this.destroyFloorItem(f));
    this.floorItems = [];

    this.map = new MapRenderer(this, def);
    // 海水当碰撞格：船把海面推过来之后，玩家与敌人都不能站进去
    // （否则敌人被打退到海里就再也打不到，闪现进水坑也出不来）。
    // 围观百姓也走这里：人物站在场上是「体积」，不是地形，所以不进 JSON 的碰撞层。
    this.map.extraSolid = (wx, wy) => this.isSeaAt(wx, wy) || this.isCrowdAt(wx, wy);
    // 地图顶上留了 `sky_rows` 行不画地砖：在那条带上叠远景（天空 + 海 + 敌舰剪影），
    // 战斗时才有「炮台外就是海面」的情境（玩家要求「战斗的时候也要有背景」）。
    // 远景放在地面层之下，靠地砖的透明区露出来；实体仍在它上面，走过那条带不会被挡。
    if ((def.sky_rows ?? 0) > 0) {
      // 1.6 倍：见 `horizonImage` 的注释——原尺寸的船太小，放太大又跟场上的小人抢视觉。
      // 放大后宽度 768 > 480，所以左右居中裁掉两头。
      //
      // 纵向**必须是「顶边贴 0、往下溢出」**，不能底边对齐：
      // 这条带的上半截会被顶部战役条（标题 + 时间地点 + 敌方兵力，约 70px）盖住，
      // 底边对齐的话敌舰正好长在那块被盖掉的位置上——截图里只剩几根桅杆露出来，
      // 看着像背景没画好。顶边贴 0 让船身落在可见的下半段，桅杆被 UI 压住也不碍事，
      // 读起来反而像「远处的船被台沿挡住」，比整艘船悬在空地中间更合理。
      const ZOOM = 1.6;
      // 只替换 1864 天京城破之战这一张背景图：tp_act2 图集 + 有远景带才走
      // 火光/浓烟条带；其它关卡（当前 sky_rows 均为 0）不叠远景条，仍走
      // horizonImage 的 dusk 默认分支。布局/文案/前景与其它素材一律不动，
      // 缺图时 horizonImage 自动回退 dusk，不会黑屏。
      const horizonPrefer: 'cityfall' | 'dusk' = def.tileset === TP_TILESET_ID ? 'cityfall' : 'dusk';
      horizonImage(this, DEPTH.ground - 1, horizonPrefer, ZOOM).setScrollFactor(0).setPosition(-(VIEW_W * (ZOOM - 1)) / 2, 0);
      // 海面与石台的交界：铺一层很淡的暗影，让「海在远处、台子在前」有纵深。
      // 没有这层的话，海平线与第一行地砖是一条刀刃般的硬线，看着像两张图上下拼接。
      // 注意**只压在海这一侧**（bandBottom 之上），不能越过 bandBottom：
      // 越过去就会把战场第一行地砖也压暗，读成「地砖上有一道黑边」——第一版就是这么错的。
      const bandBottom = Math.min(VIEW_H, HORIZON_H * ZOOM);
      const fade = this.add.graphics().setDepth(DEPTH.ground).setScrollFactor(0);
      for (let i = 0; i < 8; i++) {
        fade.fillStyle(PALETTE.ink, 0.06 + i * 0.03);
        fade.fillRect(0, bandBottom - 8 + i, VIEW_W, 1);
      }
    }
    // 渲染顺序：地图 graphics 在 depth 0/10，实体在 20+
    for (const layer of def.layers) void layer;

    // 孤儿地面层兜底清理。放在这里而不是 `new MapRenderer` 之后紧接着：
    // 构造函数回来时 `groundKey` 还是 null（要点进 `drawGround` 才有），
    // 那时候比较 key 会把「刚建好的这一张」也当成孤儿删掉——地面直接黑成一片。
    // 所以等地图确实烘完（这里之后不会再画地面）再清。
    this.sweepOrphanGrounds();

    const spawn = { x: (def.spawn.x + 0.5) * TILE, y: (def.spawn.y + 0.5) * TILE };

    if (!this.player) {
      const weaponId = this.bestWeapon();
      const weapon = this.cfg.weapons[weaponId];
      this.player = new Player(this, spawn.x, spawn.y, { bodyColor: PALETTE.greenDark, weaponColor: PALETTE.greyLight }, weapon);
    } else {
      this.player.rig.setPosition(spawn.x, spawn.y);
    }
    // 军舰碾出来的海面只有玩家进不去（敌人是小艇，可以从水上逼近）
    this.player.setBlocker((x, y) => this.isSeaAt(x, y));
    // 波次强化的「火线」同时加快弓与全部近战武器，倍率取**当前武器实例**自己的状态；
    // 其它远程（火枪 / 机枪）不参与强化，保持 config.json 里的原始射速。
    // 钩子在每次 tryAttack 时调用，所以战斗内换武器会自动切到新武器的倍率，无需重设。
    this.player.setHasteHook(() => {
      const cls = this.currentUpgradeClass();
      return cls === 'other' ? 1 : hasteMult(this.currentUpgrades(), this.upgradeTuning());
    });

    // 故意**不用** `setBounds`：Phaser 的 `clampX` 是
    //   bx = bounds.x + (displayWidth - width) / 2
    // 其中 displayWidth 是逻辑单位（480）、width 是后缓冲像素（960），zoom≠1 时两者混算，
    // 结果 scrollX 会被永久钉在 -240/-135，整张地图偏右下半个屏幕（实测截图就是这样）。
    // `useBounds` 默认 false，不调 setBounds 就不会触发那套钳制；
    // 本项目的战场正好一屏，边界钳制由 cameraScrollTarget 用纯逻辑坐标做。
    this.cameras.main.setScroll(0, 0);
    // 摄像机自己算跟随，不用 `startFollow`。
    // 原因：开了 RENDER_SCALE 之后 `Camera.follow` 的公式是
    //   scrollX = 目标.x - followOffset.x - originX
    // 其中 originX 是**后缓冲像素**（origin 0.5 → 480），而 scroll/目标坐标都是逻辑单位，
    // 两套单位在 zoom 之后混在一起，实测 scroll 会变成 -240/-135 这种「差半屏」的值，
    // 画面整体被推到右下四分之一。手动写就没有这层歧义：一律用逻辑坐标。
    this.cameras.main.stopFollow();
    this.camFollow = { lerp: 0.14 };
    this.snapCameraToPlayer();
    this.worldBuilt = true;
    void this.worldBuilt;

    // 地图上的可交互物
    for (const obj of def.objects) {
      this.spawnWorldObject(obj);
    }
  }

  /**
   * 把镜头对准玩家（逻辑坐标）。
   * 可视范围恒为 480×270 —— 后缓冲是它的 R 倍，zoom 也是 R，两者抵消，
   * 所以这里完全不出现 RENDER_SCALE。
   */
  private cameraScrollTarget(): { x: number; y: number } {
    const cam = this.cameras.main;
    const z = cam.zoom > 0 ? cam.zoom : 1;
    const w = cam.width / z; // 逻辑可视宽
    const h = cam.height / z;
    const maxX = Math.max(0, (this.map?.pixelWidth ?? VIEW_W) - w);
    const maxY = Math.max(0, (this.map?.pixelHeight ?? VIEW_H) - h);
    return {
      x: Phaser.Math.Clamp(this.player.x - w / 2, 0, maxX),
      y: Phaser.Math.Clamp(this.player.y - h / 2, 0, maxY),
    };
  }

  private snapCameraToPlayer(): void {
    if (!this.player) return;
    const t = this.cameraScrollTarget();
    this.cameras.main.setScroll(t.x, t.y);
  }

  /** 每帧的平滑跟随，手感沿用原来 startFollow(lerp=0.14) 的松紧度 */
  private updateCameraFollow(): void {
    if (!this.camFollow || !this.player || !this.player.alive) return;
    const cam = this.cameras.main;
    const t = this.cameraScrollTarget();
    const k = this.camFollow.lerp;
    cam.scrollX += (t.x - cam.scrollX) * k;
    cam.scrollY += (t.y - cam.scrollY) * k;
  }

  private bestWeapon(): string {
    if (this.save.weapons.includes('wp_bow')) return 'wp_bow';
    return this.save.weapons[0] ?? 'wp_dao';
  }

  /**
   * 装备「存在感」P1：武器槽不再只是 +ATK 的数字挂件。
   *
   * `items_base.json` 里标了 `weapon_ref` 的武器装备，进关卡时真的换掉手上的武器：
   * 射程 / 攻速 / 倍率 / 近远程形态 / 手中条状物颜色全部跟着 config.json 走。
   * 老存档与没标字段的装备一律直接返回，`bestWeapon()` 的结果原样保留，零兼容风险。
   */
  private applyEquippedWeapon(keepCooldown = false): void {
    const equipped = this.save.equipment.weapon;
    // 老存档的实例没有 weapon_ref：按 base_id 回模板表补一次。
    // 面板提交时也会把字段写回实例，这里兜住「玩家从未打开过面板」的情况。
    const ref = equipped?.weapon_ref ?? (equipped ? dataLoader.findItemBase(equipped.base_id)?.weapon_ref : undefined);
    if (!ref) return;
    const w = this.cfg.weapons[ref];
    if (!w) return;
    const tint: Record<string, number> = {
      wp_dao: PALETTE.greyLight,
      wp_bow: PALETTE.brown,
      wp_crowbar: PALETTE.sand,
      wp_matchlock: PALETTE.redSoft,
      wp_mg: PALETTE.blueLight,
    };
    const color = tint[ref] ?? PALETTE.greyLight;
    // 战斗内换装保留攻击冷却；进关卡 / 节点奖励解锁武器仍是原来的归零语义
    if (keepCooldown) this.player.swapWeapon(w, color);
    else this.player.setWeapon(w, color);
  }

  /* ==================== 战斗内背包：切换武器（设计书 4.3.8） ====================
   *
   * 规则沿用现有的全屏面板做法（`showUpgradeCard` / 战败面板）：
   *   - 世界冻结：updateWorld 开头早退，敌人、投射物、波次判定都不再推进；
   *   - 输入关闸：setInputEnabled(false) + setControlsVisible(false) + controls.reset()；
   *   - 界面状态：setHudVisible(false) 收起 UIScene 整块 HUD 与顶部按钮，
   *     setWeaponBagVisible(true) 让 UIScene 不再响应「暂停」，两层面板不叠加；
   *   - 出口兜底：节点完成 / 副本结算 / 战败 / 切节点 / 阵亡都会置 nodeBusy 等
   *     门禁标志，updateWorld 每帧复检，失效即自动收起（各出口另有显式调用）。
   *
   * 切换的真值只有一处：`save.equipment.weapon`。提交成功后重算 effectiveStats →
   * Player.applyEquipmentStats（保血量 / 存活 / 冷却）→ applyEquippedWeapon(true)
   * 换掉 player.weapon（playerAttack 每帧读它）→ pushHud 刷新武器名。
   */

  private weaponBagGate(): WeaponBagGate {
    return {
      mode: this.mode,
      nodeBusy: this.nodeBusy,
      transitioning: this.transitioning,
      storyFailOpen: this.storyFailOpen,
      dungeonResultOpen: this.dungeonResultOpen,
      introOpen: this.introOpen,
      upgradeOpen: this.upgradeOpen,
      cardOpen: this.pendingCardTap !== null,
      dialogueActive: this.dialogue?.isActive ?? false,
      playerAlive: this.player?.alive ?? false,
      sceneActive: this.scene.isActive(),
      scenePaused: this.scene.isPaused(),
      cfgLoaded: !!this.cfg && !!this.save,
      bagOpen: this.weaponBagOpen,
    };
  }

  /** 打开（UIScene 按钮 / B 键 / 探针都走这里）。不可切换状态只给一条 toast，不改任何状态。 */
  private openWeaponBag(): void {
    const gate = canOpenWeaponBag(this.weaponBagGate());
    if (!gate.ok) {
      if (gate.reason !== 'panel_conflict') emitToast(gate.message, 1200);
      return;
    }
    // 上一次「不可切换」的 toast 还挂在 DOM 层时，会横压在面板列表上
    hideToast();
    const options = listWeaponOptions(this.save, this.cfg, dataLoader.getItems());
    this.weaponBagOpen = true;
    this.weaponBagOptions = options;
    this.weaponBagCursor = Math.max(0, options.findIndex((o) => o.available));
    this.weaponBagScroll = 0;
    this.weaponBagMessage = options.some((o) => o.available)
      ? '战斗已暂停 · 选中后立即生效'
      : '背包里没有可切换的武器';
    this.weaponBagHudBefore = getHudVisible();
    setInputEnabled(false);
    setControlsVisible(false);
    setHudVisible(false);
    setWeaponBagVisible(true);
    controls.reset();
    this.bindWeaponBagKeys();
    this.renderWeaponBag();
  }

  /**
   * 关闭。`cancel` 给一句回执；`switched` 由调用方另发换装 toast；
   * `auto` 是战斗结束 / 状态失效时的静默收起，不打扰玩家。
   */
  private closeWeaponBag(reason: 'cancel' | 'switched' | 'auto' = 'cancel'): void {
    if (!this.weaponBagOpen) return;
    this.weaponBagOpen = false;
    this.unbindWeaponBagKeys();
    // 场景 SHUTDOWN 也会走到这里，那时 Phaser 可能已经把 container 收掉了
    if (this.weaponBagPanel?.active) this.weaponBagPanel.destroy();
    this.weaponBagPanel = null;
    this.weaponBagOptions = [];
    this.weaponBagMessage = '';
    setWeaponBagVisible(false);
    setHudVisible(this.weaponBagHudBefore);
    setInputEnabled(true);
    setControlsVisible(
      isCombatPlayable(this.mode) && !this.nodeBusy && !this.storyFailOpen && !this.transitioning,
    );
    controls.reset();
    if (reason === 'cancel') emitToast('已取消切换，继续战斗', 1000);
  }

  private bindWeaponBagKeys(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    const on = (event: string, fn: () => void): void => {
      kb.on(event, fn);
      this.weaponBagKeys.push({ event, fn });
    };
    on('keydown-ESC', () => this.closeWeaponBag('cancel'));
    on('keydown-UP', () => this.moveWeaponBagCursor(-1));
    on('keydown-DOWN', () => this.moveWeaponBagCursor(1));
    on('keydown-ENTER', () => this.confirmWeaponBag());
    on('keydown-SPACE', () => this.confirmWeaponBag());
    const numberKeys = ['ONE', 'TWO', 'THREE', 'FOUR'];
    numberKeys.forEach((key, i) => on(`keydown-${key}`, () => this.selectWeaponAt(this.weaponBagScroll + i)));
  }

  private unbindWeaponBagKeys(): void {
    const kb = this.input.keyboard;
    for (const { event, fn } of this.weaponBagKeys) kb?.off(event, fn);
    this.weaponBagKeys = [];
  }

  private moveWeaponBagCursor(delta: number): void {
    const n = this.weaponBagOptions.length;
    if (n === 0) return;
    this.weaponBagCursor = (this.weaponBagCursor + delta + n) % n;
    if (this.weaponBagCursor < this.weaponBagScroll) this.weaponBagScroll = this.weaponBagCursor;
    if (this.weaponBagCursor >= this.weaponBagScroll + WEAPON_BAG_ROWS) {
      this.weaponBagScroll = this.weaponBagCursor - WEAPON_BAG_ROWS + 1;
    }
    this.renderWeaponBag();
  }

  private confirmWeaponBag(): void {
    const o = this.weaponBagOptions[this.weaponBagCursor];
    if (o) this.selectWeaponOption(o.id);
  }

  private selectWeaponAt(index: number): void {
    const o = this.weaponBagOptions[index];
    if (o) this.selectWeaponOption(o.id);
  }

  /**
   * 一次选择 = 校验 → 原子提交 → 落盘 → 同步角色。任一环失败都停在面板里，
   * 用一行消息说明原因，且（commit 已有快照）绝不留下装备换了背包没换的半状态。
   */
  private selectWeaponOption(optionId: string): void {
    if (!this.weaponBagOpen) return;
    const planned = planWeaponSwap(this.save, this.cfg, optionId, dataLoader.getItems());
    if (!planned.ok) {
      this.weaponBagMessage = planned.message;
      this.renderWeaponBag();
      return;
    }
    const committed = commitWeaponSwap(this.save, planned.plan);
    if (!committed.ok) {
      this.weaponBagMessage = committed.message;
      this.renderWeaponBag();
      return;
    }
    try {
      persist();
    } catch {
      // localStorage 写失败（配额 / 隐私模式）：内存态也要还原，否则 HUD 与存档不一致
      rollbackWeaponSwap(this.save, committed.snapshot);
      this.weaponBagMessage = SWAP_REJECT_TEXT.switch_failed;
      this.renderWeaponBag();
      return;
    }
    this.syncPlayerAfterWeaponSwap();
    this.closeWeaponBag('switched');
    emitToast(`换上 ${committed.item.name}　${planned.plan.deltaText}`, 1600);
  }

  /** 属性 / 攻击逻辑 / HUD 三处同步，但不动血量、存活、冷却、位置 */
  private syncPlayerAfterWeaponSwap(): void {
    const stats = effectiveStats(
      this.save.player.level,
      this.save.knowledge.length,
      this.save.equipment,
      this.cfg,
    );
    this.player.applyEquipmentStats(stats);
    this.applyEquippedWeapon(true);
    this.pushHud();
  }

  private renderWeaponBag(): void {
    if (this.weaponBagPanel?.active) this.weaponBagPanel.destroy();
    const c = this.add.container(0, 0).setDepth(DEPTH.overlay + 5).setScrollFactor(0);
    this.weaponBagPanel = c;
    const cx = VIEW_W / 2;
    const addText = (
      x: number,
      y: number,
      text: string,
      size: string,
      color: string,
      originX = 0.5,
    ): Phaser.GameObjects.Text =>
      this.add.text(x, y, text, { fontFamily: FONT_UI, fontSize: size, color }).setOrigin(originX, 0).setScrollFactor(0);

    // 全屏暗底故意不挂 interactive：强化卡踩过一次，底板吃点击会把「选中」变成「取消」
    c.add(this.add.rectangle(cx, VIEW_H / 2, VIEW_W, VIEW_H, PALETTE.ink, 0.86).setScrollFactor(0));
    c.add(
      this.add
        .rectangle(cx, 135, 340, 214, PALETTE.plumDark, 0.98)
        .setStrokeStyle(1, PALETTE.star)
        .setScrollFactor(0),
    );
    c.add(addText(cx, 36, '战斗背包 · 切换武器', '14px', '#F0C419'));
    c.add(addText(cx, 55, `当前：${this.player.weapon.name}　战斗已暂停`, '9px', '#C2BCD1'));
    c.add(addText(cx, 68, '↑↓ 选择　Enter / 1-4 装备　Esc 取消　B 收起', '8.5px', '#8E88A0'));

    const rows = this.weaponBagOptions.slice(this.weaponBagScroll, this.weaponBagScroll + WEAPON_BAG_ROWS);
    if (rows.length === 0) c.add(addText(cx, 108, '背包里没有武器装备。\n去副本里刷一把再来。', '10px', '#6B6489'));
    rows.forEach((o, i) => {
      const idx = this.weaponBagScroll + i;
      const y = 84 + i * 24;
      const picked = idx === this.weaponBagCursor;
      const box = this.add
        .rectangle(cx, y + 11, 324, 22, picked ? PALETTE.plumMid : PALETTE.ink, 0.92)
        .setStrokeStyle(1, picked ? PALETTE.star : PALETTE.greyPlum)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      box.on('pointerdown', () => this.selectWeaponOption(o.id));
      c.add(box);
      const qColor = o.quality === 'purple' ? '#948DAB' : o.quality === 'blue' ? '#7FB2D9' : '#C2BCD1';
      c.add(addText(84, y + 1, `${idx + 1}. ${o.name}`, '9.5px', o.available || o.current ? qColor : '#6B6489', 0));
      c.add(
        addText(396, y + 1, `${o.weaponName} · ${o.kindText}`, '9px', o.available ? '#F0C419' : '#6B6489', 1),
      );
      const status = o.current
        ? '当前武器 · 重复选择无效'
        : !o.available
          ? SWAP_REJECT_TEXT[o.reason ?? 'weapon_unavailable']
          : o.deltaText;
      c.add(addText(84, y + 12, `${o.statText}　${status}`, '8.5px', o.available ? '#C2BCD1' : '#8E88A0', 0));
    });
    if (this.weaponBagOptions.length > WEAPON_BAG_ROWS) {
      c.add(addText(396, 186, `第 ${this.weaponBagScroll + 1}–${this.weaponBagScroll + rows.length} / ${this.weaponBagOptions.length} 件`, '8px', '#6B6489', 1));
    }
    c.add(addText(84, 188, this.weaponBagMessage, '9px', '#F0C419', 0));

    const btn = (x: number, label: string, fn: () => void, accent = false): void => {
      const r = this.add
        .rectangle(x, 214, 116, 18, accent ? PALETTE.redDark : PALETTE.plumMid, 0.95)
        .setStrokeStyle(1, PALETTE.ink)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      c.add(r);
      c.add(addText(x, 210, label, '9px', '#F2EDE4'));
    };
    btn(cx - 64, '装备选中 Enter', () => this.confirmWeaponBag(), true);
    btn(cx + 64, '取消 Esc', () => this.closeWeaponBag('cancel'));
  }

  private spawnWorldObject(obj: MapObject): void {
    const x = (obj.x + 0.5) * TILE;
    const y = (obj.y + 0.5) * TILE;
    const color = obj.color ? Phaser.Display.Color.HexStringToColor(obj.color).color : PALETTE.plumMid;

    // 围观百姓：纯背景，不参与交互。
    // 必须排在最前——`prop` 不能往下走到销烟池那套渲染里，否则会被画成一块方块。
    //
    // 判定必须同时看 `payload`：`kind:'prop'` 是「静态布景」这一个**大类**，
    // 炮位（`obj_cannon`，payload 为空）之类的装饰也用它。第一版只判 kind，
    // 于是炮位被当成百姓、`door_N` 解析出 NaN → 兜底画成一块青紫大方块，
    // 镇守炮台那张图上凭空多出一排大脑袋。人群的判别式只有一个：编号在 `door_0..4` 之内。
    // 围观百姓分支已按甲方 m01249「把第一幕的观众也全去掉」删掉：`door_N` 不再有人画。
    // `spawnCrowd` 函数本身留着（机制还在，见它的 JSDoc），但这里不再调用。

    // 静态布景：`kind:'prop'` 且 payload 是 `SUNNY_PROPS` 里的道具名（路牌、木箱、枯骨…）。
    // 以前这一类和「销烟池」共用最后的兜底分支，被画成 12×12 的青紫色方块——
    // README D-2 说的「长廊与图鉴界面的装饰件仍是占位」就是它。
    if (obj.kind === 'prop' && obj.payload && obj.payload in SUNNY_PROPS) {
      this.spawnSunnyProp(obj.payload as SunnyProp, x, y);
      return;
    }

    if (obj.kind === 'exit') {
      // 出口：先隐藏，条件满足后显示
      const rect = this.add.rectangle(x, y, 14, 20, color).setStrokeStyle(1, PALETTE.star).setDepth(DEPTH.deco + 1);
      const label = this.add
        .text(x, y - 16, obj.label, { fontFamily: FONT_UI, fontSize: '8px', color: '#F0C419' })
        .setOrigin(0.5)
        .setDepth(DEPTH.deco + 2);
      rect.setVisible(false);
      label.setVisible(false);
      this.worldObjects.push({ def: obj, rect, label, extra: [] });
      return;
    }

    if (obj.kind === 'npc' && NPC_ART[obj.id]) {
      // NPC 也要有小人：以前林则徐是 12×12 深蓝方块，玩家以为那是块石头。
      // 有贴图就用兵种贴图那一套（`art/units/<unit>_down.png`），没有才退回方块。
      const tex = `${NPC_ART[obj.id]}_down`;
      const shade = this.add.ellipse(x, y + 6, 18, 6, PALETTE.ink, 0.28).setDepth(DEPTH.deco);
      const rect = this.textures.exists(tex)
        ? markPixel(this.add.image(x, y + 8, tex).setOrigin(0.5, 1).setDepth(DEPTH.deco + 1))
        : this.add.rectangle(x, y, 14, 18, color).setStrokeStyle(1, PALETTE.star).setDepth(DEPTH.deco + 1);
      const label = this.add
        .text(x, y - 34, obj.label, {
          fontFamily: FONT_UI,
          fontSize: '8px',
          color: '#FFE08A',
          backgroundColor: '#241F35',
          padding: { x: 2, y: 1 },
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.fx)
        .setVisible(false);
      this.worldObjects.push({ def: obj, rect, label, extra: [shade] });
      return;
    }

    if (obj.kind === 'pickup') {
      // 可捡物：原来是 12×12 深棕方块摊在同色沙地上，手机上几乎看不见
      // （玩家反馈「第八个鸦片找不到」）。现在改为「亮色描边 + 箱盖高光 + 金色呼吸光晕」。
      const glow = this.add
        .rectangle(x, y, 22, 20, PALETTE.star, 0.18)
        .setDepth(DEPTH.deco);
      // 有正式贴图就用贴图（20×20 的鸦片箱），没有则退回「矩形 + 金边 + 箱盖」
      const hasArt = this.textures.exists(TEX_CRATE);
      const rect: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image = hasArt
        ? markPixel(this.add.image(x, y, TEX_CRATE).setOrigin(0.5).setDepth(DEPTH.deco + 1))
        : this.add.rectangle(x, y, 16, 14, color).setStrokeStyle(1, PALETTE.star).setDepth(DEPTH.deco + 1);
      const lid = hasArt ? null : this.add.rectangle(x, y - 4, 16, 4, PALETTE.brown).setDepth(DEPTH.deco + 2);
      this.tweens.add({
        targets: lid ? [glow, rect, lid] : [glow, rect],
        scaleX: 1.14,
        scaleY: 1.14,
        alpha: { from: 1, to: 0.72 },
        duration: 760,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      // 「找不到第 N 箱」的正面解法：每箱头顶一颗常驻金色标记，上下浮动 + 呼吸。
      // 以前只有走近了才显字（label setVisible(false)），480×256 的地图摊在手机上，
      // 远处那 20×20 的箱子跟沙地同色，玩家根本不会往角落走。
      const beacon = this.add
        .triangle(x, y - 17, 0, 7, 4.5, 0, 9, 7, PALETTE.star)
        .setOrigin(0.5)
        .setDepth(DEPTH.deco + 4);
      this.tweens.add({
        targets: beacon,
        y: y - 21,
        alpha: 0.45,
        duration: 620,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      const label = this.add
        .text(x, y - 28, obj.label, { fontFamily: FONT_UI, fontSize: '7px', color: '#F0C419' })
        .setOrigin(0.5)
        .setDepth(DEPTH.deco + 5)
        .setVisible(false);
      this.worldObjects.push({ def: obj, rect, label, extra: lid ? [glow, lid, beacon] : [glow, beacon] });
      return;
    }

    // 销烟池不是一块紫板子：石砌池沿 + 深色池水 + 几点石灰白沫，走过去才有「往池子里倒」的感觉
    const isPool = obj.kind === 'deposit';
    const w = isPool ? 40 : 12;
    const h = isPool ? 26 : 12;
    const rect = this.add
      .rectangle(x, y, w, h, isPool ? PALETTE.greyPlum : color)
      .setStrokeStyle(1, PALETTE.ink)
      .setDepth(DEPTH.deco + 1);
    const extras: WorldExtra[] = [];
    if (isPool) {
      const water = this.add
        .rectangle(x, y + 1, w - 6, h - 7, PALETTE.plumDark)
        .setStrokeStyle(1, PALETTE.ink)
        .setDepth(DEPTH.deco + 2);
      extras.push(water);
      // 石灰白沫：一条歪着的碎沫带，别摆成三点（三点会被看成一张脸）
      const foam: Array<[number, number, number, number]> = [
        [-10, -4, 8, 2],
        [-1, -2, 6, 2],
        [7, -4, 7, 2],
        [-6, 4, 9, 2],
        [3, 5, 6, 2],
      ];
      for (const [dx, dy, fw, fh] of foam) {
        extras.push(
          this.add
            .rectangle(x + dx, y + dy, fw, fh, PALETTE.paper)
            .setDepth(DEPTH.deco + 3)
            .setAlpha(0.72),
        );
      }
      // 池沿：上沿亮、下沿暗，让池子看起来是凹的
      extras.push(this.add.rectangle(x, y - h / 2, w, 2, PALETTE.greyLight).setDepth(DEPTH.deco + 3));
      extras.push(this.add.rectangle(x, y + h / 2, w, 2, PALETTE.ink).setDepth(DEPTH.deco + 3));
    }
    const label = this.add
      .text(x, y - 16, obj.label, {
        fontFamily: FONT_UI,
        fontSize: '8px',
        color: '#FFE08A',
        backgroundColor: '#241F35',
        padding: { x: 2, y: 1 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.fx)
      .setVisible(false);
    this.worldObjects.push({ def: obj, rect, label, extra: extras });
  }

  /**
   * 围观百姓：一个站着看热闹的人（甲方 m11885 给的 5 个小人）。
   *
   * **现在不画了**：甲方 m01249 要求「把第一幕的观众也全去掉」，所以 `spawnWorldObject`
   * 里那条 `door_N` 分支已经删掉，地图数据里的 `door_0..4` 布景也一并清了。
   *
   * 这个函数先留着不删：它连同 `crowdSprites` / `crowdSolids` / `MapRenderer.extraSolid`
   * 是一整套能用的机制（只画不登记 + 能挡人 + 头部轻晃），老百姓要是哪天回来，
   * 把 `spawnWorldObject` 里那两行分支加回去、再往 JSON 里补 `door_N` 即可。
   * 贴图 `public/art/crowd/door_0..4.png` 也保留（`tests/art.test.ts` 仍在校验它们）。
   *
   * 三个约束（原本的设计意图，回来时要保住）：
   *  1. **不能被交互**——挂在 `worldObjects` 里的物件，玩家走近会自动弹「搬起 / 投入」
   *     提示。百姓是背景，挂了就会变成「搬起鸦片箱」一样的可点目标，所以只画不登记。
   *  2. **要能挡住玩家**——销烟是当众的事，人群该有体积。这里用 `MapRenderer.extraSolid`
   *     （和海水同一套），不是往 JSON 碰撞层里写，因为人群是「站在场上的人」，不是地形。
   *  3. **要是个活人**——头顶按种子相位轻轻晃，每个人晃的节奏不一样，整排才不会像贴图。
   *
   * `@internal` 只是为了让 `tsc --noUnusedLocals` 放行：当前没有任何调用点。
   */
  // @ts-expect-error 甲方 m01249 要求去掉观众，暂时没有调用点；机制保留，回来时把调用加回来这行就报错、提示删掉它
  private spawnCrowd(obj: MapObject, x: number, y: number): void {
    const idx = Number.parseInt((obj.payload ?? '').replace('door_', ''), 10) || 0;
    const key = Object.values(CROWD_TEX)[idx % Object.values(CROWD_TEX).length];

    // 脚下阴影（和 NPC 同一套，让人「踩在地上」而不是浮着）
    this.add.ellipse(x, y + 7, 14, 5, PALETTE.ink, 0.26).setDepth(DEPTH.shadow);

    if (!this.textures.exists(key)) {
      // 贴图没加载出来（构建漏了 / 改了名字）：留空。**不要画兜底方块**——
      // 兜底方块在战场上跟小兵一样高、一样不透明，玩家会以为那是个人或障碍物，
      // 反而比「什么都没有」更误导；缺图属于构建问题，应该由 `tests/art.test.ts` 抓，
      // 而不是在运行时用一块色块糊过去。
      console.warn(`[crowd] 缺少贴图 ${key}，该处百姓不绘制`);
      return;
    }

    const sprite = this.add
      .image(x, y + 8, key)
      .setOrigin(0.5, 1)
      .setScale(CROWD_SCALE)
      .setDepth(DEPTH.deco + 33);
    // 像素画放大必须用最近邻，否则 3 倍放大会糊成一团
    if (sprite.texture) sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.crowdSprites.push(sprite);

    // 相位移：用格子坐标当种子，同一张图每次进来晃的节奏都一样（不会读档后变样）
    const phase = ((obj.x * 7 + obj.y * 13) % 20) / 20;
    this.tweens.add({
      targets: sprite,
      y: y + 7,
      duration: 900 + phase * 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: phase * 900,
    });

    this.crowdSolids.add(`${obj.x},${obj.y}`);
  }

  /** 只有走过去的那个物体显示名字，避免整屏都是小字 */
  private refreshObjectLabels(): void {
    const nearId = this.nearObject?.id ?? null;
    for (const o of this.worldObjects) {
      const show = o.rect.visible && o.def.id === nearId;
      o.label.setVisible(false); // canvas 版隐藏，走 DOM
      if (show) {
        this.floatObj = o;
        this.updateFloatPos(true);
      } else {
        this.floatObj = null;
        hideFloat();
      }
    }
  }

  private floatObj: { label: Phaser.GameObjects.Text } | null = null;

  /** 每帧把浮动标签世界坐标投影到 #dom-ui 像素位置 */
  private updateFloatPos(initial = false): void {
    if (!this.floatObj) return;
    const cam = this.cameras.main;
    // #dom-ui 尺寸 = canvas CSS 尺寸（~711px 宽），不是逻辑 480；要按画布实际缩放比换算
    const scale = this.game.canvas.clientWidth / VIEW_W;
    const sx = (this.floatObj.label.x - cam.worldView.x) * scale;
    const sy = (this.floatObj.label.y - cam.worldView.y) * scale;
    if (initial) showFloat(this.floatObj.label.text, sx, sy);
    else moveFloat(sx, sy);
  }

  private hideWorldObject(entry: {
    rect: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image;
    label: Phaser.GameObjects.Text;
    extra: WorldExtra[];
  }): void {
    entry.rect.setVisible(false);
    entry.label.setVisible(false);
    entry.extra.forEach((e) => e.setVisible(false));
  }

  /**
   * 清掉场上的孤儿地面层（不是当前 `MapRenderer` 正持有的那些）。
   *
   * 地面层是**不透明、铺满全屏、depth 0** 的一整张图。只要历史上有过一次
   * 重叠构建（`buildWorld` 是 async，早先没有重入保护）或多建了一个实例，
   * 那张旧地面就会压在新地图上面，玩家看到的是「地图变回上一张了」。
   * 判据按 key 放行而不是按地图 id：同一张图重建两次也是两个实例
   * （`MapRenderer.seq` 让 key 唯一），旧的那个同样是孤儿。
   */
  private sweepOrphanGrounds(): void {
    const liveKey = this.map?.groundTextureKey ?? null;
    if (!liveKey) return; // 没烘成（缺 canvas 支持之类）就别乱删
    this.children.list.slice().forEach((child) => {
      const img = child as Phaser.GameObjects.Image;
      if (!img || !img.texture || typeof img.texture.key !== 'string') return;
      const key = img.texture.key;
      if (!key.startsWith('map_ground_') || key === liveKey) return;
      img.destroy();
      if (this.textures.exists(key)) this.textures.remove(key);
    });
  }

  private setExitVisible(visible: boolean): void {
    for (const o of this.worldObjects) {
      if (o.def.kind !== 'exit') continue;
      o.rect.setVisible(visible);
      o.label.setVisible(visible);
    }
  }

  private clearWorldObjects(): void {
    this.worldObjects.forEach((o) => {
      this.tweens.killTweensOf([o.rect, o.label, ...o.extra]);
      o.rect.destroy();
      o.label.destroy();
      o.extra.forEach((e) => e.destroy());
    });
    this.worldObjects = [];
  }

  /* ==================== 模式：探索 ==================== */

  private setupExplore(): void {
    // crate_target: 0 表示这一幕不搬箱（例如「销烟」这一幕只是走进去看烟土化尽）：
    // 箱子全部收起，出口一开始就开着，目标改成 params.objective。
    if (this.crateTarget <= 0) {
      for (const o of this.worldObjects) {
        if (o.def.kind !== 'pickup') continue;
        this.hideWorldObject(o);
      }
      this.setExitVisible(true);
      const objText = String(
        (this.node?.params as { objective?: string } | undefined)?.objective ?? '走向出口',
      );
      emitObjective(objText);
      this.setupNpcTalk();
      return;
    }
    this.setExitVisible(false);
    emitObjective(
      `搬运鸦片箱并投入销烟池　${this.cratesDelivered}/${this.crateTarget}`,
    );
    // 教一下这个符号：甲方反馈「第八个鸦片找不到」，根因是箱子在手机上和沙地同色、
    // 又只有走近才显字。现在每箱头顶有常驻金色标记，但符号得先告诉玩家一次。
    emitToast('箱子都搬完了才算完 —— 盯着场上的金色标记', 2400);
    this.setupNpcTalk();
  }

  /**
   * 幕内 NPC 的「等你来搭话」状态。
   *
   * 数据里写 `params.npc_talk = { npc, dialogue }`，就走这套：
   * 头顶顶一个跳动的感叹号，箱子交互被挡；玩家点 NPC 才播他的台词，播完才放开箱子。
   */
  private setupNpcTalk(): void {
    const cfg = (this.node?.params as { npc_talk?: { npc?: string; dialogue?: string } } | undefined)
      ?.npc_talk;
    if (!cfg?.npc || !cfg.dialogue) return;
    const entry = this.worldObjects.find((o) => o.def.id === cfg.npc);
    if (!entry) return;
    this.npcTalkObjId = cfg.npc;
    this.npcDialogueRef = cfg.dialogue;
    this.npcTalked = false;
    this.npcMark?.destroy();
    const mark = this.add
      .text(entry.rect.x, entry.rect.y - 50, '!', {
        fontFamily: FONT_UI,
        fontSize: '16px',
        color: '#F0C419',
        fontStyle: 'bold',
        stroke: '#2A2438',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.fx);
    this.tweens.add({
      targets: mark,
      y: mark.y - 4,
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.npcMark = mark;
    entry.label.setVisible(false); // canvas 版隐藏，走 DOM float
    this.floatObj = entry;
    this.updateFloatPos(true);
  }

  /** NPC 说完话：撤掉感叹号，放开箱子 */
  private finishNpcTalk(): void {
    this.npcTalked = true;
    if (this.npcMark) {
      this.tweens.killTweensOf(this.npcMark);
      this.npcMark.destroy();
      this.npcMark = null;
    }
    this.floatObj = null;
    hideFloat();
    emitToast('可以搬鸦片箱了', 1200);
  }

  /* ==================== 模式：护送（设计书 3.3.2 场景 A） ==================== */

  private setupEscort(): void {
    if (!this.map) return;
    const count = Number(this.node.params.allies ?? 3);
    this.allies = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.PI / 2;
      const rig = new CharacterRig(this, this.player.x - 20 + i * 12, this.player.y + 10, {
        bodyColor: PALETTE.greenDark,
        skinColor: PALETTE.cream,
        legColor: PALETTE.brownDeep,
        weaponColor: PALETTE.greyPlum,
      });
      this.allies.push({ rig, hp: 80, maxHp: 80, alive: true, angle });
    }
    this.escortGoalX = this.map.pixelWidth - 48;
    this.escortStage = 0;
    this.escortSurvivors = count;
    this.escortTotal = count;

    // 终点标记
    this.escortGoalMarker = this.add
      .rectangle(this.escortGoalX, this.player.y, 12, 40, PALETTE.star, 0.35)
      .setDepth(DEPTH.deco)
      .setStrokeStyle(1, PALETTE.star);
    this.add
      .text(this.escortGoalX, 24, '突围方向 →', {
        fontFamily: FONT_UI,
        fontSize: '9px',
        color: '#F0C419',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.deco + 2);

    // 沿途拦截：按推进度触发，而不是等清空当前波次
    this.escortSpawnStage(0);
    emitObjective(`护送太平军战士　${count}/${count}`);
  }

  /** 按推进度依次放出拦截波次 */
  private escortSpawnStage(stage: number): void {
    const waves = (this.node.params.waves ?? []) as { spawns: { enemy: string; count: number; spawn: string }[] }[];
    const wave = waves[stage];
    if (!wave) return;
    this.escortStage = stage;
    let delay = 0;
    for (const group of wave.spawns ?? []) {
      const def = this.findEnemy(group.enemy);
      if (!def) continue;
      for (let i = 0; i < group.count; i++) {
        const at = delay;
        this.time.delayedCall(at, () => this.spawnEnemy(def, group.spawn));
        delay += 240;
      }
    }
    const names = (wave.spawns ?? []).map((g) => this.findEnemy(g.enemy)?.name ?? g.enemy).join('、');
    if (names) emitToast(`遭遇：${names}`, 1500);
  }

  private updateAllies(dtMs: number): void {
    const alive = this.allies.filter((a) => a.alive);
    for (const a of alive) {
      const targetX = this.player.x + Math.cos(a.angle) * 26;
      const targetY = this.player.y + Math.sin(a.angle) * 20 + 8;
      const dx = targetX - a.rig.x;
      const dy = targetY - a.rig.y;
      const len = Math.hypot(dx, dy);
      if (len > 4) {
        // 略慢于玩家，形成自然的跟随滞后
        const step = Math.min(len, (66 * dtMs) / 1000);
        a.rig.x += (dx / len) * step;
        a.rig.y += (dy / len) * step;
      }
      a.rig.tick(dtMs, len > 6);
      a.rig.setDepth(20 + a.rig.y * 0.01);
    }
    const aliveCount = this.allies.filter((a) => a.alive).length;
    if (aliveCount !== this.escortSurvivors) {
      this.escortSurvivors = aliveCount;
      const total = this.escortTotal || this.allies.length;
      emitObjective(`护送太平军战士　${aliveCount}/${total}`);
    }
  }

  /** 按推进度放出后续拦截波次（不是等清空当前波次） */
  private updateEscortProgress(): void {
    const waves = (this.node.params.waves ?? []) as unknown[];
    if (this.escortGoalX <= 0) return;
    const progress = this.player.x / this.escortGoalX;
    const thresholds = [0.3, 0.62];
    let guard = 0;
    while (
      guard < 4 &&
      this.escortStage < thresholds.length &&
      this.escortStage + 1 < waves.length &&
      progress >= thresholds[this.escortStage]
    ) {
      this.escortSpawnStage(this.escortStage + 1);
      guard += 1;
    }
  }

  private damageAlly(ally: Ally, raw: number): void {
    if (!ally.alive) return;
    ally.hp = Math.max(0, ally.hp - Math.max(1, Math.round(raw)));
    ally.rig.hitFlash(80);
    if (ally.hp <= 0) {
      ally.alive = false;
      ally.rig.playDeath();
      emitToast('一名战士倒下了', 1200);
    }
  }

  private escortNearestTarget(
    ex: number,
    ey: number,
  ): { x: number; y: number; alive: boolean; isInvincible: boolean; ally?: Ally } {
    let best: { x: number; y: number; alive: boolean; isInvincible: boolean; ally?: Ally } = {
      x: this.player.x,
      y: this.player.y,
      alive: this.player.alive,
      isInvincible: this.player.isInvincible,
    };
    let bestD = this.player.alive
      ? Phaser.Math.Distance.Between(ex, ey, this.player.x, this.player.y)
      : Number.POSITIVE_INFINITY;
    for (const a of this.allies) {
      if (!a.alive) continue;
      const d = Phaser.Math.Distance.Between(ex, ey, a.rig.x, a.rig.y);
      if (d < bestD) {
        bestD = d;
        best = { x: a.rig.x, y: a.rig.y, alive: true, isInvincible: false, ally: a };
      }
    }
    return best;
  }

  private clearAllies(): void {
    this.allies.forEach((a) => a.rig.destroy());
    this.allies = [];
    // 终点与人数一起作废：切节点后的残留值不能再让旧护送判定命中
    this.escortGoalX = 0;
    this.escortTotal = 0;
    this.escortSurvivors = 0;
    this.escortGoalMarker?.destroy();
    this.escortGoalMarker = null;
  }

  /* ==================== 模式：经营（设计书 3.3.2 场景 B / 6.6 G 类） ==================== */

  private setupManagement(): void {
    this.manage = createManageState();
    this.manageAlloc = { food: 2, troops: 2, morale: 2 };
    this.manageFocus = 'food';
    // HUD 目标条固定在 top:42%（逻辑 y≈113），正好横压在第三行「民心」卡片上；
    // 面板自己已有「天京经营　第 N / 8 月」标题，这里收掉目标条即可，不再重复写一行。
    emitObjective('');
    this.renderManagement();
    this.bindManageKeys();
  }

  private bindManageKeys(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    const tracks: (keyof ManageTrack)[] = ['food', 'troops', 'morale'];
    kb.removeAllListeners('keydown-UP');
    kb.removeAllListeners('keydown-DOWN');
    kb.removeAllListeners('keydown-LEFT');
    kb.removeAllListeners('keydown-RIGHT');
    kb.removeAllListeners('keydown-ENTER');
    kb.on('keydown-UP', () => {
      const i = tracks.indexOf(this.manageFocus);
      this.manageFocus = tracks[(i + tracks.length - 1) % tracks.length];
      this.renderManagement();
    });
    kb.on('keydown-DOWN', () => {
      const i = tracks.indexOf(this.manageFocus);
      this.manageFocus = tracks[(i + 1) % tracks.length];
      this.renderManagement();
    });
    kb.on('keydown-LEFT', () => this.adjust(-1));
    kb.on('keydown-RIGHT', () => this.adjust(1));
    kb.on('keydown-ENTER', () => this.commitAllocation());
  }

  private adjust(delta: number): void {
    if (!this.manage || this.manage.done) return;
    const next = { ...this.manageAlloc };
    const v = next[this.manageFocus] + delta;
    if (v < 0 || v > TRACK_MAX) return;
    next[this.manageFocus] = v;
    // 超出总点数时，从其他项里扣（自动腾挪，避免玩家反复点减号）
    while (allocTotal(next) > MONTHLY_POINTS) {
      const others = (['food', 'troops', 'morale'] as (keyof ManageTrack)[]).filter(
        (k) => k !== this.manageFocus && next[k] > 0,
      );
      if (others.length === 0) return;
      const richest = others.reduce((a, b) => (next[a] >= next[b] ? a : b));
      next[richest] -= 1;
    }
    if (validateAlloc(next).ok) {
      this.manageAlloc = next;
      this.renderManagement();
    }
  }

  private commitAllocation(): void {
    if (!this.manage || this.manage.done) return;
    const check = validateAlloc(this.manageAlloc);
    if (!check.ok) {
      emitToast(`还差 ${MONTHLY_POINTS - allocTotal(this.manageAlloc)} 点没分配`, 1200);
      return;
    }
    settleMonth(this.manage, this.manageAlloc);
    this.manageAlloc = { food: 2, troops: 2, morale: 2 };
    this.renderManagement();
  }

  private renderManagement(): void {
    this.manageUI?.destroy();
    if (!this.manage) return;
    const c = this.add.container(0, 0).setDepth(DEPTH.overlay).setScrollFactor(0);
    this.manageUI = c;

    const st = this.manage;
    const last = st.history[st.history.length - 1];
    // canvas 图元与 DOM 文字层共用同一套坐标，避免竖屏旋转后「字配歪了」。
    const L = MANAGE_LAYOUT;
    const T = managementTextLayout();

    c.add(
      this.add
        .rectangle(L.panel.cx, L.panel.cy, L.panel.w, L.panel.h, PALETTE.ink, 0.95)
        .setStrokeStyle(1, PALETTE.greyPlum)
        .setScrollFactor(0),
    );

    const rows: { key: keyof ManageTrack; name: string; colorCss: string }[] = [
      { key: 'food', name: '粮草', colorCss: '#F0C419' },
      { key: 'troops', name: '兵员', colorCss: '#7FD1AE' },
      { key: 'morale', name: '民心', colorCss: '#9CCC65' },
    ];

    rows.forEach((row, i) => {
      const y = L.row.y0 + i * L.row.step;
      const focused = this.manageFocus === row.key;
      c.add(
        this.add
          .rectangle(L.panel.cx, y, L.row.w, L.row.h, focused ? PALETTE.plumMid : PALETTE.plumDark, focused ? 1 : 0.85)
          .setStrokeStyle(1, focused ? PALETTE.star : PALETTE.ink)
          .setScrollFactor(0),
      );

      // 分配点数的格子（canvas 矩形保留）
      for (let k = 0; k < TRACK_MAX; k++) {
        const filled = k < this.manageAlloc[row.key];
        c.add(
          this.add
            .rectangle(L.pips.x0 + k * L.pips.step, y, L.pips.size, L.pips.size, filled ? PALETTE.star : PALETTE.plumDark)
            .setStrokeStyle(1, PALETTE.ink)
            .setScrollFactor(0),
        );
      }

      const mkBtn = (cx: number, delta: number) => {
        const r = this.add
          .rectangle(cx, y, L.btnW, L.btnH, PALETTE.redDark, 0.95)
          .setStrokeStyle(1, PALETTE.ink)
          .setScrollFactor(0)
          .setInteractive({ useHandCursor: true });
        const act = () => {
          this.manageFocus = row.key;
          this.adjust(delta);
        };
        r.on('pointerdown', act);
        c.add(r);
      };
      mkBtn(L.minusX, -1);
      mkBtn(L.plusX, 1);
    });

    // ── 文字走 DOM overlay：盒子坐标全部来自 managementTextLayout()，与 canvas 图元同心
    const remaining = MONTHLY_POINTS - allocTotal(this.manageAlloc);
    const monthCost =
      st.history.length + 1 <= MANAGE_MONTHS ? 2 + Math.floor((Math.min(st.month, MANAGE_MONTHS) - 1) / 3) : 0;
    const box = (b: TextBox, css: string, content: string) =>
      `<div style="position:absolute;left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;${css}">${content}</div>`;
    const flex = 'display:flex;align-items:center;';
    const flexCenter = `${flex}justify-content:center;`;

    const rowHtml = rows
      .map((row, i) => {
        const b = T.rows[i];
        const low = st.stock[row.key] < 2;
        return (
          box(b.name, `${flex}font-size:14px;`, row.name) +
          box(b.stock, `${flex}font-size:13px;color:${low ? '#E85C4A' : '#C2BCD1'};`, `库存 ${st.stock[row.key]}`) +
          box(b.minus, `${flexCenter}font-size:16px;color:#F2EDE4;`, '−') +
          box(b.plus, `${flexCenter}font-size:16px;color:#F2EDE4;`, '＋')
        );
      })
      .join('');

    let bottomHtml = '';
    if (last && !st.done) {
      const text = last.events.length > 0 ? last.events.join('；') : '本月无事。';
      bottomHtml = box(
        T.report,
        `font-size:12px;line-height:1.35;color:${last.golden ? '#7EC08A' : '#F2A08C'};`,
        `上月结算：${text}`,
      );
    }
    if (st.done) {
      const v = finalVerdict(st);
      bottomHtml = box(T.verdict, 'font-size:12px;line-height:1.35;color:#F2EDE4;', `${v.title}。${v.body}`);
    }

    const ok = validateAlloc(this.manageAlloc).ok;
    const btnLabel = st.done ? '记下这段历史' : ok ? '确认本月分配' : '点数没分完';

    showOverlay(
      box(T.title, `${flex}font-size:13px;color:#C2BCD1;`, `天京经营　第 ${Math.min(st.month, MANAGE_MONTHS)} / ${MANAGE_MONTHS} 月`) +
        box(
          T.budget,
          `${flex}justify-content:flex-end;white-space:nowrap;font-size:12px;color:#F0C419;`,
          `可分配 ${remaining} 点 · 消耗 ${monthCost}`,
        ) +
        box(
          T.hint,
          `${flex}white-space:nowrap;overflow:hidden;font-size:10px;letter-spacing:-0.2px;color:#6B6489;`,
          '粮草、兵员、民心三事，怎么分都不够——这就是要你亲手体会的事。',
        ) +
        rowHtml +
        bottomHtml +
        box(T.confirmLabel, `${flexCenter}font-size:13px;color:${st.done || ok ? '#F2EDE4' : '#6B6489'};`, btnLabel),
    );

    if (st.done) {
      this.makeManageButton(c, L.confirm.cx, L.confirm.cy, L.confirm.w, L.confirm.h, '', () => {
        this.manageUI?.destroy();
        this.manageUI = null;
        hideOverlay();
        this.completeNode();
      });
    } else {
      this.makeManageButton(
        c,
        L.confirm.cx,
        L.confirm.cy,
        L.confirm.w,
        L.confirm.h,
        '',
        () => this.commitAllocation(),
        ok,
      );
    }
  }

  private makeManageButton(
    c: Phaser.GameObjects.Container,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    onClick: () => void,
    enabled = true,
  ): void {
    const r = this.add
      .rectangle(x, y, w, h, enabled ? PALETTE.redDark : PALETTE.plumDark, 0.95)
      .setStrokeStyle(1, PALETTE.ink)
      .setScrollFactor(0);
    const t = this.add
      .text(x, y, text, {
        fontFamily: FONT_UI,
        fontSize: '10px',
        color: enabled ? '#F2EDE4' : '#6B6489',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    c.add(r);
    c.add(t);
    if (enabled) {
      r.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
      t.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    }
  }

  /* ==================== 模式：战斗 ==================== */

  private setupCombat(): void {
    // 第一幕终战在虎门威远炮台，第二幕终战在天京城墙：以前两幕共用一句硬编码文案，
    // 太平天国城墙夜战会显示「守住威远炮台」。副本不进这个分支判断（this.act 未赋值）。
    emitObjective(this.act?.id === 'ch00_act2' ? '守住天京城墙' : '守住威远炮台');
    this.waveIndex = 0;
    this.wavePending = true;
    // 有开场情境卡时，第一波要等玩家点掉卡片再上——否则「第 1 波敌军来袭」
    // 会在卡片后面招摇地飘过去（第一版截图就是这样）。
    if (this.node?.banner) return;
    emitToast('第 1 波敌军来袭', 1400);
    this.time.delayedCall(1200, () => this.spawnWave(0));
  }

  private waveList(): { enemy: string; count: number; spawn: string }[][] {
    if (this.dungeon) {
      return this.dungeon.waves.map((w) => w.spawns);
    }
    const waves = (this.node.params.waves ?? []) as { spawns: { enemy: string; count: number; spawn: string }[] }[];
    return waves.map((w) => w.spawns);
  }

  private spawnWave(index: number): void {
    const waves = this.waveList();
    const wave = waves[index];
    if (!wave) {
      this.wavePending = false;
      this.spawnBoss();
      return;
    }
    // wavePending 必须保持 true 直到本波敌人真正生成完毕，
    // 否则 update() 会在敌人还没出现时就判定「本波已清空」而错误地推进到下一波。
    this.wavePending = true;
    let delay = 0;
    let lastDelay = 0;
    for (const group of wave) {
      const def = this.findEnemy(group.enemy);
      if (!def) continue;
      for (let i = 0; i < group.count; i++) {
        const at = delay;
        this.time.delayedCall(at, () => this.spawnEnemy(def, group.spawn));
        lastDelay = at;
        delay += 260;
      }
    }
    this.time.delayedCall(lastDelay + 80, () => {
      this.wavePending = false;
      // 敌人到齐后再刷一次光环，否则先出场的友军拿不到指挥官的加成
      this.applyAuras();
    });
  }

  /**
   * 收集一侧边缘所有可通行的生成点。
   * 炮台地图里右侧是海水、临海一线是垛口，只有少数行是射口——所以不能只取一个点，
   * 否则成组敌人会全部叠在同一格上。这里把可通行格都收进来，按序轮转使用。
   */
  private spawnPoints(side: string): { x: number; y: number }[] {
    if (!this.map) return [];
    const g = this.map.grid;
    const fromRight = side === 'right';
    const pts: { x: number; y: number }[] = [];
    const minCol = Math.floor(g.cols * 0.55);
    // 顶上 sky_rows 行是远景（海平线），那几行虽然也是墙，但让敌人站在海平线上
    // 会读成「站在水里」——出怪一律从远景带下面开始。
    const topRow = Math.max(2, (this.map.def.sky_rows ?? 0) + 1);
    for (let step = 0; step < g.cols - 2 - minCol && pts.length < 8; step++) {
      const col = fromRight ? g.cols - 2 - step : 1 + step;
      if (col < 1 || col >= g.cols - 1) break;
      for (let ty = topRow; ty < g.rows - 3; ty++) {
        if (!g.solid[ty][col] && !g.solid[ty + 1][col]) {
          pts.push({ x: (col + 0.5) * TILE, y: (ty + 0.5) * TILE });
        }
      }
    }
    return pts;
  }

  private spawnEnemy(def: EnemyDef, side: string): void {
    if (!this.map) return;
    const stats = enemyStats(def, this.enemyLevel, this.cfg);
    const pts = this.spawnPoints(side);
    const p =
      pts.length > 0
        ? pts[this.spawnedTotal % pts.length]
        : { x: this.map.pixelWidth / 2, y: this.map.pixelHeight / 2 };
    // 同一波里出怪点会重复（右侧只有那么多能站的格子），加一点抖动，
    // 否则两个兵会精确重叠成一个 —— 手机上看着像只有一个人。
    const jx = ((this.spawnedTotal * 7) % 11) - 5;
    const jy = ((this.spawnedTotal * 5) % 9) - 4;
    // 出怪点可能压在海面上，也可能被上面那点抖动推到边界墙里。
    // 判据必须用「中心 + 脚盒四角」：只查中心会放过 (461, 90) 这种
    // 「半个身子嵌在右墙」的位置，敌人从出生第一帧起四个角全被挡，永远走不动
    // （甲方截图「这两个小兵卡住了」）。落脚点也从**抖动后的点**往外找，
    // 别再退化成所有兵都挤回同一个未抖动的格心。
    let land = { x: p.x + jx, y: p.y + jy };
    if (this.enemyFootUnsafe(land.x, land.y)) {
      land = this.landingNearForEnemy(land.x, land.y);
      // 极端情况（整片都堵死）再退回 spawnPoints 的原始格心：它至少保证了
      // 本格与下一格都可站，脚盒四角不会压墙。
      if (this.enemyFootUnsafe(land.x, land.y)) land = this.landingNearForEnemy(p.x, p.y);
      if (this.enemyFootUnsafe(land.x, land.y)) land = { x: p.x, y: p.y };
    }
    const e = new Enemy(this, land.x, land.y, def, stats);
    this.enemies.push(e);
    this.spawnedTotal += 1;
  }

  /** 诊断用：本节点累计生成的敌人数量 */
  spawnedTotal = 0;

  private spawnBoss(): void {
    // 副本走自己的定义；没有 Boss 的副本在最后一波清完后直接结算
    const bossId = this.dungeon
      ? (this.dungeon.boss ?? undefined)
      : (this.node.params.boss as string | undefined);
    const extraIds = this.dungeon
      ? (this.dungeon.boss_extra ?? [])
      : ((this.node.params.boss_extra ?? []) as string[]);

    if (!bossId) {
      this.bossSpawned = true;
      if (this.dungeon) this.finishDungeon();
      else this.completeNode();
      return;
    }
    const def = this.findEnemy(bossId);
    if (!def) {
      this.bossSpawned = true;
      if (this.dungeon) this.finishDungeon();
      else this.completeNode();
      return;
    }
    this.bossSpawned = true;
    this.spawnBossEntities(def, extraIds);
  }

  /** 真正把 Boss（以及同场的额外首领）放进场，并挂上半血必杀 */
  private spawnBossEntities(def: EnemyDef, extraIds: string[]): void {
    // 设计书 3.3.2：湘军统领与洋枪队队长「两人同场，需分而治之」
    const names = [def.name, ...extraIds.map((id) => this.findEnemy(id)?.name).filter(Boolean) as string[]];
    emitObjective(`Boss：${names.join(' ＆ ')}`);
    emitToast(`${names.join(' 与 ')} 出现`, 2000);
    this.cameras.main.shake(300, 0.007);

    const place = (enemyDef: EnemyDef, slot: number) => {
      const stats = enemyStats(enemyDef, this.enemyLevel, this.cfg);
      const pts = this.spawnPoints('right');
      const base = pts.length > 0 ? pts[pts.length - 1] : { x: (this.map?.pixelWidth ?? VIEW_W) - 90, y: TILE * 8 };
      const x = (this.map?.pixelWidth ?? VIEW_W) - 100 - slot * 40;
      const y = Phaser.Math.Clamp(base.y + slot * 34 - 17, TILE * 2, (this.map?.pixelHeight ?? FIELD_H) - TILE * 2);
      const e = new Enemy(this, x, y, enemyDef, stats);
      // 半血必杀：由实体在跌破一半时回调一次（见 Enemy.checkFinalStrike）
      e.onFinalStrike = (b) => this.startFinalStrike(b);
      this.enemies.push(e);
    };

    place(def, 0);
    extraIds.forEach((id, i) => {
      const extra = this.findEnemy(id);
      if (extra) place(extra, i + 1);
    });
    // 认一下「哪个是军舰」：舰炮的落点预警、停船不前进、40×24 的舰体绘制都靠这个引用。
    // 按 `body === 'ship'` 判而不是按 id 写死，换一艘 Boss 船不用改代码。
    const placed = this.enemies.filter((e) => e.alive && e.def.id === def.id);
    this.bossShip = placed.find((e) => e.def.body === 'ship') ?? null;
    this.applyAuras();
  }

  /**
   * 半血剧情杀（甲方：「军舰在半血时进行全屏打击，伤害是角色血量的三倍，直接剧情杀」）。
   *
   * 三段，每一段都只为了让玩家**看清楚自己是怎么输的**：
   *  1. 冻结世界、藏摇杆、压暗全场，舰炮炮口撞一下 → 对准屏幕（`warnMs`）；
   *  2. 一击落下：全屏白光 + 长震屏，屏幕中央打出伤害数字（= 角色最大生命 × 3）；
   *  3. 交给既有的战败链：城破演出 → 战败卡 → 《南京条约》→ 关天培牺牲 → 继续推进。
   *
   * 为什么不走 `player.takeDamage()`：3 倍血量意味着任何护盾、闪避、无敌帧都不该生效——
   * 这是剧情，不是数值。而且战败链会把 `defeated` 置真、把模式切到过场；
   * 只让血条归零的话世界会继续跑，玩家会看到一个血条空了的活人。
   */
  private startFinalStrike(e: Enemy): void {
    if (this.defeated || this.finalStrikeRunning) return;
    // 这里**不能**拦 `mode === 'cutscene'`：Boss 登场本身就在过场里播（mode 早就是 cutscene 了），
    // 一拦就变成「血掉到一半，预警一声不吭」。防重入靠 finalStrikeRunning。
    const fs = e.def.final_strike;
    if (!fs) return;
    this.finalStrikeRunning = true;
    // 演出阶段对探针公开（'warn' → 'hit'）：截图要拍在正确的一拍上，墙钟 sleep 在无头浏览器里不可靠
    this.finalStrikeStage = 'warn';
    this.mode = 'cutscene';
    setControlsVisible(false);
    setCannonVisible(false);
    this.dialogue?.hide();
    const mult = fs.hp_mult ?? 3;
    const dmg = Math.ceil(this.player.maxHp * mult);

    // 舰炮停手：否则演出会和还在飞的炮弹叠在一起，看起来像两件事同时发生
    for (const en of this.enemies) if (en.isBoss) en.haltActions();
    e.rig.hitFlash(400);
    this.cameras.main.shake(900, 0.006);

    // 压暗层**不能**挂进带 scrollFactor 的容器里：Phaser 的 Container 只有 0.5 的原点语义，
    // 容器里的子对象坐标一律按世界坐标算，镜头一滚，整块遮罩就歪出屏幕（第一次跑就歪到了左下角）。
    // 所以遮罩、文字、白光全部单独 setScrollFactor(0) 并各自 destroy，不用容器兜。
    const created: Phaser.GameObjects.GameObject[] = [];
    const veil = this.add
      .rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, PALETTE.ink, 0.55)
      .setScrollFactor(0)
      .setDepth(DEPTH.overlay + 2)
      .setAlpha(0);
    created.push(veil);
    const warn = this.add
      .text(VIEW_W / 2, VIEW_H / 2 - 44, fs.warn, {
        fontFamily: FONT_UI,
        fontSize: '13px',
        color: '#E85C4A',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: VIEW_W - 48 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.overlay + 3)
      .setAlpha(0);
    created.push(warn);
    const sub = this.add
      .text(VIEW_W / 2, VIEW_H / 2 - 26, '这一炮，炮台挡不住', {
        fontFamily: FONT_UI,
        fontSize: '10px',
        color: '#C2BCD1',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.overlay + 3)
      .setAlpha(0);
    created.push(sub);

    this.tweens.add({ targets: veil, alpha: 1, duration: 420 });
    this.tweens.add({ targets: [warn, sub], alpha: 1, duration: 320, delay: 200 });
    this.tweens.add({ targets: warn, alpha: { from: 0.45, to: 1 }, duration: 380, yoyo: true, repeat: -1, delay: 520 });

    const fall = () => {
      this.finalStrikeStage = 'hit';
      // 白光：整屏一下子亮起来再压回黑——比慢慢淡出更像「一炮打中」
      const flash = this.add
        .rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0xffffff, 0.92)
        .setScrollFactor(0)
        .setDepth(DEPTH.overlay + 3);
      this.tweens.add({
        targets: flash,
        alpha: 0,
        duration: 620,
        ease: 'Quad.easeOut',
        onComplete: () => flash.destroy(),
      });
      this.cameras.main.shake(700, 0.02);
      const dmgText = this.add
        .text(VIEW_W / 2, VIEW_H / 2 + 10, `-${dmg}`, {
          fontFamily: FONT_UI,
          fontSize: '26px',
          color: '#F0C419',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH.overlay + 4)
        .setAlpha(0);
      created.push(dmgText);
      // 不能靠 setScale 做弹出：相机 shake 会连文字一起放大（缩放途中撞上震屏，26px 会被拉成糊成一团的巨字）。
      this.tweens.add({ targets: dmgText, alpha: 1, duration: 200 });
      // 伤害数字下面再补一句「这是血量的三倍」——数字本身很大，但玩家需要知道它不是某条路子能抗住的
      const note = this.add
        .text(VIEW_W / 2, VIEW_H / 2 + 34, `超过你生命上限（${this.player.maxHp}）的 ${mult} 倍`, {
          fontFamily: FONT_UI,
          fontSize: '10px',
          color: '#C2BCD1',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH.overlay + 4)
        .setAlpha(0);
      created.push(note);
      this.tweens.add({ targets: note, alpha: 1, duration: 300, delay: 260 });
      this.tweens.add({ targets: sub, alpha: 0, duration: 300 });

      // 预警留到这一刻才淡：落弹后玩家还会盯着伤害数字看一会儿，
      // 提前撤掉的话「-300 生命上限的3倍」会孤零零挂着，看不出是谁打的
      this.time.delayedCall(760, () => {
        this.tweens.add({ targets: warn, alpha: 0, duration: 320 });
      });
      this.time.delayedCall(1100, () => {
        for (const o of created) o.destroy();
        // 血条归零只为了画面一致；真正的「死」由 playDefeatSequence 负责
        this.player.hp = 0;
        this.finalStrikeStage = 'defeat';
        this.playDefeatSequence();
      });
    };
    this.time.delayedCall(fs.warn_ms ?? 2600, fall);
  }

  /** Boss 阶段清空后的收束：副本去结算，剧情节点推进到下一节点 */
  private onBossPhaseCleared(): void {
    if (this.dungeon) this.finishDungeon();
    else this.completeNode();
  }

  /** 移出已死亡的敌人，避免 update 里反复对空气判定 */
  private clearDeadEnemies(): void {
    this.enemies = this.enemies.filter((e) => {
      if (!e.alive) {
        e.destroy();
        return false;
      }
      return true;
    });
  }

  private findEnemy(id: string): EnemyDef | undefined {
    return this.bundle.enemies.find((e) => e.id === id);
  }

  /* ==================== 模式：过场 / 抉择 ==================== */

  private setupCutscene(): void {
    emitObjective('过场');
    const dref = this.node.dialogue_ref as string | undefined;
    if (dref) this.playDialogue(dref, () => this.completeNode());
    else this.completeNode();
  }

  private setupChoice(): void {
    emitObjective('抉择');
    const params = this.node.params as {
      prompt?: string;
      options?: { label: string; outcome: string }[];
      must_pick?: number;
    };
    const options = params.options ?? [];
    const mustPick = params.must_pick ?? 0;

    const overlay = this.add.container(0, 0).setDepth(DEPTH.overlay);
    overlay.add(
      this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, PALETTE.ink, 0.9).setOrigin(0.5),
    );
    overlay.add(
      this.add
        .text(VIEW_W / 2, 54, params.prompt ?? '', {
          fontFamily: FONT_UI,
          fontSize: '12px',
          color: '#F2EDE4',
          align: 'center',
          wordWrap: { width: VIEW_W - 60 },
        })
        .setOrigin(0.5),
    );

    const resultText = this.add
      .text(VIEW_W / 2, 168, '', {
        fontFamily: FONT_UI,
        fontSize: '10px',
        color: '#C2BCD1',
        align: 'center',
        wordWrap: { width: VIEW_W - 60 },
      })
      .setOrigin(0.5);
    overlay.add(resultText);

    setInputEnabled(false);

    const tryFinish = (index: number) => {
      const opt = options[index];
      resultText.setText(opt.outcome);
      if (index === mustPick) {
        this.time.delayedCall(1500, () => {
          overlay.destroy();
          setInputEnabled(true);
          this.completeNode();
        });
      } else {
        // 选错不锁死：显示后果，再给一次机会
        this.time.delayedCall(1500, () => {
          resultText.setText('历史没有给出这个选项。再选一次。');
          setInputEnabled(true);
        });
      }
    };

    options.forEach((opt, i) => {
      const y = 104 + i * 26;
      const rect = this.add
        .rectangle(VIEW_W / 2, y, 220, 20, PALETTE.plumMid, 0.95)
        .setStrokeStyle(1, PALETTE.greyPlum)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(VIEW_W / 2, y, opt.label, { fontFamily: FONT_UI, fontSize: '11px', color: '#F2EDE4' })
        .setOrigin(0.5);
      overlay.add(rect);
      overlay.add(label);
      const onClick = () => {
        setInputEnabled(false);
        tryFinish(i);
      };
      rect.on('pointerdown', onClick);
      label.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    });
  }

  /* ==================== 对话 ==================== */

  private playDialogue(blockId: string, onDone?: () => void): void {
    const block = this.bundle.dialogues.find((d) => d.id === blockId);
    if (!block) {
      onDone?.();
      return;
    }
    const npcs = this.bundle.npcs ?? {};
    this.dialogue.show(
      block,
      npcs,
      (a) => this.onDialogueAction(a),
      () => {
        onDone?.();
      },
    );
  }

  private onDialogueAction(a: DialogueAction): void {
    switch (a.type) {
      case 'knowledge': {
        const id = String(a.value ?? a.item ?? '');
        if (id) this.grantKnowledge(id);
        break;
      }
      case 'flag':
        break;
      case 'bgm':
        break;
      case 'end':
        break;
      default:
        break;
    }
  }

  private grantKnowledge(id: string): void {
    const card = dataLoader.findKnowledge(id);
    if (!card) return;
    if (!addKnowledge(this.save, id)) return;
    persist();
    emitToast(`获得知识卡：${card.title}`, 2200);
    this.pushHud();
  }

  /* ==================== 交互 ==================== */

  private findNearObject(): MapObject | null {
    if (!this.map || !this.player) return null;
    let best: MapObject | null = null;
    let bestDist = 26;
    for (const o of this.worldObjects) {
      if (!o.rect.visible) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, o.rect.x, o.rect.y);
      if (d < bestDist) {
        bestDist = d;
        best = o.def;
      }
    }
    return best;
  }

  private handleInteract(): void {
    const obj = this.nearObject;
    if (!obj) return;

    switch (obj.kind) {
      case 'pickup': {
        // 还没听林大人吩咐就先别搬（甲方要求的顺序：旁白 → 搭话 → 搬箱）
        if (this.npcTalkObjId && !this.npcTalked) {
          emitToast('先去和林大人说句话', 1300);
          return;
        }
        if (this.carrying) {
          emitToast('已经抱着一箱了，先送去销烟池', 1300);
          return;
        }
        this.carrying = true;
        const entry = this.worldObjects.find((o) => o.def.id === obj.id);
        if (entry) this.hideWorldObject(entry);
        emitObjective(`搬运鸦片箱并投入销烟池　${this.cratesDelivered}/${this.crateTarget}`);
        emitToast('抱起一箱鸦片', 900);
        break;
      }
      case 'deposit': {
        if (!this.carrying) {
          emitToast('先搬一箱鸦片过来', 1100);
          return;
        }
        this.carrying = false;
        this.cratesDelivered += 1;
        this.poolPuff(obj);
        emitObjective(`搬运鸦片箱并投入销烟池　${this.cratesDelivered}/${this.crateTarget}`);
        if (this.cratesDelivered >= this.crateTarget) {
          this.setExitVisible(true);
          this.completeNode();
        }
        break;
      }
      case 'npc': {
        // 幕内指定了 npc_talk 的这位：播完他的台词才算「说过话」
        if (this.npcTalkObjId === obj.id && this.npcDialogueRef && !this.npcTalked) {
          this.playDialogue(this.npcDialogueRef, () => this.finishNpcTalk());
          break;
        }
        if (obj.dialogue_ref) this.playDialogue(obj.dialogue_ref);
        break;
      }
      case 'exit': {
        this.completeNode();
        break;
      }
      case 'prop': {
        if (obj.dialogue_ref) this.playDialogue(obj.dialogue_ref);
        break;
      }
    }
  }

  private poolPuff(obj: MapObject): void {
    const x = (obj.x + 0.5) * TILE;
    const y = (obj.y + 0.5) * TILE;
    for (let i = 0; i < 8; i++) {
      const p = this.add
        .rectangle(x + (rng() - 0.5) * 30, y, 3, 3, PALETTE.greyLight, 0.9)
        .setDepth(DEPTH.fx);
      this.tweens.add({
        targets: p,
        y: y - 24 - rng() * 18,
        alpha: 0,
        duration: 620 + rng() * 320,
        onComplete: () => p.destroy(),
      });
    }
  }

  /* ==================== 战斗 ==================== */

  private clearEnemies(): void {
    this.enemies.forEach((e) => e.destroy());
    this.enemies = [];
  }

  private clearProjectiles(): void {
    this.projectiles.forEach((p) => p.rect.destroy());
    this.projectiles = [];
  }

  private clearFloorItems(): void {
    this.floorItems.forEach((f) => this.destroyFloorItem(f));
    this.floorItems = [];
  }

  /**
   * 自动瞄准：返回范围内最近的可打敌人。
   * 玩家反馈「攻击不朝着移动方向」——所以远处只要有敌人，攻击就该转向它，
   * 而不是傻乎乎顺着走路方向挥空。
   */
  private nearestEnemy(maxDist: number): Enemy | null {
    let best: Enemy | null = null;
    let bestDist = maxDist;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
      if (d <= bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  /** 攻击/重击前先把朝向掰向最近的敌人（没有敌人就保持原朝向） */
  private aimRange(ranged: boolean, weaponRange: number): number {
    return ranged ? Math.max(160, weaponRange) : weaponRange + 34;
  }

  private playerAttack(power = 1): void {
    const w = this.player.weapon;
    const ranged = w.range > MELEE_RANGE_MAX;

    // 先瞄准再出手：命中方向用「到敌人的精确角度」，四方向朝向只负责画面
    const target = this.nearestEnemy(this.aimRange(ranged, w.range));
    const facing = this.player.facingVector();
    const aimX = target ? target.x - this.player.x : facing.x;
    const aimY = target ? target.y - this.player.y : facing.y;
    const aimLen = Math.hypot(aimX, aimY) || 1;
    const dirX = aimX / aimLen;
    const dirY = aimY / aimLen;
    if (target) this.player.faceTowards(dirX, dirY);

    if (power <= 1 && !this.player.tryAttack()) return;

    if (ranged) {
      // 远程：投射物朝敌人飞，而不是朝玩家原来的朝向
      const speed = w.projectile_speed || 260;
      // 远程里只有弓吃波次强化（近战在下面的扇形分支吃同一套状态）。
      // 火枪 260 / 机枪 220 仍按基础手感：否则齐射会变成「火枪一次放三发」，不是设计意图。
      const bow = upgradeClass(w) === 'bow';
      const up = this.currentUpgrades();
      const tune = this.upgradeTuning();
      const rows = bow ? volleyRows(up) : 1;
      const rowsP = bow ? 1 + (rows - 1) * tune.volley.damage_per_row : 1;
      const pierce = w.pierce + (bow ? bonusPierce(up) : 0);
      const dmg = this.player.atk * w.mult * power * rowsP * PLAYER_DMG;
      // 垂直于飞行方向的横向单位向量：斜射时这样才能上下错开而不是左右重叠
      const perpX = -dirY;
      const perpY = dirX;
      for (const off of rows === 1 ? [0] : volleyOffsets(rows, tune)) {
        const rect = this.add
          .rectangle(
            this.player.x + dirX * 10 + perpX * off,
            this.player.y - 2 + dirY * 6 + perpY * off,
            6,
            3,
            PALETTE.star,
          )
          .setDepth(DEPTH.projectile);
        this.projectiles.push({
          rect,
          vx: dirX * speed,
          vy: dirY * speed,
          damage: dmg,
          fromPlayer: true,
          pierce,
          life: 1.4,
          crit: rng() * 100 < this.player.crit,
        });
      }
      return;
    }

    // 近战：扇形判定（重击时判定范围略放大，手感上「扫一圈」）。
    // 波次强化取**当前近战武器实例**自己的状态：横扫放大扇形、破甲放大伤害，
    // 火线在 Player 的攻速钩子里生效。0 级时三个倍率都是 1，基础手感一字不变。
    const up = this.currentUpgrades();
    const tune = this.upgradeTuning();
    const sweep = sweepArcMult(up, tune);
    const cleave = cleaveDmgMult(up, tune);
    const reach = w.range + 8 + (power > 1 ? 6 : 0);
    const heavyMult = power > 1 ? 1.15 : 1;
    const arc = Phaser.Math.DegToRad(w.arc_deg) * sweep * heavyMult;
    const baseAngle = Math.atan2(dirY, dirX);
    // 刀光必须与真实判定同步变宽，否则玩家看到「扫到了」却没伤害（或反过来）。
    // 未强化时仍是原来的 82° / 110°，不影响任何既有表现。
    this.slashFx(baseAngle, reach, power > 1, (power > 1 ? 110 : 82) * sweep);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - this.player.x;
      const dy = e.y - this.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > reach) continue;
      const ang = Math.atan2(dy, dx);
      const diff = Math.abs(Phaser.Math.Angle.Wrap(ang - baseAngle));
      if (diff <= arc / 2 || dist <= 20) {
        this.damageEnemy(e, w.mult * power * cleave, DIST_MELEE);
      }
    }
  }

  /**
   * 近战刀光：一段扇形的白色弧扫出去。
   *
   * 甲方反馈「攻击没有动作、没有刀光」——贴图模式下角色只有 1px 浮动和 5px 抖动，
   * 手机上根本看不出打没打到。所以命中判定之外必须有一层可见的挥砍反馈：
   * 弧线从起手角度扫过判定扇形，0.16 秒淡出，比一闪而过的白块更能读出「砍了一下」。
   */
  private slashFx(baseAngle: number, reach: number, heavy: boolean, spreadDeg?: number): void {
    this.slashAt(
      this.player.x,
      this.player.y - 8,
      baseAngle,
      reach,
      heavy ? PALETTE.star : PALETTE.paper,
      spreadDeg ?? (heavy ? 110 : 82),
    );
  }

  /**
   * 通用刀光：在 (x, y) 处画一段 `spreadDeg` 度、半径 `reach` 的扇形。
   *
   * 我方用白/金色，敌方用暗红——同一套函数，颜色区分敌我。
   * 半径就是这一击的真实攻击距离，所以玩家能照着弧线判断「要不要后退」。
   */
  private slashAt(
    x: number,
    y: number,
    baseAngle: number,
    reach: number,
    color: number,
    spreadDeg: number,
  ): void {
    const g = this.add.graphics().setDepth(DEPTH.projectile);
    // 图形对象的坐标 = 刀光原点；扇形画在 (0,0) 局部坐标里，
    // 否则再 setPosition 会变成「画在 (x,y) 又整体偏移一次」，弧线跑到别处（踩过）。
    g.setPosition(x, y);
    const spread = Phaser.Math.DegToRad(spreadDeg);
    const start = baseAngle - spread / 2;
    // 扇形本体：淡色填充让人看出「打多远」，亮白刃口让人看出「刀从哪儿过」
    g.fillStyle(color, 0.38);
    g.slice(0, 0, reach, start, start + spread, false);
    g.fillPath();
    g.lineStyle(3, PALETTE.paper, 0.95);
    g.beginPath();
    g.arc(0, 0, reach * 0.92, start + 0.06, start + spread - 0.06, false);
    g.strokePath();
    g.lineStyle(1, color, 0.7);
    g.beginPath();
    g.arc(0, 0, reach, start, start + spread, false);
    g.strokePath();
    // 刀尖亮弧：一小段更亮的弧，读起来像刀锋扫过
    const mid = baseAngle;
    g.lineStyle(4, PALETTE.paper, 1);
    g.beginPath();
    g.arc(0, 0, reach * 0.94, mid - spread * 0.16, mid + spread * 0.16, false);
    g.strokePath();
    g.setScale(0.86);
    this.tweens.add({
      targets: g,
      alpha: 0,
      scale: 1,
      duration: 220,
      ease: 'Quad.easeOut',
      onComplete: () => g.destroy(),
    });
  }

  private damageEnemy(e: Enemy, mult: number, kind: 'melee' | 'ranged'): void {
    const res = computeDamage(
      {
        atk: this.player.atk,
        weaponMult: mult * PLAYER_DMG,
        targetDef: e.def_,
        attackerLevel: this.save.player.level,
        targetLevel: this.enemyLevel,
        critRate: this.player.crit / 100,
        critDmg: this.player.critDmg / 100,
        weakpoint: e.isWeakpoint,
      },
      this.cfg,
      rng,
    );
    const died = e.takeDamage(res.damage, res.crit, this.cfg);

    const fb = this.cfg.combat_feedback;
    const kb = kind === 'melee' ? fb.knockback_melee : fb.knockback_ranged;
    const dx = e.x - this.player.x;
    const dy = e.y - this.player.y;
    const len = Math.hypot(dx, dy) || 1;
    // 击退是 tween 直接平移，不查地形；落点必须在陆地上，否则小兵会被打出地图。
    // 这里把「落点是否可站」交给调用方判断，不可站就缩到贴着边界。
    if (e.def.tier !== 'boss') {
      e.rig.knockback(
        (dx / len) * kb,
        (dy / len) * kb,
        // 击退落点同样要过脚盒判据：把人推到贴墙处，下一帧他就走不动了
        (tx, ty) => this.enemyFootUnsafe(tx, ty),
      );
    }
    if (res.crit) this.cameras.main.shake(60, fb.screenshake_amp / 1000);

    if (died) this.onEnemyDeath(e);
  }

  private onEnemyDeath(e: Enemy): void {
    this.grantKillExp(e);
    this.rollDrop(e);
    // 指挥官被打死 → 周围友军的加成立刻消失（先打指挥官有回报）
    this.applyAuras();
    this.time.delayedCall(320, () => {
      e.destroy();
      this.enemies = this.enemies.filter((x) => x !== e);
    });
  }

  /**
   * 刷新「指挥官光环」：郭富准将这类带 ai_params.aura 的单位存活时，
   * 半径内的友军攻击力按 atk_pct 加成（多个光环叠乘）。
   */
  private applyAuras(): void {
    const providers = this.enemies.filter((e) => e.alive && e.def.ai_params?.aura);
    for (const e of this.enemies) {
      let mult = 1;
      for (const p of providers) {
        if (p === e) continue;
        const aura = p.def.ai_params?.aura;
        if (!aura) continue;
        if (Phaser.Math.Distance.Between(p.x, p.y, e.x, e.y) <= aura.radius) {
          mult *= 1 + aura.atk_pct / 100;
        }
      }
      e.auraMult = mult;
    }
  }

  /**
   * 虎门重炮：老师要求的核心技能。
   * 距离最近的目标开火，以它为中心溅射；伤害分档全在 core/cannon.ts 里（有单测）。
   * 冷却中按按钮只给提示，不消耗。
   */
  private fireCannon(): void {
    const p = this.cfg.skills?.humen_cannon;
    if (!p) return;
    if (!this.player.alive) return;
    if (this.cannonCd > 0) {
      emitToast(`虎门重炮冷却中 ${cooldownSeconds(this.cannonCd)} 秒`, 900);
      return;
    }
    const alive = this.enemies.filter((e) => e.alive);
    if (alive.length === 0) {
      emitToast('炮口前面没有目标', 900);
      return;
    }
    const inRange = alive
      .filter((e) => Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y) <= p.range_px)
      .sort(
        (a, b) =>
          Phaser.Math.Distance.Between(this.player.x, this.player.y, a.x, a.y) -
          Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y),
      );
    if (inRange.length === 0) {
      emitToast('敌人在射程外，等它们靠近', 1100);
      return;
    }
    const target = inRange[0];
    // 朝向目标（关天培亲燃大炮，炮口要对准）
    this.player.faceTowards(target.x - this.player.x, target.y - this.player.y);

    // 溅射范围内的所有敌人（含主目标）
    const splash = alive.filter((e) =>
      within(target.x, target.y, e.x, e.y, p.splash_px + (e.def.tier === 'boss' ? 22 : 0)),
    );
    const targets: CannonTarget[] = splash.map((e, i) => ({
      id: String(i),
      tier: e.def.tier,
      hp: e.hp,
      maxHp: e.maxHp,
    }));

    const result = planCannonShot(targets, p, this.player.maxHp, Math.random());
    this.cannonCd = p.cooldown_ms;

    if (result.kind === 'misfire') {
      // 炸膛：自己挨一下（绕过受击无敌，否则这一下会被吞掉）
      const dmg = this.player.takeRaw(result.selfDamage);
      emitToast(`炸膛！自己掉了 ${dmg} 点血`, 1800);
      this.cannonBlast(this.player.x, this.player.y, 22, true);
      this.pushHud();
      return;
    }

    const sx = this.player.x;
    const sy = this.player.y - 8;
    const shell = this.add.circle(sx, sy, 3, PALETTE.star, 1).setDepth(DEPTH.fx);
    const trail = this.add.rectangle(sx, sy, 10, 2, PALETTE.cream, 0.5).setDepth(DEPTH.fx - 1);
    this.tweens.add({
      targets: [shell, trail],
      x: target.x,
      y: target.y,
      duration: 220,
      ease: 'Quad.easeIn',
      onComplete: () => {
        shell.destroy();
        trail.destroy();
        this.cannonBlast(target.x, target.y, p.splash_px, false);
        result.hits.forEach((hit, i) => {
          const e = splash[i];
          if (!e || !e.alive) return;
          const died = e.takeDamage(hit.damage, false, this.cfg);
          e.rig.hitFlash(140);
          if (died) this.onEnemyDeath(e);
        });
      },
    });
    emitToast(`${p.name}！`, 1200);
    this.pushHud();
  }

  /**
   * 炮弹落点：己方（玩家）的虎门重炮。
   *
   * 甲方 m12276 明确要求「把开炮特效给军舰，我方开炮没有特效，这样可以形成装备对比」——
   * 所以这里**不播**那套 48 帧大火球（`playCannonBlastFx` 现在只归军舰的舰炮用），
   * 换成一个很短的炮口火光 + 一圈细冲击波：我方打出去的是「一声闷响」，军舰砸下来的是「一片火海」，
   * 两种火力放在同一屏里，装备差距不用台词解释。
   */
  private cannonBlast(x: number, y: number, radius: number, self: boolean): void {
    const tint = self ? PALETTE.redBright : PALETTE.star;
    // 炮口火光：两帧，12→22 像素就灭，绝不能盖住战场
    const flash = this.add.circle(x, y, self ? 18 : 15, tint, 0.5).setDepth(DEPTH.fx).setScale(0.5);
    this.tweens.add({
      targets: flash,
      scale: 1,
      alpha: 0,
      duration: 150,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
    // 一道细冲击环：宽度 1px，表示这是「打中了」，不是「炸开了」
    const ring = this.add
      .circle(x, y, radius, tint, 0)
      .setStrokeStyle(1, tint, 0.8)
      .setDepth(DEPTH.fx)
      .setScale(5 / Math.max(1, radius));
    this.tweens.add({
      targets: ring,
      scale: 1,
      alpha: 0,
      duration: 240,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
    // 力气小，烟也只有两缕
    for (let i = 0; i < 2; i++) {
      const a = Math.PI * i + Math.random();
      const puff = this.add.rectangle(x, y, 3, 3, PALETTE.greyPlum, 0.5).setDepth(DEPTH.fx - 1);
      this.tweens.add({
        targets: puff,
        x: x + Math.cos(a) * radius * 0.5,
        y: y + Math.sin(a) * radius * 0.4,
        alpha: 0,
        duration: 300,
        onComplete: () => puff.destroy(),
      });
    }
    this.cameras.main.shake(90, self ? 0.005 : 0.002);
  }

  /**
   * 播放甲方给的炮火特效（48 帧 × 96×96，见 `FX_TEX`）。
   *
   * **只有军舰的舰炮用它**（甲方 m12276：我方开炮不给特效，好和军舰做装备对比）。
   * 调用点只有 `salvoImpact()`；玩家的虎门重炮走 `cannonBlast()` 那套两帧小火光。
   *
   * 用一张 Image 每帧 `setTexture` 推进，而不是建 48 个对象或做 sprite sheet：
   * 一个精灵就够，帧图已经是拆好的 PNG，省掉打包步骤（改图只要重跑 `tools/import_fx.py`）。
   * 计时用 `scene.time.addEvent`，帧率与 `FX_FRAME_MS` 对齐；场景关闭时事件随场景一起销毁。
   * 缺图（首帧不存在）时直接返回，让 `salvoImpact` 的程序化冲击波兜底。
   */
  private playCannonBlastFx(x: number, y: number, self: boolean): void {
    const first = `${FX_TEX.cannonBlast}_0`;
    if (!this.textures.exists(first)) return;
    const fx = markPixel(
      this.add
        .image(x, y, first)
        .setOrigin(0.5, 0.5)
        .setDepth(DEPTH.fx)
        // 炸膛是"自己脚下炸"，画小一圈，免得盖住整块战场
        .setScale(self ? 0.62 : 1),
    );
    let frame = 0;
    const timer = this.time.addEvent({
      delay: FX_FRAME_MS,
      repeat: FX_CANNON_FRAMES - 1,
      callback: () => {
        frame += 1;
        if (frame >= FX_CANNON_FRAMES) {
          timer.remove();
          fx.destroy();
          return;
        }
        fx.setTexture(`${FX_TEX.cannonBlast}_${frame}`);
      },
    });
  }

  private grantKillExp(e: Enemy): void {
    const table: Record<string, number> = { mob: 6, standard: 10, ranged: 12, elite: 45, boss: 200 };
    const gain = table[e.def.tier] ?? 10;
    this.addExp(gain);
  }

  private addExp(gain: number): void {
    const res = applyExp(this.save.player.level, this.save.player.exp, gain, this.cfg);
    if (res.levelsGained > 0) {
      emitToast(`升级！Lv${res.level}`, 1600);
      const stats = effectiveStats(res.level, this.save.knowledge.length, this.save.equipment, this.cfg);
      this.player.setStats(stats);
      this.player.hp = this.player.maxHp;
    }
    this.save.player.level = res.level;
    this.save.player.exp = res.exp;
    this.save.player.hp = res.stats.hp;
    this.save.player.atk = res.stats.atk;
    this.save.player.def = res.stats.def;
    this.pushHud();
  }

  /**
   * 掉落物的两个正交维度：**形状承载槽位、颜色承载品质**，紫色再加一层呼吸光。
   * 原来所有掉落都是同一个 8×8 纯色方块，玩家在场上根本判断不了值不值得绕路去捡。
   * 返回容器 + 可选光效；光效 tween 必须在 destroyFloorItem 里先 kill 掉。
   */
  private makeDropVisual(
    x: number,
    y: number,
    item: ItemInstance,
  ): { obj: Phaser.GameObjects.Container; glow?: Phaser.GameObjects.Arc } {
    const color =
      item.quality === 'purple'
        ? PALETTE.greyPlum
        : item.quality === 'blue'
          ? PALETTE.blueLight
          : PALETTE.greyLight;
    const children: Phaser.GameObjects.GameObject[] = [];
    let glow: Phaser.GameObjects.Arc | undefined;
    if (item.quality === 'purple') {
      glow = this.add.circle(0, 0, 9, PALETTE.star, 0.32).setName('drop-glow');
      children.push(glow);
    }
    children.push(
      this.add.rectangle(0, 0, 8, 8, color).setStrokeStyle(1, PALETTE.ink).setName('drop-base'),
    );
    let mark: Phaser.GameObjects.GameObject;
    switch (item.slot) {
      case 'weapon': // 竖条：刀 / 弓 / 撬棍
        mark = this.add.rectangle(0, -9, 2, 7, color);
        break;
      case 'head': // 三角：帽 / 巾
        mark = this.add.triangle(0, -9, 0, 0, 4, 7, -4, 7, color);
        break;
      case 'body': // 空心方块：衣甲
        mark = this.add.rectangle(0, -9, 7, 7, color, 0).setStrokeStyle(1, color);
        break;
      case 'legs': // 短横：绑腿
        mark = this.add.rectangle(0, -9, 9, 2, color);
        break;
      default: // 菱形：饰品
        mark = this.add.rectangle(0, -9, 5, 5, color).setAngle(45);
        break;
    }
    mark.setName(`drop-shape-${item.slot}`);
    children.push(mark);

    const obj = this.add.container(x, y, children).setDepth(DEPTH.deco + 3);
    obj.setData('slot', item.slot);
    obj.setData('quality', item.quality);
    if (glow) {
      this.tweens.add({
        targets: glow,
        alpha: 0.08,
        duration: 720,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    return glow ? { obj, glow } : { obj };
  }

  /** 统一销毁：先停紫装呼吸光的 tween，再销毁容器（容器会连带销毁子对象） */
  private destroyFloorItem(f: FloorItem): void {
    if (f.glow) this.tweens.killTweensOf(f.glow);
    f.obj.destroy();
  }

  private rollDrop(e: Enemy): void {
    const drops = dataLoader.getDrops();
    const rule = drops.rules.find((r) => r.source_type === e.def.tier);
    if (!rule) return;
    if (rng() > rule.drop_chance) return;

    // 副本：按副本自己的品质权重 + 逐副本保底计数；
    // 剧情关卡：一次性掉落，用通用权重即可（不参与保底）
    let weights: Record<Quality, number>;
    if (this.dungeon) {
      const st = getDungeonState(this.save, this.dungeon.id);
      weights = dungeonPityWeights(this.dungeon.quality_weights, st.missPurple);
    } else {
      weights = { ...rule.quality_weights };
    }

    const quality = rollQuality(weights, rng);
    const slot = rollSlot(rule.slot_weights, rng);

    const candidates = dataLoader.getItems().filter((i) => i.quality === quality && i.slot === slot && i.source !== 'first_clear');
    const basePool = candidates.length > 0 ? candidates : dataLoader.getItems().filter((i) => i.quality === quality && i.slot === slot);
    if (basePool.length === 0) return;
    // 同一次副本里不掉两件一模一样的东西：先剔掉本趟已经出过的基础模板
    const already = new Set<string>([
      ...this.runDrops.map((i) => i.base_id),
      ...this.floorItems.map((f) => f.item.base_id),
    ]);
    const fresh = basePool.filter((b) => !already.has(b.id));
    const pool = fresh.length > 0 ? fresh : basePool;
    const base = pool[Math.floor(rng() * pool.length)];
    const item = makeItemInstance(base, this.cfg, rng);

    // 掉落不能落在海里：敌人死在岸边时装备会沉进水里，玩家永远捡不到
    // （甲方报的「掉的装备也会掉到海里」）。用 space.ts 的最近空地搜一次，落点保证能走上去。
    const spot = this.landingNear(e.x, e.y);
    const v = this.makeDropVisual(spot.x, spot.y, item);
    this.floorItems.push({ obj: v.obj, item, ...(v.glow ? { glow: v.glow } : {}) });
  }

  /**
   * 找最近的可站点（避开海水与碰撞格）。
   * 敌人被击退到岸边、或船把海面推到脚下时，所有掉落物与敌人都要用它落位。
   */
  private landingNear(wx: number, wy: number): { x: number; y: number } {
    if (!this.map) return { x: wx, y: wy };
    const map = this.map;
    const q = {
      cols: map.def.width,
      rows: map.def.height,
      tile: TILE,
      // 注意：`blocked` 收到的是**像素坐标**（nearestOpenPoint 传的是 tile 中心
      // `p.x / p.y`），不是瓦片索引。这里原来把形参命名成 gx/gy、又拿去当索引用，
      // 于是像素值 376 被当成列号 → 越界 → 一律返回 true → 永远找不到空地，
      // 直接退化成「原坐标返回」。后果：敌人被击退到界外后没有任何落点可回去。
      blocked: (px: number, py: number) => {
        if (this.isSeaAt(px, py)) return true;
        if (map.isSeaAtWorld(px, py)) return true;
        return map.isSolidAtTile(Math.floor(px / TILE), Math.floor(py / TILE));
      },
    };
    return nearestOpenPoint(wx, wy, q) ?? { x: wx, y: wy };
  }

  /**
   * 敌人专用的最近落脚点：判据换成「中心 + 脚盒四角」。
   *
   * `landingNear()` 是给 8×8 掉落物和玩家用的，只看一个点；直接拿它给敌人用，
   * 找出来的「空地」仍可能把 12×8 的脚盒塞进墙里。两者不能混用。
   */
  private landingNearForEnemy(wx: number, wy: number): { x: number; y: number } {
    if (!this.map) return { x: wx, y: wy };
    const q = {
      cols: this.map.def.width,
      rows: this.map.def.height,
      tile: TILE,
      blocked: (px: number, py: number) => this.enemyFootUnsafe(px, py),
    };
    return nearestOpenPoint(wx, wy, q) ?? { x: wx, y: wy };
  }

  private collectNearbyItems(): void {
    const R = 20;
    for (const f of [...this.floorItems]) {
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, f.obj.x, f.obj.y) > R) continue;
      const r = addToBag(this.save, f.item);
      this.destroyFloorItem(f);
      this.floorItems = this.floorItems.filter((x) => x !== f);
      if (r === 'ok') {
        this.runDrops.push(f.item);
        // 装备「存在感」P0：把「比我身上这件好多少」当场算给玩家看，
        // 不再让他自己心算。只显示主属性差值，不动任何数值。
        const delta = compareWithEquipped(f.item, this.save.equipment);
        emitToast(
          `拾取 ${f.item.name}（${qualityLabel(f.item.quality)}）　${formatStatDelta(delta)}`,
          1400,
        );
      } else {
        emitToast('背包已满，已自动拆分', 1400);
      }
      persist();
    }
  }

  /* ==================== Boss 三段招式（设计书 3.3.1 / 6.5.2） ==================== */

  /** 一招前的预警：以 Boss 为中心扩散的红环 */
  private telegraphRing(e: Enemy, radius: number): void {
    const r = Math.max(30, radius);
    const ring = this.add
      .circle(e.x, e.y, r, PALETTE.redBright, 0)
      .setStrokeStyle(2, PALETTE.redBright, 0.9)
      .setDepth(DEPTH.fx)
      // Arc 没有可 tween 的 `radius`（见 `spawnSalvoShell` 注释），所以先按最终半径画好再从小放大
      .setScale(8 / r);
    this.tweens.add({
      targets: ring,
      scale: 1,
      alpha: 0,
      duration: 600,
      onComplete: () => ring.destroy(),
    });
  }

  /** 舷炮齐射：朝向玩家的扇形弹幕 */
  private bossVolley(e: Enemy, count: number, spreadDeg: number): void {
    const base = Math.atan2(this.player.y - e.y, this.player.x - e.x);
    const spread = Phaser.Math.DegToRad(spreadDeg);
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5;
      const ang = base + t * spread * (count - 1);
      const speed = 165;
      const rect = this.add.rectangle(e.x, e.y, 6, 6, PALETTE.redBright).setDepth(DEPTH.projectile);
      this.projectiles.push({
        rect,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        damage: e.atk * e.auraMult,
        fromPlayer: false,
        pierce: 0,
        life: 2.4,
        crit: false,
      });
    }
    this.cameras.main.shake(120, 0.004);
  }

  /**
   * 舰炮落点预警齐射（甲方 m12276：「新增军舰可以发射炮弹，系统提示落点让角色可以躲开」）。
   *
   * 一条炮弹走三段，**落点在开炮那一刻就定死**，玩家看得到圈、走两步就能躲：
   *   1. `SALVO_WARN_MS` 秒里，落点上画一个由大缩到小的红圈（收拢到圈边以内 = 快落弹了）；
   *   2. 圈闪白一下 → 炮弹从天而降（`SALVO_FALL_MS` 的竖直落体），落点不跟随玩家；
   *   3. 落地炸开：范围伤害 + 火光 + 震屏，然后连圈带弹一起销毁。
   * 伤害判定用「落点半径 vs 玩家碰撞体」，不用矩形重叠——玩家只要走出圈就完全不吃伤害。
   *
   * `count` 发炮弹会留 1~2 发「预判」打在玩家前方（朝它跑的方向偏一点），
   * 一路直着跑会被预判弹咬到，得侧向绕——这是这招唯一的技术含量。
   */
  private bossSalvo(e: Enemy, count: number, spreadDeg: number): void {
    if (!this.player.alive || this.salvoActive) return;
    this.salvoActive = true;
    const p = SALVO;
    const base = p.radiusPx;
    const maxR = (this.map?.pixelWidth ?? VIEW_W) - 16;
    const maxB = (this.map?.pixelHeight ?? VIEW_H) - 16;
    const px = this.player.x;
    const py = this.player.y;
    // 玩家正在往哪边跑：预判弹就打在它前面，逼玩家改方向
    const lead = p.leadPx;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      // 以玩家为圆心，沿一条垂直于瞄准线的弧散开（不会都砸在同一点）
      const off = (t - 0.5) * Phaser.Math.DegToRad(spreadDeg) * 2;
      const dist = i === 0 ? 0 : base + lead;
      const ang = Math.atan2(py - e.y, px - e.x) + off;
      const tx = Phaser.Math.Clamp(px + Math.cos(ang) * dist, 16, maxR);
      const ty = Phaser.Math.Clamp(py + Math.sin(ang) * dist, 16, maxB);
      this.spawnSalvoShell(e, tx, ty);
    }
    e.rig.hitFlash(90);
    this.cameras.main.shake(120, 0.003);
    this.time.delayedCall(SALVO.warnMs + SALVO.fallMs + SALVO.recoverMs, () => {
      this.salvoActive = false;
    });
  }

  /** 单发预警炮：落地一个圈 → 闪白 → 炮弹落下 → 炸开 */
  private spawnSalvoShell(e: Enemy, tx: number, ty: number): void {
    const p = SALVO;
    const ring = this.add
      .circle(tx, ty, p.radiusPx, PALETTE.redDark, 0.18)
      .setStrokeStyle(2, PALETTE.redBright, 0.95)
      .setDepth(DEPTH.fx - 2);
    // 内圈从半径的一半开始收：收到贴住外圈时分秒就到。
    // **注意**：Phaser 的 Arc 没有可 tween 的 `radius` 属性（`TweenData` 会去 set
    // `radius`，Arc 上没有这个 setter，直接抛 `Cannot set properties of null`），
    // 所以这里用 `scale` 缩小——Arc 的 scale 会把整个圆连同半径一起缩。
    const inner = this.add
      .circle(tx, ty, p.radiusPx, PALETTE.star, 0.22)
      .setDepth(DEPTH.fx - 3)
      .setScale(0.4);
    this.tweens.add({
      targets: inner,
      scale: 1,
      duration: p.warnMs,
      ease: 'Quad.easeIn',
    });
    this.tweens.add({ targets: ring, alpha: { from: 0.95, to: 0.55 }, duration: 260, yoyo: true, repeat: -1 });

    this.time.delayedCall(p.warnMs, () => {
      if (!ring.active) return;
      ring.setStrokeStyle(3, PALETTE.paper, 1);
      inner.destroy();
      // 炮弹：从上方竖直落下，落点就是圈心（不追人）
      const shell = this.add
        .rectangle(tx, ty - p.fallFromPx, 5, 8, PALETTE.ink, 1)
        .setStrokeStyle(1, PALETTE.star, 1)
        .setDepth(DEPTH.fx);
      this.tweens.add({
        targets: shell,
        y: ty,
        duration: p.fallMs,
        ease: 'Quad.easeIn',
        onComplete: () => {
          shell.destroy();
          ring.destroy();
          this.salvoImpact(e, tx, ty);
        },
      });
    });
  }

  /** 炮弹落地：范围伤害 + 火光（这才是「只给军舰」的那套大特效） */
  private salvoImpact(e: Enemy, tx: number, ty: number): void {
    const p = SALVO;
    this.playCannonBlastFx(tx, ty, false);
    // 冲击环用 scale 放大（Arc 不能 tween radius，见 `spawnSalvoShell` 的注释）
    const ring = this.add
      .circle(tx, ty, p.radiusPx, PALETTE.star, 0.55)
      .setStrokeStyle(2, PALETTE.star)
      .setDepth(DEPTH.fx)
      .setScale(0.15);
    this.tweens.add({
      targets: ring,
      scale: 1,
      alpha: 0,
      duration: 340,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * 2 * i) / 6 + Math.random();
      const puff = this.add.rectangle(tx, ty, 4, 4, PALETTE.greyPlum, 0.75).setDepth(DEPTH.fx - 1);
      this.tweens.add({
        targets: puff,
        x: tx + Math.cos(a) * p.radiusPx * 0.8,
        y: ty + Math.sin(a) * p.radiusPx * 0.5,
        alpha: 0,
        duration: 420,
        onComplete: () => puff.destroy(),
      });
    }
    this.cameras.main.shake(220, 0.008);
    if (!this.player.alive) return;
    const d = Phaser.Math.Distance.Between(tx, ty, this.player.x, this.player.y);
    if (d <= p.radiusPx) {
      const dmg = this.player.takeDamage(incoming(e.atk * p.damageMult));
      if (dmg > 0) {
        this.cameras.main.shake(240, 0.012);
        emitToast('被舰炮命中！看到红圈就该躲开', 1500);
      }
    } else {
      emitToast('躲开了舰炮', 800);
    }
  }
  private bossSummon(e: Enemy, enemyId: string, count: number): void {
    const def = this.findEnemy(enemyId);
    if (!def) return;
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 300, () => this.spawnEnemy(def, 'right'));
    }
    emitToast('敌军放下登陆艇', 1300);
    void e;
  }

  /** 撞角冲刺：冲完搁浅，露出弱点（设计书：此时武器倍率 ×2.5） */
  private bossCharge(e: Enemy, dx: number, dy: number): void {
    // 军舰原地不动（甲方 m12276）：它连撞角都不冲，只原地放舰炮。
    // 数据里 `ram` 这一招还留着（技能表是内容层），到这里直接转成一次齐射，
    // 这样「玩家看得到它每招都在打」但「它一步也没逼近」。
    if (e === this.bossShip) {
      if (this.shipMoving) return;
      this.shipMoving = true;
      this.shipTimer = 6500;
      emitToast('炮舰原地舷炮齐射', 1200);
      this.bossSalvo(e, 3, 44);
      this.time.delayedCall(900, () => {
        this.shipMoving = false;
      });
      return;
    }
    const step = 120;
    const maxX = (this.map?.pixelWidth ?? VIEW_W) - 24;
    const maxY = (this.map?.pixelHeight ?? VIEW_H) - 24;
    const wantX = e.x + dx * step;
    const wantY = e.y + dy * step;
    const tx = Phaser.Math.Clamp(wantX, 24, maxX);
    const ty = Phaser.Math.Clamp(wantY, 24, maxY);
    let hit = false;
    this.cameras.main.shake(180, 0.005);
    this.tweens.add({
      targets: e.rig,
      x: tx,
      y: ty,
      duration: 620,
      ease: 'Quad.easeIn',
      onUpdate: () => {
        if (
          !hit &&
          this.player.alive &&
          Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y) < 30
        ) {
          hit = true;
          const d = this.player.takeDamage(incoming(e.atk));
          if (d > 0) this.cameras.main.shake(180, 0.009);
        }
      },
      onComplete: () => {
        e.finishCharge();
        emitToast('炮舰搁浅，露出弱点！', 1800);
      },
    });
  }

  /**
   * 该世界坐标是否落在军舰碾出来的海面上（只有玩家会被挡住）。
   *
   * 军舰已经不前压了（m12276），`paintSea` 随之删掉，`seaTiles` 恒为空。
   * 这个方法保留：它是海关判定的唯一入口，`isSeaAt` 恒 false 也就等于「没有运行时海面」，
   * 而地图数据里画的原始海面仍由 `MapRenderer.isSeaAtWorld` 管——两套不能混。
   */
  private isSeaAt(wx: number, wy: number): boolean {
    if (this.seaTiles.size === 0) return false;
    return this.seaTiles.has(`${Math.floor(wx / TILE)},${Math.floor(wy / TILE)}`);
  }

  /**
   * 摆一件 Sunny Land 静态布景（`kind:'prop'`）。
   *
   * 三条规矩，都是从人群那边抄过来的教训：
   *  1. **只画不登记**——不推进 `worldObjects`，玩家走近不会弹「搬起 / 投入」，
   *     它就是个 scenery，不是可交互物。
   *  2. **不挡路**——也**不**走 `extraSolid`。人群挡路是因为「站在场上的人」有体积；
   *     而布景是按格子摆的，一旦挡路就得回头核对每张图的可达性、甚至补碰撞层，
   *     而这批物件里常常有贴着拾取物摆的（木箱挨着鸦片箱）。宁可穿过去也不改通关性。
   *  3. **不画兜底方块**——贴图缺失时留空并 warn（构建问题交给 `tests/art.test.ts`），
   *     一块和人物等高的深色方块比什么都不画更误导。
   *
   * 深度取 `DEPTH.deco + 2`：压在地面与贴花之上、人物（≥ entityBase）之下——
   * 玩家走过的路牌会被人物盖住一圈，看起来像「站在牌子后面」。
   */
  private spawnSunnyProp(name: SunnyProp, x: number, y: number): void {
    const key = sunnyPropKey(name);
    if (!this.textures.exists(key)) {
      console.warn(`[prop] 缺少贴图 ${key}，该处布景不绘制`);
      return;
    }
    const sunk = SUNNY_GROUND_PROPS.has(name);
    // 沉进地面的小物件反而**要多下压**：它们的底边本来是「贴地的那条线」，
    // 原尺寸直接贴格子下沿会浮在格子里；压 4px 后底边正好落在地砖中缝上。
    const img = markPixel(this.add.image(x, y + (sunk ? 4 : 8), key).setOrigin(0.5, 1).setDepth(DEPTH.deco + 2));
    // 这里**不要**再 `texture.setFilter(NEAREST)`：贴图的 filter 是纹理级属性，
    // 一张图被哪几处在用是共享的，对布景调一次等于对同 key 的所有 Image 生效。
    this.propSprites.push({ name, img });
  }

  /**
   * 这个格子是不是站着围观百姓（挡路用）。
   *
   * 只在 `spawnCrowd` 里登记，值是格坐标；玩家和敌人的路径都用
   * `MapRenderer.isSolidAtWorld` → `extraSolid` 判定，所以人群天然挡人。
   */
  private isCrowdAt(wx: number, wy: number): boolean {
    if (this.crowdSolids.size === 0) return false;
    return this.crowdSolids.has(`${Math.floor(wx / TILE)},${Math.floor(wy / TILE)}`);
  }

  /**
   * 海面可能盖住玩家脚下：把人挪到最近的可站点。
   *
   * 为什么不能只往左退：海面是运行时额外禁区（不走地图碰撞格），
   * 而且军舰会一次压出 3 行；只朝一个方向退、且只判断 `isSolidAtWorld`（对海面恒为 false）
   * 会让玩家永远卡在水里——玩家实测就是这样走不出去的。这里改成环形搜最近空地。
   */
  private ejectPlayerFromSea(): void {
    const map = this.map;
    if (!map || !this.player) return;
    const px = this.player.x;
    const py = this.player.y;
    if (!this.isSeaAt(px, py)) return;
    const spot = nearestOpenPoint(px, py, {
      cols: map.grid.cols,
      rows: map.grid.rows,
      tile: TILE,
      blocked: (x, y) => this.isSeaAt(x, y) || map.isSolidAtWorld(x, y),
    });
    if (!spot) return;
    this.player.rig.setPosition(spot.x, spot.y);
    emitToast('水太深了，退回岸上');
  }

  /**
   * 把「掉出地图」的敌人捞回来。
   *
   * 甲方第三次报「小兵又被打出地图」——截图中英军站在地图右侧那片原始海面上，
   * 玩家够不到。三种越界来源都绕过碰撞：
   *   1. `CharacterRig.knockback()` 用 tween 直接平移，完全不查地形（击退是主因）；
   *   2. 刷怪点 `spawn` 落在海面上时，敌人当场就站在水里；
   *   3. 军舰压出的 `seaTiles` 盖住了敌人脚下。
   *
   * 判定必须同时查三样：地图外/墙里（`isSolidAtWorld`）、军舰压出的海面（`isSeaAt`）、
   * **地图数据里的原始海面**（`map.isSeaAtWorld`）。只查前两者是之前那份补丁漏掉
   * 原始海面的原因——那片蓝不在碰撞格里，`isSolidAtWorld` 对它恒为 false。
   *
   * v1.6 补第四种「越界」：**脚盒嵌墙**。甲方截图「这两个小兵卡住了」里，两个英军
   * 贴着右边界墙一动不动——出怪点抖动 +5px 后身体中心仍在空地，但 12×8 脚盒的
   * 右角已进 col 29 的墙，之后每一帧两轴移动都被 `footBlocked` 拒绝；而本函数
   * 原先只看中心那一个像素，判定「站得好好的」，永远不救援。现在统一走
   * `enemyFootUnsafe`（中心 + 四角）与 `landingNearForEnemy`。
   */
  private rescueStrayEnemies(): void {
    const map = this.map;
    if (!map) return;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive) continue;
      // 只看中心会漏掉「半个脚盒嵌在墙里」的小兵：他哪儿也去不了，
      // 但旧判据一直认为他站得好好的（贴右墙一动不动那两个就是这么来的）。
      if (!this.enemyFootUnsafe(e.x, e.y)) continue;
      const spot = this.landingNearForEnemy(e.x, e.y);
      // 找不到真正合法的落脚点就别把人乱挪，否则会在墙边来回瞬移
      if (this.enemyFootUnsafe(spot.x, spot.y)) continue;
      e.teleportTo(spot.x, spot.y);
    }
  }

  /**
   * 敌人站在 (wx, wy) 会不会掉出去：地图外 / 墙里 / 原始海面。
   * 击退落点与每帧兜底共用这一条判据，避免两处判定漂移。
   *
   * （`isSeaAt` 现在恒为 false —— 军舰不再前压就不会有运行时海面，见 `bossCharge`。
   * 判定里仍然留着它，是因为「运行时禁区」这个口子以后要是有别的机制来填，收敛成一处更安全。）
   */
  private enemySpotUnsafe(wx: number, wy: number): boolean {
    const map = this.map;
    if (!map) return false;
    if (this.isSeaAt(wx, wy) || map.isSeaAtWorld(wx, wy)) return true;
    return map.isSolidAtWorld(wx, wy);
  }

  /**
   * 敌人站在 (wx, wy) 时，**身体中心与 12×8 脚盒四角**有没有踩进禁区。
   *
   * 与 `enemySpotUnsafe` 的差别就是那四个角。出生点校正、每帧救援、击退落点、
   * 最近落脚点全部走这一条，避免「中心合法但脚卡墙里」的半嵌状态漏网。
   * `map.isSolidAtWorld` 内含 `extraSolid`（军舰海面 / 销烟人群），无需再单独判一次。
   */
  private enemyFootUnsafe(wx: number, wy: number): boolean {
    const map = this.map;
    if (!map) return false;
    return isFootBlocked(wx, wy, (px, py) =>
      this.isSeaAt(px, py) || map.isSeaAtWorld(px, py) || map.isSolidAtWorld(px, py),
    );
  }

  /* ==================== 弹道 ==================== */

  private spawnEnemyProjectile(e: Enemy, tx: number, ty: number): void {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = 170;
    const rect = this.add
      .rectangle(e.x, e.y, 5, 5, PALETTE.redBright)
      .setDepth(DEPTH.projectile);
    this.projectiles.push({
      rect,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      damage: e.atk * e.auraMult,
      fromPlayer: false,
      pierce: 0,
      life: 2.2,
      crit: false,
    });
  }

  private updateProjectiles(dt: number): void {
    const toRemove: Projectile[] = [];
    for (const p of this.projectiles) {
      p.life -= dt / 1000;
      p.rect.x += (p.vx * dt) / 1000;
      p.rect.y += (p.vy * dt) / 1000;

      if (p.life <= 0 || (this.map && this.map.isSolidAtWorld(p.rect.x, p.rect.y))) {
        toRemove.push(p);
        continue;
      }

      if (p.fromPlayer) {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (Phaser.Math.Distance.Between(p.rect.x, p.rect.y, e.x, e.y) < 16) {
            const res = computeDamage(
              {
                atk: this.player.atk,
                weaponMult: this.player.weapon.mult * PLAYER_DMG,
                targetDef: e.def_,
                attackerLevel: this.save.player.level,
                targetLevel: this.enemyLevel,
                critRate: this.player.crit / 100,
                critDmg: this.player.critDmg / 100,
                weakpoint: e.isWeakpoint,
              },
              this.cfg,
              rng,
            );
            const died = e.takeDamage(res.damage, res.crit, this.cfg);
            if (died) this.onEnemyDeath(e);
            if (p.pierce > 0) p.pierce -= 1;
            else {
              toRemove.push(p);
              break;
            }
          }
        }
      } else if (this.player.alive) {
        if (Phaser.Math.Distance.Between(p.rect.x, p.rect.y, this.player.x, this.player.y) < 14) {
          const dmg = this.player.takeDamage(incoming(p.damage));
          if (dmg > 0) this.cameras.main.shake(70, 0.003);
          toRemove.push(p);
        }
      }
    }
    for (const p of toRemove) {
      p.rect.destroy();
      this.projectiles = this.projectiles.filter((x) => x !== p);
    }
  }

  /* ==================== 节点完成 ==================== */

  /**
   * @param force 战败链要走到这里时必须为 true：`playDefeatSequence` 全程把 `nodeBusy`
   *   立着（防止波次刷新与死亡判定插进来），而正常结算开头就 `if (this.nodeBusy) return;`。
   *   不放开这一条，「关天培牺牲」之后会停在原地——正是老师说的「直接卡死」。
   */
  private completeNode(force = false): void {
    this.closeWeaponBag('auto');
    if (this.nodeBusy && !force) return;
    // 副本没有节点概念，误入此路径时交给副本结算，避免读不到 this.node 而崩
    if (this.dungeon || !this.node) {
      this.finishDungeon();
      return;
    }
    this.nodeBusy = true;

    markNodeDone(this.save, this.node.id);
    const evId = this.node.event_id;
    if (evId && !this.save.progress.events.includes(evId)) {
      this.save.progress.events.push(evId);
    }

    // 节点奖励：知识卡 / 武器
    const rewardK = this.node.params.reward_knowledge as string | undefined;
    if (rewardK) this.grantKnowledge(rewardK);
    const rewardW = this.node.params.reward_weapon as string | undefined;
    if (rewardW && !this.save.weapons.includes(rewardW)) {
      this.save.weapons.push(rewardW);
      const w = this.cfg.weapons[rewardW];
      emitToast(`解锁武器：${w?.name ?? rewardW}`, 2000);
      if (w) this.player.setWeapon(w, PALETTE.brown);
    }

    // 节点经验
    if (this.mode === 'combat') this.addExp(this.act.exp_base);

    persist();

    const next = this.nodeIndex + 1;
    if (next < this.act.nodes.length) {
      this.time.delayedCall(500, () => {
        void this.startNode(next);
      });
    } else {
      this.time.delayedCall(600, () => this.finishAct());
    }
  }

  private finishAct(): void {
    this.closeWeaponBag('auto');
    // 首通奖励
    const rewardId = this.act.first_clear_reward;
    const key = `act_cleared_${this.act.id}`;
    if (!this.save.achievements.includes(key)) {
      this.save.achievements.push(key);
      const base = dataLoader.findItemBase(rewardId);
      if (base) {
        const item = makeItemInstance(base, this.cfg, rng);
        addToBag(this.save, item);
        emitToast(`首通奖励：${item.name}`, 2400);
      }
    }
    persist();
    setInputEnabled(true);
    this.scene.stop('UI');
    this.scene.start('Hub', { chapterId: this.act.chapter_id });
  }

  /* ==================== 主循环 ==================== */

  private onAdvanceInput(): void {
    if (this.dialogue?.isActive) {
      this.dialogue.advance();
      return;
    }
    if (this.mode === 'explore' && controls.interactPressed) {
      this.handleInteract();
    }
  }

  override update(time: number, delta: number): void {
    this.updateWorld(time, delta);
    // 镜头跟随（逻辑坐标，见 cameraScrollTarget 的注释）。放在 updateWorld 之后：
    // 它返回早（过场/经营/切换中）时这里自己会因 camFollow 为 null 而跳过。
    this.updateCameraFollow();
    // 「本帧按下」标志必须等本场景消费完再清。以前这一步在 UIScene.update 里做，
    // 而触摸事件是在两个场景的 update 之间送达的，于是单次点击会在被读到之前就被清掉
    // —— 表现就是「按住摇杆再按攻能打出伤害，单点攻毫无反应」。
    controls.endFrame();
  }

  private updateWorld(_time: number, delta: number): void {
    // 换武器面板放在最前面：即便切节点把 player / map 清掉了，也要先把面板收干净。
    // 每帧复检门禁，节点完成、副本结算、战败、切节点、阵亡都会让它失效 → 自动收起。
    // 放在这里而不是只靠各出口显式调用，是为了不漏掉任何一条新增的结束路径。
    if (this.weaponBagOpen) {
      if (!canOpenWeaponBag({ ...this.weaponBagGate(), bagOpen: false }).ok) {
        this.closeWeaponBag('auto');
        return;
      }
      setControlsVisible(false);
      return;
    }
    if (!this.player || !this.map) return;
    // 战败面板：冻结世界，也别让下面每帧的 setControlsVisible 把摇杆又放回来
    if (this.storyFailOpen) return;
    // 节点切换期间（startNode 内有 await）不做任何世界逻辑
    if (this.transitioning) return;

    this.dialogue?.update(delta);
    this.updateFloatPos(false);

    // 对话与全屏卡片进行时藏起摇杆与按键：它们会压在对话框/史料卡的文字上
    setControlsVisible(
      !this.dialogue?.isActive &&
        !this.pendingCardTap &&
        (this.mode === 'explore' || this.mode === 'combat' || this.mode === 'escort'),
    );

    if (this.dialogue?.isActive) {
      if (controls.interactPressed || controls.attackPressed) this.dialogue.advance();
      return;
    }

    // 开场情境卡 / 波次强化选卡开着时冻结世界：敌人不许在卡片后面动手。
    // `upgradeOpen` 已经包含在 `introOpen` 里，这里显式并上是为了让「强化卡也冻结」
    // 在代码里一眼可见——两个标志分别表示「卡片开着」和「卡片是强化卡」。
    if (this.introOpen || this.upgradeOpen) return;

    // 经营模式是纯界面，不需要世界逻辑
    if (this.mode === 'management') {
      this.player.update(delta, 0, 0, this.map);
      this.hudTimer += delta;
      if (this.hudTimer > 250) {
        this.hudTimer = 0;
        this.pushHud();
      }
      return;
    }

    // 移动
    this.player.update(delta, controls.moveX, controls.moveY, this.map);
    // 每帧兜底：军舰刚压出来的海面可能正好盖在脚下（喷漆和玩家位置是同帧竞争的），
    // 这里把人挪回最近的可站点，避免「站水里动不了」。
    if (this.seaTiles.size > 0) this.ejectPlayerFromSea();
    // 敌人也会被击退/被船推着掉进海里：落到水里就打不到了（甲方报的 bug）。
    // 这里把越界、落海、泡在水里的敌人都拉回最近的岸地，等于让他们「爬上岸继续打」。
    this.rescueStrayEnemies();

    // 攻击 / 闪避
    if (controls.attackPressed || controls.attackHeld) {
      this.onAdvanceInput();
      if (!this.dialogue?.isActive) this.playerAttack();
    }
    // 「技」键按用户要求去掉了（多一个常驻技能键只会让人以为坏了）；
    // 想保留重击就写在这一段里，别再往 InputSystem 加按钮。
    if (controls.dodgePressed) {
      const f = this.player.facingVector();
      const mv = Math.hypot(controls.moveX, controls.moveY) > 0.1;
      this.player.tryDodge(
        mv ? controls.moveX : f.x,
        mv ? controls.moveY : f.y,
        this.cfg.dodge.distance_px,
        this.cfg.dodge.cooldown_ms,
        this.cfg.dodge.invincible_ms,
        this.map,
      );
    }

    // 「炮」= 虎门重炮（老师要求的核心技能）：长冷却 + 小概率炸膛，伤害分档见 core/cannon.ts
    // 只有战斗幕才有这门炮（甲方要求），别的场景键盘 P 也不该凭空开炮
    if (this.cannonCd > 0) this.cannonCd = Math.max(0, this.cannonCd - delta);
    if (controls.cannonPressed && this.mode === 'combat' && !this.dialogue?.isActive) {
      this.onAdvanceInput();
      this.fireCannon();
    }

    // 交互提示
    const prevNear = this.nearObject;
    this.nearObject = this.findNearObject();
    if (prevNear !== this.nearObject) this.refreshObjectLabels();
    bus.emit(EV.INTERACT_AVAILABLE, this.nearObject !== null && !this.dialogue?.isActive);
    if (controls.interactPressed && this.mode === 'explore') {
      if (this.dialogue?.isActive) this.dialogue.advance();
      else this.handleInteract();
    }

    // 敌人
    for (const e of [...this.enemies]) {
      // 护送模式：敌人打最近的目标（玩家或护送的战士）
      const target =
        this.mode === 'escort'
          ? this.escortNearestTarget(e.x, e.y)
          : {
              x: this.player.x,
              y: this.player.y,
              alive: this.player.alive,
              isInvincible: this.player.isInvincible,
              ally: undefined as Ally | undefined,
            };
      e.update(
        delta,
        { x: target.x, y: target.y, alive: target.alive, isInvincible: target.isInvincible },
        this.map,
        this.cfg,
        {
          onPlayerHit: (damage) => {
            if (target.ally) {
              this.damageAlly(target.ally, damage);
              return;
            }
            const d = this.player.takeDamage(incoming(damage));
            if (d > 0) this.cameras.main.shake(70, 0.003);
          },
          onRangedAttack: (from, tx, ty) => this.spawnEnemyProjectile(from, tx, ty),
          // 敌人近战也要有刀光（甲方：「敌人没有攻击动作，没有刀光显示范围」）
          onMeleeSwing: (from, ang, reach) =>
            this.slashAt(from.x, from.y - 10, ang, reach, PALETTE.redDark, 76),
          onDeath: (en) => this.onEnemyDeath(en),
          onTelegraph: (en, r) => this.telegraphRing(en, r),
          // 军舰的「舷炮齐射」改成有落点预警的重炮（甲方 m12276）：
          // 直接飞过来的弹幕躲不掉，红圈预警才叫「提示落点让角色可以躲开」。
          // 其他 Boss 没有船体，仍用原来的扇形弹幕。
          onVolley: (en, count, spread) =>
            en === this.bossShip ? this.bossSalvo(en, Math.min(3, count), spread) : this.bossVolley(en, count, spread),
          onSummon: (en, id, count) => this.bossSummon(en, id, count),
          onCharge: (en, dx, dy) => this.bossCharge(en, dx, dy),
        },
        rng,
      );
    }

    this.updateProjectiles(delta);
    this.collectNearbyItems();

    // 战斗波次推进
    if (this.mode === 'combat' && !this.bossSpawned) {
      const alive = this.enemies.filter((e) => e.alive).length;
      if (!this.wavePending && alive === 0) {
        const waves = this.waveList();
        const next = this.waveIndex + 1;
        if (next < waves.length) {
          this.waveIndex = next;
          this.wavePending = true;
          // 每清一波喘口气：甲方反馈「撑不到军舰就没体验」，
          // 给一个可见的正反馈（回 18 血）比单纯砍敌人数更好懂。
          this.healBetweenWaves(18);
          emitToast(`第 ${next + 1} 波敌军来袭`, 1500);
          emitObjective(`第 ${next + 1} / ${waves.length} 波`);
          // 设计书 3.3.1：击退第一批登陆英兵后掉落一把白色的弓（仅剧情关卡，副本不给）
          if (next === 1 && !this.dungeon) this.dropBow();
          // 甲方要求「每波次强化系统」：清完一波先弹三选一（世界冻结），选完/跳过再放下一波。
          // v1.7 起弓与全部近战武器共用规则、各自独立累积，按**当前手持实例**判断：
          // 该实例已满级、或武器不参与强化（其它远程）时直接进原节奏，避免多一层延迟。
          // 满级每波实时算，换一把没满级的武器后下一波照样能弹卡。
          const cls = this.currentUpgradeClass();
          const canUpgrade = cls !== 'other' && !upgradesExhausted(this.currentUpgrades());
          const openUpgrade = !this.dungeon && next > 0 && this.pendingUpgrade && canUpgrade;
          if (openUpgrade) {
            this.showUpgradeCard(() => this.time.delayedCall(1200, () => this.spawnWave(next)));
          } else {
            this.time.delayedCall(1200, () => this.spawnWave(next));
          }
        } else {
          this.spawnBoss();
        }
      }
    }

    // Boss 阶段：全部敌人（含 Boss）清空即完成本节点。
    // 早期版本只在 !bossSpawned 时判定，导致 Boss 被打死后节点永远不结束（真 bug）。
    if (this.mode === 'combat' && this.bossSpawned && !this.nodeBusy) {
      const alive = this.enemies.filter((e) => e.alive).length;
      if (alive === 0) {
        this.clearDeadEnemies();
        this.onBossPhaseCleared();
      }
    }

    // 护送模式：战士跟随、按推进度放拦截、抵达终点即完成
    if (this.mode === 'escort') {
      this.updateAllies(delta);
      this.updateEscortProgress();
      // 门禁把「切换中 / 节点已换 / 战士已清空」挡在外面：旧版只判 x 与 nodeBusy，
      // 切到天京经营的 async 窗口里会二次结算，把经营幕整幕跳过（见 core/escort.ts）。
      if (
        canCompleteEscort({
          mode: this.mode,
          nodeMode: this.node?.params.mode as string | undefined,
          transitioning: this.transitioning,
          nodeBusy: this.nodeBusy,
          goalX: this.escortGoalX,
          playerX: this.player.x,
          allyCount: this.allies.length,
        })
      ) {
        const total = this.escortTotal || this.allies.length;
        const alive = this.allies.filter((a) => a.alive).length;
        emitToast(`突围成功：护送出 ${alive}/${total} 名战士`, 2400);
        emitObjective(`突围成功　${alive}/${total}`);
        this.completeNode();
      }
    }

    // 军舰不再往前压（甲方 m12276：「军舰前进不了就不搞前进了，一直停在岸边攻击」）。
    // 原来这里每 6.5 秒让它往左挪 76px 并把碾过的地变成海，压到最左就剧情杀；
    // 现在它原地不动，攻击全交给舰炮（`bossSalvo` 的落点预警）。
    void this.shipTimer;

    // 玩家死亡
    if (!this.player.alive && !this.nodeBusy) {
      this.nodeBusy = true;
      const defeatContinues = !this.dungeon && this.node?.params.defeat_continues === true;
      if (this.dungeon) {
        // 副本失败不扣东西，弹面板让玩家自己选重来还是回去
        this.time.delayedCall(700, () => this.showDungeonFail());
      } else if (defeatContinues) {
        // 演示版的「战败也继续」：虎门炮台这一战史实上就是输的，
        // 打光血之后走震撼弹窗 + 后续条约剧情，而不是把玩家弹回重打（老师的要求）。
        this.time.delayedCall(600, () => this.playDefeatSequence());
      } else {
        // 剧情关卡战败：弹面板让玩家自己点「再试一次」。
        // 原来是 900ms 后直接 startNode 自动重开，玩家既看不到失败提示，
        // 也来不及反应，只看到一个白影在原地站了起来。
        this.time.delayedCall(600, () => this.showStoryFail());
      }
    }

    // HUD 节流刷新
    this.hudTimer += delta;
    if (this.hudTimer > 120) {
      this.hudTimer = 0;
      this.pushHud();
    }
  }

  /** 波次之间的喘息：回一点血，并在头顶飘一个绿字，让玩家看得见 */
  private healBetweenWaves(amount: number): void {
    if (!this.player || !this.player.alive) return;
    const before = this.player.hp;
    const max = this.player.maxHp;
    if (before >= max) return;
    this.player.hp = Math.min(max, before + amount);
    const gain = this.player.hp - before;
    if (gain <= 0) return;
    const txt = this.add
      .text(this.player.x, this.player.y - 26, `+${gain}`, {
        fontFamily: FONT_UI,
        fontSize: '10px',
        color: '#8FD08A',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.fx);
    this.tweens.add({
      targets: txt,
      y: txt.y - 14,
      alpha: 0,
      duration: 900,
      ease: 'Quad.easeOut',
      onComplete: () => txt.destroy(),
    });
  }

  private dropBow(): void {
    const base = dataLoader.findItemBase('eq_wp_bow_white_01');
    if (!base) return;
    const item = makeItemInstance(base, this.cfg, rng);
    const x = this.player.x + 40;
    const y = this.player.y;
    // 剧情里掉的那把猎弓也走同一套标记（武器竖条 + 白色），不再是一个孤零零的方块
    const v = this.makeDropVisual(x, y, item);
    const obj = v.obj;
    this.floorItems.push({ obj, item, ...(v.glow ? { glow: v.glow } : {}) });
    emitToast('敌兵丢下一把猎弓', 1600);

    // 走近自动装备
    const check = this.time.addEvent({
      delay: 200,
      loop: true,
      callback: () => {
        if (!this.player) return;
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, obj.x, obj.y) < 22) {
          check.remove();
          const picked = this.floorItems.find((it) => it.obj === obj);
          if (picked) this.destroyFloorItem(picked);
          this.floorItems = this.floorItems.filter((it) => it.obj !== obj);
          const w = this.cfg.weapons.wp_bow as WeaponDef;
          if (!this.save.weapons.includes('wp_bow')) this.save.weapons.push('wp_bow');
          this.player.setWeapon(w, PALETTE.brown);
          emitToast('装备猎弓（远程）', 1500);
          persist();
        }
      },
    });
  }

  private pushHud(): void {
    if (!this.player) return;
    const w = this.player.weapon as WeaponDef;
    emitHud({
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      level: this.save.player.level,
      exp: this.save.player.exp,
      expNext: expToNext(this.save.player.level, this.cfg),
      weaponName: w?.name ?? '—',
      knowledgeCount: this.save.knowledge.length,
      cannonLeftMs: Math.max(0, this.cannonCd),
      dynasty: this.save.progress.dynasty ?? DYNASTY_MAX,
      defeated: this.defeated,
    });
  }
}

/* ==================== 小工具 ==================== */

const DIST_MELEE = 'melee' as const;

function qualityLabel(q: Quality): string {
  return q === 'purple' ? '紫' : q === 'blue' ? '蓝' : '白';
}