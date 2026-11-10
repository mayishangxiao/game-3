/**
 * 「天京经营」闪一下就没了 —— 回归探针（v1.6.2）。
 *
 * 复现路径：第二幕 node 0（金田突围 / escort）把玩家直接推到终点，
 * 引擎会 completeNode() → 500ms 后 startNode(1)（天京经营 / management）。
 * 旧版在这 500ms 的异步换图窗口里，mode 仍是 escort、玩家还在终点，
 * 护送完成判定会二次触发 completeNode()，于是经营面板只活半秒就跳到内讧幕。
 *
 * 断言：经营面板出现后，5 秒采样窗口里始终停留在 management，
 *       不进下一节点、不把经营节点标记完成、不出现「护送出 0/0」的重复 toast。
 *
 * Usage: node tools/_cdp/management-flash.mjs <edgePath> [staticDir] [outDir]
 *   staticDir 默认 dist（vite build 产物，base 是 './'，可直接静态托管）。
 * 脚本自带静态服务器与 headless Edge，不依赖任何常驻预览进程。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edge = process.argv[2];
const staticDir = resolve(process.argv[3] ?? 'dist');
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/management-flash');
const httpPort = 9417;
const cdpPort = 9418;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = normalize(pathname.replace(/^\/+/, '')).replace(/^(\.\.[/\\])+/, '');
    const file = resolve(staticDir, rel === '' || rel === '.' ? 'index.html' : rel);
    if (!file.startsWith(staticDir)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

const errors = [];
const report = { checks: {}, meta: { staticDir } };
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
  if (r?.result?.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('evaluate threw: ' + (d?.exception?.description ?? JSON.stringify(d)).slice(0, 300));
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
  if (r?.result?.data) await writeFile(join(outDir, name), Buffer.from(r.result.data, 'base64'));
}

function assert(cond, label) {
  report.checks[label] = !!cond;
  if (!cond) errors.push('ASSERT FAILED: ' + label);
}

async function gotoScene(key, data = {}) {
  await evaluate(`
    (function () {
      var g = window.__dshGame;
      ['Title','Hub','Level','UI','Equipment','Graph','Codex','Quiz'].forEach(function (k) {
        var s = g.scene.getScene(k);
        if (s && s.scene.isActive()) g.scene.stop(k);
      });
      return 'ok';
    })()
  `);
  await sleep(400);
  await evaluate(`window.__dshGame.scene.start(${JSON.stringify(key)}, ${JSON.stringify(data)}), 'ok'`);
  await waitFor(
    async () =>
      await evaluate(
        `(function () { var s = window.__dshGame.scene.getScene(${JSON.stringify(key)}); return !!(s && s.scene.isActive()); })()`,
      ),
    15000,
    key + ' active',
  );
}

async function openGame(first) {
  if (!first) await send('Page.reload', { ignoreCache: true });
  await waitFor(async () => await evaluate("!!document.getElementById('tap-gate')"), 25000, 'gate');
  await evaluate("document.getElementById('tap-gate').click(), 'ok'");
  await waitFor(async () => await evaluate('!!window.__dshGame'), 40000, 'ready');
  await evaluate(
    "(function(){var g=document.getElementById('tap-gate'); if(g){g.style.display='none';} return 'ok';})()",
  );
  await sleep(700);
}

/** 把开场对白 / 情境卡读掉，否则 updateWorld 会在对白处提前 return */
async function clearAll(maxTries = 25) {
  for (let i = 0; i < maxTries; i++) {
    const busy = await evaluate(`
      (function () {
        var l = window.__dshGame.scene.getScene('Level');
        if (l.dialogue && l.dialogue.isActive) { l.dialogue.advance(); return 'dlg'; }
        if (l.pendingCardTap) { l.pendingCardTap(); return 'card'; }
        return 'idle';
      })()
    `);
    if (busy === 'idle') return;
    await sleep(150);
  }
}

const SNAPSHOT = `
  (function () {
    var g = window.__dshGame;
    var l = g.scene.getScene('Level');
    var ui = g.scene.getScene('UI');
    var toast = document.querySelector('#dom-toast');
    return {
      mode: l.mode,
      nodeId: l.node && l.node.id,
      nodeIndex: l.nodeIndex,
      nodeBusy: l.nodeBusy,
      transitioning: l.transitioning,
      panel: !!(l.manageUI && l.manageUI.active),
      month: l.manage ? l.manage.month : null,
      allies: l.allies ? l.allies.length : -1,
      playerX: l.player ? l.player.x : null,
      goalX: l.escortGoalX,
      nodeMode: l.node && l.node.params ? l.node.params.mode : null,
      dialogueActive: !!(l.dialogue && l.dialogue.isActive),
      nodesDone: l.save.progress.nodes_done.slice(),
      toast: [toast && toast.style.display !== 'none' ? toast.textContent : '',
              ui && ui.toastText ? ui.toastText.text : ''].join(' | '),
      overlay: (document.querySelector('#dom-overlay') || {}).textContent || ''
    };
  })()
`;

async function main() {
  if (!edge) throw new Error('usage: node management-flash.mjs <edgePath> [staticDir] [outDir]');
  await mkdir(outDir, { recursive: true });
  await new Promise((res) => server.listen(httpPort, '127.0.0.1', res));
  const baseUrl = `http://127.0.0.1:${httpPort}`;
  const profile = join(outDir, 'profile');
  const proc = spawn(
    edge,
    [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=980,600',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
      } catch {
        /* not up */
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
    await send('Emulation.setDeviceMetricsOverride', {
      width: 960,
      height: 540,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Page.navigate', { url: baseUrl + '/index.html' });
    await openGame(true);
    await openGame(false);

    await gotoScene('Level', { actId: 'ch00_act2', chapterId: 'ch00', startNode: 0 });
    await clearAll();
    await waitFor(
      async () =>
        await evaluate(
          "(function(){var l=window.__dshGame.scene.getScene('Level'); return !!(l.player && l.mode==='escort' && !l.nodeBusy && l.allies.length>0 && l.escortGoalX>0);})()",
        ),
      25000,
      'escort ready',
    );
    // 开场对白是在节点就绪的同一帧才创建的，第一次 clearAll 可能扑空。
    // 对白开着时 updateWorld 会提前 return，护送判定根本不跑 —— 这里必须再清一次。
    await clearAll();
    await waitFor(
      async () =>
        await evaluate(
          "(function(){var l=window.__dshGame.scene.getScene('Level'); return !(l.dialogue && l.dialogue.isActive) && !l.pendingCardTap;})()",
        ),
      8000,
      'intro dialogue closed',
    );

    const start = await evaluate(SNAPSHOT);
    report.start = start;
    assert(start.mode === 'escort' && start.allies > 0, 'escort node is live with allies');
    assert(!start.dialogueActive, 'intro dialogue cleared before pushing player');

    // 把玩家直接送到突围终点，触发正常的 completeNode → startNode(1)
    const pushed = await evaluate(`
      (function () {
        var l = window.__dshGame.scene.getScene('Level');
        l.player.rig.setPosition(l.escortGoalX + 4, l.player.y);
        return { x: l.player.x, goal: l.escortGoalX };
      })()
    `);
    report.pushed = pushed;
    assert(pushed.x >= pushed.goal, 'player placed at the escort goal');

    const samples = [];
    const t0 = Date.now();
    for (let i = 0; i < 48; i++) {
      samples.push({ t: Date.now() - t0, ...(await evaluate(SNAPSHOT)) });
      if (i === 28) await shot('management-hold.png');
      await sleep(100);
    }
    report.samples = samples;
    report.timeline = samples
      .map((s) => `${s.t}ms ${s.nodeId} ${s.mode} panel=${s.panel} busy=${s.nodeBusy} trans=${s.transitioning}`)
      .filter((v, i, a) => i === 0 || v.slice(v.indexOf(' ') + 1) !== a[i - 1].slice(a[i - 1].indexOf(' ') + 1));

    const reached = samples.some((s) => s.mode === 'management' && s.panel);
    const last = samples[samples.length - 1];
    const skipped = samples.some((s) => s.nodeId === 'nd_1856_intrigue');
    const zeroToast = samples.some((s) => /护送出 0\/0/.test(s.toast));
    const managementSamples = samples.filter((s) => s.mode === 'management');
    const firstManageAt = managementSamples.length ? managementSamples[0].t : null;

    report.summary = {
      reachedManagement: reached,
      firstManagementAtMs: firstManageAt,
      managementSamples: managementSamples.length,
      windowMs: last.t,
      skippedToNextNode: skipped,
      sawZeroZeroToast: zeroToast,
      final: last,
    };

    assert(reached, 'management panel actually appears');
    assert(last.mode === 'management' && last.panel, 'management panel still open at end of window');
    assert(last.nodeId === 'nd_1853_tianjing_manage', 'still on the management node');
    assert(!last.nodeBusy && !last.transitioning, 'node is fully ready (no stuck gate)');
    assert(!skipped, 'does NOT skip ahead to the intrigue node');
    assert(!last.nodesDone.includes('nd_1853_tianjing_manage'), 'management node not auto-marked done');
    assert(!zeroToast, 'no duplicate escort toast (0/0 survivors)');
    assert(managementSamples.length >= 30, 'management panel holds for >= 3s of samples');
    assert(/天京经营/.test(last.overlay), 'management overlay text is visible');
    // 实拍前把开场对白框收起来（玩家点掉对白后的实际画面）。只改 DOM 显示，
    // 不推进 dialogue 状态，免得 advance() 触发节点剧情影响本节断言。
    await evaluate(
      "(function(){var d=document.querySelector('#dom-dialogue'); if(d){d.style.display='none';} return 'ok';})()",
    );
    await shot('management-final.png');

    // ── v1.6.3：DOM 文字层几何断言（竖屏甲方截图「字配歪了」）
    // overlay 里的文字盒用 480×270 逻辑坐标绝对定位；canvas 图元也用同一套坐标。
    // 旧版确认按钮文字 left:200（中心 260），红色按钮中心却是 200，整行字偏出 60px。
    const layout = await evaluate(`
      (function () {
        var ov = document.querySelector('#dom-overlay');
        if (!ov) return null;
        var boxes = Array.prototype.slice.call(ov.children).map(function (el) {
          var s = el.style;
          return {
            text: (el.textContent || '').trim().slice(0, 24),
            left: parseFloat(s.left) || 0,
            top: parseFloat(s.top) || 0,
            width: parseFloat(s.width) || 0,
            height: parseFloat(s.height) || 0,
            right: s.right || ''
          };
        });
        var hud = document.querySelector('#dom-hud-objective');
        return {
          boxes: boxes,
          confirm: boxes.find(function (b) { return b.text === '确认本月分配'; }) || null,
          hudObjectiveHidden: !hud || hud.style.display === 'none' || !(hud.textContent || '').trim()
        };
      })()
    `);
    report.layout = layout;
    assert(!!layout, 'overlay DOM text boxes are readable');
    if (layout) {
      assert(!layout.boxes.some((b) => b.right), 'no right-anchored box escaping the panel');
      assert(layout.boxes.every((b) => b.left + b.width <= 380), 'every text box stays inside panel right edge');
      assert(layout.boxes.every((b) => b.top + b.height <= 270), 'every text box stays inside the 480x270 canvas');
      assert(!!layout.confirm, 'confirm label is present in overlay');
      if (layout.confirm) {
        assert(layout.confirm.left === 140, 'confirm label starts at the button left edge (old: 200)');
        assert(layout.confirm.left + layout.confirm.width / 2 === 200, 'confirm label centred on red button');
        assert(layout.confirm.top + layout.confirm.height / 2 === 232, 'confirm label vertically centred');
      }
      assert(layout.hudObjectiveHidden, 'HUD objective bar no longer covers the third row');
    }

    // 竖屏旋转实拍：切到手机竖屏视口，让 OrientationGate 把整个画面转 90°。
    // 只出图不做硬断言（headless 的 screen.orientation 行为与真机不完全一致）。
    try {
      await send('Emulation.setDeviceMetricsOverride', {
        width: 480,
        height: 1068,
        deviceScaleFactor: 1,
        mobile: true,
      });
      // Phaser 的 ScaleManager 靠 resize 重算 canvas；headless 里补发一次，
      // 让旋转后的画面尽量铺满竖屏（真机由 orientationchange 自动触发）。
      await evaluate("window.dispatchEvent(new Event('resize')), 'ok'");
      await sleep(1200);
      await evaluate("window.dispatchEvent(new Event('resize')), 'ok'");
      await sleep(600);
      await shot('management-portrait.png');
      report.portraitShot = true;
    } catch (e) {
      report.portraitShot = String(e?.message ?? e).slice(0, 160);
    }
  } catch (e) {
    errors.push('FATAL: ' + String(e?.stack ?? e).slice(0, 600));
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    proc.kill();
    server.close();
    report.ok = errors.length === 0;
    report.errors = errors;
    report.checkSummary = {
      total: Object.keys(report.checks).length,
      passed: Object.values(report.checks).filter(Boolean).length,
    };
    await writeFile(join(outDir, 'management-flash.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        { ok: report.ok, checkSummary: report.checkSummary, errors, summary: report.summary, timeline: report.timeline },
        null,
        2,
      ),
    );
    if (!report.ok) process.exitCode = 1;
  }
}

main();
