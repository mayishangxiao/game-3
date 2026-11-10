/**
 * 敌人贴墙卡死回归探针（甲方截图「这两个小兵卡住了」）。
 *
 * 在真实 Phaser 关卡里验证：
 *   - 所有存活敌人的「中心 + 12×8 脚盒四角」都合法；
 *   - 敌人确实朝玩家移动，没有静止在墙边、stuckMs 不持续增长；
 *   - 用 teleport 复现旧版「中心合法但脚盒压墙」的半嵌状态，
 *     新判据能认出来、rescue() 能把人捞回合法空地并恢复移动。
 *
 * Usage: node tools/_cdp/enemy-stuck.mjs <edgePath> <baseUrl> <outDir>
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';

const edge = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4190';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/enemy-stuck');
const port = 9404;

const errors = [];
const report = { checks: {}, scenes: {} };
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
    await sleep(200);
  }
  throw new Error('timeout: ' + label);
}

async function shot(name) {
  await evaluate(
    'new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(1); }); }); })',
  );
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  if (r?.result?.data) await writeFile(join(outDir, name), Buffer.from(r.result.data, 'base64'));
}

function assert(cond, label) {
  report.checks[label] = !!cond;
  if (!cond) errors.push('ASSERT FAILED: ' + label);
}

async function gotoScene(key, data = {}) {
  await evaluate(`
    (function () {
      var g = window.__dshGame;
      ['Title','Hub','Level','UI','Equipment','Graph','Codex','Quiz'].forEach(function (k) {
        var s = g.scene.getScene(k);
        if (s && s.scene.isActive()) g.scene.stop(k);
      });
      return 'ok';
    })()
  `);
  await sleep(400);
  await evaluate(`window.__dshGame.scene.start(${JSON.stringify(key)}, ${JSON.stringify(data)}), 'ok'`);
  await waitFor(
    async () =>
      await evaluate(
        `(function () { var s = window.__dshGame.scene.getScene(${JSON.stringify(key)}); return !!(s && s.scene.isActive()); })()`,
      ),
    15000,
    key + ' active',
  );
}

async function openGame(first) {
  if (!first) await send('Page.reload', { ignoreCache: true });
  await waitFor(async () => await evaluate("!!document.getElementById('tap-gate')"), 25000, 'gate');
  await evaluate("document.getElementById('tap-gate').click(), 'ok'");
  await waitFor(async () => await evaluate('!!window.__dshGame'), 40000, 'ready');
  await evaluate(
    "(function(){var g=document.getElementById('tap-gate'); if(g){g.style.display='none';} return 'ok';})()",
  );
  await sleep(700);
}

async function clearAll(maxTries = 20) {
  for (let i = 0; i < maxTries; i++) {
    const busy = await evaluate(`
      (function () {
        var l = window.__dshGame.scene.getScene('Level');
        if (l.dialogue && l.dialogue.isActive) { l.dialogue.advance(); return 'dlg'; }
        if (l.pendingCardTap) { l.pendingCardTap(); return 'card'; }
        return 'idle';
      })()
    `);
    if (busy === 'idle') return;
    await sleep(150);
  }
}

/** 一次性读快照，避免多次 CDP 往返之间浏览器跑帧导致数值对不上 */
const SNAPSHOT = `
  (function () {
    var h = window.__dshLevel;
    var l = window.__dshGame.scene.getScene('Level');
    return {
      player: { x: l.player.x, y: l.player.y },
      mode: l.mode,
      enemies: h.enemyStates().filter(function (e) { return e.alive; }).map(function (e) {
        return { i: e.i, x: e.x, y: e.y, state: e.state, stuckMs: e.stuckMs,
                 footUnsafe: h.footUnsafe(e.x, e.y), unsafe: h.unsafe(e.x, e.y) };
      })
    };
  })()
`;

async function runScene(tag, sceneData, shotName) {
  await gotoScene('Level', sceneData);
  await clearAll();
  await waitFor(
    async () =>
      await evaluate(
        "(function(){var l=window.__dshGame.scene.getScene('Level'); return !!(l && l.player && l.mode === 'combat' && !l.nodeBusy && window.__dshLevel);})()",
      ),
    25000,
    tag + ' combat ready',
  );
  await waitFor(
    async () => await evaluate('window.__dshLevel.enemies().length > 0'),
    25000,
    tag + ' wave spawned',
  );

  const a = await evaluate(SNAPSHOT);
  await sleep(2400);
  const b = await evaluate(SNAPSHOT);
  report.scenes[tag] = { before: a, after: b };

  assert(a.enemies.length > 0, tag + ': wave has enemies');
  assert(
    a.enemies.every((e) => e.footUnsafe === false),
    tag + ': no enemy spawns with foot box inside a wall',
  );
  assert(
    b.enemies.every((e) => e.footUnsafe === false),
    tag + ': no enemy ends inside a wall',
  );

  // 按 index 配对（死掉的会消失，取交集）
  const pairs = a.enemies
    .map((e) => ({ a: e, b: b.enemies.find((v) => v.i === e.i) }))
    .filter((p) => p.b);
  const moved = pairs.map((p) => Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y));
  assert(
    moved.length > 0 && moved.some((d) => d > 20),
    tag + ': enemies actually chase the player (max move ' +
      Math.max(0, ...moved).toFixed(1) + 'px)',
  );
  assert(
    b.enemies.every((e) => e.stuckMs < 700),
    tag + ': no enemy stuck against a wall',
  );

  // 主动复现旧版半嵌墙状态：找一个「中心可站但脚盒压墙」的点
  const bad = await evaluate(`
    (function () {
      var h = window.__dshLevel;
      var g = h.grid();
      if (!g) return null;
      // 只在真实出怪区（右侧几列）找半嵌点：那里才是甲方截图里两个兵卡住的位置。
      // 全图扫会挑中地图左上角的封闭角落，把敌人扔进去当然走不出来，那是探针
      // 造出来的假场景，不是出生点 bug。
      var offs = [13, 3, 8];
      for (var ty = 2; ty < g.rows - 1; ty++) {
        for (var gx = Math.max(1, g.cols - 8); gx < g.cols - 1; gx++) {
          for (var k = 0; k < offs.length; k++) {
            var x = gx * 16 + offs[k];
            var y = ty * 16 + 8;
            if (!h.unsafe(x, y) && h.footUnsafe(x, y)) return { x: x, y: y, ty: ty, gx: gx };
          }
        }
      }
      return null;
    })()
  `);
  report.scenes[tag].badPoint = bad;
  assert(!!bad, tag + ': found a center-safe / foot-blocked wall-edge point');

  if (bad && a.enemies.length > 0) {
    const idx = a.enemies[0].i;
    const planted = await evaluate(`
      (function () {
        var h = window.__dshLevel;
        var ok = h.teleport(${idx}, ${bad.x}, ${bad.y});
        var e = h.enemyStates()[${idx}];
        return { ok: ok, x: e.x, y: e.y,
                 footUnsafe: h.footUnsafe(e.x, e.y), unsafe: h.unsafe(e.x, e.y) };
      })()
    `);
    report.scenes[tag].planted = planted;
    assert(planted.ok === true, tag + ': teleport reproduces the old stuck position');
    assert(
      planted.footUnsafe === true && planted.unsafe === false,
      tag + ': new foot-box predicate catches what the old center-only one missed',
    );

    const rescued = await evaluate(`
      (function () {
        var h = window.__dshLevel;
        h.rescue();
        var e = h.enemyStates()[${idx}];
        return { x: e.x, y: e.y, footUnsafe: h.footUnsafe(e.x, e.y) };
      })()
    `);
    report.scenes[tag].rescued = rescued;
    assert(
      Math.hypot(rescued.x - planted.x, rescued.y - planted.y) > 1,
      tag + ': rescue moves the half-embedded enemy out of the wall',
    );
    assert(rescued.footUnsafe === false, tag + ': rescued landing point is fully walkable');

    await sleep(1400);
    const c = await evaluate(SNAPSHOT);
    const after = c.enemies.find((e) => e.i === idx);
    report.scenes[tag].afterRescue = c;
    assert(
      !!after && Math.hypot(after.x - rescued.x, after.y - rescued.y) > 8,
      tag + ': rescued enemy resumes chasing instead of standing still',
    );
  }

  await shot(shotName);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const profile = join(outDir, 'profile');
  const proc = spawn(
    edge,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=980,600',
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
        errors.push(String(d?.exception?.description ?? d?.text ?? 'exception').split('\n')[0].slice(0, 200));
      }
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 960,
      height: 540,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Page.navigate', { url: baseUrl + '/index.html' });
    await openGame(true);
    await openGame(false);

    // 第一幕虎门炮台（旧图）与第二幕天京城破（tp_act2 图集）各跑一遍
    await runScene(
      'humen',
      { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 },
      'e1-humen-chasing.png',
    );
    await runScene(
      'tianjing',
      { actId: 'ch00_act2', chapterId: 'ch00', startNode: 3 },
      'e2-tianjing-chasing.png',
    );
  } catch (e) {
    errors.push('FATAL: ' + String(e?.stack ?? e).slice(0, 500));
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    proc.kill();
    report.ok = errors.length === 0;
    report.errors = errors;
    report.summary = {
      total: Object.keys(report.checks).length,
      passed: Object.values(report.checks).filter(Boolean).length,
    };
    await writeFile(join(outDir, 'enemy-stuck.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}

main();
