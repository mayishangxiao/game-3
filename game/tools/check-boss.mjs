/**
 * Boss 三段招式的专项验证：观察一段时间内 Boss 实际执行了哪些招式。
 *
 * 只验证「阶段数据里有 ram」是不够的——要看到 onVolley 真的产生了弹幕、
 * onSummon 真的加了敌人、onCharge 真的把 Boss 推进并进入弱点期。
 *
 * 用法: node tools/check-boss.mjs <edgePath> <baseUrl> <outDir>
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';

const edge = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4173';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp2');
const port = 9336;

const errors = [];
let ws;
let msgId = 0;
const pending = new Map();
/** 放模块作用域，方便中途插入探针代码 */
const report = { errors, act1: {}, act2: {} };

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
    throw new Error('evaluate threw: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  }
  return r?.result?.result?.value;
}

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  throw new Error('等待超时：' + label);
}

const L = 'window.__dshGame.scene.getScene("Level")';

/**
 * 关掉当前开着的对话。
 * 关卡开场对话存在时，LevelScene.update() 会提前 return（对话暂停战斗，这是刻意设计），
 * 不关掉的话 Boss 一句招式都不会放——这一点曾让一次验证得出错误结论。
 */
async function dismissDialogue(maxRounds = 24) {
  let rounds = 0;
  while ((await evaluate(`${L}.dialogue && ${L}.dialogue.isActive`)) && rounds < maxRounds) {
    await evaluate(`${L}.dialogue.advance(); 1`);
    rounds += 1;
    await sleep(170);
  }
  return rounds;
}

const proc = spawn(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(outDir, 'profile-boss')}`,
    '--window-size=960,540',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

/** 观察窗口：记录 bossAction.kind 的变化序列与各项指标峰值 */
async function observe(seconds, label) {
  const t0 = Date.now();
  const seen = [];
  let maxProjectiles = 0;
  let maxEnemies = 0;
  let weakpointSeen = false;
  let bossHp = null;
  let samples = 0;
  const diag = { calls: null, timer: null, alive: null, playerAlive: null, mode: null };
  while (Date.now() - t0 < seconds * 1000) {
    const s = await evaluate(`
      (function () {
        var lvl = ${L};
        var b = lvl.enemies.filter(function (e) { return e.def.tier === 'boss'; })[0];
        // 探针期间不让玩家死：否则关卡会重开，Boss 被清掉，观察中断
        if (lvl.player) { lvl.player.maxHp = 5000; lvl.player.hp = 5000; }
        return {
          kind: b && b.bossAction ? b.bossAction.kind : null,
          weak: b ? b.isWeakpoint : null,
          hp: b ? b.hp : null,
          calls: b ? (b.__calls || 0) : null,
          timer: b ? Math.round(b.bossTimer) : null,
          alive: b ? b.alive : null,
          playerAlive: lvl.player ? lvl.player.alive : null,
          mode: lvl.mode,
          transitioning: !!lvl.transitioning,
          projectiles: lvl.projectiles.length,
          enemies: lvl.enemies.length
        };
      })()
    `);
    samples += 1;
    if (s.kind && seen[seen.length - 1] !== s.kind) seen.push(s.kind);
    maxProjectiles = Math.max(maxProjectiles, s.projectiles);
    maxEnemies = Math.max(maxEnemies, s.enemies);
    if (s.weak) weakpointSeen = true;
    if (s.hp !== null) bossHp = s.hp;
    diag.calls = s.calls;
    diag.timer = s.timer;
    diag.alive = s.alive;
    diag.playerAlive = s.playerAlive;
    diag.mode = s.mode;
    diag.transitioning = s.transitioning;
    await sleep(120);
  }
  return { label, samples, actionSequence: seen, maxProjectiles, maxEnemies, weakpointSeen, bossHp, diag };
}

try {
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
    } catch {
      return false;
    }
  }, 20000, 'DevTools');

  let target;
  try {
    target = await (
      await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(baseUrl + '/')}`, { method: 'PUT' })
    ).json();
  } catch {
    target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(baseUrl + '/')}`)).json();
  }

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params?.exceptionDetails;
      errors.push('exception: ' + String(d?.exception?.description ?? d?.text ?? '').slice(0, 300));
    }
  };

  await send('Runtime.enable');
  await waitFor(async () => await evaluate('!!window.__dshGame'), 15000, 'game');
  await sleep(2600);

  // 第一幕的炮舰：阶段招式 = broadside → broadside+landing_boat → broadside+ram
  await evaluate(
    "window.__dshGame.scene.start('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 }); 'ok'",
  );
  await sleep(2500);
  report.act1.dialogueRounds = await dismissDialogue();
  report.act1.dialogueClosed = !(await evaluate(`${L}.dialogue.isActive`));
  // 清掉杂兵并直接召唤 Boss，避免等波次
  await evaluate(`
    (function () {
      var lvl = ${L};
      lvl.enemies.forEach(function (e) { e.rig.destroy(); });
      lvl.enemies = [];
      lvl.spawnBoss();
      return lvl.enemies.length;
    })()
  `);
  await sleep(600);

  // 给 Boss 的 update 打运行时探针，确认它到底有没有被每帧调用
  report.act1.patched = await evaluate(`
    (function () {
      var lvl = ${L};
      var b = lvl.enemies.filter(function (e) { return e.def.tier === 'boss'; })[0];
      if (!b) return 'no-boss';
      if (!b.__patched) {
        b.__patched = true;
        b.__calls = 0;
        var orig = b.update;
        b.update = function () { b.__calls += 1; return orig.apply(b, arguments); };
      }
      return { isBoss: b.isBoss, alive: b.alive, timer: Math.round(b.bossTimer), tier: b.def.tier };
    })()
  `);

  report.act1.bossInfo = await evaluate(`
    (function () {
      var lvl = ${L};
      var b = lvl.enemies.filter(function (e) { return e.def.tier === 'boss'; })[0];
      return { name: b && b.def.name, hp: b && b.hp, phases: b && b.def.boss_phases };
    })()
  `);

  // 观察第一阶段（满血）：应看到 broadside
  report.act1.phase1 = await observe(7, 'phase1');

  // 压到第二阶段：应能看到 landing_boat 并召唤援兵
  await evaluate(`
    (function () {
      var lvl = ${L};
      var b = lvl.enemies.filter(function (e) { return e.def.tier === 'boss'; })[0];
      b.hp = Math.round(b.maxHp * 0.6);
      b.takeDamage(1, false, lvl.cfg);
      return b.hp;
    })()
  `);
  report.act1.phase2 = await observe(8, 'phase2');

  // 压到第三阶段：应能看到 ram 并进入弱点期
  await evaluate(`
    (function () {
      var lvl = ${L};
      var b = lvl.enemies.filter(function (e) { return e.def.tier === 'boss'; })[0];
      b.hp = Math.round(b.maxHp * 0.2);
      b.takeDamage(1, false, lvl.cfg);
      return b.hp;
    })()
  `);
  report.act1.phase3 = await observe(9, 'phase3');

  report.act1.final = await evaluate(`
    (function () {
      var lvl = ${L};
      var b = lvl.enemies.filter(function (e) { return e.def.tier === 'boss'; })[0];
      return {
        weakpoint: b ? b.isWeakpoint : null,
        phaseAttacks: b && b.currentPhase(lvl.cfg) ? b.currentPhase(lvl.cfg).attacks : null,
        enemyTypes: lvl.enemies.map(function (e) { return e.def.id; })
      };
    })()
  `);

  // 第二幕的湘军统领（近战型 Boss，招式 broadside → +landing_boat → ram）
  await evaluate(`
    (function () {
      var g = window.__dshGame;
      g.scene.stop('Level'); g.scene.stop('UI');
      return 1;
    })()
  `);
  await sleep(500);
  await evaluate(
    "window.__dshGame.scene.start('Level', { actId: 'ch00_act2', chapterId: 'ch00', startNode: 3 }); 'ok'",
  );
  await sleep(2600);
  await evaluate(`
    (function () {
      var lvl = ${L};
      lvl.enemies.forEach(function (e) { e.rig.destroy(); });
      lvl.enemies = [];
      lvl.spawnBoss();
      return lvl.enemies.length;
    })()
  `);
  await sleep(600);
  report.act2.bosses = await evaluate(`
    (function () {
      var lvl = ${L};
      return lvl.enemies.map(function (e) {
        return { name: e.def.name, hp: e.hp, phases: e.def.boss_phases ? e.def.boss_phases.length : 0 };
      });
    })()
  `);
  report.act2.observe = await observe(8, 'dual');

  report.finalErrors = errors;
  await writeFile(join(outDir, 'check-boss.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error('BOSS CHECK FAILED:', e?.message ?? e);
  console.error('errors:', JSON.stringify(errors, null, 2));
  process.exit(1);
} finally {
  try {
    proc.kill();
  } catch {
    /* ignore */
  }
}