// 场景对白流程实拍探针（v1.8.7）——验证「每个场景都有参与人物与说话人归属、
// 开场 + 战斗结束后收尾两阶段都有角色对话」，而不只是数据里写了字段。
//
// 断言：
//   1) 剧情节点开场对白显示首句说话人 + 右上角「在场：…」参与人物；
//   2) 逐句推进后名字切换（同一段里多人说话能分清归属），在场名单整段不变；
//   3) 结算前必播收尾对白：`completeNode()` 之后 `settleNode()` 仍未被调用；
//   4) 收尾对白读完才真正结算（hook 计数 == 1）；
//   5) 副本同样有开场 / 收尾，且第一波敌人等开场对白读完才刷；
//   6) 经营面板在开场对白期间不出现（不再遮挡对白框），读完才登场；
//   7) 控制台零异常。
//
// 用法：node tools/_cdp/scene-dialogue.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_scene-dialogue-out');
const CDP_PORT = 9492;
const HTTP_PORT = 9491;
const profile = join(outDir, '_profile');

if (!edgePath) {
  console.error('usage: node tools/_cdp/scene-dialogue.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, name), Buffer.from(r.data, 'base64'));
  };
  const dlgState = () => evaluate(`(() => {
    const g = (id) => document.getElementById(id);
    const lvl = window.__dshGame.scene.getScene('Level');
    return {
      active: !!lvl?.dialogue?.isActive,
      visible: g('dom-dialogue')?.style.display ?? '',
      name: g('dom-dlg-name')?.textContent ?? '',
      cast: g('dom-dlg-cast')?.textContent ?? '',
      body: g('dom-dlg-body')?.textContent ?? '',
      overlay: g('dom-overlay')?.textContent ?? '',
      nodeId: lvl?.node?.id ?? null,
      mode: lvl?.mode ?? null,
      dungeon: !!lvl?.dungeon,
      enemies: window.__dshLevel?.allEnemies?.().length ?? 0,
    };
  })()`);
  const startLevel = (init) => evaluate(`(() => {
    const g = window.__dshGame;
    const src = g.scene.isActive('Title') ? g.scene.getScene('Title') : g.scene.getScene('Level');
    src.scene.start('Level', ${JSON.stringify(init)});
    return true;
  })()`);
  // DialogueBox.advance() 有 90ms 防连点，且第一次点击只补全打字机；115ms 间隔刚好一句一推进。
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

  /* ---------- ① 剧情节点：开场对白 / 逐句说话人 / 参与人物 ---------- */
  await startLevel({ actId: 'ch00_act1', chapterId: 'ch00', startNode: 0 });
  await waitFor(() => evaluate(`!!window.__dshLevel && !!window.__dshGame.scene.getScene('Level').node`), 40000, 'node ready');
  await sleep(700);
  const intro0 = await dlgState();
  report.snapshots.intro0 = intro0;
  report.checks.introActive = intro0.active && intro0.visible === 'block' && intro0.nodeId === 'nd_1839_humen_dialog';
  report.checks.introSpeakerNamed = intro0.name === '旁白';
  report.checks.castListed = intro0.cast.startsWith('在场：') &&
    ['旁白', '林则徐', '关天培', '乡民'].every((n) => intro0.cast.includes(n));
  await shot('sd-1-intro.png');

  // 第 1 次补全打字机，第 2 次才推进到第 2 句（林则徐）。
  await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance()`); await sleep(130);
  await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance()`); await sleep(130);
  const intro1 = await dlgState();
  report.snapshots.intro1 = intro1;
  report.checks.speakerSwitchesPerLine = intro1.active && intro1.name === '林则徐' && intro1.name !== intro0.name;
  report.checks.castStableAcrossLines = intro1.cast === intro0.cast;
  await shot('sd-2-speaker-switch.png');

  /* ---------- ② 战斗 / 玩法结束：收尾对白先于结算 ---------- */
  await drainDialogue();
  const afterIntro = await dlgState();
  report.checks.introFinishes = !afterIntro.active;
  // hook 真正的结算主体：收尾对白没读完时它不应该被调用。
  await evaluate(`(() => {
    const l = window.__dshGame.scene.getScene('Level');
    window.__settleCalls = 0;
    const orig = l.settleNode.bind(l);
    l.settleNode = () => { window.__settleCalls += 1; return orig(); };
    l.completeNode();
    return true;
  })()`);
  await sleep(250);
  const outro0 = await dlgState();
  report.snapshots.outro0 = outro0;
  report.checks.outroBeforeSettle = outro0.active && outro0.name === '水勇' &&
    (await evaluate('window.__settleCalls')) === 0 && outro0.nodeId === 'nd_1839_humen_dialog';
  report.checks.outroHasOwnCast = outro0.cast.includes('水勇') && outro0.cast.includes('关天培');
  report.checks.outroDiffersFromIntro = outro0.body !== intro0.body;
  await shot('sd-3-outro.png');
  await drainDialogue();
  report.checks.settleAfterOutro = (await evaluate('window.__settleCalls')) === 1;

  /* ---------- ③ 副本：开场读完才刷怪 / 结算面板前先收尾 ---------- */
  await startLevel({ actId: 'ch00_act1', chapterId: 'ch00', dungeonId: 'dg01_alley' });
  await waitFor(() => evaluate(`!!window.__dshGame.scene.getScene('Level').dungeon && !!window.__dshLevel.map()`), 30000, 'dungeon ready');
  await sleep(700);
  const dIntro = await dlgState();
  report.snapshots.dungeonIntro = dIntro;
  report.checks.dungeonIntro = dIntro.dungeon && dIntro.active && dIntro.name === '旁白' && dIntro.enemies === 0;
  report.checks.dungeonIntroCast = dIntro.cast.includes('乡民') && dIntro.cast.includes('林则徐');
  await drainDialogue();
  await waitFor(() => evaluate('window.__dshLevel.allEnemies().length > 0'), 20000, 'dungeon wave after intro');
  report.checks.dungeonWaveAfterIntro = true;

  await evaluate(`(() => {
    const l = window.__dshGame.scene.getScene('Level');
    window.__dSettleCalls = 0;
    const orig = l.settleDungeon.bind(l);
    l.settleDungeon = () => { window.__dSettleCalls += 1; return orig(); };
    l.finishDungeon();
    return true;
  })()`);
  await sleep(250);
  const dOutro = await dlgState();
  report.snapshots.dungeonOutro = dOutro;
  report.checks.dungeonOutroBeforePanel = dOutro.active && dOutro.name === '乡民' &&
    (await evaluate('window.__dSettleCalls')) === 0;
  await drainDialogue();
  report.checks.dungeonPanelAfterOutro = (await evaluate('window.__dSettleCalls')) === 1;

  /* ---------- ④ 经营面板：开场对白期间不遮挡 ---------- */
  await startLevel({ actId: 'ch00_act2', chapterId: 'ch00', startNode: 1 });
  await waitFor(() => evaluate(`window.__dshGame.scene.getScene('Level').mode === 'management' && !!window.__dshGame.scene.getScene('Level').node`), 40000, 'management ready');
  await sleep(700);
  const m0 = await dlgState();
  report.snapshots.managementIntro = m0;
  report.checks.managementIntro = m0.active && m0.name === '洪秀全';
  report.checks.panelDeferredUntilIntroEnds = !m0.overlay.includes('天京经营');
  await drainDialogue();
  await sleep(300);
  const m1 = await dlgState();
  report.snapshots.managementAfterIntro = m1;
  report.checks.panelAfterIntro = m1.overlay.includes('天京经营') && !m1.active;
  await shot('sd-4-management-panel.png');

  report.checks.noConsoleErrors = report.errors.length === 0;
} catch (e) {
  report.errors.push(String(e?.stack ?? e));
} finally {
  try { ws?.close(); } catch {}
  try { edge.kill(); } catch {}
  try { server?.close(); } catch {}
  const failed = Object.entries(report.checks).filter(([, v]) => !v).map(([k]) => k);
  const ok = failed.length === 0 && report.errors.length === 0;
  const summary = { ok, passed: Object.keys(report.checks).length - failed.length, total: Object.keys(report.checks).length, failed, errors: report.errors };
  await writeFile(join(outDir, 'scene-dialogue.json'), JSON.stringify({ ...report, summary }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = ok ? 0 : 1;
}
