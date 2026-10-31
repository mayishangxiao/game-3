/**
 * 真正的启动入口 —— 由 main.ts 在 Phaser 就绪后动态载入。
 * 依据设计书 1.5.1 技术约束：内部分辨率 480×270，整数倍放大，像素清晰，手机横屏。
 */

import Phaser from 'phaser';
import { PALETTE, VIEW_H, VIEW_W, CONTROL_LAYOUT } from './core/constants';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { HubScene } from './scenes/HubScene';
import { LevelScene } from './scenes/LevelScene';
import { UIScene } from './scenes/UIScene';
import { CodexScene } from './scenes/CodexScene';
import { QuizScene } from './scenes/QuizScene';
import { EquipmentScene } from './scenes/EquipmentScene';
import { GraphScene } from './scenes/GraphScene';
import { installStartGate } from './systems/OrientationGate';
import { controls } from './systems/InputSystem';

export function boot(): Phaser.Game {
  // 走到这里引擎必然就绪（main.ts 已经 await 过 loadPhaser）。留个断言，
  // 免得将来有人把 main.ts 的加载顺序改回去，最后变成一块黑屏。
  if (!Phaser) throw new Error('Phaser 未加载：检查 main.ts 里的 loadPhaser() 顺序');

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game-root',
    width: VIEW_W,
    height: VIEW_H,
    backgroundColor: PALETTE.ink,
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: VIEW_W,
      height: VIEW_H,
    },
    physics: {
      // 本作使用自写的轴分离碰撞（配合瓦片网格），不启用物理引擎，减小包体
      default: '',
    },
    input: {
      activePointers: 3,
    },
    disableContextMenu: true,
    scene: [
      BootScene,
      TitleScene,
      HubScene,
      LevelScene,
      UIScene,
      CodexScene,
      QuizScene,
      EquipmentScene,
      GraphScene,
    ],
  };

  const game = new Phaser.Game(config);

  // 调试钩子：供无头冒烟测试与排查使用（不参与游戏逻辑）
  (window as unknown as { __dshGame?: Phaser.Game }).__dshGame = game;
  // 触摸输入状态也挂出去：E2E 要证明「按在按钮上的手指不会驱动摇杆」
  (window as unknown as { __dshControls?: typeof controls }).__dshControls = controls;
  // 按钮坐标也挂出去：E2E 不该硬编码按钮位置（每次加新按钮都会重排）
  (window as unknown as { __dshLayout?: typeof CONTROL_LAYOUT }).__dshLayout = CONTROL_LAYOUT;

  // 「点击开始」+ 自动横屏（全屏与方向锁都只能在用户手势里申请）
  installStartGate(game);

  // 移动端视口抖动处理（设计书 6.9.4 第 1 条）
  let resizeTimer = 0;
  const handleResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      game.scale.refresh();
    }, 120);
  };
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);

  // 后台挂起时自动暂停（设计书 6.9.4 第 5 条）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.loop.sleep();
    } else {
      game.loop.wake();
    }
  });

  return game;
}