// BGM / 音效 / 暂停面板开关实拍探针（v1.9.0）
//
// 背景：设计书 7.1 里「BGM 与音效素材 ⬜ 未做」，而存档里 `settings.music / settings.sound`
// 两个字段早就存在、却没有任何入口。v1.9.0 补了六首程序化 BGM 与通用音效，并在暂停面板
// 加了两个开关。
//
// 无头浏览器没有音箱，能断言的只有播放器状态与 DOM 文案，所以这里测的是：
//   1) 标题页响 title、鸦片战争关卡响 humen、战斗节点响 battle；
//   2) 同一曲目重复进场景不会重头（currentId 不变、播放器仍在跑）；
//   3) 暂停面板多了「音乐 / 音效」两行，四个按钮互不重叠、都被面板包住；
//   4) 真实鼠标点「音乐」→ 存档写 0、总线归零、文案变「关」；再点回 0.6；
//   5) 「音效」同理（0 ↔ 0.8）；
//   6) 控制台零异常。
//
// 用法：node tools/_cdp/audio-pause.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_audio-pause-out');
const CDP_PORT = 9497;
const HTTP_PORT = 9498;
const profile = join(outDir, '_profile');

if (!edgePath) {
  console.error('usage: node tools/_cdp/audio-pause.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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
  // 无头环境没有真实手势，不加这条 AudioContext 永远是 suspended，播放器不会走拍
  '--autoplay-policy=no-user-gesture-required',
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
  /** 真实鼠标点击：逻辑坐标 → 画布 CSS 坐标 */
  const clickLogical = async (lx, ly) => {
    const box = await evaluate(`(() => { const c = window.__dshGame.canvas.getBoundingClientRect();
      return { left: c.left, top: c.top, w: c.width, h: c.height }; })()`);
    const x = box.left + (lx / 480) * box.w;
    const y = box.top + (ly / 270) * box.h;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(40);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    return { x, y };
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
  // 每次构建 bundle 名都会变：不禁缓存会跑到上一次的 boot-*.js（已从 dist 删除）
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl }); await sleep(500);
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await sleep(300);
  await evaluate(`(() => { const g=document.getElementById('tap-gate'); const b=g&&g.querySelector('.tg-go'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(900);

  // ---- 1. 标题曲 ----
  const title = await evaluate(`(() => {
    const a = window.__dshAudio;
    return { id: a.bgm.currentId, volume: a.bgm.currentVolume, sfx: a.audio.currentVolume };
  })()`);
  report.snapshots.title = title;
  report.checks.titlePlaysTitle = title.id === 'title';
  report.checks.volumeFromSave = Math.abs(title.volume - 0.6) < 1e-6 && Math.abs(title.sfx - 0.8) < 1e-6;

  // ---- 2. 鸦片战争探索关 → humen；战斗节点 → battle ----
  await evaluate(`(() => {
    const g = window.__dshGame;
    const src = g.scene.isActive('Title') ? g.scene.getScene('Title') : g.scene.getScene('Level');
    src.scene.start('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 0 });
    return true;
  })()`);
  await waitFor(() => evaluate(`(() => { const l=window.__dshGame.scene.getScene('Level'); return !!(l && l.node && l.node.id === 'nd_1839_humen_dialog' && l.map && l.worldObjects.length); })()`), 40000, 'humen level');
  await sleep(600);
  const humen = await evaluate(`({ id: window.__dshAudio.bgm.currentId, node: window.__dshGame.scene.getScene('Level').node.id })`);
  report.snapshots.humen = humen;
  report.checks.explorePlaysHumen = humen.id === 'humen';

  await drainDialogue();
  await evaluate(`(() => { const l = window.__dshGame.scene.getScene('Level'); l.startNode(2); return true; })()`);
  await waitFor(() => evaluate(`(() => { const l=window.__dshGame.scene.getScene('Level'); return !!(l.node && l.node.id === 'nd_1841_humen_battle' && l.map); })()`), 40000, 'battle level');
  await sleep(900);
  const battle = await evaluate(`({ id: window.__dshAudio.bgm.currentId, node: window.__dshGame.scene.getScene('Level').node.id })`);
  report.snapshots.battle = battle;
  report.checks.combatPlaysBattle = battle.id === 'battle';

  // 同曲目重复进场景不应重头：再进一次长廊 → hub，再回战斗 → battle
  const repeat = await evaluate(`(() => {
    const a = window.__dshAudio;
    const before = a.bgm.currentId;
    a.bgm.play('battle');
    return { before, after: a.bgm.currentId };
  })()`);
  report.snapshots.repeat = repeat;
  report.checks.sameSongIsNoop = repeat.before === 'battle' && repeat.after === 'battle';

  // ---- 3. 暂停面板布局 ----
  await evaluate(`(() => {
    const ui = window.__dshGame.scene.getScene('UI');
    ui.openPause();
    return true;
  })()`);
  await sleep(400);
  const domText = await evaluate(`(() => {
    const o = document.getElementById('dom-overlay');
    return o ? o.innerText.replace(/\\n+/g, ' | ') : null;
  })()`);
  const layout = await evaluate(`(() => {
    const ui = window.__dshGame.scene.getScene('UI');
    const rects = (ui.pauseLayer || []).filter(o => o.type === 'Rectangle').map(o => ({ x: o.x, y: o.y, w: o.width, h: o.height }));
    // 第 0 个是整屏遮罩，第 1 个是面板，其余是按钮
    const panel = rects[1];
    const buttons = rects.slice(2).map(r => ({ y: r.y, h: r.h, w: r.w }));
    return { panel, buttons, pauseOpen: ui.pauseShownNow(), hud: ui.hudShownNow() };
  })()`);
  report.snapshots.pause = { domText, layout };
  report.checks.pauseHasAudioRows = !!domText && domText.includes('音乐：开') && domText.includes('音效：开');
  report.checks.pauseFourButtons = layout.buttons.length === 4;
  report.checks.pauseButtonsInsidePanel = !!layout.panel && layout.buttons.every((b) =>
    b.y - b.h / 2 >= layout.panel.y - layout.panel.h / 2 &&
    b.y + b.h / 2 <= layout.panel.y + layout.panel.h / 2);
  report.checks.pauseButtonsNotOverlapping = layout.buttons.every((b, i) =>
    i === 0 || b.y - b.h / 2 >= layout.buttons[i - 1].y + layout.buttons[i - 1].h / 2);
  report.checks.pauseFreezesHud = layout.pauseOpen === true && layout.hud === false;
  await shot('pause-panel.png');

  // ---- 4. 真实点击「音乐」开关（面板第 2 个按钮 = cy+14） ----
  const musicBtn = await evaluate(`(() => {
    const ui = window.__dshGame.scene.getScene('UI');
    const rects = (ui.pauseLayer || []).filter(o => o.type === 'Rectangle');
    const b = rects[3];  // [0]=遮罩 [1]=面板 [2]=继续 [3]=音乐
    return { x: b.x, y: b.y };
  })()`);
  await clickLogical(musicBtn.x, musicBtn.y);
  await sleep(350);
  const musicOff = await evaluate(`(() => {
    const o = document.getElementById('dom-overlay');
    return {
      text: o ? o.innerText.replace(/\\n+/g, ' | ') : '',
      volume: window.__dshAudio.bgm.currentVolume,
      save: JSON.parse(localStorage.getItem('dsp_save_v1') || '{}').settings || null,
    };
  })()`);
  report.snapshots.musicOff = musicOff;
  report.checks.musicOffByClick = musicOff.text.includes('音乐：关') && musicOff.volume === 0;
  await shot('pause-music-off.png');

  await clickLogical(musicBtn.x, musicBtn.y);
  await sleep(300);
  const musicOn = await evaluate(`(() => {
    const o = document.getElementById('dom-overlay');
    return { text: o ? o.innerText : '', volume: window.__dshAudio.bgm.currentVolume };
  })()`);
  report.snapshots.musicOn = musicOn;
  report.checks.musicBackOn = musicOn.text.includes('音乐：开') && Math.abs(musicOn.volume - 0.6) < 1e-6;

  // ---- 5. 音效开关（第 3 个按钮 = cy+38） ----
  const sfxBtn = await evaluate(`(() => {
    const ui = window.__dshGame.scene.getScene('UI');
    const rects = (ui.pauseLayer || []).filter(o => o.type === 'Rectangle');
    const b = rects[4];
    return { x: b.x, y: b.y };
  })()`);
  await clickLogical(sfxBtn.x, sfxBtn.y);
  await sleep(300);
  const sfxOff = await evaluate(`(() => {
    const o = document.getElementById('dom-overlay');
    return { text: o ? o.innerText : '', volume: window.__dshAudio.audio.currentVolume };
  })()`);
  await clickLogical(sfxBtn.x, sfxBtn.y);
  await sleep(250);
  const sfxOn = await evaluate(`(() => {
    const o = document.getElementById('dom-overlay');
    return { text: o ? o.innerText : '', volume: window.__dshAudio.audio.currentVolume };
  })()`);
  report.snapshots.sfx = { sfxOff, sfxOn };
  report.checks.sfxOffByClick = sfxOff.text.includes('音效：关') && sfxOff.volume === 0;
  report.checks.sfxBackOn = sfxOn.text.includes('音效：开') && Math.abs(sfxOn.volume - 0.8) < 1e-6;

  // ---- 6. 关掉暂停，回到游戏 ----
  const resumeBtn = await evaluate(`(() => {
    const ui = window.__dshGame.scene.getScene('UI');
    const rects = (ui.pauseLayer || []).filter(o => o.type === 'Rectangle');
    const b = rects[2];
    return { x: b.x, y: b.y };
  })()`);
  await clickLogical(resumeBtn.x, resumeBtn.y);
  await sleep(350);
  const resumed = await evaluate(`(() => {
    const ui = window.__dshGame.scene.getScene('UI');
    return { pauseOpen: ui.pauseShownNow(), overlay: (document.getElementById('dom-overlay') || {}).innerText || '' };
  })()`);
  report.snapshots.resumed = resumed;
  report.checks.resumeWorks = resumed.pauseOpen === false;

  report.checks.noConsoleErrors = report.errors.length === 0;
  const failed = Object.entries(report.checks).filter(([, v]) => v !== true).map(([k]) => k);
  report.ok = failed.length === 0;
  report.failed = failed;
  await writeFile(join(outDir, 'audio-pause.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, failed, errors: report.errors }, null, 2));
  process.exitCode = report.ok ? 0 : 1;
} catch (e) {
  report.ok = false;
  report.fatal = String((e && e.stack) || e);
  await writeFile(join(outDir, 'audio-pause.json'), JSON.stringify(report, null, 2));
  console.error('FATAL', report.fatal);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  try { edge.kill(); } catch { /* ignore */ }
  if (server) try { server.close(); } catch { /* ignore */ }
}
