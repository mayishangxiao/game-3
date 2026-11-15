/**
 * 「像素中文字体」（设计书 4.9.2 方案 ②）的判定规则测试。
 *
 * 这套规则同时要满足两条互相矛盾的约束，所以必须钉死：
 *  - 设计书 4.9.2 要「标题 16px 像素字」；
 *  - 甲方 m01507 / m14676 要「文字不要像素感」「我只要清晰的文字」。
 * 分歧点其实是字号：小字点阵化后只剩两三条笔画，读不出来。规则 = 大字号 + 短文本。
 *
 * 渲染侧（`gfx/PixelFont.ts` 与实际像素效果）由 `tools/_cdp/pixel-font.mjs` 实拍验证，
 * 这里只管「哪些字该点阵化」这个可判定的部分。
 */
import { describe, expect, it } from 'vitest';
import {
  PIXEL_MAX_CHARS,
  PIXEL_MIN_SIZE,
  PIXEL_RESOLUTION,
  PIXEL_STROKE,
  PIXEL_STROKE_COLOR,
  parseFontSize,
  pixelTextStyle,
  shouldPixelate,
  snapFontSize,
} from '../src/core/pixelFont';

describe('字号解析', () => {
  it("认 '14px' / 14 / ' 14 px ' 三种写法", () => {
    expect(parseFontSize('14px')).toBe(14);
    expect(parseFontSize(14)).toBe(14);
    expect(parseFontSize(' 14 px ')).toBe(14);
    expect(parseFontSize('26.5px')).toBe(26.5);
  });

  it('读不出来的（em / 空 / NaN）一律 0，不猜', () => {
    expect(parseFontSize('1.2em')).toBe(0);
    expect(parseFontSize('')).toBe(0);
    expect(parseFontSize(undefined)).toBe(0);
    expect(parseFontSize(Number.NaN)).toBe(0);
  });
});

describe('该不该点阵化', () => {
  it('标题级短文本点阵化', () => {
    expect(shouldPixelate('26px', '党史像素 RPG')).toBe(true);
    expect(shouldPixelate('18px', '第一章 · 虎门销烟')).toBe(true);
    expect(shouldPixelate('20px', '城 破')).toBe(true);
  });

  it('小字一律不点阵化——这是甲方两次投诉的对象，别改回去', () => {
    // HUD / 正文 / 对白 / 提示 / 升级卡名 / 图鉴页标题都在 8–15px 这一段
    for (const size of ['8px', '9px', '9.5px', '10px', '11px', '12px', '13px', '14px', '15px']) {
      expect(shouldPixelate(size, '虎门销烟'), size).toBe(false);
    }
  });

  it('大字号但很长的段落也不点阵化（那是正文，不是标题）', () => {
    const long = '你扮演历史中的人，亲手把每一件大事都做一遍，然后看着它变成书上的几行字';
    expect([...long].length).toBeGreaterThan(PIXEL_MAX_CHARS);
    expect(shouldPixelate('16px', long)).toBe(false);
  });

  it('空文本不点阵化（还没有内容就没有风格可言）', () => {
    expect(shouldPixelate('26px', '')).toBe(false);
  });

  it('长度按码点算，扩展区汉字不会被算成两个字', () => {
    // 𠀀 是扩展 B 区的汉字，UTF-16 占两个码元
    const text = '𠀀'.repeat(PIXEL_MAX_CHARS);
    expect(text.length).toBe(PIXEL_MAX_CHARS * 2);
    expect(shouldPixelate('16px', text)).toBe(true);
  });

  it('边界：正好到门槛字号 / 正好到长度上限都算命中', () => {
    // 16 是设计书 4.9.2 写的「标题 16 px 像素字」，别随手改小
    expect(PIXEL_MIN_SIZE).toBe(16);
    expect(shouldPixelate(`${PIXEL_MIN_SIZE}px`, '虎门销烟')).toBe(true);
    expect(shouldPixelate(`${PIXEL_MIN_SIZE - 1}px`, '虎门销烟')).toBe(false);
    expect(shouldPixelate('16px', '烟'.repeat(PIXEL_MAX_CHARS))).toBe(true);
    expect(shouldPixelate('16px', '烟'.repeat(PIXEL_MAX_CHARS + 1))).toBe(false);
  });
});

describe('点阵字号取整', () => {
  it('小数取整（否则每行字高在 26/27 之间跳，放大后是歪的）', () => {
    expect(snapFontSize('26.5px')).toBe(27);
    expect(snapFontSize('26.4px')).toBe(26);
    expect(snapFontSize(16.4)).toBe(16);
  });

  it('低于下限的抬到下限，不画糊字', () => {
    expect(snapFontSize('10px')).toBe(PIXEL_MIN_SIZE);
    expect(snapFontSize(0)).toBe(PIXEL_MIN_SIZE);
  });
});

describe('点阵字样式', () => {
  it('分辨率必须是 1——这是「点阵」的开关，超采样就看不到方块了', () => {
    const s = pixelTextStyle('18px', '#F2EDE4');
    expect(s.resolution).toBe(PIXEL_RESOLUTION);
    expect(PIXEL_RESOLUTION).toBe(1);
    expect(s.fontSize).toBe('18px');
    expect(s.color).toBe('#F2EDE4');
    expect(s.strokeThickness).toBe(PIXEL_STROKE);
    expect(s.stroke).toBe(PIXEL_STROKE_COLOR);
  });

  it('描边色必须与文字色不同，否则描边等于没画', () => {
    const s = pixelTextStyle('18px', '#F2EDE4');
    expect(s.stroke.toUpperCase()).not.toBe(String(s.color).toUpperCase());
  });

  it('fontStyle 会带过去（标题多是 bold）', () => {
    expect(pixelTextStyle('18px', '#fff', { fontStyle: 'bold' }).fontStyle).toBe('bold');
    expect(pixelTextStyle('18px', '#fff').fontStyle).toBeUndefined();
  });

  it('不传颜色就不写 color，交给调用点（避免把人家设好的色刷掉）', () => {
    expect('color' in pixelTextStyle('18px')).toBe(false);
  });

  it('纯函数：两次调用拿到的是不同对象，改一个不影响另一个', () => {
    const a = pixelTextStyle('18px', '#fff');
    const b = pixelTextStyle('18px', '#fff');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    a.fontSize = '99px';
    expect(b.fontSize).toBe('18px');
  });
});
