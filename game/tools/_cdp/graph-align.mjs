// 知识图谱排版对齐探针（2026-11-13「右下角字体没对齐」）。
//
// 现象：GraphScene 的「返回」按钮底板画在 canvas 上，文字却由 #dom-overlay 用另一套
//       硬编码 px 定位；同时底部 hint 与右上进度也在同一层里各自写死坐标。
//       两层数值不一致时，右下角（离原点最远）错位最明显：文字偏出紫色底板、
//       与底部提示挤在一起，甚至被 overflow:hidden 裁掉。
//
// 本探针在真实浏览器里量 **canvas 底板** 与 **DOM 文字** 的屏幕位置，统一换算回
// 480×270 逻辑坐标比较，并顺带检查 hint / 进度是否在覆盖层可视范围内。
//
// 断言（6 项）：
//   1) backPlateFound       —— 找到 canvas 上那块「返回」底板
//   2) backLabelCentered    —— 「返回」文字中心与底板中心偏差 ≤1.5 逻辑 px
//   3) backLabelInsidePlate —— 文字盒完整落在底板内
//   4) hintNoOverlap        —— 底部提示与按钮底板不重叠
//   5) hintFullyVisible     —— 底部提示未被覆盖层裁切
//   6) progressFullyVisible —— 右上进度未被覆盖层裁切
//   7) longHintClearOfBack  —— 长提示（含「继续连…」与通关文案）的真实文字范围
//                              不横向钻进「返回」按钮所在的区域
//
// 用法：
//   node tools/_cdp/graph-align.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_graph-align-out');
const CDP_PORT = 9486;
const HTTP_PORT = 9485;
const profile = join(outDir, '_profile');
const VIEWPORTS = [
  { w: 1100, h: 582, tag: 'wide' },   // 用户截图的比例（比 16:9 更扁）
  { w: 960, h: 540, tag: '16x9' },    // 标准 16:9 对照
];

if (!edgePath) {
  console.error('usage: node tools/_cdp/graph-align.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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

const edge = spawn(edgePath, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-gpu','--window-size=1100,582','about:blank'], { stdio: 'ignore' });
const report = { url: baseUrl, viewports: {}, checks: {}, errors: [] };
let ws;
try {
  const pageUrl = await waitFor(async () => { try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); const j = await r.json(); const p = j.find((t) => t.type === 'page'); return p ? p.webSocketDebuggerUrl : null; } catch { return null; } }, 20000, 'devtools');
  ws = new WebSocket(pageUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') report.errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception');
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') report.errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) { const text = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text; throw new Error(`EVAL FAILED: ${text}`); } return r.result.value; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(outDir, name), Buffer.from(r.data, 'base64')); };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: baseUrl }); await sleep(500);
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await sleep(300);
  await evaluate(`(() => { const g=document.getElementById('tap-gate'); const b=g&&g.querySelector('.tg-go'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(500);

  // 直接切到知识图谱（Hub 里的「图谱」按钮走的是同一个 scene.start('Graph')）
  await evaluate(`(() => { window.__dshGame.scene.getScene('Title').scene.start('Graph'); return true; })()`);
  await waitFor(() => evaluate(`(() => { const o=document.getElementById('dom-overlay'); return !!(o && o.style.display==='block' && o.textContent.includes('知识图谱')); })()`), 40000, 'graph overlay');
  await sleep(500);

  const measure = `(() => {
    const VW = 480, VH = 270;
    const canvas = document.querySelector('#game-root canvas');
    const overlay = document.getElementById('dom-overlay');
    if (!canvas || !overlay) return { error: 'no canvas/overlay' };
    const cr = canvas.getBoundingClientRect();
    const or = overlay.getBoundingClientRect();
    // 屏幕 px -> 480×270 逻辑 px（canvas 用 Scale.FIT，内部即 480×270）
    const toLogical = (r) => ({
      left: ((r.left - cr.left) / cr.width) * VW,
      right: ((r.right - cr.left) / cr.width) * VW,
      top: ((r.top - cr.top) / cr.height) * VH,
      bottom: ((r.bottom - cr.top) / cr.height) * VH,
      cx: ((r.left + r.right) / 2 - cr.left) / cr.width * VW,
      cy: ((r.top + r.bottom) / 2 - cr.top) / cr.height * VH,
    });
    const divs = [...overlay.querySelectorAll('div')];
    const pick = (pred) => divs.find(pred);
    const back = pick((d) => d.dataset.graphBack === '1') || pick((d) => d.textContent.trim() === '返回');
    const hintText = window.__dshGame.scene.getScene('Graph') && window.__dshGame.scene.getScene('Graph').hintText;
    const hint = pick((d) => d.dataset.graphHint === '1') || pick((d) => hintText && d.textContent.trim() === hintText.trim());
    const progress = pick((d) => d.dataset.graphProgress === '1') || pick((d) => /条因果$/.test(d.textContent.trim()));

    // canvas 上的「返回」底板：GraphScene.buildHeader() 里唯一的 Rectangle
    const g = window.__dshGame.scene.getScene('Graph');
    const plate = g && g.children && g.children.list.find((o) => o.type === 'Rectangle');
    const plateLogical = plate ? {
      left: plate.x - plate.width / 2, right: plate.x + plate.width / 2,
      top: plate.y - plate.height / 2, bottom: plate.y + plate.height / 2,
      cx: plate.x, cy: plate.y,
    } : null;

    return {
      canvas: { cssW: canvas.clientWidth, cssH: canvas.clientHeight, rect: { left: cr.left, top: cr.top, width: cr.width, height: cr.height } },
      overlay: { transform: getComputedStyle(overlay).transform, width: overlay.style.width, height: overlay.style.height, rect: { left: or.left, top: or.top, width: or.width, height: or.height } },
      plate: plateLogical,
      back: back ? toLogical(back.getBoundingClientRect()) : null,
      hint: hint ? toLogical(hint.getBoundingClientRect()) : null,
      progress: progress ? toLogical(progress.getBoundingClientRect()) : null,
      hintText, progressText: progress ? progress.textContent.trim() : null,
    };
  })()`;

  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false });
    await sleep(700); // 等 resize 后 syncDomUiToCanvas / scaleOverlay 重算
    const m = await evaluate(measure);
    report.viewports[vp.tag] = m;
    await shot(`ga-${vp.tag}.png`);
  }

  // 长提示检查：用户报障时底部正是「继续连：这两件事在历史上确实有因果」。
  // 用 Range 量**文字真实宽度**（而不是 width:100% 的整行盒），确认它没钻到按钮底下。
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 582, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  report.longHints = await evaluate(`(() => {
    const g = window.__dshGame.scene.getScene('Graph');
    const overlay = document.getElementById('dom-overlay');
    const cr = document.querySelector('#game-root canvas').getBoundingClientRect();
    const original = g.hintText;
    const cases = [
      '继续连：这两件事在历史上确实有因果',
      '这张图连完了——1840 年以来的每一次失败与转向，都在同一条线上。',
      '提示：顺着「一件事导致了下一件事」去找',
    ];
    const out = [];
    for (const text of cases) {
      g.hintText = text;
      g.redraw();
      const h = overlay.querySelector('[data-graph-hint]') ||
        [...overlay.querySelectorAll('div')].find((d) => d.textContent.trim() === text);
      if (!h) { out.push({ text, error: 'hint element not found' }); continue; }
      const range = document.createRange();
      range.selectNodeContents(h);
      const r = range.getBoundingClientRect();
      out.push({
        text,
        left: +(((r.left - cr.left) / cr.width) * 480).toFixed(2),
        right: +(((r.right - cr.left) / cr.width) * 480).toFixed(2),
        top: +(((r.top - cr.top) / cr.height) * 270).toFixed(2),
        bottom: +(((r.bottom - cr.top) / cr.height) * 270).toFixed(2),
      });
    }
    // 留最长那条在屏上给实拍复核，稍后由外层恢复
    g.hintText = cases[1];
    g.redraw();
    window.__graphAlignOriginalHint = original;
    return out;
  })()`);
  report.checks.longHintClearOfBack = report.longHints.every(
    (h) => !h.error && h.right <= 396 && h.bottom <= 270.5 && h.top >= 0,
  );
  await shot('ga-long-hint.png');
  await evaluate(`(() => { const g=window.__dshGame.scene.getScene('Graph'); g.hintText=window.__graphAlignOriginalHint; g.redraw(); return true; })()`);

  // 判定只取宽视口（用户截图场景），两种视口都记录数据便于对照
  const m = report.viewports.wide;
  if (!m || m.error) throw new Error(`measure failed: ${m && m.error}`);
  const plate = m.plate, back = m.back;
  report.checks.backPlateFound = !!plate;
  report.checks.backLabelCentered = !!(plate && back && Math.abs(back.cx - plate.cx) <= 1.5 && Math.abs(back.cy - plate.cy) <= 1.5);
  report.checks.backLabelInsidePlate = !!(plate && back && back.left >= plate.left - 0.5 && back.right <= plate.right + 0.5 && back.top >= plate.top - 0.5 && back.bottom <= plate.bottom + 0.5);
  const overlap = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  report.checks.hintNoOverlap = !!(m.hint && plate && !overlap(m.hint, plate));
  report.checks.hintFullyVisible = !!(m.hint && m.hint.top >= 0 && m.hint.bottom <= 270.5 && m.hint.left >= -0.5 && m.hint.right <= 480.5);
  report.checks.progressFullyVisible = !!(m.progress && m.progress.top >= 0 && m.progress.bottom <= 270.5 && m.progress.left >= -0.5 && m.progress.right <= 480.5);
  report.delta = plate && back ? { dx: +(back.cx - plate.cx).toFixed(2), dy: +(back.cy - plate.cy).toFixed(2) } : null;
  report.passed = Object.values(report.checks).filter(Boolean).length;
  report.total = Object.keys(report.checks).length;
  report.failed = Object.entries(report.checks).filter(([, v]) => !v).map(([k]) => k);
  report.ok = report.failed.length === 0 && report.errors.length === 0;
  ws.close();
} catch (e) {
  report.errors.push(String(e && e.stack ? e.stack : e));
  report.ok = false;
} finally {
  try { edge.kill(); } catch { /* 已退出 */ }
  await sleep(300);
  if (server) server.close();
  try { await rm(profile, { recursive: true, force: true }); } catch { /* 清理失败不影响结果 */ }
  await writeFile(join(outDir, 'graph-align.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, passed: report.passed, total: report.total, failed: report.failed, delta: report.delta, errors: report.errors }, null, 2));
  process.exit(report.ok ? 0 : 1);
}
