/**
 * EquipmentScene —— 背包与装备（设计书 6.3 / 6.9.1）。
 *
 * 左：五槽位（武器/头盔/身体/腿部/饰品）
 * 右：背包列表（分页）
 * 下：零件数 + 对选中装备的操作（装备 / 拆解 / 强化）
 *
 * 这是副本刷取循环的出口：刷到的好装备要能换上去，不要的能拆成零件再强化。
 */

import Phaser from 'phaser';
import { DEPTH, HUD_H, PALETTE, VIEW_H, VIEW_W } from '../core/constants';
import {
  compareWithEquipped,
  enhanceCost,
  enhancedValue,
  enhanceGain,
  firstGainfulEnhance,
  formatStatDelta,
  salvageValue,
} from '../core/balance';
import { slotProgress, type SlotProgressInfo } from '../core/SaveManager';
import { dataLoader } from '../core/DataLoader';
import { getSave, persist } from './BootScene';
import type { ItemInstance, Slot } from '../core/types';
import { FONT_UI } from '../gfx/TextStyle';
import { hideOverlay } from '../systems/DomUi';

const SLOT_NAMES: { key: Slot; label: string }[] = [
  { key: 'weapon', label: '武器' },
  { key: 'head', label: '头盔' },
  { key: 'body', label: '身体' },
  { key: 'legs', label: '腿部' },
  { key: 'accessory', label: '饰品' },
];

const PAGE_SIZE = 12;

function qualityColor(q: string): string {
  return q === 'purple' ? '#948DAB' : q === 'blue' ? '#7FB2D9' : '#C2BCD1';
}
function qualityLabel(q: string): string {
  return q === 'purple' ? '紫' : q === 'blue' ? '蓝' : '白';
}

/** 左列第二行：这一槽位「已有最高品质 / 还差什么」 */
function progressText(p: SlotProgressInfo): string {
  if (p.best === null) return `${qualityLabel(p.target)}：未获得`;
  if (p.reached) return `最高：${qualityLabel(p.best)}　已达目标`;
  return `最高：${qualityLabel(p.best)}　目标：${qualityLabel(p.target)}`;
}

/**
 * 选中装备时常驻的强化预测。
 * 收益为 0 时明确告诉玩家「下一档哪一等级才涨」，而不是让他花掉零件后自己发现数字没动。
 */
function enhanceHint(item: ItemInstance): string {
  if (item.enhance >= 5) return `${item.name} 已强化到 +5（上限）`;
  const gain = enhanceGain(item);
  const now = enhancedValue(item);
  if (gain > 0) return `下次强化：${item.stat.toUpperCase()} ${now}→${now + gain}，需 ${enhanceCost(item.enhance)} 零件`;
  const next = firstGainfulEnhance(item);
  return next === null
    ? `${item.name} 到 +5 也不会提升主属性`
    : `本次强化无提升，强化到 +${next} 才有提升`;
}

export class EquipmentScene extends Phaser.Scene {
  private cursor = 0;
  private page = 0;
  /** 非空表示当前选中的是「已装备」的那件，而不是背包里的 */
  private equipSel: Slot | null = null;
  private root!: Phaser.GameObjects.Container;
  private message = '';

  constructor() {
    super('Equipment');
  }

  create(): void {
    hideOverlay();
    this.cursor = 0;
    this.page = 0;
    this.equipSel = null;
    this.message = '';
    this.root = this.add.container(0, 0).setDepth(DEPTH.hud);
    this.cameras.main.setBackgroundColor(PALETTE.night);
    this.bindKeys();
    this.render();
  }

  private items(): ItemInstance[] {
    return getSave().bag.items;
  }

  private bindKeys(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on('keydown-UP', () => this.move(-1));
    kb.on('keydown-DOWN', () => this.move(1));
    kb.on('keydown-W', () => this.move(-1));
    kb.on('keydown-S', () => this.move(1));
    kb.on('keydown-E', () => this.equipSelected());
    kb.on('keydown-ENTER', () => this.equipSelected());
    kb.on('keydown-X', () => this.salvageSelected());
    kb.on('keydown-R', () => this.enhanceSelected());
    kb.on('keydown-ESC', () => this.back());
  }

  private move(delta: number): void {
    const n = this.items().length;
    if (n === 0) return;
    this.equipSel = null;
    this.cursor = (this.cursor + delta + n) % n;
    this.page = Math.floor(this.cursor / PAGE_SIZE);
    this.render();
  }

  /* ==================== 操作 ==================== */

  private selected(): ItemInstance | null {
    if (this.equipSel) return getSave().equipment[this.equipSel] ?? null;
    return this.items()[this.cursor] ?? null;
  }

  private equipSelected(): void {
    const save = getSave();
    // 选中的是已装备的那件 → 这一键变成「卸下」
    if (this.equipSel) {
      const slotItem = save.equipment[this.equipSel] ?? null;
      if (!slotItem) return;
      if (save.bag.items.length >= save.bag.slots) {
        this.message = '背包满了，先拆几件再卸下';
        this.render();
        return;
      }
      save.bag.items.push(slotItem);
      save.equipment[this.equipSel] = null;
      this.message = `卸下 ${slotItem.name}`;
      this.equipSel = null;
      this.cursor = Math.max(0, save.bag.items.length - 1);
      this.page = Math.floor(this.cursor / PAGE_SIZE);
      persist();
      this.render();
      return;
    }
    const item = this.selected();
    if (!item) return;
    const prev = save.equipment[item.slot] ?? null;
    // 换装前先算差值：装备写进去之后就只剩「已装备 XX」，玩家无从判断这次换得值不值
    const delta = compareWithEquipped(item, save.equipment);
    save.equipment[item.slot] = item;
    // 从背包移除，旧装备放回背包
    save.bag.items = save.bag.items.filter((i) => i.uid !== item.uid);
    if (prev) save.bag.items.push(prev);
    this.cursor = Math.min(this.cursor, Math.max(0, save.bag.items.length - 1));
    this.page = Math.floor(this.cursor / PAGE_SIZE);
    this.message = `已装备 ${item.name}　${formatStatDelta(delta)}`;
    persist();
    this.render();
  }

  private salvageSelected(): void {
    const save = getSave();
    if (this.equipSel) {
      this.message = '已装备的东西先卸下，才能拆解';
      this.render();
      return;
    }
    const item = this.selected();
    if (!item) return;
    const gain = salvageValue(item.quality);
    save.bag.items = save.bag.items.filter((i) => i.uid !== item.uid);
    save.scrap += gain;
    this.cursor = Math.min(this.cursor, Math.max(0, save.bag.items.length - 1));
    this.page = Math.floor(this.cursor / PAGE_SIZE);
    this.message = `拆解 ${item.name}，获得 ${gain} 零件`;
    persist();
    this.render();
  }

  private enhanceSelected(): void {
    const save = getSave();
    const equipped = save.equipment;
    // 优先强化背包里选中的那件；若该槽位已装备同名则强化装备
    const item = this.selected();
    if (!item) return;
    if (item.enhance >= 5) {
      this.message = `${item.name} 已经 +5，到顶了`;
      this.render();
      return;
    }
    const cost = enhanceCost(item.enhance);
    // 取整归零档：按钮已禁用，键盘 R 也要拦住，绝不让玩家花 20 零件换一个「什么都没变」
    const gain = enhanceGain(item);
    if (gain <= 0) {
      this.message = enhanceHint(item);
      this.render();
      return;
    }
    if (save.scrap < cost) {
      this.message = `零件不够：需要 ${cost}，现有 ${save.scrap}`;
      this.render();
      return;
    }
    const before = enhancedValue(item);
    save.scrap -= cost;
    item.enhance += 1;
    // 如果这件正装备着，同步
    const slotItem = equipped[item.slot];
    if (slotItem && slotItem.uid === item.uid) slotItem.enhance = item.enhance;
    this.message = `${item.name} 强化到 +${item.enhance}　${item.stat.toUpperCase()} ${before}→${before + gain}，消耗 ${cost} 零件`;
    persist();
    this.render();
  }

  private back(): void {
    this.scene.start('Hub', { chapterId: getSave().progress.chapter || 'ch00' });
  }

  /* ==================== 渲染 ==================== */

  private clear(): void {
    this.root.removeAll(true);
  }

  private render(): void {
    this.clear();
    const save = getSave();
    const c = this.root;
    // 模板表由 BootScene 预载；万一没拿到，slotProgress 会把目标品质兜底为紫，不会崩
    const progress = slotProgress(save, dataLoader.getItems());

    c.add(
      this.add
        .rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W - 8, VIEW_H - 8, PALETTE.ink, 0.95)
        .setStrokeStyle(1, PALETTE.greyPlum),
    );
    c.add(
      this.add.text(14, 10, '装备与背包', {
        fontFamily: FONT_UI,
        fontSize: '13px',
        color: '#F2EDE4',
        fontStyle: 'bold',
      }),
    );
    c.add(
      this.add
        .text(VIEW_W - 14, 12, `零件 ${save.scrap}`, {
          fontFamily: FONT_UI,
          fontSize: '11px',
          color: '#F0C419',
        })
        .setOrigin(1, 0),
    );

    // ---- 左：五槽位 ----
    c.add(
      this.add.text(14, 32, '已装备', { fontFamily: FONT_UI, fontSize: '9px', color: '#948DAB' }),
    );
    SLOT_NAMES.forEach((s, i) => {
      const y = 48 + i * 30;
      const it = save.equipment[s.key] ?? null;
      const picked = this.equipSel === s.key;
      // 触屏上没法用方向键选槽位，所以每一行都要能点
      c.add(
        this.add
          .rectangle(14 + 92, y + 8, 184, 26, picked ? PALETTE.plumMid : PALETTE.plumDark, 0.9)
          .setStrokeStyle(1, picked ? PALETTE.star : PALETTE.ink)
          .setOrigin(0.5, 0.5)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => {
            this.equipSel = s.key;
            this.message = it ? `选中已装备的 ${it.name}` : `${s.label}还没有装备`;
            this.render();
          }),
      );
      c.add(
        this.add.text(20, y, s.label, {
          fontFamily: FONT_UI,
          fontSize: '10px',
          color: '#C2BCD1',
        }),
      );
      if (it) {
        const v = enhancedValue(it);
        c.add(
          this.add.text(58, y, `${it.name}${it.enhance > 0 ? ` +${it.enhance}` : ''}`, {
            fontFamily: FONT_UI,
            fontSize: '9.5px',
            color: qualityColor(it.quality),
          }),
        );
        c.add(
          this.add
            .text(190, y, `${it.stat.toUpperCase()} ${v}`, {
              fontFamily: FONT_UI,
              fontSize: '9px',
              color: '#F0C419',
            })
            .setOrigin(1, 0),
        );
      } else {
        c.add(
          this.add.text(58, y, '（空）', { fontFamily: FONT_UI, fontSize: '9.5px', color: '#6B6489' }),
        );
      }
      // 每行第二行：这一槽位已经摸到的最高品质与可达成的目标，给出「还差什么」
      const p = progress[s.key];
      c.add(
        this.add.text(58, y + 13, progressText(p), {
          fontFamily: FONT_UI,
          fontSize: '8px',
          color: p.reached ? '#7EC08A' : '#6B6489',
        }),
      );
    });

    // ---- 右：背包列表 ----
    const items = this.items();
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    this.page = Math.min(this.page, totalPages - 1);
    c.add(
      this.add.text(226, 32, `背包 ${items.length} / ${save.bag.slots}`, {
        fontFamily: FONT_UI,
        fontSize: '9px',
        color: '#948DAB',
      }),
    );

    if (items.length === 0) {
      c.add(
        this.add.text(226, 56, '背包是空的。\n去副本里刷点装备。', {
          fontFamily: FONT_UI,
          fontSize: '10px',
          color: '#6B6489',
          lineSpacing: 4,
        }),
      );
    }

    const start = this.page * PAGE_SIZE;
    items.slice(start, start + PAGE_SIZE).forEach((it, i) => {
      const idx = start + i;
      const y = 48 + i * 14;
      const active = !this.equipSel && idx === this.cursor;
      if (active) {
        c.add(
          this.add
            .rectangle(226 + 120, y + 6, 240, 13, PALETTE.plumMid, 1)
            .setStrokeStyle(1, PALETTE.star)
            .setOrigin(0.5),
        );
      }
      // 触屏选中：整行可点，点一下选中、再点底部按钮操作
      c.add(
        this.add
          .rectangle(226 + 120, y + 6, 240, 14, PALETTE.night, 0.001)
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => {
            this.equipSel = null;
            this.cursor = idx;
            this.message = `选中 ${it.name}`;
            this.render();
          }),
      );
      const affix = it.affixes.length > 0 ? ` ·${it.affixes.length}词` : '';
      c.add(
        this.add.text(228, y, `${qualityLabel(it.quality)} ${it.name}${it.enhance > 0 ? `+${it.enhance}` : ''}${affix}`, {
          fontFamily: FONT_UI,
          fontSize: '9px',
          color: active ? '#F2EDE4' : qualityColor(it.quality),
        }),
      );
      c.add(
        this.add
          .text(462, y, `${it.stat.toUpperCase()} ${enhancedValue(it)}`, {
            fontFamily: FONT_UI,
            fontSize: '9px',
            color: '#C2BCD1',
          })
          .setOrigin(1, 0),
      );
    });

    // ---- 左下：选中装备的详情（顺便填上左列下方那片空白）----
    const det = this.selected();
    const dx = 14;
    const dy = 198;
    c.add(
      this.add
        .rectangle(dx + 92, dy + 26, 184, 52, PALETTE.plumDark, 0.55)
        .setStrokeStyle(1, PALETTE.ink)
        .setOrigin(0.5),
    );
    if (det) {
      const slotLabel = SLOT_NAMES.find((s) => s.key === det.slot)?.label ?? det.slot;
      c.add(
        this.add.text(
          dx + 6,
          dy,
          `${qualityLabel(det.quality)} ${det.name}${det.enhance > 0 ? ` +${det.enhance}` : ''}`,
          {
            fontFamily: FONT_UI,
            fontSize: '10px',
            color: qualityColor(det.quality),
          },
        ),
      );
      c.add(
        this.add.text(
          dx + 6,
          dy + 13,
          `${slotLabel}　${det.stat.toUpperCase()} ${enhancedValue(det)}（基础 ${det.value}）`,
          {
            fontFamily: FONT_UI,
            fontSize: '9px',
            color: '#C2BCD1',
          },
        ),
      );
      if (det.affixes.length > 0) {
        c.add(
          this.add.text(dx + 6, dy + 26, det.affixes.map((a) => `${a.id} +${a.value}`).join('　'), {
            fontFamily: FONT_UI,
            fontSize: '8.5px',
            color: '#948DAB',
            wordWrap: { width: 172 },
            lineSpacing: 2,
          }),
        );
      } else {
        c.add(
          this.add.text(dx + 6, dy + 26, this.equipSel ? '正装备着（卸下后才可拆解）' : '没有随机词条', {
            fontFamily: FONT_UI,
            fontSize: '8.5px',
            color: '#6B6489',
          }),
        );
      }
    }

    if (totalPages > 1) {
      // 页码挪到「背包 N / 60」同一行的右端：底部那片空白要让给常驻消息，
      // 否则消息 / 页码 / 详情框三样东西挤在 y≈226 一带互相盖字。
      c.add(
        this.add
          .text(466, 32, `第 ${this.page + 1} / ${totalPages} 页`, {
            fontFamily: FONT_UI,
            fontSize: '8.5px',
            color: '#6B6489',
          })
          .setOrigin(1, 0),
      );
    }

    // ---- 底部操作 ----
    const sel = this.selected();
    const cost = sel ? enhanceCost(sel.enhance) : 0;
    const gain = sel ? enhanceGain(sel) : 0;
    const enhanceLabel = sel
      ? `强化 R (${cost}) → ${sel.stat.toUpperCase()} ${enhancedValue(sel)}→${enhancedValue(sel) + gain}`
      : '强化 R';
    // 没有操作消息时，这行常驻显示「这次强化到底涨几点」；收益为 0 会直接说明要等到哪一档
    const hint = sel ? enhanceHint(sel) : '';
    // 消息放右列底部空白（左列 y=198..250 是详情框，原来的 x=14 会压在详情文字上）。
    // 常驻强化提示上线后这行几乎一直有内容，重叠就从偶发变成了常态。
    c.add(
      this.add.text(226, VIEW_H - HUD_H - 38, this.message || hint, {
        fontFamily: FONT_UI,
        fontSize: '9.5px',
        color: gain === 0 && sel ? '#948DAB' : '#F0C419',
        wordWrap: { width: 240 },
      }),
    );

    // 选中已装备的那件时，第一键变成「卸下」，拆解先禁用
    this.button(
      46,
      VIEW_H - 14,
      76,
      16,
      this.equipSel ? '卸下 E' : '装备 E',
      () => this.equipSelected(),
      !!sel,
      true,
    );
    this.button(
      132,
      VIEW_H - 14,
      76,
      16,
      '拆解 X',
      () => this.salvageSelected(),
      !!sel && !this.equipSel,
    );
    // 收益为 0 直接禁用（键盘 R 在 enhanceSelected 里同样拦截）
    this.button(232, VIEW_H - 14, 124, 16, enhanceLabel, () => this.enhanceSelected(), !!sel && gain > 0, true);
    this.button(VIEW_W - 46, VIEW_H - 14, 76, 16, '返回 Esc', () => this.back(), true);
  }

  private button(
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    onClick: () => void,
    enabled: boolean,
    accent = false,
  ): void {
    const r = this.add
      .rectangle(x, y, w, h, enabled ? (accent ? PALETTE.redDark : PALETTE.plumMid) : PALETTE.plumDark, 0.95)
      .setStrokeStyle(1, PALETTE.ink);
    const t = this.add
      .text(x, y, text, {
        fontFamily: FONT_UI,
        fontSize: '9px',
        color: enabled ? '#F2EDE4' : '#6B6489',
      })
      .setOrigin(0.5);
    this.root.add(r);
    this.root.add(t);
    if (enabled) {
      r.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
      t.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    }
  }
}