/**
 * 跨场景事件总线。
 * UIScene（HUD + 触屏输入）与 LevelScene（世界与玩法）通过它解耦。
 */

import Phaser from 'phaser';

export const bus = new Phaser.Events.EventEmitter();

export const EV = {
  /** HUD 数据刷新 */
  HUD: 'hud:update',
  /** 启用/禁用输入（对话、过场时禁用） */
  INPUT_ENABLE: 'input:enable',
  /** 交互键是否可见 */
  INTERACT_AVAILABLE: 'interact:available',
  /** 摇杆与三键是否显示（弹面板时藏起来，免得压在按钮上） */
  CONTROLS_VISIBLE: 'controls:visible',
  /** 整块 HUD（清王朝条 / 战役条 / 血条）的显隐：开场情境卡要用整屏 */
  HUD_VISIBLE: 'hud:visible',
  CANNON_VISIBLE: 'cannon:visible',
  /** 屏幕中央短提示 */
  TOAST: 'toast',
  /** 目标行文本 */
  OBJECTIVE: 'objective',
  /** 左上角「当前战役 / 年份」条 */
  SCENE_LABEL: 'scene:label',
} as const;

export interface HudPayload {
  hp: number;
  maxHp: number;
  level: number;
  exp: number;
  expNext: number;
  weaponName: string;
  knowledgeCount: number;
  /** 虎门重炮冷却剩余（ms）；0 表示可放 */
  cannonLeftMs?: number;
  /** 清王朝血条 0–100（老师要求的第一段历史总线） */
  dynasty?: number;
  /** 本次关卡里是否输过（战败演出后仍继续，HUD 上要看得出来） */
  defeated?: boolean;
}

export interface ToastPayload {
  text: string;
  ms?: number;
}

/** 左上角的「当前战役名 + 年份」 */
export interface SceneLabelPayload {
  /** 幕名，例如「鸦片战争」 */
  act: string;
  /** 这一场的名字，例如「虎门炮台守卫战」；副本模式下是副本名 */
  title: string;
  /** 史实年份，例如 1841 */
  year?: number;
  /** 更精确的时间，例如「1841 年 2 月」（战斗开场卡里有，这里作为第三行小字） */
  time?: string;
  /** 地点，例如「虎门 · 威远炮台」 */
  place?: string;
  /** 对方兵力，例如「英舰 11 艘 · 敌 2000 人」 */
  enemy?: string;
}

/**
 * 摇杆/三键的当前可见性。
 * 必须有这份模块级状态：LevelScene 在 launch('UI') 之后立刻设定可见性，
 * 而 UIScene 的 create() 要下一帧才订阅，事件会丢——UIScene 建好输入系统后按这里补一次。
 */
let controlsVisible = true;

/** 当前这一场的名字与年份（UIScene 建好时补读一次） */
let currentSceneLabel: SceneLabelPayload | null = null;

export function getControlsVisible(): boolean {
  return controlsVisible;
}

/** 便捷封装 */
export function emitHud(p: HudPayload): void {
  bus.emit(EV.HUD, p);
}

export function emitToast(text: string, ms = 1600): void {
  bus.emit(EV.TOAST, { text, ms } as ToastPayload);
}

export function emitObjective(text: string): void {
  bus.emit(EV.OBJECTIVE, text);
}

export function setInputEnabled(v: boolean): void {
  bus.emit(EV.INPUT_ENABLE, v);
}

/** 左上角「当前战役 + 年份」。每进一个节点发一次。 */
export function emitSceneLabel(p: SceneLabelPayload): void {
  // 和 controlsVisible 同理：LevelScene 先发、UIScene 下一帧才订阅，事件会丢。
  // 存一份模块级状态，UIScene.create() 里补读。
  currentSceneLabel = p;
  bus.emit(EV.SCENE_LABEL, p);
}

export function getSceneLabel(): SceneLabelPayload | null {
  return currentSceneLabel;
}

export function setControlsVisible(v: boolean): void {
  // 每帧都会被调用（对话期间要藏摇杆），值没变就别再发一遍
  if (controlsVisible === v) return;
  controlsVisible = v;
  bus.emit(EV.CONTROLS_VISIBLE, v);
}

/** HUD 整块显隐（开场情境卡期间藏起来，免得年份大字压在战役条上） */
let hudVisible = true;

export function getHudVisible(): boolean {
  return hudVisible;
}

export function setHudVisible(v: boolean): void {
  if (hudVisible === v) return;
  hudVisible = v;
  bus.emit(EV.HUD_VISIBLE, v);
}

/**
 * 「炮」键只在有炮的关卡出现。
 *
 * 甲方要求：只有战斗这一幕才该有这个技能，别的场景留一个按不动的炮键只会让人以为坏了。
 */
let cannonVisible = false;

export function getCannonVisible(): boolean {
  return cannonVisible;
}

export function setCannonVisible(v: boolean): void {
  if (cannonVisible === v) return;
  cannonVisible = v;
  bus.emit(EV.CANNON_VISIBLE, v);
}