// 黄海海战（第三幕 nd_1894_jiawu_battle）实拍探针。
//
// 这一轮用户的要求是「洋务运动必须要有甲午海战，并且地图是海洋」，
// 所以断言必须证明三件事，光看代码不算数：
//   ① 这一关的地图是**新做的海洋图**（tileset=tp_sea、30×16、sky_rows=4），
//      而且瓦片真的画上去了 —— 从 ground canvas 里数颜色，回退成纯色块会当场露馅；
//   ② 可走区只有中间那条甲板，四周海面与舷墙都撞得住（抽 5 个格断言）；
//   ③ Boss 是**船**（松岛舰），并且停在甲板右舷能砍到的距离内，
//      而不是按默认算法飘在 90 多像素外的海面上；
//   ④ （v2.5）Boss 实体真的拿到 `ship_matsushima_*` 6 帧，而不是静默回落成
//      第一幕英舰贴图或矩形占位形体 —— 读 `rig.shipKeys` 才算数。
//
// 用法：node tools/_cdp/jiawu-sea.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_jiawu-sea-out');
const CDP_PORT = 9504;
const HTTP_PORT = 9503;
const profile = join(outDir, '_profile');

if (!edgePath) {
  console.error('usage: node tools/_cdp/jiawu-sea.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, name), Buffer.from(r.data, 'base64'));
  };
  const drainDialogue = async (max = 80) => {
    for (let i = 0; i < max; i++) {
      const active = await evaluate(`!!window.__dshGame.scene.getScene('Level')?.dialogue?.isActive`);
      if (!active) return i;
      await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance()`);
      await sleep(115);
    }
    return -1;
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

  /* ---------------- 1. 进第三幕海战节点（第 3 个：nd_1894_jiawu_battle） ---------------- */
  await evaluate(`(() => { window.__dshGame.scene.start('Level', { actId: 'ch00_act3', chapterId: 'ch00', startNode: 2 }); return true; })()`);
  await waitFor(() => evaluate(`window.__dshGame.scene.isActive('Level') && !!window.__dshGame.scene.getScene('Level').node`), 40000, 'level node');
  await waitFor(() => evaluate(`!!window.__dshGame.scene.getScene('Level').map`), 40000, 'sea map');
  await sleep(800);

  // 开场卡是海战背景（banner.scene === 'sea'），先拍一张再点掉它
  await shot('sea-intro-card.png');
  const introBanner = await evaluate(`(() => {
    const l = window.__dshGame.scene.getScene('Level');
    const b = l.node?.banner ?? null;
    const o = document.getElementById('dom-overlay');
    return { banner: b, overlayText: o ? (o.innerText || '').slice(0, 200) : null };
  })()`);
  report.snapshots.introBanner = introBanner;
  // 开场卡「点击开始战斗」：在画布中心按一下（bg 是整屏的 interactive rectangle）
  const tap = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(320);
  };
  await tap(480, 270);
  await sleep(600);
  await drainDialogue();
  await sleep(500);

  const mapInfo = await evaluate(`(() => {
    const l = window.__dshGame.scene.getScene('Level');
    const m = l.map;
    const g = m.grid;
    const at = (x, y) => !!g.solid[y][x];
    const key = m.groundTextureKey;
    // 从烘好的地面 canvas 直接数颜色：瓦片没画上去（回退成纯色块）时色数会骤降
    let colors = 0;
    try {
      const tex = l.textures.get(key);
      const ctx = tex.getContext();
      const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
      const set = new Set();
      for (let i = 0; i < img.length; i += 4 * 7) {
        set.add((img[i] << 16) | (img[i + 1] << 8) | img[i + 2]);
      }
      colors = set.size;
    } catch (e) { colors = -1; }
    return {
      id: m.def.id,
      tileset: m.def.tileset,
      cols: g.cols, rows: g.rows,
      skyRows: m.def.sky_rows ?? 0,
      bossAnchor: m.def.boss_anchor ?? null,
      colors,
      walkableInside: [
        [5, 9], [12, 9], [19, 9],
      ].map(([x, y]) => at(x, y)),
      blockedSea: [
        [25, 8], [0, 8], [20, 9], [3, 9], [10, 14],
      ].map(([x, y]) => at(x, y)),
      // 甲板可走格总数（地图设计值 127）
      walkCells: g.solid.reduce((n, row) => n + row.reduce((k, v) => k + (v ? 0 : 1), 0), 0),
    };
  })()`);
  report.snapshots.map = mapInfo;

  report.checks.mapIsSea = mapInfo.tileset === 'tp_sea' && mapInfo.id === 'map_ch00_act3_sea';
  report.checks.mapSize = mapInfo.cols === 30 && mapInfo.rows === 16 && mapInfo.skyRows === 4;
  report.checks.deckWalkable = mapInfo.walkableInside.every((v) => v === false);
  report.checks.seaBlocked = mapInfo.blockedSea.every((v) => v === true);
  report.checks.deckSize = mapInfo.walkCells === 103;
  // 24 块瓦片各带木纹 / 浪脊 / 铁钉 / 铁箍，正常应远超 12 种颜色；
  // 图集没加载、回退成 tile_colors 时只剩 9 种纯色（海蓝 3 + 甲板棕 2 + 舷墙深棕 + 炮位紫 + 灰）
  report.checks.tilesPainted = mapInfo.colors >= 14;

  /* ---------------- 2. Boss：必须是船，且贴着甲板右舷 ---------------- */
  await evaluate(`(() => { window.__dshGame.scene.getScene('Level').spawnBoss(); return true; })()`);
  await sleep(1200);
  const bossInfo = await evaluate(`(() => {
    const l = window.__dshGame.scene.getScene('Level');
    const ship = l.bossShip;
    const deckRight = 20 * 16 + 16;  // 舷墙外沿（col 20 的右边界）
    const deckInner = 19 * 16 + 8;   // 甲板最右可走格的格心
    return ship ? {
      id: ship.def.id, name: ship.def.name, body: ship.def.body,
      // 松岛舰必须真的拿到专属 6 帧，而不是静默回落成第一幕英舰（空数组 = 矩形占位）
      shipArt: ship.rig?.shipKeys?.[0] ?? null,
      shipArtCount: ship.rig?.shipKeys?.length ?? 0,
      x: Math.round(ship.x), y: Math.round(ship.y),
      gapToDeckEdge: Math.round(ship.x - deckRight),
      gapToDeckCenter: Math.round(ship.x - deckInner),
      hp: ship.maxHp,
    } : null;
  })()`);
  report.snapshots.boss = bossInfo;
  report.checks.bossIsShip = !!bossInfo && bossInfo.body === 'ship' && bossInfo.id === 'en_boss_jp_matsushima';
  report.checks.bossUsesMatsushimaFrames = !!bossInfo
    && bossInfo.shipArtCount === 6
    && String(bossInfo.shipArt).startsWith('ship_matsushima_');
  // 近战 60px：船心到甲板最右可走格心的距离必须 < 60，否则玩家永远砍不到它
  report.checks.bossReachable = !!bossInfo && Math.abs(bossInfo.gapToDeckCenter) < 60;

  await shot('sea-battle.png');

  /* ---------------- 3. 出怪落点：从甲板右舷登舰，不落进海里 ---------------- */
  const spawnInfo = await evaluate(`(() => {
    const l = window.__dshGame.scene.getScene('Level');
    const pts = l.spawnPoints('right');
    return pts.slice(0, 6).map(p => ({ x: Math.round(p.x), y: Math.round(p.y), solid: l.map.isSolidAtWorld(p.x, p.y) }));
  })()`);
  report.snapshots.spawnPoints = spawnInfo;
  report.checks.spawnOnDeck = spawnInfo.length > 0 && spawnInfo.every((p) => p.solid === false);

  // 真实打起来之后：所有敌人（含 Boss 的 adds）都该站在可走格上。
  // 海战图的右半边整列是海，出怪只要落错一格，玩家就会看到「日军站在水面上」。
  await evaluate(`(() => {
    const l = window.__dshGame.scene.getScene('Level');
    l.enemies.forEach((e, i) => l.spawnEnemy(l.findEnemy('en_jp_infantry'), 'right'));
    return true;
  })()`);
  await sleep(800);
  const enemyFeet = await evaluate(`(() => {
    const l = window.__dshGame.scene.getScene('Level');
    // 军舰浮在海上，脚点本来就压在不可走的海面格上，不参与「登舰落点」判定
    return l.enemies.filter(e => e.alive && e.def.body !== 'ship').map(e => ({
      id: e.def.id,
      x: Math.round(e.x), y: Math.round(e.y),
      solid: l.map.isSolidAtWorld(e.x, e.y),
      col: Math.floor(e.x / 16), row: Math.floor(e.y / 16),
    }));
  })()`);
  report.snapshots.enemyFeet = enemyFeet;
  report.checks.allEnemiesOnDeck = enemyFeet.every((e) => e.solid === false);

  report.checks.noConsoleErrors = report.errors.length === 0;
} catch (err) {
  report.fatal = String(err && err.stack ? err.stack : err);
} finally {
  try { await send('Browser.close'); } catch {}
  ws?.close?.();
  edge.kill();
  if (server) server.close();
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  const failed = Object.entries(report.checks).filter(([, v]) => !v).map(([k]) => k);
  console.log(JSON.stringify({ checks: report.checks, failed, errors: report.errors, fatal: report.fatal ?? null }, null, 2));
  if (failed.length || report.fatal) process.exitCode = 1;
}
