/**
 * 「点击开始」入口 —— 复刻老掌机/老手游的进游戏手势，同时用它触发自动横屏。
 *
 * 为什么必须在点击里做：全屏与屏幕方向锁都要求用户手势，页面加载时自动调用一律被拒。
 *
 * 流程：点击 → 尽量全屏 → 尽量 lock('landscape') → 等一小会儿 → 若仍是竖屏，
 * 就改用 CSS 旋转容器兜底（iOS Safari 完全没有方向锁，只能这样），
 * 并把 Phaser 的触点换算改成旋转后的版本，否则点哪都偏 90°。
 */

import Phaser from 'phaser';
import { VIEW_H, VIEW_W } from '../core/constants';
import { isPortrait, planOrientation, toGameSpace, unrotateToLocal } from '../core/orientation';

export interface GateState {
  tapped: boolean;
  fullscreen: boolean;
  locked: boolean;
  /** 是否正在用 CSS 旋转兜底 */
  rotated: boolean;
  /** 调试/端到端用：把屏幕坐标换算成游戏内坐标（旋转兜底时才有意义） */
  map?: (cx: number, cy: number) => { x: number; y: number };
  /** 地址参数快照（E2E 要按模式分支，不能在脚本里猜） */
  url: { rot: boolean; hint: boolean };
}

const ROT_CLASS = 'rot';

type ScaleWithHooks = Phaser.Scale.ScaleManager & {
  __origTransformX?: (pageX: number, pageY?: number) => number;
  __origTransformY?: (pageY: number, pageX?: number) => number;
  __origParentBounds?: () => boolean;
  __origAutoCenter?: number;
};

type InputWithHooks = Phaser.Input.InputManager & {
  __origTransformPointer?: (
    pointer: Phaser.Input.Pointer,
    pageX: number,
    pageY: number,
    wasMove: boolean,
  ) => void;
};

function viewport(): { width: number; height: number } {
  // 微信/QQ 内置浏览器与 iOS Safari 的地址栏会伸缩，innerHeight 随之变化；
  // visualViewport 更贴近「用户此刻真正看到的区域」，优先用它。
  const vv = window.visualViewport;
  const w = vv && vv.width > 0 ? vv.width : window.innerWidth;
  const h = vv && vv.height > 0 ? vv.height : window.innerHeight;
  return { width: Math.round(w), height: Math.round(h) };
}

/** 旋转兜底：把容器尺寸设成「宽=视口高、高=视口宽」，再用 CSS 转 90° 铺满屏幕。 */
function applyRotatedLayout(rotated: boolean): void {
  const html = document.documentElement;
  const root = document.getElementById('game-root');
  html.classList.toggle(ROT_CLASS, rotated);
  if (!root) return;
  if (rotated) {
    const vp = viewport();
    root.style.width = `${vp.height}px`;
    root.style.height = `${vp.width}px`;
    // 位移也用 px 而不是 CSS 里的 100vw：地址栏伸缩时 vw 与 innerWidth 会短暂不一致。
    root.style.transform = `translateX(${vp.width}px) rotate(90deg)`;
  } else {
    root.style.width = '';
    root.style.height = '';
    root.style.transform = '';
  }
}

/**
 * 屏幕坐标（client px）→ 画布本地坐标（CSS px）。
 *
 * 为什么不自己算 90° 三角：手机上 `100vh`、安全区、地址栏、dpr 任何一个对不上，
 * 手算的公式就整体偏一段，表现为「点哪都没反应」。这里直接读容器的
 * 实际变换矩阵求逆，再把画布的 offsetLeft/Top 减掉 —— 不依赖任何几何假设。
 * 老浏览器没有 DOMMatrix 时退回 unrotateToLocal 的解析解。
 */
function clientToCanvas(
  canvas: HTMLCanvasElement,
  cx: number,
  cy: number,
  rotated: boolean,
): { u: number; v: number; w: number; h: number } | null {
  const w = canvas.clientWidth || canvas.getBoundingClientRect().width;
  const h = canvas.clientHeight || canvas.getBoundingClientRect().height;
  if (!(w > 0) || !(h > 0)) return null;
  if (!rotated) {
    // 没旋转就是普通布局：client 坐标减掉画布偏移即可（别走旋转公式，会整体偏一段）
    return { u: cx - canvas.offsetLeft, v: cy - canvas.offsetTop, w, h };
  }
  const root = document.getElementById('game-root');
  if (!root) return null;

  const raw = window.getComputedStyle(root).transform;
  if (raw && raw !== 'none' && typeof DOMMatrixReadOnly === 'function') {
    const inv = new DOMMatrixReadOnly(raw).inverse();
    const p = inv.transformPoint(new DOMPoint(cx, cy));
    return { u: p.x - canvas.offsetLeft, v: p.y - canvas.offsetTop, w, h };
  }

  const local = unrotateToLocal(cx, cy, viewport(), { width: w, height: h });
  return { u: local.u, v: local.v, w, h };
}

/**
 * 旋转兜底时改写三处：
 *   1. `getParentBounds` —— Phaser 用 `getBoundingClientRect()` 量父容器，而旋转过的元素
 *      量出来是它的外接矩形（正好是竖屏全屏），于是 FIT 会按竖屏比例把画面缩成一条。
 *      这里直接告诉它「父容器是 844×390」。
 *   2. `transformX/Y` —— Phaser 的触点换算只做平移+缩放，且 `transformPointer` 是
 *      **分别**用 (pageX) 和 (pageY) 调这两个函数的，旋转把 x/y 耦合在一起，光改这两个
 *      函数拿不到另一半坐标，所以真正的换算放到 `transformPointer` 上，这两个函数降级成纯缩放。
 *   3. `transformPointer` —— 先把屏幕坐标反算成画布本地坐标，再交给 Phaser 原来的流程
 *      （平滑、prevPosition 等都保留）。
 */
function patchInput(game: Phaser.Game, rotated: boolean): void {
  const scale = game.scale as ScaleWithHooks;
  const input = game.input as InputWithHooks;

  if (rotated) {
    if (!scale.__origTransformX) {
      scale.__origTransformX = scale.transformX.bind(scale);
      scale.__origTransformY = scale.transformY.bind(scale);
      scale.__origParentBounds = scale.getParentBounds.bind(scale);
      scale.__origAutoCenter = scale.autoCenter;
    }
    if (!input.__origTransformPointer) {
      input.__origTransformPointer = input.transformPointer.bind(input);
    }

    scale.getParentBounds = () => {
      const vp = viewport();
      const w = vp.height;
      const h = vp.width;
      if (scale.parentSize.width === w && scale.parentSize.height === h) return false;
      scale.parentSize.setSize(w, h);
      return true;
    };

    // 居中交给 centerCanvas()：Phaser 的 updateCenter 量的是画布外接矩形，
    // 旋转后量出来是 390×693，会把边距算反（实测 marginLeft 227 / marginTop -152）。
    scale.autoCenter = Phaser.Scale.Center.NO_CENTER;

    const toLocal = (cx: number, cy: number): { u: number; v: number } => {
      const box = clientToCanvas(game.canvas, cx, cy, true);
      if (!box) return { u: 0, v: 0 };
      return { u: box.u, v: box.v };
    };

    // 输入到这两个函数时已经是「画布本地坐标」，只需缩放到 480×270
    scale.transformX = (u: number) => (u * VIEW_W) / Math.max(1, game.canvas.clientWidth);
    scale.transformY = (v: number) => (v * VIEW_H) / Math.max(1, game.canvas.clientHeight);

    const original = input.__origTransformPointer;
    input.transformPointer = (pointer, pageX, pageY, wasMove) => {
      const local = toLocal(pageX, pageY);
      original(pointer, local.u, local.v, wasMove);
    };
  } else {
    if (scale.__origTransformX) scale.transformX = scale.__origTransformX;
    if (scale.__origTransformY) scale.transformY = scale.__origTransformY;
    if (scale.__origParentBounds) scale.getParentBounds = scale.__origParentBounds;
    if (input.__origTransformPointer) input.transformPointer = input.__origTransformPointer;
    if (scale.__origAutoCenter !== undefined) scale.autoCenter = scale.__origAutoCenter;
    scale.__origTransformX = undefined;
    scale.__origTransformY = undefined;
    scale.__origParentBounds = undefined;
    scale.__origAutoCenter = undefined;
    input.__origTransformPointer = undefined;
  }
}

/** 旋转兜底时的居中等价物：把画布沿容器宽方向留白（屏幕上就是上下黑边）。 */
function centerCanvas(game: Phaser.Game): void {
  const size = game.scale.displaySize;
  const vp = viewport();
  game.canvas.style.marginLeft = `${Math.max(0, (vp.height - size.width) / 2)}px`;
  game.canvas.style.marginTop = `${Math.max(0, (vp.width - size.height) / 2)}px`;
}

export function installStartGate(game: Phaser.Game): GateState {
  const params = new URLSearchParams(window.location.search);
  // rot 模式三态：默认 auto = 点开始就自动横屏。
  //   auto  —— 地址里两个参数都没写（线上部署就是这个状态）：先试全屏 + lock('landscape')，
  //            锁不上就**自动用 CSS 把画面转 90° 铺满屏幕**——用户不用自己横手机；
  //            一旦触点换算自检对不上，退回提示模式（宁可不转，也不能留一个点不动的画面）。
  //   force —— `?rot=1`：强制走旋转兜底（调试旧的坐标反算链路）。
  //   hint  —— `?norot=1`：永不自动转，竖屏只弹「请把手机横过来」。
  // 之前默认是 hint（用户 2026-10-30 否掉了自动转屏）；本轮用户要求「游戏要能横屏」，
  // 默认改回 auto：锁得上交给系统转，锁不上（iOS Safari / 微信内核）由 CSS 转过来。
  const rotMode: 'auto' | 'force' | 'hint' =
    params.get('rot') === '1' ? 'force' : params.get('norot') === '1' ? 'hint' : 'auto';
  // 自检只许做一次：兜底被关掉之后画布恢复普通布局，再拿它跑一次几何检查必然误判。
  let sanityChecked = false;
  const state: GateState = {
    tapped: false,
    fullscreen: false,
    locked: false,
    rotated: false,
    url: { rot: params.get('rot') === '1', hint: params.get('norot') === '1' },
  };
  /** auto 模式下锁屏失败后是否允许 CSS 兜底；自检不过就永久关掉 */
  let rotationBlocked = rotMode === 'hint';

  /** gate 还盖在屏幕上：此时旋转只会把「点击开始」拧起来，等点完再转 */
  const gateCovering = (): boolean => {
    const g = document.getElementById('tap-gate');
    return !!g && !g.classList.contains('hidden');
  };

  /** 竖屏且没在旋转时，显示「请把手机横过来」（旋转兜底生效时 CSS 会把它藏掉） */
  const updateHint = (): void => {
    const hint = document.getElementById('rotate-hint');
    if (!hint) return;
    hint.classList.toggle('show', isPortrait(viewport()) && !state.rotated);
  };

  /** 触点换算自检：画布外接矩形的中心必须映回 (240,135)。对不上就说明几何与假设不符。 */
  const mappingSane = (): boolean => {
    const map = state.map;
    const r = game.canvas.getBoundingClientRect();
    if (!map || !(r.width > 2) || !(r.height > 2)) return true;
    const c = map(r.left + r.width / 2, r.top + r.height / 2);
    return Math.abs(c.x - VIEW_W / 2) < 14 && Math.abs(c.y - VIEW_H / 2) < 14;
  };

  const reflow = (): void => {
    // force 模式下无视自检结果；auto 模式下 rotationBlocked 只可能由自检置真。
    // gate 还盖着屏幕时不转：旋转兜底是给「进游戏之后」用的，点开始之前先把
    // 「点击开始」拧起来反而怪（旧行为是加载即旋转，探针就是这么抓到 rotClass=true）。
    // 但一旦用户点过（state.tapped），就不再撤销旋转——锁屏成功、系统把视口转成
    // 横屏的那几十毫秒里，resize 会读到瞬时竖屏几何，撤销再恢复会让画面抖一下。
    // 例外：自检不过（rotationBlocked）时必须撤销——留一个「转了但点不动」的画面，
    // 比退回提示模式更糟（宁可不转，也不能骗人以为能玩）。
    let canRotate = rotMode === 'force' || state.tapped || !gateCovering();
    if (rotationBlocked && state.rotated) canRotate = true;
    const plan =
      rotMode === 'force'
        ? 'rotate'
        : rotationBlocked || !canRotate
          ? 'landscape'
          : planOrientation(viewport(), state.locked);
    const rotated = plan === 'rotate';
    if (rotated && !state.rotated) sanityChecked = false; // 重新转起来 = 几何变了，允许再自检一次
    state.rotated = rotated;
    applyRotatedLayout(rotated);
    patchInput(game, rotated);
    state.map = (cx: number, cy: number) => {
      const box = clientToCanvas(game.canvas, cx, cy, rotated);
      if (!box) return { x: 0, y: 0 };
      return toGameSpace(
        { u: box.u, v: box.v },
        { width: box.w, height: box.h },
        { width: VIEW_W, height: VIEW_H },
      );
    };
    updateHint();
    // 容器尺寸变了要让 Phaser 重新量一次父容器；旋转时还要自己居中（Phaser 的量法在旋转下会算反）
    window.setTimeout(() => {
      game.scale.refresh();
      if (rotated) centerCanvas(game);
    }, 60);
    // 布局稳定后再量一次：换算对不上就宁可不转，也不能留一个点不动的画面。
    // 自检只在「画面已经真的转起来了」时跑——未旋转状态下画布没变形，
    // 拿它当旋转几何的证据会误判（曾经就是这么把兜底自己关掉的）。
    if (rotated) {
      window.setTimeout(() => {
        if (!state.rotated) return; // 期间被 resize/orientationchange 撤销过就不重复检查
        game.scale.refresh();
        centerCanvas(game);
        if (rotMode !== 'force' && !sanityChecked) {
          sanityChecked = true;
          if (!mappingSane()) {
            rotationBlocked = true;
            reflow();
          }
        }
      }, 520);
    }
  };

  const begin = async (): Promise<void> => {
    // 桌面端（本来就横屏）不做全屏，免得测试与日常浏览被打扰
    if (isPortrait(viewport())) {
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
          state.fullscreen = true;
        }
      } catch {
        state.fullscreen = false;
      }
      try {
        const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        if (typeof so?.lock === 'function') {
          await so.lock('landscape');
          state.locked = true;
        }
      } catch {
        state.locked = false;
      }
      // 锁屏成功后系统要几十到几百毫秒才把视口转过来
      await new Promise((r) => window.setTimeout(r, state.locked ? 500 : 0));
    }
    reflow();
  };

  const gate = document.getElementById('tap-gate');
  const onTap = (): void => {
    if (state.tapped) return;
    state.tapped = true;
    (window as unknown as { __tapGatePending?: boolean }).__tapGatePending = false;
    gate?.classList.add('hidden');
    document.documentElement.classList.add('started');
    // 引导层一消失就该决定要不要旋转画面（begin() 里的全屏/锁屏是异步的，
    // 等它回来才转的话，竖屏下会先看到几帧歪着的画面）
    reflow();
    // 只把 opacity 置 0 的话，某些内置浏览器仍会把点击吃掉；到时彻底移出层叠树
    window.setTimeout(() => {
      if (gate) gate.style.display = 'none';
    }, 340);
    void begin();
  };

  // 主模块下载期间用户就点过引导层：那一下的手势已经作废（全屏与锁屏只认新手势），
  // 所以不能假装已经开始，而是把文案改成「再点一下」—— 这正是「点哪都没反应」的现场。
  if (gate && (window as unknown as { __tapGatePending?: boolean }).__tapGatePending) {
    const go = gate.querySelector('.tg-go') as HTMLElement | null;
    if (go) {
      go.textContent = '再 点 一 下 进 入';
      go.style.animation = 'none';
      go.style.opacity = '1';
    }
  }

  if (gate) {
    // pointerdown / touchstart / click 都挂，谁先到都算（老内核未必有 PointerEvent）
    gate.addEventListener('pointerdown', onTap, { once: true });
    gate.addEventListener('touchstart', onTap, { once: true, passive: true });
    gate.addEventListener('click', onTap, { once: true });
  } else {
    // 没有 gate 元素（理论上不会）就当已点击，至少保证方向逻辑生效
    onTap();
  }

  window.addEventListener('resize', reflow);
  window.addEventListener('orientationchange', reflow);
  // 微信/iOS 的地址栏伸缩只改 visualViewport，不触发 window.resize
  window.visualViewport?.addEventListener('resize', reflow);
  window.visualViewport?.addEventListener('scroll', reflow);
  reflow();

  (window as unknown as { __dshGate?: GateState }).__dshGate = state;
  return state;
}