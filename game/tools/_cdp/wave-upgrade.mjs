// 波次强化专项探针（v1.7）：弓 + 全部近战武器，每清一波弹三选一，
// 卡片按当前武器类别显示，强化状态按武器实例隔离。
//
// 为什么要探针而不是只看单测：单测钉住纯逻辑（行数/倍率/上限算得对），
// 但「卡片有没有真的出现在屏幕中间」「点下去有没有关掉」「换武器后状态有没有串」
// 「刀光有没有跟着扇形一起变宽」只有真浏览器能验。历史坑：卡片开着时
// `pendingCardTap` 不同步会让摇杆一直收着，玩家表现为「选完就动不了了」。
//
// 用法：
//   node tools/_cdp/wave-upgrade.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
// 第二个参数传本地目录（默认 dist）时脚本自带静态服务，不依赖任何常驻预览进程；
// 传 http(s):// 则直接访问该地址。
// 输出 <outDir>/wave-upgrade.json + u1..u5 截图。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const CDP_PORT = 9402;
const HTTP_PORT = 9403;
const profile = join(outDir, '_profile-wave-upgrade');

if (!edgePath) {
  console.error('usage: node tools/_cdp/wave-upgrade.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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

const report = { url: baseUrl, checks: {}, before: null, afterChoice: null, errors: [] };

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
  // `spawnWave` 是「每 260ms 放一个」的定时器，必须等 wavePending === false 再清场，
  // 否则清空的瞬间下一批又刷出来，alive 永远不等于 0，卡片永远不弹。
  await waitFor(
    () => evaluate('window.__dshGame.scene.getScene("Level").wavePending === false'),
    20000,
    'wave settled',
  );
  await sleep(300);

  // 强制拿腰刀：干净存档本来就给刀，这里钉死起点，避免存档差异把近战断言变成弓断言。
  await evaluate(`(() => {
    const L = window.__dshGame.scene.getScene('Level');
    if (L.player.weapon.id !== 'wp_dao') L.player.setWeapon(L.cfg.weapons.wp_dao, 0xcccccc);
    return L.player.weapon.id;
  })()`);
  report.before = await evaluate('window.__dshLevel.upgrades()');
  report.checks.startsWithSingleRow = report.before?.rows === 1;
  report.checks.startsWithNoSummary = report.before?.summary === '';
  report.checks.startsWithMeleeClass = report.before?.weaponClass === 'melee';
  report.checks.startsWithBaseArc = report.before?.arcMult === 1;
  report.checks.startsWithBaseCleave = report.before?.cleaveMult === 1;

  // 清掉这一波 → 下一波判定里应该弹**近战**强化卡
  await evaluate('window.__dshLevel.clearWave()');
  const cardShown = await waitFor(
    async () => (await evaluate('window.__dshLevel.upgrades().cardOpen')) === true,
    15000,
    'upgrade card',
  ).catch(() => false);
  report.checks.cardAppearsAfterWaveCleared = cardShown === true;
  if (!cardShown) throw new Error('强化卡没有弹出');
  await sleep(400);
  await shot('u1-melee-upgrade-card.png');

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
  const allText = cardTexts.join('|');
  report.checks.cardShowsMeleeTitle = cardTexts.some((t) => String(t).includes('近 战 精 进'));
  // v1.8：近战卡池扩到 9 张，每波随机抽 3 张；只断言「恰好 3 张且都来自近战池」
  const meleeCardNames = [
    '横 扫', '火 线', '破 甲', '刃锋延展', '背袭之刃', '回旋斩', '剑气纵横', '震荡强击', '嗜血战意',
  ];
  report.checks.cardShowsThreeChoices =
    cardTexts.filter((t) => meleeCardNames.includes(String(t))).length === 3;
  report.checks.cardShowsLegacyTag =
    cardTexts.some((t) => /唯一 · 不可再选|可强化 ×\d/.test(String(t)));
  report.checks.cardShowsCurrentWeapon = allText.includes('当前近战武器');
  report.checks.cardWorldFrozen = (await evaluate('window.__dshGame.scene.getScene("Level").introOpen')) === true;
  report.checks.controlsHiddenDuringCard = await evaluate(
    `document.querySelector('#controls, .controls, #dpad') ? getComputedStyle(document.querySelector('#controls, .controls, #dpad')).display !== 'none' : true`,
  );

  // v1.8.6 两步流程：确认前「点选」只记录，连点 / 切换都不许生效、结算或关界面。
  // 这里走调试钩子快速点击（真实鼠标连点由 tools/_cdp/upgrade-confirm.mjs 专项覆盖）。
  await evaluate(`(() => {
    const H = window.__dshLevel;
    H.selectUpgrade(0); H.selectUpgrade(1); H.selectUpgrade(0);
    return true;
  })()`);
  await sleep(200);
  const preConfirm = await evaluate('window.__dshLevel.upgradeSelection()');
  report.checks.clicksBeforeConfirmNeverCommit =
    preConfirm?.cardOpen === true && preConfirm?.picked === 0 && preConfirm?.selected !== null;
  // 取消后按确认必须无效（不能替玩家随便定一项）
  await evaluate('window.__dshLevel.cancelUpgrade()');
  report.checks.confirmWithoutSelectionNoop =
    (await evaluate('window.__dshLevel.confirmUpgrade()')) === false;
  const afterNoop = await evaluate('window.__dshLevel.upgradeSelection()');
  report.checks.confirmWithoutSelectionKeepsCard =
    afterNoop?.cardOpen === true && afterNoop?.picked === 0;

  // 连点三次：finish() 的 closed 闸门必须只让第一次生效（重复触发场景）
  await evaluate(`(() => {
    const H = window.__dshLevel;
    H.pickUpgrade(0); H.pickUpgrade(0); H.pickUpgrade(0);
    return true;
  })()`);
  await sleep(500);
  report.afterChoice = await evaluate('window.__dshLevel.upgrades()');
  report.checks.cardClosesAfterPick = report.afterChoice?.cardOpen === false;
  report.checks.upgradeApplied = (report.afterChoice?.picked ?? 0) === 1;
  report.checks.repeatPickIgnored = (report.afterChoice?.picked ?? 0) === 1;
  report.checks.summaryNonEmpty = (report.afterChoice?.summary ?? '').length > 0;
  report.checks.worldResumed = (await evaluate('window.__dshGame.scene.getScene("Level").introOpen')) === false;
  await shot('u2-melee-after-pick.png');

  // 近战满级：横扫 ×1.50 / 破甲 ×1.25 / 火线 ×1.24，且刀光真的跟着变宽。
  // 用 spy 抓 slashAt 的第 6 个参数 spreadDeg：0 级 82°，满级 82×1.5=123°。
  await evaluate('window.__dshLevel.setUpgrades({volley: 2, haste: 3, pierce: 1, picked: 6})');
  report.meleeMax = await evaluate('window.__dshLevel.weaponInfo()');
  report.checks.meleeMaxArc = Math.abs((report.meleeMax?.arcMult ?? 0) - 1.5) < 1e-6;
  report.checks.meleeMaxCleave = Math.abs((report.meleeMax?.cleaveMult ?? 0) - 1.25) < 1e-6;
  report.checks.meleeHaste =
    Math.abs((report.meleeMax?.actualMs ?? 0) - (report.meleeMax?.baseMs ?? 0) / 1.24) < 1.5;
  const slashSpy = `() => {
    const L = window.__dshGame.scene.getScene('Level');
    const orig = L.slashAt;
    let captured = null;
    L.slashAt = function (x, y, ang, reach, color, spread) {
      captured = { reach: reach, spread: spread };
      return orig.call(this, x, y, ang, reach, color, spread);
    };
    L.player.attackCd = 0;
    try { L.playerAttack(1); } finally { L.slashAt = orig; }
    return captured;
  }`;
  report.slashMax = await evaluate(`(${slashSpy})()`);
  await evaluate('window.__dshLevel.setUpgrades({volley: 0, haste: 0, pierce: 0, picked: 0})');
  report.slashBase = await evaluate(`(${slashSpy})()`);
  report.checks.meleeSlashWidens =
    Math.abs((report.slashMax?.spread ?? 0) - 123) < 0.01 &&
    Math.abs((report.slashBase?.spread ?? 0) - 82) < 0.01;
  await sleep(120);
  await shot('u3-melee-wide-sweep.png');

  // 状态隔离：腰刀满级 → 撬棍（第二种近战）全新 → 弓全新 → 换回腰刀仍在。
  await evaluate('window.__dshLevel.setUpgrades({volley: 2, haste: 3, pierce: 1, picked: 6})');
  const setWeapon = `(id) => {
    const L = window.__dshGame.scene.getScene('Level');
    L.player.setWeapon(L.cfg.weapons[id], 0xcccccc);
    return window.__dshLevel.upgrades();
  }`;
  report.crowbarFresh = await evaluate(`(${setWeapon})('wp_crowbar')`);
  report.checks.secondMeleeWeaponFresh =
    report.crowbarFresh?.weaponClass === 'melee' &&
    (report.crowbarFresh?.picked ?? -1) === 0 &&
    report.crowbarFresh?.arcMult === 1;
  await evaluate('window.__dshLevel.setUpgrades({volley: 1, picked: 1})');
  report.crowbarUp = await evaluate('window.__dshLevel.upgrades()');
  report.checks.crowbarUpgradeIndependent = Math.abs((report.crowbarUp?.arcMult ?? 0) - 1.25) < 1e-6;

  report.bowFresh = await evaluate(`(${setWeapon})('wp_bow')`);
  report.checks.bowStateFresh =
    report.bowFresh?.weaponClass === 'bow' && (report.bowFresh?.picked ?? -1) === 0;
  report.bowInfo = await evaluate('window.__dshLevel.bowInfo()');
  report.checks.bowIsSingleShotBase = report.bowInfo?.id === 'wp_bow' && report.bowInfo?.arrows === 1;

  // 弓的实时参数：火线 / 齐射有没有真的进到武器与射速里
  await evaluate('window.__dshLevel.setUpgrades({volley: 2, haste: 3, pierce: 1, picked: 6})');
  report.shot3 = await evaluate(`(() => {
    const L = window.__dshGame.scene.getScene('Level');
    L.player.attackCd = 0;
    L.projectiles.length = 0;
    L.playerAttack(1);
    return { arrows: L.projectiles.length };
  })()`);
  report.checks.threeRowsFireThreeArrows = report.shot3?.arrows === 3;
  report.bowMax = await evaluate('window.__dshLevel.bowInfo()');
  report.checks.hasteSpeedsUpBow =
    Math.abs((report.bowMax?.actualMs ?? 0) - (report.bowMax?.baseMs ?? 0) / 1.24) < 1.5;
  await sleep(120);
  await shot('u4-bow-three-row-volley.png');

  await evaluate('window.__dshLevel.setUpgrades({volley: 0, haste: 0, pierce: 0, picked: 0})');
  const single = await evaluate(`(() => {
    const L = window.__dshGame.scene.getScene('Level');
    L.player.attackCd = 0;
    L.projectiles.length = 0;
    L.playerAttack(1);
    return { arrows: L.projectiles.length };
  })()`);
  report.checks.zeroLevelFiresOneArrow = single?.arrows === 1;

  // 其它远程不参与强化：机枪的攻速保持 config.json 原值
  report.mg = await evaluate(`(${setWeapon})('wp_mg')`);
  report.mgInfo = await evaluate('window.__dshLevel.weaponInfo()');
  report.checks.otherRangedUnaffected =
    report.mgInfo?.weaponClass === 'other' &&
    Math.abs((report.mgInfo?.actualMs ?? 0) - (report.mgInfo?.baseMs ?? 1)) < 1e-6;

  // 换回腰刀：本关累积的强化还在（同一实例 key 稳定）
  report.daoBack = await evaluate(`(${setWeapon})('wp_dao')`);
  report.checks.backToDaoKeepsState =
    (report.daoBack?.picked ?? -1) === 6 && Math.abs((report.daoBack?.arcMult ?? 0) - 1.5) < 1e-6;
  report.states = await evaluate('window.__dshLevel.upgradeStates()');
  report.checks.statesAreSeparateKeys = Object.keys(report.states ?? {}).length >= 3;

  // 强化不跨关：重进关卡后**所有实例**一起清零
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
  report.statesAfterRestart = await evaluate('window.__dshLevel.upgradeStates()').catch(() => null);
  report.checks.upgradesResetOnRestart = (report.afterRestart?.picked ?? -1) === 0;
  report.checks.allStatesClearedOnRestart = Object.keys(report.statesAfterRestart ?? { none: 1 }).length === 0;
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
  if (server) {
    try {
      server.close();
    } catch {
      /* ignore */
    }
  }
  process.exit(report.verdict.ok ? 0 : 1);
}
