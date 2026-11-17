// 自动存档实拍探针（v2.9.4）
//
// 单测已经用假时钟锁了调度契约，这里补浏览器侧的三件事：
//   1) BootScene 真的把 AutoSaver 装上了（__dshAutoSave 钩子存在、start 已挂定时器）；
//   2) 打标后 900ms 真写 localStorage，且右上角小字闪出来；
//   3) 页面 pagehide 强制写一次——即使 localStorage 被外部改成哨兵，也会被内存存档盖回去。
//
// 用法：node tools/_cdp/auto-save.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_auto-save-out');
const CDP_PORT = 9507;
const HTTP_PORT = 9508;
const profile = join(outDir, '_profile');
const SAVE_KEY = 'dsp_save_v1';

if (!edgePath) {
  console.error('usage: node tools/_cdp/auto-save.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
  process.exit(2);
}
const isRemote = /^https?:\/\//.test(target);
const staticDir = isRemote ? null : resolve(target);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon',
};
const server = isRemote ? null : createServer(async (req, res) => {
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
if (server) await new Promise((res) => server.listen(HTTP_PORT, '127.0.0.1', res));
const baseUrl = isRemote ? target : `http://127.0.0.1:${HTTP_PORT}`;

const edge = spawn(edgePath, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=960,540', 'about:blank',
], { stdio: 'ignore' });
const report = { url: baseUrl, checks: {}, snapshots: {}, errors: [] };
let ws;
try {
  const list = await waitFor(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const j = await r.json();
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
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      report.errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception');
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      report.errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
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
  await send('Page.navigate', { url: baseUrl }); await sleep(500);
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await sleep(300);
  await evaluate(`(() => { const g=document.getElementById('tap-gate'); const b=g&&g.querySelector('.tg-go'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(900);

  // ---- 1. 钩子装上 ----
  const hook = await evaluate(`(() => ({
    has: !!window.__dshAutoSave,
    state: window.__dshAutoSave ? window.__dshAutoSave.state() : null,
  }))()`);
  report.snapshots.hook = hook;
  report.checks.hookInstalled = hook.has === true && !!hook.state;

  // 进第一幕，让 HUD 与小字提示处在实际游戏界面
  await evaluate(`(() => { window.__dshGame.scene.getScene('Title').scene.start('Level', { actId:'ch00_act1', chapterId:'ch00', startNode:0 }); return true; })()`);
  await waitFor(() => evaluate(`(() => { const l=window.__dshGame.scene.getScene('Level'); return !!(l && l.node && l.map); })()`), 40000, 'level');
  await sleep(500);

  // ---- 2. 打标 → 900ms 后写盘 + 小字提示 ----
  const before = await evaluate(`(() => ({ state: window.__dshAutoSave.state(), raw: localStorage.getItem('${SAVE_KEY}') }))()`);
  await evaluate(`window.__dshAutoSave.markDirty()`);
  const dirtyNow = await evaluate(`window.__dshAutoSave.state().dirty`);
  await sleep(300);
  const early = await evaluate(`window.__dshAutoSave.state()`);
  await sleep(900);
  const after = await evaluate(`(() => ({
    state: window.__dshAutoSave.state(),
    raw: localStorage.getItem('${SAVE_KEY}'),
    badge: (() => { const b=document.getElementById('dom-autosave'); return b && { text:b.textContent, display:b.style.display, z:b.parentElement?.id }; })(),
  }))()`);
  report.snapshots.debounce = { before: before.state, dirtyNow, early, after: after.state, badge: after.badge };
  report.checks.markDirtySetsFlag = dirtyNow === true;
  report.checks.notWrittenBeforeDebounce = early.dirty === true && early.lastSaved === before.state.lastSaved;
  report.checks.writtenAfterDebounce = after.state.dirty === false && after.state.lastSaved > before.state.lastSaved;
  report.checks.saveOnDisk = !!after.raw && JSON.parse(after.raw).version === 1;
  report.checks.badgeShown = !!after.badge && after.badge.display === 'block' && after.badge.text.includes('自动存档') && after.badge.z === 'dom-hud';
  await shot('auto-save-badge.png');

  // ---- 3. 同步写过后立刻 flush：不重复写、时间戳不再前进 ----
  const dedupe = await evaluate(`(() => {
    const a = window.__dshAutoSave;
    a.markDirty();
    a.flush();
    const t1 = a.state().lastSaved;
    a.flush();
    return { t1, t2: a.state().lastSaved, dirty: a.state().dirty };
  })()`);
  report.snapshots.dedupe = dedupe;
  report.checks.flushNoDoubleWrite = dedupe.t1 === dedupe.t2 && dedupe.dirty === false;

  // ---- 4. 页面隐藏前强制写：外部把磁盘改成哨兵，pagehide 后必须从内存恢复 ----
  const beforeHide = await evaluate(`(() => { localStorage.setItem('${SAVE_KEY}', '{"version":0,"sentinel":true}'); return localStorage.getItem('${SAVE_KEY}'); })()`);
  await evaluate(`window.dispatchEvent(new Event('pagehide'))`);
  await sleep(250);
  const afterHide = await evaluate(`(() => ({ raw: localStorage.getItem('${SAVE_KEY}'), state: window.__dshAutoSave.state() }))()`);
  report.snapshots.pagehide = { beforeHide, afterHide };
  report.checks.pagehideForceWrite = beforeHide.includes('sentinel') && !!afterHide.raw && JSON.parse(afterHide.raw).version === 1 && !afterHide.raw.includes('sentinel');

  report.checks.noConsoleErrors = report.errors.length === 0;
  const failed = Object.entries(report.checks).filter(([, v]) => v !== true).map(([k]) => k);
  report.ok = failed.length === 0;
  report.failed = failed;
  await writeFile(join(outDir, 'auto-save.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, failed, errors: report.errors }, null, 2));
  process.exitCode = report.ok ? 0 : 1;
} catch (e) {
  report.ok = false;
  report.fatal = String((e && e.stack) || e);
  await writeFile(join(outDir, 'auto-save.json'), JSON.stringify(report, null, 2));
  console.error(report.fatal);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { edge.kill(); } catch { /* ignore */ }
  try { server?.close(); } catch { /* ignore */ }
}
