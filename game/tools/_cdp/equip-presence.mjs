/**
 * Equipment presence E2E probe (v1.5).
 *
 * Verifies the five "make equipment noticeable" changes in a real Phaser scene:
 *   - slot progress lines + enhance hint / disabled button in EquipmentScene
 *   - compareWithEquipped wired into the equip message (contains the delta arrow)
 *   - gain-0 enhancement refuses to spend scrap (both button and keyboard path)
 *   - drop visual container: shape = slot, color = quality, purple has a glow
 *   - weapon_ref on the equipped weapon really changes player.weapon in LevelScene
 *
 * Usage: node tools/_cdp/equip-presence.mjs <edgePath> <baseUrl> <outDir>
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';

const edge = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4188';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/equip');
const port = 9391;

const errors = [];
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

/** Inject a deterministic save: one gain-0 cloth, one bow, one purple accessory. */
async function seedSave(withEquippedBow) {
  return await evaluate(`
    (function () {
      var key = 'dsp_save_v1';
      var s = JSON.parse(localStorage.getItem(key) || 'null');
      if (!s) s = {}; // migrate() fills in every default; we only override the fields we need
      function it(uid, base_id, slot, quality, name, stat, value, enhance, affixes, weapon_ref) {
        var o = { uid: uid, base_id: base_id, slot: slot, quality: quality, name: name,
                  stat: stat, value: value, enhance: enhance, affixes: affixes || [] };
        if (weapon_ref) o.weapon_ref = weapon_ref;
        return o;
      }
      s.bag = { slots: 60, items: [
        it('e1','eq_head_cloth_white_01','head','white','\u5e03\u5dfe','def',4,0,[]),
        it('e2','eq_wp_bow_blue_01','weapon','blue','\u864e\u95e8\u730e\u5f13','atk',15,0,[],'wp_bow'),
        it('e3','eq_acc_linzexu_purple_01','accessory','purple','\u94a6\u5dee\u7684\u706b\u6f06\u5370','def',5,0,[{id:'af_crit',value:5}])
      ] };
      s.equipment = { weapon: null, head: null, body: null, legs: null, accessory: null };
      if (${withEquippedBow ? 'true' : 'false'}) {
        s.equipment.weapon = it('w1','eq_wp_bow_blue_01','weapon','blue','\u864e\u95e8\u730e\u5f13','atk',15,0,[],'wp_bow');
      }
      s.scrap = 500;
      localStorage.setItem(key, JSON.stringify(s));
      return 'ok';
    })()
  `);
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

function assert(cond, label) {
  report.checks[label] = !!cond;
  if (!cond) errors.push('ASSERT FAILED: ' + label);
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

    const seeded = await seedSave(true);
    assert(seeded === 'ok', 'save seeded');
    await openGame(false);

    // ---------- EquipmentScene ----------
    await gotoScene('Equipment');
    await sleep(500);
    const texts = await evaluate(`
      (function () {
        var s = window.__dshGame.scene.getScene('Equipment');
        return s.root.list.filter(function (o) { return o.type === 'Text'; })
          .map(function (o) { return o.text; });
      })()
    `);
    report.texts = texts;
    assert(texts.some((t) => t.includes('\u6700\u9ad8\uff1a')), 'slot progress lines visible');
    assert(texts.some((t) => t.includes('\u76ee\u6807\uff1a')), 'unreached target visible');
    assert(texts.some((t) => t.includes('\u5f3a\u5316 R') && t.includes('\u2192')), 'enhance button shows delta');
    assert(
      texts.some((t) => t.includes('\u672c\u6b21\u5f3a\u5316\u65e0\u63d0\u5347')),
      'gain-0 hint visible',
    );

    const btn = await evaluate(`
      (function () {
        var s = window.__dshGame.scene.getScene('Equipment');
        var t = s.root.list.find(function (o) { return o.type === 'Text' && o.text.indexOf('\u5f3a\u5316 R') === 0; });
        return t ? { text: t.text, interactive: !!(t.input && t.input.enabled) } : null;
      })()
    `);
    report.enhanceButton = btn;
    assert(btn && btn.interactive === false, 'gain-0 enhance button disabled');
    await shot('equipment-initial.png'); // before any action: gain-0 state + progress lines

    const scrapBefore = await evaluate("JSON.parse(localStorage.getItem('dsp_save_v1')).scrap");
    await evaluate("window.__dshGame.scene.getScene('Equipment').enhanceSelected(), 'ok'");
    const afterEnhance = await evaluate(`
      (function () {
        var s = window.__dshGame.scene.getScene('Equipment');
        return { message: s.message, scrap: JSON.parse(localStorage.getItem('dsp_save_v1')).scrap };
      })()
    `);
    report.enhanceAttempt = afterEnhance;
    assert(afterEnhance.message.includes('\u672c\u6b21\u5f3a\u5316\u65e0\u63d0\u5347'), 'keyboard R also blocked');
    assert(afterEnhance.scrap === scrapBefore, 'no scrap spent on gain-0 enhance');

    await evaluate("window.__dshGame.scene.getScene('Equipment').equipSelected(), 'ok'");
    const equipMsg = await evaluate("window.__dshGame.scene.getScene('Equipment').message");
    report.equipMessage = equipMsg;
    assert(/\u25b2|\u25bc/.test(equipMsg), 'equip message shows delta arrow');
    await shot('equipment.png');

    // ---------- LevelScene: weapon_ref + drop visuals ----------
    await gotoScene('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 });
    await clearAll();
    await waitFor(
      async () =>
        await evaluate(
          "(function(){var l=window.__dshGame.scene.getScene('Level'); return !!(l && l.player && l.player.weapon && l.player.weapon.id === 'wp_bow');})()",
        ),
      25000,
      'equipped bow applied',
    );
    report.equippedWeapon = await evaluate(`
      (function () {
        var w = window.__dshGame.scene.getScene('Level').player.weapon;
        return { id: w.id, range: w.range, aps: w.attacks_per_sec };
      })()
    `);
    assert(report.equippedWeapon.id === 'wp_bow', 'weapon_ref switched the actual weapon');
    assert(report.equippedWeapon.range === 200, 'bow range applied');

    report.drops = await evaluate(`
      (function () {
        var l = window.__dshGame.scene.getScene('Level');
        function probe(item) {
          var v = l.makeDropVisual(120, 120, item);
          var names = v.obj.list.map(function (o) { return o.name; });
          var out = { slot: v.obj.getData('slot'), quality: v.obj.getData('quality'),
                      names: names, hasGlow: !!v.glow };
          l.destroyFloorItem({ obj: v.obj, item: item, glow: v.glow });
          return out;
        }
        var purple = { uid:'p', base_id:'eq_acc_linzexu_purple_01', slot:'accessory',
                       quality:'purple', name:'p', stat:'def', value:5, enhance:0, affixes:[] };
        var white = { uid:'w', base_id:'eq_wp_dao_white_01', slot:'weapon',
                      quality:'white', name:'w', stat:'atk', value:12, enhance:0, affixes:[] };
        return { purple: probe(purple), white: probe(white) };
      })()
    `);
    assert(report.drops.purple.names.includes('drop-shape-accessory'), 'purple accessory shape is a diamond');
    assert(report.drops.purple.names.includes('drop-glow'), 'purple drop has glow object');
    assert(report.drops.white.names.includes('drop-shape-weapon'), 'white weapon shape is a bar');
    assert(report.drops.white.hasGlow === false, 'white drop has no glow');
    assert(report.drops.purple.slot === 'accessory' && report.drops.white.quality === 'white', 'drop data tags');

    await clearAll(6);
    await sleep(600);
    await shot('level-equipped-bow.png');
  } finally {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    report.errors = errors.slice(0, 12);
    report.ok = errors.length === 0;
    await writeFile(join(outDir, 'equip-presence.json'), JSON.stringify(report, null, 2), 'utf-8');
    console.log(JSON.stringify(report, null, 2));
    setTimeout(() => process.exit(report.ok ? 0 : 1), 250);
  }
}

main().catch(async (e) => {
  console.error('FATAL', e && e.message);
  try {
    await writeFile(join(outDir, 'equip-presence.json'), JSON.stringify({ fatal: String(e && e.message), errors }, null, 2), 'utf-8');
  } catch {
    /* ignore */
  }
  process.exit(1);
});
