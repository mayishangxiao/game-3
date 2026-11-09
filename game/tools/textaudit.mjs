/**
 * textaudit.mjs —— 用手机档视口（844×390 dpr3）逐屏截图，检查「文字是否清晰」。
 * 用法: node tools/_cdp/textaudit.mjs <edgePath> <baseUrl> <outDir>
 *
 * 每屏都拍两张：一张全量（含 DOM 层），一张把 #dom-ui 藏掉只看 canvas——
 * 之前吃过亏：DOM 层天然清晰，canvas 糊不糊必须分开看。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = process.argv[2];
const BASE = process.argv[3] ?? 'http://127.0.0.1:4188';
const OUT = process.argv[4] ?? 'D:\\game_project\\game 3\\game\\tools\\cdp_audit';
const PORT = 9471;
mkdirSync(OUT, { recursive: true });

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${OUT}/profile`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-features=HttpsUpgrades,HttpsFirstBalancedMode,HttpsFirstModeV2ForDesktop',
    '--window-size=844,390',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const kill = () => { try { edge.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', kill);

let page;
for (let i = 0; i < 60; i++) {
  try {
    const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page');
    if (list.length) { page = list[0]; break; }
  } catch { /* not up */ }
  await sleep(500);
}
if (!page) throw new Error('Edge 调试端口没起来');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
};
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { res, rej })); };
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const shot = async (name, domOnly) => {
  // 注意必须用 display:none：`visibility` 会被子元素自己写的 `visibility:visible` 覆盖，
  // 用 visibility 藏 #dom-ui 时截出来的还是「带 DOM 的图」，白白误判 canvas 清晰度。
  await evaluate(`(function(){ var ui=document.getElementById('dom-ui'); if(ui) ui.style.display = ${domOnly ? "'none'" : "''"}; return 1; })()`);
  await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const s = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(`${OUT}/${name}`, Buffer.from(s.data, 'base64'));
  await evaluate(`(function(){ var ui=document.getElementById('dom-ui'); if(ui) ui.style.display=''; return 1; })()`);
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
await send('Page.navigate', { url: `${BASE}/` });
for (let i = 0; i < 100; i++) { await sleep(500); if (await evaluate('!!(window.__dshGame && window.__dshGame.scene.getScenes(true).length)').catch(() => false)) break; }
await sleep(1500);

const info = await evaluate(`(function(){
  var g = window.__dshGame; var c = g.canvas;
  return { bufW: c.width, bufH: c.height, cssW: c.clientWidth, cssH: c.clientHeight, dpr: window.devicePixelRatio,
           scenes: g.scene.getScenes(true).map(function(s){return s.scene.key;}), phaser: g.game ? undefined : undefined };
})()`);

const go = (key, data) => evaluate(`(function () {
  var g = window.__dshGame;
  g.scene.getScenes(true).forEach(function (s) { if (s.scene.key !== 'UI') g.scene.stop(s.scene.key); });
  return new Promise(function (r) { setTimeout(function () { g.scene.start('${key}', ${JSON.stringify(data ?? {})}); r(true); }, 450); });
})()`);

const clearDialogue = `(async function(){ var l = window.__dshGame.scene.getScene('Level'); for (var i=0;i<40;i++){ if (!l.dialogue || !l.dialogue.isActive) break; if (l.introOpen) l.tapCard(); else l.dialogue.advance(); await new Promise(r=>setTimeout(r,150)); } return {introOpen: l.introOpen, talking: l.dialogue && l.dialogue.isActive, mode: l.mode}; })()`;

const report = { info, hops: [] };
await shot('01-title.png');
await shot('01-title-canvas.png', true);
report.hops.push({ hop: 'title', ...(await evaluate(`(function(){var g=window.__dshGame;return {scenes:g.scene.getScenes(true).map(function(s){return s.scene.key;})};})()`)) });

await go('Hub', { chapterId: 'ch00' });
await sleep(2200);
await shot('02-hub.png');
await shot('02-hub-canvas.png', true);

await go('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 1 });
await sleep(3200);
await evaluate(clearDialogue);
await sleep(600);
await shot('03-explore.png');
await shot('03-explore-canvas.png', true);

await go('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 });
await sleep(3200);
await evaluate(clearDialogue);
await sleep(1200);
await shot('04-battle.png');
await shot('04-battle-canvas.png', true);

for (const [key, file] of [['Equipment', '05-equipment'], ['Quiz', '06-quiz'], ['Codex', '07-codex'], ['Graph', '08-graph']]) {
  await go(key, {});
  await sleep(2000);
  await shot(file + '.png');
  await shot(file + '-canvas.png', true);
}

report.errors = errors.slice(0, 12);
writeFileSync(`${OUT}/audit.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
ws.close();
kill();
