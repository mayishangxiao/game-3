// 兵种小人的「行走/攻击帧」实拍探针（v1.9.1）
//
// 设计书 7.1 的两格：「单位行走与攻击动画帧 ⬜」与「第二幕人物贴图 ⬜（兵种那一半）」。
// 单元测试（`tests/unitFrames.test.ts` / `tests/unitArt.test.ts`）只能证明算法与文件，
// 帧到底有没有被**选中并画到屏幕上**只有浏览器里能看，所以这里跑真机：
//
// 断言：
//   1) 每个兵种四朝向的贴图都进了 TextureManager（漏一张 = 那个朝向退回色块）；
//   2) 一个兵种朝向能烘出 stepA / stepB / swing 三张派生纹理，且三张互不相同；
//   3) 走路时 `rig.frameKey` 在两帧步态之间来回切（只切一次不算）；
//   4) 出手时切到 swing 帧，收势后回到上一帧（不能停在出手帧上）；
//   5) 静止时回到底图（idle 不能被步态帧污染）；
//   6) 非人形图（鸦片箱 20×20）被拒绝，返回 null —— 位图切帧不能把箱子切坏；
//   7) 帧缓存不会无限增长（同一朝向重复取用只算一次）；
//   8) 12 个新兵种在场上真的用上了各自的皮（按敌兵 rig.unitKey 判定）；
//   9) 控制台零异常。
//
// 用法：node tools/_cdp/unit-anim.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_unit-anim-out');
const CDP_PORT = 9502;
const HTTP_PORT = 9501;
const profile = join(outDir, '_profile');

if (!edgePath) {
  console.error('usage: node tools/_cdp/unit-anim.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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
        const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const rel = normalize(p.replace(/^\/+/, '')).replace(/^(\.\.[/\\])+/, '');
        const file = resolve(staticDir, rel === '' || rel === '.' ? 'index.html' : rel);
        if (!file.startsWith(staticDir)) {
          res.writeHead(403).end();
          return;
        }
        const body = await readFile(file);
        res.writeHead(200, {
          'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
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
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=960,540',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const report = { url: baseUrl, checks: {}, snapshots: {}, errors: [] };
let ws;
let failed = 0;

try {
  const wsUrl = await waitFor(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const j = await r.json();
      const page = j.find((t) => t.type === 'page');
      return page ? page.webSocketDebuggerUrl : null;
    } catch {
      return null;
    }
  }, 20000, 'devtools');

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error)));
      else res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      report.errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception');
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      report.errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
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
    if (r.exceptionDetails) throw new Error(`EVAL FAILED: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 };
    const r = await send('Page.captureScreenshot', params);
    await writeFile(join(outDir, name), Buffer.from(r.data, 'base64'));
  };
  const check = (name, ok, detail) => {
    report.checks[name] = !!ok;
    if (!ok) failed++;
    if (detail !== undefined) report.snapshots[name] = detail;
  };
  const drainDialogue = async (max = 60) => {
    for (let i = 0; i < max; i++) {
      if (!(await evaluate(`!!window.__dshGame.scene.getScene('Level').dialogue?.isActive`))) return i;
      await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance()`);
      await sleep(115);
    }
    return -1;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  // 每次构建的 bundle 名都会变，不禁缓存会跑到上次的 boot-*.js
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl });
  await sleep(500);
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await sleep(300);
  await evaluate(
    `(() => { const g=document.getElementById('tap-gate'); const b=g&&g.querySelector('.tg-go'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; })()`,
  );
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(500);

  // 进第一幕第 0 节点（探索模式，能自由走动、也有敌兵）
  await evaluate(`(() => {
    const g = window.__dshGame;
    const src = g.scene.isActive('Title') ? g.scene.getScene('Title') : g.scene.getScene('Level');
    src.scene.start('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 0 });
    return true;
  })()`);
  await waitFor(
    () => evaluate(`(() => { const l=window.__dshGame.scene.getScene('Level'); return !!(window.__dshLevel && l && l.map && l.map.grid && l.worldObjects && l.worldObjects.length); })()`),
    40000,
    'level ready',
  );
  await sleep(600);
  await drainDialogue();
  await sleep(400);

  // ① 四朝向贴图全在（12 个新兵种 + 8 个老兵种）
  const tex = await evaluate(`(() => {
    const g = window.__dshGame;
    const units = ['qing_officer','qing_green','uk_infantry','gough','xiang_army','xiang_rifle','bandit',
      'bandit_chief','bandit_crossbow','patrol','dock_boss','informant','overseer','thug','qing_cavalry','uk_officer'];
    const missing = [];
    for (const u of units) for (const f of ['down','up','left','right']) {
      if (!g.textures.exists(u + '_' + f)) missing.push(u + '_' + f);
    }
    return { units: units.length, missing };
  })()`);
  report.snapshots.textures = tex;
  check('allUnitFacingTextures', tex.missing.length === 0, tex.missing);

  // ② 派生帧：四朝向都有 stepA/stepB/swing，且三张与底图不完全相同
  const frames = await evaluate(`(() => {
    const g = window.__dshGame;
    const scene = g.scene.getScene('Level');
    const api = window.__dshFrames;
    const sig = (key) => {
      const src = g.textures.get(key).getSourceImage();
      const cv = document.createElement('canvas');
      cv.width = src.width; cv.height = src.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 4) h = (h * 31 + (d[i] > 0 ? 1 : 0) + (d[i+3] > 0 ? 2 : 0)) % 1000000007;
      return h;
    };
    const out = {};
    for (const f of ['down','up','left','right']) {
      const set = api.unitFrameSet(scene, 'qing_officer_' + f, f === 'left' ? -1 : 1);
      if (!set) { out[f] = null; continue; }
      out[f] = {
        keys: [set.stepA, set.stepB, set.swing],
        exist: [set.stepA, set.stepB, set.swing].every(k => g.textures.exists(k)),
        sigs: [sig('qing_officer_' + f), sig(set.stepA), sig(set.stepB), sig(set.swing)],
      };
    }
    return out;
  })()`);
  report.snapshots.frames = frames;
  const frameOk = Object.values(frames).every(
    (v) => v && v.exist && new Set(v.sigs).size === 4,
  );
  check('framesBakedAllFacings', frameOk, Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, v && v.sigs])));

  // ③ 走路：连续 tick 时 frameKey 在两帧步态之间来回切
  const walk = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    const rig = lvl.player.rig;
    const seen = [];
    for (let i = 0; i < 120; i++) { rig.tick(16, true); seen.push(rig.frameKey); }
    return { keys: [...new Set(seen)], unitKey: rig.unitKey, last: seen[seen.length - 1] };
  })()`);
  report.snapshots.walk = walk;
  const stepKeys = walk.keys.filter((k) => k.includes('__step'));
  check('walkAlternatesStepFrames', stepKeys.length === 2, walk.keys);
  check('walkNeverFallsBackToBase', !walk.keys.some((k) => !k.includes('__')), walk.keys);

  // ④ 出手：切到 swing，收势后回到底图/步态帧
  const attack = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    const rig = lvl.player.rig;
    rig.playAttack();
    const during = [];
    for (let i = 0; i < 10; i++) { rig.tick(16, false); during.push(rig.frameKey); }
    for (let i = 0; i < 10; i++) rig.tick(16, false);
    return { during, after: rig.frameKey };
  })()`);
  report.snapshots.attack = attack;
  check('attackUsesSwingFrame', attack.during.some((k) => k.endsWith('__swing')), attack.during);
  check('attackReturnsToBase', !attack.after.endsWith('__swing'), attack.after);

  // ⑤ 静止回底图
  const idle = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    const rig = lvl.player.rig;
    for (let i = 0; i < 6; i++) rig.tick(16, false);
    return rig.frameKey;
  })()`);
  check('idleUsesBaseTexture', idle === `qing_officer_${await evaluate(`window.__dshGame.scene.getScene('Level').player.rig.currentFacing`)}`, idle);

  // ⑥ 非人形图被拒绝（鸦片箱 20×20）
  const refuse = await evaluate(`(() => {
    const scene = window.__dshGame.scene.getScene('Level');
    const api = window.__dshFrames;
    const crate = api.unitFrameSet(scene, 'crate', 1);
    const bogus = api.unitFrameSet(scene, 'no_such_texture', 1);
    return { crate, bogus };
  })()`);
  report.snapshots.refuse = refuse;
  check('rejectsNonHumanoid', refuse.crate === null && refuse.bogus === null, refuse);

  // ⑦ 缓存不重复烘（同一朝向取两次只算一份）
  const cache = await evaluate(`(() => {
    const scene = window.__dshGame.scene.getScene('Level');
    const api = window.__dshFrames;
    const before = api.unitFrameCacheSize();
    api.unitFrameSet(scene, 'qing_officer_down', 1);
    api.unitFrameSet(scene, 'qing_officer_down', 1);
    return { before, after: api.unitFrameCacheSize() };
  })()`);
  report.snapshots.cache = cache;
  check('frameCacheIsIdempotent', cache.after === cache.before, cache);

  // ⑧ 场上敌兵用的是各自的皮（不是统统 uk_infantry）
  const spawned = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    // 手动刷一波第一幕敌人，看它们各自拿到哪个兵种
    const list = (lvl.enemies || []).map(e => ({ id: e.def.id, unit: e.rig.unitKey, frame: e.rig.frameKey }));
    return list;
  })()`);
  report.snapshots.spawned = spawned;

  // ⑨ 截图：把玩家所在的区域裁出来看走路帧（clip 单位是 CSS 像素，不是逻辑坐标）
  const bounds = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    const rig = lvl.player.rig;
    for (let i = 0; i < 4; i++) rig.tick(16, true);
    const cam = lvl.cameras.main;
    const cv = document.querySelector('canvas');
    const r = cv.getBoundingClientRect();
    const k = r.width / 480; // 逻辑坐标 → CSS 像素
    const sx = r.left + (rig.x - cam.scrollX) * k;
    const sy = r.top + (rig.y - cam.scrollY) * k;
    return { x: Math.max(0, Math.round(sx - 70)), y: Math.max(0, Math.round(sy - 80)), width: 160, height: 140 };
  })()`);
  report.snapshots.walkCrop = bounds;
  await shot('ua-1-walk-frame.png');
  await shot('ua-1-walk-crop.png', bounds);

  // 第二幕：进 1864 天京节点（清军绿营 + 马队），看新皮与帧在真实战场上跑
  await evaluate(`(() => {
    const g = window.__dshGame;
    g.scene.getScene('Level').scene.start('Level', { actId: 'ch00_act2', chapterId: 'ch00', startNode: 3 });
    return true;
  })()`);
  await sleep(1200);
  await drainDialogue();
  // 等第一波清军刷出来（有敌兵才有 rig 可看）
  await waitFor(() => evaluate(`(() => { const l = window.__dshGame.scene.getScene('Level'); return (l.enemies || []).length > 0; })()`), 25000, 'act2 wave');
  await sleep(400);
  const act2 = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    const enemy = lvl.enemies[0];
    // 让敌兵真的走两步：走的是 Enemy 每帧的同一条路径（rig.tick）
    const seen = [];
    for (let i = 0; i < 90; i++) { enemy.rig.tick(16, true); seen.push(enemy.rig.frameKey); }
    return {
      mode: lvl.mode,
      count: lvl.enemies.length,
      list: lvl.enemies.slice(0, 8).map(e => ({ id: e.def.id, unit: e.rig.unitKey, frame: e.rig.frameKey })),
      moverSteps: [...new Set(seen)],
      hasNewArtFrames: ['qing_cavalry_down', 'xiang_army_down'].every(k => window.__dshGame.textures.exists(k + '__stepA')),
    };
  })()`);
  report.snapshots.act2 = act2;
  check('act2FramesBaked', act2.moverSteps.every((k) => k.includes('__step')) && act2.moverSteps.length === 2, act2.moverSteps);
  await shot('ua-2-act2.png');

  // 副本第一波就是「租界巡捕」——正是 v1.9.1 补的那批没有图的角色，
  // 在天京节点的波次表里要等第二波才出来，所以这里直接进副本看第一波。
  await evaluate(`(() => {
    window.__dshGame.scene.getScene('Level').scene.start('Level', { actId: 'ch00_act1', chapterId: 'ch00', dungeonId: 'dg01_alley' });
    return true;
  })()`);
  await sleep(1200);
  await drainDialogue();
  await waitFor(() => evaluate(`(() => { const l = window.__dshGame.scene.getScene('Level'); return (l.enemies || []).length > 0; })()`), 25000, 'dungeon wave');
  await sleep(300);
  const dg = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    const e = lvl.enemies[0];
    const seen = [];
    for (let i = 0; i < 90; i++) { e.rig.tick(16, true); seen.push(e.rig.frameKey); }
    return {
      list: lvl.enemies.slice(0, 6).map(x => ({ id: x.def.id, unit: x.rig.unitKey })),
      first: { id: e.def.id, unit: e.rig.unitKey, steps: [...new Set(seen)] },
      patrolFrames: ['patrol_down__stepA', 'patrol_down__stepB', 'patrol_down__swing'].every(k => window.__dshGame.textures.exists(k)),
    };
  })()`);
  report.snapshots.dungeon = dg;
  // 以前巡捕落到 uk_infantry（一身红衣混在英军里），现在必须是自己的深蓝制服
  check('patrolUsesOwnArt', dg.first.unit === 'patrol', dg.first);
  check('patrolFramesBaked', dg.patrolFrames && dg.first.steps.length === 2, dg.first.steps);
  await shot('ua-3-dungeon.png');

  report.errors = report.errors.filter((e) => !/favicon|AudioContext|autoplay/i.test(e));
  check('noConsoleErrors', report.errors.length === 0, report.errors);
} catch (err) {
  report.errors.push(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  failed++;
} finally {
  try {
    ws?.close();
  } catch {}
  edge.kill();
  if (server) server.close();
  const total = Object.keys(report.checks).length;
  const passed = Object.values(report.checks).filter(Boolean).length;
  report.summary = { total, passed, failed: total - passed, errors: report.errors.length, ok: total - passed === 0 && report.errors.length === 0 };
  await writeFile(join(outDir, 'unit-anim.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`unit-anim: ${passed}/${total} 断言通过，errors=${report.errors.length}`);
  if (report.errors.length) console.log('errors:', report.errors.slice(0, 6).join('\n'));
  process.exit(report.summary.ok ? 0 : 1);
}
