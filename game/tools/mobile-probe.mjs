/**
 * 手机触点验证：真浏览器 + 移动端视口 + 真实触摸事件。
 *
 * 用法: node tools/mobile-probe.mjs <edgePath> <url> [outDir]
 *
 * 验证四件事：
 *   1. 引擎与引导层能在「竖屏 390×844」下加载出来（并记录从导航到可交互的毫秒数）；
 *   2. 引导层（#tap-gate）能被触摸点掉；
 *   3. 旋转兜底后，__dshGate.map 能把屏幕坐标映回游戏坐标（中心 = 240,135）；
 *   4. 用 map 反查出「开始」按钮在屏幕上的位置并真的点它 → 场景要切到 Hub。
 * 第 4 条是核心：断言全绿但按钮点不动，之前就这么漏掉过一次。
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';

const edge = process.argv[2];
const url = process.argv[3] ?? 'http://127.0.0.1:4173/';
const outDir = resolve(process.argv[4] ?? 'tools/_mobile');
const port = 9343;
const profile = join(outDir, 'profile');

const errors = [];
const report = {};
let ws;
let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rej(new Error(`timeout ${method}`));
      }
    }, 30000);
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'eval error');
  return r.result?.value;
}

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* keep waiting */
    }
    await sleep(180);
  }
  throw new Error(`waitFor timeout: ${label}`);
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(outDir, `${name}.png`), Buffer.from(r.data, 'base64'));
}

async function tap(x, y) {
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1 }],
  });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function openWs(wsUrl) {
  const WebSocketImpl = globalThis.WebSocket;
  if (!WebSocketImpl) throw new Error('no global WebSocket (node >= 22 required)');
  return new Promise((res, rej) => {
    const sock = new WebSocketImpl(wsUrl);
    sock.onopen = () => res(sock);
    sock.onerror = (e) => rej(new Error(`ws error ${e?.message ?? ''}`));
    sock.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { res: ok, rej: bad } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) bad(new Error(msg.error.message));
        else ok(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(msg.params.exceptionDetails?.exception?.description ?? 'exception');
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      }
    };
  });
}

async function main() {
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await mkdir(outDir, { recursive: true });
  const proc = spawn(
    edge,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-features=HttpsUpgrades,HttpsFirstBalancedMode,HttpsFirstModeV2ForDesktop',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(300);
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === 'page');
    } catch {
      /* not up yet */
    }
  }
  if (!target) throw new Error('devtools not reachable');
  ws = await openWs(target.webSocketDebuggerUrl);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setUserAgentOverride', {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  const navStart = Date.now();
  await send('Page.navigate', { url });
  await waitFor(
    () => evaluate("Boolean(window.__dshGame && document.getElementById('tap-gate'))"),
    30000,
    'game boot',
  );
  // 从导航到「可交互」的毫秒数：引擎走 CDN 之后这个数才回到秒级
  report.bootMs = Date.now() - navStart;
  await sleep(1200);
  await shot('p1-gate');
  report.beforeTap = await evaluate(`(() => {
    const g = document.getElementById('tap-gate');
    return { display: getComputedStyle(g).display, opacity: getComputedStyle(g).opacity };
  })()`);

  // 1) 点一下引导层
  await tap(195, 422);
  await sleep(1800);
  report.afterGateTap = await evaluate(`(() => {
    const gate = window.__dshGate || {};
    const g = document.getElementById('tap-gate');
    return {
      tapped: gate.tapped,
      rotated: gate.rotated,
      locked: gate.locked,
      fullscreen: gate.fullscreen,
      htmlClass: document.documentElement.className,
      gateDisplay: g ? getComputedStyle(g).display : 'gone',
      scenes: window.__dshGame.scene.getScenes(true).map((s) => s.scene.key),
      center: gate.map ? gate.map(195, 422) : null,
    };
  })()`);
  await shot('p2-after-gate');

  // 网络账本：首屏到底发了多少个请求、哪些最慢。
  // 只有在隧道/弱网下跑才有意义——那时 bootMs 里大半是「每个请求的往返」而不是字节数。
  report.net = await evaluate(`(() => {
    const rs = performance.getEntriesByType('resource').map((r) => ({
      n: r.name.replace(/^https?:\\/\\/[^/]+\\//, '').slice(-34),
      ms: Math.round(r.duration),
      kb: Math.round((r.transferSize || 0) / 102.4) / 10,
    }));
    const total = rs.reduce((a, b) => a + b.kb, 0);
    return {
      count: rs.length,
      totalKb: Math.round(total * 10) / 10,
      slowest: rs.slice().sort((a, b) => b.ms - a.ms).slice(0, 6),
    };
  })()`);

  report.geom = await evaluate(`(() => {
    const g = window.__dshGame;
    const c = g.canvas;
    const root = document.getElementById('game-root');
    const rr = root.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    const cs = getComputedStyle(root);
    return {
      displaySize: { w: g.scale.displaySize.width, h: g.scale.displaySize.height },
      canvasBounds: { l: g.scale.canvasBounds.left, t: g.scale.canvasBounds.top },
      offset: { l: c.offsetLeft, t: c.offsetTop },
      client: { w: c.clientWidth, h: c.clientHeight },
      canvasRect: { l: cr.left, t: cr.top, w: cr.width, h: cr.height },
      rootRect: { l: rr.left, t: rr.top, w: rr.width, h: rr.height },
      transform: cs.transform,
      padding: cs.padding,
      inner: { w: window.innerWidth, h: window.innerHeight },
      mapOfCenter: window.__dshGate.map(window.innerWidth / 2, window.innerHeight / 2),
    };
  })()`);

  // 2) 反查「开始」按钮（游戏坐标 240,152）在屏幕上的位置
  report.buttonHit = await evaluate(`(() => {
    const map = window.__dshGate.map;
    let best = null;
    for (let y = 4; y < window.innerHeight; y += 6) {
      for (let x = 4; x < window.innerWidth; x += 6) {
        const p = map(x, y);
        const d = Math.hypot(p.x - 240, p.y - 152);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    if (!best) return null;
    // 粗搜之后再细搜一遍：竖屏不旋转时画布很小，6px 一格对应到游戏内就是十几像素，会点不中
    const cx0 = best.x;
    const cy0 = best.y;
    for (let y = cy0 - 8; y <= cy0 + 8; y += 1) {
      for (let x = cx0 - 8; x <= cx0 + 8; x += 1) {
        if (x < 1 || y < 1 || x > window.innerWidth - 1 || y > window.innerHeight - 1) continue;
        const p = map(x, y);
        const d = Math.hypot(p.x - 240, p.y - 152);
        if (d < best.d) best = { x, y, d };
      }
    }
    return best;
  })()`);

  // 3) 真的点它
  if (report.buttonHit) {
    await tap(report.buttonHit.x, report.buttonHit.y);
    await sleep(1500);
  }
  report.afterButtonTap = await evaluate(`(() => ({
    scenes: window.__dshGame.scene.getScenes(true).map((s) => s.scene.key),
    pointer: {
      x: window.__dshGame.input.activePointer.x,
      y: window.__dshGame.input.activePointer.y,
    },
  }))()`);
  await shot('p3-after-button-tap');

  report.errors = errors;
  await writeFile(join(outDir, 'tap-probe.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));

  await send('Page.close').catch(() => {});
  proc.kill();
}

main()
  .catch(async (err) => {
    console.error('PROBE FAILED:', err.message);
    console.error('errors:', errors);
    await writeFile(join(outDir, 'tap-probe.json'), JSON.stringify({ error: err.message, errors }, null, 2), 'utf8');
    process.exitCode = 1;
  })
  .finally(async () => {
    await sleep(300);
    process.exit();
  });