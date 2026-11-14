// 战斗 UI／空气墙回归探针（2026-11-14「右侧被遮挡的按键」「空气墙看不清」）。
//
// 两个症状都在太平天国·天京陷落（ch00_act2 / 幕内 startNode 3）里量：
//   A) 右下「闪」键：CONTROL_LAYOUT.dodge 太靠下，视觉圆下缘压在底部 HUD 条上，
//      扁视口下还会被裁掉；本探针量视觉圆/命中区相对画布与 HUD 的位置，并派发
//      真实鼠标点击验证它仍能被点中（以及「攻」没被误伤）。
//   B) 空气墙：MapRenderer 对 tp_act2 图集跳过 paintWalls()，实心碰撞格只有普通
//      地面贴图、没有边界提示。本探针读地面 canvas 纹理，统计「实心→可走」交界
//      2px 带内的高亮描边像素，修复前基线≈0、修复后应显著增加；并拍局部实拍。
//
// 断言（8 项）：
//   1) battleReady           —— 进关成功、UI/Level/map 都拿到
//   2) dodgeFullyVisible     —— 「闪」视觉圆完整在 480×270 画布内
//   3) dodgeAboveHud         —— 「闪」视觉圆下缘不压底部 HUD 条
//   4) dodgeHitInsideCanvas  —— 「闪」命中区完整在画布内
//   5) dodgeCenterOwned      —— 「闪」圆心不会被别的按钮命中区抢走
//   6) dodgeClickWorks       —— 真实鼠标点「闪」圆心触发 dodge 回调
//   7) attackClickWorks      —— 真实鼠标点「攻」圆心仍触发 attack（没被改坏）
//   8) airwallEdgesMarked    —— 空气墙交界带里有高亮描边像素
//
// 用法：
//   node tools/_cdp/battle-ui.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_battle-ui-out');
const CDP_PORT = 9488;
const HTTP_PORT = 9487;
const profile = join(outDir, '_profile');
const VIEWPORTS = [
  { w: 1061, h: 484, tag: 'wide' },  // 用户截图的扁视口
  { w: 960, h: 540, tag: '16x9' },
];

if (!edgePath) {
  console.error('usage: node tools/_cdp/battle-ui.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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

const edge = spawn(edgePath, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-gpu','--window-size=1061,484','about:blank'], { stdio: 'ignore' });
const report = { url: baseUrl, viewports: {}, checks: {}, snapshots: {}, errors: [] };
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
  const shot = async (name, clip) => { const params = { format: 'png' }; if (clip) params.clip = { ...clip, scale: 1 }; const r = await send('Page.captureScreenshot', params); await writeFile(join(outDir, name), Buffer.from(r.data, 'base64')); };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: baseUrl }); await sleep(500);
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await sleep(300);
  await evaluate(`(() => { const g=document.getElementById('tap-gate'); const b=g&&g.querySelector('.tg-go'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(500);

  // 进真实的太平天国战斗关（幕内 index 3，不是全局 7）
  await evaluate(`(() => { window.__dshGame.scene.getScene('Title').scene.start('Level', { actId:'ch00_act2', chapterId:'ch00', startNode: 3 }); return true; })()`);
  await waitFor(() => evaluate(`(() => { const g=window.__dshGame, l=g.scene.getScene('Level'), ui=g.scene.getScene('UI'); return !!(window.__dshLevel && l && l.map && l.map.grid && ui && ui.inputSystem); })()`), 40000, 'battle ready');
  await sleep(900);
  // 防御：万一有开场卡挡着
  for (let i=0;i<8 && await evaluate('!!window.__dshLevel.introOpen');i++){ await evaluate('(function(){var l=window.__dshGame.scene.getScene("Level"); if(l.pendingCardTap) l.pendingCardTap(); return 1;})()'); await sleep(250); }
  report.checks.battleReady = true;

  // 给三个键的回调挂计数器（保留原行为，只额外记录）
  await evaluate(`(() => {
    const sys = window.__dshGame.scene.getScene('UI').inputSystem;
    window.__btnHits = { attack: 0, cannon: 0, dodge: 0 };
    for (const b of sys.buttons) {
      if (!window.__btnHits.hasOwnProperty(b.role)) continue;
      const orig = b.onDown;
      b.onDown = () => { window.__btnHits[b.role] += 1; orig(); };
    }
    return true;
  })()`);

  const measure = `(() => {
    const VW = 480, VH = 270, TILE = 16;
    const g = window.__dshGame;
    const canvas = document.querySelector('#game-root canvas');
    const cr = canvas.getBoundingClientRect();
    const lvl = g.scene.getScene('Level');
    const ui = g.scene.getScene('UI');
    const sys = ui.inputSystem;
    const strip = ui.hudStrip;
    const hudTop = strip ? strip.y - strip.height / 2 : null;
    const btns = sys.buttons.map((b) => ({ role: b.role, x: b.x, y: b.y, hitR: b.r }));
    // 视觉半径 = 命中半径 - HIT_PAD(8)
    const visualR = (b) => b.hitR - 8;
    const dodge = btns.find((b) => b.role === 'dodge');
    const attack = btns.find((b) => b.role === 'attack');
    const cannon = btns.find((b) => b.role === 'cannon');
    const ownerOf = (x, y) => {
      // 与 InputSystem.pick() 同顺序、同数学（按钮优先，再看摇杆）
      for (const b of btns) {
        if (b.role === 'interact' || (b.role === 'cannon' && !sys.cannonVisible)) continue;
        if (Math.hypot(x - b.x, y - b.y) <= b.hitR) return b.role;
      }
      return null;
    };
    // 空气墙：读地面 canvas 纹理，统计「实心→可走」交界 2px 带内的亮色描边像素
    const mr = lvl.map;
    const grid = mr.grid;
    const key = mr.groundKey;
    let edgePixels = 0, brightPixels = 0, innerSolid = 0;
    let texW = 0, texH = 0;
    if (key && g.textures.exists(key)) {
      const tex = g.textures.get(key);
      const ctx = tex.getContext && tex.getContext();
      if (ctx) {
        texW = ctx.canvas.width; texH = ctx.canvas.height;
        const data = ctx.getImageData(0, 0, texW, texH).data;
        // 描边色 PALETTE.greyLight #C2BCD1（194,188,209）；容差 ±6
        const isBright = (i) => Math.abs(data[i]-194) <= 6 && Math.abs(data[i+1]-188) <= 6 && Math.abs(data[i+2]-209) <= 6;
        const px = (x, y) => (y * texW + x) * 4;
        for (let gy = 1; gy < grid.rows - 1; gy++) {
          for (let gx = 1; gx < grid.cols - 1; gx++) {
            if (!grid.solid[gy][gx]) continue;
            innerSolid += 1;
            const bx = gx * TILE, by = gy * TILE;
            // 朝四个可走邻格的那条 2px 内边
            const sides = [
              !grid.solid[gy][gx-1] && [bx, bx+1, by, by+TILE-1],
              !grid.solid[gy][gx+1] && [bx+TILE-2, bx+TILE-1, by, by+TILE-1],
              !(grid.solid[gy-1]?.[gx] ?? true) && [bx, bx+TILE-1, by, by+1],
              !(grid.solid[gy+1]?.[gx] ?? true) && [bx, bx+TILE-1, by+TILE-2, by+TILE-1],
            ];
            for (const s of sides) {
              if (!s) continue;
              const [x0,x1,y0,y1] = s;
              for (let y=y0; y<=y1; y++) for (let x=x0; x<=x1; x++) {
                if (x<0||y<0||x>=texW||y>=texH) continue;
                edgePixels += 1;
                if (isBright(px(x,y))) brightPixels += 1;
              }
            }
          }
        }
      }
    }
    return {
      canvas: { rect: { left: cr.left, top: cr.top, width: cr.width, height: cr.height }, cssW: canvas.clientWidth, cssH: canvas.clientHeight },
      hudTop,
      buttons: btns.map((b) => ({ ...b, visualR: visualR(b), visualBottom: b.y + visualR(b), hitBottom: b.y + b.hitR, hitRight: b.x + b.hitR })),
      dodgeOwner: dodge ? ownerOf(dodge.x, dodge.y) : null,
      attackOwner: attack ? ownerOf(attack.x, attack.y) : null,
      cannonVisible: sys.cannonVisible,
      airwall: { innerSolid, edgePixels, brightPixels, texW, texH, tileset: mr.def && mr.def.tileset },
    };
  })()`;

  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    report.viewports[vp.tag] = await evaluate(measure);
    await shot(`bu-${vp.tag}.png`);
  }
  // 右下角局部实拍（按画布 rect 裁）
  const wide = report.viewports.wide;
  const cr = wide.canvas.rect;
  await send('Emulation.setDeviceMetricsOverride', { width: 1061, height: 484, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  await shot('bu-controls-crop.png', { x: Math.max(0, cr.left + cr.width * 0.6), y: Math.max(0, cr.top + cr.height * 0.55), width: cr.width * 0.4, height: cr.height * 0.45 });
  await shot('bu-airwall-crop.png', { x: cr.left + cr.width * 0.15, y: cr.top + cr.height * 0.28, width: cr.width * 0.55, height: cr.height * 0.55 });

  const m = wide;
  const dodge = m.buttons.find((b) => b.role === 'dodge');
  const attack = m.buttons.find((b) => b.role === 'attack');
  report.snapshots.geometry = { hudTop: m.hudTop, dodge, attack, airwall: m.airwall };
  report.checks.dodgeFullyVisible = !!dodge && dodge.visualBottom <= 270 - 2 && dodge.x + dodge.visualR <= 480 && dodge.x - dodge.visualR >= 0;
  report.checks.dodgeAboveHud = !!dodge && m.hudTop !== null && dodge.visualBottom < m.hudTop - 2;
  report.checks.dodgeHitInsideCanvas = !!dodge && dodge.hitBottom <= 270 && dodge.hitRight <= 480;
  report.checks.dodgeCenterOwned = m.dodgeOwner === 'dodge' && m.attackOwner === 'attack';

  // 真实鼠标点击：逻辑坐标 -> 屏幕 CSS 坐标
  const clickAt = async (b) => {
    const x = cr.left + (b.x / 480) * cr.width;
    const y = cr.top + (b.y / 270) * cr.height;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(80);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(150);
  };
  await evaluate('(() => { window.__btnHits = { attack: 0, cannon: 0, dodge: 0 }; return true; })()');
  await clickAt(dodge);
  const afterDodge = await evaluate('({ ...window.__btnHits })');
  await clickAt(attack);
  const afterAttack = await evaluate('({ ...window.__btnHits })');
  report.snapshots.clicks = { afterDodge, afterAttack };
  report.checks.dodgeClickWorks = afterDodge.dodge >= 1 && afterDodge.attack === 0;
  report.checks.attackClickWorks = afterAttack.attack >= 1;

  // 空气墙：交界带里亮色描边像素应显著存在（修复前基线见 before 报告）
  report.checks.airwallEdgesMarked = m.airwall.innerSolid > 0 && m.airwall.brightPixels >= m.airwall.innerSolid * 2;
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
  await writeFile(join(outDir, 'battle-ui.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, passed: report.passed, total: report.total, failed: report.failed, airwall: report.snapshots.geometry?.airwall, dodge: report.snapshots.geometry?.dodge, errors: report.errors }, null, 2));
  process.exit(report.ok ? 0 : 1);
}
