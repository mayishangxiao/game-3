// 虎门销烟池「只有一个大长方体」实拍探针（v1.8.8，2026-11-14 截图反馈）
//
// 修复前画面里有两个长方体：地面层 6/7 瓦片画的大砖池 + obj_pool 画的 40×26 小池。
// 修复后地面装饰删除，obj_pool 放大成 7×4 格（112×64）的唯一大长方体并与碰撞区对齐。
//
// 断言：
//   1) 地面层无 6/7 瓦片、碰撞层 28 格池沿仍完整（池子依旧挡人）；
//   2) 场景里只有一个面积够大的矩形，且尺寸/中心与 HUMEN_POOL 一致，没有旧的 40×26；
//   3) 地面 canvas 纹理的池区没有被 paintWalls 刷出石墙墙皮（那会像第二个长方体）；
//   4) 8 个鸦片箱 / 林则徐 / 出口的坐标与数量不变；
//   5) 玩家站在池子四周任意一边都能选中「投入销烟池」，远处不误触发；
//   6) 真实走一次 handleInteract()，投递计数 +1、抱箱状态清空；
//   7) 控制台零异常。
//
// 用法：node tools/_cdp/pool-single.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_pool-single-out');
const CDP_PORT = 9496;
const HTTP_PORT = 9495;
const profile = join(outDir, '_profile');

if (!edgePath) {
  console.error('usage: node tools/_cdp/pool-single.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
  process.exit(2);
}
const isRemote = /^https?:\/\//.test(target);
const staticDir = isRemote ? null : resolve(target);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
};
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

const edge = spawn(edgePath, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=960,540', 'about:blank',
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
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) params.clip = { ...clip, scale: 1 };
    const r = await send('Page.captureScreenshot', params);
    await writeFile(join(outDir, name), Buffer.from(r.data, 'base64'));
  };
  const drainDialogue = async (max = 60) => {
    for (let i = 0; i < max; i++) {
      if (!await evaluate(`!!window.__dshGame.scene.getScene('Level').dialogue?.isActive`)) return i;
      await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance()`);
      await sleep(115);
    }
    return -1;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl }); await sleep(500);
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await sleep(300);
  await evaluate(`(() => { const g=document.getElementById('tap-gate'); const b=g&&g.querySelector('.tg-go'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(500);

  // 第一幕「林则徐赴粤」用 map_ch00_act1a，crate_target=8，是真正要投池的那一关。
  await evaluate(`(() => {
    const g = window.__dshGame;
    const src = g.scene.isActive('Title') ? g.scene.getScene('Title') : g.scene.getScene('Level');
    src.scene.start('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 0 });
    return true;
  })()`);
  await waitFor(() => evaluate(`(() => { const l=window.__dshGame.scene.getScene('Level'); return !!(window.__dshLevel && l && l.map && l.map.grid && l.worldObjects && l.worldObjects.length); })()`), 40000, 'level ready');
  await sleep(800);
  await drainDialogue();
  await sleep(300);

  const measure = `(() => {
    const g = window.__dshGame;
    const lvl = g.scene.getScene('Level');
    const mr = lvl.map;
    const def = mr.def;
    const TILE = 16;
    const X0=15, X1=21, Y0=8, Y1=11;
    const ground = def.layers.find(l => l.name === 'ground').data;
    const collision = def.layers.find(l => l.name === 'collision').data;
    let groundPoolTiles = 0;
    ground.forEach(r => r.forEach(v => { if (v === 6 || v === 7) groundPoolTiles += 1; }));
    const poolCells = [], strayCells = [];
    collision.forEach((r, y) => r.forEach((v, x) => {
      if (v !== 6 && v !== 7) return;
      const inPool = x >= X0 && x <= X1 && y >= Y0 && y <= Y1;
      (inPool ? poolCells : strayCells).push(x + ',' + y);
    }));
    const rects = lvl.children.list
      .filter(o => o.type === 'Rectangle')
      .map(o => ({ x: o.x, y: o.y, w: o.width, h: o.height, depth: o.depth,
                   fill: o.fillColor, alpha: o.alpha, visible: o.visible }));
    const big = rects.filter(r => r.w >= 100 && r.h >= 60);
    const small = rects.filter(r => r.w === 40 && r.h === 26);
    const objs = lvl.worldObjects.map(o => ({
      id: o.def.id, kind: o.def.kind, gx: o.def.x, gy: o.def.y,
      rx: o.rect.x, ry: o.rect.y, w: o.rect.width, h: o.rect.height,
    }));
    // 地面 canvas 纹理：池区里如果出现 paintWalls 的墙皮色，说明第二个长方体还在
    let wallSkin = 0, texW = 0, texH = 0;
    const key = mr.groundKey;
    if (key && g.textures.exists(key)) {
      const tex = g.textures.get(key);
      const ctx = tex.getContext && tex.getContext();
      if (ctx) {
        texW = ctx.canvas.width; texH = ctx.canvas.height;
        const data = ctx.getImageData(0, 0, texW, texH).data;
        const near = (i, r, gg, b) => Math.abs(data[i]-r) <= 8 && Math.abs(data[i+1]-gg) <= 8 && Math.abs(data[i+2]-b) <= 8;
        for (let y = Y0*TILE; y < (Y1+1)*TILE; y++) {
          for (let x = X0*TILE; x < (X1+1)*TILE; x++) {
            if (x < 0 || y < 0 || x >= texW || y >= texH) continue;
            const i = (y*texW + x)*4;
            // plumDark #2F2B45 / greyPlum #948DAB —— paintWalls 的墙面与亮顶面
            if (near(i, 47,43,69) || near(i, 148,141,171)) wallSkin += 1;
          }
        }
      }
    }
    const cr = g.canvas.getBoundingClientRect();
    return {
      nodeId: lvl.node && lvl.node.id,
      groundPoolTiles, poolCells: poolCells.length, strayCells,
      solidPoolCells: poolCells.length,
      rectCount: rects.length, big, small,
      objs, wallSkin, texW, texH,
      canvas: { left: cr.left, top: cr.top, width: cr.width, height: cr.height },
      crateTarget: lvl.crateTarget,
    };
  })()`;
  const m = await evaluate(measure);
  report.snapshots.measure = m;

  report.checks.enteredHumenPool = m.nodeId === 'nd_1839_humen_dialog';
  report.checks.groundDecorationRemoved = m.groundPoolTiles === 0;
  report.checks.poolCollisionIntact = m.poolCells === 28 && m.strayCells.length === 0;
  report.checks.exactlyOneBigPool = m.big.length === 1 &&
    m.big[0].w === 112 && m.big[0].h === 64 && m.big[0].x === 296 && m.big[0].y === 160;
  report.checks.oldSmallPoolGone = m.small.length === 0;
  report.checks.noWallSkinUnderPool = m.wallSkin === 0;

  const expected = {
    obj_crate_1: [7,11], obj_crate_2: [10,12], obj_crate_3: [13,11], obj_crate_4: [23,7],
    obj_crate_5: [10,13], obj_crate_6: [9,12], obj_crate_7: [7,14], obj_crate_8: [25,6],
    obj_linzexu: [15,12], obj_exit_fort: [27,4],
  };
  // NPC 用的是立绘 Image（origin 0.5/1，脚在格心 +8），不是居中的 Rectangle；
  // 这个 +8 是它本来的渲染规则，别把它当成「被本次改动挪动」。
  report.checks.otherObjectsUnchanged = m.objs.length === 11 &&
    Object.entries(expected).every(([id, [x, y]]) => {
      const o = m.objs.find((v) => v.id === id);
      if (!o || o.gx !== x || o.gy !== y || o.rx !== (x + 0.5) * 16) return false;
      const expectRy = (y + 0.5) * 16 + (o.kind === 'npc' ? 8 : 0);
      return o.ry === expectRy;
    });
  report.checks.poolObjectCentered = (() => {
    const p = m.objs.find((o) => o.id === 'obj_pool');
    return !!p && p.gx === 18 && p.gy === 9.5 && p.rx === 296 && p.ry === 160 &&
      p.w === 112 && p.h === 64;
  })();

  // 交互：池子放大后玩家只能站在池沿外，四周任意一边都应能选中「投入销烟池」
  const near = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    const rig = lvl.player.rig, ox = rig.x, oy = rig.y;
    const at = (x, y) => {
      rig.x = x; rig.y = y;
      const o = lvl.findNearObject();
      rig.x = ox; rig.y = oy;
      return o ? o.id : null;
    };
    return {
      south: at(296, 200), north: at(296, 120),
      west: at(232, 160), east: at(360, 160),
      faraway: at(100, 100),
    };
  })()`);
  report.snapshots.near = near;
  report.checks.reachableFromAllSides = ['south', 'north', 'west', 'east'].every((k) => near[k] === 'obj_pool');
  report.checks.noFarawayFalseTrigger = near.faraway !== 'obj_pool';

  const deposit = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    lvl.carrying = true;
    lvl.cratesDelivered = 0;
    lvl.nearObject = lvl.worldObjects.find(o => o.def.id === 'obj_pool').def;
    const before = lvl.cratesDelivered;
    lvl.handleInteract();
    return { before, after: lvl.cratesDelivered, carrying: lvl.carrying, target: lvl.crateTarget };
  })()`);
  report.snapshots.deposit = deposit;
  report.checks.depositStillWorks = deposit.before === 0 && deposit.after === 1 && deposit.carrying === false;

  await shot('pool-single-full.png');
  // 池区局部：逻辑 (240,128)-(352,192)，画布可能按 960/480 放大并居中
  const sc = m.canvas.width / 480;
  const clip = {
    x: m.canvas.left + 210 * sc,
    y: m.canvas.top + 100 * sc,
    width: 175 * sc,
    height: 120 * sc,
  };
  await shot('pool-single-closeup.png', clip);

  report.checks.noConsoleErrors = report.errors.length === 0;
  const failed = Object.entries(report.checks).filter(([, v]) => v !== true).map(([k]) => k);
  report.ok = failed.length === 0;
  report.failed = failed;
  await writeFile(join(outDir, 'pool-single.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, failed, errors: report.errors }, null, 2));
  process.exitCode = report.ok ? 0 : 1;
} catch (e) {
  report.ok = false;
  report.fatal = String(e && e.stack || e);
  await writeFile(join(outDir, 'pool-single.json'), JSON.stringify(report, null, 2));
  console.error('FATAL', report.fatal);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch {}
  try { edge.kill(); } catch {}
  if (server) try { server.close(); } catch {}
}
