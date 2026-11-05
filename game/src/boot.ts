/**
 * 真正的启动入口 —— 由 main.ts 在 Phaser 就绪后动态载入。
 * 依据设计书 1.5.1 技术约束：内部分辨率 480×270，整数倍放大，像素清晰，手机横屏。
 *
 * 渲染策略（甲方 m01507「游戏内所有文字像素感太强，用清晰的标准字体」之后改的）：
 *  - **画布不再是 pixelArt 模式**（`pixelArt:false / antialias:true / roundPixels:false`），
 *    否则整块画布只有 480×270 个像素，一个字 10px 高，放大到手机屏上必然发糊；
 *  - Canvas 里的**图形**仍然按 480×270 的逻辑坐标摆（`scale: FIT`），只是落到物理像素时是平滑的；
 *  - 像素类资源（小人、瓦片、道具、炮火帧……）各自在创建时标 `NEAREST` 并做整数倍缩放，
 *    保持硬边；文字走标准字体 + 平滑，二者在同一画布上并存。
 *  见 `src/gfx/PixelArt.ts`（纹理滤镜）与 `src/gfx/TextStyle.ts`（字体族）。
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
import { installTextResolution } from './gfx/TextResolution';
import { installStartGate } from './systems/OrientationGate';
import { controls } from './systems/InputSystem';

export function boot(): Phaser.Game {
  // 走到这里引擎必然就绪（main.ts 已经 await 过 loadPhaser）。留个断言，
  // 免得将来有人把 main.ts 的加载顺序改回去，最后变成一块黑屏。
  if (!Phaser) throw new Error('Phaser 未加载：检查 main.ts 里的 loadPhaser() 顺序');

  // 所有 Text 统一按 TEXT_RESOLUTION 倍栅格生成（见 gfx/TextResolution.ts）。
  // 必须在任何场景 create 之前装好——第一屏的 BootScene 就有文字。
  installTextResolution();

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game-root',
    width: VIEW_W,
    height: VIEW_H,
    backgroundColor: PALETTE.ink,
    // 像素资源靠纹理滤镜保持硬边（gfx/PixelArt 的 markPixel），画布本身不锁像素网格：
    // 锁了以后字只有 10 来个物理像素高，怎么调字体都糊。
    pixelArt: false,
    // 像素图是整数倍缩放的，取整与否对它们没有影响；而文字要的是亚像素摆位，
    // roundPixels 会把文本框吸附到整格上，小字号看起来一顿一顿的。
    roundPixels: false,
    antialias: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: VIEW_W,
      height: VIEW_H,
      // 手机横屏物理像素往往远超 480×270。按 CSS 尺寸给后缓冲（最多 2.667 倍，4K 屏封顶），
      // 再让浏览器把这一整张图平滑缩到屏幕上——文字因此是「先按高分辨率画，再缩小」，
      // 而不是「画小再放大」。1 表示老式「后缓冲 = 逻辑尺寸」。
      zoom: 1 / Math.min(window.devicePixelRatio || 1, 2.667),
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