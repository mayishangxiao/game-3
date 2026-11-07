/**
 * HubScene —— 时间轴长廊（章节地图）。
 * 设计书 3.2 节的完整形态是一条可走动的横向长廊；本版先实现其两个核心功能：
 * 「关卡入口」与「进度可视化」——长廊以可横向滚动的时间轴呈现，年代石柱 + 节点门。
 * 可走动版本随瓦片美术一并接入（见设计书 3.2.3）。
 */

import Phaser from 'phaser';
import { DEPTH, PALETTE, VIEW_H, VIEW_W } from '../core/constants';
import { dataLoader } from '../core/DataLoader';
import { getSave, persist } from './BootScene';
import { effectiveStats } from '../core/balance';
import { dungeonUnlocked, getDungeonState } from '../core/dungeon';
import { emitToast } from '../core/EventBus';
import type { ActDef, ChapterMeta } from '../core/types';
import { hideOverlay, showOverlay } from '../systems/DomUi';

interface DoorEntry {
  actId: string;
  seq: number;
  name: string;
  implemented: boolean;
  obj: Phaser.GameObjects.Container;
  x: number;
}

export class HubScene extends Phaser.Scene {
  private meta!: ChapterMeta;
  private doors: DoorEntry[] = [];
  private cursor = 0;
  private camX = 0;
  private targetCamX = 0;
  private corridor!: Phaser.GameObjects.Container;
  private doorLabelEls: HTMLDivElement[] = [];

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

    const chapterId = data.chapterId ?? 'ch00';
    const meta = dataLoader.getChapterMeta(chapterId);
    if (!meta) {
      this.add.text(10, 10, `未知章节：${chapterId}`, { color: '#E85C4A' });
      return;
    }
    this.meta = meta;

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

    const startX = 64;
    const gap = 118;

    /** 每一幕对应的年代石柱年份 */
    const ACT_YEARS: Record<string, string> = {
      ch00_act1: '1840',
      ch00_act2: '1851',
    };

    all.forEach((a, i) => {
      const act = acts[i];
      const x = startX + i * gap;
      const y = 146;

      // 年代石柱
      this.corridor.add(
        this.add
          .rectangle(x, y + 26, 16, 48, PALETTE.plumMid)
          .setStrokeStyle(1, PALETTE.ink)
          .setOrigin(0.5),
      );

      // 节点门
      const doorColor = a.implemented ? PALETTE.redDark : PALETTE.plumDark;
      const door = this.add
        .rectangle(0, 0, 22, 34, doorColor)
        .setStrokeStyle(1, a.implemented ? PALETTE.star : PALETTE.ink)
        .setOrigin(0.5);

      const container = this.add.container(x, y, [door]);
      if (a.implemented) {
        container.setSize(40, 56).setInteractive(
          new Phaser.Geom.Rectangle(-20, -28, 40, 56),
          Phaser.Geom.Rectangle.Contains,
        );
        container.on('pointerdown', () => this.enter(i));
      }
      this.corridor.add(container);
      this.doors.push({
        actId: a.id,
        seq: i + 1,
        name: act?.name ?? '未开放',
        implemented: a.implemented,
        obj: container,
        x,
      });
    });

    // 长廊地面横线
    this.corridor.add(
      this.add.rectangle(VIEW_W / 2, 186, VIEW_W * 4, 2, PALETTE.plumMid, 0.6).setOrigin(0.5),
    );

    if (this.doors.length > 0) this.setCursor(0);

    // DOM 门标签（年份 + 章节名），随 corridor 横向滚动每帧更新
    this.doorLabelEls = [];
    all.forEach((a, i) => {
      const act = acts[i];
      const year = ACT_YEARS[a.id] ?? '—';
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:0;top:0;transform:translate(-50%,0);text-align:center;font:12px sans-serif;pointer-events:none;`;
      el.innerHTML = `<div style="color:${a.implemented ? '#F2EDE4' : '#6B6489'};font-size:13px;">${act ? `${i + 1}. ${act.name}` : `${i + 1}. 未开放`}</div><div style="color:#C2BCD1;font-size:11px;margin-top:30px;">${year}</div>`;
      const ui = document.querySelector('#dom-ui') as HTMLElement;
      ui.appendChild(el);
      this.doorLabelEls.push(el);
    });
    this.updateDoorLabels();
  }

  private buildTopBar(): void {
    const s = getSave();
    const stats = effectiveStats(s.player.level, s.knowledge.length, s.equipment, dataLoader.getBalance());

    this.add.rectangle(VIEW_W / 2, 12, VIEW_W, 24, PALETTE.ink, 0.86).setDepth(DEPTH.hud);

    const save = getSave();

    // ---- 底部四个入口：图鉴 / 装备 / 图谱 / 测验 ----
    const bar: { label: string; onClick: () => void; enabled: boolean; badge?: string }[] = [
      { label: '图鉴', onClick: () => this.scene.start('Codex'), enabled: true },
      { label: '装备', onClick: () => this.scene.start('Equipment'), enabled: true },
      { label: '图谱', onClick: () => this.scene.start('Graph'), enabled: true },
      {
        label: '测验',
        onClick: () => this.enterQuiz(),
        enabled: this.actsAllCleared(),
        badge: save.quiz[this.meta.id]?.passed ? '✓' : undefined,
      },
    ];
    bar.forEach((b, i) => {
      const x = 245 + i * 66;
      const y = VIEW_H - 12;
      const r = this.add
        .rectangle(x, y, 62, 16, b.enabled ? PALETTE.plumMid : PALETTE.plumDark, 0.92)
        .setStrokeStyle(1, b.enabled ? PALETTE.greyPlum : PALETTE.ink)
        .setDepth(DEPTH.hud + 1)
        .setInteractive({ useHandCursor: true });
      r.on('pointerdown', b.onClick);
    });

    // 顶栏文字走 DOM
    showOverlay(
      `<div style="position:absolute;left:8px;top:6px;font-size:13px;color:#F2EDE4;">${this.meta.name} · ${this.meta.period}</div>
       <div style="position:absolute;right:8px;top:6px;font-size:13px;color:#C2BCD1;text-align:right;">Lv${s.player.level}　HP ${stats.hp}　知识卡 ${s.knowledge.length}</div>
       <div style="position:absolute;left:8px;top:250px;font-size:12px;color:#6B6489;">← → 选幕　E 进入</div>
       <div style="position:absolute;left:214px;top:251px;font-size:12px;text-align:center;color:${bar[0].enabled ? '#F2EDE4' : '#6B6489'};width:62px;">图鉴</div>
       <div style="position:absolute;left:280px;top:251px;font-size:12px;text-align:center;color:${bar[1].enabled ? '#F2EDE4' : '#6B6489'};width:62px;">装备</div>
       <div style="position:absolute;left:346px;top:251px;font-size:12px;text-align:center;color:${bar[2].enabled ? '#F2EDE4' : '#6B6489'};width:62px;">图谱</div>
       <div style="position:absolute;left:412px;top:251px;font-size:12px;text-align:center;color:${bar[3].enabled ? '#F2EDE4' : '#6B6489'};width:62px;">测验${bar[3].badge ? ' ✓' : ''}</div>`,
    );

    this.buildDungeonPanel();
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

  /** 副本列表：左上角面板，未解锁的显示解锁条件 */
  private buildDungeonPanel(): void {
    const save = getSave();
    dataLoader
      .loadDungeons()
      .then((list) => {
        if (list.length === 0) return;
        const rowH = 16;
        const top = 54;
        const bottom = top + (list.length - 1) * rowH + 7;
        // 面板底板
        this.add
          .rectangle(88, (24 + bottom) / 2, 160, bottom - 24, PALETTE.ink, 0.8)
          .setStrokeStyle(1, PALETTE.greyPlum)
          .setDepth(DEPTH.hud);

        let rowsHtml = '';
        list.forEach((d, i) => {
          const y = top + i * rowH;
          const unlocked = dungeonUnlocked(save, d);
          const st = getDungeonState(save, d.id);
          const r = this.add
            .rectangle(84, y, 152, 14, unlocked ? PALETTE.plumMid : PALETTE.plumDark, 0.9)
            .setStrokeStyle(1, unlocked ? PALETTE.greyPlum : PALETTE.ink)
            .setDepth(DEPTH.hud + 1)
            .setInteractive({ useHandCursor: true });
          const label = unlocked ? `${d.name}　${st.clears} 次` : `${d.name}（未解锁）`;
          rowsHtml += `<div style="position:absolute;left:8px;top:${y - 7}px;width:152px;text-align:center;font-size:11px;color:${unlocked ? '#F2EDE4' : '#6B6489'};">${label}</div>`;
          r.on('pointerdown', () => {
            if (!unlocked) {
              emitToast(`通关「觉醒年代」第 ${this.actIndex(d.unlock_act) + 1} 幕后解锁`, 1600);
              return;
            }
            this.scene.start('Level', {
              actId: d.unlock_act || 'ch00_act1',
              chapterId: d.chapter_id,
              dungeonId: d.id,
            });
          });
        });

        // 追加副本面板文字到 overlay
        const ui = document.querySelector('#dom-ui #dom-overlay') as HTMLElement;
        if (ui) {
          ui.insertAdjacentHTML(
            'beforeend',
            `<div style="position:absolute;left:10px;top:28px;font-size:12px;color:#948DAB;">副本（可重复刷）</div>${rowsHtml}`,
          );
        }
      })
      .catch(() => {
        /* 副本表缺失时静默：不影响长廊主流程 */
      });
  }

  private actIndex(actId: string): number {
    return this.meta.acts.indexOf(actId);
  }

  private bindInput(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on('keydown-LEFT', () => this.moveCursor(-1));
    kb.on('keydown-A', () => this.moveCursor(-1));
    kb.on('keydown-RIGHT', () => this.moveCursor(1));
    kb.on('keydown-D', () => this.moveCursor(1));
    kb.on('keydown-E', () => this.enter(this.cursor));
    kb.on('keydown-ENTER', () => this.enter(this.cursor));
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
      door.setStrokeStyle(
        selected ? 2 : 1,
        selected ? PALETTE.star : d.implemented ? PALETTE.star : PALETTE.ink,
      );
      d.obj.setScale(selected ? 1.12 : 1);
    });
    const d = this.doors[i];
    if (!d) return;
    this.targetCamX = Phaser.Math.Clamp(d.x - VIEW_W / 2, 0, Math.max(0, this.doors.length * 118));
  }

  private enter(i: number): void {
    const d = this.doors[i];
    if (!d) return;
    const s = getSave();
    s.progress.chapter = this.meta.id;
    s.progress.act = d.actId;
    persist();
    this.scene.start('Level', { actId: d.actId, chapterId: this.meta.id, startNode: 0 });
  }

  private updateDoorLabels(): void {
    // door label 是 #dom-ui 的直接子元素，用 CSS 像素坐标 = 逻辑坐标 × 画布缩放比
    const scale = this.game.canvas.clientWidth / VIEW_W;
    this.doorLabelEls.forEach((el, i) => {
      const d = this.doors[i];
      if (!d) return;
      el.style.left = `${(d.x - this.camX) * scale}px`;
      el.style.top = `${120 * scale}px`;
    });
  }

  shutdown(): void {
    hideOverlay();
    this.doorLabelEls.forEach((el) => el.remove());
    this.doorLabelEls = [];
  }

  override update(_time: number, delta: number): void {
    // 长廊横向滚动（节点门较多时）
    if (Math.abs(this.camX - this.targetCamX) > 0.5) {
      this.camX = Phaser.Math.Linear(this.camX, this.targetCamX, Math.min(1, delta / 180));
      this.corridor.setX(-this.camX);
    }
    this.updateDoorLabels();
  }
}