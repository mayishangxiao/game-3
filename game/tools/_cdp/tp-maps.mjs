/**
 * Battlefield look check (ASCII only): act1 humen + act2 tianjing battlefield
 * ground/decal screenshots after the scar art was replaced.
 *
 * Usage: node tools/_cdp/maps.mjs <edgePath> <baseUrl> <outDir>
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';

const edge = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4173';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/tp');
const port = 9387;

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

async function clearAll(maxTries = 14) {
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

    const cases = [
      // 对照组：第一幕虎门炮台海战必须仍是 bg_strip_dusk，不能被城破之战的新背景串场
      { name: 'humen', data: { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 }, file: 'bg-humen-dusk.png' },
      { name: 'village', data: { actId: 'ch00_act2', chapterId: 'ch00', startNode: 0 }, file: 'tp-village.png' },
      { name: 'city', data: { actId: 'ch00_act2', chapterId: 'ch00', startNode: 1 }, file: 'tp-city.png' },
      { name: 'battlefield', data: { actId: 'ch00_act2', chapterId: 'ch00', startNode: 3 }, file: 'tp-battlefield.png' },
    ];
    for (const c of cases) {
      await gotoScene('Level', c.data);
      await clearAll();
      await sleep(1200);
      await clearAll(6);
      await sleep(900);
      const info = await evaluate(`
        (function () {
          var l = window.__dshGame.scene.getScene('Level');
          var g = l.map && l.map.ground;
          return {
            node: l.node ? l.node.id : null,
            map: l.map ? l.map.def.id : null,
            tileset: l.map ? l.map.def.tileset : null,
            sheetLoaded: window.__dshGame.textures.exists('tp_act2_sheet'),
            mode: l.mode,
            scars: l.map ? l.map.def.battle_scars === true : null,
            groundTex: g && g.texture ? g.texture.key : null,
            horizonTex: l.children.list
              .filter(function (o) { return o.texture && o.texture.key && o.texture.key.indexOf('bg_strip') >= 0; })
              .map(function (o) { return o.texture.key; }),
            enemies: l.enemies.length,
            zoom: l.cameras.main.zoom,
          };
        })()
      `);
      report[c.name] = info;
      await shot(c.file);
    }

    report.errors = errors.slice(0, 8);
  } finally {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    await writeFile(join(outDir, 'maps.json'), JSON.stringify(report, null, 2), 'utf-8');
    console.log(JSON.stringify(report, null, 2));
    setTimeout(() => process.exit(0), 250);
  }
}

main().catch(async (e) => {
  console.error('FATAL', e && e.message);
  try {
    await writeFile(join(outDir, 'maps.json'), JSON.stringify({ fatal: String(e && e.message), errors }, null, 2), 'utf-8');
  } catch {
    /* ignore */
  }
  process.exit(1);
});