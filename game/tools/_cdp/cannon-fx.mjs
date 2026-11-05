// 炮火特效专项探针：确认甲方给的 GIF 拆出来的 48 帧真的在战斗里播、播得对、播完自己销毁。
//
// 为什么要探针而不是只看代码：特效是「一张 Image 每 45ms 换一次纹理」，
// 如果纹理 key 拼错、preload 漏了帧、或 `time.addEvent` 在 headless 下不推进，
// 表现只是「开炮后什么也没发生」——截图里极难判断是资源问题还是时序问题。
//
// 用法：
//   node tools/_cdp/cannon-fx.mjs "<edgePath>" "<baseUrl>" [outDir]
// 输出 <outDir>/cannon-fx.json + f1..f6 截图（开炮后 0 / 0.2 / 0.5 / 0.9 / 1.5 / 3.0 秒）。
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const edgePath = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4173';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const PORT = 9401;
const profile = join(outDir, '_profile-cannon-fx');

if (!edgePath) {
  console.error('usage: node tools/_cdp/cannon-fx.mjs "<edgePath>" [baseUrl] [outDir]');
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

const report = { url: baseUrl, checks: {}, frames: [], errors: [] };

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

  // 引导层 → 标题页 → 第一幕第二节点（虎门炮台战斗，配了 skills.humen_cannon）
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
  await waitFor(() => evaluate(`!!window.__dshLevel`), 40000, 'level hook');
  await sleep(2000);

  for (let i = 0; i < 8 && (await evaluate(`!!window.__dshGame.scene.getScene('Level').introOpen`)); i++) {
    await evaluate(`(function(){var l=window.__dshGame.scene.getScene('Level'); if (l.pendingCardTap) l.pendingCardTap(); return 1;})()`);
    await sleep(400);
  }
  for (let i = 0; i < 30 && (await evaluate(`!!window.__dshGame.scene.getScene('Level').dialogue.isActive`)); i++) {
    await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance(); 1`);
    await sleep(160);
  }
  for (let i = 0; i < 40; i++) {
    const n = await evaluate(`window.__dshLevel.allEnemies().length`);
    if (n > 0) break;
    await sleep(250);
  }

  // 纹理是否真的全部加载（48 帧，缺一帧特效就会在中间卡住）
  report.textures = await evaluate(`(() => {
    const t = window.__dshGame.textures;
    const keys = [];
    for (let i = 0; i < 48; i++) {
      const k = 'fx_cannon_blast_' + i;
      if (t.exists(k)) keys.push({ k, w: t.get(k).getSourceImage().width, h: t.get(k).getSourceImage().height });
    }
    return { loaded: keys.length, first: keys[0], last: keys[keys.length - 1] };
  })()`);
  report.checks.allFramesLoaded = report.textures.loaded === 48;
  report.checks.frameSize96 = report.textures.first?.w === 96 && report.textures.first?.h === 96;

  // 把玩家搬到第一个敌人旁边、清掉冷却，然后直接调用 fireCannon（等价于点「炮」键）。
  // 注意两件事：
  //  1. 射程判定读的是 `this.player.x/y`，画面位置在 `player.rig` 上 —— 两个都要挪；
  //  2. **地图尺寸要用 `__dshLevel.map()`**（MapRenderer 上叫 `pixelWidth/pixelHeight`，
  //     没有 `.w`）。第一次写成 `L.map.w` 得到 undefined → NaN → 序列化成 null，
  //     开炮因「敌人在射程外」直接返回，特效一个都没出现（白跑一轮）。
  const fired = await evaluate(`(() => {
    const L = window.__dshGame.scene.getScene('Level');
    const M = window.__dshLevel.map();
    const E = window.__dshLevel.enemies();
    if (!E.length) return { ok: false, why: 'no enemies' };
    const e = E[0];
    const px = Math.max(24, Math.min(M.w - 24, e.x - 44));
    const py = Math.max(24, Math.min(M.h - 24, e.y));
    L.player.x = px;
    L.player.y = py;
    if (L.player.rig) L.player.rig.setPosition(px, py);
    L.cannonCd = 0;
    L.fireCannon();
    return {
      ok: true,
      map: M,
      enemy: { x: Math.round(e.x), y: Math.round(e.y) },
      player: { x: Math.round(px), y: Math.round(py) },
      dist: Math.round(Math.hypot(e.x - px, e.y - py)),
      cdAfter: L.cannonCd,
    };
  })()`);
  report.checks.cannonFired = fired.ok === true && (fired.cdAfter ?? 0) > 0;
  report.checks.cannonEnteredCooldown = (fired.cdAfter ?? 0) > 0;
  report.firedAt = fired;

  // 逐拍观察：记录场上 fx 贴图的当前纹理帧号 + 截图
  const beats = [
    { t: 200, name: 'f1-early.png' },
    { t: 500, name: 'f2-flash.png' },
    { t: 900, name: 'f3-fireball.png' },
    { t: 1500, name: 'f4-smoke.png' },
    { t: 3000, name: 'f5-gone.png' },
  ];
  let elapsed = 0;
  for (const b of beats) {
    await sleep(b.t - elapsed);
    elapsed = b.t;
    const state = await evaluate(`(() => {
      const L = window.__dshGame.scene.getScene('Level');
      const fx = L.children.list.filter((o) => typeof o.texture?.key === 'string' && o.texture.key.startsWith('fx_cannon_blast_'));
      return fx.map((o) => ({ key: o.texture.key, x: Math.round(o.x), y: Math.round(o.y), scale: o.scaleX, depth: o.depth, alpha: o.alpha }));
    })()`);
    report.frames.push({ at: b.t, shot: b.name, fx: state });
    await shot(b.name);
  }

  const live = report.frames.filter((f) => f.fx.length > 0);
  report.checks.fxAppeared = live.length > 0;
  report.checks.fxAdvanced = (() => {
    const seen = new Set();
    for (const f of live) for (const o of f.fx) seen.add(o.key);
    return seen.size > 1;
  })();
  report.checks.fxDestroyedAfterEnd = report.frames[report.frames.length - 1].fx.length === 0;

  report.allOk = Object.values(report.checks).every(Boolean);
  await writeFile(join(outDir, 'cannon-fx.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ allOk: report.allOk, checks: report.checks, textures: report.textures, frames: report.frames.map((f) => ({ at: f.at, fx: f.fx.length, keys: f.fx.map((o) => o.key) })) }, null, 2));
  ws.close();
} catch (e) {
  report.errors.push(String(e && e.stack ? e.stack : e));
  await writeFile(join(outDir, 'cannon-fx.json'), JSON.stringify(report, null, 2)).catch(() => {});
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
}

await cleanup();
process.exit(0);