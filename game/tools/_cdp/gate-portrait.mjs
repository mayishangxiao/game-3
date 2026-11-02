/**
 * Portrait gate sampler (ASCII only): proves the portrait entry behaves per mode.
 * Default (auto): tapping start turns the view landscape by itself - either the
 * system lock wins (viewport rotates) or the CSS 90° fallback kicks in; the
 * "please rotate" hint must NOT block play. With ?norot=1 (hint mode) the old
 * behavior is asserted: hint shown, canvas never css-rotated.
 *
 * Checks, in order:
 *   1) portrait load -> the start gate is on top (so "tap to start" is reachable)
 *   2) after tapping     -> auto: rotated or locked, hint hidden; hint mode: hint shown, not rotated
 *   3) turn to landscape -> hint disappears, canvas visible
 *
 * Usage: node tools/_cdp/gate-portrait.mjs <edgePath> <baseUrl> <outDir>
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';

const edge = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4173';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/portrait2');
const port = Number(process.env.PROBE_PORT ?? 9395);

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
  if (d) throw new Error('evaluate threw: ' + String(d?.exception?.description ?? '').slice(0, 240));
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
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await sleep(800);
}

const probe = `(function () {
  var html = document.documentElement;
  var root = document.getElementById('game-root');
  var hint = document.getElementById('rotate-hint');
  var gate = document.getElementById('tap-gate');
  var canvas = document.querySelector('#game-root canvas');
  var top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  var r = canvas ? canvas.getBoundingClientRect() : null;
  return {
    vw: window.innerWidth,
    vh: window.innerHeight,
    portrait: window.innerHeight > window.innerWidth,
    rotClass: html.classList.contains('rot'),
    locked: window.__dshGate ? window.__dshGate.locked : null,
    hintMode: window.__dshGate && window.__dshGate.url ? window.__dshGate.url.hint : null,
    rotMode: window.__dshGate && window.__dshGate.url ? window.__dshGate.url.rot : null,
    rootTransform: root ? getComputedStyle(root).transform : null,
    hintShown: !!hint && hint.classList.contains('show'),
    hintText: hint ? hint.innerText.replace(/\\s+/g, ' ').trim() : null,
    // what the Title scene actually rendered (the baked "please rotate" line lives here)
    titleTexts: (function () {
      var g = window.__dshGame;
      if (!g || !g.scene) return null;
      var ts = g.scene.getScene('Title');
      if (!ts || !ts.children || !ts.children.list) return null;
      var out = [];
      ts.children.list.forEach(function (c) {
        if (typeof c.text === 'string') out.push(c.text.slice(0, 60));
      });
      return out;
    })(),
    gateShown: !!gate && !gate.classList.contains('hidden') && gate.style.display !== 'none',
    topId: top ? (top.id || top.tagName) : null,
    canvasW: r ? Math.round(r.width) : 0,
    canvasH: r ? Math.round(r.height) : 0
  };
})()`;

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
    // baseUrl may already carry query params (e.g. .../index.html?norot=1) - keep them,
    // and append a cache-buster so a rebuilt bundle is really the one under test.
    const sep = base.includes('?') ? '&' : '?';
    await send('Page.navigate', { url: base + sep + 'v=' + Date.now() });
    await waitFor(async () => await evaluate("!!document.getElementById('tap-gate')"), 25000, 'gate');
    // The tap must land AFTER the main module took the gate over (window.__dshGate exists).
    // Tapping earlier only sets __tapGatePending (an inline-script no-op), which is exactly
    // the "first tap swallowed" case the gate then handles by asking for a second tap.
    await waitFor(async () => await evaluate('!!window.__dshGate'), 40000, 'gate handler ready');
    await sleep(400);
    report.steps.push({ step: 'portrait-before-tap', ...(await evaluate(probe)) });
    await shot('portrait-before-tap.png');

    await evaluate("document.getElementById('tap-gate').click(), 'ok'");
    await waitFor(async () => await evaluate('!!window.__dshGame'), 40000, 'game ready');
    // TitleScene.create() bakes the "please rotate" line once; it runs after boot resolves.
    // Wait for the scene to be live before judging what the player sees.
    await waitFor(
      async () => await evaluate("(window.__dshGame && window.__dshGame.scene.isActive('Title')) ? 1 : 0"),
      15000,
      'title active',
    );
    await sleep(1200);
    report.steps.push({ step: 'portrait-after-tap', ...(await evaluate(probe)) });
    await shot('portrait-after-tap.png');

    await metrics(844, 390);
    await sleep(1200);
    report.steps.push({ step: 'landscape', ...(await evaluate(probe)) });
    await shot('landscape.png');

    const before = report.steps[0];
    const after = report.steps[1];
    const land = report.steps[2];
    // 默认（auto）：竖屏点开始 → 锁得上交给系统转、锁不上 CSS 转 90°，两种都不该停在提示上。
    // ?norot=1（hint）：只弹「请把手机横过来」，不自动转 —— 旧的断言。
    // ?rot=1（force）：必走 CSS 旋转。
    const hintMode = after.hintMode === true;
    const forceMode = after.rotMode === true;
    // 锁屏成功时系统会把视口转成横屏；CDP 的 setDeviceMetricsOverride 不跟随，视口仍是竖的。
    // 于是「locked=true 但没转」是探针环境的产物：按几何它该旋转，按代码它不该——只查提示确实没挡路。
    const expectRotateFallback = !hintMode && after.locked !== true;
    const rotatedOrSystemTurned = after.rotClass === true || after.locked === true;
    // the in-game control line must not nag "please rotate" once the view is already landscape
    const titleLine = (after.titleTexts ?? []).find((t) => t.includes('WASD')) ?? '';
    report.verdict = {
      gateOnTopInPortrait: before.topId === 'tap-gate',
      hintAfterTap: hintMode ? after.hintShown === true : after.hintShown === false,
      notRotated: hintMode ? after.rotClass === false : after.rotClass === expectRotateFallback,
      titleNoRotateNag: hintMode ? true : !titleLine.includes('\u8bf7\u6a2a\u5c4f'),
      landscapeHintHidden: land.hintShown === false,
      // force mode keeps the css rotation even in a landscape viewport (probe artifact),
      // so judge canvas orientation by its transform matrix instead of rotClass.
      landscapeCanvasVisible:
        land.canvasW > 100 && land.canvasH > 100 && (forceMode ? land.rootTransform !== 'none' : land.canvasW > land.canvasH),
      ok:
        before.topId === 'tap-gate' &&
        (hintMode ? after.hintShown === true : after.hintShown === false) &&
        (hintMode ? after.rotClass === false : after.rotClass === expectRotateFallback) &&
        (hintMode || rotatedOrSystemTurned) &&
        (hintMode ? true : !titleLine.includes('\u8bf7\u6a2a\u5c4f')) &&
        land.hintShown === false &&
        (forceMode ? land.rootTransform !== 'none' : land.canvasW > land.canvasH),
    };
    report.errors = errors;
  } finally {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
    await writeFile(join(outDir, 'portrait.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report.verdict ?? { failed: true, errors }, null, 2));
    if (errors.length > 0) console.log('errors:', errors.slice(0, 6));
    process.exit(report.verdict?.ok ? 0 : 1);
  }
}

main().catch((e) => {
  report.error = String(e?.message ?? e);
  console.log('probe failed:', report.error);
  process.exit(1);
});