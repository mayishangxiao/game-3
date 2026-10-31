/**
 * Gate two-button probe (ASCII only): the start gate must show TWO controls in
 * portrait - "start" (.tg-go) and "landscape" (.tg-rot) - and the landscape one
 * must turn the view WITHOUT entering the game.
 *
 * Why this probe exists: the landscape button lives inside #tap-gate, and the gate
 * itself is a "tap anywhere to start" target with `pointer-events: none` once hidden.
 * Both details are easy to break (bubbling leaks the tap into onTap; pointer-events
 * hides the button). Neither shows up in a unit test.
 *
 * Steps:
 *   1) portrait load -> both buttons visible side by side, nothing rotated
 *   2) tap .tg-rot    -> html.rot on, gate still covering, game NOT started
 *   3) tap .tg-go     -> gate hidden, game running (scene 'Title' active)
 *   4) 844x390 viewport -> css rotation dropped, canvas landscape
 *
 * Usage: node tools/_cdp/gate-buttons.mjs <edgePath> <baseUrl> <outDir>
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';

const edge = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4173';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/gate-buttons');
const port = Number(process.env.PROBE_PORT ?? 9397);

const errors = [];
const report = { steps: [], shots: [] };
let ws;
let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const d = r?.result?.exceptionDetails;
  if (d) {
    const text = String(d?.exception?.description ?? d?.text ?? '').slice(0, 400);
    console.log('EVAL FAILED:', text, '| expr head:', expression.slice(0, 80));
    throw new Error('evaluate threw: ' + text.slice(0, 240));
  }
  return r?.result?.result?.value;
}

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true;
    await sleep(200);
  }
  throw new Error('timeout: ' + label);
}

async function shot(name) {
  await evaluate(
    'new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(1); }); }); })',
  );
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const b64 = r?.result?.data;
  if (b64) await writeFile(join(outDir, name), Buffer.from(b64, 'base64'));
  report.shots.push(name);
}

async function metrics(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  await sleep(900);
}

const probe = `(function () {
  var html = document.documentElement;
  var root = document.getElementById('game-root');
  var gate = document.getElementById('tap-gate');
  var go = gate && gate.querySelector('.tg-go');
  var rot = gate && gate.querySelector('.tg-rot');
  var canvas = document.querySelector('#game-root canvas');
  var cr = rot ? rot.getBoundingClientRect() : null;
  var canvasRect = canvas ? canvas.getBoundingClientRect() : null;
  return {
    vw: window.innerWidth,
    vh: window.innerHeight,
    portrait: window.innerHeight > window.innerWidth,
    rotClass: html.classList.contains('rot'),
    gateCovering: !!gate && !gate.classList.contains('hidden') && gate.style.display !== 'none',
    gateHandler: !!window.__dshGate,
    gateTapped: window.__dshGate ? window.__dshGate.tapped : null,
    gameReady: !!window.__dshGame,
    titleActive: !!(window.__dshGame && window.__dshGame.scene && window.__dshGame.scene.isActive('Title')),
    goShown: !!go && go.getClientRects().length > 0,
    rotShown: !!rot && rot.getClientRects().length > 0,
    // the landscape button must actually sit on screen and be hit-testable
    rotHit: cr ? (function () {
      var hit = document.elementFromPoint((cr.left + cr.right) / 2, (cr.top + cr.bottom) / 2);
      return !!hit && typeof hit.closest === 'function' && hit.closest('.tg-rot') === rot;
    })() : false,
    rotBox: cr ? { x: Math.round(cr.left), y: Math.round(cr.top), w: Math.round(cr.width), h: Math.round(cr.height) } : null,
    goBox: go ? (function () { var g = go.getBoundingClientRect(); return { x: Math.round(g.left), y: Math.round(g.top), w: Math.round(g.width), h: Math.round(g.height) }; })() : null,
    canvasW: canvasRect ? Math.round(canvasRect.width) : 0,
    canvasH: canvasRect ? Math.round(canvasRect.height) : 0,
    rootTransform: root ? getComputedStyle(root).transform : null
  };
})()`;

/** 真实点一下：用鼠标事件按下抬起在那个点上，不走 element.click()（要验证命中与冒泡）。 */
async function tapAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
    buttons: 0,
  });
}

async function tapCenterOf(selector) {
  // 之前在页面里量好中心点再发 CDP 鼠标事件，但反向旋转之后 elementFromPoint 命中的
  // 不是按钮（合成层的命中测试与布局盒子不是一回事），点在按钮中心也可能落空。
  // 这里直接在页面里对元素派发一次真实点击：冒泡、preventDefault、stopPropagation
  // 全都照常执行，唯一少掉的是「屏幕命中测试」——那部分由 rotButtonHitTest 单独断言。
  const out = await evaluate(
    `(function () {
       try {
         var e = document.querySelector(${JSON.stringify(selector)});
         if (!e) return { error: 'no element' };
         var r = e.getBoundingClientRect();
         var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
         e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
         return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
                  hit: hit ? (hit.tagName + '.' + String(hit.className)) : null };
       } catch (err) {
         return { error: String(err && err.stack ? err.stack : err) };
       }
     })()`,
  );
  if (!out || out.error) throw new Error('tap ' + selector + ' failed: ' + (out ? out.error : 'no result'));
  return out;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const profile = join(outDir, 'profile');
  const proc = spawn(
    edge,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=600,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
      } catch {
        /* not up yet */
      }
      if (!target) await sleep(300);
    }
    if (!target) throw new Error('devtools not up');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails;
        errors.push(String(d?.exception?.description ?? d?.text ?? 'exception').split('\n')[0].slice(0, 200));
      }
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await metrics(390, 844);

    const base = baseUrl.replace(/\/$/, '');
    const sep = base.includes('?') ? '&' : '?';
    await send('Page.navigate', { url: base + sep + 'v=' + Date.now() });
    await waitFor(async () => await evaluate('!!window.__dshGate'), 40000, 'gate handler ready');
    await sleep(500);
    const before = await evaluate(probe);
    report.steps.push({ step: 'portrait-load', ...before });
    await shot('p1-portrait-two-buttons.png');

    // 1) the landscape button: turns the view, does NOT start the game
    const rotBtnBox = await evaluate(
      "(function(){var e=document.querySelector('#tap-gate .tg-rot');var r=e.getBoundingClientRect();" +
        "return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height)};})()",
    );
    report.steps.push({ step: 'landscape-button-box', ...rotBtnBox });
    const tapInfo = await tapCenterOf('#tap-gate .tg-rot');
    report.steps.push({ step: 'landscape-tap', ...tapInfo });
    await sleep(900);
    const afterRot = await evaluate(probe);
    report.steps.push({ step: 'after-landscape-button', ...afterRot });
    await shot('p2-after-landscape-button.png');

    // 2) the start button: enters the game even though the view is already rotated.
    // 转过之后 #tap-gate 自己也转了 90°，按钮的屏幕位置随之变化 —— 每次重新量，
    // 并且重试几次（点偏一点点就落在 gate 的空白处，而 gate 的 click 在旋转下未必对得上）。
    let started = false;
    for (let i = 0; i < 4 && !started; i++) {
      await tapCenterOf('#tap-gate .tg-go');
      await sleep(700);
      started = await evaluate('!!(window.__dshGate && window.__dshGate.tapped)');
      report.steps.push({ step: 'start-try-' + (i + 1), ok: started, ...(await evaluate(probe)) });
    }
    await waitFor(async () => await evaluate('!!window.__dshGame'), 40000, 'game ready');
    // Title 场景的 isActive 在加载阶段就可能为 true（boot 一建好 game 就切进去），
    // 拿它当「已经进游戏」的证据会立刻通过、什么也没验证。真正稳的是 gate 消失 + 画面稳定。
    await sleep(1500);
    const afterStart = await evaluate(probe);
    report.steps.push({ step: 'after-start-button', ...afterStart });
    await shot('p3-after-start-button.png');

    // 3) real landscape viewport: css rotation must be dropped
    await metrics(844, 390);
    await sleep(1200);
    const land = await evaluate(probe);
    report.steps.push({ step: 'landscape', ...land });
    await shot('p4-landscape.png');

    // side by side in portrait: same row, landscape button to the RIGHT of start
    const sideBySide =
      !!before.goBox &&
      !!before.rotBox &&
      Math.abs(before.goBox.y + before.goBox.h / 2 - (before.rotBox.y + before.rotBox.h / 2)) < 12 &&
      before.rotBox.x >= before.goBox.x + before.goBox.w - 2;

    report.verdict = {
      twoButtonsVisible: before.goShown === true && before.rotShown === true,
      sideBySide,
      rotButtonHitTest: before.rotHit === true,
      notRotatedBeforeTap: before.rotClass === false,
      // the landscape button rotates the css container ...
      rotatedByButton: afterRot.rotClass === true,
      // ... but must NOT enter the game (that is the whole point of having two buttons).
      // 判据只能用 __dshGate.tapped：__dshGame 在页面加载时就存在（boot 先建 game，gate 只是叠在上面），
      // 它不代表「进过游戏」。而 tapped 会同时让 gate 隐藏、情景从 Title 真正接管。
      gameNotStartedByRotButton: afterRot.gateCovering === true && afterRot.gateTapped === false,
      startEntersGame: afterStart.gateTapped === true && afterStart.gateCovering === false,
      gateHiddenAfterStart: afterStart.gateCovering === false,
      // entering from a css-rotated gate must keep the rotated mapping (game is playable)
      stillRotatedAfterStart: afterStart.rotClass === true,
      landscapeDropsRotation: land.rotClass === false,
      landscapeCanvasWide: land.canvasW > land.canvasH,
      ok: false,
    };
    report.verdict.ok =
      report.verdict.twoButtonsVisible &&
      report.verdict.sideBySide &&
      report.verdict.rotButtonHitTest &&
      report.verdict.notRotatedBeforeTap &&
      report.verdict.rotatedByButton &&
      report.verdict.gameNotStartedByRotButton &&
      report.verdict.startEntersGame &&
      report.verdict.gateHiddenAfterStart &&
      report.verdict.stillRotatedAfterStart &&
      report.verdict.landscapeDropsRotation &&
      report.verdict.landscapeCanvasWide;
    report.errors = errors;
  } finally {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
    try {
      await writeFile(join(outDir, 'gate-buttons.json'), JSON.stringify(report, null, 2), 'utf8');
    } catch (we) {
      console.log('could not write report:', String(we?.message ?? we));
    }
    console.log(JSON.stringify(report.verdict ?? { failed: true, errors }, null, 2));
    if (errors.length > 0) console.log('errors:', errors.slice(0, 6));
    // 半路抛错时这里才是最有用的一行：没有它只看到 {"failed": true}，得回去猜是哪一步。
    if (report.error) console.log('probe failed:', report.error);
    if (report.steps.length > 0 && !report.verdict) {
      console.log('last step:', JSON.stringify(report.steps[report.steps.length - 1]));
    }
    process.exit(report.verdict?.ok ? 0 : 1);
  }
}

main().catch(async (e) => {
  report.error = String((e && e.stack) || (e && e.message) || e);
  console.log('probe failed:', report.error);
  try {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'gate-buttons.json'), JSON.stringify(report, null, 2), 'utf8');
  } catch (we) {
    console.log('could not write report:', String(we?.message ?? we));
  }
  process.exit(1);
});