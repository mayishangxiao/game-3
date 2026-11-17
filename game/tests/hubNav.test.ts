/**
 * 长廊选幕的几何（v2.9.7 手机端）。
 *
 * 手机上没有方向键：滑动换画面、松手吸附、点门选中，全走 `core/hubNav.ts`。
 * 这几个函数错了，表现是「滑到头了还继续滑」「松手跳错幕」「点门没反应」，
 * 在真机上很难复现，所以锁在这里。
 */

import { describe, expect, it } from 'vitest';
import { camForX, doorAtPoint, dragCam, isSwipe, maxCamX, nearestDoorIndex } from '../src/core/hubNav';

const VIEW_W = 480;
// 五幕：110 / 228 / 346 / 464 / 582（与 HubScene 的 START_X + i*DOOR_GAP 一致）
const XS = [110, 228, 346, 464, 582];

describe('maxCamX', () => {
  it('没有门时不能滚动', () => {
    expect(maxCamX([], VIEW_W)).toBe(0);
  });

  it('把最后一幕推到正中就到底，不会露出右侧空白', () => {
    expect(maxCamX(XS, VIEW_W)).toBe(582 - 240);
  });

  it('门少到一屏放得下时不滚动', () => {
    expect(maxCamX([100, 200], VIEW_W)).toBe(0);
  });
});

describe('camForX', () => {
  it('居中第一幕时夹在 0（否则左边会露白）', () => {
    expect(camForX(110, VIEW_W, 342)).toBe(0);
  });

  it('居中最后一幕时正好等于上限', () => {
    expect(camForX(582, VIEW_W, 342)).toBe(342);
  });

  it('中间幕按像素居中', () => {
    expect(camForX(346, VIEW_W, 342)).toBe(106);
  });
});

describe('dragCam', () => {
  it('手指往左滑（dx<0）= 看右边 = 相机右移', () => {
    expect(dragCam(0, -60, 342)).toBe(60);
  });

  it('手指往右滑相机左移，并在 0 处夹住', () => {
    expect(dragCam(100, 60, 342)).toBe(40);
    expect(dragCam(20, 200, 342)).toBe(0);
  });

  it('滑过头停在最大位移，不会越界', () => {
    expect(dragCam(300, -500, 342)).toBe(342);
  });

  it('不可滚动时怎么拖都回到 0', () => {
    expect(dragCam(0, -120, 0)).toBe(0);
  });
});

describe('nearestDoorIndex', () => {
  it('取画面正中最近的一幕', () => {
    expect(nearestDoorIndex(XS, 0, VIEW_W)).toBe(1); // 中心 240，228 更近
    expect(nearestDoorIndex(XS, 106, VIEW_W)).toBe(2); // 中心 346
  });

  it('滚到最右端时吸附最后一幕', () => {
    expect(nearestDoorIndex(XS, 342, VIEW_W)).toBe(4);
  });

  it('没有门时回 0，不抛异常', () => {
    expect(nearestDoorIndex([], 0, VIEW_W)).toBe(0);
  });
});

describe('doorAtPoint', () => {
  it('点在门上选中它', () => {
    expect(doorAtPoint(XS, 346)).toBe(2);
    expect(doorAtPoint(XS, 350)).toBe(2);
  });

  it('取容差内最近的那一幕', () => {
    expect(doorAtPoint(XS, 236)).toBe(1);
    expect(doorAtPoint(XS, 330)).toBe(2);
  });

  it('点空白处不选（避免整屏乱点都跳幕）', () => {
    expect(doorAtPoint(XS, 10)).toBe(-1);
    expect(doorAtPoint(XS, 900)).toBe(-1);
  });

  it('容差可以收紧', () => {
    expect(doorAtPoint(XS, 286, 30)).toBe(-1);
  });
});

describe('isSwipe', () => {
  it('手指轻点的抖动（2~4px）不算滑动', () => {
    expect(isSwipe(3, 1)).toBe(false);
    expect(isSwipe(-4, 2)).toBe(false);
  });

  it('横向 6px 以上算滑动', () => {
    expect(isSwipe(7, 1)).toBe(true);
    expect(isSwipe(-30, 4)).toBe(true);
  });

  it('纵向手势不算横滑（那是别的操作，不抢）', () => {
    expect(isSwipe(8, 40)).toBe(false);
  });
});
