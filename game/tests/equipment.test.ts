/**
 * 装备展示层的回归锁：品质配色唯一真值 + 换装推荐结论。
 *
 * 旧版三处界面各自硬编码品质色，紫装用 `#948DAB`（灰紫高光）冒充紫色；
 * 背包选中行还把整行刷成纸白，连「紫」字一起变色。这里锁住新规则：
 * UI 一律从 QUALITY_STYLE 派生，推荐结论一律从 gearAdvice 派生。
 */

import { describe, expect, it } from 'vitest';
import { gearAdvice, type GearVerdict } from '../src/core/balance';
import { PALETTE, QUALITY_COLORS, QUALITY_STYLE, qualityStyleOf } from '../src/core/constants';
import type { ItemInstance, Quality, Slot } from '../src/core/types';

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

function item(slot: Slot, stat: string, value: number, quality: Quality = 'white', enhance = 0): ItemInstance {
  return { uid: `${slot}-${stat}-${value}`, base_id: 'test', slot, quality, name: '测试装备', stat, value, enhance, affixes: [] };
}

describe('品质配色唯一真值', () => {
  it('紫装徽章底色是 QUALITY_COLORS.purple.base 的深紫，不是灰紫高光', () => {
    expect(QUALITY_STYLE.purple.chip).toBe(hex(QUALITY_COLORS.purple.base));
    expect(QUALITY_STYLE.purple.chip).toBe(hex(PALETTE.plumMid));
    expect(QUALITY_STYLE.purple.chip).not.toBe(hex(PALETTE.greyPlum));
  });

  it('紫装用亮紫描边 + 反色字，三档品质共用同一套结构', () => {
    for (const q of ['white', 'blue', 'purple'] as const) {
      const s = QUALITY_STYLE[q];
      expect(s.label).toBe(q === 'white' ? '白' : q === 'blue' ? '蓝' : '紫');
      expect(s.chip).toMatch(/^#[0-9A-F]{6}$/i);
      expect(s.chipText).toMatch(/^#[0-9A-F]{6}$/i);
      expect(s.edge).toMatch(/^#[0-9A-F]{6}$/i);
      expect(s.chip).not.toBe(s.chipText);
    }
    expect(QUALITY_STYLE.purple.edge).toBe(hex(QUALITY_COLORS.purple.hi));
    expect(QUALITY_STYLE.purple.text).toBe(hex(QUALITY_COLORS.purple.hi));
  });

  it('三档颜色的徽章底互不相同，未知品质回落白装', () => {
    const chips = ['white', 'blue', 'purple'].map((q) => qualityStyleOf(q).chip);
    expect(new Set(chips).size).toBe(3);
    expect(qualityStyleOf('legacy')).toBe(QUALITY_STYLE.white);
  });
});

describe('换装推荐结论', () => {
  const verdict = (candidate: ItemInstance, equipped: ItemInstance | null): GearVerdict =>
    gearAdvice(candidate, equipped ? { [candidate.slot]: equipped } : {}).verdict;

  it('全项提升标推荐，全项下降标不如', () => {
    expect(verdict(item('weapon', 'atk', 20), item('weapon', 'atk', 15))).toBe('recommended');
    expect(verdict(item('weapon', 'atk', 10), item('weapon', 'atk', 15))).toBe('worse');
  });

  it('有涨有跌标权衡，四项独立不相加抵消', () => {
    const equipped = item('body', 'def', 20);
    expect(verdict(item('body', 'atk', 10), equipped)).toBe('mixed');
    expect(verdict(item('body', 'def', 20), equipped)).toBe('even');
  });

  it('空槽换装算推荐', () => {
    expect(verdict(item('head', 'hp', 30), null)).toBe('recommended');
  });

  it('强化等级参与差值，+5 可以反超低强化装备', () => {
    const equipped = item('legs', 'spd', 10, 'blue', 0);
    expect(verdict(item('legs', 'spd', 9, 'purple', 5), equipped)).toBe('recommended');
    expect(verdict(item('legs', 'spd', 9, 'purple', 0), equipped)).toBe('worse');
  });

  it('结论自带可打印的短标与方向符', () => {
    const a = gearAdvice(item('weapon', 'atk', 20), { weapon: item('weapon', 'atk', 15) });
    expect(a.label).toBe('推荐');
    expect(a.icon).toBe('▲');
    expect(a.parts[0].text).toContain('+5');
  });
});
