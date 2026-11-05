/**
 * GraphScene —— 知识图谱（设计书 5.9.3 终章玩法）。
 *
 * 玩法：事件卡是节点，**知识卡里的 links 就是因果边**。
 * 玩家点击两个节点尝试连线；连对了画出线并计数，连错了给一句提示。
 *
 * 这个玩法不新增任何内容：越往后加章节、知识卡的 links 越多，这张图自动变大。
 */

import Phaser from 'phaser';
import { DEPTH, PALETTE, VIEW_H, VIEW_W } from '../core/constants';
import { dataLoader } from '../core/DataLoader';
import {
  attemptEdge,
  buildRequiredEdges,
  edgeKey,
  graphProgress,
  type GraphEdge,
} from '../core/graph';
import { getSave, persist } from './BootScene';
import { emitToast } from '../core/EventBus';
import type { EventCard } from '../core/types';
import { FONT_UI } from '../gfx/TextStyle';

interface NodeView {
  id: string;
  x: number;
  y: number;
  circle: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  year: Phaser.GameObjects.Text;
  collected: boolean;
}

export class GraphScene extends Phaser.Scene {
  private cards: EventCard[] = [];
  private nodes: NodeView[] = [];
  private edges: GraphEdge[] = [];
  private requiredKeys = new Set<string>();
  private accepted = new Set<string>();
  private selected: string | null = null;
  /** 事件在时间轴上的序号，用来区分「主线短边」与「跨年份远因果」 */
  private orderOf = new Map<string, number>();
  private lines!: Phaser.GameObjects.Graphics;
  private progressText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;

  constructor() {
    super('Graph');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(PALETTE.ink);
    void this.boot();
  }

  private async boot(): Promise<void> {
    const save = getSave();
    const chapterId = save.progress.chapter || 'ch00';
    const bundle = await dataLoader.loadChapter(chapterId);
    // 按日期排一次：图谱要顺着时间读，数据文件顺序错了也不至于乱
    this.cards = [...bundle.events].sort((a, b) => yearOf(a) - yearOf(b));
    this.orderOf = new Map(this.cards.map((c, i) => [c.id, i]));
    const knowledge = dataLoader.getKnowledge();
    const req = buildRequiredEdges(this.cards, knowledge);
    this.edges = req.edges;
    this.requiredKeys = req.keys;
    this.accepted = new Set((save.progress.graph ?? []).filter((k) => this.requiredKeys.has(k)));

    this.lines = this.add.graphics().setDepth(DEPTH.deco);
    this.buildHeader();
    this.layoutNodes();
    this.redraw();
    this.bindKeys();
  }

  private buildHeader(): void {
    this.add
      .text(14, 10, '知识图谱', {
        fontFamily: FONT_UI,
        fontSize: '13px',
        color: '#F2EDE4',
        fontStyle: 'bold',
      })
      .setDepth(DEPTH.hud);
    this.add
      .text(14, 26, '点两个事件，把它们之间的因果连起来', {
        fontFamily: FONT_UI,
        fontSize: '8.5px',
        color: '#6B6489',
      })
      .setDepth(DEPTH.hud);

    this.progressText = this.add
      .text(VIEW_W - 14, 12, '', {
        fontFamily: FONT_UI,
        fontSize: '11px',
        color: '#F0C419',
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH.hud);

    this.hintText = this.add
      .text(VIEW_W / 2, VIEW_H - 12, '已收集的事件才能连线。Esc 返回长廊。', {
        fontFamily: FONT_UI,
        fontSize: '9px',
        color: '#6B6489',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.hud);

    const back = this.add
      .rectangle(VIEW_W - 44, VIEW_H - 26, 72, 16, PALETTE.plumMid, 0.95)
      .setStrokeStyle(1, PALETTE.ink)
      .setDepth(DEPTH.hud + 1)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(VIEW_W - 44, VIEW_H - 26, '返回', {
        fontFamily: FONT_UI,
        fontSize: '9px',
        color: '#F2EDE4',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.hud + 2);
    back.on('pointerdown', () => this.back());
  }

  /**
   * 蛇形时间轴排布：一行 6 个，第一行从左到右，第二行从右到左。
   *
   * 为什么不用网格：网格会让「时间上紧挨着的两件事」跨一整行连线，
   * 玩家看到一团斜线，读不出「谁导致了谁」。蛇形之后，绝大多数因果边
   * 就是相邻的短横线或上下短竖线，长边只剩南京条约→金田起义那一条桥。
   */
  private layoutNodes(): void {
    const save = getSave();
    const collected = new Set(save.progress.events);
    const perRow = 6;
    const rows = Math.max(1, Math.ceil(this.cards.length / perRow));
    const marginX = 40;
    const spanW = VIEW_W - marginX * 2;
    const rowGap = rows > 1 ? Math.min(92, (VIEW_H - 130) / (rows - 1)) : 0;
    const baseY = rows > 1 ? 90 : 120;

    this.cards.forEach((ev, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, this.cards.length - row * perRow);
      const rawCol = i % perRow;
      const col = row % 2 === 0 ? rawCol : inRow - 1 - rawCol; // 偶数行正序，奇数行反序
      const step = inRow > 1 ? spanW / (inRow - 1) : 0;
      const x = inRow > 1 ? marginX + col * step : VIEW_W / 2;
      const y = baseY + row * rowGap;
      const got = collected.has(ev.id);

      const circle = this.add
        .circle(x, y, 10, got ? PALETTE.redDark : PALETTE.plumDark, 1)
        .setStrokeStyle(got ? 2 : 1, got ? PALETTE.star : PALETTE.ink)
        .setDepth(DEPTH.hud);
      // 触摸友好的命中区：半径比视觉大 6px
      const hit = this.add
        .zone(x, y, 32, 32)
        .setDepth(DEPTH.hud)
        .setInteractive(new Phaser.Geom.Circle(16, 16, 16), Phaser.Geom.Circle.Contains);
      hit.input!.cursor = got ? 'pointer' : 'default';
      if (got) hit.on('pointerdown', () => this.pickNode(ev.id));

      const year = this.add
        .text(x, y - 15, String(yearOf(ev)), {
          fontFamily: FONT_UI,
          fontSize: '7px',
          color: got ? '#8F87A8' : '#3C3757',
        })
        .setOrigin(0.5, 0.5)
        .setDepth(DEPTH.hud);
      const label = this.add
        .text(x, y + 14, wrapLabel(ev.title, 8), {
          fontFamily: FONT_UI,
          fontSize: '7.5px',
          color: got ? '#C2BCD1' : '#4A4468',
          align: 'center',
          lineSpacing: 1,
        })
        .setOrigin(0.5, 0)
        .setDepth(DEPTH.hud);

      this.nodes.push({ id: ev.id, x, y, circle, label, year, collected: got });
    });
  }

  private bindKeys(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on('keydown-ESC', () => this.back());
  }

  private nodeById(id: string): NodeView | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  /** 虚线：线宽 1 时用 noStroke 的短线段拼，比 strokeDashed 通用的做法更稳 */
  private dottedLine(x1: number, y1: number, x2: number, y2: number): void {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    const dash = 3;
    const gap = 4;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    this.lines.lineStyle(1, PALETTE.star, 0.3);
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(d + dash, len);
      this.lines.beginPath();
      this.lines.moveTo(x1 + ux * d, y1 + uy * d);
      this.lines.lineTo(x1 + ux * e, y1 + uy * e);
      this.lines.strokePath();
    }
    this.lines.lineStyle(1, PALETTE.star, 0.75);
  }

  private pickNode(id: string): void {
    if (!this.nodeById(id)?.collected) {
      emitToast('这件事你还没亲历过', 1100);
      return;
    }
    if (this.selected === null) {
      this.selected = id;
      this.hintText.setText('再点一个事件，完成这条连线（再点自己可取消）');
      this.redraw();
      return;
    }
    if (this.selected === id) {
      this.selected = null;
      this.hintText.setText('已取消选择');
      this.redraw();
      return;
    }

    const known = new Set(this.nodes.filter((n) => n.collected).map((n) => n.id));
    const result = attemptEdge({ keys: this.requiredKeys }, this.accepted, this.selected, id, known);
    switch (result) {
      case 'ok': {
        const key = edgeKey(this.selected, id);
        this.accepted.add(key);
        this.saveGraph();
        emitToast('连上了', 900);
        this.hintText.setText('继续连：这两件事在历史上确实有因果');
        break;
      }
      case 'duplicate':
        emitToast('这条线已经连过了', 1100);
        break;
      case 'invalid':
        emitToast('这两件事之间没有直接因果', 1300);
        this.hintText.setText('提示：顺着「一件事导致了下一件事」去找');
        break;
      default:
        break;
    }
    this.selected = null;
    this.redraw();
  }

  private saveGraph(): void {
    const save = getSave();
    save.progress.graph = [...this.accepted];
    persist();
  }

  private redraw(): void {
    this.lines.clear();

    // 已连成的边
    for (const e of this.edges) {
      const key = edgeKey(e.a, e.b);
      if (!this.accepted.has(key)) continue;
      const a = this.nodeById(e.a);
      const b = this.nodeById(e.b);
      if (!a || !b) continue;
      this.lines.lineStyle(1, PALETTE.star, 0.75);
      // 时间上相邻的因果画实线，跳过至少两件事的远距离因果画虚线并压暗：
      // 这样主线（一条从 1839 走到 1864 的链）自己浮出来，跨年份的背景因果退到后面
      const ia = this.orderOf.get(a.id) ?? 0;
      const ib = this.orderOf.get(b.id) ?? 0;
      if (Math.abs(ia - ib) >= 3) {
        this.dottedLine(a.x, a.y, b.x, b.y);
      } else {
        this.lines.beginPath();
        this.lines.moveTo(a.x, a.y);
        this.lines.lineTo(b.x, b.y);
        this.lines.strokePath();
      }
    }

    // 选中高亮
    for (const n of this.nodes) {
      const isSel = n.id === this.selected;
      n.circle.setScale(isSel ? 1.35 : 1);
      n.circle.setStrokeStyle(isSel ? 2 : n.collected ? 2 : 1, isSel ? PALETTE.redBright : n.collected ? PALETTE.star : PALETTE.ink);
    }

    const p = graphProgress(this.requiredKeys, this.accepted);
    this.progressText.setText(`${p.done} / ${p.total} 条因果`);

    if (p.complete) {
      const save = getSave();
      const key = 'graph_complete_ch00';
      if (!save.achievements.includes(key)) {
        save.achievements.push(key);
        persist();
      }
      this.hintText.setText('这张图连完了——1840 年以来的每一次失败与转向，都在同一条线上。');
      this.hintText.setColor('#F0C419');
    }
  }

  private back(): void {
    this.scene.start('Hub', { chapterId: getSave().progress.chapter || 'ch00' });
  }
}

/** 从事件卡的 date（如 "1839.6.3—25"、"1859"）里取年份，取不到就退回 0 */
function yearOf(ev: EventCard): number {
  const m = /(\d{4})/.exec(ev.date ?? '');
  return m ? Number(m[1]) : 0;
}

/** 中文没有空格，Phaser 的自动换行靠不住，这里按字数硬折成两行 */
function wrapLabel(text: string, per: number): string {
  if (text.length <= per) return text;
  const lines: string[] = [];
  for (let i = 0; i < text.length && lines.length < 2; i += per) {
    lines.push(text.slice(i, i + per));
  }
  if (text.length > per * 2) {
    lines[1] = lines[1].slice(0, Math.max(1, per - 1)) + '…';
  }
  return lines.join('\n');
}