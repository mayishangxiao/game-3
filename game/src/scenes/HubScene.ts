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
import { FONT_UI } from '../gfx/TextStyle';

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
    // 远景随进度变化：序章前六幕灰暗，这里先用统一灰调
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
    const planned = this.meta.acts_planned ?? [];
    const all = [
      ...this.meta.acts.map((a) => ({ id: a, implemented: true })),
      ...planned.map((a) => ({ id: a, implemented: false })),
    ];

    const acts: (ActDef | null)[] = await Promise.all(
      all.map(async (a) => {
        if (!a.implemented) return null;
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
      ch00_act3: '1861',
      ch00_act4: '1895',
      ch00_act5: '1911',
      ch00_act6: '1915',
      ch00_act7: '1919',
    };

    all.forEach((a, i) => {
      const act = acts[i];
      const x = startX + i * gap;
      const y = 146;

      // 年代石柱
      const year = ACT_YEARS[a.id] ?? '—';
      this.corridor.add(
        this.add
          .rectangle(x, y + 26, 16, 48, PALETTE.plumMid)
          .setStrokeStyle(1, PALETTE.ink)
          .setOrigin(0.5),
      );
      this.corridor.add(
        this.add
          .text(x, y + 26, year, {
            fontFamily: FONT_UI,
            fontSize: '8px',
            color: '#C2BCD1',
            align: 'center',
          })
          .setOrigin(0.5)
          .setAngle(0),
      );

      // 节点门
      const doorColor = a.implemented ? PALETTE.redDark : PALETTE.plumDark;
      const door = this.add
        .rectangle(0, 0, 22, 34, doorColor)
        .setStrokeStyle(1, a.implemented ? PALETTE.star : PALETTE.ink)
        .setOrigin(0.5);
      const label = this.add
        .text(0, -26, act ? `${i + 1}. ${act.name}` : `${i + 1}. 未开放`, {
          fontFamily: FONT_UI,
          fontSize: '9px',
          color: a.implemented ? '#F2EDE4' : '#6B6489',
        })
        .setOrigin(0.5);

      const container = this.add.container(x, y, [door, label]);
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
  }

  private buildTopBar(): void {
    const s = getSave();
    const stats = effectiveStats(s.player.level, s.knowledge.length, s.equipment, dataLoader.getBalance());

    this.add.rectangle(VIEW_W / 2, 12, VIEW_W, 24, PALETTE.ink, 0.86).setDepth(DEPTH.hud);
    this.add
      .text(8, 12, `${this.meta.name} · ${this.meta.period}`, {
        fontFamily: FONT_UI,
        fontSize: '10px',
        color: '#F2EDE4',
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.hud + 1);
    this.add
      .text(
        VIEW_W - 8,
        12,
        `Lv${s.player.level}　HP ${stats.hp}　知识卡 ${s.knowledge.length}`,
        { fontFamily: FONT_UI, fontSize: '10px', color: '#C2BCD1' },
      )
      .setOrigin(1, 0.5)
      .setDepth(DEPTH.hud + 1);

    this.add
      .text(8, VIEW_H - 12, '← → 选幕　E 进入', {
        fontFamily: FONT_UI,
        fontSize: '9px',
        color: '#6B6489',
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.hud + 1);

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
      this.add
        .text(x, y, b.badge ? `${b.label} ${b.badge}` : b.label, {
          fontFamily: FONT_UI,
          fontSize: '9px',
          color: b.enabled ? '#F2EDE4' : '#6B6489',
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.hud + 2);
      r.on('pointerdown', b.onClick);
    });

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
        // 面板底板：没有它，白字直接压在长廊地板上，看不清
        this.add
          .rectangle(88, (24 + bottom) / 2, 160, bottom - 24, PALETTE.ink, 0.8)
          .setStrokeStyle(1, PALETTE.greyPlum)
          .setDepth(DEPTH.hud);
        this.add
          .text(10, 30, '副本（可重复刷）', {
            fontFamily: FONT_UI,
            fontSize: '9px',
            color: '#948DAB',
          })
          .setOrigin(0, 0)
          .setDepth(DEPTH.hud + 1);

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
          this.add
            .text(84, y, label, {
              fontFamily: FONT_UI,
              fontSize: '8px',
              color: unlocked ? '#F2EDE4' : '#6B6489',
            })
            .setOrigin(0.5)
            .setDepth(DEPTH.hud + 2);
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
    if (!d.implemented) {
      emitToast('这一幕尚未开放（见设计书第五章）', 1400);
      return;
    }
    const s = getSave();
    s.progress.chapter = this.meta.id;
    s.progress.act = d.actId;
    persist();
    this.scene.start('Level', { actId: d.actId, chapterId: this.meta.id, startNode: 0 });
  }

  override update(_time: number, delta: number): void {
    // 长廊横向滚动（节点门较多时）
    if (Math.abs(this.camX - this.targetCamX) > 0.5) {
      this.camX = Phaser.Math.Linear(this.camX, this.targetCamX, Math.min(1, delta / 180));
      this.corridor.setX(-this.camX);
    }
  }
}