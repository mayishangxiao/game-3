/**
 * HubScene —— 时间轴长廊（章节地图）。
 * 设计书 3.2 节的完整形态是一条可走动的横向长廊；本版先实现其两个核心功能：
 * 「关卡入口」与「进度可视化」——长廊以可横向滚动的时间轴呈现，年代石柱 + 节点门。
 *
 * v2.9.7 手机优先改版：
 * - 顶部不再和 UIScene 的常驻 HUD 抢位置（进长廊先把 HUD 收起并清掉旧文字），
 *   门标签放进独立的 480×270 等比层、定宽不换行，「3. 洋务运动」不会再折成两行；
 * - 手指横滑走廊 → 松手吸附最近一幕；点门只「选中」，按「进入」才真的进去；
 * - 底部 6 个入口改成 DOM 按钮（图鉴/装备/图谱/副本/测验/主菜单），触屏点得中；
 * - 副本从常驻面板改成按需弹出，不再压住第一个门和门标签。
 */

import Phaser from 'phaser';
import { DEPTH, PALETTE, VIEW_W } from '../core/constants';
import { dataLoader } from '../core/DataLoader';
import { getSave, persist } from './BootScene';
import { effectiveStats } from '../core/balance';
import { dungeonUnlocked, getDungeonState } from '../core/dungeon';
import { DYNASTY_MAX } from '../core/cannon';
import { camForX, doorAtPoint, dragCam, isSwipe, maxCamX, nearestDoorIndex } from '../core/hubNav';
import { emitToast } from '../core/EventBus';
import type { ActDef, ChapterMeta, DungeonDef } from '../core/types';
import { FONT_UI } from '../gfx/TextStyle';
import { bgm } from '../systems/Bgm';
import { hideOverlay, hideTitle, setHudVisible, showOverlay } from '../systems/DomUi';

interface DoorEntry {
  actId: string;
  seq: number;
  name: string;
  implemented: boolean;
  obj: Phaser.GameObjects.Container;
  x: number;
}

/* ---- 480×270 逻辑坐标下的布局真值（改这里就够，别再散落魔数）---- */
const TOP_H = 26;
const DYN_LABEL_Y = 30;
const DYN_BAR_Y = 50;
const DYN_W = 132;
const LABEL_Y = 74;
const LABEL_W = 108;
const DOOR_Y = 132;
const GROUND_Y = 180;
const ACT_ROW_Y = 192;
const BTN_ROW_Y = 224;
const BTN_ROW_H = 28;
const HINT_Y = 256;
/** 门与门的水平间距（也是标签宽度上限的依据） */
const DOOR_GAP = 118;
const START_X = 110;

const FONT_CJK = "'PingFang SC','Microsoft YaHei',sans-serif";

/** 触屏设备：提示文案与「点一下就能开」的默认行为都跟着它走 */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
}

function btnStyle(extra = ''): string {
  return (
    'border:1px solid #6B6489;background:#241F35;color:#F2EDE4;' +
    `font:12px/1 ${FONT_CJK};border-radius:2px;padding:0;cursor:pointer;` +
    // #dom-overlay 整层是 pointer-events:none（不能挡住 canvas），
    // 而 pointer-events 是可继承属性 —— 按钮必须自己写回 auto 才吃得到触摸。
    'pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent;' +
    'display:flex;align-items:center;justify-content:center;' +
    extra
  );
}

export class HubScene extends Phaser.Scene {
  private meta!: ChapterMeta;
  private doors: DoorEntry[] = [];
  private cursor = 0;
  private camX = 0;
  private targetCamX = 0;
  private maxCam = 0;
  private corridor!: Phaser.GameObjects.Container;
  private doorLabelEls: HTMLDivElement[] = [];
  /** 门标签的等比层（480×270 逻辑坐标，transform: scale） */
  private labelLayer: HTMLDivElement | null = null;
  private labelScale = 1;
  /** 长廊左下角国运血条下面那行「通关本幕后 国运 → N」，随光标变化 */
  private actDynastyText!: Phaser.GameObjects.Text;
  private actDefs: (ActDef | null)[] = [];
  private dungeons: DungeonDef[] = [];
  /** 拖动中：此时 update() 不再做缓动，画面 1:1 跟手 */
  private dragging = false;
  /** 按下时的位置与相机，松手时用来判断「拖动」还是「点选」 */
  private down: { x: number; y: number; cam: number; id: number } | null = null;
  /** 已经在切场景了：防连点把 Level 起两次 */
  private entering = false;

  constructor() {
    super('Hub');
  }

  create(data: { chapterId?: string }): void {
    // 场景会被重复进入（每通关一幕都会回到长廊）。
    // Phaser 重启场景时复用同一个实例、不会重跑字段初始化，
    // 因此必须在这里显式清空状态，否则 doors 里会残留已销毁的显示对象，
    // 后续 setCursor 访问 list[0] 就会抛异常（曾出现过的 bug）。
    this.doors = [];
    this.cursor = 0;
    this.camX = 0;
    this.targetCamX = 0;
    this.dragging = false;
    this.down = null;
    this.entering = false;
    this.dungeons = [];
    // 长廊曲：从战斗/副本退回这里会从 battle 淡出切过来，玩家能听出「打完了」
    bgm.play('hub');

    const chapterId = data.chapterId ?? 'ch00';
    const meta = dataLoader.getChapterMeta(chapterId);
    if (!meta) {
      this.add.text(10, 10, `未知章节：${chapterId}`, { color: '#E85C4A' });
      return;
    }
    this.meta = meta;

    // 标题页大字与长廊底板同为 DOM 层：直接进长廊（探针、以后的选关菜单）时不会经过
    // TitleScene 的 hideTitle()，不在这里收掉就会压在长廊标题上。
    hideTitle();
    // 上一场战斗的 HUD（清王朝 / 战役名 / 血量）停在 DOM 里不会随 UIScene 一起消失，
    // 会正好压在本场景顶部那行标题上（手机实拍里的「两行字叠在一起」）。
    // 长廊有自己的国运血条与顶栏，这里整块收掉。
    setHudVisible(false);
    this.cameras.main.setBackgroundColor(PALETTE.night);
    this.buildSky();

    this.corridor = this.add.container(0, 0).setDepth(DEPTH.deco);

    void this.buildDoors();
    this.buildTopBar();
    this.bindInput();
  }

  private buildSky(): void {
    // 远景随进度变化；本期两幕统一用灰调
    this.add.rectangle(VIEW_W / 2, 150, VIEW_W, 120, PALETTE.plumDark, 1).setDepth(0);
    this.add.rectangle(VIEW_W / 2, 66, VIEW_W, 46, PALETTE.indigo, 0.55).setDepth(0);
    // 星
    for (let i = 0; i < 26; i++) {
      const x = (i * 97) % VIEW_W;
      const y = 8 + ((i * 53) % 50);
      this.add.rectangle(x, y, 1, 1, PALETTE.greyPlum, 0.7).setDepth(0);
    }
  }

  private async buildDoors(): Promise<void> {
    const all = this.meta.acts.map((a) => ({ id: a, implemented: true }));

    const acts: (ActDef | null)[] = await Promise.all(
      all.map(async (a) => {
        try {
          return await dataLoader.loadAct(a.id);
        } catch {
          return null;
        }
      }),
    );

    all.forEach((a, i) => {
      const x = START_X + i * DOOR_GAP;

      // 年代石柱
      this.corridor.add(
        this.add
          .rectangle(x, DOOR_Y + 26, 16, 44, PALETTE.plumMid)
          .setStrokeStyle(1, PALETTE.ink)
          .setOrigin(0.5),
      );

      // 节点门：不吃 Phaser 的 pointer 事件了——命中判定交给整屏手势（tapAt），
      // 否则「按下就选中 + 拖动中被误触发」会抢走横向滑动。
      const door = this.add
        .rectangle(0, 0, 22, 34, a.implemented ? PALETTE.redDark : PALETTE.plumDark)
        .setStrokeStyle(1, a.implemented ? PALETTE.greyPlum : PALETTE.ink)
        .setOrigin(0.5);

      const container = this.add.container(x, DOOR_Y, [door]);
      this.corridor.add(container);
      this.doors.push({
        actId: a.id,
        seq: i + 1,
        name: acts[i]?.name ?? '未开放',
        implemented: a.implemented,
        obj: container,
        x,
      });
    });

    // 长廊地面横线
    this.corridor.add(
      this.add.rectangle(VIEW_W / 2, GROUND_Y, VIEW_W * 4, 2, PALETTE.plumMid, 0.6).setOrigin(0.5),
    );

    this.actDefs = acts;
    this.maxCam = maxCamX(this.doors.map((d) => d.x), VIEW_W);
    this.buildLabelLayer();
    this.paintDoorLabels();
    if (this.doors.length > 0) this.setCursor(0);
    this.buildDynastyBar();

    // DOM 层不归 Phaser 的场景生命周期管，离开长廊必须自己收干净。
    // **Phaser 3.90 不会自动调用场景里名叫 `shutdown` 的方法**（dist 里 `Systems.shutdown`
    // 只做 `events.emit(Events.SHUTDOWN, this, data)`，全文没有 `scene.shutdown` 这段接线），
    // 所以只能自己在 create 里挂监听——挂一次就够，因为 create 每次进入长廊都会重跑。
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());

    // 副本数据只用来弹面板，不再画成常驻的左侧列表
    dataLoader
      .loadDungeons()
      .then((list) => {
        this.dungeons = list;
      })
      .catch(() => {
        this.dungeons = [];
      });
  }

  /**
   * 门标签：名字 + 年份，放在一层 480×270 的等比层里。
   *
   * 以前每个标签直接挂在 #dom-ui、用 `transform: translate(-50%,0)` 居中，
   * 绝对定位元素的可用宽度 = 容器右边缘 - left，越靠右的门可用宽度越小，
   * 于是「3. 洋务运动」被挤成「3. 洋务运 / 动」（手机截图里那一处）。
   * 现在定宽 + 负 margin 居中 + nowrap，和可用宽度彻底解耦。
   */
  private buildLabelLayer(): void {
    const ui = document.getElementById('dom-ui');
    if (!ui) return;
    const layer = document.createElement('div');
    layer.id = 'hub-labels';
    layer.style.cssText =
      'position:absolute;left:0;top:0;width:480px;height:270px;overflow:hidden;' +
      'transform-origin:top left;pointer-events:none;';
    ui.appendChild(layer);
    this.labelLayer = layer;
    this.labelScale = this.game.canvas.clientWidth / VIEW_W || 1;
    layer.style.transform = `scale(${this.labelScale})`;

    this.doorLabelEls = [];
    this.doors.forEach((d, i) => {
      const act = this.actDefs[i];
      const el = document.createElement('div');
      el.style.cssText =
        `position:absolute;top:${LABEL_Y}px;left:0;width:${LABEL_W}px;margin-left:${-LABEL_W / 2}px;` +
        'text-align:center;white-space:nowrap;pointer-events:none;transition:opacity .12s linear;';
      el.innerHTML =
        `<div style="font:14px/1.2 ${FONT_CJK};color:#F2EDE4;">${d.seq}. ${act?.name ?? d.name}</div>` +
        `<div style="font:11px/1.2 ${FONT_CJK};color:#948DAB;margin-top:4px;">${act?.year_label ?? '—'}</div>`;
      layer.appendChild(el);
      this.doorLabelEls.push(el);
    });
  }

  /** 只改颜色/字重：选中那幕的门标签变金，未开放的灰掉 */
  private paintDoorLabels(): void {
    this.doorLabelEls.forEach((el, i) => {
      const d = this.doors[i];
      const name = el.firstElementChild as HTMLElement | null;
      const year = el.lastElementChild as HTMLElement | null;
      if (!d || !name) return;
      const sel = i === this.cursor;
      name.style.color = sel ? '#F0C419' : d.implemented ? '#F2EDE4' : '#6B6489';
      name.style.fontWeight = sel ? '600' : '400';
      if (year) year.style.color = sel ? '#C2BCD1' : '#948DAB';
    });
  }

  private buildTopBar(): void {
    const s = getSave();
    const stats = effectiveStats(s.player.level, s.knowledge.length, s.equipment, dataLoader.getBalance());
    const touch = isTouchDevice();
    const hint = touch ? '左右滑动选幕 · 点门选中 · 点「进入」确认' : '← → 选幕　E 进入　（也可按住拖动）';

    const entries: [string, string][] = [
      ['codex', '图鉴'],
      ['equip', '装备'],
      ['graph', '图谱'],
      ['dungeon', '副本'],
      ['quiz', '测验'],
      ['title', '主菜单'],
    ];
    const quizReady = this.actsAllCleared();

    showOverlay(
      `<div style="position:absolute;left:0;top:0;width:100%;height:${TOP_H}px;background:rgba(13,11,20,.9);` +
        'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 8px;box-sizing:border-box;">' +
        '<div style="min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;' +
        `font:13px/1.2 ${FONT_CJK};color:#F2EDE4;">${this.meta.name} · ${this.meta.period}</div>` +
        '<div style="flex:none;white-space:nowrap;' +
        `font:12px/1.2 ${FONT_CJK};color:#C2BCD1;">Lv${s.player.level}　HP ${stats.hp}　知识卡 ${s.knowledge.length}</div>` +
        '</div>' +
        // 选幕 + 确认：手机上手指点这两枚大按钮，不用去戳 22px 宽的门
        `<div style="position:absolute;left:90px;top:${ACT_ROW_Y}px;width:300px;height:24px;display:flex;gap:6px;">` +
        `<button type="button" data-hub="prev" style="${btnStyle('width:44px;height:24px;font-size:14px;')}">◀</button>` +
        `<button type="button" id="hub-enter" data-hub="enter" style="${btnStyle('flex:1;height:24px;background:#3A2B18;border-color:#F0C419;color:#F0C419;')}">进入</button>` +
        `<button type="button" data-hub="next" style="${btnStyle('width:44px;height:24px;font-size:14px;')}">▶</button>` +
        '</div>' +
        `<div style="position:absolute;left:15px;top:${BTN_ROW_Y}px;width:450px;height:${BTN_ROW_H}px;display:flex;gap:5px;">` +
        entries
          .map(([k, label]) => {
            const dim = k === 'quiz' && !quizReady;
            const badge = k === 'quiz' && s.quiz[this.meta.id]?.passed ? ' ✓' : '';
            return (
              `<button type="button" data-hub="${k}" style="${btnStyle('flex:1;height:28px;')}` +
              (dim ? 'opacity:.45;' : '') + `">${label}${badge}</button>`
            );
          })
          .join('') +
        '</div>' +
        `<div style="position:absolute;left:0;top:${HINT_Y}px;width:100%;text-align:center;` +
        `font:10px/1.2 ${FONT_CJK};color:#6B6489;">${hint}</div>`,
    );

    this.bindOverlayButtons();
    this.updateConfirm();
  }

  private bindOverlayButtons(): void {
    const overlay = document.getElementById('dom-overlay');
    if (!overlay) return;
    overlay.querySelectorAll<HTMLElement>('[data-hub]').forEach((el) => {
      const action = el.dataset.hub ?? '';
      // pointerdown 而不是 click：手机上省掉「抬起才算」的那段等待，点下去就响
      el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.onBarAction(action);
      });
    });
  }

  private onBarAction(action: string): void {
    switch (action) {
      case 'prev':
        this.moveCursor(-1);
        break;
      case 'next':
        this.moveCursor(1);
        break;
      case 'enter':
        this.enter(this.cursor);
        break;
      case 'codex':
        this.scene.start('Codex');
        break;
      case 'equip':
        this.scene.start('Equipment');
        break;
      case 'graph':
        this.scene.start('Graph');
        break;
      case 'dungeon':
        this.openDungeonPanel();
        break;
      case 'quiz':
        this.enterQuiz();
        break;
      case 'title':
        this.backToTitle();
        break;
      default:
        break;
    }
  }

  /** 主菜单：进度已经有自动存档兜底，这里只补一次强制写盘 */
  private backToTitle(): void {
    if (this.entering) return;
    this.entering = true;
    persist();
    this.scene.start('Title');
  }

  /** 确认按钮的文案跟着光标走：显示「第几幕 · 名字」，已通关补个 ✓ */
  private updateConfirm(): void {
    const btn = document.getElementById('hub-enter') as HTMLButtonElement | null;
    if (!btn) return;
    const d = this.doors[this.cursor];
    if (!d) {
      btn.textContent = '进入';
      btn.disabled = true;
      return;
    }
    const cleared = getSave().achievements.includes(`act_cleared_${d.actId}`);
    btn.textContent = `进入 · 第${d.seq}幕 ${d.name}${cleared ? ' ✓' : ''}`;
    btn.disabled = !d.implemented || this.entering;
    btn.style.opacity = d.implemented ? '1' : '.45';
  }

  /**
   * 长廊左上角的国运（清王朝）血条。
   *
   * 老师要的第一段历史总线是「清王朝 100 → 归零」：每一幕按史实扣一截
   * （鸦片战争 −30、太平天国 −15、甲午 −20、戊戌 −10、辛亥 −25）。
   * 这里既画当前值，也跟着光标显示「通关这一幕之后会降到几」——
   * 不这样的话，玩家在长廊里完全看不出国运在动（甲方反馈的点）。
   */
  private buildDynastyBar(): void {
    const s = getSave();
    const dyn = Phaser.Math.Clamp(s.progress.dynasty ?? DYNASTY_MAX, 0, DYNASTY_MAX);
    const x = 8;
    const y = DYN_BAR_Y;
    const w = DYN_W;
    const h = 7;
    this.add
      .rectangle(x + w / 2, y, w, h, PALETTE.plumDark)
      .setStrokeStyle(1, PALETTE.greyPlum)
      .setDepth(DEPTH.hud);
    this.add
      .rectangle(x, y, Math.max(1, (w * dyn) / DYNASTY_MAX), h, PALETTE.redBright)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.hud + 1);
    this.add
      .text(x, DYN_LABEL_Y, `清王朝 ${dyn}`, { fontFamily: FONT_UI, fontSize: '11px', color: '#F0C419' })
      .setDepth(DEPTH.hud + 1);
    this.actDynastyText = this.add
      .text(x + w + 6, DYN_LABEL_Y + 8, '', { fontFamily: FONT_UI, fontSize: '9px', color: '#948DAB' })
      .setDepth(DEPTH.hud + 1);
    this.updateActDynastyText();
  }

  /** 光标所在幕通关后的国运刻度（没有配 dynasty_after 的幕不显示） */
  private updateActDynastyText(): void {
    if (!this.actDynastyText) return;
    const d = this.doors[this.cursor];
    const act = d ? this.actDefs[this.doors.indexOf(d)] : null;
    const target = act?.dynasty_after;
    if (target === undefined || target === null) {
      this.actDynastyText.setText('');
      return;
    }
    const cleared = getSave().achievements.includes(`act_cleared_${d.actId}`);
    this.actDynastyText.setText(cleared ? `本幕已过　国运 → ${target}` : `通关本幕后　国运 → ${target}`);
  }

  private actsAllCleared(): boolean {
    const save = getSave();
    return this.meta.acts.every((a) => save.achievements.includes(`act_cleared_${a}`));
  }

  private enterQuiz(): void {
    if (!this.actsAllCleared()) {
      emitToast('先通关本章全部已开放的事，再来测验', 1500);
      return;
    }
    this.scene.start('Quiz', { chapterId: this.meta.id });
  }

  /**
   * 副本面板：点「副本」按钮才弹出来。
   * 以前是长廊左上角的常驻列表，手机上会一直压着第一道门和它的标签。
   */
  private openDungeonPanel(): void {
    const overlay = document.getElementById('dom-overlay');
    if (!overlay) return;
    const old = document.getElementById('hub-dungeon');
    if (old) {
      old.remove();
      return;
    }
    if (this.dungeons.length === 0) {
      emitToast('暂无可挑战的副本', 1400);
      return;
    }
    const save = getSave();
    const rows = this.dungeons
      .map((d) => {
        const unlocked = dungeonUnlocked(save, d);
        const st = getDungeonState(save, d.id);
        const label = unlocked ? `${d.name}　已通关 ${st.clears} 次` : `${d.name}（未解锁）`;
        const need = this.actIndex(d.unlock_act) + 1;
        const sub = unlocked ? `推荐等级 ${d.recommended_level}` : `通关第 ${need} 幕后解锁`;
        return (
          `<button type="button" data-dungeon="${d.id}" style="${btnStyle('width:100%;height:36px;margin-bottom:6px;justify-content:space-between;padding:0 10px;text-align:left;')}` +
          (unlocked ? '' : 'opacity:.5;') + '">' +
          `<span style="font-size:13px;">${label}</span>` +
          `<span style="font-size:11px;color:#948DAB;">${sub}</span>` +
          '</button>'
        );
      })
      .join('');

    overlay.insertAdjacentHTML(
      'beforeend',
      `<div id="hub-dungeon" style="position:absolute;inset:0;background:rgba(8,6,13,.86);pointer-events:auto;` +
        'display:flex;align-items:center;justify-content:center;">' +
        '<div id="hub-dungeon-box" style="width:420px;background:#1A1626;border:1px solid #948DAB;' +
        'padding:10px 12px;box-sizing:border-box;">' +
        `<div style="font:13px/1.2 ${FONT_CJK};color:#F0C419;margin-bottom:8px;">副本 · 可重复挑战</div>` +
        rows +
        `<button type="button" id="hub-dungeon-close" style="${btnStyle('width:100%;height:32px;margin-top:2px;')}">关闭</button>` +
        '</div></div>',
    );

    const close = (): void => {
      document.getElementById('hub-dungeon')?.remove();
    };
    const root = document.getElementById('hub-dungeon');
    // 点面板外的遮罩也关掉：手机上「关」按钮在屏幕中央，退出路径要多一条
    root?.addEventListener('pointerdown', (ev) => {
      if (ev.target === root) close();
    });
    document.getElementById('hub-dungeon-close')?.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      close();
    });

    root?.querySelectorAll<HTMLElement>('[data-dungeon]').forEach((el) => {
      el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = el.dataset.dungeon ?? '';
        const d = this.dungeons.find((x) => x.id === id);
        if (!d) return;
        if (!dungeonUnlocked(getSave(), d)) {
          emitToast(`通关第 ${this.actIndex(d.unlock_act) + 1} 幕后解锁`, 1600);
          return;
        }
        close();
        this.scene.start('Level', {
          actId: d.unlock_act || 'ch00_act1',
          chapterId: d.chapter_id,
          dungeonId: d.id,
        });
      });
    });
  }

  private actIndex(actId: string): number {
    return this.meta.acts.indexOf(actId);
  }

  private bindInput(): void {
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-LEFT', () => this.moveCursor(-1));
      kb.on('keydown-A', () => this.moveCursor(-1));
      kb.on('keydown-RIGHT', () => this.moveCursor(1));
      kb.on('keydown-D', () => this.moveCursor(1));
      kb.on('keydown-E', () => this.enter(this.cursor));
      kb.on('keydown-ENTER', () => this.enter(this.cursor));
    }

    // 整屏手势：走廊空白处也能滑，不必非要按在门上。
    // 门自己不再 setInteractive —— 那样「按下就选中」会和滑动抢事件。
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.down = { x: p.x, y: p.y, cam: this.camX, id: p.id };
      this.dragging = false;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const d = this.down;
      if (!d || !p.isDown || p.id !== d.id || this.maxCam <= 0) return;
      const dx = p.x - d.x;
      if (!this.dragging && !isSwipe(dx, p.y - d.y)) return;
      this.dragging = true;
      this.camX = dragCam(d.cam, dx, this.maxCam);
      this.targetCamX = this.camX;
      this.corridor.setX(-this.camX);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const d = this.down;
      this.down = null;
      if (!d || p.id !== d.id) return;
      if (this.dragging) {
        this.dragging = false;
        this.setCursor(nearestDoorIndex(this.doors.map((x) => x.x), this.camX, VIEW_W));
        return;
      }
      this.tapAt(this.camX + p.x, p.y);
    });
  }

  /** 点一下门 = 选中它（再按「进入」才走），和电脑端方向键选幕是同一个状态 */
  private tapAt(worldX: number, y: number): void {
    if (y < DYN_BAR_Y + 10 || y > GROUND_Y + 8) return;
    const idx = doorAtPoint(
      this.doors.map((d) => d.x),
      worldX,
      58,
    );
    if (idx < 0 || idx === this.cursor) return;
    this.setCursor(idx);
  }

  private moveCursor(delta: number): void {
    const n = this.doors.length;
    if (n === 0) return;
    this.setCursor((this.cursor + delta + n) % n);
  }

  private setCursor(i: number): void {
    this.cursor = i;
    this.doors.forEach((d, idx) => {
      const selected = idx === i;
      const door = d.obj.list[0] as Phaser.GameObjects.Rectangle | undefined;
      // 防御：场景重建期间可能拿到已销毁的对象
      if (!door || !door.active) return;
      door.setStrokeStyle(selected ? 2 : 1, selected ? PALETTE.star : d.implemented ? PALETTE.greyPlum : PALETTE.ink);
      door.setFillStyle(selected ? PALETTE.red : d.implemented ? PALETTE.redDark : PALETTE.plumDark);
      d.obj.setScale(selected ? 1.14 : 1);
    });
    const d = this.doors[i];
    if (!d) return;
    this.targetCamX = camForX(d.x, VIEW_W, this.maxCam);
    this.updateActDynastyText();
    this.paintDoorLabels();
    this.updateConfirm();
  }

  /**
   * 真正进入关卡。唯一的入口（键盘 E / 点「进入」都走这里）。
   * 先让按钮变「进入中…」再切场景：手机上下一次点击前要有一帧反馈，
   * 否则大地图加载期间玩家会以为点空了，连点好几下。
   */
  private enter(i: number): void {
    if (this.entering) return;
    const d = this.doors[i];
    if (!d) return;
    this.entering = true;
    const btn = document.getElementById('hub-enter') as HTMLButtonElement | null;
    if (btn) {
      btn.textContent = '进入中…';
      btn.disabled = true;
    }
    const s = getSave();
    s.progress.chapter = this.meta.id;
    s.progress.act = d.actId;
    persist();
    this.time.delayedCall(24, () => {
      this.scene.start('Level', { actId: d.actId, chapterId: this.meta.id, startNode: 0 });
    });
  }

  private updateDoorLabels(): void {
    if (!this.labelLayer) return;
    const scale = this.game.canvas.clientWidth / VIEW_W;
    if (Math.abs(scale - this.labelScale) > 0.001) {
      this.labelScale = scale;
      this.labelLayer.style.transform = `scale(${scale})`;
    }
    this.doorLabelEls.forEach((el, i) => {
      const d = this.doors[i];
      if (!d) return;
      const left = d.x - this.camX;
      el.style.left = `${left}px`;
      // 层是 overflow:hidden 的：半个标签被切在屏幕边缘（「4. 戊戌变」只剩一半）
      // 看着像排版坏了。放不下就整块淡出，滑到它时再出现。
      const fits = left - LABEL_W / 2 >= 2 && left + LABEL_W / 2 <= VIEW_W - 2;
      el.style.opacity = fits ? '1' : '0';
    });
  }

  shutdown(): void {
    // 注意：Phaser **不会**自动调用场景里名叫 `shutdown` 的方法（dist 里根本没有
    // `scene.shutdown` 这段接线），所以真正的清理注册在 create() 的 SHUTDOWN 监听里。
    // 这个方法留着给探针和老代码直接调用。
    hideOverlay();
    this.doorLabelEls.forEach((el) => el.remove());
    this.doorLabelEls = [];
    this.labelLayer?.remove();
    this.labelLayer = null;
  }

  override update(_time: number, delta: number): void {
    // 拖动时画面 1:1 跟手，不做缓动；松手后（或点门后）才缓动到目标
    if (!this.dragging && Math.abs(this.camX - this.targetCamX) > 0.5) {
      this.camX = Phaser.Math.Linear(this.camX, this.targetCamX, Math.min(1, delta / 180));
      this.corridor.setX(-this.camX);
    }
    this.updateDoorLabels();
  }
}
