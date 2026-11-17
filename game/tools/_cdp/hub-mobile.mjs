/**
 * 手机端长廊探针（v2.9.7）。
 *
 * 手机是主目标平台，长廊这一屏在真机上出过三个问题，这里逐条锁：
 *   1. 文字越界：上一关的 HUD 叠在长廊标题上、门标签被挤到换行；
 *   2. 不能滑动：整屏横滑要能推走廊，松手吸附最近一幕；
 *   3. 点了就进：现在点门只选中，按「进入」才真的进关卡。
 *
 * 用 844×390 / dpr3 的横屏手机模拟，触摸事件走 CDP Input.dispatchTouchEvent，
 * 断言读的是 HubScene 的真实状态（cursor / camX）和 DOM 的布局盒。
 *
 * Usage: node tools/_cdp/hub-mobile.mjs <edgePath> <baseUrl> <outDir>
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';

const edge = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4188';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_hub-mobile');
const port = 9397;

const errors = [];
const consoleErrors = [];
const report = { checks: {} };
let ws;
let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r?.result?.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('evaluate threw: ' + (d?.exception?.description ?? JSON.stringify(d)).slice(0, 300));
  }
  return r?.result?.result?.value;
}

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true;
    await sleep(150);
  }
  throw new Error('timeout: ' + label);
}

function assert(cond, label) {
  report.checks[label] = !!cond;
  if (!cond) errors.push('ASSERT FAILED: ' + label);
}

async function shot(name) {
  await evaluate(
    'new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(1); }); }); })',
  );
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  if (r?.result?.data) await writeFile(join(outDir, name), Buffer.from(r.result.data, 'base64'));
}

/** 逻辑坐标（480×270）→ 设备 CSS 像素 */
async function toCss(logicalX, logicalY) {
  return await evaluate(`(() => {
    const c = document.querySelector('#game-root canvas');
    const r = c.getBoundingClientRect();
    const s = r.width / 480;
    return { x: r.left + ${logicalX} * s, y: r.top + ${logicalY} * s, s };
  })()`);
}

async function tap(logicalX, logicalY) {
  const p = await toCss(logicalX, logicalY);
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
  });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(260);
}

async function swipe(fromX, toX, y) {
  const a = await toCss(fromX, y);
  const b = await toCss(toX, y);
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: a.x, y: a.y, id: 2, radiusX: 4, radiusY: 4, force: 1 }],
  });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const yy = a.y + ((b.y - a.y) * i) / steps;
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: yy, id: 2, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await sleep(16);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(420);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await rm(join(outDir, 'profile'), { recursive: true, force: true });
  const proc = spawn(
    edge,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${join(outDir, 'profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=900,600',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
      } catch {
        /* not up */
      }
      if (!target) await sleep(300);
    }
    if (!target) throw new Error('devtools not up');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails;
        consoleErrors.push(String(d?.exception?.description ?? d?.text ?? 'exception').split('\n')[0].slice(0, 200));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        consoleErrors.push(String(msg.params.args?.[0]?.value ?? 'console.error').slice(0, 200));
      }
    };
    await send('Page.enable');
    await send('Runtime.enable');
    // 横屏手机：844×390、dpr3、开触摸（真机长这样）
    await send('Emulation.setDeviceMetricsOverride', {
      width: 844,
      height: 390,
      deviceScaleFactor: 3,
      mobile: true,
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    await send('Page.navigate', { url: baseUrl + '/index.html' });
    await waitFor(async () => await evaluate("!!document.getElementById('tap-gate')"), 25000, 'gate');
    await evaluate("document.getElementById('tap-gate').click(), 'ok'");
    await waitFor(async () => await evaluate('!!window.__dshGame'), 40000, 'ready');
    await evaluate("(function(){var g=document.getElementById('tap-gate'); if(g){g.remove();} return 'ok';})()");
    await waitFor(
      async () =>
        await evaluate("!!(window.__dshGame.scene.getScene('Title')?.scene.isActive())"),
      20000,
      'title active',
    );

    // 先制造「刚打完一仗回到长廊」的现场：UIScene 会把上一关的战役条留在 DOM 里，
    // 手机截图里那两行叠字就是它。这里直接把残留写进 DOM 再进长廊，验证长廊会收掉。
    await evaluate(`(function(){
      var scene = document.getElementById('dom-hud-scene');
      var detail = document.getElementById('dom-hud-detail');
      var panel = document.getElementById('dom-hud-panel');
      if (scene) scene.textContent = '太平天国运动 · 金田村突围　1851 年';
      if (detail) detail.textContent = '时间 · 地点 · 敌军';
      if (panel) panel.style.visibility = 'visible';
      return 'ok';
    })()`);
    await evaluate(`(function(){
      window.__dshGame.scene.getScene('Title').scene.start('Hub', { chapterId: 'ch00' });
      return 'ok';
    })()`);
    await waitFor(
      async () =>
        await evaluate(
          "window.__dshGame.scene.isActive('Hub') && window.__dshGame.scene.getScene('Hub').doors.length > 0",
        ),
      30000,
      'hub ready',
    );
    await sleep(700);

    const dom = await evaluate(`(() => {
      const q = (s) => document.querySelector(s);
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      const canvas = q('#game-root canvas');
      const cr = canvas.getBoundingClientRect();
      const labels = Array.from(document.querySelectorAll('#hub-labels > div')).map((el) => {
        const nameEl = el.firstElementChild;
        return { text: el.textContent, rect: rect(el), nameH: nameEl ? nameEl.getBoundingClientRect().height : 0 };
      });
      const top = q('#dom-overlay > div');
      const enter = q('#hub-enter');
      const hudPanel = q('#dom-hud-panel');
      const hudVis = hudPanel ? getComputedStyle(hudPanel).visibility : 'none';
      return {
        canvas: { w: cr.width, h: cr.height, l: cr.left, t: cr.top },
        labels,
        top: rect(top),
        topText: top ? top.textContent : '',
        enter: enter ? { text: enter.textContent, rect: rect(enter), disabled: enter.disabled } : null,
        hudVis,
        buttons: Array.from(document.querySelectorAll('[data-hub]')).map((b) => b.textContent + '#' + b.dataset.hub),
      };
    })()`);
    report.snapshot = dom;
    await shot('hub-mobile.png');

    const s = dom.canvas.w / 480;
    assert(dom.canvas.w > 600 && dom.canvas.h > 300, '画布按横屏手机铺满');
    assert(dom.hudVis !== 'visible', '上一关 HUD 已收起（不再压在长廊标题上）');
    assert(dom.labels.length === 5, '五幕门标签都在');
    assert(
      dom.labels.every((x) => x.nameH > 0 && x.nameH <= 14 * 1.6 * s),
      '门标签名字单行不换行',
    );
    assert(
      dom.labels.every((x) => x.rect.w <= 108 * s + 2),
      '门标签宽度不超出定宽',
    );
    // 标签与顶部大标题不重叠
    const visibleLabels = dom.labels.filter((x) => x.rect.w > 0 && x.rect.r > 0 && x.rect.l < 844);
    const labelTop = Math.min(...visibleLabels.map((x) => x.rect.t));
    assert(!dom.top || labelTop >= dom.top.b - 1, '门标签不与顶栏重叠');
    assert(!!dom.enter && /第1幕/.test(dom.enter.text), '确认按钮带当前选中幕名');
    assert(dom.enter.rect.h >= 24 * s - 1, '确认按钮高度按触摸尺寸放大');
    assert(dom.buttons.includes('图鉴#codex') && dom.buttons.includes('副本#dungeon'), '底部入口齐全（含副本）');

    // ---- 副本面板：点按钮弹出、行数够、能关掉（手机上不再是常驻左栏）----
    const dungeonBtn = await evaluate(`(() => {
      const b = document.querySelector('[data-hub="dungeon"]');
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: dungeonBtn.x, y: dungeonBtn.y, id: 9, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await sleep(60);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(240);
    const panelOpen = await evaluate(`(() => {
      const box = document.getElementById('hub-dungeon');
      const rows = document.querySelectorAll('[data-dungeon]');
      return { open: !!box, rows: rows.length, first: rows[0] ? rows[0].textContent : '' };
    })()`);
    report.dungeonPanel = panelOpen;
    await shot('hub-dungeon.png');
    assert(panelOpen.open && panelOpen.rows >= 3, '副本面板能弹出且行数正确');
    const closeBtn = await evaluate(`(() => {
      const b = document.getElementById('hub-dungeon-close');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: closeBtn.x, y: closeBtn.y, id: 10, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await sleep(60);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
    assert(!(await evaluate("!!document.getElementById('hub-dungeon')")), '副本面板能关掉');

    // ---- 点门只选中，不进去（此时相机还在起点，第一道门在屏幕内）----
    const targetIndex = 0;
    await tap(110, 132);
    const afterTap = await evaluate(`(() => {
      const h = window.__dshGame.scene.getScene('Hub');
      return {
        cursor: h.cursor,
        hubActive: h.scene.isActive(),
        levelActive: window.__dshGame.scene.isActive('Level'),
        confirm: (document.getElementById('hub-enter') || {}).textContent,
      };
    })()`);
    report.tap = afterTap;
    await shot('hub-after-select.png');
    assert(afterTap.cursor === targetIndex, '点门选中该幕');
    assert(afterTap.hubActive && !afterTap.levelActive, '点门不直接进关（要先确认）');
    assert(/第1幕/.test(afterTap.confirm || ''), '确认按钮跟着选中更新');

    // ---- 滑动：手指从右往左推，相机右移 + 光标换幕 ----
    const before = await evaluate(`(() => {
      const h = window.__dshGame.scene.getScene('Hub');
      return { cursor: h.cursor, camX: Math.round(h.camX) };
    })()`);
    await swipe(420, 120, 150);
    const afterSwipe = await evaluate(`(() => {
      const h = window.__dshGame.scene.getScene('Hub');
      return { cursor: h.cursor, camX: Math.round(h.camX), active: h.scene.isActive() };
    })()`);
    report.swipe = { before, afterSwipe };
    await shot('hub-after-swipe.png');
    assert(afterSwipe.camX > before.camX + 40, '横滑能推动走廊（相机右移）');
    assert(afterSwipe.cursor !== before.cursor, '松手吸附到另一幕');
    assert(afterSwipe.active === true, '滑动不会误进关卡');

    // ---- 按确认才进关卡（进的是滑动后选中的那一幕）----
    const selected = await evaluate(`(() => {
      const h = window.__dshGame.scene.getScene('Hub');
      return { actId: h.doors[h.cursor].actId, name: h.doors[h.cursor].name };
    })()`);
    const enterBox = await evaluate(`(() => {
      const b = document.getElementById('hub-enter');
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: enterBox.x, y: enterBox.y, id: 3, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await sleep(60);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitFor(
      async () =>
        await evaluate("window.__dshGame.scene.isActive('Level') && !!window.__dshGame.scene.getScene('Level').act"),
      40000,
      'level started',
    );
    const entered = await evaluate(`(() => {
      const l = window.__dshGame.scene.getScene('Level');
      return { act: l.act ? l.act.id : null, hubActive: window.__dshGame.scene.isActive('Hub') };
    })()`);
    report.enter = { selected, entered };
    await sleep(400);
    await shot('hub-into-level.png');
    assert(entered.act === selected.actId, '确认后进入选中的那一幕');
    assert(entered.hubActive === false, '长廊已退出');

    assert(consoleErrors.length === 0, '控制台零异常');
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    proc.kill();
  }

  report.errors = errors;
  report.consoleErrors = consoleErrors;
  const pass = Object.values(report.checks).filter(Boolean).length;
  const total = Object.keys(report.checks).length;
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.checks, null, 2));
  for (const e of errors) console.log('ERR ' + e);
  for (const e of consoleErrors) console.log('CONSOLE ' + e);
  console.log(`\n${pass}/${total} checks passed`);
  if (pass !== total) process.exitCode = 1;
}

main().catch((e) => {
  console.error('PROBE FAILED', e);
  process.exitCode = 1;
});
