/**
 * 长廊选幕的纯几何：滑动换相机、松手吸附到最近一幕、点选命中。
 *
 * 为什么单独抽出来：手机端的三件事（滑动、点选、确认）全靠这几个函数，
 * 场景里只剩「画」和「派发事件」。抽成纯函数后才能进 node 测试
 * （`tests/hubNav.test.ts`），不用起 Phaser。
 */

/** 相机最多能往右推多远：把最后一幕推到正中间就够，再多会露出空白。 */
export function maxCamX(doorXs: number[], viewW: number): number {
  if (doorXs.length === 0) return 0;
  return Math.max(0, Math.max(...doorXs) - viewW / 2);
}

/** 让某一幕落在画面正中所需的相机位置（夹在 0..maxCam）。 */
export function camForX(x: number, viewW: number, maxCam: number): number {
  const raw = x - viewW / 2;
  return Math.min(Math.max(raw, 0), Math.max(0, maxCam));
}

/**
 * 拖动时的相机位置。手指往左滑（dx < 0）＝ 想看右边的内容 ＝ 相机右移。
 * 这里直接返回绝对值而不是增量：每帧都用「按下时的相机 + 总位移」算，
 * 不会因为丢帧累积误差。
 */
export function dragCam(startCam: number, dx: number, maxCam: number): number {
  return Math.min(Math.max(startCam - dx, 0), Math.max(0, maxCam));
}

/** 松手后吸附：取画面正中最近的那一幕。 */
export function nearestDoorIndex(doorXs: number[], camX: number, viewW: number): number {
  if (doorXs.length === 0) return 0;
  const center = camX + viewW / 2;
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  doorXs.forEach((x, i) => {
    const d = Math.abs(x - center);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * 点选命中：返回容差内最近的一幕，都不在范围内返回 -1。
 * 容差给得比门宽大不少（门只有 22px 宽），否则手机上很难点中。
 */
export function doorAtPoint(doorXs: number[], worldX: number, tolerance = 58): number {
  let best = -1;
  let bestD = tolerance;
  doorXs.forEach((x, i) => {
    const d = Math.abs(x - worldX);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * 这次按下到抬起算拖动还是点击？
 * 阈值 6px：手指轻点时的抖动通常在 2~4px，横向明显大于纵向才算横滑。
 */
export function isSwipe(dx: number, dy: number, threshold = 6): boolean {
  return Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 0.6;
}
