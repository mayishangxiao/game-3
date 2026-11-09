/**
 * Temporary regression probe: story defeat -> retry -> clean revive, and no
 * leftover opium crates on the Taiping maps.
 * Usage: node tools/_cdp/tp-defeat.mjs <edgePath> <baseUrl> <outDir>
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';

const edge = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4173';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/tp');
const port = 9388;

const errors = [];
let ws;
let msgId = 0;
const pending = new Map();
const report = { shots: [] };

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
  const b64 = r?.result?.data;
  if (b64) await writeFile(join(outDir, name), Buffer.from(b64, 'base64'));
  report.shots.push(name);
}

async function gotoLevel(data) {
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
  await evaluate(`window.__dshGame.scene.start('Level', ${JSON.stringify(data)}), 'ok'`);
  await waitFor(
    async () =>
      await evaluate(
        "(function () { var s = window.__dshGame.scene.getScene('Level'); return !!(s && s.scene.isActive() && s.map); })()",
      ),
    15000,
    'Level active',
  );
}

async function clearAll(maxTries = 16) {
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
    await sleep(130);
  }
}

const stateExpr = `
  (function () {
    var l = window.__dshGame.scene.getScene('Level');
    var p = l.player;
    var rig = p && p.rig;
    var u = rig && (rig.unitImage || (rig.partImgs && rig.partImgs[0]));
    return {
      node: l.node ? l.node.id : null,
      map: l.map ? l.map.def.id : null,
      mode: l.mode,
      storyFailOpen: !!l.storyFailOpen,
      nodeBusy: !!l.nodeBusy,
      introOpen: !!l.introOpen,
      alive: p ? p.alive : null,
      hp: p ? p.hp : null,
      maxHp: p ? p.maxHp : null,
      rigDead: rig ? rig.dead : null,
      tintFill: u ? !!u.tintFill : null,
      alpha: rig ? rig.alpha : null,
      angle: rig ? rig.angle : null,
      px: p ? Math.round(p.x) : null,
      py: p ? Math.round(p.y) : null,
      spawn: l.map ? { x: (l.map.def.spawn.x + 0.5) * 16, y: (l.map.def.spawn.y + 0.5) * 16 } : null,
      pickups: l.worldObjects.filter(function (o) { return o.def.kind === 'pickup'; }).length,
      visiblePickups: l.worldObjects.filter(function (o) { return o.def.kind === 'pickup' && o.rect.visible; }).length,
      overlayTexts: (function () {
        var out = [];
        l.children.list.forEach(function (o) {
          if (o.type !== 'Container') return;
          o.list.forEach(function (c) { if (c.type === 'Text' && c.text) out.push(c.text); });
        });
        return out;
      })(),
    };
  })()
`;

async function main() {
  await mkdir(outDir, { recursive: true });
  const profile = join(outDir, 'profile-defeat');
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
    await waitFor(async () => await evaluate("!!document.getElementById('tap-gate')"), 25000, 'gate');
    await evaluate("document.getElementById('tap-gate').click(), 'ok'");
    await waitFor(async () => await evaluate('!!window.__dshGame'), 40000, 'ready');
    await sleep(300);
    await evaluate(`
      (function () {
        var g = document.getElementById('tap-gate');
        if (g) { g.click(); g.style.display = 'none'; g.classList.add('hidden'); }
        return 'closed';
      })()
    `);
    await sleep(700);

    // --- clean map check on all three Taiping maps ---
    const maps = [
      { key: 'village', startNode: 0, file: 'clean-village.png' },
      { key: 'city', startNode: 1, file: 'clean-city.png' },
      { key: 'battlefield', startNode: 3, file: 'clean-battlefield.png' },
    ];
    for (const m of maps) {
      await gotoLevel({ actId: 'ch00_act2', chapterId: 'ch00', startNode: m.startNode });
      await clearAll();
      await sleep(1000);
      report[m.key] = await evaluate(stateExpr);
      if (m.key === 'battlefield') await shot(m.file);
    }

    // --- death / retry flow on the battlefield node ---
    await gotoLevel({ actId: 'ch00_act2', chapterId: 'ch00', startNode: 3 });
    await clearAll();
    await sleep(900);
    await evaluate(`
      (function () {
        var l = window.__dshGame.scene.getScene('Level');
        l.nodeBusy = false; l.introOpen = false;
        return 'unlocked';
      })()
    `);
    report.before = await evaluate(stateExpr);
    await shot('defeat-before.png');

    await evaluate(`
      (function () {
        var l = window.__dshGame.scene.getScene('Level');
        l.player.takeRaw(99999);
        return 'killed';
      })()
    `);
    await waitFor(async () => await evaluate('!!window.__dshGame.scene.getScene("Level").storyFailOpen'), 6000, 'fail panel');
    await sleep(400);
    report.panel = await evaluate(stateExpr);
    await shot('defeat-panel.png');

    // click the "再试一次" text button (dungeonButton registers pointerdown on the text too)
    const clicked = await evaluate(`
      (function () {
        var l = window.__dshGame.scene.getScene('Level');
        var btn = null;
        l.children.list.forEach(function (o) {
          if (o.type !== 'Container') return;
          o.list.forEach(function (c) { if (c.type === 'Text' && c.text === '再试一次') btn = c; });
        });
        if (!btn) return false;
        btn.emit('pointerdown');
        return true;
      })()
    `);
    report.retryClicked = clicked;
    await sleep(1600);
    await clearAll(8);
    report.after = await evaluate(stateExpr);
    await shot('defeat-after.png');

    report.errors = errors.slice(0, 8);
  } finally {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    await writeFile(join(outDir, 'defeat.json'), JSON.stringify(report, null, 2), 'utf-8');
    console.log(JSON.stringify(report, null, 2));
    setTimeout(() => process.exit(0), 250);
  }
}

main().catch(async (e) => {
  console.error('FATAL', e && e.message);
  try {
    await writeFile(join(outDir, 'defeat.json'), JSON.stringify({ fatal: String(e && e.message), errors }, null, 2), 'utf-8');
  } catch {
    /* ignore */
  }
  process.exit(1);
});
