// 主菜单（标题画面）现状探针：点掉引导层后抓取标题场景状态，定位「主菜单消失」。
// 用法：node tools/_cdp/title-check.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const CDP_PORT = 9462;
const HTTP_PORT = 9461;
const profile = join(outDir, '_profile-title-check');

if (!edgePath) {
  console.error('usage: node tools/_cdp/title-check.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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
        if (!file.startsWith(staticDir)) { res.writeHead(403).end(); return; }
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
        res.end(body);
      } catch { res.writeHead(404).end('not found'); }
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
      } catch { return null; }
    },
    20000,
    'devtools',
  );
  ws = new WebSocket(list);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl });
  await sleep(500);

  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await sleep(400);
  // 点掉引导层
  await evaluate(`(() => { const g=document.getElementById('tap-gate'); const b=g&&g.querySelector('.tg-go'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; })()`);

  // 等标题场景激活
  await waitFor(() => evaluate(`!!window.__dshGame && (window.__dshGame.scene.isActive('Title') || window.__dshGame.scene.isActive('Hub'))`), 40000, 'title-or-hub');
  await sleep(800);

  const snap = await evaluate(`(() => {
    const g = window.__dshGame;
    const scenes = g ? g.scene.getScenes(true).map(s=>s.scene.key) : [];
    const titleApi = window.__dshTitle;
    const titleBtns = titleApi ? (titleApi.list ? titleApi.list() : titleApi.buttons) : [];
    const domTitle = document.getElementById('dom-title');
    const gate = document.getElementById('tap-gate');
    const bootHint = document.getElementById('boot-hint');
    // canvas 标题页按钮：TitleScene 的 titleButtons（矩形 + 文字）
    let canvasBtns = [];
    try {
      const T = g.scene.getScene('Title');
      const objs = T.children.list.filter(o => o.type==='Rectangle' || o.type==='Text');
      canvasBtns = objs.map(o => ({ type:o.type, text: o.type==='Text'? o.text : null, x:Math.round(o.x), y:Math.round(o.y), visible:o.visible }));
    } catch(e) { canvasBtns = 'err:'+e.message; }
    return {
      scenes,
      titleApiPresent: !!titleApi,
      titleBtns,
      domTitleDisplay: domTitle ? getComputedStyle(domTitle).display : 'MISSING',
      domTitleChildren: domTitle ? Array.from(domTitle.children).map(c=>({t:c.textContent.slice(0,20), d:getComputedStyle(c).display})) : [],
      gateClass: gate ? gate.className : 'MISSING',
      gateDisplay: gate ? getComputedStyle(gate).display : 'MISSING',
      bootHintDisplay: bootHint ? getComputedStyle(bootHint).display : 'removed',
    };
  })()`);
  report.snapshots.title = snap;

  // 全屏截图（标题画面）
  await shot('title-full.png');

  // 判据
  report.checks.titleSceneActive = snap.scenes.includes('Title');
  report.checks.domTitleVisible = snap.domTitleDisplay === 'block';
  report.checks.menuButtonsPresent = Array.isArray(snap.titleBtns) && snap.titleBtns.length > 0;
  report.checks.gateDismissed = snap.gateDisplay === 'none' || /hidden/.test(snap.gateClass);

  report.verdict = {
    pass: report.checks.titleSceneActive && report.checks.domTitleVisible && report.checks.menuButtonsPresent && report.checks.gateDismissed,
    total: Object.keys(report.checks).length,
    failed: Object.entries(report.checks).filter(([, v]) => v === false).map(([k]) => k),
  };

  await writeFile(join(outDir, 'title-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    total: report.verdict.total,
    passed: report.verdict.total - report.verdict.failed.length,
    failed: report.verdict.failed,
    ok: report.verdict.pass,
    scenes: snap.scenes,
    domTitleDisplay: snap.domTitleDisplay,
    titleBtns: snap.titleBtns,
    errors: report.errors,
  }, null, 2));
} catch (e) {
  console.error('PROBE FAILED:', e?.message ?? e);
  report.errors.push(String(e?.message ?? e));
  try { await writeFile(join(outDir, 'title-check.json'), JSON.stringify(report, null, 2)); } catch {}
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  edge.kill('SIGKILL');
  if (server) await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
