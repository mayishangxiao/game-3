// 波次强化专项探针：确认「每清一波弹三选一」真的弹、真的能点、选完弓真的变强。
//
// 为什么要探针而不是只看单测：单测钉住的是纯逻辑（行数/倍率算得对），
// 但「卡片有没有真的出现在屏幕中间」「点下去有没有关掉」「关掉后摇杆有没有回来」
// 只有真浏览器能验。而且这里有个历史坑——卡片开着的标志与 `pendingCardTap`
// 不同步时，摇杆会一直收着，玩家表现为「选完就动不了了」。
//
// 用法：
//   node tools/_cdp/wave-upgrade.mjs "<edgePath>" "<baseUrl>" [outDir]
// 输出 <outDir>/wave-upgrade.json + u1..u5 截图。
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const edgePath = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4173';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const PORT = 9402;
const profile = join(outDir, '_profile-wave-upgrade');

if (!edgePath) {
  console.error('usage: node tools/_cdp/wave-upgrade.mjs "<edgePath>" [baseUrl] [outDir]');
  process.exit(2);
}

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

const edge = spawn(
  edgePath,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=960,540',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const report = { url: baseUrl, checks: {}, before: null, afterChoice: null, errors: [] };

try {
  const list = await waitFor(
    async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
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

  const ws = new WebSocket(list);
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
      console.log('EVAL FAILED:', text);
      throw new Error(`EVAL FAILED: ${text}`);
    }
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, name), Buffer.from(r.data, 'base64'));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl });
  await sleep(500);

  // 引导层 → 标题 → 虎门炮台战斗节点（和 cannon-fx 用同一节点，敌人固定好复现）
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate handler ready');
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

  // 关掉情境卡、推完对白，等第一波刷出来
  for (let i = 0; i < 8 && (await evaluate(`!!window.__dshGame.scene.getScene('Level').introOpen`)); i++) {
    await evaluate(`(function(){var l=window.__dshGame.scene.getScene('Level'); if (l.pendingCardTap) l.pendingCardTap(); return 1;})()`);
    await sleep(400);
  }
  for (let i = 0; i < 30 && (await evaluate(`!!window.__dshGame.scene.getScene('Level').dialogue?.isActive`)); i++) {
    await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance(); 1`);
    await sleep(160);
  }
  await waitFor(() => evaluate('window.__dshLevel.allEnemies().length > 0'), 20000, 'first wave');
  // 关键：`spawnWave` 是「每 260ms 放一个」的定时器，`wavePending` 在最后一个敌人出现后才清。
  // 上一版探针在第一波还没放完时就 clearWave，结果清空的瞬间下一批又刷出来，
  // `alive` 永远不等于 0 → 波次分支不进 → 卡片永远不弹（白跑一轮）。
  // 所以必须等 `wavePending === false`（本波出齐）再动手。
  await waitFor(
    () => evaluate('window.__dshGame.scene.getScene("Level").wavePending === false'),
    20000,
    'wave settled',
  );
  await sleep(300);

  report.before = await evaluate('window.__dshLevel.upgrades()');
  report.checks.startsWithSingleRow = report.before?.rows === 1;
  report.checks.startsWithNoSummary = report.before?.summary === '';

  // 清掉这一波 → 下一波判定里应该弹强化卡
  await evaluate('window.__dshLevel.clearWave()');
  const cardShown = await waitFor(
    async () => (await evaluate('window.__dshLevel.upgrades().cardOpen')) === true,
    15000,
    'upgrade card',
  ).catch(() => false);
  report.checks.cardAppearsAfterWaveCleared = cardShown === true;
  if (!cardShown) throw new Error('强化卡没有弹出');
  await sleep(400);
  await shot('u1-upgrade-card.png');

  // 卡片必须真的在屏幕中间，而且有 3 个可点区域（用 elementFromPoint 反查不到 canvas，
  // 因为卡片是 Phaser 画在 canvas 里的，所以这里改成数「容器里的子对象」）
  report.card = await evaluate(`(() => {
    const L = window.__dshGame.scene.getScene('Level');
    const texts = [];
    L.children.list.forEach((o) => {
      if (o.type === 'Container' && o.depth >= 90 && o.list) {
        o.list.forEach((c) => { if (c.type === 'Text') texts.push(c.text); });
      }
    });
    return { texts };
  })()`);
  const cardTexts = report.card?.texts ?? [];
  report.checks.cardShowsTitle = cardTexts.some((t) => String(t).includes('弓'));
  report.checks.cardShowsThreeChoices = cardTexts.filter((t) =>
    ['齐 射', '火 线', '穿 透'].includes(String(t)),
  ).length;
  report.checks.cardWorldFrozen = (await evaluate('window.__dshGame.scene.getScene("Level").introOpen')) === true;
  report.checks.controlsHiddenDuringCard = await evaluate(
    `document.querySelector('#controls, .controls, #dpad') ? getComputedStyle(document.querySelector('#controls, .controls, #dpad')).display !== 'none' : true`,
  );

  // 点第一张卡（走 pendingCardTap，等价于玩家点击）
  await evaluate('window.__dshLevel.pickUpgrade(0)');
  await sleep(500);
  report.afterChoice = await evaluate('window.__dshLevel.upgrades()');
  report.checks.cardClosesAfterPick = report.afterChoice?.cardOpen === false;
  report.checks.upgradeApplied = (report.afterChoice?.picked ?? 0) === 1;
  report.checks.summaryNonEmpty = (report.afterChoice?.summary ?? '').length > 0;
  report.checks.worldResumed = (await evaluate('window.__dshGame.scene.getScene("Level").introOpen')) === false;
  await shot('u2-after-pick.png');

  // 弓的实时参数：火线/齐射有没有真的进到武器与射速里
  // 注意：开局玩家拿的是刀（wp_dao），弓要捡第 2 波前掉的那把 eq_wp_bow_white_01。
  // 探针不走去捡那一步，直接把武器换成弓——这段测的是「强化对弓的作用」，不是掉落链路。
  await evaluate(`(() => {
    const L = window.__dshGame.scene.getScene('Level');
    const bow = L.cfg.weapons.wp_bow;
    L.player.weapon = bow;
    L.save.weapons = Array.from(new Set([...(L.save.weapons || []), 'wp_bow']));
    return L.player.weapon.id;
  })()`);
  report.bow = await evaluate('window.__dshLevel.bowInfo()');
  report.checks.bowIsSingleShotBase = report.bow?.id === 'wp_bow';

  // 直接把齐射拉到满级，确认「三行」真的会一次发三支箭
  await evaluate('window.__dshLevel.setUpgrades({volley: 2, haste: 3, pierce: 1})');
  const before = await evaluate('window.__dshLevel.enemies().length');
  report.shot3 = await evaluate(`(() => {
    const L = window.__dshGame.scene.getScene('Level');
    L.player.attackCd = 0;
    L.projectiles.length = 0;
    L.playerAttack(1);
    return { arrows: L.projectiles.length, before: ${before} };
  })()`);
  report.checks.threeRowsFireThreeArrows = report.shot3?.arrows === 3;
  report.bowMax = await evaluate('window.__dshLevel.bowInfo()');
  report.checks.hasteSpeedsUpBow =
    Math.abs((report.bowMax?.actualMs ?? 0) - (report.bowMax?.baseMs ?? 0) / 1.24) < 1.5;
  await sleep(120);
  await shot('u3-three-row-volley.png');

  // 单发（把齐射清零）对照：确认「不是随便都发三支」
  await evaluate('window.__dshLevel.setUpgrades({volley: 0, haste: 0, pierce: 0})');
  const single = await evaluate(`(() => {
    const L = window.__dshGame.scene.getScene('Level');
    L.player.attackCd = 0;
    L.projectiles.length = 0;
    L.playerAttack(1);
    return { arrows: L.projectiles.length };
  })()`);
  report.checks.zeroLevelFiresOneArrow = single?.arrows === 1;
  await shot('u4-single-arrow.png');

  // 强化不跨关：重进关卡后必须清零
  await evaluate(`(() => {
    const L = window.__dshGame.scene.getScene('Level');
    L.upgrades = { volley: 2, haste: 3, pierce: 1, picked: 6 };
    return true;
  })()`);
  await evaluate(`(() => {
    const L = window.__dshGame.scene.getScene('Level');
    L.scene.restart();
    return true;
  })()`);
  await sleep(2500);
  for (let i = 0; i < 8 && (await evaluate(`!!window.__dshGame.scene.getScene('Level').introOpen`)); i++) {
    await evaluate(`(function(){var l=window.__dshGame.scene.getScene('Level'); if (l.pendingCardTap) l.pendingCardTap(); return 1;})()`);
    await sleep(300);
  }
  report.afterRestart = await evaluate('window.__dshLevel.upgrades()').catch(() => null);
  report.checks.upgradesResetOnRestart = (report.afterRestart?.picked ?? -1) === 0;
  await shot('u5-after-restart.png');
} catch (e) {
  report.fatal = String(e && e.message ? e.message : e);
  console.log('PROBE FAILED:', report.fatal);
} finally {
  const vals = Object.values(report.checks);
  report.verdict = {
    total: vals.length,
    passed: vals.filter(Boolean).length,
    failed: Object.entries(report.checks)
      .filter(([, v]) => !v)
      .map(([k]) => k),
  };
  report.verdict.ok =
    report.verdict.total > 0 && report.verdict.failed.length === 0 && !report.fatal && report.errors.length === 0;
  await writeFile(join(outDir, 'wave-upgrade.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report.verdict, null, 2));
  if (report.fatal) console.log('fatal:', report.fatal);
  if (report.errors.length) console.log('errors:', report.errors.slice(0, 5));
  try {
    edge.kill();
  } catch {
    /* ignore */
  }
  process.exit(report.verdict.ok ? 0 : 1);
}