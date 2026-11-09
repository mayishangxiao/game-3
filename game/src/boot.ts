/**
 * 真正的启动入口 —— 由 main.ts 在 Phaser 就绪后动态载入。
 * 依据设计书 1.5.1 技术约束：内部分辨率 480×270，整数倍放大，像素清晰，手机横屏。
 *
 * 渲染策略（甲方 m01507「游戏内所有文字像素感太强，用清晰的标准字体」之后改的）：
 *  - **画布不再是 pixelArt 模式**（`pixelArt:false / antialias:true / roundPixels:false`），
 *    否则整块画布只有 480×270 个像素，一个字 10px 高，放大到手机屏上必然发糊；
 *  - **后缓冲按 RENDER_SCALE 超采样**（见 `core/constants.ts` 的 `GAME_W/GAME_H`）：
 *    逻辑坐标一律还是 480×270，但画布本身是 1440×810，字落屏前只缩 1.x 倍；
 *    **每个场景必须在 `create()` 开头 `cameras.main.setZoom(RENDER_SCALE)`**，
 *    否则画面只占左上角 1/R²；
 *  - 像素类资源（小人、瓦片、道具、炮火帧……）各自在创建时标 `NEAREST` 并做整数倍缩放，
 *    保持硬边；文字走标准字体 + 平滑，二者在同一画布上并存。
 *  见 `src/gfx/PixelArt.ts`（纹理滤镜）与 `src/gfx/TextStyle.ts`（字体族）。
 */

import Phaser from 'phaser';
import { GAME_H, GAME_W, PALETTE, RENDER_SCALE, CONTROL_LAYOUT, refreshRenderScale } from './core/constants';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { HubScene } from './scenes/HubScene';
import { LevelScene } from './scenes/LevelScene';
import { UIScene } from './scenes/UIScene';
import { CodexScene } from './scenes/CodexScene';
import { QuizScene } from './scenes/QuizScene';
import { EquipmentScene } from './scenes/EquipmentScene';
import { GraphScene } from './scenes/GraphScene';
import { installTextResolution, retuneAllTexts } from './gfx/TextResolution';
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
    width: GAME_W,
    height: GAME_H,
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
      width: GAME_W,
      height: GAME_H,
      // 后缓冲已经是超采样尺寸（见 constants.ts 的 RENDER_SCALE），这里不再二次缩放。
      // 旧实现写的是 `zoom: 1/dpr`，注释还声称「按 CSS 尺寸给后缓冲」——
      // 实测是错的：Phaser 只把它当 CSS 显示尺寸，canvas.width 始终等于 config.width。
      zoom: 1,
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

  // 每个场景的摄像机都套上 RENDER_SCALE（后缓冲是超采样尺寸，逻辑坐标仍是 480×270）。
  // 挂在场景的 CREATE 事件上而不是每个 create() 里手写一行：
  // CREATE 在 create() 返回后、首帧渲染前同步触发，所以不会有「先按 1 倍显示一帧」的闪动；
  // 而手写 9 处的话，将来加第 10 个场景一定有人漏（漏了就是画面缩在左上角 1/R²）。
  //
  // `setOrigin(0, 0)` 不是可选的装饰，它和 setZoom 是一体的：
  // 摄像机默认 origin = 画布中心（buffer 像素），zoom 是**绕着 origin 缩放**的，
  // 于是矩阵变成 screen = R*world - 480，画面整体被推到左上角外、
  // 只剩世界右下四分之一可见（实测矩阵 [2,0,0,2,-480,-270]、截图证实），
  // 同时 `Camera.getWorldPoint` 也跟着算错，所有 setInteractive 的对象点不中。
  // origin 归零后矩阵变成 screen = R*(world - scroll)，逻辑坐标 1:1 放大 R 倍，
  // 渲染和命中测试同时回到正确。
  const zoomCameras = (scene: Phaser.Scene): void => {
    const cam = scene.cameras?.main;
    if (!cam) return;
    if (cam.originX !== 0 || cam.originY !== 0) cam.setOrigin(0, 0);
    if (cam.zoom !== RENDER_SCALE) cam.setZoom(RENDER_SCALE);
  };
  game.scene.scenes.forEach((s) => s.events.on(Phaser.Scenes.Events.CREATE, () => zoomCameras(s)));
  // 场景是懒启动的（BootScene 走了才建 Title），新加进来的也要接上
  game.events.on(Phaser.Core.Events.READY, () => {
    game.scene.scenes.forEach((s) => s.events.on(Phaser.Scenes.Events.CREATE, () => zoomCameras(s)));
  });

  // 调试钩子：供无头冒烟测试与排查使用（不参与游戏逻辑）
  (window as unknown as { __dshGame?: Phaser.Game }).__dshGame = game;
  // 触摸输入状态也挂出去：E2E 要证明「按在按钮上的手指不会驱动摇杆」
  (window as unknown as { __dshControls?: typeof controls }).__dshControls = controls;
  // 按钮坐标也挂出去：E2E 不该硬编码按钮位置（每次加新按钮都会重排）
  (window as unknown as { __dshLayout?: typeof CONTROL_LAYOUT }).__dshLayout = CONTROL_LAYOUT;

  // 「点击开始」+ 自动横屏（全屏与方向锁都只能在用户手势里申请）
  installStartGate(game);

  // 移动端视口抖动处理（设计书 6.9.4 第 1 条）
  //
  // 这里不只是 `scale.refresh()`：横竖屏切换会改变「1 个逻辑像素占几个物理像素」，
  // 而 `RENDER_SCALE` 是在模块加载时按当时的视口算的。手机上真实顺序是
  //   竖屏加载 → 算出偏小的 R → 用户点「开始」→ 申请全屏 + 方向锁 → 变横屏。
  // 只 refresh 的话，后缓冲还是竖屏那套，横屏需要 4.33 倍却只有 3 倍，
  // 浏览器又要把画布**放大**铺屏 —— 这正是甲方说的「文字不清晰」。
  // 所以 R 变了就要真的改后缓冲尺寸、重套摄像机、并把已经建好的 Text 按新栅格重画。
  let resizeTimer = 0;
  const handleResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (refreshRenderScale()) {
        game.scale.resize(GAME_W, GAME_H);
        for (const s of game.scene.getScenes(true)) zoomCameras(s);
        retuneAllTexts(game);
      }
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