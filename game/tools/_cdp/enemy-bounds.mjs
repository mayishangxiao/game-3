// 「小兵被打出地图」专项探针。
//
// 甲方三次用手机截图报这个 bug：英军站在地图右侧的蓝色海面上，玩家够不到、也打不到。
// 根因是 `CharacterRig.knockback()` 用 tween 直接平移、不查地形，敌人被击退时就飞出边界。
//
// 本探针不等运气：进第一幕战斗后，把**每个敌人依次推到地图外、原始海面、墙里**，
// 跑一次每帧兜底（`__dshLevel.rescue()`），断言它落在可站的地面上。
//
// 用法：
//   node tools/_cdp/enemy-bounds.mjs "<edgePath>" "<baseUrl>" <outDir>
// 输出 <outDir>/enemy-bounds.json + b1..b3 截图。
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const edgePath = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4173';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const PORT = 9399;
const profile = join(outDir, '_profile-bounds');

if (!edgePath) {
  console.error('usage: node tools/_cdp/enemy-bounds.mjs "<edgePath>" [baseUrl] [outDir]');
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

const cleanup = async () => {
  try {
    edge.kill();
  } catch {
    /* ignore */
  }
};

const report = { url: baseUrl, checks: {}, samples: [], errors: [] };

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
    'devtools endpoint',
  );

  const ws = new WebSocket(list);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 960,
    height: 540,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await send('Page.navigate', { url: baseUrl });
  await sleep(500);

  // 引导层：点「开始」进游戏
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate handler ready');
  await evaluate(`(() => {
    const g = document.getElementById('tap-gate');
    const b = g && g.querySelector('.tg-go');
    if (b) b.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
    return true;
  })()`);

  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(600);

  // 直接进第一幕（跳过对话）
  await evaluate(`(() => {
    const g = window.__dshGame;
    g.scene.getScene('Title').scene.start('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 });
    return true;
  })()`);

  await waitFor(() => evaluate(`!!window.__dshLevel`), 40000, 'level hook');
  await sleep(2000);

  // 开场情境卡是「闸门」：不点掉它世界不推进、也不刷怪。
  for (let i = 0; i < 8 && (await evaluate(`!!window.__dshGame.scene.getScene('Level').introOpen`)); i++) {
    await evaluate(`(function(){var l=window.__dshGame.scene.getScene('Level'); if (l.pendingCardTap) l.pendingCardTap(); return 1;})()`);
    await sleep(400);
  }
  // 开场对白也要点完，否则波次不会开始刷怪。
  for (let i = 0; i < 30 && (await evaluate(`!!window.__dshGame.scene.getScene('Level').dialogue.isActive`)); i++) {
    await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance(); 1`);
    await sleep(160);
  }
  // 等第一波刷出来（headless 下 rAF 慢，给足余量）
  for (let i = 0; i < 40; i++) {
    const n = await evaluate(`window.__dshLevel.allEnemies().length`);
    if (n > 0) break;
    await sleep(250);
  }
  await shot('b1-level-start.png');

  const info = await evaluate(`(() => {
    const L = window.__dshLevel;
    return { map: L.map(), enemies: L.enemies(), all: L.allEnemies() };
  })()`);
  report.map = info.map;
  report.enemiesAtStart = info.enemies.length;
  report.allAtStart = info.all;
  console.log('DEBUG allAtStart=', JSON.stringify(info.all));

  // 没有敌人就先等一波刷新
  if (info.enemies.length === 0) {
    await sleep(3000);
  }

  // 关键实验：把每个敌人依次推到三种「越界位置」，看他会不会被捞回来。
  const result = await evaluate(`(() => {
    const L = window.__dshLevel;
    const m = L.map();
    const out = [];
    const alive = () => L.enemies();
    const cases = [
      { name: 'out-right',  at: () => ({ x: m.w + 40, y: m.h / 2 }) },
      { name: 'out-bottom', at: () => ({ x: m.w / 2, y: m.h + 40 }) },
      { name: 'out-negative', at: () => ({ x: -30, y: -30 }) },
      { name: 'sea-col',    at: () => {
          // 找一列原始海面（数据里就是海、不在碰撞格里）
          for (let x = m.w - 8; x > 0; x -= 8) {
            for (let y = 8; y < m.h; y += 8) {
              if (L.unsafe(x, y)) return { x, y };
            }
          }
          return null;
        } },
    ];
    for (const c of cases) {
      const before = alive();
      if (before.length === 0) { out.push({ case: c.name, skipped: 'no enemies' }); continue; }
      const spot = c.at();
      if (!spot) { out.push({ case: c.name, skipped: 'no unsafe spot found' }); continue; }
      for (let i = 0; i < before.length; i++) {
        L.teleport(i, spot.x, spot.y);
      }
      const pushed = alive().map((e) => ({ i: e.i, x: Math.round(e.x), y: Math.round(e.y), unsafe: L.unsafe(e.x, e.y) }));
      const rescueReturned = L.rescue();
      const after = alive().map((e) => ({ i: e.i, x: Math.round(e.x), y: Math.round(e.y), unsafe: L.unsafe(e.x, e.y) }));
      out.push({ case: c.name, spot, pushed, rescueReturned, after });
    }
    return out;
  })()`);

  report.samples = result;

  for (const s of result) {
    if (s.skipped) continue;
    report.checks[`pushedOff_${s.case}`] = s.pushed.every((p) => p.unsafe === true);
    report.checks[`rescuedOnMap_${s.case}`] = s.after.every(
      (a) => a.unsafe === false && a.x >= -8 && a.y >= -8 && a.x <= (report.map?.w ?? 0) + 8 && a.y <= (report.map?.h ?? 0) + 8,
    );
  }

  // 再让真实 update 帧跑一会儿，确认没人自己走回水里
  await sleep(1500);
  const steady = await evaluate(`(() => {
    const L = window.__dshLevel;
    return L.enemies().map((e) => ({ x: Math.round(e.x), y: Math.round(e.y), unsafe: L.unsafe(e.x, e.y) }));
  })()`);
  report.steady = steady;
  report.checks.allEnemiesOnLandAfterFrames = steady.length === 0 || steady.every((e) => e.unsafe === false);

  await shot('b2-after-rescue.png');

  report.allOk = Object.values(report.checks).every(Boolean);
  await writeFile(join(outDir, 'enemy-bounds.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ allOk: report.allOk, checks: report.checks, map: report.map, enemiesAtStart: report.enemiesAtStart }, null, 2));
  ws.close();
} catch (e) {
  report.errors.push(String(e && e.stack ? e.stack : e));
  await writeFile(join(outDir, 'enemy-bounds.json'), JSON.stringify(report, null, 2)).catch(() => {});
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
}

await cleanup();
process.exit(0);