/**
 * 输入系统 —— 虚拟摇杆 + 攻击/技能/闪避三键 + 交互键，符合设计书 6.1.1 布局。
 *
 * 由 UIScene 创建（常驻屏幕坐标），写入共享的 controls 单例，LevelScene 每帧读取。
 * 触摸与键盘等价：桌面端可用 WASD/方向键 + J/K/L/E 调试。
 */

import Phaser from 'phaser';
import { CONTROL_HIT_PAD, CONTROL_LAYOUT, DEPTH, PALETTE, RENDER_SCALE, VIEW_H, VIEW_W } from '../core/constants';
import { FONT_UI } from '../gfx/TextStyle';

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

/** 一根手指一次只认一个用途 */
type ControlRole = 'stick' | 'attack' | 'cannon' | 'dodge' | 'interact';

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
  /**
   * 手指 → 用途。
   *
   * 为什么自己算命中而不用 Phaser 的 `setInteractive`：
   * 后缓冲超采样（`RENDER_SCALE`）之后，`camera.setZoom(R)` 会让 Phaser 的命中测试
   * 对这批 `scrollFactor=0` 的 Zone 全部落空（实测：R=1 时 `hitTestPointer` 命中
   * `Zone@404,192`，R=2 时返回空数组，键盘却照常工作）。
   * 与其去猜它的矩阵分支，不如把这件事变成显式的：指针坐标 ÷ R = 逻辑坐标，
   * 再和 `CONTROL_LAYOUT` 的圆做距离比较。以后摄像机再怎么调都不会再悄悄吃掉触摸。
   */
  private roles = new Map<number, ControlRole>();
  /** 按钮登记表：几何 + 按下/抬起回调，`bindPointerRouting` 按这张表做纯数学命中 */
  private buttons: Array<{
    role: ControlRole;
    x: number;
    y: number;
    r: number;
    onDown: () => void;
    onUp?: () => void;
  }> = [];
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

    void stickBase;
    this.parts.push(stickBase, this.knob);
    this.bindPointerRouting();

    // ---- 三键 ----
    this.makeButton('attack', LAYOUT.attack, '攻', () => {
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
    const cannonBtn = this.makeButton('cannon', LAYOUT.cannon, '炮', () => {
      controls.cannonPressed = true;
    });
    this.cannonFace = cannonBtn.face;
    this.cannonLabel = cannonBtn.text;
    this.cannonFace.setFillStyle(PALETTE.plumMid, 0.9).setStrokeStyle(1, PALETTE.star);
    this.cannonLabel.setColor('#F0C419');
    this.cannonCd = this.scene.add
      .text(LAYOUT.cannon.x, LAYOUT.cannon.y + LAYOUT.cannon.r + 7, '', {
        fontFamily: FONT_UI,
        fontSize: '9px',
        color: '#C2BCD1',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 1);
    this.cannonParts = [cannonBtn.face, cannonBtn.text, this.cannonCd];
    this.parts.push(...this.cannonParts);

    this.makeButton('dodge', LAYOUT.dodge, '闪', () => {
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
        fontFamily: FONT_UI,
        fontSize: '13px',
        color: '#0D0B14',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 1)
      .setVisible(false);

    this.parts.push(this.interactBtn, this.interactLabel);
    // 「查」没有 Zone 了，但同样是按钮：靠近可交互物时才进 pick()（见那里的 visible 判断）
    this.buttons.push({
      role: 'interact',
      x: LAYOUT.interact.x,
      y: LAYOUT.interact.y,
      r: LAYOUT.interact.r + HIT_PAD,
      onDown: () => {
        controls.interactPressed = true;
      },
    });

    this.bindKeyboard();
  }

  private makeButton(
    role: ControlRole,
    cfg: { x: number; y: number; r: number },
    label: string,
    onDown: () => void,
    onUp?: () => void,
  ): { face: Phaser.GameObjects.Arc; text: Phaser.GameObjects.Text; role: ControlRole } {
    const s = this.scene;
    const face = s.add
      .circle(cfg.x, cfg.y, cfg.r, PALETTE.redDark, 0.72)
      .setStrokeStyle(1, PALETTE.ink)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud);
    const text = s.add
      .text(cfg.x, cfg.y, label, {
        fontFamily: FONT_UI,
        fontSize: cfg.r > 22 ? '16px' : '13px',
        color: '#F2EDE4',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 1);

    // 命中判定统一走 bindPointerRouting()（见 roles 字段的注释），这里只留视觉件。
    this.buttons.push({ role, x: cfg.x, y: cfg.y, r: cfg.r + HIT_PAD, onDown, onUp });
    this.parts.push(face, text);
    return { face, text, role };
  }

  /**
   * 屏幕控件的唯一入口：手指按下 → 纯几何判断这根手指归谁 → 之后整条手势都跟着这个用途走。
   *
   * 摇杆的规矩保持原样（也是甲方踩出来的）：只有**按在摇杆圈内**的那根手指才能驱动移动，
   * 按在「攻」上的手指一抖不该让角色走。以前靠 Phaser 的 Zone 命中来保证，
   * 现在靠 `roles` 这张表——一根手指一个用途，语义完全相同，且不再依赖摄像机的矩阵。
   */
  private bindPointerRouting(): void {
    const cx = LAYOUT.stickCenter.x;
    const cy = LAYOUT.stickCenter.y;
    const R = LAYOUT.stickRadius;

    /** 后缓冲像素 → 逻辑坐标（见 `roles` 字段注释） */
    const toLogical = (p: Phaser.Input.Pointer): { x: number; y: number } => ({
      x: p.x / RENDER_SCALE,
      y: p.y / RENDER_SCALE,
    });

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

    /** 这根手指落在哪个控件上？按钮优先，再看摇杆圈 */
    const pick = (x: number, y: number): ControlRole | null => {
      for (const b of this.buttons) {
        // 「查」只在靠近可交互物时才存在，隐藏时不该吃掉点击
        if (b.role === 'interact' && !this.interactBtn.visible) continue;
        if (b.role === 'cannon' && !this.cannonShown) continue;
        if (Math.hypot(x - b.x, y - b.y) <= b.r) return b.role;
      }
      if (Math.hypot(x - cx, y - cy) <= R + HIT_PAD) return 'stick';
      return null;
    };

    const down = (p: Phaser.Input.Pointer) => {
      if (!this.enabled || this.hidden) return;
      const { x, y } = toLogical(p);
      const role = pick(x, y);
      if (!role) return;
      this.roles.set(p.id, role);
      if (role === 'stick') {
        // 已经有一根手指在管摇杆时，第二根手指不抢方向盘
        if (this.stickPointerId !== null && this.stickPointerId !== p.id) {
          this.roles.delete(p.id);
          return;
        }
        this.stickPointerId = p.id;
        applyStick(x, y);
        return;
      }
      const b = this.buttons.find((it) => it.role === role);
      b?.onDown();
    };

    const move = (p: Phaser.Input.Pointer) => {
      if (!this.enabled || this.hidden) return;
      if (this.roles.get(p.id) !== 'stick' || !p.isDown) return;
      // 认指针 + 仍按着：滑出圆圈也继续跟手（向量会被夹到半径内）
      const { x, y } = toLogical(p);
      applyStick(x, y);
    };

    const up = (p: Phaser.Input.Pointer) => {
      const role = this.roles.get(p.id);
      if (!role) return;
      this.roles.delete(p.id);
      if (role === 'stick') {
        if (this.stickPointerId !== p.id) return;
        this.stickPointerId = null;
        this.knob.setPosition(cx, cy);
        controls.moveX = 0;
        controls.moveY = 0;
        return;
      }
      if (!this.enabled || this.hidden) return;
      const b = this.buttons.find((it) => it.role === role);
      // 手指按住后滑出按钮再松开：原来用 pointerupoutside 收尾，
      // 这里 role 一路跟到抬起，语义一致（长按攻击不会被中途打断）。
      b?.onUp?.();
    };

    this.scene.input.on('pointerdown', down);
    this.scene.input.on('pointermove', move);
    this.scene.input.on('pointerup', up);
    this.scene.input.on('pointerupoutside', up);
    // 系统手势打断（来电、通知栏、浏览器菜单）：没有 up 事件，必须在这里收尾
    this.scene.input.on('pointercancel', up);
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