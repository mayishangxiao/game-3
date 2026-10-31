/**
 * 战败演出（城破）——参考《植物大战僵尸》「你已被吃掉脑子」的节奏。
 *
 * 甲方要求（用户 m06955）的灵魂是**顺序**：先定格留白，再画面/声音，最后才出字。
 * 所以这里的代码刻意分成几拍，每拍只做一件事，时间点全部从 `core/defeat.ts` 取，
 * 不要在场景里再写魔法数字。
 *
 * 三条约束：
 *   1. 演出期间 `mode` 必须是 `cutscene`，世界不再前进（否则敌人在黑屏底下继续打玩家）。
 *   2. HUD 与技能键必须藏掉——这正是「演出」与「普通战败」的区别；结束后由调用方恢复。
 *   3. 任何对象都要能被 `destroyAll()` 收干净：玩家可能在中途重开关卡，残留文字会盖在新场景上。
 */
import Phaser from 'phaser';
import { DEPTH, PALETTE, VIEW_H, VIEW_W } from '../core/constants';
import { DEFEAT_BEATS, DEFEAT_TEXT, beatStart } from '../core/defeat';
import { backdropImage } from '../gfx/Backdrop';
import { setControlsVisible, setHudVisible } from '../core/EventBus';
import { audio } from './AudioKit';

export interface DefeatCinematicOptions {
  /** 大字，默认「虎门城破」 */
  title?: string;
  /** 第二行，默认「守军殉国」 */
  line?: string;
  /** 小字落款（日期/地点），默认 1841 年 2 月 26 日 */
  note?: string;
  /** 演出结束回调（此时画面已清干净，调用方去播剧情卡） */
  onDone: () => void;
}

export class DefeatCinematic {
  private scene: Phaser.Scene;
  private cam: Phaser.Cameras.Scene2D.Camera;
  private parts: Phaser.GameObjects.GameObject[] = [];
  private textParts: Phaser.GameObjects.Text[] = [];
  private timers: Phaser.Time.TimerEvent[] = [];
  private done = false;
  private prevZoom = 1;
  /** 演出专用摄像机：战场摄像机要拉远，遮挡层/大字不能跟着缩 */
  private uiCam: Phaser.Cameras.Scene2D.Camera | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.cam = scene.cameras.main;
  }

  /** 播放整段演出。返回后立刻生效的是「定格 + 藏 HUD」，其余按时间轴推进。 */
  play(opts: DefeatCinematicOptions): void {
    const { scene, cam } = this;
    this.prevZoom = cam.zoom;
    const title = opts.title ?? DEFEAT_TEXT.title;
    const line = opts.line ?? DEFEAT_TEXT.line;
    const note = opts.note ?? DEFEAT_TEXT.note;

    // ── 第 0 拍之前：冻结全场。这是甲方要求的「先短暂留白停顿」的前提。
    setHudVisible(false);
    setControlsVisible(false);
    audio.silenceBattle();
    scene.tweens.killAll();
    scene.time.removeAllEvents();

    // 遮幅黑边（电影感）+ 压暗。黑边从画面外滑进来，比直接出现更像「切镜」。
    const barTop = scene.add.rectangle(VIEW_W / 2, -24, VIEW_W, 48, 0x000000).setDepth(DEPTH.overlay + 1);
    const barBot = scene.add.rectangle(VIEW_W / 2, VIEW_H + 24, VIEW_W, 48, 0x000000).setDepth(DEPTH.overlay + 1);
    const dark = scene.add
      .rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, PALETTE.ink, 0)
      .setDepth(DEPTH.overlay);
    this.parts.push(barTop, barBot, dark);

    // 江面：用已经画好的海战背景当「镜头推向的江面」，避免再造一套美术。
    const fleet = backdropImage(scene, DEPTH.overlay + 2).setAlpha(0);
    this.parts.push(fleet);

    // 大字 + 副行 + 落款。origin 0.5，缩放从小到大会自然居中放大。
    const big = scene.add
      .text(VIEW_W / 2, VIEW_H / 2 - 14, title, {
        fontFamily: 'sans-serif',
        fontSize: '36px',
        color: '#F2EDE4',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setStroke('#8C1C1C', 6)
      .setShadow(2, 2, '#000000', 4)
      .setDepth(DEPTH.overlay + 4)
      .setAlpha(0)
      .setScale(0.28);
    const sub = scene.add
      .text(VIEW_W / 2, VIEW_H / 2 + 20, line, {
        fontFamily: 'sans-serif',
        fontSize: '20px',
        color: '#D9534F',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay + 4)
      .setAlpha(0);
    const foot = scene.add
      .text(VIEW_W / 2, VIEW_H / 2 + 46, note, { fontFamily: 'sans-serif', fontSize: '10px', color: '#C2BCD1' })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay + 4)
      .setAlpha(0);
    this.textParts.push(big, sub, foot);
    this.parts.push(big, sub, foot);

    // 演出层与战场必须分属两个摄像机。
    // 战场摄像机会被拉远（zoom 0.62），同一个摄像机里的黑边/压暗/大字/海战背景也会一起缩小，
    // 结果就是黑边只盖住半屏、背景图歪在右边（截图里就是这样），构图整个散架。
    // 这里给演出层单独开一台不缩放、不滚动的摄像机。
    const uiCam = scene.cameras.add(0, 0, VIEW_W, VIEW_H);
    uiCam.setName('defeat-ui');
    const worldOnly = scene.children.list.filter((o) => !this.parts.includes(o));
    uiCam.ignore(worldOnly);
    cam.ignore(this.parts);
    this.uiCam = uiCam;

    // ── 第 1 拍：留白。什么都不做，只把黑边滑进来——「静」是为了后面那声炮。
    scene.tweens.add({ targets: [barTop], y: 24, duration: DEFEAT_BEATS.freeze + 260, ease: 'Sine.easeOut' });
    scene.tweens.add({ targets: [barBot], y: VIEW_H - 24, duration: DEFEAT_BEATS.freeze + 260, ease: 'Sine.easeOut' });

    // ── 第 2 拍：镜头拉远。缩小 + 轻微上移，读作「从战场退到江面」。
    this.at(beatStart('pullback'), () => {
      cam.stopFollow();
      audio.cannonAftermath();
      // 拉得比「稍微退一点」更狠：0.7 倍能真的读成「退到江面上看这场败仗」，
      // 只退到 0.86 的话画面上还是战场占满屏，和后面整屏的海战背景打架。
      cam.zoomTo(Math.max(0.62, this.prevZoom * 0.7), DEFEAT_BEATS.pullback + 200, 'Sine.easeInOut');
      scene.tweens.add({ targets: dark, fillAlpha: 0.66, duration: DEFEAT_BEATS.pullback, ease: 'Sine.easeInOut' });
    });

    // ── 第 3 拍：镜头真正落到江面（海战背景淡入并继续缓慢推近）。
    this.at(beatStart('fleet'), () => {
      scene.tweens.add({ targets: fleet, alpha: 0.82, duration: DEFEAT_BEATS.fleet + 300, ease: 'Sine.easeOut' });
      fleet.setScale(1);
      scene.tweens.add({ targets: fleet, scale: 1.06, duration: 2600, ease: 'Sine.easeOut' });
    });

    // ── 第 4 拍：城破音效 + 大字。先声后字，中间只差 60ms，听感上是「砸下来那一下字才出现」。
    this.at(beatStart('boom'), () => audio.cityFall());
    this.at(beatStart('text'), () => {
      big.setAlpha(1);
      scene.tweens.add({
        targets: big,
        scale: 1,
        duration: DEFEAT_BEATS.text * 0.55,
        ease: 'Back.easeOut',
      });
      // 轻微抖动：整块文字左右 2px 来回，配合镜头 shake，冲击感来自「不稳」
      scene.tweens.add({ targets: big, x: big.x + 2, duration: 70, yoyo: true, repeat: 5, delay: 240 });
      scene.tweens.add({ targets: sub, alpha: 1, duration: 420, delay: 300 });
      scene.tweens.add({ targets: foot, alpha: 1, duration: 420, delay: 760 });
      cam.shake(300, 0.006);
      audio.bell(2);
    });

    // ── 第 5 拍：停住，让玩家把字读完（不要刚出来就淡走）。
    this.at(beatStart('hold'), () => {
      scene.tweens.add({ targets: [sub, foot], alpha: 0, duration: 260 });
    });

    // ── 第 6 拍：收尾。全部淡出 → 恢复镜头 → 交给调用方播剧情。
    this.at(beatStart('reveal'), () => {
      scene.tweens.add({
        targets: [big, fleet, dark, barTop, barBot],
        alpha: 0,
        duration: DEFEAT_BEATS.reveal,
        onComplete: () => {
          this.finish();
          opts.onDone();
        },
      });
    });
  }

  /** 用一次性的 delayedCall 排程（不用 tween 的 onComplete，避免被 killAll 误杀） */
  private at(ms: number, fn: () => void): void {
    const t = this.scene.time.delayedCall(Math.max(0, ms), () => {
      if (this.done) return;
      fn();
    });
    this.timers.push(t);
  }

  /** 清干净所有演出对象并把镜头恢复原样 */
  finish(): void {
    if (this.done) return;
    this.done = true;
    this.destroyAll();
    this.cam.zoomTo(this.prevZoom, 200, 'Sine.easeOut');
    audio.resumeBattle();
    setHudVisible(true);
    setControlsVisible(true);
  }

  destroyAll(): void {
    for (const t of this.timers) t.remove(false);
    this.timers = [];
    if (this.uiCam) {
      this.scene.cameras.remove(this.uiCam);
      this.uiCam = null;
    }
    for (const p of this.parts) p.destroy();
    this.parts = [];
    this.textParts = [];
  }
}