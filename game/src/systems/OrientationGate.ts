/**
 * 「点击开始」入口 —— 复刻老掌机/老手游的进游戏手势，同时用它触发横屏。
 *
 * 为什么必须在点击里做：全屏与屏幕方向锁都要求用户手势，页面加载时自动调用一律被拒。
 *
 * 流程：点一下屏幕 → 立刻要求横屏（wantLandscape）→ 尽量全屏 → 尽量 lock('landscape')
 * → 若仍是竖屏，就改用 CSS 旋转容器兜底（iOS Safari 完全没有方向锁，只能这样），
 * 并把 Phaser 的触点换算改成旋转后的版本，否则点哪都偏 90°。
 */

import Phaser from 'phaser';
import { VIEW_H, VIEW_W } from '../core/constants';
import { isPortrait, toGameSpace, unrotateToLocal } from '../core/orientation';

export interface GateState {
  tapped: boolean;
  fullscreen: boolean;
  locked: boolean;
  /** 是否正在用 CSS 旋转兜底 */
  rotated: boolean;
  /** 是否还想让画面横着（点开始前竖屏就点一下，点了就要；真横过来或自检不过才放掉） */
  wantLandscape: boolean;
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
  // 横屏行为：**点一下屏幕就横**。
  //   点「点击开始」之前：竖屏不转，引导层正立着，只写一句「点一下自动横屏」。
  //   点下去之后（onTap，同步、不等异步）：wantLandscape = true，
  //     真横屏 → 什么都不做；
  //     锁得动 → 全屏 + lock('landscape')，交给系统转（transition 期间照旧保持 CSS 旋转，
  //               避免「转了一半又被撤掉」的抖动，等视口真的横向了再放掉，见 reflow）；
  //     锁不动（iOS Safari / 微信内核）或锁完还是竖的 → CSS 把容器转 90° 铺满。
  //   用户把手机横过来 / 自检不过 → wantLandscape = false，画面回到原生横屏。
  // 开关：`?rot=1` 强制 CSS 旋转（调试旧链路）；`?norot=1` 完全不转，只弹「请把手机横过来」。
  const rotMode: 'auto' | 'force' | 'hint' =
    params.get('rot') === '1' ? 'force' : params.get('norot') === '1' ? 'hint' : 'auto';
  // 自检只许做一次：兜底被关掉之后画布恢复普通布局，再拿它跑一次几何检查必然误判。
  let sanityChecked = false;
  const state: GateState = {
    tapped: false,
    fullscreen: false,
    locked: false,
    rotated: false,
    wantLandscape: false,
    url: { rot: params.get('rot') === '1', hint: params.get('norot') === '1' },
  };
  /** auto 模式下锁屏失败后是否允许 CSS 兜底；自检不过就永久关掉 */
  let rotationBlocked = rotMode === 'hint';
  /** 引导层上的「横屏」按钮被点过：只转画面、不算开始（gate 与 tapped 都保持原样） */
  let gateRotated = false;

  /** gate 还盖在屏幕上：点之前不转，引导层要保持正立 */
  const gateCovering = (): boolean => {
    const g = document.getElementById('tap-gate');
    return !!g && !g.classList.contains('hidden');
  };

  /**
   * 竖屏且没在旋转时，显示「请把手机横过来」（旋转兜底生效时 CSS 会把它藏掉）。
   * **引导层还盖着的时候一律不显示**：那一屏上有「点击屏幕开始 / 横屏」两个按钮，
   * 提示层是 z-index 250 的整屏覆盖，一盖上来按钮就全看不见了（真机上就是这么「没变」的）。
   * 只有在玩家点了开始、离开引导层之后，竖屏才需要提示他自己把手机横过来。
   */
  const updateHint = (): void => {
    const hint = document.getElementById('rotate-hint');
    if (!hint) return;
    hint.classList.toggle(
      'show',
      isPortrait(viewport()) && !state.rotated && !gateCovering() && state.tapped,
    );
  };

  /** 游戏内「横屏」小按钮：竖屏可见，点一下再强制横一次（旋转被撤销后的补救入口） */
  const updateRotateButton = (): void => {
    const btn = document.getElementById('rotate-btn');
    if (!btn) return;
    // 真横屏没必要显示；hint 模式也不显示（那种模式用户自己横过来）
    const show = rotMode !== 'hint' && isPortrait(viewport());
    btn.classList.toggle('show', show);
    btn.classList.toggle('on', state.rotated);
  };

  /** 触点换算自检：画布外接矩形的中心必须映回 (240,135)。对不上就说明几何与假设不符。 */
  const mappingSane = (): boolean => {
    const map = state.map;
    const r = game.canvas.getBoundingClientRect();
    if (!map || !(r.width > 2) || !(r.height > 2)) return true;
    const c = map(r.left + r.width / 2, r.top + r.height / 2);
    return Math.abs(c.x - VIEW_W / 2) < 14 && Math.abs(c.y - VIEW_H / 2) < 14;
  };

  /**
   * 重新算一遍横屏策略。三句话：
   *   1. 点之前不转（引导层要正立），点过之后（wantLandscape）才该横；
   *   2. 已经横了（视口本身是横的，或系统锁屏把视口转过来了）就放掉 CSS 旋转——原生横屏最省事；
   *   3. 还竖着就转：锁不上屏的直接 CSS 转，锁得上的先等系统转，但**先转着别撤**，
   *      否则锁屏过渡的那几十毫秒里会看到画面转一半又弹回来。
   * 唯一让步是触点自检不过（rotationBlocked）：宁可退回「请横屏」提示，也不能留一个转了却点不动的画面。
   */
  const reflow = (): void => {
    const vp = viewport();
    const portrait = isPortrait(vp);
    if (rotMode === 'auto' && state.wantLandscape && !portrait) state.wantLandscape = false;

    // 点之前的唯一例外是引导层上的「横屏」按钮（gateRotated）：它不开始游戏，
    // 但明确表达了「我现在就要横着」，那就得让画面真的转过去。
    const canRotate =
      rotMode === 'force' || ((state.tapped || !gateCovering() || gateRotated) && !rotationBlocked);
    const rotated = canRotate && (rotMode === 'force' || (state.wantLandscape && portrait));

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
    updateRotateButton();
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
            state.wantLandscape = false;
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
      // 锁屏成功后系统要几十到几百毫秒才把视口转过来。这段时间里 CSS 旋转照旧保持着
      // （reflow 会在视口真的变横时自己撤掉），所以这里只等一下，不主动撤销任何东西。
      await new Promise((r) => window.setTimeout(r, state.locked ? 500 : 0));
    }
    reflow();
  };

  const gate = document.getElementById('tap-gate');
  const onTap = (e?: Event): void => {
    if (state.tapped) return;
    // 引导层上有两个按钮：点在「横屏」上只该转画面，不该进游戏。
    // （pointerdown/touchstart 挂在 gate 上，按钮的点击会冒泡上来，必须在这里挡掉；
    //  index.html 的内联脚本也对按钮做了 stopPropagation，两处都要有——旧内核可能不发 click。）
    const t = e?.target as Element | null;
    if (t && typeof t.closest === 'function' && t.closest('.tg-rot')) return;
    state.tapped = true;
    // 「点一下屏幕就横」：这一下点下去就立刻要求横屏，并把旋转同步做完——
    // begin() 里的全屏/锁屏是异步的，等它回来才转的话，竖屏下会先看到几帧正立的画面再突然翻过去。
    state.wantLandscape = true;
    (window as unknown as { __tapGatePending?: boolean }).__tapGatePending = false;
    gate?.classList.add('hidden');
    document.documentElement.classList.add('started');
    reflow();
    // 只把 opacity 置 0 的话，某些内置浏览器仍会把点击吃掉；到时彻底移出层叠树
    window.setTimeout(() => {
      if (gate) gate.style.display = 'none';
    }, 340);
    void begin();
  };

  /**
   * 游戏内「横屏」按钮：再强制横一次。
   * 场景是旋转被撤掉了（自检不过 / 用户中途横竖切换过 / 系统把锁屏放掉了）却还想横着玩：
   * 这一下是新手势，所以能把全屏和方向锁**重新申请一遍**（这是关键——纯 CSS 旋转不需要手势，
   * 但锁屏需要，而锁屏转出来的原生横屏比 CSS 转更清晰、也没有触点偏差的风险）。
   *
   * `fromGate`：从引导层的「横屏」按钮点进来时为 true —— 那种情况**不许**把 gate 当已开始，
   * 否则点了「横屏」就直接进游戏了（两个按钮就白做了）。它只转画面，进游戏还得点「开始」。
   */
  const onRotateButton = (fromGate = false): void => {
    if (rotMode === 'hint') return;
    // 先把旋转同步打开：即使下面的全屏/锁屏全被拒（iOS Safari 支持 requestFullscreen 的
    // 只有 video，screen.orientation 根本没有 lock），CSS 兜底也立刻把画面转过来。
    state.wantLandscape = true;
    if (!state.tapped && !fromGate) {
      // 已经进游戏但 gate 还在（比如用户直接点了水面）：当成已开始，免得旋转又被 gate 挡回去
      state.tapped = true;
      gate?.classList.add('hidden');
      document.documentElement.classList.add('started');
    } else if (!state.tapped && fromGate) {
      // 引导层上的「横屏」：不算开始，只是允许它在 gate 还盖着的时候就转
      gateRotated = true;
    }
    reflow();
    // 手势还在：再有本事就把系统锁定也拿回来（成功时视口会自己转，reflow 随后撤掉 CSS 旋转）
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
    // 引导层上的「横屏」按钮只转画面、不进游戏。它的命中处理在 index.html 的内联脚本里
    // （那段脚本在主模块之前就挂好，弱网下先点它也有反应），那里拦掉冒泡后派发 dsh:gate-rotate。
    // 这里接住它，走同一套「新手势重新申请全屏 + 锁屏」的逻辑，但标记 fromGate，不许顺带把 gate 关掉。
    window.addEventListener('dsh:gate-rotate', () => onRotateButton(true));
  } else {
    // 没有 gate 元素（理论上不会）就当已点击，至少保证方向逻辑生效
    onTap();
  }

  // 游戏内「横屏」按钮：同样三种事件都挂（它不出现在 gate 里，要一直可用，所以不加 once）
  const rotateBtn = document.getElementById('rotate-btn');
  if (rotateBtn) {
    rotateBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onRotateButton();
    });
    rotateBtn.addEventListener('click', (e) => {
      e.preventDefault();
      onRotateButton();
    });
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