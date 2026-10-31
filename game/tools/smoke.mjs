/**
 * 端到端冒烟测试：无头 Edge 依次驱动 Boot → Title → Hub → Level（探索）→ Level（战斗），
 * 检查每个阶段无 JS 错误，并核对关键实体确实被创建。
 *
 * 用法: node tools/smoke.mjs <baseUrl> <edgePath> <outDir>
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:4173';
const edge = process.argv[3];
const outDir = resolve(process.argv[4] ?? 'tools/_smoke');

const DRIVER = `
<script>
window.__smoke = { errors: [] };
window.addEventListener('error', function (e) {
  window.__smoke.errors.push('error: ' + (e.message || String(e.error)));
});
window.addEventListener('unhandledrejection', function (e) {
  window.__smoke.errors.push('unhandledrejection: ' + String(e.reason));
});
(function () {
  var orig = console.error;
  console.error = function () {
    try { window.__smoke.errors.push('console.error: ' + Array.prototype.map.call(arguments, String).join(' ')); } catch (x) {}
    return orig.apply(console, arguments);
  };
})();

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function run() {
  var g = window.__dshGame;
  var out = { errors: window.__smoke.errors, stages: [], level: {}, exploreLoop: {}, combat: {} };

  function scenes() {
    return g.scene.scenes.map(function (s) {
      return { key: s.scene.key, active: s.scene.isActive(), status: s.sys.settings.status };
    });
  }

  await sleep(2500);
  out.stages.push({ label: 'after-boot', scenes: scenes() });

  g.scene.start('Hub', { chapterId: 'ch00' });
  await sleep(2000);
  out.stages.push({ label: 'hub', scenes: scenes() });

  g.scene.start('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 0 });
  await sleep(3500);

  var lvl = g.scene.getScene('Level');
  out.level = {
    hasMap: !!lvl.map,
    mapId: lvl.map ? lvl.map.def.id : null,
    mapSolidCells: lvl.map ? lvl.map.grid.solid.flat().filter(Boolean).length : null,
    hasPlayer: !!lvl.player,
    mode: lvl.mode,
    nodeId: lvl.node ? lvl.node.id : null,
    worldObjects: lvl.worldObjects ? lvl.worldObjects.length : null,
    dialogueActive: lvl.dialogue ? lvl.dialogue.isActive : null,
    uiActive: !!(g.scene.getScene('UI') && g.scene.getScene('UI').scene.isActive())
  };
  out.stages.push({ label: 'level-explore', scenes: scenes() });

  // 推进开场对话直到结束（每次给足虚拟时间，避免 90ms 防连点）
  var guard = 0;
  while (lvl.dialogue && lvl.dialogue.isActive && guard < 24) {
    lvl.dialogue.advance();
    guard++;
    await sleep(250);
  }
  out.level.dialogueDone = !(lvl.dialogue && lvl.dialogue.isActive);
  out.level.dialogueAdvances = guard;

  // 让 update() 里走到玩家身上的交互物判定生效
  lvl.nearObject = lvl.findNearObject();

  // ---- 功能性验证：走完「搬 8 箱 → 投入销烟池」的完整循环 ----
  var delivered = 0;
  var loops = 0;
  while (loops < 12) {
    loops++;
    var crate = lvl.worldObjects.filter(function (o) {
      return o.def.kind === 'pickup' && o.rect.visible;
    })[0];
    if (!crate) break;
    lvl.player.rig.setPosition(crate.rect.x, crate.rect.y);
    lvl.nearObject = lvl.findNearObject();
    lvl.handleInteract();
    await sleep(120);

    var pool = lvl.worldObjects.filter(function (o) { return o.def.kind === 'deposit'; })[0];
    if (pool) {
      lvl.player.rig.setPosition(pool.rect.x + 12, pool.rect.y + 8);
      lvl.nearObject = lvl.findNearObject();
      lvl.handleInteract();
      await sleep(120);
    }
    delivered = lvl.cratesDelivered;
  }
  out.exploreLoop = {
    loops: loops,
    cratesDelivered: delivered,
    crateTarget: lvl.crateTarget,
    exitVisible: lvl.worldObjects.some(function (o) { return o.def.kind === 'exit' && o.rect.visible; }),
    carrying: lvl.carrying
  };

  // 等节点推进（8 箱完成后应进入 nd_1839_humen_pool）
  await sleep(1500);
  out.exploreLoop.nodeAfterDeliver = lvl.node ? lvl.node.id : null;
  out.exploreLoop.knowledgeCount = null;

  // ---- 战斗节点 ----
  var t0 = lvl.time.now;
  await lvl.startNode(2);
  await sleep(4500);
  var t1 = lvl.time.now;
  out.combat = {
    mode: lvl.mode,
    nodeId: lvl.node ? lvl.node.id : null,
    mapId: lvl.map ? lvl.map.def.id : null,
    clockAdvancedMs: Math.round(t1 - t0),
    spawnedTotal: lvl.spawnedTotal,
    waveIndex: lvl.waveIndex,
    wavePending: lvl.wavePending,
    bossSpawned: lvl.bossSpawned,
    enemyCount: lvl.enemies ? lvl.enemies.length : null,
    enemyPositions: lvl.enemies.slice(0, 4).map(function (e) {
      return { x: Math.round(e.x), y: Math.round(e.y), hp: e.hp };
    })
  };

  // 若计时器没跑起来，直接手动触发一次波次，区分「定时器问题」与「生成逻辑问题」
  if (lvl.enemies.length === 0) {
    lvl.spawnWave(0);
    await sleep(1200);
    out.combat.manualSpawnEnemyCount = lvl.enemies.length;
    out.combat.manualSpawnedTotal = lvl.spawnedTotal;
  }

  // 近战命中验证：把敌人挪到身边再打
  var target = lvl.enemies[0];
  if (target) {
    var hpBefore = target.hp;
    for (var a = 0; a < 10; a++) {
      lvl.player.rig.setFacing('right');
      lvl.player.rig.setPosition(target.x - 16, target.y);
      lvl.playerAttack();
      await sleep(220);
    }
    out.combat.hpBefore = hpBefore;
    out.combat.hpAfter = target.hp;
    out.combat.damageDealt = hpBefore - target.hp;
  }

  out.finalErrors = window.__smoke.errors;
  out.stages.push({ label: 'level-combat', scenes: scenes() });

  var el = document.createElement('pre');
  el.id = 'dsh-smoke';
  el.textContent = JSON.stringify(out);
  document.body.appendChild(el);
}

setTimeout(function () { run().catch(function (e) {
  var el = document.createElement('pre');
  el.id = 'dsh-smoke';
  el.textContent = JSON.stringify({ fatal: String(e && e.stack || e), errors: window.__smoke.errors });
  document.body.appendChild(el);
}); }, 400);
</script>
`;

async function main() {
  await mkdir(outDir, { recursive: true });

  const html = await readFile(join('dist', 'index.html'), 'utf8');
  await writeFile(join('dist', '__smoke.html'), html.replace('</body>', `${DRIVER}</body>`), 'utf8');

  const commonArgs = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${join(outDir, 'profile')}`,
    '--window-size=960,540',
  ];

  const domRun = await execFileAsync(
    edge,
    [...commonArgs, '--virtual-time-budget=30000', '--dump-dom', `${baseUrl}/__smoke.html`],
    { maxBuffer: 64 * 1024 * 1024, timeout: 180000 },
  ).catch((e) => ({ stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message) }));

  const dom = domRun.stdout ?? '';
  await writeFile(join(outDir, 'smoke-dom.html'), dom, 'utf8');

  const m = dom.match(/<pre id="dsh-smoke">([\s\S]*?)<\/pre>/);
  let report;
  if (m) {
    const decoded = m[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'");
    try {
      report = JSON.parse(decoded);
    } catch (e) {
      report = { parseError: String(e), raw: decoded.slice(0, 600) };
    }
  } else {
    report = { missing: true, domLength: dom.length, stderrTail: String(domRun.stderr ?? '').slice(-400) };
  }

  await execFileAsync(
    edge,
    [...commonArgs, '--virtual-time-budget=9000', `--screenshot=${join(outDir, 'title.png')}`, `${baseUrl}/`],
    { timeout: 120000 },
  ).catch(() => undefined);

  await writeFile(join(outDir, 'smoke.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error('SMOKE FAILED', e);
  process.exit(1);
});