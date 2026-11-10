/**
 * 战斗内切换武器 E2E 探针（设计书 4.3.8）。
 *
 * 在真实 Phaser 关卡里验证：门禁 / 世界冻结 / 界面状态 / 取消 / 重复 / 不可用 /
 * 切换后属性·攻击·背包·HUD 即时同步 / 战斗结束自动收起。
 *
 * Usage: node tools/_cdp/weapon-swap.mjs <edgePath> <baseUrl> <outDir>
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';

const edge = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4189';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/weapon-swap');
const port = 9403;

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
  if (r?.result?.data) await writeFile(join(outDir, name), Buffer.from(r.result.data, 'base64'));
}

function assert(cond, label) {
  report.checks[label] = !!cond;
  if (!cond) errors.push('ASSERT FAILED: ' + label);
}

const bag = (extra = '') => `window.__dshLevel.weaponBag()${extra}`;

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

/** 当前腰刀 + 背包三件：弓 / 撬棍 / 无 weapon_ref 的坏数据 */
async function seedSave() {
  return await evaluate(`
    (function () {
      var key = 'dsp_save_v1';
      var s = JSON.parse(localStorage.getItem(key) || 'null');
      if (!s) s = {};
      function it(uid, base_id, name, quality, value, ref) {
        var o = { uid: uid, base_id: base_id, slot: 'weapon', quality: quality, name: name,
                  stat: 'atk', value: value, enhance: 0, affixes: [] };
        if (ref) o.weapon_ref = ref;
        return o;
      }
      s.equipment = { weapon: it('w_cur','eq_wp_dao_white_01','\u8170\u5200','white',12,'wp_dao'),
                      head: null, body: null, legs: null, accessory: null };
      s.bag = { slots: 60, items: [
        it('w_bow','eq_wp_bow_blue_01','\u864e\u95e8\u730e\u5f13','blue',15,'wp_bow'),
        it('w_bar','eq_wp_dao_dock_blue_01','\u7801\u5934\u64ac\u68cd','blue',14,'wp_crowbar'),
        it('w_bad','eq_wp_unknown','\u65e0\u914d\u7f6e\u6b66\u5668','white',9)
      ] };
      s.weapons = ['wp_dao'];
      s.scrap = 500;
      localStorage.setItem(key, JSON.stringify(s));
      return 'ok';
    })()
  `);
}

async function clearAll(maxTries = 18) {
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
    assert((await seedSave()) === 'ok', 'save seeded');
    await openGame(false);

    // ---------- 进入战斗节点 ----------
    await gotoScene('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 });
    await clearAll();
    await waitFor(
      async () =>
        await evaluate(
          "(function(){var l=window.__dshGame.scene.getScene('Level'); return !!(l && l.player && l.mode === 'combat' && !l.nodeBusy && window.__dshLevel);})()",
        ),
      25000,
      'combat ready',
    );
    await waitFor(
      async () => await evaluate("window.__dshLevel.enemies().length > 0"),
      25000,
      'wave spawned',
    );
    report.initial = await evaluate(bag());
    assert(report.initial.weaponId === 'wp_dao', 'starts with equipped dao');
    assert(report.initial.open === false, 'panel closed on entry');
    assert(report.initial.equippedUid === 'w_cur', 'seeded equipped weapon in place');

    // ---------- 不可切换状态 ----------
    await evaluate("window.__dshLevel.setNodeBusy(true), 'ok'");
    const blocked = await evaluate(`
      (function () {
        window.__dshLevel.openWeaponBag();
        return window.__dshLevel.weaponBag().open;
      })()
    `);
    assert(blocked === false, 'busy combat state rejects open');
    await evaluate("window.__dshLevel.setNodeBusy(false), 'ok'");

    // ---------- 顶部「背包」按钮 ----------
    const beforeBtn = await evaluate(
      "window.__dshGame.scene.getScene('UI').bagButtonShown()",
    );
    assert(beforeBtn === true, 'bag button visible in combat');
    await evaluate("window.__dshGame.scene.getScene('UI').bagBtn.emit('pointerdown'), 'ok'");
    let st = await evaluate(bag());
    assert(st.open === true, 'bag button opens the panel');
    report.opened = st;
    assert(st.options.length === 4, 'current + 3 bag weapons listed');
    assert(st.options.filter((o) => o.available).length === 2, 'only configured weapons available');
    assert(st.options.some((o) => o.reason === 'weapon_ref_invalid'), 'broken weapon marked unavailable');
    assert(st.controlsVisible === false, 'controls hidden while panel open');
    assert(st.hudVisible === false, 'HUD hidden while panel open');
    assert(st.panelVisible === true, 'UI scene notified panel is open');
    assert(
      (await evaluate("window.__dshGame.scene.getScene('UI').bagButtonShown()")) === false,
      'bag button hidden while panel open',
    );
    const staleToast = await evaluate(
      "(function(){var t=document.querySelector('#dom-toast'); return !!(t && t.style.display !== 'none' && (t.textContent || '').length > 0);})()",
    );
    assert(staleToast === false, 'no stale toast over the panel');
    await shot('w1-bag-open.png');

    // ---------- 世界冻结 ----------
    const frozen0 = await evaluate(`
      (function () {
        var l = window.__dshGame.scene.getScene('Level');
        return { hp: l.player.hp, wave: l.waveIndex, first: window.__dshLevel.enemies()[0] || null };
      })()
    `);
    await sleep(420);
    const frozen1 = await evaluate(`
      (function () {
        var l = window.__dshGame.scene.getScene('Level');
        return { hp: l.player.hp, wave: l.waveIndex, first: window.__dshLevel.enemies()[0] || null };
      })()
    `);
    assert(frozen0.hp === frozen1.hp, 'player hp frozen during panel');
    assert(frozen0.wave === frozen1.wave, 'wave progression frozen during panel');
    assert(
      JSON.stringify(frozen0.first) === JSON.stringify(frozen1.first),
      'enemy does not move during panel',
    );

    // ---------- 取消选择：零改动 ----------
    await evaluate("window.__dshLevel.closeWeaponBag(), 'ok'");
    st = await evaluate(bag());
    assert(st.open === false, 'ESC / cancel closes panel');
    assert(st.equippedUid === 'w_cur', 'cancel does not change equipment');
    assert(st.bagUids.includes('w_bow'), 'cancel does not consume bag item');
    assert(st.weaponId === 'wp_dao', 'cancel does not change player weapon');
    assert(st.controlsVisible === true, 'controls restored after cancel');
    assert(st.hudVisible === true, 'HUD restored after cancel');
    assert(st.panelVisible === false, 'UI scene notified panel closed');
    assert(
      (await evaluate("window.__dshGame.scene.getScene('UI').bagButtonShown()")) === true,
      'bag button restored after cancel',
    );
    await shot('w2-after-cancel.png');

    // ---------- 重复操作 / 武器不可用 ----------
    await evaluate("window.__dshLevel.openWeaponBag(), 'ok'");
    await evaluate("window.__dshLevel.chooseWeapon('equipped:w_cur'), 'ok'");
    st = await evaluate(bag());
    report.repeat = st.message;
    assert(st.open === true, 'repeat selection keeps panel open');
    assert(st.message.includes('\u5df2\u7ecf\u662f\u5f53\u524d\u6b66\u5668'), 'repeat selection explains itself');
    assert(st.equippedUid === 'w_cur', 'repeat selection changes nothing');

    await evaluate("window.__dshLevel.chooseWeapon('bag:w_bad'), 'ok'");
    st = await evaluate(bag());
    report.unavailable = st.message;
    assert(st.open === true, 'unavailable weapon keeps panel open');
    assert(st.message.includes('\u6b66\u5668\u914d\u7f6e'), 'unavailable weapon explains itself');
    assert(st.equippedUid === 'w_cur', 'unavailable weapon changes nothing');

    await evaluate("window.__dshLevel.chooseWeapon('bag:not-there'), 'ok'");
    st = await evaluate(bag());
    assert(st.message.includes('\u4e0d\u5728\u80cc\u5305\u91cc'), 'stale option rejected');
    await shot('w3-reject-messages.png');

    // ---------- 成功切换：属性 / 攻击 / 背包 / HUD ----------
    // 切换与读状态必须在同一次 evaluate 里完成：跨两次 CDP 往返浏览器会跑帧，
    // 敌人可能打掉一点血，把「换装不掉血」的断言变成随机失败。
    const swap = await evaluate(`
      (function () {
        var before = window.__dshLevel.weaponBag();
        window.__dshLevel.chooseWeapon('bag:w_bow');
        return { before: before, after: window.__dshLevel.weaponBag() };
      })()
    `);
    const hpBefore = swap.before.hp;
    const atkBefore = swap.before.atk;
    st = swap.after;
    report.swapped = st;
    assert(st.open === false, 'successful swap closes panel');
    assert(st.weaponId === 'wp_bow', 'player.weapon switched immediately');
    assert(st.weaponRange === 200, 'ranged attack logic now uses bow range');
    assert(st.attacksPerSec === 1.67, 'attack interval now uses bow rate');
    assert(st.atk === atkBefore + 3, 'equipment stats re-aggregated (+3 ATK)');
    assert(st.hp === hpBefore && st.alive === true, 'hp / alive preserved by in-combat swap');
    assert(st.equippedUid === 'w_bow', 'equipment slot updated');
    assert(st.bagUids.includes('w_cur') && !st.bagUids.includes('w_bow'), 'old weapon returned to bag');
    assert(st.controlsVisible === true && st.hudVisible === true, 'controls / HUD restored after swap');

    const saved = await evaluate("JSON.parse(localStorage.getItem('dsp_save_v1'))");
    assert(saved.equipment.weapon.uid === 'w_bow', 'swap persisted to save');
    assert(saved.bag.items.some((i) => i.uid === 'w_cur'), 'old weapon persisted to bag');
    assert(saved.bag.items.some((i) => i.uid === 'w_bow') === false, 'new weapon removed from bag');

    const hudWeapon = await evaluate(
      "document.querySelector('#dom-hud-weapon') ? document.querySelector('#dom-hud-weapon').textContent : ''",
    );
    report.hudWeapon = hudWeapon;
    assert(hudWeapon.includes('\u730e\u5f13'), 'HUD weapon name updated');

    const fired = await evaluate(`
      (function () {
        var l = window.__dshGame.scene.getScene('Level');
        l.player.attackCd = 0;
        var before = l.projectiles.filter(function (p) { return p.fromPlayer; }).length;
        l.playerAttack();
        return { before: before, after: l.projectiles.filter(function (p) { return p.fromPlayer; }).length };
      })()
    `);
    report.projectiles = fired;
    assert(fired.after > fired.before, 'next attack uses new ranged weapon');
    await shot('w4-after-swap.png');

    // ---------- 键盘 B / ESC ----------
    await evaluate("window.__dshGame.scene.getScene('Level').input.keyboard.emit('keydown-B'), 'ok'");
    assert((await evaluate(bag('.open'))) === true, 'keyboard B opens panel');
    await evaluate("window.__dshGame.scene.getScene('Level').input.keyboard.emit('keydown-ESC'), 'ok'");
    assert((await evaluate(bag('.open'))) === false, 'keyboard ESC cancels');

    // ---------- 战斗结束：面板自动收起 ----------
    await evaluate("window.__dshLevel.openWeaponBag(), 'ok'");
    assert((await evaluate(bag('.open'))) === true, 'panel reopened before combat end');
    await evaluate("window.__dshLevel.setNodeBusy(true), 'ok'");
    await evaluate(
      'new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(1); }); }); })',
    );
    st = await evaluate(bag());
    report.afterCombatEnd = { open: st.open, panelVisible: st.panelVisible, hudVisible: st.hudVisible };
    assert(st.open === false, 'combat end auto-closes the panel');
    assert(st.panelVisible === false, 'combat end restores UI scene state');
    assert(st.hudVisible === true, 'combat end restores HUD');
    await evaluate("window.__dshLevel.setNodeBusy(false), 'ok'");
    await shot('w5-after-combat-end.png');
  } finally {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    report.errors = errors.slice(0, 12);
    report.ok = errors.length === 0;
    await writeFile(join(outDir, 'weapon-swap.json'), JSON.stringify(report, null, 2), 'utf-8');
    console.log(JSON.stringify(report, null, 2));
    setTimeout(() => process.exit(report.ok ? 0 : 1), 250);
  }
}

main().catch(async (e) => {
  console.error('FATAL', e && e.message);
  try {
    await writeFile(join(outDir, 'weapon-swap.json'), JSON.stringify({ fatal: String(e && e.message), errors }, null, 2), 'utf-8');
  } catch {
    /* ignore */
  }
  process.exit(1);
});
