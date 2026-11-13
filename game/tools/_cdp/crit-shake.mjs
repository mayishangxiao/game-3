// 暴击震屏回归探针（2026-11-13「太平天国运动环节暴击震动力度过大」）。
//
// 现象：太平天国战场（ch00_act2 / 天京陷落）敌群密集，一次横扫/剑气能连出多个暴击，
//       镜头被一遍遍 shake 续着抖，从「打击反馈」变成「晕屏」。
// 修复：强度收敛到 core/critShake.ts 的舒适区（>0 且 ≤0.0012）、时长 45ms、
//       140ms 合并窗口内一串暴击只震一次。数值是纯函数，单测在 tests/critShake.test.ts；
//       本探针负责验证 **LevelScene 真的按这套规则调了 camera.shake**。
//
// 走真实太平天国战斗关（nd_1864_tianjing_fall，第一波 5 个敌兵），断言：
//   1) hook 到真实的 cameras.main.shake；
//   2) 连续 5 次暴击只落 1 次震动（合并窗口生效，不再晃屏）；
//   3) 每次震动强度 > 0 且 ≤ 0.0012（保留轻微反馈，但不会回到旧的 0.002）；
//   4) 时长短促（≤50ms）；
//   5) 冷却窗口过后能再次触发（不是把效果改没了）；
//   6) 真实暴击路径（强制必暴击 + damageEnemy 连打 5 个敌兵）同样只震一次且参数合规。
//
// 用法：
//   node tools/_cdp/crit-shake.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const CDP_PORT = 9482;
const HTTP_PORT = 9481;
const profile = join(outDir, '_profile-crit-shake');

// 与 src/core/critShake.ts 保持一致（探针是独立 JS 进程，不能 import TS）
const MAX_INTENSITY = 0.0012;
const MAX_DURATION_MS = 50;
const OLD_INTENSITY = 0.002; // 修复前：config.screenshake_amp=2 → shake(60, 0.002)
const COOLDOWN_MS = 140;

if (!edgePath) {
  console.error('usage: node tools/_cdp/crit-shake.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
  process.exit(2);
}
const isRemote = /^https?:\/\//.test(target);
const staticDir = isRemote ? null : resolve(target);
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png' };
const server = isRemote ? null : createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = normalize(p.replace(/^\/+/, '')).replace(/^(\.\.[/\\])+/, '');
    const file = resolve(staticDir, rel === '' || rel === '.' ? 'index.html' : rel);
    if (!file.startsWith(staticDir)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = await fn(); if (v) return v; await sleep(150); }
  throw new Error(`timeout waiting for ${label}`);
}
await mkdir(outDir, { recursive: true });
await rm(profile, { recursive: true, force: true }).catch(() => {});
await mkdir(profile, { recursive: true });
if (server) await new Promise((res) => server.listen(HTTP_PORT, '127.0.0.1', res));
const baseUrl = isRemote ? target : `http://127.0.0.1:${HTTP_PORT}`;

const edge = spawn(edgePath, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-gpu','--window-size=960,540','about:blank'], { stdio: 'ignore' });
const report = { url: baseUrl, node: 'nd_1864_tianjing_fall (ch00_act2 / startNode 3)', checks: {}, snapshots: {}, errors: [] };
let ws;
try {
  const list = await waitFor(async () => { try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); const j = await r.json(); const page = j.find((t) => t.type === 'page'); return page ? page.webSocketDebuggerUrl : null; } catch { return null; } }, 20000, 'devtools');
  ws = new WebSocket(list);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') report.errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception');
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') report.errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) { const text = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text; throw new Error(`EVAL FAILED: ${text}`); } return r.result.value; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(outDir, name), Buffer.from(r.data, 'base64')); };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl }); await sleep(500);
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await sleep(300);
  await evaluate(`(() => { const g=document.getElementById('tap-gate'); const b=g&&g.querySelector('.tg-go'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(600);

  // 进真实的太平天国战斗关：天京陷落（无对白、无开场卡，第一波 5 个绿营兵）。
  // 坑：startNode 是 **act 自己的 nodes 数组下标**，不是 nodes_ch00.json 里的全局序号——
  // ch00_act2.nodes 只有 5 个，天京陷落是局部 index 3（全局 index 7）。传 7 会让
  // startNodeInner() 找不到节点而直接 finishAct() 回长廊，表现是「一个敌兵都不刷」。
  await evaluate(`(() => { window.__dshGame.scene.getScene('Title').scene.start('Level', { actId:'ch00_act2', chapterId:'ch00', startNode: 3 }); return true; })()`);
  await waitFor(() => evaluate(`(() => { const l=window.__dshGame.scene.getScene('Level'); return !!(window.__dshLevel && l && l.player && l.enemies && l.enemies.length > 0); })()`), 40000, 'taiping battle enemies');
  await sleep(800);
  // 保险：万一有开场卡/对白挡着，先关掉（这个节点本来没有，留着防御后续内容改动）
  for (let i=0;i<8 && await evaluate('!!window.__dshLevel.introOpen');i++){ await evaluate('(function(){var l=window.__dshGame.scene.getScene("Level"); if(l.pendingCardTap) l.pendingCardTap(); return 1;})()'); await sleep(250); }
  await sleep(300);

  // hook 真实的 camera.shake，保留原始行为（画面照常轻震），只额外记录参数
  const hook = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    const cam = lvl && lvl.cameras && lvl.cameras.main;
    if (!cam) return { ok:false, reason:'no main camera' };
    if (!cam.__critShakeHooked) {
      const orig = cam.shake.bind(cam);
      window.__critShakeCalls = [];
      cam.shake = function (duration, intensity, ...rest) {
        window.__critShakeCalls.push({ duration: duration, intensity: intensity });
        return orig(duration, intensity, ...rest);
      };
      cam.__critShakeHooked = true;
    }
    window.__critShakeCalls.length = 0;
    return { ok:true, enemyCount: window.__dshLevel.enemies().length, now: lvl.time.now };
  })()`);
  report.snapshots.hook = hook;
  report.checks.hookInstalled = hook.ok === true && hook.enemyCount > 0;
  await shot('cs-1-taiping-battle.png');

  // ① 连续 5 次暴击（模拟一次横扫连中多个且全部暴击）：合并窗口内只应震 1 次
  const burst = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    window.__critShakeCalls.length = 0;
    for (let i=0;i<5;i++) lvl.critShake();
    return { calls: window.__critShakeCalls.slice(), now: lvl.time.now };
  })()`);
  report.snapshots.burst = burst;
  const burstOk = (c) => c.intensity > 0 && c.intensity <= MAX_INTENSITY && c.duration > 0 && c.duration <= MAX_DURATION_MS;
  report.checks.burstMergedToOne = burst.calls.length === 1;
  report.checks.intensityComfortable = burst.calls.length > 0 && burst.calls.every(burstOk);
  report.checks.belowOldIntensity = burst.calls.length > 0 && burst.calls.every((c) => c.intensity < OLD_INTENSITY);

  // ② 冷却窗口过后必须还能再震（不许把效果「修没了」）
  await sleep(COOLDOWN_MS + 120);
  const afterCooldown = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    lvl.critShake();
    return { calls: window.__critShakeCalls.slice(), now: lvl.time.now };
  })()`);
  report.snapshots.afterCooldown = afterCooldown;
  report.checks.cooldownRecovers = afterCooldown.calls.length === 2 && burstOk(afterCooldown.calls[1]);

  // ③ 真实暴击路径：强制必暴击，对 5 个真实敌兵各打一次 damageEnemy。
  // 上一步刚触发过一次 critShake，这里必须等合并窗口过去再打，否则 5 次暴击会被
  // 正确地合并进上一步的冷却里、calls 为空——那是探针写法错了，不是修复失效。
  await sleep(COOLDOWN_MS + 120);
  const real = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    window.__critShakeCalls.length = 0;
    lvl.player.crit = 100;
    const alive = lvl.enemies.filter((e) => e.alive).slice(0, 5);
    let hit = 0;
    const errs = [];
    for (const e of alive) {
      try { lvl.damageEnemy(e, 1, 'melee'); hit++; } catch (err) { errs.push(String(err && err.message || err)); }
    }
    return { enemyCount: alive.length, hit: hit, errs: errs, calls: window.__critShakeCalls.slice() };
  })()`);
  report.snapshots.realCritPath = real;
  report.checks.realCritPathMerged = real.hit >= 3 && real.errs.length === 0 && real.calls.length === 1 && burstOk(real.calls[0]);
  await shot('cs-2-after-crits.png');

  // ④ 总体：确实震过（没被删），控制台零异常
  const total = burst.calls.length + (afterCooldown.calls.length - burst.calls.length) + real.calls.length;
  report.checks.notRemoved = total >= 3;
  report.checks.noConsoleErrors = report.errors.length === 0;
  report.verdict = {
    pass: Object.values(report.checks).every(Boolean),
    total: Object.keys(report.checks).length,
    failed: Object.entries(report.checks).filter(([, v]) => v === false).map(([k]) => k),
    totalShakeCalls: total,
    oldIntensity: OLD_INTENSITY,
    maxIntensity: MAX_INTENSITY,
  };
  await writeFile(join(outDir, 'crit-shake.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.verdict.pass, checks: report.checks, burst: burst.calls, real: real.calls, errors: report.errors }, null, 2));
} catch (e) {
  console.error('PROBE FAILED:', e?.message ?? e);
  report.errors.push(String(e?.message ?? e));
  try { await writeFile(join(outDir, 'crit-shake.json'), JSON.stringify(report, null, 2)); } catch {}
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  edge.kill('SIGKILL');
  if (server) await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
