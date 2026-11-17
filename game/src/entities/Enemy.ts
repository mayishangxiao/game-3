/**
 * 敌人实体 —— 三态 AI 状态机（设计书 6.1.6）+ Boss 分阶段（6.5.2）。
 * 所有普通敌人共用同一套状态机，只靠 ai_params 差异化，不为每个敌人写新 AI。
 */

import Phaser from 'phaser';
import { CharacterRig } from '../gfx/CharacterRig';
import type { MapRenderer } from '../gfx/MapRenderer';
import { PALETTE, SHIP_ART_SETS, SHIP_TEX, TILE, unitArtOf } from '../core/constants';
import { presenceOf, meleeSwingHits, type PresenceDef } from '../core/combatPresence';
import { makePresenceAura, spawnDebris } from '../gfx/CombatFx';
import { computeDamage, type Rng } from '../core/balance';
import { advanceWithCollision, ENEMY_FOOT, isFootBlocked } from '../core/space';
import type { BalanceConfig, BossPhase, EnemyDef } from '../core/types';
import { FONT_UI } from '../gfx/TextStyle';

export type AiState = 'idle' | 'chase' | 'windup' | 'cooldown' | 'return' | 'stunned';

export interface EnemyCallbacks {
  onPlayerHit: (damage: number, from: Enemy) => void;
  onRangedAttack: (from: Enemy, tx: number, ty: number) => void;
  onDeath: (enemy: Enemy) => void;
  onTelegraph?: (enemy: Enemy, radius: number) => void;
  /** Boss 招式：舷炮齐射（count 发，扇形 spreadDeg 度） */
  onVolley?: (enemy: Enemy, count: number, spreadDeg: number) => void;
  /** Boss 招式：投放登陆艇 / 召唤援兵 */
  onSummon?: (enemy: Enemy, enemyId: string, count: number) => void;
  /** Boss 招式：撞角冲刺（方向为单位向量） */
  onCharge?: (enemy: Enemy, dirX: number, dirY: number) => void;
  /**
   * 近战挥砍的「看得见的动作」。
   *
   * 甲方反馈「我方和敌人没有攻击动作，没有刀光显示范围」——以前近战只是
   * 前摇闪一下、然后玩家掉血，屏幕上没有任何东西告诉玩家「他刚砍过你，砍到这么远」。
   * LevelScene 用这个回调画扇形刀光，扇形半径与角度**就是这一击的真实判定框**
   * （`combatPresence.attackReach / attackArcDeg`），看得见的就是打得着的。
   */
  onMeleeSwing?: (enemy: Enemy, angle: number, reach: number, arcDeg: number) => void;
}

/** Boss 招式执行状态 */
interface BossAction {
  kind: 'broadside' | 'landing_boat' | 'ram';
  /** 前摇剩余（ms） */
  windup: number;
  /** 是否已经打出效果 */
  fired: boolean;
}

const BOSS_TELEGRAPH = { broadside: 700, landing_boat: 480, ram: 640 } as const;
const BOSS_RECOVER = { broadside: 1900, landing_boat: 2100, ram: 1500 } as const;

/**
 * Boss 招式间隔的整体倍率（甲方「敌方射速翻倍」）。
 *
 * 普通敌兵靠数据里的 `attack_cooldown_ms` 调，但 Boss 走的是另一套循环：
 * 前摇（BOSS_TELEGRAPH，玩家躲红圈的时间，不能动）+ 恢复（BOSS_RECOVER）。
 * 只砍恢复这一头 → 开火频率翻倍，而预警时间一秒都不少，玩家仍然躲得掉。
 * 前摇跟着缩会让「看到红圈已经贴脸」，那不是加快节奏，是变相无视提示。
 */
const BOSS_RECOVER_SCALE = 0.5;

const ENEMY_BASE_SPEED = 44;
// 脚部占位盒统一放在 core/space.ts：场景侧校正出生点 / 击退落点 / 每帧救援时
// 必须用同一组四角，否则会出现「场景认为能站、移动认为被挡」的半嵌墙状态。

/**
 * 交战半径（px）：玩家反馈「不靠近敌人敌人就不动」——设计书里的 detect_radius 只有 110–200，
 * 在一屏 480 px 宽的地图上等于要走到半场才会被发现，站桩感很强。
 * 这里取一屏对角线（480×256 ≈ 545）以上的值：只要玩家还活着，屏幕里的敌人就主动压上来；
 * detect_radius 改为决定「追多远的耐心」（leash），不再决定要不要开打。
 */
const ENEMY_ENGAGE_RADIUS = 560;

/** 追击脱战距离：比警戒半径再放大一点，避免刚追两步就被拉回家 */
const ENEMY_LEASH_FACTOR = 1.6;

export class Enemy {
  readonly def: EnemyDef;
  readonly rig: CharacterRig;
  readonly scene: Phaser.Scene;

  maxHp: number;
  hp: number;
  atk: number;
  def_: number;

  state: AiState = 'idle';
  alive = true;

  /**
   * 光环增益倍率（默认 1）。郭富准将这类「指挥官」单位在场时，它周围的友军 atk 提高，
   * 由场景调用 applyAuras() 统一刷新；指挥官被打死后立刻回到 1（先打指挥官有回报）。
   */
  auraMult = 1;

  /** 血条：老师要求「敌人、精英、BOSS 全部显示血条」 */
  private hpBg: Phaser.GameObjects.Rectangle;
  private hpFill: Phaser.GameObjects.Rectangle;
  /** 护甲色块：精英 1 层、Boss 2 层。只看图形就能读出「这层甲还有多厚」 */
  private hpArmor: Phaser.GameObjects.Rectangle[] = [];
  private readonly barW: number;
  private readonly barH: number;
  private readonly barOffY: number;
  /** 这一档的「实力感」配置（顿帧/击退抗性/火花/音色档都在里面，见 core/combatPresence） */
  private readonly presence: PresenceDef;
  /** 血条受击抖动剩余比例 1→0：弱者抖得厉害，强者几乎不动 */
  private barShake = 0;
  /** 脚下气场（只有精英与 Boss 有）：描边光环 + 极淡内芯的 Container */
  private auraGlow: Phaser.GameObjects.Container | null = null;

  private stateTimer = 0;
  /**
   * 蓄力开始那一刻锁定的挥砍方向（rad）。
   *
   * 以前是「时间到必中」：玩家看得见刀光却躲不开，绕到背后照样掉血。
   * 现在方向在蓄力时就定死，出手时按 `attackReach / attackArcDeg` 做真实判定。
   */
  private swingAngle = 0;
  /** 这一击是不是「挨打之后的还手」：还手够得更远、扇面更宽（一步压上来） */
  private countering = false;
  /** 还手冷却（精英与 Boss 共用同一字段）：冷却内连续贪刀不会每一下都被反 */
  private counterCd = 0;
  /** 还手的红圈提示还没播：提示要场景画，放到下一次 update 里发 */
  private counterTellPending = false;
  /** 上一帧的玩家位置：挨打发生在 takeDamage（那里没有回调包），还手判定要用它 */
  private lastPlayer: { x: number; y: number; alive: boolean } | null = null;
  /** Boss 过场停手标志：`haltActions()` 之后不许被「挨打提前」重新点着 */
  private actionsHalted = false;
  /** 连续「两轴都走不动」的累计时长（ms）：超时就翻面，换一侧沿墙绕 */
  private stuckMs = 0;
  /** 沿墙绕行优先走哪一侧，记住上次成功的一侧以免左右来回抽 */
  private slideSign = 1;
  private homeX: number;
  private homeY: number;
  private phaseIndex = 0;
  private weakpointMs = 0;
  readonly isBoss: boolean;

  /**
   * Boss 阶段切换回调（v2.6 海战「逐步推进紧张局势」用）。
   *
   * 放在实体上、由场景按 `ship_duel` 注册：只有带双舰剧本的那一关会播报，
   * 其它 Boss 的阶段切换还是原来那一套（顿帧 + 弱点期），一个像素都不变。
   */
  onPhaseChange: ((e: Enemy, index: number) => void) | null = null;

  /** Boss 专用：招式冷却与当前招式 */
  private bossTimer = 2000;
  private bossAction: BossAction | null = null;
  private bossCycle = 0;
  /**
   * 半血「全屏打击」是否已经放过（甲方：剧情杀，只放一次）。
   * 放在实体上而不是场景里：场景切节点会重建实体，这个标志天然跟着「这一场」走。
   */
  private finalStrikeDone = false;

  constructor(scene: Phaser.Scene, x: number, y: number, def: EnemyDef, stats: { hp: number; atk: number; def: number }) {
    this.scene = scene;
    this.def = def;
    this.maxHp = stats.hp;
    this.hp = stats.hp;
    this.atk = stats.atk;
    this.def_ = stats.def;
    this.homeX = x;
    this.homeY = y;
    this.isBoss = def.tier === 'boss';

    const size = def.size ?? { w: 24, h: 32 };
    this.rig = new CharacterRig(scene, x, y, {
      bodyColor: def.color ? Phaser.Display.Color.HexStringToColor(def.color).color : PALETTE.indigo,
      unit: unitArtOf(def.id),
      skinColor: PALETTE.cream,
      legColor: PALETTE.ink,
      weaponColor: def.tier === 'ranged' ? PALETTE.brownDeep : PALETTE.greyPlum,
      scale: Math.max(size.w / 24, size.h / 32),
      body: def.body ?? 'human',
      // 舰船按数据里的 ship_art 选 6 帧贴图：吉野号用日舰专属帧，英舰用老帧。
      // 未登记 / 拼错一律回落 SHIP_TEX；贴图没加载成功时 CharacterRig 再兜一层矩形占位形体。
      art: def.body === 'ship'
        ? (SHIP_ART_SETS[def.ship_art ?? 'steamfrigate'] ?? SHIP_TEX)
        : undefined,
    });
    if (def.tier === 'elite' || this.isBoss) {
      this.rig.setScale(this.rig.scaleX * 1.15, this.rig.scaleY * 1.15);
    }

    // ---- 血条（画在头顶，随实体移动）----
    // 厚度按档位走：杂鱼 3px 单薄一条，Boss 5px 厚重一杠（`core/combatPresence.ts`）。
    this.presence = presenceOf(def.tier);
    this.barH = this.presence.barH;
    this.barW = this.isBoss ? 46 : def.tier === 'elite' ? 28 : 20;
    this.barOffY = this.isBoss ? -38 : def.tier === 'elite' ? -30 : -22;
    if (def.body === 'ship') {
      // 96×48 的贴图把吃水线放在脚点、船体顶部在脚点上 40px，
      // 血条抬到桅顶之上一点（-52），既不压船体也不飘太远
      this.barW = 72;
      this.barOffY = -52;
    }
    const barColor =
      def.tier === 'boss' ? PALETTE.redBright : def.tier === 'elite' ? PALETTE.star : PALETTE.red;
    this.hpBg = scene.add
      .rectangle(x, y + this.barOffY, this.barW + 2, this.barH + 2, PALETTE.ink, 0.85)
      .setDepth(97);
    this.hpFill = scene.add
      .rectangle(x - this.barW / 2, y + this.barOffY, this.barW, this.barH, barColor)
      .setOrigin(0, 0.5)
      .setDepth(98);
    // 护甲层：贴在血条上沿的 2px 奶白细条，有几层就是几层甲。精英 1 层、Boss 2 层，
    // 杂鱼没有——不用写「重甲」两个字，玩家自己看得出这一条比别人的厚。
    // 颜色必须用 paper 而不是浅红：浅红压在红血条上等于没有（实拍确认过）。
    for (let i = 0; i < this.presence.armorLayers; i++) {
      this.hpArmor.push(
        scene.add
          .rectangle(
            x - this.barW / 2,
            y + this.barOffY - this.barH / 2 - 2 - i * 3,
            this.barW,
            2,
            PALETTE.paper,
          )
          .setOrigin(0, 0.5)
          .setDepth(98),
      );
    }
    // 强者脚下的一层微光（精英 16px / Boss 30px）。
    // **军舰不画**：96×48 的船体把 30px 的圆环几乎全遮住，只剩一条读不出来的细线
    // （v2.7 实拍三次确认）；军舰的重量感交给 5px 血条 + 2 层护甲 + 90ms 顿帧 + 煤烟。
    this.auraGlow = def.body === 'ship' ? null : makePresenceAura(scene, x, y, this.presence);

    // ---- 指挥官光环：地上一圈金色虚线感的光环，说明「他在给周围友军加成」----
    const aura = def.ai_params?.aura;
    if (aura) {
      const ring = scene.add
        .circle(x, y + 8, aura.radius, PALETTE.star, 0.05)
        .setStrokeStyle(1, PALETTE.star, 0.28)
        .setDepth(11);
      scene.tweens.add({
        targets: ring,
        alpha: { from: 0.55, to: 1 },
        duration: 900,
        yoyo: true,
        repeat: -1,
      });
      this.auraRing = ring;
      // 光环半径 220px 铺满半个战场，光看圈读不出含义，配一行小字说明。
      // 位置压在血条上方 14px —— 血条在 -30（精英），这样小字在 -44，不会盖住帽子。
      this.auraLabel = scene.add
        .text(x, y - 44, `指挥 · 攻 +${aura.atk_pct}%`, {
          fontFamily: FONT_UI,
          fontSize: '8px',
          color: '#F0C419',
        })
        .setOrigin(0.5)
        .setDepth(99);
    }
  }

  private auraRing: Phaser.GameObjects.Arc | null = null;
  private auraLabel: Phaser.GameObjects.Text | null = null;

  /** 血条跟随实体（含死亡隐藏） */
  private syncBar(): void {
    const by = this.y + this.barOffY;
    // 受击抖动：幅度 = 1 − 击退抗性。杂鱼被打得血条乱晃，Boss 那条纹丝不动——
    // 这是「打不动」最便宜的视觉信号，不用额外贴图。
    const amp = (1 - this.presence.knockResist) * 2.6;
    const sx = this.barShake > 0 ? Math.sin(this.barShake * 26) * amp : 0;
    const fillW = Math.max(0, Math.round(this.barW * this.hpRatio));
    this.hpBg.setPosition(this.x + sx, by).setVisible(this.alive);
    this.auraLabel?.setPosition(this.x, by - 14).setVisible(this.alive);
    this.hpFill.setPosition(this.x - this.barW / 2 + sx, by).setVisible(this.alive);
    this.hpFill.width = fillW;
    // 护甲层与血量同比例缩短：甲还剩多少，眼神就能读出来
    for (let i = 0; i < this.hpArmor.length; i++) {
      this.hpArmor[i]
        .setPosition(this.x - this.barW / 2 + sx, by - this.barH / 2 - 2 - i * 3)
        .setVisible(this.alive);
      this.hpArmor[i].width = fillW;
    }
    if (this.auraRing) this.auraRing.setPosition(this.x, this.y + 8).setVisible(this.alive);
    this.auraGlow?.setPosition(this.x, this.y + 8).setVisible(this.alive);
    // 舰船残血换破损帧（内部去重，够每帧调）
    if (this.def.body === 'ship') this.rig.setDamaged(this.hpRatio <= 0.35);
  }

  get x(): number {
    return this.rig.x;
  }
  get y(): number {
    return this.rig.y;
  }

  get hpRatio(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  /** E2E / 排查用：连续被墙挡住多久（正常追击应为 0） */
  get stuckTime(): number {
    return this.stuckMs;
  }

  get isWeakpoint(): boolean {
    return this.weakpointMs > 0;
  }

  /** 这一击是不是「挨打之后的还手」：场景用它在刀光上换个更烫的颜色 */
  get isCountering(): boolean {
    return this.countering;
  }

  /** Boss 当前阶段对应招式（普通敌人返回 null） */
  currentPhase(cfg: BalanceConfig): BossPhase | null {
    void cfg;
    const phases = this.def.boss_phases;
    if (!phases || phases.length === 0) return null;
    const ratio = this.hpRatio * 100;
    const idx = phases.findIndex((p) => ratio <= p.hp_pct[0] && ratio > p.hp_pct[1]);
    return phases[idx >= 0 ? idx : phases.length - 1];
  }

  private updatePhase(): void {
    const phases = this.def.boss_phases;
    if (!phases) return;
    const ratio = this.hpRatio * 100;
    const idx = phases.findIndex((p) => ratio <= p.hp_pct[0] && ratio > p.hp_pct[1]);
    const next = idx >= 0 ? idx : phases.length - 1;
    if (next !== this.phaseIndex) {
      this.phaseIndex = next;
      if (phases[next].weakpoint) this.weakpointMs = 8000;
      // 阶段切换顿帧
      this.scene.cameras.main.shake(120, 0.004);
      this.onPhaseChange?.(this, next);
    }
  }

  /**
   * 被玩家打中时的还手。
   *
   * 为什么要这条：以前敌人挨打毫无反应，玩家最优解就是贴着精英站桩连砍，
   * 「实力差距」只体现在它血多、打你疼，不体现在它**会还手**。
   * 现在：
   *   - 精英挨打立刻起一次 280ms 的短前摇挥砍（够得比平时远 4px、扇面宽 12°），
   *     2.6s 只还一次 —— 贪刀有代价，但不至于每一下都被反；
   *   - Boss 不缩预警（玩家仍躲得掉），只是把「下一招还要等多久」清零，挨打=催它出手。
   * 只对近身的攻击还手：隔着半个屏幕放箭也触发反击，玩家会觉得莫名其妙。
   */
  private provokeCounter(): void {
    const p = this.presence;
    if (p.counterCdMs <= 0 || this.counterCd > 0) return;
    if (this.isBoss) {
      if (this.actionsHalted || this.bossAction) return;
      this.bossTimer = 0;
      this.counterCd = p.counterCdMs;
      return;
    }
    if (p.counterWindupMs <= 0) return;
    // 已经在蓄力/被打晕时不打断自己那一刀，免得两套计时互相覆盖
    if (this.state === 'stunned' || this.state === 'windup') return;
    const t = this.lastPlayer;
    if (!t?.alive) return;
    if (Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y) > p.attackReach + 14) return;
    this.state = 'windup';
    this.stateTimer = p.counterWindupMs;
    this.countering = true;
    this.swingAngle = Math.atan2(t.y - this.y, t.x - this.x);
    this.counterCd = p.counterCdMs;
    this.counterTellPending = true;
  }

  /**
   * 半血必杀的挂钩：实体发现血量刚跌破一半时回调一次，由场景演出（全屏打击）。
   * 不放在 `EnemyCallbacks` 里，是因为那个回调包只在 `update()` 的这一次调用里有效，
   * 而溺水式地传一个「打完这枪才触发」的演出没地方存。
   */
  onFinalStrike: ((e: Enemy) => void) | null = null;

  takeDamage(damage: number, crit: boolean, cfg: BalanceConfig): boolean {
    if (!this.alive) return false;
    const prevHp = this.hp;
    this.hp = Math.max(0, this.hp - damage);
    // 闪白时长按档位：杂鱼 40ms 一闪就没，Boss 110ms 能看出「这一下他扛住了」
    this.rig.hitFlash(crit ? Math.max(110, this.presence.flashMs + 30) : this.presence.flashMs);
    // 血条抖动只在「打得动」的目标上出现（Boss 的 knockResist = 1，这条恒为 0）
    this.barShake = this.presence.knockResist < 1 ? 1 : 0;
    this.updatePhase();
    // 挨打还手：精英立刻反一记短前摇的挥砍，Boss 把下一招提前（预警时长不减）。
    // 放在掉血之后、判死之前——打死了就不该再有还手。
    if (this.hp > 0) this.provokeCounter();
    if (this.checkFinalStrike(prevHp)) this.onFinalStrike?.(this);

    if (this.def.tier === 'elite' && this.hp <= 0) {
      this.hp = 0;
    }

    // 数字飘字
    this.spawnDamageText(damage, crit);

    if (this.hp <= 0) {
      this.alive = false;
      // 强者死得慢：杂鱼 220ms 一闪而过，Boss 要 900ms 才躺完
      this.rig.playDeath(undefined, this.presence.deathMs);
      // 倒下的碎片（军舰不撒：海上飘木块很怪，它有自己的破损帧与沉没演出）
      if (this.presence.debris > 0 && this.def.body !== 'ship') {
        spawnDebris(
          this.scene,
          this.x,
          this.y - 8,
          this.presence.debris,
          this.presence.weight === 'heavy' ? PALETTE.star : PALETTE.greyPlum,
        );
      }
      this.syncBar();
      void cfg;
      return true;
    }
    this.syncBar();
    return false;
  }

  private spawnDamageText(damage: number, crit: boolean): void {
    const t = this.scene.add
      .text(this.x, this.y - 22, String(damage), {
        fontFamily: FONT_UI,
        fontSize: crit ? '14px' : '10px',
        color: crit ? '#E85C4A' : '#F2EDE4',
        fontStyle: crit ? 'bold' : 'normal',
      })
      .setOrigin(0.5)
      .setDepth(96);
    this.scene.tweens.add({
      targets: t,
      y: t.y - 14,
      alpha: 0,
      duration: 520,
      onComplete: () => t.destroy(),
    });
  }

  stun(ms: number): void {
    this.state = 'stunned';
    this.stateTimer = ms;
  }

  /** 进入弱点期：此时受到的伤害按武器倍率 ×2.5 计（设计书 6.1.3） */
  setWeakpoint(ms: number): void {
    this.weakpointMs = Math.max(this.weakpointMs, ms);
  }

  /**
   * Boss 专用行为：停在原地，按当前阶段的 attacks 列表轮换特殊招式，
   * 不与玩家近身缠斗（炮舰在炮台外的海面上）。
   * 普通敌人仍走下面的三态状态机。
   */
  private updateBoss(
    dtMs: number,
    player: { x: number; y: number; alive: boolean },
    cfg: BalanceConfig,
    cb: EnemyCallbacks,
  ): void {
    if (player.alive) {
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      this.rig.setFacing(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down');
    }

    if (this.bossAction) {
      const act = this.bossAction;
      act.windup -= dtMs;
      // 前摇闪烁提示
      this.rig.setAlpha(Math.floor(Math.max(0, act.windup) / 95) % 2 === 0 ? 0.65 : 1);
      if (act.windup <= 0 && !act.fired) {
        act.fired = true;
        this.rig.setAlpha(1);
        this.fireBossAction(act, player, cb);
      }
      if (act.windup <= 0 && act.fired && act.kind !== 'ram') {
        // ram 由场景的补间结束回调负责收尾
        this.bossAction = null;
      }
      this.rig.tick(dtMs, false);
      this.rig.setDepth(20 + this.rig.y * 0.01);
      // 军舰会前压，血条与光环必须每帧跟着走（只在受伤时同步会让它们留在出生点）
      this.syncBar();
      return;
    }

    this.bossTimer -= dtMs;
    if (this.bossTimer <= 0 && player.alive) {
      const attacks = this.currentPhase(cfg)?.attacks ?? ['broadside'];
      const kind = attacks[this.bossCycle % attacks.length] as BossAction['kind'];
      this.bossCycle += 1;
      this.bossAction = { kind, windup: BOSS_TELEGRAPH[kind] ?? 600, fired: false };
      this.bossTimer = (BOSS_RECOVER[kind] ?? 1800) * BOSS_RECOVER_SCALE;
      cb.onTelegraph?.(this, 0);
    }
    this.rig.tick(dtMs, false);
    this.rig.setDepth(20 + this.rig.y * 0.01);
    this.syncBar();
  }

  private fireBossAction(
    act: BossAction,
    player: { x: number; y: number },
    cb: EnemyCallbacks,
  ): void {
    this.rig.playAttack();
    switch (act.kind) {
      case 'broadside':
        cb.onVolley?.(this, 5, 26);
        break;
      case 'landing_boat': {
        const adds = this.currentPhase({} as BalanceConfig)?.adds;
        if (adds) cb.onSummon?.(this, adds, 2);
        else cb.onVolley?.(this, 3, 20);
        break;
      }
      case 'ram': {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const len = Math.hypot(dx, dy) || 1;
        cb.onCharge?.(this, dx / len, dy / len);
        break;
      }
    }
  }

  /**
   * 半血剧本杀：这支 Boss 的血量刚跌破一半时返回 true，并且**只返回一次**。
   *
   * 为什么由实体自己判：Boss 有几段血、掉血走的是 `takeDamage`，场景那边每次都要比一遍血量；
   * 这里记住「已经报过」就不会因为一帧里挨了两下而重复触发。
   * 只有 `tier === 'boss'` 且带 `final_strike` 的敌人才会报——是否放全屏打击是内容决定的事，
   * 天京那两位湘军统领就只换招不放必杀。
   */
  private checkFinalStrike(prevHp: number): boolean {
    if (this.def.tier !== 'boss' || !this.def.final_strike) return false;
    if (this.finalStrikeDone) return false;
    const half = this.maxHp / 2;
    if (prevHp > half && this.hp <= half) {
      this.finalStrikeDone = true;
      return true;
    }
    return false;
  }

  /** 撞角冲刺结束后由场景调用：进入弱点期 */
  finishCharge(): void {
    this.bossAction = null;
    this.setWeakpoint(8000);
    this.syncBar();
  }

  /**
   * 让 Boss 停手（军舰突破防线后的过场用）：
   * 只清掉进行中的招式并把计时器推到很远，不动血量与显示。
   */
  haltActions(): void {
    this.bossAction = null;
    this.bossTimer = 1e9;
    // 光把计时器推远不够：挨打会把它清零（见 provokeCounter），过场里又会开炮
    this.actionsHalted = true;
    this.rig.setAlpha(1);
    this.syncBar();
  }

  /** 每帧更新；返回 true 表示本帧对玩家造成了伤害 */
  update(
    dtMs: number,
    player: { x: number; y: number; alive: boolean; isInvincible: boolean },
    map: MapRenderer,
    cfg: BalanceConfig,
    cb: EnemyCallbacks,
    rng: Rng,
  ): void {
    if (!this.alive) {
      this.rig.tick(dtMs, false);
      return;
    }
    this.lastPlayer = player;
    if (this.counterCd > 0) this.counterCd = Math.max(0, this.counterCd - dtMs);
    if (this.weakpointMs > 0) this.weakpointMs -= dtMs;
    // 血条受击抖动随时间衰减（220ms 抖完）。Boss 的 barShake 恒为 0，不走这条。
    if (this.barShake > 0) this.barShake = Math.max(0, this.barShake - dtMs / 220);

    // Boss 走独立的招式循环，不用普通敌人的近身状态机
    if (this.isBoss) {
      this.updateBoss(dtMs, player, cfg, cb);
      return;
    }

    // 还手的红圈提示：takeDamage 里没有回调包，攒到这一帧由场景画
    if (this.counterTellPending) {
      this.counterTellPending = false;
      cb.onTelegraph?.(this, this.presence.attackReach + 4);
    }

    const p = this.def.ai_params;
    // 交战半径 = max(数据的警戒半径, 一屏对角线)：屏幕里出现活人就扑上来，不再站桩
    const R = Math.max(p.detect_radius, ENEMY_ENGAGE_RADIUS);
    // 脱战距离：以「离家多远」为准，别追到地图另一头。数据里的警戒半径越大，追得越执着
    const leash = Math.max(320, p.detect_radius * ENEMY_LEASH_FACTOR);
    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    const homeDist = Phaser.Math.Distance.Between(this.x, this.y, this.homeX, this.homeY);

    switch (this.state) {
      case 'idle': {
        if (player.alive && dist <= R) {
          this.state = 'chase';
        }
        break;
      }
      case 'chase': {
        if (!player.alive || homeDist > leash) {
          this.state = 'return';
          break;
        }
        if (dist <= p.attack_range) {
          this.state = 'windup';
          this.stateTimer = p.attack_windup_ms;
          this.countering = false;
          // 蓄力开始就把方向锁死：后撤、绕背能躲开，而不是「时间到必中」
          this.swingAngle = Math.atan2(player.y - this.y, player.x - this.x);
          cb.onTelegraph?.(this, p.attack_range);
          break;
        }
        this.stepToward(player.x, player.y, dtMs, map);
        break;
      }
      case 'windup': {
        this.stateTimer -= dtMs;
        if (this.stateTimer <= 0) {
          this.performAttack(player, cfg, cb, rng);
          this.state = 'cooldown';
          this.stateTimer = p.attack_cooldown_ms;
        }
        break;
      }
      case 'cooldown': {
        this.stateTimer -= dtMs;
        if (this.stateTimer <= 0) this.state = 'chase';
        break;
      }
      case 'stunned': {
        this.stateTimer -= dtMs;
        if (this.stateTimer <= 0) this.state = 'chase';
        break;
      }
      case 'return': {
        if (player.alive && dist <= R) {
          this.state = 'chase';
          break;
        }
        if (homeDist < 4) {
          this.state = 'idle';
          break;
        }
        this.stepToward(this.homeX, this.homeY, dtMs, map);
        break;
      }
    }

    this.rig.tick(dtMs, this.state === 'chase' || this.state === 'return');
    this.rig.setDepth(20 + this.rig.y * 0.01);
    this.syncBar();

    // 攻击前摇提示：红色闪烁
    if (this.state === 'windup') {
      this.rig.setAlpha(Math.floor(this.stateTimer / 90) % 2 === 0 ? 0.6 : 1);
    } else if (!this.isWeakpoint) {
      this.rig.setAlpha(1);
    }
  }

  private performAttack(
    player: { x: number; y: number },
    cfg: BalanceConfig,
    cb: EnemyCallbacks,
    rng: Rng,
  ): void {
    this.rig.playAttack();
    if (this.def.tier === 'ranged') {
      cb.onRangedAttack(this, player.x, player.y);
      return;
    }
    // 判定框与刀光同源：下面这几个数决定「够得多远 / 扫多宽」，场景拿同一组画扇形。
    // 还手那一下够得更远、扇面更宽——玩家的体感是「它反手压上来一步」。
    const reach = this.presence.attackReach + (this.countering ? 4 : 0);
    const arcDeg = this.presence.attackArcDeg + (this.countering ? 12 : 0);
    const ang = this.swingAngle;
    cb.onMeleeSwing?.(this, ang, reach, arcDeg);
    this.countering = false;
    // 真实判定：蓄力期间走出扇形的就是空挥（刀光照样划过，但不掉血）
    if (!meleeSwingHits(this.x, this.y, ang, player.x, player.y, reach, arcDeg)) return;
    const res = computeDamage(
      {
        atk: this.atk * this.auraMult,
        // 敌人出手不吃 `player_damage_mult`（那一条只折玩家这一侧）。
        // 但 `computeDamage` 里 `atk × weaponMult` 是乘在一起的，所以这里显式写 1。
        weaponMult: 1,
        targetDef: 0, // 玩家防御在 Player.takeDamage 内统一扣除
        attackerLevel: 1,
        targetLevel: 1,
        critRate: 0,
        critDmg: 1,
      },
      cfg,
      rng,
    );
    cb.onPlayerHit(res.damage, this);
  }

  private stepToward(tx: number, ty: number, dtMs: number, map: MapRenderer): void {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const step = (ENEMY_BASE_SPEED * this.def.spd * dtMs) / 1000;

    if (Math.abs(dx) > Math.abs(dy)) this.rig.setFacing(dx < 0 ? 'left' : 'right');
    else this.rig.setFacing(dy < 0 ? 'up' : 'down');

    // 分轴滑动 + 贴墙绕行抽在 core/space.ts 里，node 环境可直接回归
    // 「所有地图的出生点都不会把小兵卡死」，不用 import Phaser 实体。
    const r = advanceWithCollision(
      this.x,
      this.y,
      tx,
      ty,
      step,
      dtMs,
      (cx, cy) => this.footBlocked(cx, cy, map),
      { stuckMs: this.stuckMs, slideSign: this.slideSign },
    );
    this.rig.x = r.x;
    this.rig.y = r.y;
    this.stuckMs = r.state.stuckMs;
    this.slideSign = r.state.slideSign;
  }

  private footBlocked(cx: number, cy: number, map: MapRenderer): boolean {
    return isFootBlocked(cx, cy, (px, py) => map.isSolidAtWorld(px, py));
  }

  /** 直接把身体挪到某点（脱困、登岸用）。血条等部件会在下一帧 `syncBar()` 跟上 */
  teleportTo(x: number, y: number): void {
    this.rig.setPosition(x, y);
  }

  /** 脚下的世界坐标（血条、脱困判定都以「脚」为基准） */
  get footPoint(): { x: number; y: number } {
    return { x: this.x, y: this.y + ENEMY_FOOT.offsetY };
  }

  destroy(): void {
    this.hpBg.destroy();
    this.hpFill.destroy();
    for (const a of this.hpArmor) a.destroy();
    this.hpArmor.length = 0;
    this.auraRing?.destroy();
    this.auraGlow?.destroy();
    this.rig.destroy();
  }

  static get tileHint(): number {
    return TILE;
  }
}