/**
 * 玩家实体 —— 移动、闪避、武器冷却、生命与受击。
 * 数值全部来自 core/balance.ts（设计书 6.1.3 / 6.2 / 6.4），此处只做状态与位移。
 */

import Phaser from 'phaser';
import { CharacterRig } from '../gfx/CharacterRig';
import type { MapRenderer } from '../gfx/MapRenderer';
import { PALETTE, TILE } from '../core/constants';
import { weaponIntervalMs } from '../core/balance';
import type { WeaponDef } from '../core/types';

export interface PlayerConfig {
  bodyColor: number;
  weaponColor: number | null;
  scale?: number;
}

/** 碰撞盒：脚下的 14×10 区域（设计书上以"脚"判定，头顶可穿过门框） */
const FOOT_W = 14;
const FOOT_H = 10;
const FOOT_Y = 11;

/** 「技」按钮的重击冷却与倍率：比普攻慢一倍，单次伤害接近两倍 */
export const SKILL_COOLDOWN_MS = 1500;
export const SKILL_DAMAGE_MULT = 1.9;

export class Player {
  readonly rig: CharacterRig;
  readonly scene: Phaser.Scene;

  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  crit: number;
  critDmg: number;
  speed: number;

  weapon: WeaponDef;
  private attackCd = 0;
  private skillCd = 0;
  private dodgeCd = 0;
  private invincibleMs = 0;
  private attackAnimMs = 0;
  moving = false;
  alive = true;
  /** 由关卡注入的额外阻挡判定（海面等），返回 true 表示该点不可站立 */
  private blocker: ((x: number, y: number) => boolean) | null = null;

  setBlocker(fn: ((x: number, y: number) => boolean) | null): void {
    this.blocker = fn;
  }

  /**
   * 攻速倍率钩子（波次强化的「火线」用）。
   * 关卡在 `create()` 里注入，返回 1 表示不加成。
   * 做成钩子而不是给 `WeaponDef` 加字段：武器定义来自 `config.json`，
   * 往里塞运行时状态会让「数据驱动」这条线变脏。
   */
  private hasteHook: (() => number) | null = null;

  setHasteHook(fn: (() => number) | null): void {
    this.hasteHook = fn;
  }

  /** 实际冷却间隔：基础间隔 ÷ 攻速倍率 */
  private attackIntervalMs(): number {
    const h = this.hasteHook ? this.hasteHook() : 1;
    return weaponIntervalMs(this.weapon.attacks_per_sec) / (h > 0 ? h : 1);
  }

  constructor(scene: Phaser.Scene, x: number, y: number, cfg: PlayerConfig, weapon: WeaponDef) {
    this.scene = scene;
    this.weapon = weapon;
    this.rig = new CharacterRig(scene, x, y, {
      bodyColor: cfg.bodyColor,
      skinColor: PALETTE.cream,
      legColor: PALETTE.plumDark,
      weaponColor: cfg.weaponColor,
      scale: cfg.scale ?? 1,
      // 主角是清军绿营兵（贴图 24×32 四朝向）；贴图缺失时自动退回矩形小人
      unit: 'qing_officer',
    });
    this.maxHp = 100;
    this.hp = 100;
    this.atk = 10;
    this.def = 4;
    this.crit = 5;
    this.critDmg = 150;
    this.speed = 72;
  }

  get x(): number {
    return this.rig.x;
  }
  get y(): number {
    return this.rig.y;
  }

  setStats(s: { hp: number; atk: number; def: number; crit: number; critDmg: number; spd: number }): void {
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.maxHp = s.hp;
    this.hp = Math.max(1, Math.round(s.hp * ratio));
    this.atk = s.atk;
    this.def = s.def;
    this.crit = s.crit;
    this.critDmg = s.critDmg;
    this.speed = s.spd;
  }

  setWeapon(w: WeaponDef, weaponColor: number | null): void {
    this.weapon = w;
    this.attackCd = 0;
    // 占位美术阶段：换武器只改变手中条状物的颜色
    const rig = this.rig as unknown as { weapon?: Phaser.GameObjects.Rectangle };
    if (rig.weapon && weaponColor !== null) rig.weapon.setFillStyle(weaponColor);
  }

  get isInvincible(): boolean {
    return this.invincibleMs > 0;
  }

  canAttack(): boolean {
    return this.alive && this.attackCd <= 0;
  }

  /** 触发一次攻击（返回 true 表示本次生效，交由场景做命中判定） */
  tryAttack(): boolean {
    if (!this.canAttack()) return false;
    this.attackCd = this.attackIntervalMs();
    this.attackAnimMs = 160;
    this.rig.playAttack();
    return true;
  }

  /** 重击（「技」按钮）：独立冷却，命中倍率由场景传入 SKILL_DAMAGE_MULT */
  trySkill(): boolean {
    if (!this.alive || this.skillCd > 0) return false;
    this.skillCd = SKILL_COOLDOWN_MS;
    this.attackCd = this.attackIntervalMs();
    this.attackAnimMs = 260;
    this.rig.playAttack();
    return true;
  }

  /** 重击是否可用（UI 用它给按钮上/下灰） */
  get skillReady(): boolean {
    return this.alive && this.skillCd <= 0;
  }

  /**
   * 闪避（「闪」按钮）。
   *
   * 老师反馈「闪现距离太大、会卡进空气墙」的根因是：原实现用补间把 rig 直接推到
   * `x + distance`，**完全不做碰撞检查**，于是能穿过碰撞格，落地时被 `footBlocked`
   * 判定成「脚在墙里」，之后任何方向都动不了。
   *
   * 现在改成：沿方向按 4px 一小步推进，撞到实体格就停在墙前（贴墙也能闪），
   * 并把距离参数从数据里调小（config.json → dodge.distance_px = 64）。
   * 一格都走不动时直接返回 false 且不进冷却 —— 对着墙按闪不应该被罚。
   */
  tryDodge(dirX: number, dirY: number, distance: number, cooldownMs: number, invincibleMs: number, map?: MapRenderer): boolean {
    if (!this.alive || this.dodgeCd > 0) return false;
    const len = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / len;
    const ny = dirY / len;
    const STEP = 4;
    let travelled = 0;
    const startX = this.rig.x;
    const startY = this.rig.y;
    while (travelled < distance) {
      const step = Math.min(STEP, distance - travelled);
      const tx = this.rig.x + nx * step;
      const ty = this.rig.y + ny * step;
      if (map && this.footBlocked(tx, ty, map)) break;
      this.rig.x = tx;
      this.rig.y = ty;
      travelled += step;
    }
    if (map) {
      const halfW = TILE / 2;
      this.rig.x = Phaser.Math.Clamp(this.rig.x, halfW, map.pixelWidth - halfW);
      this.rig.y = Phaser.Math.Clamp(this.rig.y, TILE, map.pixelHeight - TILE / 2);
    }
    if (travelled < STEP) {
      // 贴墙：位置回退（避免半格抖动），不消耗冷却
      this.rig.x = startX;
      this.rig.y = startY;
      return false;
    }
    this.dodgeCd = cooldownMs;
    this.invincibleMs = invincibleMs;
    // 残影：沿路径撒 3 个，比原来的单点更读得出「闪了一下」
    for (let i = 1; i <= 3; i++) {
      const t = (travelled * i) / 4;
      const ghost = this.scene.add
        .rectangle(startX + nx * t, startY + ny * t, 14, 26, PALETTE.greyPlum, 0.3)
        .setDepth(this.rig.depth - 1);
      this.scene.tweens.add({
        targets: ghost,
        alpha: 0,
        duration: 200 + i * 40,
        onComplete: () => ghost.destroy(),
      });
    }
    return true;
  }

  takeDamage(raw: number): number {
    if (!this.alive) return 0;
    if (this.invincibleMs > 0) return 0;
    const dmg = Math.max(1, Math.round(raw - this.def * 0.5));
    this.hp = Math.max(0, this.hp - dmg);
    this.rig.hitFlash(80);
    this.invincibleMs = 420; // 受击后短暂无敌，避免连击秒杀
    if (this.hp <= 0) {
      this.alive = false;
      this.rig.playDeath();
    }
    return dmg;
  }

  heal(v: number): void {
    this.hp = Math.min(this.maxHp, this.hp + v);
  }

  /**
   * 节点开始 / 战败重试时把玩家完整复位。
   *
   * 场景里原来只写 `alive=true; hp=stats.hp; rig.setAlpha(1)...`，
   * 死亡时 `CharacterRig.playDeath()` 置的 `dead` 一直留着，重开后角色仍是
   * 白色且不动（见 `CharacterRig.revive` 的注释）。血量、冷却、无敌帧也一并归位。
   */
  resetForNode(stats: { hp: number; atk: number; def: number; crit: number; critDmg: number; spd: number }): void {
    this.setStats(stats);
    this.hp = this.maxHp;
    this.alive = true;
    this.attackCd = 0;
    this.skillCd = 0;
    this.dodgeCd = 0;
    this.attackAnimMs = 0;
    this.moving = false;
    // 重开后半秒无敌：同一波敌人还围在身边，站起来立刻被秒的话「再试一次」形同虚设
    this.invincibleMs = 600;
    this.rig.revive();
  }

  /**
   * 无视受击无敌的直接扣血（虎门重炮炸膛用）。
   * 走 takeDamage 会被 420 ms 的无敌帧吞掉，表现就是「炸膛没扣血」。
   */
  takeRaw(raw: number): number {
    if (!this.alive) return 0;
    const dmg = Math.max(1, Math.round(raw));
    this.hp = Math.max(0, this.hp - dmg);
    this.rig.hitFlash(90);
    this.invincibleMs = Math.max(this.invincibleMs, 300);
    if (this.hp <= 0) {
      this.alive = false;
      this.rig.playDeath();
    }
    return dmg;
  }

  facingVector(): { x: number; y: number } {
    switch (this.rig.currentFacing) {
      case 'left':
        return { x: -1, y: 0 };
      case 'right':
        return { x: 1, y: 0 };
      case 'up':
        return { x: 0, y: -1 };
      default:
        return { x: 0, y: 1 };
    }
  }

  private faceFromVector(vx: number, vy: number): void {
    if (Math.abs(vx) > Math.abs(vy)) {
      this.rig.setFacing(vx < 0 ? 'left' : 'right');
    } else if (vy !== 0) {
      this.rig.setFacing(vy < 0 ? 'up' : 'down');
    }
  }

  /**
   * 朝向某个方向（自动瞄准用）。
   * 玩家反馈「打怪时攻击朝着走的方向挥」——所以攻击的瞬间要能把朝向掰到敌人那边；
   * 只有四方向朝向，命中判定仍用精确角度（见 LevelScene.playerAttack）。
   */
  faceTowards(dx: number, dy: number): void {
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    this.faceFromVector(dx, dy);
  }

  update(dtMs: number, moveX: number, moveY: number, map: MapRenderer): void {
    if (this.attackCd > 0) this.attackCd -= dtMs;
    if (this.skillCd > 0) this.skillCd -= dtMs;
    if (this.dodgeCd > 0) this.dodgeCd -= dtMs;
    if (this.invincibleMs > 0) this.invincibleMs -= dtMs;
    if (this.attackAnimMs > 0) this.attackAnimMs -= dtMs;

    const mag = Math.hypot(moveX, moveY);
    this.moving = mag > 0.05;
    if (this.moving && this.alive) {
      this.faceFromVector(moveX, moveY);
      const step = (this.speed * dtMs) / 1000;
      const dx = (moveX / (mag || 1)) * step;
      const dy = (moveY / (mag || 1)) * step;
      this.moveWithCollision(dx, dy, map);
    }

    // 无敌闪烁
    this.rig.setAlpha(this.invincibleMs > 0 ? (Math.floor(this.invincibleMs / 80) % 2 === 0 ? 0.45 : 1) : 1);
    this.rig.tick(dtMs, this.moving);
    this.rig.setDepth(20 + this.rig.y * 0.01);
  }

  /** 轴分离移动，撞墙时沿墙滑动 */
  private moveWithCollision(dx: number, dy: number, map: MapRenderer): void {
    if (dx !== 0 && !this.footBlocked(this.rig.x + dx, this.rig.y, map)) {
      this.rig.x += dx;
    }
    if (dy !== 0 && !this.footBlocked(this.rig.x, this.rig.y + dy, map)) {
      this.rig.y += dy;
    }
    // 边界内收
    const halfW = TILE / 2;
    this.rig.x = Phaser.Math.Clamp(this.rig.x, halfW, map.pixelWidth - halfW);
    this.rig.y = Phaser.Math.Clamp(this.rig.y, TILE, map.pixelHeight - TILE / 2);
  }

  private footBlocked(cx: number, cy: number, map: MapRenderer): boolean {
    // 额外禁区（例：军舰碾出来的海面）——玩家不能下海，敌人不受限制
    if (this.blocker && this.blocker(cx, cy)) return true;
    const left = cx - FOOT_W / 2;
    const right = cx + FOOT_W / 2;
    const top = cy + FOOT_Y - FOOT_H / 2;
    const bottom = cy + FOOT_Y + FOOT_H / 2;
    const pts: [number, number][] = [
      [left, top],
      [right, top],
      [left, bottom],
      [right, bottom],
    ];
    return pts.some(([px, py]) => map.isSolidAtWorld(px, py));
  }
}