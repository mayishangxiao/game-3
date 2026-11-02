/**
 * TitleScene —— 标题画面。
 * 按设计书 6.9.4 第 2 条：「开始」按钮同时承担 iOS 音频解锁手势。
 */

import Phaser from 'phaser';
import { DEPTH, PALETTE, VIEW_H, VIEW_W } from '../core/constants';
import { dataLoader } from '../core/DataLoader';
import { getSave, persist, reloadSave, saveManager } from './BootScene';
import { emitToast } from '../core/EventBus';
import type { SaveData } from '../core/types';

/**
 * 存档里有没有「真实的进度」。
 *
 * 不能用 `saveManager.hasSave()`：它只问 localStorage 里有没有那条 key，而
 * `reset()` 会立刻写一份全新的默认存档进去，于是 hasSave() 永远为 true。
 * 也不能看 `scrap`：默认存档初始就带 30 个零件，同样恒为真。
 * 真正能区分「新开局」和「打过」的，只有推进过的章／幕、做过的事件、拿过的成就。
 */
function hasProgress(s: SaveData): boolean {
  return (
    s.progress.chapter !== 'ch00' ||
    s.progress.act !== 'ch00_act1' ||
    s.progress.events.length > 0 ||
    s.progress.nodes_done.length > 0 ||
    s.progress.completion && Object.keys(s.progress.completion).length > 0 ||
    s.achievements.length > 0 ||
    s.knowledge.length > 0
  );
}

export class TitleScene extends Phaser.Scene {
  /** 标题按钮的所有可点对象（E2E 用 titleMenu 拿坐标真点） */
  private titleButtons: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Title');
  }

  create(): void {
    const cx = VIEW_W / 2;
    this.titleButtons = [];
    this.cameras.main.setBackgroundColor(PALETTE.ink);

    // 远景：破碎山河（占位色块分层）
    const sky = this.add.rectangle(cx, VIEW_H * 0.34, VIEW_W, VIEW_H * 0.68, PALETTE.plumDark).setDepth(0);
    const far = this.add.rectangle(cx, VIEW_H * 0.55, VIEW_W, 40, PALETTE.plumMid).setDepth(1);
    const near = this.add.rectangle(cx, VIEW_H * 0.68, VIEW_W, 26, PALETTE.brownDeep).setDepth(2);
    void sky;
    void far;
    void near;

    // 太阳/星黄的点
    this.add.circle(VIEW_W - 74, 58, 12, PALETTE.star, 0.85).setDepth(2);

    this.add
      .text(cx, 66, '党史像素 RPG', {
        fontFamily: 'sans-serif',
        fontSize: '26px',
        color: '#F2EDE4',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.add
      .text(cx, 94, '序 章 · 觉 醒 年 代  1840 — 1921', {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        color: '#C2BCD1',
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.add
      .text(cx, 116, '你扮演历史中的人，亲手把每一件大事「做」一遍', {
        fontFamily: 'sans-serif',
        fontSize: '9px',
        color: '#948DAB',
      })
      .setOrigin(0.5)
      .setDepth(10);

    // 按钮表由 buildMenu() 画，点「重新开始」之后也走同一条路重画一遍
    // （而不是重启场景：Phaser 的 restart 只会把操作塞进队列等下一帧，
    //  在点击回调里根本等不到那一帧，标题页就会原地不动）。
    this.buildMenu();

    // 「手机请横屏」只在画面确实还是竖着的时候才说。CSS 旋转兜底生效时（__dshGate.rotated）
    // window.innerHeight 仍是竖的，但玩家看到的已经是横过来的画面；而自检不过、兜底被撤销时
    // rotated 又会变回 false——那时该重新提示。所以这行字跟着 gate 状态每帧对一次表
    // （POST_UPDATE），最多晚一帧，不会抖）。
    const gate = (window as unknown as { __dshGate?: { rotated?: boolean } }).__dshGate;
    const baseHint = 'WASD / 方向键移动　J 攻击　K 技能　L 闪避　E 交互';
    const controlHint = this.add
      .text(cx, VIEW_H - 12, baseHint, { fontFamily: 'sans-serif', fontSize: '8px', color: '#6B6489' })
      .setOrigin(0.5)
      .setDepth(10);
    const syncHint = (): void => {
      const nag = window.innerHeight > window.innerWidth && !gate?.rotated;
      const want = nag ? `${baseHint}　手机请横屏` : baseHint;
      if (controlHint.text !== want) controlHint.setText(want);
    };
    syncHint();
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, syncHint);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.POST_UPDATE, syncHint);
    });

    this.input.keyboard?.on('keydown-ENTER', () => this.startGame(hasProgress(getSave())));

    // E2E / 探针用：把标题按钮的屏幕中心交出去，截图里点到哪儿能对得上。
    this.exposeDebugApi();
  }

  /**
   * 画标题页的按钮表。
   *
   * 单独抽出来的原因：点「重新开始」之后**不能重启场景**（Phaser 的
   * restart/start 只是往 SceneManager 队列里压操作，要等下一次 update 才生效——
   * 而点击回调返回后标题页就不再更新了，玩家看到的就是「点了没反应」）。
   * 改为就地重画：把旧按钮都销毁，按当前存档状态再建一遍。
   */
  private buildMenu(): void {
    this.titleButtons.forEach((o) => o.destroy());
    this.titleButtons = [];

    const cx = VIEW_W / 2;
    // 注意不能用 saveManager.hasSave() 判断「有没有存档」：reset() 会立刻写一份全新的
    // 默认存档进 localStorage，所以 hasSave() 永远是 true——「重新开始」按下去之后
    // 按钮表也不会变，看起来就像点了没反应。真正要问的是「存档里有没有真实进度」。
    const played = hasProgress(getSave());
    const buttons: { label: string; action: () => void }[] = [];

    buttons.push({ label: played ? '继 续' : '开 始', action: () => this.startGame(played) });
    if (played) {
      buttons.push({
        label: '重 新 开 始',
        action: () => {
          saveManager.reset(dataLoader.getBalance());
          reloadSave();
          emitToast('已重新开始：存档已清空', 2000);
          // 就地重画按钮表：重置之后标题页应该只剩「开 始」。
          this.buildMenu();
        },
      });
    }
    buttons.push({
      label: '导 出 存 档',
      action: () => {
        const s = getSave();
        const str = saveManager.exportString(s);
        void navigator.clipboard?.writeText(str);
        emitToast('存档已复制到剪贴板（可粘贴备份）', 2200);
      },
    });
    buttons.push({
      label: '导 入 存 档',
      action: () => {
        // 为什么要有这一条：换成另一条隧道/另一个域名，就是一个新的 localStorage，
        // 存档会「消失」。手机上又没法打开控制台，只能靠导出字符串搬过去。
        const text = window.prompt('粘贴之前导出的存档字符串');
        if (!text || !text.trim()) return;
        try {
          saveManager.save(saveManager.importString(text, dataLoader.getBalance()));
          reloadSave();
          emitToast('存档已导入', 2000);
          this.buildMenu();
        } catch (e) {
          emitToast(e instanceof Error ? e.message : '存档字符串无法识别', 2400);
        }
      },
    });

    buttons.forEach((b, i) => {
      const y = 152 + i * 26;
      const rect = this.add
        .rectangle(cx, y, 132, 20, PALETTE.redDark, 0.9)
        .setStrokeStyle(1, PALETTE.ink)
        .setDepth(10)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(cx, y, b.label, {
          fontFamily: 'sans-serif',
          fontSize: '12px',
          color: '#F2EDE4',
        })
        .setOrigin(0.5)
        .setDepth(11);

      // 底板 rect 和文字 label 是两个可交互对象，各自会派发一次 pointerdown。
      // 以前两处共用一个 `this.pressed` 开关：第一个回调把开关置真，第二个直接 return，
      // 而真正执行动作的那一下常常落在已经被压扁的 rect 上——于是「点到了字、但没反应」。
      // 现在不做去重：动作本身幂等（重画按钮表），重复触发也只是重画一次。
      const press = (): void => {
        rect.setScale(0.94);
        b.action();
      };
      rect.on('pointerdown', press);
      label.setInteractive({ useHandCursor: true }).on('pointerdown', press);
      this.titleButtons.push(rect, label);
    });
  }

  /**
   * E2E / 探针用：把标题按钮交出去。
   * 注意读数要**现查**：`press()` 之后按钮表会被重画，闭包里缓存的按钮已经销毁了。
   */
  private exposeDebugApi(): void {
    const live = (): Phaser.GameObjects.Rectangle[] =>
      this.titleButtons.filter((o) => (o as Phaser.GameObjects.Rectangle).type === 'Rectangle') as Phaser.GameObjects.Rectangle[];
    const snap = (): { index: number; label: string; x: number; y: number }[] => {
      const labels = this.titleButtons.filter((o) => (o as Phaser.GameObjects.Text).type === 'Text') as Phaser.GameObjects.Text[];
      return live().map((r, i) => ({ index: i, label: labels[i]?.text ?? '', x: r.x, y: r.y }));
    };
    (window as unknown as { __dshTitle?: unknown }).__dshTitle = {
      buttons: snap(),
      // 每次现查，不要缓存数组
      list: () => snap(),
      press: (i: number) => {
        const r = live()[i];
        if (r && r.active) r.emit('pointerdown');
        return !!r && r.active;
      },
    };
  }

  private startGame(continueGame: boolean): void {
    if (!continueGame) {
      // reset() 只写了 localStorage，模块里的 SAVE 还是旧对象——不重读的话
      // 后面的 persist() 会把刚抹掉的进度原样写回去。
      saveManager.reset(dataLoader.getBalance());
      reloadSave();
      emitToast('已开始新的旅程', 1600);
    }
    const s = getSave();
    void persist;
    // 从存档记录的幕开始；无进度则进入第一幕
    this.scene.start('Hub', { chapterId: s.progress.chapter || 'ch00' });
  }

  override update(): void {
    void DEPTH;
  }
}