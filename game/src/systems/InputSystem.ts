/**
 * 输入系统 —— 虚拟摇杆 + 攻击/技能/闪避三键 + 交互键，符合设计书 6.1.1 布局。
 *
 * 由 UIScene 创建（常驻屏幕坐标），写入共享的 controls 单例，LevelScene 每帧读取。
 * 触摸与键盘等价：桌面端可用 WASD/方向键 + J/K/L/E 调试。
 */

import Phaser from 'phaser';
import { CONTROL_HIT_PAD, CONTROL_LAYOUT, DEPTH, PALETTE, VIEW_H, VIEW_W } from '../core/constants';

/** 共享输入状态（跨场景单例） */
export const controls = {
  moveX: 0,
  moveY: 0,
  attackHeld: false,
  attackPressed: false,
  cannonPressed: false,
  dodgePressed: false,
  interactPressed: false,
  pausePressed: false,
  /** 每帧末清空「本帧按下」类标志 */
  endFrame(): void {
    this.attackPressed = false;
    this.cannonPressed = false;
    this.dodgePressed = false;
    this.interactPressed = false;
    this.pausePressed = false;
  },
  reset(): void {
    this.moveX = 0;
    this.moveY = 0;
    this.attackHeld = false;
    this.endFrame();
  },
};

/** 按键圆心与半径（设计书 6.1.1）；常量放在 core 里，好让数据测试断言「物件别摆到按钮底下」 */
const LAYOUT = {
  stickCenter: { x: CONTROL_LAYOUT.stick.x, y: CONTROL_LAYOUT.stick.y },
  stickRadius: CONTROL_LAYOUT.stick.r,
  attack: CONTROL_LAYOUT.attack,
  cannon: CONTROL_LAYOUT.cannon,
  dodge: CONTROL_LAYOUT.dodge,
  interact: CONTROL_LAYOUT.interact,
};

/** 可点区域比视觉尺寸大 8px（设计书 6.1.1 移动端要点） */
const HIT_PAD = CONTROL_HIT_PAD;

export class InputSystem {
  private scene: Phaser.Scene;
  private knob: Phaser.GameObjects.Arc;
  private interactBtn: Phaser.GameObjects.Arc;
  private interactLabel: Phaser.GameObjects.Text;
  /** 虎门重炮按钮：冷却时显示剩余秒数并压暗 */
  private cannonFace!: Phaser.GameObjects.Arc;
  private cannonLabel!: Phaser.GameObjects.Text;
  /** 冷却剩余秒数（放在按钮下方，标签始终是「炮」） */
  private cannonCd!: Phaser.GameObjects.Text;
  private cannonShownLeft = -1;
  /** 「炮」键当前是否属于这一关（没有炮的关卡整组隐藏） */
  private cannonShown = false;
  /** 炮键的全部视觉件与命中区（隐藏时连命中区一起收，免得点到空气） */
  private cannonParts: Array<{ setVisible(v: boolean): unknown }> = [];
  private stickPointerId: number | null = null;
  /** 触屏「攻」是否正被按住（键盘与触屏分开记，否则按住的下一帧就被键盘读数清掉） */
  private touchAttack = false;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private enabled = true;
  /** 被面板临时藏起来（与 enabled 分开：对话禁用输入，但不藏控件） */
  private hidden = false;
  /** 所有视觉件与命中区，便于「弹面板时整体隐藏」 */
  private parts: Array<{ setVisible(v: boolean): unknown }> = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // ---- 虚拟摇杆 ----
    const stickBase = scene.add
      .circle(LAYOUT.stickCenter.x, LAYOUT.stickCenter.y, LAYOUT.stickRadius, PALETTE.plumMid, 0.45)
      .setStrokeStyle(1, PALETTE.ink)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud);

    this.knob = scene.add
      .circle(LAYOUT.stickCenter.x, LAYOUT.stickCenter.y, 14, PALETTE.greyLight, 0.85)
      .setStrokeStyle(1, PALETTE.ink)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 1);

    const stickHit = scene.add
      .zone(
        LAYOUT.stickCenter.x,
        LAYOUT.stickCenter.y,
        (LAYOUT.stickRadius + HIT_PAD) * 2,
        (LAYOUT.stickRadius + HIT_PAD) * 2,
      )
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 2);
    stickHit.setInteractive(
      new Phaser.Geom.Circle(LAYOUT.stickRadius + HIT_PAD, LAYOUT.stickRadius + HIT_PAD, LAYOUT.stickRadius + HIT_PAD),
      Phaser.Geom.Circle.Contains,
    );
    void stickBase;
    this.parts.push(stickBase, this.knob, stickHit);
    this.bindStick(stickHit);

    // ---- 三键 ----
    this.makeButton(LAYOUT.attack, '攻', () => {
      this.touchAttack = true;
      controls.attackHeld = true;
      controls.attackPressed = true;
    }, () => {
      this.touchAttack = false;
      controls.attackHeld = false;
    });

    // ---- 虎门重炮：金色描边的金色字，一眼看出这是「大招」 ----
    // 只有「带炮的关卡」才显示（见 `setCannonShown`）——甲方要求炮是这一幕的专属手段，
    // 别的情况下多一个按不动的键只会让人以为坏了。
    const cannonBtn = this.makeButton(LAYOUT.cannon, '炮', () => {
      controls.cannonPressed = true;
    });
    this.cannonFace = cannonBtn.face;
    this.cannonLabel = cannonBtn.text;
    this.cannonFace.setFillStyle(PALETTE.plumMid, 0.9).setStrokeStyle(1, PALETTE.star);
    this.cannonLabel.setColor('#F0C419');
    this.cannonCd = this.scene.add
      .text(LAYOUT.cannon.x, LAYOUT.cannon.y + LAYOUT.cannon.r + 7, '', {
        fontFamily: 'sans-serif',
        fontSize: '9px',
        color: '#C2BCD1',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 1);
    this.cannonParts = [cannonBtn.face, cannonBtn.text, cannonBtn.hit, this.cannonCd];
    this.parts.push(...this.cannonParts);

    this.makeButton(LAYOUT.dodge, '闪', () => {
      controls.dodgePressed = true;
    });

    // ---- 交互键（靠近可交互物时淡入） ----
    this.interactBtn = scene.add
      .circle(LAYOUT.interact.x, LAYOUT.interact.y, LAYOUT.interact.r, PALETTE.star, 0.9)
      .setStrokeStyle(1, PALETTE.ink)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud)
      .setVisible(false);
    this.interactLabel = scene.add
      .text(LAYOUT.interact.x, LAYOUT.interact.y, '查', {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        color: '#0D0B14',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 1)
      .setVisible(false);

    const interactHit = scene.add
      .zone(LAYOUT.interact.x, LAYOUT.interact.y, (LAYOUT.interact.r + HIT_PAD) * 2, (LAYOUT.interact.r + HIT_PAD) * 2)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 2);
    interactHit.setInteractive(
      new Phaser.Geom.Circle(LAYOUT.interact.r + HIT_PAD, LAYOUT.interact.r + HIT_PAD, LAYOUT.interact.r + HIT_PAD),
      Phaser.Geom.Circle.Contains,
    );
    interactHit.on('pointerdown', () => {
      if (!this.enabled || this.hidden) return;
      controls.interactPressed = true;
    });
    this.parts.push(this.interactBtn, this.interactLabel, interactHit);

    this.bindKeyboard();
  }

  private makeButton(
    cfg: { x: number; y: number; r: number },
    label: string,
    onDown: () => void,
    onUp?: () => void,
  ): { face: Phaser.GameObjects.Arc; text: Phaser.GameObjects.Text; hit: Phaser.GameObjects.Zone } {
    const s = this.scene;
    const face = s.add
      .circle(cfg.x, cfg.y, cfg.r, PALETTE.redDark, 0.72)
      .setStrokeStyle(1, PALETTE.ink)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud);
    const text = s.add
      .text(cfg.x, cfg.y, label, {
        fontFamily: 'sans-serif',
        fontSize: cfg.r > 22 ? '16px' : '13px',
        color: '#F2EDE4',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 1);

    const hit = s.add
      .zone(cfg.x, cfg.y, (cfg.r + HIT_PAD) * 2, (cfg.r + HIT_PAD) * 2)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 2);
    hit.setInteractive(
      new Phaser.Geom.Circle(cfg.r + HIT_PAD, cfg.r + HIT_PAD, cfg.r + HIT_PAD),
      Phaser.Geom.Circle.Contains,
    );
    hit.on('pointerdown', () => {
      if (!this.enabled || this.hidden) return;
      onDown();
    });
    hit.on('pointerup', () => {
      if (!this.enabled || this.hidden) return;
      onUp?.();
    });
    // 手指按住后滑出按钮再松开：pointerout 会在「还按着」时就触发，
    // 用它来收尾会把长按攻击打断，所以只在真的松开（outside）时收。
    hit.on('pointerupoutside', () => {
      if (!this.enabled || this.hidden) return;
      onUp?.();
    });
    this.parts.push(face, text, hit);
    return { face, text, hit };
  }

  private bindStick(hit: Phaser.GameObjects.Zone): void {
    const cx = LAYOUT.stickCenter.x;
    const cy = LAYOUT.stickCenter.y;
    const R = LAYOUT.stickRadius;

    /** 把触点换算成移动向量（不改变「这根手指归谁」） */
    const applyStick = (px: number, py: number) => {
      let dx = px - cx;
      let dy = py - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      this.knob.setPosition(cx + dx, cy + dy);
      const nx = dx / R;
      const ny = dy / R;
      // 死区，避免手指微动导致角色抖动
      const dead = 0.18;
      const mag = Math.hypot(nx, ny);
      if (mag < dead) {
        controls.moveX = 0;
        controls.moveY = 0;
      } else {
        const k = (mag - dead) / (1 - dead) / mag;
        controls.moveX = Phaser.Math.Clamp(nx * k, -1, 1);
        controls.moveY = Phaser.Math.Clamp(ny * k, -1, 1);
      }
    };

    const release = (pointerId: number) => {
      if (this.stickPointerId !== pointerId) return;
      this.stickPointerId = null;
      this.knob.setPosition(cx, cy);
      controls.moveX = 0;
      controls.moveY = 0;
    };

    // 只有「按在摇杆范围内」的那根手指才能驱动移动。
    // 之前是在 scene 的 pointermove 里无条件领取指针，结果按「查/攻」时手指一抖，
    // 角色就跟着走，交互也点不实——手指在按钮上，摇杆不该动。
    hit.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.enabled || this.hidden) return;
      if (this.stickPointerId !== null && this.stickPointerId !== p.id) return;
      this.stickPointerId = p.id;
      applyStick(p.x, p.y);
    });
    this.scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.enabled || this.hidden) return;
      // 认指针 + 仍按着：滑出圆圈也继续跟手（向量会被夹到半径内）
      if (p.id !== this.stickPointerId || !p.isDown) return;
      applyStick(p.x, p.y);
    });
    this.scene.input.on('pointerup', (p: Phaser.Input.Pointer) => release(p.id));
    this.scene.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => release(p.id));
  }

  private bindKeyboard(): void {
    const kb = this.scene.input.keyboard;
    if (!kb) return;
    this.keys = kb.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT,J,K,L,P,SHIFT,E,ESC,SPACE') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
  }

  private readKeyboard(): void {
    const k = this.keys;
    if (!k || Object.keys(k).length === 0) return;
    let kx = 0;
    let ky = 0;
    if (k.A?.isDown || k.LEFT?.isDown) kx -= 1;
    if (k.D?.isDown || k.RIGHT?.isDown) kx += 1;
    if (k.W?.isDown || k.UP?.isDown) ky -= 1;
    if (k.S?.isDown || k.DOWN?.isDown) ky += 1;

    if (kx !== 0 || ky !== 0) {
      const len = Math.hypot(kx, ky);
      controls.moveX = kx / len;
      controls.moveY = ky / len;
    } else if (this.stickPointerId === null) {
      controls.moveX = 0;
      controls.moveY = 0;
    }

    const held = Boolean(k.J?.isDown || k.SPACE?.isDown);
    // 触屏「攻」按住时也算 held：这里不能只看键盘，否则手指按住那一帧就被清掉
    controls.attackHeld = held || this.touchAttack;

    if (Phaser.Input.Keyboard.JustDown(k.J) || Phaser.Input.Keyboard.JustDown(k.SPACE)) {
      controls.attackPressed = true;
      controls.attackHeld = true;
    }
    if (Phaser.Input.Keyboard.JustDown(k.P)) controls.cannonPressed = true;
    if (Phaser.Input.Keyboard.JustDown(k.L) || Phaser.Input.Keyboard.JustDown(k.SHIFT)) {
      controls.dodgePressed = true;
    }
    if (Phaser.Input.Keyboard.JustDown(k.E)) controls.interactPressed = true;
    if (Phaser.Input.Keyboard.JustDown(k.ESC)) controls.pausePressed = true;
  }

  /** 每帧调用：读取键盘并刷新交互键可见性 */
  update(nearInteractable: boolean): void {
    if (!this.enabled || this.hidden) return;
    this.readKeyboard();
    this.interactBtn.setVisible(nearInteractable);
    this.interactLabel.setVisible(nearInteractable);
  }

  /**
   * 刷新「炮」按钮的冷却表现：剩余秒数上脸，冷却中压暗成灰色。
   * 只在整秒变化时改文本，避免每帧重排文字。
   */
  setCannonCooldown(secondsLeft: number): void {
    const left = Math.max(0, Math.ceil(secondsLeft));
    if (left === this.cannonShownLeft) return;
    this.cannonShownLeft = left;
    if (left > 0) {
      // 冷却中：按钮压暗、标签变灰，下方小字读秒（标签不消失，玩家才知道这是什么键）
      this.cannonCd.setText(String(left) + 's');
      this.cannonFace.setFillStyle(PALETTE.plumDark, 0.85).setStrokeStyle(1, PALETTE.plumLight);
      this.cannonLabel.setColor('#948DAB');
    } else {
      this.cannonCd.setText('');
      this.cannonFace.setFillStyle(PALETTE.plumMid, 0.9).setStrokeStyle(1, PALETTE.star);
      this.cannonLabel.setColor('#F0C419');
    }
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.clearTouch();
  }

  /**
   * 「炮」键的显隐。甲方要求炮是虎门这一幕的专属手段：没炮的关卡不该出现一个按不动的键。
   * 与 `setShown` 分开记——`setShown(true)` 恢复控件时不能把不应该出现的炮键一起显示出来。
   */
  setCannonShown(v: boolean): void {
    this.cannonShown = v;
    for (const p of this.cannonParts) p.setVisible(v && !this.hidden);
    if (!v) this.cannonShownLeft = -1;
  }

  get cannonVisible(): boolean {
    return this.cannonShown;
  }

  /** 整体显示/隐藏触屏控件：弹结算面板时用，免得按钮压住面板 */
  setShown(v: boolean): void {
    this.hidden = !v;
    for (const p of this.parts) p.setVisible(v);
    if (!v) {
      this.clearTouch();
    } else {
      // 交互键交给下一帧 update 按「是否靠近可交互物」决定
      this.interactBtn.setVisible(false);
      this.interactLabel.setVisible(false);
      // 炮键按「这一关有没有炮」恢复，不能因为恢复控件就凭空出现
      for (const p of this.cannonParts) p.setVisible(this.cannonShown);
    }
  }

  /** 松开所有触摸状态：禁用输入/弹面板时调用，免得手指没抬起就丢事件 */
  private clearTouch(): void {
    this.stickPointerId = null;
    this.touchAttack = false;
    controls.reset();
    this.knob.setPosition(LAYOUT.stickCenter.x, LAYOUT.stickCenter.y);
  }

  destroy(): void {
    // 场景销毁时由 Phaser 自动回收显示对象；此处仅解绑共享状态
    this.stickPointerId = null;
    this.touchAttack = false;
    controls.reset();
  }

  static get layout() {
    return LAYOUT;
  }

  static get viewport() {
    return { w: VIEW_W, h: VIEW_H };
  }

  /** 控件当前是否可见（面板打开时应为 false） */
  get shown(): boolean {
    return !this.hidden;
  }
}