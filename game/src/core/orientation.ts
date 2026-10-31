/**
 * 屏幕方向判定与坐标换算（纯函数，无 DOM、无 Phaser，便于单测）。
 *
 * 场景：手机浏览器不一定允许 `screen.orientation.lock('landscape')`
 * （iOS Safari 完全不支持），于是「点击开始」后要判断：
 *   - 真横屏 → 什么都不用做；
 *   - 锁屏成功 → 视口自己会转成横屏，等一下就好；
 *   - 都不行 → 用 CSS 把整个容器旋转 90°，画面自己横过来铺满屏幕；
 *   - 关掉了自动转屏（`?norot=1`）→ 只弹「请把手机横过来」的提示。
 * 第三种情况下触摸坐标是转着的，必须用 unrotateToLocal 反算，否则点哪都不对。
 *
 * 「点一下屏幕就横」的具体策略在 systems/OrientationGate.ts：点下去立刻要求横屏，
 * 锁得动就交给系统转，锁不动就 CSS 转 90° 兜底；`?norot=1` 关掉（只弹提示）、`?rot=1` 强制转。
 * `planOrientation` 只回答「假如允许 CSS 兜底，该不该兜」——它不涉及点击状态，
 * 所以 Gate 里直接按「点过且仍竖屏」判断，不再调它；保留导出与单测是为了钉住这条基础规则。
 */

export interface Viewport {
  width: number;
  height: number;
}

export interface Box {
  width: number;
  height: number;
}

/** 呈现方式：真横屏，或者靠 CSS 旋转兜底 */
export type OrientationPlan = 'landscape' | 'rotate';

/** 视口是否竖屏（高 > 宽）。宽高必须为正，否则按非竖屏处理，避免 0 值误判。 */
export function isPortrait(v: Viewport): boolean {
  if (!(v.width > 0) || !(v.height > 0)) return false;
  return v.height > v.width;
}

/**
 * 决策：竖屏且没能锁横屏，就只能靠 CSS 旋转。
 * lockAcquired 表示 `screen.orientation.lock('landscape')` 是否真的成功了
 * （不支持 / 被策略拒绝 / 不在全屏下都会失败）。
 */
export function planOrientation(v: Viewport, lockAcquired: boolean): OrientationPlan {
  if (!isPortrait(v)) return 'landscape';
  return lockAcquired ? 'landscape' : 'rotate';
}

/**
 * 旋转兜底时的坐标反算：屏幕坐标（CSS px，相对视口左上角）→ 画布本地坐标（CSS px）。
 *
 * 容器变换为 `translateX(viewport.width) rotate(90deg)`，原点在左上角，故：
 *   屏幕 (cx, cy) = (viewport.width - v, u)
 * 反解得 u = cy、v = viewport.width - cx；再减掉画布在容器内的居中留白。
 * canvas 是画布在容器坐标系里的尺寸（Phaser 的 FIT 结果，已含黑边）。
 */
export function unrotateToLocal(
  cx: number,
  cy: number,
  viewport: Viewport,
  canvas: Box,
): { u: number; v: number } {
  // 画布在容器里是居中的：沿容器宽方向的黑边是横向的（旋转后变成上下黑边），
  // 沿容器高方向的黑边（旋转后是左右黑边）——两个留白不能混用。
  const marginAlongWidth = (viewport.height - canvas.width) / 2;
  const marginAlongHeight = (viewport.width - canvas.height) / 2;
  return {
    u: cy - marginAlongWidth,
    v: viewport.width - cx - marginAlongHeight,
  };
}

/** 本地坐标 → 游戏内坐标（480×270 设计分辨率） */
export function toGameSpace(local: { u: number; v: number }, canvas: Box, game: Box): { x: number; y: number } {
  if (!(canvas.width > 0) || !(canvas.height > 0)) return { x: 0, y: 0 };
  return {
    x: (local.u / canvas.width) * game.width,
    y: (local.v / canvas.height) * game.height,
  };
}