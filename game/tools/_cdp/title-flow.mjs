// 主菜单链路探针：标题 → 进战斗 → 暂停（含「返回主菜单」）→ 返回主菜单 → 再回标题。
// 用于确认 v1.8.x 改动没有破坏标题/暂停/回标题流程。
// 用法：node tools/_cdp/title-flow.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const CDP_PORT = 9472;
const HTTP_PORT = 9471;
const profile = join(outDir, '_profile-title-flow');

if (!edgePath) {
  console.error('usage: node tools/_cdp/title-flow.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
  process.exit(2);
}
const isRemote = /^https?:\/\//.test(target);
const staticDir = isRemote ? null : resolve(target);
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png' };
const server = isRemote ? null : createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = normalize(p.replace(/^\/+/, '')).replace(/^(\.\.[/\\])+/, '');
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
  while (Date.now() - t0 < timeout) { const v = await fn(); if (v) return v; await sleep(150); }
  throw new Error(`timeout waiting for ${label}`);
}
await mkdir(outDir, { recursive: true });
await rm(profile, { recursive: true, force: true }).catch(() => {});
await mkdir(profile, { recursive: true });
if (server) await new Promise((res) => server.listen(HTTP_PORT, '127.0.0.1', res));
const baseUrl = isRemote ? target : `http://127.0.0.1:${HTTP_PORT}`;

const edge = spawn(edgePath, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-gpu','--window-size=960,540','about:blank'], { stdio: 'ignore' });
const report = { url: baseUrl, checks: {}, errors: [], snapshots: {} };
let ws;
try {
  const list = await waitFor(async () => { try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); const j = await r.json(); const page = j.find((t) => t.type === 'page'); return page ? page.webSocketDebuggerUrl : null; } catch { return null; } }, 20000, 'devtools');
  ws = new WebSocket(list);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result); } else if (m.method === 'Runtime.exceptionThrown') { report.errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception'); } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { report.errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) { const text = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text; throw new Error(`EVAL FAILED: ${text}`); } return r.result.value; };
  const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) }); await writeFile(join(outDir, name), Buffer.from(r.data, 'base64')); };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl }); await sleep(500);
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await sleep(300);
  await evaluate(`(() => { const g=document.getElementById('tap-gate'); const b=g&&g.querySelector('.tg-go'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(700);

  // ① 标题页：按钮列表 + dom-title 可见
  const title0 = await evaluate(`(() => {
    const a = window.__dshTitle; const btns = a ? (a.list ? a.list() : a.buttons) : [];
    const dt = document.getElementById('dom-title');
    return { btns, domTitle: dt ? getComputedStyle(dt).display : 'MISSING', scenes: window.__dshGame.scene.getScenes(true).map(s=>s.scene.key) };
  })()`);
  report.snapshots.titleInitial = title0;
  report.checks.titleShown = title0.domTitle === 'block' && Array.isArray(title0.btns) && title0.btns.length >= 1;
  await shot('tf-1-title.png');

  // ② 直接进战斗（跳过 Hub 导航复杂性）
  await evaluate(`(() => { window.__dshGame.scene.getScene('Title').scene.start('Level', { actId:'ch00_act1', chapterId:'ch00', startNode: 2 }); return true; })()`);
  await waitFor(() => evaluate('!!window.__dshLevel'), 40000, 'level');
  await sleep(1500);
  // 关掉开场卡/对白
  for (let i=0;i<8 && await evaluate('!!window.__dshLevel.introOpen');i++){ await evaluate('(function(){var l=window.__dshLevel; if(l.pendingCardTap) l.pendingCardTap(); return 1;})()'); await sleep(300); }
  for (let i=0;i<30 && await evaluate('!!window.__dshLevel.dialogue?.isActive');i++){ await evaluate('window.__dshLevel.dialogue.advance(); 1'); await sleep(120); }
  await sleep(500);

  // ③ 打开暂停菜单（直接调 UIScene 私有方法，运行时不限访问）
  const pauseState = await evaluate(`(() => {
    const ui = window.__dshGame.scene.getScene('UI');
    if (!ui) return { ok:false, reason:'no UI scene' };
    ui.openPause();
    const ov = document.getElementById('dom-overlay');
    const txt = ov ? ov.textContent : '';
    return { ok:true, overlayDisplay: ov?getComputedStyle(ov).display:'none', hasBackToTitle: txt.includes('返回主菜单'), hasContinue: txt.includes('继'), pauseOpen: ui.pauseOpen };
  })()`);
  report.snapshots.pause = pauseState;
  report.checks.pauseMenuHasBackToTitle = !!(pauseState.ok && pauseState.hasBackToTitle && pauseState.overlayDisplay === 'block');
  await shot('tf-2-pause.png');

  // ④ 点「返回主菜单」
  const back = await evaluate(`(() => {
    const ui = window.__dshGame.scene.getScene('UI');
    ui.backToTitle();
    return true;
  })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 20000, 'title-after-back');
  await sleep(800);
  const title1 = await evaluate(`(() => {
    const a = window.__dshTitle; const btns = a ? (a.list ? a.list() : a.buttons) : [];
    const dt = document.getElementById('dom-title');
    return { btns, domTitle: dt ? getComputedStyle(dt).display : 'MISSING', scenes: window.__dshGame.scene.getScenes(true).map(s=>s.scene.key) };
  })()`);
  report.snapshots.titleAfterBack = title1;
  report.checks.backToTitleWorks = title1.scenes.includes('Title') && title1.domTitle === 'block' && Array.isArray(title1.btns) && title1.btns.length >= 1;
  await shot('tf-3-title-after-back.png');

  report.verdict = { pass: report.checks.titleShown && report.checks.pauseMenuHasBackToTitle && report.checks.backToTitleWorks, total: Object.keys(report.checks).length, failed: Object.entries(report.checks).filter(([,v])=>v===false).map(([k])=>k) };
  await writeFile(join(outDir, 'title-flow.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.verdict.pass, checks: report.checks, errors: report.errors }, null, 2));
} catch (e) {
  console.error('PROBE FAILED:', e?.message ?? e);
  report.errors.push(String(e?.message ?? e));
  try { await writeFile(join(outDir, 'title-flow.json'), JSON.stringify(report, null, 2)); } catch {}
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  edge.kill('SIGKILL');
  if (server) await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
