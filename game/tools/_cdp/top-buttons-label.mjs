// 右上角两枚按钮文字回归探针（v1.8.1）。
//
// 现象：进战斗后右上角两块 canvas 底板（暂停 / 背包）还在，框里却没有字。
// 根因：DomUi.hideOverlay() 用「#dom-ui > div 反向白名单」清场景级浮动标签，
// 而 UIScene 把「暂停」「背包」两行 DOM 文字也直接挂在 #dom-ui 下、且不在白名单里，
// 于是开场情境卡关闭 / 进节点 / 暂停关闭时调用的 hideOverlay() 会把它们一起 remove。
//
// 本探针走真实交互路径（进战斗 → 开场卡 → 暂停开合 → 换武器面板开合 → 人为删节点后自愈），
// 逐点检查两行文字的存在性、内容、可见性、样式/位置、canvas 底板与点击交互。
//
// 用法：
//   node tools/_cdp/top-buttons-label.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
// 传本地目录（默认 dist）时自带静态服务；产物 top-buttons-label.json + 实拍。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const CDP_PORT = 9442;
const HTTP_PORT = 9441;
const profile = join(outDir, '_profile-top-buttons-label');

if (!edgePath) {
  console.error('usage: node tools/_cdp/top-buttons-label.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
  process.exit(2);
}

const isRemote = /^https?:\/\//.test(target);
const staticDir = isRemote ? null : resolve(target);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};
const server = isRemote
  ? null
  : createServer(async (req, res) => {
      try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const rel = normalize(pathname.replace(/^\/+/, '')).replace(/^(\.\.[/\\])+/, '');
        const file = resolve(staticDir, rel === '' || rel === '.' ? 'index.html' : rel);
        if (!file.startsWith(staticDir)) {
          res.writeHead(403).end();
          return;
        }
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${label}`);
}

await mkdir(outDir, { recursive: true });
await rm(profile, { recursive: true, force: true }).catch(() => {});
await mkdir(profile, { recursive: true });
if (server) await new Promise((res) => server.listen(HTTP_PORT, '127.0.0.1', res));
const baseUrl = isRemote ? target : `http://127.0.0.1:${HTTP_PORT}`;

const edge = spawn(
  edgePath,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=960,540',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const report = { url: baseUrl, checks: {}, errors: [], snapshots: {} };
let ws;

try {
  const list = await waitFor(
    async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const j = await r.json();
        const page = j.find((t) => t.type === 'page');
        return page ? page.webSocketDebuggerUrl : null;
      } catch {
        return null;
      }
    },
    20000,
    'devtools',
  );
  ws = new WebSocket(list);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      report.errors.push(msg.params.exceptionDetails?.exception?.description ?? 'exception');
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      report.errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const text = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
      throw new Error(`EVAL FAILED: ${text}`);
    }
    return r.result.value;
  };
  const shot = async (name, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    await writeFile(join(outDir, name), Buffer.from(r.data, 'base64'));
  };

  // 只做只读快照：两个 DOM 文字节点 + canvas 两块底板 + DOM 层几何。
  const SNAP = `(() => {
    const G = window.__dshGame;
    const U = G && G.scene.getScene('UI');
    const ids = ['dom-pause-btn', 'dom-bag-btn'];
    const nodes = ids.map((id) => {
      const all = document.querySelectorAll('#' + id);
      const el = all[0];
      if (!el) return { id, count: all.length, exists: false, text: null, visible: false, cssText: '', persist: null };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        id,
        count: all.length,
        exists: true,
        text: el.textContent,
        visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
        cssText: el.style.cssText,
        persist: el.getAttribute('data-dom-ui-persist'),
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      };
    });
    const canvas = document.querySelector('#game-root canvas');
    const cr = canvas ? canvas.getBoundingClientRect() : null;
    const du = document.getElementById('dom-ui');
    const dr = du ? du.getBoundingClientRect() : null;
    const host = document.getElementById('dom-hud-buttons');
    const box = (b) => b ? { visible: !!b.visible, x: b.x, y: b.y, w: b.width, h: b.height } : null;
    return {
      nodes,
      host: host ? { exists: true, transform: host.style.transform, width: host.style.width, children: host.children.length } : { exists: false },
      pauseBtn: U ? box(U.pauseBtn) : null,
      bagBtn: U ? box(U.bagBtn) : null,
      hudShown: U ? U.hudShownNow() : null,
      pauseListeners: U && U.pauseBtn ? U.pauseBtn.listenerCount('pointerdown') : 0,
      bagListeners: U && U.bagBtn ? U.bagBtn.listenerCount('pointerdown') : 0,
      canvas: cr ? { left: cr.left, top: cr.top, width: cr.width, height: cr.height } : null,
      domUi: dr ? { left: dr.left, top: dr.top, width: dr.width, height: dr.height } : null,
    };
  })()`;
  const snap = () => evaluate(SNAP);

  const checkSnapshot = (tag, s) => {
    report.snapshots[tag] = s;
    report.checks[tag + 'NodesExist'] = s.nodes.every((n) => n.exists && n.count === 1);
    report.checks[tag + 'TextsCorrect'] = s.nodes[0]?.text === '暂停' && s.nodes[1]?.text === '背包';
    report.checks[tag + 'TextsVisible'] = s.nodes.every((n) => n.visible === true);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl });
  await sleep(500);
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await evaluate(`(() => {
    const g = document.getElementById('tap-gate');
    const b = g && g.querySelector('.tg-go');
    if (b) b.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
    return true;
  })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(600);
  await evaluate(`(() => {
    window.__dshGame.scene.getScene('Title').scene.start('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 });
    return true;
  })()`);
  await waitFor(() => evaluate('!!window.__dshLevel'), 40000, 'level hook');
  await sleep(2000);

  // 进战斗必走的一步：关掉开场情境卡（close() 里调 hideOverlay）。
  const L = 'window.__dshGame.scene.getScene("Level")';
  const skipIntro = async () => {
    for (let i = 0; i < 8 && (await evaluate(`!!${L}.introOpen`)); i++) {
      await evaluate(`(function(){var l=${L}; if (l.pendingCardTap) l.pendingCardTap(); return 1;})()`);
      await sleep(350);
    }
    for (let i = 0; i < 30 && (await evaluate(`!!${L}.dialogue?.isActive`)); i++) {
      await evaluate(`${L}.dialogue.advance(); 1`);
      await sleep(150);
    }
  };
  await skipIntro();
  report.preCombatState = await evaluate(`(() => {
    const L = ${L};
    return { introOpen: !!L.introOpen, dialogueActive: !!L.dialogue?.isActive, mode: L.mode,
             enemies: window.__dshLevel.allEnemies().length, wavePending: L.wavePending };
  })()`);
  report.checks.firstWaveObserved = await waitFor(
    () => evaluate('window.__dshLevel.allEnemies().length > 0'), 20000, 'first wave',
  ).then(() => true).catch(() => false);
  await sleep(400);

  // ① 战斗稳态：两个框 + 两行字都在
  const combat = await snap();
  checkSnapshot('combat', combat);
  report.checks.canvasBoxesVisible =
    combat.pauseBtn?.visible === true && combat.bagBtn?.visible === true;
  report.checks.canvasBoxesUnchanged =
    combat.pauseBtn?.x === 474 && combat.pauseBtn?.y === 8 && combat.pauseBtn?.w === 40 && combat.pauseBtn?.h === 16 &&
    combat.bagBtn?.x === 428 && combat.bagBtn?.y === 8 && combat.bagBtn?.w === 40 && combat.bagBtn?.h === 16;
  report.checks.domUiAlignedToCanvas =
    !!combat.canvas && !!combat.domUi &&
    Math.abs(combat.domUi.left - combat.canvas.left) < 2 &&
    Math.abs(combat.domUi.top - combat.canvas.top) < 2 &&
    Math.abs(combat.domUi.width - combat.canvas.width) < 2;
  const css = combat.nodes.map((n) => n.cssText ?? '');
  // 浏览器会把 font:11px sans-serif + line-height:16px 规范化成 font:11px / 16px sans-serif，
  // 所以只认「两个数值都在」，不认 line-height 这个字面属性名。
  report.checks.labelStyleAndPositionUnchanged =
    /right:\s*14px/.test(css[0] ?? '') && /right:\s*54px/.test(css[1] ?? '') &&
    css.every((c) => /top:\s*2px/.test(c) && /pointer-events:\s*none/.test(c) && /11px/.test(c) && /16px/.test(c));
  report.checks.labelsMarkedPersistent = combat.nodes.every((n) => n.persist === '1');
  report.checks.clickHandlersIntact = combat.pauseListeners >= 1 && combat.bagListeners >= 1;
  // 两行字必须各自落在自己那块 canvas 底板里（逻辑坐标 → CSS 像素按画布缩放比换算）：
  // 「暂停」框 434..474，「背包」框 388..428，纵向 0..16。
  const s = (combat.canvas?.width ?? 0) / 480;
  const frames = [{ lo: 434 * s, hi: 474 * s }, { lo: 388 * s, hi: 428 * s }];
  report.checks.labelsInsideOwnBoxes = combat.nodes.every((n, i) => {
    if (!n.exists || !n.rect || !combat.canvas) return false;
    const cx = n.rect.left + n.rect.width / 2 - combat.canvas.left;
    const cy = n.rect.top + n.rect.height / 2 - combat.canvas.top;
    return cx > frames[i].lo && cx < frames[i].hi && cy >= 0 && cy <= 16 * s;
  });
  report.checks.pauseRightOfBag = (combat.nodes[0]?.rect?.left ?? 0) > (combat.nodes[1]?.rect?.left ?? 0);
  report.checks.hudButtonsHostScaled =
    combat.host?.exists === true && combat.host.children === 2 && /scale\(/.test(combat.host.transform ?? '');

  await shot('t1-combat-top-buttons.png');
  const cr = combat.canvas;
  if (cr) {
    await shot('t1-combat-top-buttons-crop.png', {
      x: Math.max(0, cr.left + cr.width * 0.62),
      y: Math.max(0, cr.top),
      width: cr.width * 0.38,
      height: 54,
      scale: 2,
      captureBeyondViewport: false,
    });
  }

  // ② 暂停开合：hideOverlay() 在 closePause() 里被调用；两行字必须还在
  await evaluate('window.__dshGame.scene.getScene("UI").openPause(); 1');
  await sleep(250);
  const paused = await snap();
  report.checks.pauseHidesBothLabels = paused.nodes.every((n) => n.exists && n.visible === false);
  report.checks.pauseOpens = await evaluate('window.__dshGame.scene.getScene("UI").pauseShownNow() === true');
  await evaluate('window.__dshGame.scene.getScene("UI").closePause(); 1');
  await sleep(300);
  const resumed = await snap();
  checkSnapshot('afterPause', resumed);

  // ③ 换武器面板开合：同一组顶部按钮显隐入口
  await evaluate('window.__dshGame.scene.getScene("UI").bagBtn.emit("pointerdown"); 1');
  await sleep(400);
  report.checks.bagPanelOpens = await evaluate('window.__dshGame.scene.getScene("UI").bagOpenNow === true');
  const bagOpen = await snap();
  report.checks.bagHidesBothLabels = bagOpen.nodes.every((n) => n.exists && n.visible === false);
  await evaluate(`${L}.closeWeaponBag('cancel'); 1`);
  await sleep(400);
  const afterBag = await snap();
  checkSnapshot('afterBag', afterBag);

  // ④ 自愈：模拟节点被外部移除后，走一次真实的 HUD 显隐路径
  await evaluate(`(() => {
    document.getElementById('dom-pause-btn')?.remove();
    document.getElementById('dom-bag-btn')?.remove();
    return true;
  })()`);
  const removed = await snap();
  report.checks.removalActuallyHappened = removed.nodes.every((n) => !n.exists);
  await evaluate('window.__dshGame.scene.getScene("UI").setHudShown(false); 1');
  await evaluate('window.__dshGame.scene.getScene("UI").setHudShown(true); 1');
  await sleep(250);
  const healed = await snap();
  checkSnapshot('selfHeal', healed);

  // ⑤ 反复同步不能叠出重复的「暂停暂停」
  for (let i = 0; i < 3; i++) {
    await evaluate('window.__dshGame.scene.getScene("UI").setHudShown(true); 1');
  }
  const repeated = await snap();
  checkSnapshot('afterRepeatedSync', repeated);
  report.checks.noDuplicateIds = repeated.nodes.every((n) => n.count === 1);

  // ⑥ 交互仍走原事件：暂停 / 背包点击后状态照旧变化
  await evaluate('window.__dshGame.scene.getScene("UI").pauseBtn.emit("pointerdown"); 1');
  await sleep(200);
  report.checks.pauseClickStillWorks = await evaluate('window.__dshGame.scene.getScene("UI").pauseShownNow() === true');
  await evaluate('window.__dshGame.scene.getScene("UI").closePause(); 1');
  await sleep(200);
  await evaluate('window.__dshGame.scene.getScene("UI").bagBtn.emit("pointerdown"); 1');
  await sleep(300);
  report.checks.bagClickStillWorks = await evaluate('window.__dshGame.scene.getScene("UI").bagOpenNow === true');
  await evaluate(`${L}.closeWeaponBag('cancel'); 1`);
  await sleep(250);
  const final = await snap();
  checkSnapshot('final', final);

  await shot('t2-after-panels-top-buttons.png');

  // ⑦ 退出战斗：UIScene 停掉时收走自己创建的 DOM，标题/长廊上不能留两行孤字；
  //    重新 launch 后再各自回来一份，不叠成「暂停暂停」。
  await evaluate('window.__dshGame.scene.stop("UI"); 1');
  await sleep(350);
  const stopped = await snap();
  report.snapshots.afterUiStop = stopped;
  report.checks.shutdownRemovesLabels = stopped.nodes.every((n) => !n.exists);
  report.checks.shutdownRemovesHost = stopped.host?.exists === false;
  await evaluate('window.__dshGame.scene.getScene("Level").scene.launch("UI"); 1');
  await sleep(700);
  const relaunched = await snap();
  checkSnapshot('afterRelaunch', relaunched);

  // ⑧ 白名单不能过度放行：无标记的场景级浮动标签（长廊门标签那一类）仍要被
  //    hideOverlay() 清掉。插一个测试节点，走暂停开合触发真实 hideOverlay()。
  await evaluate(`(() => {
    const el = document.createElement('div');
    el.id = 'dom-probe-scene-float';
    el.textContent = '临时门标签';
    document.getElementById('dom-ui').appendChild(el);
    return true;
  })()`);
  await evaluate('window.__dshGame.scene.getScene("UI").openPause(); 1');
  await sleep(180);
  await evaluate('window.__dshGame.scene.getScene("UI").closePause(); 1');
  await sleep(280);
  report.checks.sceneFloatStillCleaned = await evaluate('!document.getElementById("dom-probe-scene-float")');
  const afterCleanup = await snap();
  checkSnapshot('afterHideOverlay', afterCleanup);
} catch (e) {
  report.fatal = String(e && e.message ? e.message : e);
  console.log('PROBE FAILED:', report.fatal);
} finally {
  const vals = Object.values(report.checks);
  report.verdict = {
    total: vals.length,
    passed: vals.filter(Boolean).length,
    failed: Object.entries(report.checks).filter(([, v]) => !v).map(([k]) => k),
  };
  report.verdict.ok =
    report.verdict.total > 0 && report.verdict.failed.length === 0 && !report.fatal && report.errors.length === 0;
  await writeFile(join(outDir, 'top-buttons-label.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report.verdict, null, 2));
  if (report.fatal) console.log('fatal:', report.fatal);
  if (report.errors.length) console.log('errors:', report.errors.slice(0, 5));
  try { ws?.close(); } catch { /* ignore */ }
  try { edge.kill(); } catch { /* ignore */ }
  if (server) { try { server.close(); } catch { /* ignore */ } }
  process.exit(report.verdict.ok ? 0 : 1);
}
