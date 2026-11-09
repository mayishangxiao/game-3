/**
 * UIScene —— HUD 与触屏输入，常驻于 LevelScene 之上。
 * 布局遵循设计书 6.1.1：底部状态条 14px 承载 HP/经验/武器/目标。
 */

import Phaser from 'phaser';
import { DEPTH, HUD_H, PALETTE, VIEW_H, VIEW_W } from '../core/constants';
import { InputSystem } from '../systems/InputSystem';
import { EV, bus, getCannonVisible, getControlsVisible, getHudVisible, getSceneLabel, setControlsVisible, type HudPayload, type SceneLabelPayload, type ToastPayload } from '../core/EventBus';
import { DYNASTY_MAX } from '../core/cannon';
import { FONT_UI } from '../gfx/TextStyle';
import { hideFloat, hideOverlay, setHudDynasty, setHudLevel, setHudObjective, setHudScene, setHudVisible, setHudWeapon, showOverlay, showToast } from '../systems/DomUi';

const BAR_X = 6;
const BAR_W = 84;
const HUD_Y = VIEW_H - HUD_H;
/** HP 条分三段（设计书状态条：三段式） */
const HP_SEGMENTS = 3;
/** 清王朝血条宽度 */
const DYN_W = 96;

export class UIScene extends Phaser.Scene {
  private inputSystem!: InputSystem;
  private hpBars: Phaser.GameObjects.Rectangle[] = [];
  private hpBack!: Phaser.GameObjects.Rectangle;
  private expBar!: Phaser.GameObjects.Rectangle;
  private levelText!: Phaser.GameObjects.Text;
  private weaponText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private toastTimer = 0;
  private interactAvailable = false;
  private inputEnabled = true;
  /* 清王朝血条（老师要求的第一段历史总线） */
  private dynastyFill!: Phaser.GameObjects.Rectangle;
  private dynastyText!: Phaser.GameObjects.Text;
  private defeatTag!: Phaser.GameObjects.Text;
  /** 左上角「当前战役 · 这一场的名字　年份」 */
  private scenePlate!: Phaser.GameObjects.Rectangle;
  private sceneText!: Phaser.GameObjects.Text;
  private yearText!: Phaser.GameObjects.Text;
  private detailText!: Phaser.GameObjects.Text;
  /** 最近一次的清王朝血量，只在变化时重排文本 */
  private dynastyShown = -1;
  /** 整块 HUD 是否可见（开场情境卡期间藏起来） */
  private hudShown = true;
  /** 本次关卡是否已经输过（决定「战败」标记显不显示，见 applyHud / setHudShown） */
  private defeatedNow = false;
  /** 只有底板、没有内容引用的部件，也要能被整块收起来 */
  private hudStrip!: Phaser.GameObjects.Rectangle;
  private expBack!: Phaser.GameObjects.Rectangle;
  private dynBack!: Phaser.GameObjects.Rectangle;
  /** 右上角「暂停」：甲方要求能随时停下来并回主菜单 */
  private pauseBtn!: Phaser.GameObjects.Rectangle;
  // canvas 版的「暂停」文字已删除：文字统一走 DOM（#dom-pause-btn）。留着那份隐藏 Text
  // 会被 setHudShown(true) 重新点亮，和 DOM 的「暂停」叠成「暂停暂停」。
  private pauseOpen = false;
  private pauseLayer: Phaser.GameObjects.GameObject[] = [];
  /** 暂停前摇杆是不是露着的，恢复时按这个还原 */
  private controlsBeforePause = true;

  constructor() {
    super('UI');
  }

  create(): void {
    this.hudStrip = this.add.rectangle(VIEW_W / 2, HUD_Y + HUD_H / 2, VIEW_W, HUD_H, PALETTE.ink, 0.9).setDepth(DEPTH.hud);

    // HP 三段
    this.hpBack = this.add
      .rectangle(BAR_X, HUD_Y + 5, BAR_W, 5, PALETTE.plumDark)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.hud + 1);
    const segW = (BAR_W - (HP_SEGMENTS - 1)) / HP_SEGMENTS;
    for (let i = 0; i < HP_SEGMENTS; i++) {
      this.hpBars.push(
        this.add
          .rectangle(BAR_X + i * (segW + 1), HUD_Y + 5, segW, 5, PALETTE.red)
          .setOrigin(0, 0.5)
          .setDepth(DEPTH.hud + 2),
      );
    }
    this.expBack = this.add
      .rectangle(BAR_X, HUD_Y + 11, BAR_W, 3, PALETTE.plumDark)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.hud + 1);
    this.expBar = this.add
      .rectangle(BAR_X, HUD_Y + 11, 0, 3, PALETTE.star)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.hud + 2);

    this.levelText = this.add
      .text(BAR_X + BAR_W + 4, HUD_Y + 5, 'Lv1', {
        fontFamily: FONT_UI,
        fontSize: '9px',
        color: '#C2BCD1',
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.hud + 2);

    this.weaponText = this.add
      .text(VIEW_W - 6, HUD_Y + 5, '腰刀', {
        fontFamily: FONT_UI,
        fontSize: '9px',
        color: '#F2EDE4',
      })
      .setOrigin(1, 0.5)
      .setDepth(DEPTH.hud + 2);

    // 目标（这一场要干什么）：甲方要求放在左上角「事件」下面，而不是屏幕正中下方。
    // 贴着战役条底部排；战役条高度随第三行变化，所以在 onSceneLabel 里重新定位。
    this.objectiveText = this.add
      .text(6, 38, '', {
        fontFamily: FONT_UI,
        fontSize: '9px',
        color: '#F0C419',
        backgroundColor: '#0D0B14',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0, 0)
      .setDepth(DEPTH.hud + 2);

    // 清王朝血条：挂在左上角，跨场景常驻。老师要的「中间有个代表清王朝的血条」
    this.dynastyText = this.add
      .text(6, 4, '清王朝', {
        fontFamily: FONT_UI,
        fontSize: '8px',
        color: '#F0C419',
      })
      .setOrigin(0, 0)
      .setDepth(DEPTH.hud + 2);
    // 底槽（固定宽度做视觉底）
    this.dynBack = this.add
      .rectangle(6, 16, DYN_W, 5, PALETTE.plumDark, 0.95)
      .setOrigin(0, 0.5)
      .setStrokeStyle(1, PALETTE.ink)
      .setDepth(DEPTH.hud + 1);
    this.dynastyFill = this.add
      .rectangle(6, 16, DYN_W, 3, PALETTE.redBright)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.hud + 2);
    this.defeatTag = this.add
      .text(6 + DYN_W + 6, 16, '战败', {
        fontFamily: FONT_UI,
        fontSize: '8px',
        color: '#E85C4A',
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.hud + 2)
      .setVisible(false);

    // 左上角战役条：老师评审时要一眼看出「现在打的是哪一场、哪一年」。
    // 底板跟着文字宽度走（见 onSceneLabel），所以 origin 放在左上角。
    this.scenePlate = this.add
      .rectangle(2, 1, 150, 33, PALETTE.ink, 0.55)
      .setOrigin(0, 0)
      .setDepth(DEPTH.hud + 0.5)
      .setVisible(false);
    this.sceneText = this.add
      .text(6, 21, '', {
        fontFamily: FONT_UI,
        fontSize: '8px',
        color: '#F2EDE4',
      })
      .setOrigin(0, 0)
      .setDepth(DEPTH.hud + 2)
      .setVisible(false);
    this.yearText = this.add
      .text(6, 21, '', {
        fontFamily: FONT_UI,
        fontSize: '8px',
        color: '#F0C419',
      })
      .setOrigin(0, 0)
      .setDepth(DEPTH.hud + 2)
      .setVisible(false);

    // 第三行「地点 · 对方兵力」：甲方要求背景上要写清时间、地点、对方出兵数量。
    // 战斗开场卡里写全，这里留一行常驻小字，玩家随时能对照。
    this.detailText = this.add
      .text(6, 31, '', {
        fontFamily: FONT_UI,
        fontSize: '8px',
        color: '#C2BCD1',
      })
      .setOrigin(0, 0)
      .setDepth(DEPTH.hud + 2)
      .setVisible(false);

    // 屏幕中央提示
    this.toastText = this.add
      .text(VIEW_W / 2, 96, '', {
        fontFamily: FONT_UI,
        fontSize: '12px',
        color: '#F2EDE4',
        backgroundColor: '#0D0B14',
        padding: { x: 6, y: 3 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay)
      .setAlpha(0);

    // 右上角「暂停」：随时能停、能回主菜单。放在最上层，卡片/对白期间也能点到。
    this.pauseBtn = this.add
      .rectangle(VIEW_W - 6, 8, 40, 16, PALETTE.ink, 0.72)
      .setOrigin(1, 0.5)
      .setStrokeStyle(1, PALETTE.greyPlum)
      .setDepth(DEPTH.overlay - 1)
      .setInteractive({ useHandCursor: true });
    this.pauseBtn.on('pointerdown', () => this.openPause());

    // 右上角「暂停」按钮文字走 DOM
    const pauseDom = document.createElement('div');
    pauseDom.id = 'dom-pause-btn';
    pauseDom.style.cssText = 'position:absolute;right:14px;top:2px;color:#F2EDE4;font:11px sans-serif;pointer-events:none;line-height:16px;';
    pauseDom.textContent = '暂停';
    (document.querySelector('#dom-ui') as HTMLElement)?.appendChild(pauseDom);

    this.inputSystem = new InputSystem(this);
    // 中文文字全部搬到 DOM（DomUi）：canvas 上这些 Text 对象隐藏，只留血条/底槽等色块
    for (const t of [this.levelText, this.weaponText, this.objectiveText, this.dynastyText, this.defeatTag, this.sceneText, this.yearText, this.detailText]) {
      t.setVisible(false);
    }
    this.toastText.setAlpha(0);
    this.scenePlate.setVisible(false);
    // LevelScene 会在 launch('UI') 之后立刻进节点并发出 CONTROLS_VISIBLE，
    // 而 UIScene 的 create() 要下一帧才跑 —— 那一条事件会被丢掉。这里按模块级状态补一次。
    this.inputSystem.setShown(getControlsVisible());
    this.inputSystem.setCannonShown(getCannonVisible());
    // 同一类时序问题：进节点的那一条 SCENE_LABEL 比本场景 create() 更早
    const label = getSceneLabel();
    if (label) this.onSceneLabel(label);
    // 开场情境卡期间 HUD 整块收起，同样补一次（事件比 create() 早）
    this.setHudShown(getHudVisible());

    bus.on(EV.HUD, this.onHud, this);
    bus.on(EV.TOAST, this.onToast, this);
    bus.on(EV.OBJECTIVE, this.onObjective, this);
    bus.on(EV.INPUT_ENABLE, this.onInputEnable, this);
    bus.on(EV.INTERACT_AVAILABLE, this.onInteractAvailable, this);
    bus.on(EV.CONTROLS_VISIBLE, this.onControlsVisible, this);
    bus.on(EV.SCENE_LABEL, this.onSceneLabel, this);
    bus.on(EV.HUD_VISIBLE, this.onHudVisible, this);
    bus.on(EV.CANNON_VISIBLE, this.onCannonVisible, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off(EV.HUD, this.onHud, this);
      bus.off(EV.TOAST, this.onToast, this);
      bus.off(EV.OBJECTIVE, this.onObjective, this);
      bus.off(EV.INPUT_ENABLE, this.onInputEnable, this);
      bus.off(EV.INTERACT_AVAILABLE, this.onInteractAvailable, this);
      bus.off(EV.CONTROLS_VISIBLE, this.onControlsVisible, this);
      bus.off(EV.SCENE_LABEL, this.onSceneLabel, this);
      bus.off(EV.HUD_VISIBLE, this.onHudVisible, this);
      bus.off(EV.CANNON_VISIBLE, this.onCannonVisible, this);
      this.inputSystem.destroy();
    });
  }

  private onHud(p: HudPayload): void {
    const ratio = p.maxHp > 0 ? Phaser.Math.Clamp(p.hp / p.maxHp, 0, 1) : 0;
    const segW = (BAR_W - (HP_SEGMENTS - 1)) / HP_SEGMENTS;
    for (let i = 0; i < HP_SEGMENTS; i++) {
      const segStart = i / HP_SEGMENTS;
      const local = Phaser.Math.Clamp((ratio - segStart) * HP_SEGMENTS, 0, 1);
      this.hpBars[i].width = local * segW;
      this.hpBars[i].setFillStyle(ratio < 0.3 ? PALETTE.redBright : PALETTE.red);
    }
    this.hpBack.setVisible(this.hudShown);

    const expRatio = p.expNext > 0 ? Phaser.Math.Clamp(p.exp / p.expNext, 0, 1) : 0;
    this.expBar.width = expRatio * BAR_W;

    this.levelText.setText(`Lv${p.level}　知识 ${p.knowledgeCount}`);
    this.weaponText.setText(p.weaponName);
    setHudLevel(`Lv${p.level}  知识 ${p.knowledgeCount}`);
    setHudWeapon(p.weaponName);

    // 虎门重炮冷却：整秒数上按钮，冷却中压暗
    this.inputSystem.setCannonCooldown((p.cannonLeftMs ?? 0) / 1000);

    // 清王朝血条
    if (p.dynasty !== undefined) {
      const dyn = Phaser.Math.Clamp(p.dynasty, 0, DYNASTY_MAX);
      this.dynastyFill.width = Math.max(0, (DYN_W * dyn) / DYNASTY_MAX);
      this.dynastyFill.setFillStyle(dyn < 35 ? PALETTE.redDark : PALETTE.redBright);
      if (dyn !== this.dynastyShown) {
        this.dynastyShown = dyn;
        this.dynastyText.setText(`清王朝 ${dyn}`);
        setHudDynasty(`清王朝 ${dyn}`, this.defeatedNow);
      }
    }
    // 「战败」标记不能走 setHudShown 的统一开关：那个开关收/放 HUD 时会把
    // 所有部件一起点亮，导致没输过也显示「战败」。这里记住状态，收放时按状态给。
    this.defeatedNow = p.defeated === true;
    setHudDynasty(`清王朝 ${p.dynasty ?? 0}`, this.defeatedNow);
  }

  private onObjective(text: string): void {
    this.objectiveText.setText(text);
    setHudObjective(text);
  }

  /**
   * 左上角战役条：「幕名 · 这一场」+「年份」。
   * 底板宽度按文字实际宽度重算，中英文混排也不会溢出。
   */
  private onSceneLabel(p: SceneLabelPayload): void {
    if (!p || !p.title) {
      setHudScene('', '', '');
      return;
    }
    const head = p.act && p.act !== p.title ? `${p.act} · ${p.title}` : p.title;
    const year = p.year ? `${p.year} 年` : '';
    const bits: string[] = [];
    if (p.time) bits.push(p.time);
    if (p.place) bits.push(p.place);
    if (p.enemy) bits.push(p.enemy);
    const detail = bits.join(' · ');
    setHudScene(head, year, detail);
    if (!this.hudShown) this.setHudShown(false);
  }

  private onToast(p: ToastPayload): void {
    this.toastTimer = (p.ms ?? 1600) / 1000;
    showToast(p.text, p.ms ?? 1600);
  }

  private onInputEnable(v: boolean): void {
    this.inputEnabled = v;
    this.inputSystem.setEnabled(v);
  }

  private onInteractAvailable(v: boolean): void {
    this.interactAvailable = v;
  }

  private onControlsVisible(v: boolean): void {
    this.inputSystem.setShown(v);
  }

  private onHudVisible(v: boolean): void {
    this.setHudShown(v);
  }

  /** 「炮」键属于有炮的关卡：进战斗幕显示，退出战斗收走 */
  private onCannonVisible(v: boolean): void {
    this.inputSystem.setCannonShown(v);
  }

  /**
   * 整块 HUD 的显隐。
   * 开场情境卡是全屏的，左上角战役条与血条压上去会和卡片上的年份大字撞在一起
   * （截图里已经撞过一次），所以卡片期间整块收起来。
   */
  private setHudShown(v: boolean): void {
    this.hudShown = v;
    setHudVisible(v);
    if (!v) {
      // 收 HUD 时顺手把飘字清掉：演出结束后恢复 HUD，残留的旧 toast 会突然冒出来
      this.toastTimer = 0;
      this.toastText?.setAlpha(0);
    }
    const parts: Array<Phaser.GameObjects.GameObject | undefined> = [
      ...this.hpBars,
      this.hpBack,
      this.expBar,
      this.dynastyFill,
      this.hudStrip,
      this.expBack,
      this.dynBack,
      // 开场卡/战败演出是全屏的，右上角「暂停」也要跟着收，否则会浮在卡片上
      this.pauseBtn,
      // **pauseText 不在这里出现**：它的文字已经搬到 DOM（#dom-pause-btn），
      // canvas 那份在 create 里 setVisible(false) 永久藏掉。一旦被 setHudShown(true)
      // 点亮，就会和 DOM 的「暂停」叠成「暂停暂停」——甲方截图里的第二处重叠。
    ];
    for (const o of parts) {
      const vis = o as Phaser.GameObjects.Components.Visible | undefined;
      if (vis && typeof vis.setVisible === 'function') vis.setVisible(v);
    }
    const pauseDom = document.getElementById('dom-pause-btn');
    if (pauseDom) pauseDom.style.display = v ? 'block' : 'none';
    // 战败标记只跟「本次是否输过」走，不跟 HUD 开关一起无脑点亮（见 applyHud）
    // （canvas 上的「战败」小标签已搬到 DOM，这里不再 setVisible）
  }

  /* ------------------------------------------------------------------ *
   * 暂停：甲方要求右上角随时能停，并可从暂停回到主菜单
   * ------------------------------------------------------------------ */

  private openPause(): void {
    if (this.pauseOpen) return;
    this.pauseOpen = true;
    this.controlsBeforePause = getControlsVisible();

    const level = this.scene.get('Level');
    if (level && level.scene.isActive()) this.scene.pause('Level');
    setControlsVisible(false);
    this.setHudShown(false);
    hideFloat(); // 暂停时藏掉 NPC 头顶浮动标签

    const cx = VIEW_W / 2;
    const cy = VIEW_H / 2;
    const push = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.pauseLayer.push(o);
      return o;
    };

    push(this.add.rectangle(cx, cy, VIEW_W, VIEW_H, PALETTE.ink, 0.8).setDepth(DEPTH.overlay + 1));
    push(
      this.add
        .rectangle(cx, cy, 168, 118, PALETTE.plumDark, 0.96)
        .setStrokeStyle(1, PALETTE.star)
        .setDepth(DEPTH.overlay + 2),
    );

    const buttons: Array<{ label: string; y: number; onTap: () => void }> = [
      { label: '继　续', y: cy + 6, onTap: () => this.closePause() },
      { label: '返回主菜单', y: cy + 34, onTap: () => this.backToTitle() },
    ];
    for (const b of buttons) {
      const box = this.add
        .rectangle(cx, b.y, 120, 22, PALETTE.ink, 0.95)
        .setStrokeStyle(1, PALETTE.greyPlum)
        .setDepth(DEPTH.overlay + 3)
        .setInteractive({ useHandCursor: true });
      box.on('pointerdown', () => b.onTap());
      push(box);
    }

    showOverlay(
      `<div style="position:absolute;left:0;top:${cy - 52}px;width:100%;text-align:center;font-size:22px;color:#F0C419;">暂　停</div>
       <div style="position:absolute;left:0;top:${cy - 24}px;width:100%;text-align:center;font-size:11px;color:#C2BCD1;">战斗进度已冻结</div>
       <div style="position:absolute;left:0;top:${cy - 5}px;width:100%;text-align:center;font-size:14px;color:#F2EDE4;">继　续</div>
       <div style="position:absolute;left:0;top:${cy + 23}px;width:100%;text-align:center;font-size:14px;color:#F2EDE4;">返回主菜单</div>`,
    );
  }

  private closePause(): void {
    if (!this.pauseOpen) return;
    this.pauseOpen = false;
    for (const o of this.pauseLayer) o.destroy();
    this.pauseLayer = [];
    hideOverlay();
    const level = this.scene.get('Level');
    if (level && level.scene.isPaused()) this.scene.resume('Level');
    this.setHudShown(true);
    setControlsVisible(this.controlsBeforePause);
  }

  private backToTitle(): void {
    this.pauseOpen = false;
    for (const o of this.pauseLayer) o.destroy();
    this.pauseLayer = [];
    hideOverlay();
    const level = this.scene.get('Level');
    if (level && (level.scene.isActive() || level.scene.isPaused())) this.scene.stop('Level');
    setControlsVisible(true);
    this.setHudShown(true);
    this.scene.start('Title');
    this.scene.stop();
  }

  /** 供端到端脚本断言：暂停面板是否打开 */
  pauseShownNow(): boolean {
    return this.pauseOpen;
  }

  /** 供端到端脚本断言：HUD 是否可见 */
  hudShownNow(): boolean {
    return this.hudShown;
  }

  /** 供端到端脚本断言：面板打开时控件应为隐藏 */
  controlsShown(): boolean {
    return this.inputSystem.shown;
  }

  /** 供端到端脚本断言：炮键只在战斗幕出现 */
  controlsCannonShown(): boolean {
    return this.inputSystem.cannonVisible;
  }

  override update(_time: number, delta: number): void {
    // 注意：这里**不要**清「本帧按下」标志。标志的生命周期由 LevelScene 收尾
    // （见 LevelScene.update 里的 controls.endFrame 注释）：输入事件在两个场景的
    // update 之间送达，在这里清会让单次点击读不到。
    this.inputSystem.update(this.interactAvailable && this.inputEnabled);

    if (this.toastTimer > 0) {
      this.toastTimer -= delta / 1000;
      if (this.toastTimer <= 0) {
        this.tweens.add({ targets: this.toastText, alpha: 0, duration: 260 });
      }
    }
  }
}