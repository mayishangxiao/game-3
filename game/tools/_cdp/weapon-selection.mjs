// v1.8 专项探针：① 开局选刀，进关 / 剧情掉弓 / 捡起弓 / 解锁更多武器 / 重进关卡
// 全程都还是刀；② 老游戏迁移过来的近战攻击向强化在真浏览器里真的生效。
//
// 为什么必须跑真浏览器：`tests/weaponSelection.test.ts` 只能证明解析器算得对，
// 证明不了「LevelScene 的进关、掉弓、捡拾、scene.restart 四条路径真的都改干净了」。
// 旧 bug 恰恰在场景层：`dropBow()` 的 200ms 自动装备轮询 + `bestWeapon()` 的弓优先。
//
// 用法：
//   node tools/_cdp/weapon-selection.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
// 传本地目录（默认 dist）时自带静态服务；产物 weapon-selection.json + 3 张实拍。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const CDP_PORT = 9432;
const HTTP_PORT = 9431;
const profile = join(outDir, '_profile-weapon-selection');

if (!edgePath) {
  console.error('usage: node tools/_cdp/weapon-selection.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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

const report = { url: baseUrl, checks: {}, errors: [] };
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
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, name), Buffer.from(r.data, 'base64'));
  };
  const L = 'window.__dshGame.scene.getScene("Level")';
  const sel = () => evaluate('window.__dshLevel.selectedWeapon()');
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
  await skipIntro();
  await waitFor(() => evaluate('window.__dshLevel.allEnemies().length > 0'), 20000, 'first wave');
  await waitFor(() => evaluate(`${L}.wavePending === false`), 20000, 'wave settled');
  await sleep(300);

  // ① 开局：解析器 / 手上 / 存档三处都是刀
  report.start = await sel();
  report.checks.startsWithDao =
    report.start?.resolved === 'wp_dao' &&
    report.start?.inHand === 'wp_dao' &&
    report.start?.saved === 'wp_dao';
  report.checks.startNotBow = report.start?.inHand !== 'wp_bow';
  await shot('w1-start-dao.png');

  // ② 清掉第一波：剧情掉弓 + 弹强化卡。旧版在这里会静默把刀换成弓。
  await evaluate('window.__dshLevel.clearWave()');
  const card = await waitFor(
    async () => (await evaluate('window.__dshLevel.upgrades().cardOpen')) === true,
    15000,
    'upgrade card',
  ).catch(() => false);
  report.checks.cardAppears = card === true;
  if (!card) throw new Error('清波后没弹强化卡');
  await sleep(300);
  report.cardTexts = await evaluate(`(() => {
    const L = ${L};
    const texts = [];
    L.children.list.forEach((o) => {
      if (o.type === 'Container' && o.depth >= 90 && o.list) {
        o.list.forEach((c) => { if (c.type === 'Text') texts.push(c.text); });
      }
    });
    return texts;
  })()`);
  const names = ['横 扫', '火 线', '破 甲', '刃锋延展', '背袭之刃', '回旋斩', '剑气纵横', '震荡强击', '嗜血战意'];
  report.checks.cardShowsThreeMeleeCards =
    (report.cardTexts ?? []).filter((t) => names.includes(String(t))).length === 3;
  report.checks.cardHasColorTag = (report.cardTexts ?? []).some((t) =>
    /唯一 · 不可再选|可强化 ×\d/.test(String(t)),
  );
  // 中文无空格，Phaser 默认按「词」换行会让长说明整行冲出卡片。
  // 三张卡中心固定是 96 / 240 / 384（逻辑像素），逐一量 Text 的实际宽度。
  report.cardGeometry = await evaluate(`(() => {
    const L = ${L};
    const out = [];
    L.children.list.forEach((o) => {
      if (o.type === 'Container' && o.depth >= 90 && o.list) {
        o.list.forEach((c) => {
          if (c.type === 'Text') {
            out.push({
              text: c.text,
              x: c.x,
              y: c.y,
              width: c.width,
              wrapWidth: c.style?.wordWrapWidth ?? 0,
              advanced: !!c.style?.wordWrapUseAdvanced,
            });
          }
        });
      }
    });
    return out;
  })()`);
  // 卡片区：y 在 105~190 逻辑像素内的就是三张卡上的文字（标题/副标题在 y < 80）
  const cardTextsGeo = (report.cardGeometry ?? []).filter((t) => t.y >= 100 && t.y <= 190);
  report.checks.cardTextsStayInsideCards =
    cardTextsGeo.length >= 12 &&
    cardTextsGeo.every((t) => t.width <= 132 && (t.wrapWidth === 0 || t.advanced === true));
  report.cardXs = [...new Set(cardTextsGeo.map((t) => t.x))].sort((a, b) => a - b);
  await shot('w2-melee-nine-card-pool.png');

  // 关掉卡片（选第一项），再看掉弓之后手上是什么
  await evaluate('window.__dshLevel.pickUpgrade(0); 1');
  await sleep(500);
  report.afterDrop = await sel();
  report.bowOnFloor = await evaluate(`(() => {
    const L = ${L};
    return {
      floor: L.floorItems.filter((f) => f.item.base_id === 'eq_wp_bow_white_01').length,
      unlocked: (L.save.weapons || []).includes('wp_bow'),
    };
  })()`);
  report.checks.bowDropUnlocksOnly = report.bowOnFloor?.unlocked === true;
  report.checks.bowDropIsFloorItem = (report.bowOnFloor?.floor ?? 0) >= 1;
  report.checks.stillDaoAfterBowDrop =
    report.afterDrop?.inHand === 'wp_dao' && report.afterDrop?.saved === 'wp_dao';
  report.checks.noAutoEquipToast = !(await evaluate(
    `(() => { const t = document.querySelector('#dom-toast'); return t ? t.textContent : ''; })()`,
  ))?.includes('装备猎弓');

  // ③ 玩家走过去把弓捡起来：只进背包，不换武器
  await evaluate(`(() => {
    const L = ${L};
    const f = L.floorItems.find((x) => x.item.base_id === 'eq_wp_bow_white_01');
    if (!f) return false;
    L.player.rig.setPosition(f.obj.x, f.obj.y);
    return true;
  })()`);
  await sleep(700);
  report.afterPickup = await sel();
  report.bag = await evaluate(`(() => {
    const L = ${L};
    return {
      bowInBag: L.save.bag.items.some((i) => i.base_id === 'eq_wp_bow_white_01'),
      floorBow: L.floorItems.filter((f) => f.item.base_id === 'eq_wp_bow_white_01').length,
    };
  })()`);
  report.checks.pickupGoesToBag = report.bag?.bowInBag === true;
  report.checks.stillDaoAfterPickup =
    report.afterPickup?.inHand === 'wp_dao' && report.afterPickup?.saved === 'wp_dao';

  // ④ 再解锁两把远程：解锁列表变长，选择仍不动
  await evaluate(`(() => {
    const L = ${L};
    L.save.weapons.push('wp_matchlock', 'wp_mg');
    return L.save.weapons.length;
  })()`);
  report.afterUnlockMore = await sel();
  report.checks.unlockListDoesNotSelect =
    report.afterUnlockMore?.resolved === 'wp_dao' &&
    report.afterUnlockMore?.inHand === 'wp_dao' &&
    report.afterUnlockMore?.unlocked.length >= 3;

  // ⑤ 重进关卡：旧版因为存档里已有 wp_bow，一进关就是弓
  await evaluate(`${L}.scene.restart(); 1`);
  await sleep(2600);
  await waitFor(() => evaluate('!!window.__dshLevel'), 30000, 'level hook after restart');
  await skipIntro();
  report.afterRestart = await sel();
  report.checks.stillDaoAfterRestart =
    report.afterRestart?.resolved === 'wp_dao' &&
    report.afterRestart?.inHand === 'wp_dao' &&
    report.afterRestart?.saved === 'wp_dao';

  // ⑥ 老游戏攻击向进化：把状态直接灌进当前近战实例，看实时参数与剑气
  await evaluate(`(() => {
    const L = ${L};
    L.player.setWeapon(L.cfg.weapons.wp_dao, 0xcccccc);
    return true;
  })()`);
  await evaluate(`window.__dshLevel.setUpgrades({
    volley: 2, haste: 3, pierce: 1, reach: 2, behind: 1, spin: 1,
    wave: 1, knock: 1, leech: 1, picked: 6
  })`);
  report.evo = await evaluate('window.__dshLevel.weaponInfo()');
  report.checks.evoReach = Math.abs((report.evo?.reachMult ?? 0) - 1.3) < 1e-6;
  report.checks.evoFlags =
    report.evo?.rear === true && report.evo?.spin === true && report.evo?.wave === true;
  report.checks.evoKnockLeech =
    (report.evo?.knock ?? 0) > 0 && (report.evo?.stunMs ?? 0) > 0 && (report.evo?.leech ?? 0) > 0;
  report.checks.evoSummaryIncludesLegacy = /剑气|背袭|回旋|嗜血/.test(report.evo?.summary ?? '');

  const fire = `(swing) => {
    const L = ${L};
    L.player.attackCd = 0;
    L.projectiles.length = 0;
    L.meleeSwingCount = swing;
    L.playerAttack(1);
    return {
      waves: L.projectiles.length,
      allHaveOverride: L.projectiles.every((p) => (p.dmgOverride ?? 0) > 0),
      reach: L.projectiles.length,
    };
  }`;
  // 第 3 刀 → 回旋斩 + 剑气 = 八方剑气环
  report.waveSpin = await evaluate(`(${fire})(2)`);
  report.checks.spinFiresEightWaves = report.waveSpin?.waves === 8;
  report.checks.wavesCarryFixedDamage = report.waveSpin?.allHaveOverride === true;
  await shot('w3-melee-evolution-combo.png');

  // 背袭 + 横扫满档 → 近似全向 → 四向剑气扇
  report.waveOmni = await evaluate(`(${fire})(0)`);
  report.checks.omniFiresFourWaves = report.waveOmni?.waves === 4;

  // 去掉背袭 → 只剩正前方一道
  await evaluate('window.__dshLevel.setUpgrades({behind: 0})');
  report.waveSingle = await evaluate(`(${fire})(0)`);
  report.checks.singleSwordWave = report.waveSingle?.waves === 1;

  // ⑦ 弓的三张卡不受迁移影响
  await evaluate(`(() => {
    const L = ${L};
    L.player.setWeapon(L.cfg.weapons.wp_bow, 0x8b5a2b);
    return true;
  })()`);
  report.bowInfo = await evaluate('window.__dshLevel.weaponInfo()');
  report.checks.bowUnaffected =
    report.bowInfo?.weaponClass === 'bow' && report.bowInfo?.arrows === 1;
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
  await writeFile(join(outDir, 'weapon-selection.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report.verdict, null, 2));
  if (report.fatal) console.log('fatal:', report.fatal);
  if (report.errors.length) console.log('errors:', report.errors.slice(0, 5));
  try { ws?.close(); } catch { /* ignore */ }
  try { edge.kill(); } catch { /* ignore */ }
  if (server) { try { server.close(); } catch { /* ignore */ } }
  process.exit(report.verdict.ok ? 0 : 1);
}
