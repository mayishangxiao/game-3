/**
 * 敌人实体 —— 三态 AI 状态机（设计书 6.1.6）+ Boss 分阶段（6.5.2）。
 * 所有普通敌人共用同一套状态机，只靠 ai_params 差异化，不为每个敌人写新 AI。
 */

import Phaser from 'phaser';
import { CharacterRig } from '../gfx/CharacterRig';
import type { MapRenderer } from '../gfx/MapRenderer';
import { PALETTE, SHIP_TEX, TILE, unitArtOf } from '../core/constants';
import { computeDamage, type Rng } from '../core/balance';
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
   * LevelScene 用这个回调画扇形刀光，扇形半径就是这一击的真实攻击距离。
   */
  onMeleeSwing?: (enemy: Enemy, angle: number, reach: number) => void;
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
const ENEMY_FOOT_W = 12;
const ENEMY_FOOT_H = 8;
const ENEMY_FOOT_Y = 10;
/** 近战敌人的刀光长度（世界像素）：比身体略长，一眼看出「他够得着这么远」 */
const ENEMY_MELEE_REACH = 26;

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
  private readonly barW: number;
  private readonly barOffY: number;

  private stateTimer = 0;
  private homeX: number;
  private homeY: number;
  private phaseIndex = 0;
  private weakpointMs = 0;
  readonly isBoss: boolean;

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
      // 舰船有正式美术帧（96×48 ×6）；没加载成功时 CharacterRig 自己退回矩形占位形体
      art: def.body === 'ship' ? SHIP_TEX : undefined,
    });
    if (def.tier === 'elite' || this.isBoss) {
      this.rig.setScale(this.rig.scaleX * 1.15, this.rig.scaleY * 1.15);
    }

    // ---- 血条（画在头顶，随实体移动）----
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
      .rectangle(x, y + this.barOffY, this.barW + 2, 5, PALETTE.ink, 0.85)
      .setDepth(97);
    this.hpFill = scene.add
      .rectangle(x - this.barW / 2, y + this.barOffY, this.barW, 3, barColor)
      .setOrigin(0, 0.5)
      .setDepth(98);

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
    this.hpBg.setPosition(this.x, by).setVisible(this.alive);
    this.auraLabel?.setPosition(this.x, by - 14).setVisible(this.alive);
    this.hpFill
      .setPosition(this.x - this.barW / 2, by)
      .setVisible(this.alive);
    this.hpFill.width = Math.max(0, Math.round(this.barW * this.hpRatio));
    if (this.auraRing) this.auraRing.setPosition(this.x, this.y + 8).setVisible(this.alive);
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

  get isWeakpoint(): boolean {
    return this.weakpointMs > 0;
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
    }
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
    this.rig.hitFlash(crit ? 110 : 60);
    this.updatePhase();
    if (this.checkFinalStrike(prevHp)) this.onFinalStrike?.(this);

    if (this.def.tier === 'elite' && this.hp <= 0) {
      this.hp = 0;
    }

    // 数字飘字
    this.spawnDamageText(damage, crit);

    if (this.hp <= 0) {
      this.alive = false;
      this.rig.playDeath();
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
    if (this.weakpointMs > 0) this.weakpointMs -= dtMs;

    // Boss 走独立的招式循环，不用普通敌人的近身状态机
    if (this.isBoss) {
      this.updateBoss(dtMs, player, cfg, cb);
      return;
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
    // 先给出刀光：扇形半径用这一击的真实距离（射程），玩家看得见范围
    const ang = Math.atan2(player.y - this.y, player.x - this.x);
    cb.onMeleeSwing?.(this, ang, ENEMY_MELEE_REACH);
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
    const speed = ENEMY_BASE_SPEED * this.def.spd;
    const dx = tx - this.x;
    const dy = ty - this.y;
    const len = Math.hypot(dx, dy) || 1;
    const step = (speed * dtMs) / 1000;
    const nx = (dx / len) * step;
    const ny = (dy / len) * step;

    if (Math.abs(dx) > Math.abs(dy)) this.rig.setFacing(dx < 0 ? 'left' : 'right');
    else this.rig.setFacing(dy < 0 ? 'up' : 'down');

    if (!this.footBlocked(this.x + nx, this.y, map)) this.rig.x += nx;
    if (!this.footBlocked(this.x, this.y + ny, map)) this.rig.y += ny;
  }

  private footBlocked(cx: number, cy: number, map: MapRenderer): boolean {
    const left = cx - ENEMY_FOOT_W / 2;
    const right = cx + ENEMY_FOOT_W / 2;
    const top = cy + ENEMY_FOOT_Y - ENEMY_FOOT_H / 2;
    const bottom = cy + ENEMY_FOOT_Y + ENEMY_FOOT_H / 2;
    const pts: [number, number][] = [
      [left, top],
      [right, top],
      [left, bottom],
      [right, bottom],
    ];
    return pts.some(([px, py]) => map.isSolidAtWorld(px, py));
  }

  /** 直接把身体挪到某点（脱困、登岸用）。血条等部件会在下一帧 `syncBar()` 跟上 */
  teleportTo(x: number, y: number): void {
    this.rig.setPosition(x, y);
  }

  /** 脚下的世界坐标（血条、脱困判定都以「脚」为基准） */
  get footPoint(): { x: number; y: number } {
    return { x: this.x, y: this.y + ENEMY_FOOT_Y };
  }

  destroy(): void {
    this.hpBg.destroy();
    this.hpFill.destroy();
    this.auraRing?.destroy();
    this.rig.destroy();
  }

  static get tileHint(): number {
    return TILE;
  }
}