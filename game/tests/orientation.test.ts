import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEPTH, DOM_Z } from '../src/core/constants';
import { isPortrait, planOrientation, toGameSpace, unrotateToLocal } from '../src/core/orientation';

describe('屏幕方向判定', () => {
  it('认得出竖屏与横屏', () => {
    expect(isPortrait({ width: 390, height: 844 })).toBe(true);
    expect(isPortrait({ width: 844, height: 390 })).toBe(false);
  });

  it('正方形不算竖屏', () => {
    expect(isPortrait({ width: 500, height: 500 })).toBe(false);
  });

  it('宽高为 0 或负数时不算竖屏（避免初始化瞬间误判成要旋转）', () => {
    expect(isPortrait({ width: 0, height: 0 })).toBe(false);
    expect(isPortrait({ width: 0, height: 844 })).toBe(false);
    expect(isPortrait({ width: 390, height: 0 })).toBe(false);
    expect(isPortrait({ width: -390, height: 844 })).toBe(false);
  });
});

describe('呈现方式决策', () => {
  it('本来横屏就不折腾', () => {
    expect(planOrientation({ width: 844, height: 390 }, false)).toBe('landscape');
    expect(planOrientation({ width: 844, height: 390 }, true)).toBe('landscape');
  });

  it('竖屏但锁横屏成功：交给系统转，不用 CSS 旋转', () => {
    expect(planOrientation({ width: 390, height: 844 }, true)).toBe('landscape');
  });

  it('竖屏且锁不上（iOS Safari 永远锁不上）：用 CSS 旋转兜底', () => {
    expect(planOrientation({ width: 390, height: 844 }, false)).toBe('rotate');
  });
});

describe('旋转兜底时的坐标反算', () => {
  const viewport = { width: 390, height: 844 };
  // 容器被撑成 844×390（宽=视口高），FIT 后画布 693×390，容器里左右各留 75.5；
  // 旋转后这 75.5 变成屏幕上的上下留白。
  const canvas = { width: 693, height: 390 };

  it('屏幕中心反算回画布中心', () => {
    const local = unrotateToLocal(195, 422, viewport, canvas);
    expect(local.u).toBeCloseTo(346.5, 5);
    expect(local.v).toBeCloseTo(195, 5);
  });

  it('触到画布四角正好是 (0,0) 与 (693,390)，不会被镜像翻转', () => {
    // 画布在屏幕上的四角：x 方向被旋转吃掉了，所以上下是 75.5 的黑边
    expect(unrotateToLocal(390, 75.5, viewport, canvas).u).toBeCloseTo(0, 5);
    expect(unrotateToLocal(390, 75.5, viewport, canvas).v).toBeCloseTo(0, 5);
    expect(unrotateToLocal(0, 768.5, viewport, canvas).u).toBeCloseTo(693, 5);
    expect(unrotateToLocal(0, 768.5, viewport, canvas).v).toBeCloseTo(390, 5);
  });

  it('黑边被扣掉：屏幕上的黑边区域会反算出负数（而不是被夹到边上）', () => {
    expect(unrotateToLocal(195, 0, viewport, canvas).u).toBeCloseTo(-75.5, 5);
    expect(unrotateToLocal(195, 844, viewport, canvas).u).toBeCloseTo(768.5, 5);
  });

  it('手指往右移，画面里的触点往下走（顺时针 90° 的对应关系）', () => {
    const a = unrotateToLocal(100, 400, viewport, canvas);
    const b = unrotateToLocal(200, 400, viewport, canvas);
    expect(b.v).toBeLessThan(a.v);
    // 手指往上移，画面里的触点往右走
    const c = unrotateToLocal(195, 300, viewport, canvas);
    const d = unrotateToLocal(195, 500, viewport, canvas);
    expect(d.u).toBeGreaterThan(c.u);
  });
});

describe('本地坐标 → 游戏坐标', () => {
  it('等比缩放到 480×270', () => {
    const local = { u: 346.5, v: 195 };
    const p = toGameSpace(local, { width: 693, height: 390 }, { width: 480, height: 270 });
    expect(p.x).toBeCloseTo(240, 1);
    expect(p.y).toBeCloseTo(135, 1);
  });

  it('画布尺寸为 0 时返回 0，不产生 NaN', () => {
    expect(toGameSpace({ u: 10, v: 10 }, { width: 0, height: 0 }, { width: 480, height: 270 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

/**
 * 界面层级（v2.9.3）——甲方截图里暂停面板下半截被对白底板盖住，
 * 「音效 / 返回主菜单」看不见也点不到。现在按用途固定顺序：
 * 世界 < 对白 < HUD/情境卡 < 暂停；暂停层自己吃点击与键盘，绝不穿透。
 */
describe('界面层级顺序（v2.9.3）', () => {
  const ROOT = process.cwd();
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const uiSrc = readFileSync(join(ROOT, 'src/scenes/UIScene.ts'), 'utf8');
  const domSrc = readFileSync(join(ROOT, 'src/systems/DomUi.ts'), 'utf8');

  it('DOM_Z 固定对白 < HUD/面板 < 暂停，暂停层吃事件', () => {
    expect(DOM_Z.dialogue).toBeLessThan(DOM_Z.hud);
    expect(DOM_Z.hud).toBeLessThan(DOM_Z.pause);
    expect(DOM_Z.pause).toBe(100);
    expect(html).toMatch(/id="dom-dialogue"[^>]*z-index:20/);
    expect(html).toMatch(/id="dom-hud"[^>]*z-index:30/);
    expect(html).toMatch(/id="dom-pause-screen"[^>]*pointer-events:auto/);
    expect(domSrc).toContain('pauseScreen.style.zIndex = String(DOM_Z.pause)');
    // hideOverlay() 清场景级 DOM 时不能把暂停容器连根删掉
    expect(domSrc).toContain(':not(#dom-pause-screen)');
  });

  it('canvas 里的暂停深度也高于其它覆盖层', () => {
    expect(DEPTH.pause).toBeGreaterThan(DEPTH.overlay);
    expect(uiSrc).toContain('DEPTH.pause + 3');
    expect(uiSrc).not.toContain('DEPTH.overlay + 3');
  });

  it('暂停的点击与键盘走同一条最上层入口，关闭时解绑', () => {
    expect(uiSrc).toContain('screen.onclick = (e) =>');
    expect(uiSrc).toContain("closest('[data-pause-action]')");
    expect(uiSrc).toContain("window.addEventListener('keydown', handler, true)");
    expect(uiSrc).toContain('e.stopImmediatePropagation()');
    expect(uiSrc).toContain('this.unbindPauseInput();');
    expect(uiSrc).toContain('hidePauseScreen()');
    // 对白整块收起再原样恢复，不在暂停时透出可辨认的字
    expect(uiSrc).toContain('if (this.dialogueHiddenByPause) hideDialogue()');
    expect(uiSrc).toContain('if (this.dialogueHiddenByPause) showDialogue()');
  });
});
