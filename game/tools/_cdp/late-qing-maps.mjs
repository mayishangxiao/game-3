// 洋务运动及之后（v2.2）三张新地图 + 新立绘的运行时实拍探针。
//
// 用户这轮的要求是「重做洋务运动时期及之后的所有地图资源，确保风格与历史背景一致」，
// 以及「除关天培和林则徐外全部替换为新头像，画风与林则徐统一」。
// 单测只能证明 JSON / PNG 存在，证明不了运行时真的用上了第三套图集：
//   ① 三个节点各自加载的是新地图（`tileset=tp_late_qing`），不是仍在复用太平天国天京；
//   ② 拼版纹理 `tp_late_qing_sheet` 真被 preload 进来了，且地面 canvas 上有瓦片细节
//      （纹理缺失会静默回退 `tile_colors` 纯色块，颜色数骤降）；
//   ③ 每张图的「年代装置」在地面层里（工厂的车床/锅炉/烟囱，会馆的大门/门匾/灯笼，
//      衙门的石狮/街垒/新军旗），这三组不能互相串；
//   ④ 出生点 / 右侧出怪点没被新画的一圈实心墙堵死；
//   ⑤ 对白里的说话人立绘真的显示在 DOM 层（96×112、不是空框、不是旧的 16 色占位图）。
//
// 用法：node tools/_cdp/late-qing-maps.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_late-qing-out');
const CDP_PORT = 9508;
const HTTP_PORT = 9507;
const profile = join(outDir, '_profile');

if (!edgePath) {
  console.error('usage: node tools/_cdp/late-qing-maps.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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

const report = { url: baseUrl, checks: {}, maps: {}, portraits: [], errors: [] };
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
  const tap = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(320);
  };
  // 逐句推对白，顺手记录每句说话人立绘的 DOM 状态（旁白时立绘收起）
  let portraitShot = false;
  const drainDialogue = async (tag, max = 80) => {
    for (let i = 0; i < max; i++) {
      const active = await evaluate(`!!window.__dshGame.scene.getScene('Level')?.dialogue?.isActive`);
      if (!active) return i;
      const p = await evaluate(`(() => {
        const el = document.getElementById('dom-dlg-portrait');
        if (!el) return null;
        const cs = getComputedStyle(el);
        const name = document.getElementById('dom-dlg-name');
        return { display: cs.display, src: el.getAttribute('src') || '',
                 nw: el.naturalWidth, nh: el.naturalHeight,
                 speaker: name ? (name.innerText || '').trim() : '' };
      })()`);
      if (p && p.display !== 'none' && p.src) report.portraits.push({ tag, ...p });
      // 第一次遇到真正解码出来的 96×112 说话人立绘时留一张实拍（给用户看新头像）
      if (!portraitShot && p && p.display !== 'none' && p.nw === 96 && p.nh === 112) {
        portraitShot = true;
        await shot('dialogue-portrait.png');
      }
      await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance()`);
      await sleep(120);
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

  // 装置瓦片 id 来自 public/art/tiles/late_qing/tileset.json（1—36）
  const cases = [
    { name: 'factory', actId: 'ch00_act3', startNode: 1, mapId: 'map_ch00_act3_factory',
      devices: [7, 21, 22, 23, 26, 27] },                  // 窄轨 / 车床 / 锅炉 / 烟囱 / 炮管胚 / 轨道小车
    { name: 'beijing', actId: 'ch00_act4', startNode: 2, mapId: 'map_ch00_act4_beijing',
      devices: [12, 15, 17, 18] },                          // 灰瓦 / 朱红大门 / 门匾 / 灯笼
    { name: 'wuchang', actId: 'ch00_act5', startNode: 0, mapId: 'map_ch00_act5_wuchang',
      devices: [30, 31, 32, 33, 36] },                      // 路灯 / 石狮 / 街垒 / 新军旗 / 石阶
  ];

  for (const c of cases) {
    await evaluate(`(() => { window.__dshGame.scene.start('Level', { actId: '${c.actId}', chapterId: 'ch00', startNode: ${c.startNode} }); return true; })()`);
    await waitFor(() => evaluate(`window.__dshGame.scene.isActive('Level') && !!window.__dshGame.scene.getScene('Level').node`), 40000, `${c.name} node`);
    await waitFor(() => evaluate(`!!window.__dshGame.scene.getScene('Level').map`), 40000, `${c.name} map`);
    await sleep(900);

    const info = await evaluate(`(() => {
      const l = window.__dshGame.scene.getScene('Level');
      const m = l.map, g = m.grid, d = m.def;
      const ground = (d.layers || []).find(x => x.name === 'ground')?.data
                  ?? (d.layers || [])[0]?.data ?? [];
      const ids = new Set();
      for (const row of ground) for (const v of row) if (v) ids.add(v);
      let colors = 0;
      try {
        const tex = l.textures.get(m.groundTextureKey);
        const ctx = tex.getContext();
        const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
        const set = new Set();
        for (let i = 0; i < img.length; i += 4 * 7) set.add((img[i] << 16) | (img[i+1] << 8) | img[i+2]);
        colors = set.size;
      } catch (e) { colors = -1; }
      return {
        id: d.id, tileset: d.tileset, cols: g.cols, rows: g.rows,
        skyRows: d.sky_rows ?? 0, colors,
        sheetLoaded: l.textures.exists('tp_late_qing_sheet'),
        tileIds: [...ids].sort((a, b) => a - b),
        spawnSolid: !!g.solid[d.spawn.y]?.[d.spawn.x],
        rightSpawns: l.spawnPoints('right').length,
        hasBanner: !!l.node?.banner,
      };
    })()`);
    report.maps[c.name] = info;

    report.checks[`${c.name}Map`] = info.id === c.mapId && info.tileset === 'tp_late_qing'
      && info.cols === 30 && info.rows === 16;
    report.checks[`${c.name}Sheet`] = info.sheetLoaded === true;
    // 36 块瓦片各带砖缝 / 木纹 / 铁钉 / 齿轮高光；纹理没加载、回退成 tile_colors
    // 时只剩十来种纯色。
    report.checks[`${c.name}TilesPainted`] = info.colors >= 14;
    report.checks[`${c.name}Devices`] = c.devices.every((id) => info.tileIds.includes(id));
    report.checks[`${c.name}Walkable`] = info.spawnSolid === false && info.rightSpawns > 8;

    // 战斗关的开场卡是整屏 interactive rectangle，点掉才能继续；经营关没有卡
    if (info.hasBanner) { await tap(480, 270); await sleep(500); }
    await drainDialogue(c.name);
    await sleep(400);

    // 串幕文案：v2.2 实拍发现第三幕经营面板还叫「天京经营 / 粮草·兵员·民心」，
    // 第四、五幕战斗目标条还写「守住威远炮台」。展示层文案已挪到 core/eraText.ts。
    const ui = await evaluate(`(() => {
      const o = document.getElementById('dom-overlay');
      const s = window.__dshGame.scene.getScene('UI');
      const l = window.__dshGame.scene.getScene('Level');
      return { overlay: o ? (o.innerText || '').slice(0, 240) : '',
               objective: s?.objectiveText?.text ?? '',
               atmosphereCount: l?.atmosphereObjects?.length ?? -1 };
    })()`);
    report.maps[c.name].ui = ui;
    // v2.4：肃杀黑暗的战场氛围只允许出现在第三幕。视觉对比不够可靠
    // （第四幕本来就是深紫砖地），直接读 Level 场景持有的氛围层对象数。
    report.checks[`${c.name}Atmosphere`] = c.actId === 'ch00_act3'
      ? ui.atmosphereCount > 0
      : ui.atmosphereCount === 0;
    if (c.name === 'factory') {
      report.checks.factoryPanelEra = /江南制造总局/.test(ui.overlay)
        && !/天京经营|粮草|兵员|民心/.test(ui.overlay);
      // 设计书 3.3.3 的机器局是「六个月」；以前面板写死「第 1 / 8 月」
      report.checks.factoryMonths = /第 1 \/ 6 月/.test(ui.overlay) && !/\/ 8 月/.test(ui.overlay);
    } else {
      report.checks[`${c.name}ObjectiveEra`] = !/威远炮台|天京城墙/.test(ui.objective);
    }

    await shot(`${c.name}.png`);
    if (c.name === 'factory') {
      // 经营面板盖住大半张地图：canvas 容器（manageUI）与 DOM 文字层都要临时收起
      // 才能拍到纯地图全貌；只藏 #dom-overlay 会留下一块空荡荡的面板底。
      await evaluate(`(() => {
        const l = window.__dshGame.scene.getScene('Level');
        if (l.manageUI) l.manageUI.setVisible(false);
        const o = document.getElementById('dom-overlay');
        if (o) { o.dataset.prevDisplay = o.style.display; o.style.display = 'none'; }
        return true; })()`);
      await sleep(200);
      await shot('factory-map.png');
      await evaluate(`(() => {
        const l = window.__dshGame.scene.getScene('Level');
        if (l.manageUI) l.manageUI.setVisible(true);
        const o = document.getElementById('dom-overlay');
        if (o) o.style.display = o.dataset.prevDisplay || '';
        return true; })()`);
    }
  }

  // 立绘：至少出现过一次 96×112 的说话人图，且不是旧的 16 色占位图
  // （占位图是 96×112 也没错，所以颜色数由 tests/portraits.test.ts 在文件层卡死；
  //  这里只证明 DOM 层真的挂上了 src 且图片解码成功）
  const shown = report.portraits.filter((p) => p.nw === 96 && p.nh === 112 && /portrait_/.test(p.src));
  report.checks.portraitShown = shown.length > 0;
  report.checks.portraitNotPlaceholder = shown.every((p) => !/lin_zexu|guan_tianpei/.test(p.src));
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
  const colors = Object.fromEntries(Object.entries(report.maps).map(([k, v]) => [k, v.colors]));
  console.log(JSON.stringify({ checks: report.checks, failed, colors,
    portraitCount: report.portraits.length, errors: report.errors, fatal: report.fatal ?? null }, null, 2));
  if (failed.length || report.fatal) process.exitCode = 1;
}
