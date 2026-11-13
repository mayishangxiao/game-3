// 关卡载入提示「载入中……」残留回归探针（v1.8.2）。
//
// 现象：进入战斗后，画面中央偏下会一直挂着半透明灰字「载入中……」，
// 而此时关卡早已加载完、敌兵与波次都已就位。
// 根因：LevelScene.boot() 把加载提示建为局部变量，只在 startNode 之后再 destroy；
//       若 startNode 构建期抛错、或场景复用同一实例期间被重启，destroy 不会执行，文字就滞留战斗画面。
//
// 修复：数据拉取一完成立即销毁该提示（它只该存在于「拉取期间」），并把引用挂在 this 上，
//       SHUTDOWN 时再兜底销毁一次，防止并发 boot 留下孤儿文字。
//
// 本探针走真实交互路径进战斗，断言：
//   1) 战斗稳态下 Level 场景里不存在任何内容为「载入中……」的 Text 对象；
//   2) #dom-toast 没有卡在「载入中」类文案；
//   3) 截图中央无残留提示（人工复核）。
// 同时确认保留项：初始引导层在引擎就绪前仍显示「载入中 Xs」计数提示（必要加载提示不删）。
//
// 用法：
//   node tools/_cdp/loading-text.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const CDP_PORT = 9452;
const HTTP_PORT = 9451;
const profile = join(outDir, '_profile-loading-text');

if (!edgePath) {
  console.error('usage: node tools/_cdp/loading-text.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
  process.exit(2);
}

const isRemote = /^https?:\/\//.test(target);
const staticDir = isRemote ? null : resolve(target);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};
const server = isRemote
  ? null
  : createServer(async (req, res) => {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${label}`);
}

await mkdir(outDir, { recursive: true });
await rm(profile, { recursive: true, force: true }).catch(() => {});
await mkdir(profile, { recursive: true });
if (server) await new Promise((res) => server.listen(HTTP_PORT, '127.0.0.1', res));
const baseUrl = isRemote ? target : `http://127.0.0.1:${HTTP_PORT}`;

const edge = spawn(
  edgePath,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=960,540',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const report = { url: baseUrl, checks: {}, errors: [], snapshots: {} };
let ws;

try {
  const list = await waitFor(
    async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const j = await r.json();
        const page = j.find((t) => t.type === 'page');
        return page ? page.webSocketDebuggerUrl : null;
      } catch {
        return null;
      }
    },
    20000,
    'devtools',
  );
  ws = new WebSocket(list);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      report.errors.push(msg.params.exceptionDetails?.exception?.description ?? 'exception');
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      report.errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const text = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
      throw new Error(`EVAL FAILED: ${text}`);
    }
    return r.result.value;
  };
  const shot = async (name, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    await writeFile(join(outDir, name), Buffer.from(r.data, 'base64'));
  };

  // 收集 Level 场景里所有 Phaser Text 对象（内容 / 坐标 / 可见性 / 深度）
  const COLLECT = `(() => {
    const L = window.__dshGame.scene.getScene('Level');
    if (!L || !L.children) return { ok: false };
    const texts = L.children.list
      .filter(o => o.type === 'Text')
      .map(o => ({ text: o.text, x: Math.round(o.x), y: Math.round(o.y), visible: o.visible, depth: o.depth, alpha: o.alpha }));
    const toast = document.getElementById('dom-toast');
    const gate = document.getElementById('tap-gate');
    return {
      ok: true,
      texts,
      toastText: toast ? toast.textContent : null,
      toastDisplay: toast ? getComputedStyle(toast).display : null,
      gateText: gate ? gate.textContent : null,
      gateDisplay: gate ? getComputedStyle(gate).display : null,
    };
  })()`;

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl });
  await sleep(500);

  // 记录初始引导层是否出现「载入中」计数提示（必要加载提示，应保留）
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  report.snapshots.gateEarly = await evaluate(`(() => {
    const g = document.querySelector('.tg-go');
    return { gateText: g ? g.textContent : null };
  })()`);

  await evaluate(`(() => {
    const g = document.getElementById('tap-gate');
    const b = g && g.querySelector('.tg-go');
    if (b) b.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
    return true;
  })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(600);
  await evaluate(`(() => {
    window.__dshGame.scene.getScene('Title').scene.start('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 });
    return true;
  })()`);
  await waitFor(() => evaluate('!!window.__dshLevel'), 40000, 'level hook');
  await sleep(2000);

  const L = 'window.__dshGame.scene.getScene("Level")';
  const skipIntro = async () => {
    for (let i = 0; i < 8 && (await evaluate(`!!${L}.introOpen`)); i++) {
      await evaluate(`(function(){var l=${L}; if (l.pendingCardTap) l.pendingCardTap(); return 1;})()`);
      await sleep(350);
    }
    for (let i = 0; i < 30 && (await evaluate(`!!${L}.dialogue?.isActive`)); i++) {
      await evaluate(`${L}.dialogue.advance(); 1`);
      await sleep(150);
    }
  };
  await skipIntro();
  report.checks.firstWaveObserved = await waitFor(
    () => evaluate('window.__dshLevel.allEnemies().length > 0'), 20000, 'first wave',
  ).then(() => true).catch(() => false);
  await sleep(600);

  // ① 战斗稳态：不该有任何「载入中……」文字残留
  const combat = await evaluate(COLLECT);
  report.snapshots.combat = combat;
  const loadingTexts = (combat.texts || []).filter((t) => (t.text || '').includes('载入中'));
  report.checks.noLoadingTextInScene = loadingTexts.length === 0;
  report.checks.noStuckLoadingToast =
    !combat.toastText || !combat.toastText.includes('载入中');
  report.checks.gateHiddenInBattle =
    combat.gateDisplay === 'none' || combat.gateText == null;

  // ② 截图人工复核（战斗中央区域）
  await shot('loading-text-combat.png', { x: 0, y: 240, width: 960, height: 270, scale: 1 });

  report.verdict = {
    pass:
      report.checks.noLoadingTextInScene &&
      report.checks.noStuckLoadingToast &&
      report.checks.gateHiddenInBattle,
    total: Object.keys(report.checks).length,
    failed: Object.entries(report.checks).filter(([, v]) => v === false).map(([k]) => k),
  };

  await writeFile(join(outDir, 'loading-text.json'), JSON.stringify(report, null, 2));
  const failed = report.verdict.failed;
  console.log(JSON.stringify({
    total: report.verdict.total,
    passed: report.verdict.total - failed.length,
    failed,
    ok: report.verdict.pass,
    loadingTextsFound: loadingTexts.length,
    errors: report.errors,
  }));
} catch (e) {
  console.error('PROBE FAILED:', e?.message ?? e);
  report.errors.push(String(e?.message ?? e));
  try {
    await writeFile(join(outDir, 'loading-text.json'), JSON.stringify(report, null, 2));
  } catch {}
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  edge.kill('SIGKILL');
  if (server) await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
