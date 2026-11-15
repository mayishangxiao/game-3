// 开场「情境卡」排版体检（临时探针，不入库）：把四场战斗的开场卡逐张量一遍。
//
// 为什么要单开一个：hub-dynasty.mjs 只拍第三幕那一张，而这四张卡是同一段 DOM
// 拼出来的，文案长短不同。文字块一旦长过 top:252 的「点击开始战斗」，玩家看到的
// 就是「提示语被盖住 / 半截字落在屏幕外」——甲方截图里的「文字重叠」就是这么来的。
//
// 用法：node tools/_cdp/card-fit.mjs "<edgePath>" [staticDir] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const staticDir = resolve(process.argv[3] ?? 'dist');
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_card-fit-out');
const CDP_PORT = 9506;
const HTTP_PORT = 9505;
const profile = join(outDir, '_profile');
if (!edgePath) {
  console.error('usage: node tools/_cdp/card-fit.mjs "<edgePath>" [staticDir] [outDir]');
  process.exit(2);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = normalize(p.replace(/^\/+/, '')).replace(/^(\.\.[/\\])+/, '');
    const file = resolve(staticDir, rel === '' || rel === '.' ? 'index.html' : rel);
    if (!file.startsWith(staticDir)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = await fn(); if (v) return v; await sleep(150); }
  throw new Error(`timeout waiting for ${label}`);
}
await mkdir(outDir, { recursive: true });
await rm(profile, { recursive: true, force: true }).catch(() => {});
await mkdir(profile, { recursive: true });
await new Promise((res) => server.listen(HTTP_PORT, '127.0.0.1', res));
const baseUrl = `http://127.0.0.1:${HTTP_PORT}`;

const edge = spawn(edgePath, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=960,540', 'about:blank',
], { stdio: 'ignore' });

const report = { cards: [], errors: [] };
let ws;
try {
  const list = await waitFor(async () => {
    try {
      const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = j.find((t) => t.type === 'page');
      return page ? page.webSocketDebuggerUrl : null;
    } catch { return null; }
  }, 20000, 'devtools');
  ws = new WebSocket(list);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      report.errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception');
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`EVAL FAILED: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, name), Buffer.from(r.data, 'base64'));
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl }); await sleep(600);
  await evaluate('(() => { try { localStorage.clear(); } catch {} return true; })()').catch(() => {});
  await send('Page.reload', { ignoreCache: true });
  await sleep(800);
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await sleep(300);
  await evaluate(`(() => { const g=document.getElementById('tap-gate'); const b=g&&g.querySelector('.tg-go'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(400);

  const tap = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(320);
  };

  const cases = [
    { actId: 'ch00_act1', startNode: 2, name: 'act1-humen' },
    { actId: 'ch00_act3', startNode: 2, name: 'act3-jiawu' },
    { actId: 'ch00_act4', startNode: 2, name: 'act4-coup' },
    { actId: 'ch00_act5', startNode: 0, name: 'act5-wuchang' },
  ];

  for (const c of cases) {
    await evaluate(`(() => { window.__dshGame.scene.start('Level', { actId: '${c.actId}', chapterId: 'ch00', startNode: ${c.startNode} }); return true; })()`);
    await waitFor(() => evaluate(`window.__dshGame.scene.isActive('Level') && !!window.__dshGame.scene.getScene('Level').node`), 40000, `${c.name} node`);
    await sleep(1200);
    await shot(`${c.name}-card.png`);
    const geo = await evaluate(`(() => {
      const o = document.getElementById('dom-overlay');
      if (!o) return null;
      const box = o.getBoundingClientRect();
      const s = box.height / 270; // 2 倍缩放时把 CSS px 换回逻辑坐标
      const norm = (r) => ({
        top: Math.round((r.top - box.top) / s), bottom: Math.round((r.bottom - box.top) / s),
        left: Math.round((r.left - box.left) / s), right: Math.round((r.right - box.left) / s),
      });
      const nodes = [...o.querySelectorAll('div')].filter((d) => {
        if (d.closest('#dom-hint')) return false;
        // 只取「自己直接写着字」的那一层：行 div 里是 <span>标签</span>正文，
        // 按 innerText 判会把整行漏掉（第一版就这么量出 contentBottom=202 的假数）
        return [...d.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim());
      });
      const texts = nodes.map((d) => ({ text: (d.innerText || '').trim().slice(0, 40), ...norm(d.getBoundingClientRect()) }));
      const hintEl = document.getElementById('dom-hint');
      const hint = hintEl ? norm(hintEl.getBoundingClientRect()) : null;
      let overlaps = 0;
      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < texts.length; j++) {
          const a = texts[i], b = texts[j];
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps++;
        }
      }
      const contentBottom = texts.reduce((m, t) => Math.max(m, t.bottom), 0);
      const offscreen = texts.filter((t) => t.bottom > 270 || t.top < 0).map((t) => t.text);
      return { count: texts.length, texts, hint, overlaps, contentBottom, offscreen, hintClearance: hint ? hint.top - contentBottom : null };
    })()`);
    report.cards.push({ name: c.name, ...geo });
    await tap(480, 270);
    await sleep(400);
  }
} catch (e) {
  report.errors.push(String(e && e.message ? e.message : e));
} finally {
  try { ws?.close(); } catch {}
  try { edge.kill(); } catch {}
  try { server.close(); } catch {}
}
await writeFile(join(outDir, 'card-fit.json'), JSON.stringify(report, null, 2), 'utf8');
for (const c of report.cards) {
  console.log(`${c.name}: overlaps=${c.overlaps} contentBottom=${c.contentBottom} hintTop=${c.hint?.top} clearance=${c.hintClearance} offscreen=${c.offscreen.length}`);
}
if (report.errors.length) console.log('ERRORS', report.errors);
