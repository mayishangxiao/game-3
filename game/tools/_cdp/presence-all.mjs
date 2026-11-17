// 全战役「实力感分层」巡检探针（v2.8）。
//
// 为什么要有这一条：v2.7 的 `core/combatPresence.ts` 是**全局按敌人档位**生效的，
// 但当时只在第三幕海战实拍过。其余四场战斗（第一幕虎门炮台、第二幕天京陷落、
// 第四幕戊戌政变、第五幕武昌起义）的血条厚度、护甲条、倒地时长、舰船沉没姿态
// 全都被同一次改动影响，属于未验证的回归面。
//
// 这一轮巡检实际挖出两个真问题（都已在本探针里锁住）：
//   ① `onEnemyDeath` 写死 320ms 就 destroy，把精英 420ms / Boss 900ms 的倒地
//      时长整个吃掉 —— 「强者倒得更久」在实际游戏里根本看不到；
//   ② `CharacterRig.playDeath` 对军舰也做 90° 倒地旋转，96×48 的船体会在 900ms
//      里慢慢竖起来，像被立起来的积木，而不是被击沉。
//
// 用法：node tools/_cdp/presence-all.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_presence-all-out');
const CDP_PORT = 9512;
const HTTP_PORT = 9511;
const profile = join(outDir, '_profile');

if (!edgePath) {
  console.error('usage: node tools/_cdp/presence-all.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
  process.exit(2);
}

const isRemote = /^https?:\/\//.test(target);
const staticDir = isRemote ? null : resolve(target);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
};
const server = isRemote ? null : createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = normalize(p.replace(/^\/+/, '')).replace(/^(\.\.[/\\])+/, '');
    const file = resolve(staticDir, rel === '' || rel === '.' ? 'index.html' : rel);
    if (!file.startsWith(staticDir)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
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

const edge = spawn(edgePath, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=960,540', 'about:blank',
], { stdio: 'ignore' });

// 五场战斗：节点索引来自各自 act 的 nodes 数组（改幕结构要同步这里）
const CAMPAIGNS = [
  { key: 'act1', actId: 'ch00_act1', startNode: 2, boss: 'en_boss_steamfrigate', ship: true },
  { key: 'act2', actId: 'ch00_act2', startNode: 3, boss: 'en_boss_xiangarmy_a', ship: false },
  { key: 'act3', actId: 'ch00_act3', startNode: 2, boss: 'en_boss_jp_yoshino', ship: true },
  { key: 'act4', actId: 'ch00_act4', startNode: 2, boss: 'en_boss_qing_zhitong', ship: false },
  { key: 'act5', actId: 'ch00_act5', startNode: 0, boss: 'en_boss_qing_zhitong', ship: false },
];

const report = { url: baseUrl, checks: {}, battle: {}, errors: [] };
let ws;
try {
  const list = await waitFor(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const j = await r.json();
      const page = j.find((t) => t.type === 'page');
      return page ? page.webSocketDebuggerUrl : null;
    } catch { return null; }
  }, 20000, 'devtools');
  ws = new WebSocket(list);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      report.errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception');
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      report.errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`EVAL FAILED: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, name), Buffer.from(r.data, 'base64'));
  };
  const drainDialogue = async (max = 80) => {
    for (let i = 0; i < max; i++) {
      const active = await evaluate(`!!window.__dshGame.scene.getScene('Level')?.dialogue?.isActive`);
      if (!active) return i;
      await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance()`);
      await sleep(120);
    }
    return -1;
  };
  const tap = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(340);
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl }); await sleep(600);
  await evaluate('(() => { try { localStorage.clear(); } catch {} return true; })()').catch(() => {});
  await send('Page.reload', { ignoreCache: true });
  await sleep(800);
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await sleep(300);
  await evaluate(`(() => { const g=document.getElementById('tap-gate'); const b=g&&g.querySelector('.tg-go'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(400);

  for (const c of CAMPAIGNS) {
    const b = { key: c.key };
    report.battle[c.key] = b;
    try {
      await evaluate(`(() => { window.__dshGame.scene.start('Level', { actId: '${c.actId}', chapterId: 'ch00', startNode: ${c.startNode} }); return true; })()`);
      await waitFor(() => evaluate(`window.__dshGame.scene.isActive('Level') && !!window.__dshGame.scene.getScene('Level').node`), 40000, `${c.key} node`);
      await waitFor(() => evaluate(`!!window.__dshGame.scene.getScene('Level').map`), 40000, `${c.key} map`);
      await sleep(800);
      b.node = await evaluate(`window.__dshGame.scene.getScene('Level').node.id`);
      if (c.key === 'act1') {
        b.viewport = await evaluate(`(() => {
          const cv = document.querySelector('#game-root canvas');
          const root = document.getElementById('game-root');
          return {
            innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio,
            rootW: root?.clientWidth ?? null, rootH: root?.clientHeight ?? null,
            canvasBufW: cv?.width ?? null, canvasBufH: cv?.height ?? null,
            canvasCssW: cv ? getComputedStyle(cv).width : null,
            canvasCssH: cv ? getComputedStyle(cv).height : null,
            scaleMode: window.__dshGame?.scale?.scaleMode ?? null,
            displayScale: window.__dshGame?.scale?.displayScale ?? null,
          };
        })()`);
        report.viewport = b.viewport;
      }

      // 开场卡（情境卡 / 双舰对照卡）：卡片在时点画布中心推进；没有卡片就直接推对白
      for (let i = 0; i < 3; i++) {
        const hasCard = await evaluate(`!!window.__dshGame.scene.getScene('Level').pendingCardTap`);
        if (!hasCard) break;
        await tap(480, 270);
        await sleep(420);
      }
      await drainDialogue();
      await sleep(500);
      await shot(`${c.key}-field.png`);

      /* ---------- 1. 普通敌人：薄血条 / 无甲 / 死得快 ---------- */
      await evaluate(`(() => { const l = window.__dshGame.scene.getScene('Level'); try { l.spawnWave(0); } catch (e) {} return true; })()`);
      await sleep(900);

      // v2.9 判定框改动后最容易出的回归：谁都打不到了。
      // 把一个近战兵贴到站着不动的玩家身边，等它走完「蓄力 → 出手」，血必须真的掉。
      if (c.key === 'act1') {
        b.idleHit = await evaluate(`(() => {
          const l = window.__dshGame.scene.getScene('Level');
          const e = l.enemies.find((x) => x.alive && x.def.body !== 'ship' && x.def.tier !== 'ranged');
          if (!e) return null;
          const hp0 = l.player.hp;
          e.teleportTo(l.player.x + 20, l.player.y);
          e.state = 'chase'; e.stateTimer = 0;
          return { hp0, id: e.def.id, tier: e.def.tier, reach: e.presence.attackReach };
        })()`);
        await sleep(1200);
        b.idleHitAfter = await evaluate(`window.__dshGame.scene.getScene('Level').player.hp`);
        // 后面还要接着跑精英 / Boss，先把血补满，别让这一下把这一轮打死
        await evaluate(`(() => {
          const l = window.__dshGame.scene.getScene('Level');
          l.player.hp = l.player.maxHp; l.player.alive = true;
          return true;
        })()`);
      }

      const foe = await evaluate(`(() => {
        const l = window.__dshGame.scene.getScene('Level');
        const e = l.enemies.find((x) => x.alive && x.def.body !== 'ship' && x.def.tier !== 'boss');
        if (!e) return null;
        return {
          id: e.def.id, tier: e.def.tier,
          barH: e.presence.barH, armorLayers: e.hpArmor.length,
          deathMs: e.presence.deathMs, hitStopMs: e.presence.hitStopMs,
          knockResist: e.presence.knockResist, hasAura: !!e.auraGlow,
        };
      })()`);
      b.foe = foe;
      if (foe) {
        await evaluate(`(() => {
          const l = window.__dshGame.scene.getScene('Level');
          const e = l.enemies.find((x) => x.alive && x.def.body !== 'ship' && x.def.tier !== 'boss');
          if (!e) return false;
          e.hp = 1;
          e.takeDamage(99999, false, l.cfg);
          l.onEnemyDeath(e);
          return true;
        })()`);
        await sleep(120);
        b.foeAt120 = await evaluate(`(() => {
          const l = window.__dshGame.scene.getScene('Level');
          return { dying: l.dyingEnemies.length, angle: Math.round(l.dyingEnemies[0]?.rig.angle ?? 0) };
        })()`);
        await sleep(420);
        b.foeAt540 = await evaluate(`window.__dshGame.scene.getScene('Level').dyingEnemies.length`);
      }

      /* ---------- 1b. 精英挨打还手：短前摇的报复挥砍（v2.9） ---------- */
      if (c.key === 'act1') {
        b.eliteSpawn = await evaluate(`(() => {
          const l = window.__dshGame.scene.getScene('Level');
          const def = l.findEnemy('en_uk_officer');
          if (!def) return { error: 'def not found' };
          l.spawnEnemy(def, 'right');
          const e = l.enemies.filter((x) => x.alive).find((x) => x.def.id === 'en_uk_officer');
          if (!e) return { error: 'spawn failed' };
          e.teleportTo(l.player.x + 18, l.player.y);
          return { id: e.def.id, reach: e.presence.attackReach, arc: e.presence.attackArcDeg };
        })()`);
        await sleep(260); // 让它在 update 里记住玩家位置
        await evaluate(`(() => {
          const l = window.__dshGame.scene.getScene('Level');
          const e = l.enemies.find((x) => x.alive && x.def.id === 'en_uk_officer');
          if (e) {
            // 它被贴到身边后已经自己起手了；「正在蓄力」时按设计不还手，
            // 所以先退回 chase 再打 —— 这才是玩家贪刀时的真实状态
            e.state = 'chase'; e.stateTimer = 0;
            e.counterCd = 0;
            e.takeDamage(5, false, l.cfg);
          }
          return true;
        })()`);
        await sleep(120);
        b.eliteCounter = await evaluate(`(() => {
          const l = window.__dshGame.scene.getScene('Level');
          const e = l.enemies.find((x) => x.alive && x.def.id === 'en_uk_officer');
          return e ? { state: e.state, countering: !!e.countering, timer: Math.round(e.stateTimer) } : null;
        })()`);
        // 再等一拍让那刀真的砍出来：截图给人眼确认「刀光比杂鱼更长更宽」
        await sleep(200);
        await shot('act1-elite-counter.png');
      }

      /* ---------- 2. Boss：厚血条 / 双层甲 / 死得慢、姿态正确 ---------- */
      await evaluate(`(() => { window.__dshGame.scene.getScene('Level').spawnBoss(); return true; })()`);
      await sleep(1000);
      const boss = await evaluate(`(() => {
        const l = window.__dshGame.scene.getScene('Level');
        const e = l.enemies.find((x) => x.def.tier === 'boss');
        if (!e) return null;
        return {
          id: e.def.id, body: e.def.body ?? 'human',
          barH: e.presence.barH, armorLayers: e.hpArmor.length,
          deathMs: e.presence.deathMs, hitStopMs: e.presence.hitStopMs,
          knockResist: e.presence.knockResist,
          sparkN: e.presence.sparkN, auraR: e.presence.auraR,
          isShip: !!e.rig.isShip,
          shipKey: e.rig.shipKeys?.[0] ?? null,
        };
      })()`);
      b.boss = boss;
      // v2.9 Boss 反击：挨打把「下一招还要等多久」清零（预警时长一秒不减，玩家仍躲得掉）。
      // 正在放的招式会挡住这次反击，所以先清 bossAction；计时器从 6000 直接归零才算生效。
      b.bossCounter = await evaluate(`(() => {
        const l = window.__dshGame.scene.getScene('Level');
        const e = l.enemies.find((x) => x.def.tier === 'boss');
        if (!e) return null;
        e.bossAction = null;
        e.counterCd = 0;
        e.bossTimer = 6000;
        const before = e.bossTimer;
        e.takeDamage(1, false, l.cfg);
        return { before, after: Math.round(e.bossTimer), halted: !!e.actionsHalted };
      })()`);
      // Boss 登场推镜结束后，相机必须回 RENDER_SCALE（= 后缓冲宽 / 480）。
      // 回 1 会让整个画面缩进左上角 1/R² —— v2.7 真出过这个线上回归。
      await sleep(320); // 推镜 420 + 延迟 480 + 拉回 520 ≈ 1000ms，多等一拍再读
      b.zoomAfterBoss = await evaluate(`(() => {
        const l = window.__dshGame.scene.getScene('Level');
        const cv = document.querySelector('#game-root canvas');
        return { zoom: Math.round(l.cameras.main.zoom * 1000) / 1000, R: (cv?.width ?? 480) / 480 };
      })()`);
      await shot(`${c.key}-boss.png`);

      if (boss) {
        b.nodeBeforeKill = await evaluate(`window.__dshGame.scene.getScene('Level').node.id`);
        await evaluate(`(() => {
          const l = window.__dshGame.scene.getScene('Level');
          const e = l.enemies.find((x) => x.def.tier === 'boss');
          if (!e) return false;
          e.hp = 1;
          e.takeDamage(99999, false, l.cfg);
          l.onEnemyDeath(e);
          return true;
        })()`);
        await sleep(150);
        b.bossAt150 = await evaluate(`(() => {
          const l = window.__dshGame.scene.getScene('Level');
          const d = l.dyingEnemies[0];
          return { dying: l.dyingEnemies.length, angle: Math.round(d?.rig.angle ?? 0), alpha: Math.round((d?.rig.alpha ?? 0) * 100) / 100 };
        })()`);
        await sleep(420); // 累计 ~570ms：Boss 900ms 倒地应仍在
        b.bossAt570 = await evaluate(`(() => {
          const l = window.__dshGame.scene.getScene('Level');
          const d = l.dyingEnemies[0];
          return { dying: l.dyingEnemies.length, node: l.node?.id ?? null, angle: Math.round(d?.rig.angle ?? 0) };
        })()`);
        await shot(`${c.key}-boss-down.png`);
        await sleep(560); // 累计 ~1.13s：应已销毁
        b.bossAt1130 = await evaluate(`(() => {
          const l = window.__dshGame.scene.getScene('Level');
          return { dying: l.dyingEnemies.length, node: l.node?.id ?? null };
        })()`);
      }
    } catch (err) {
      b.error = String(err?.message ?? err);
    }
  }

  /* ---------------- 断言 ---------------- */
  const keys = CAMPAIGNS.map((c) => c.key);
  report.checks.allBattlesReached = keys.every((k) => report.battle[k]?.boss);
  report.checks.bossBarsAreHeavy = keys.every((k) => report.battle[k]?.boss?.barH === 5);
  report.checks.bossHasTwoArmorLayers = keys.every((k) => report.battle[k]?.boss?.armorLayers === 2);
  report.checks.bossDeathMsIs900 = keys.every((k) => report.battle[k]?.boss?.deathMs === 900);
  report.checks.bossHitStopIs90 = keys.every((k) => report.battle[k]?.boss?.hitStopMs === 90);
  // 尸体的真实存留：570ms 时 Boss 还该在（900ms 才清），1130ms 后该已清
  report.checks.bossCorpseSurvives600ms = keys.every((k) => {
    const b = report.battle[k];
    if (!b?.boss || !b.bossAt570) return false;
    if (b.bossAt570.node !== b.nodeBeforeKill) return true; // 已切节点，清场属正常
    return b.bossAt570.dying >= 1;
  });
  report.checks.bossCorpseClearedBy1130ms = keys.every((k) => {
    const b = report.battle[k];
    if (!b?.boss || !b.bossAt1130) return false;
    if (b.bossAt1130.node !== b.nodeBeforeKill) return true;
    return b.bossAt1130.dying === 0;
  });
  // 舰船不许竖着沉没：570ms 时倾角必须 ≤15°（人形则相反，早该倒下去了）。
  // 采样点选 570ms 而不是 150ms：Quad.easeIn 前段几乎不动，150ms 时人形才转 2°，
  // 用那个点判「有没有倒」会得到假阴性。
  report.checks.shipSinksWithoutRotating = CAMPAIGNS.filter((c) => c.ship).every((c) => {
    const s = report.battle[c.key]?.bossAt570;
    return !!s && Math.abs(s.angle) <= 15;
  });
  report.checks.humanFallsOver = CAMPAIGNS.filter((c) => !c.ship).every((c) => {
    const s = report.battle[c.key]?.bossAt570;
    return !!s && Math.abs(s.angle) >= 8;
  });
  report.checks.shipBossUsesShipArt = CAMPAIGNS.filter((c) => c.ship).every((c) => {
    const bs = report.battle[c.key]?.boss;
    return !!bs && bs.isShip === true && String(bs.shipKey ?? '').startsWith('ship_');
  });
  // 弱者对照：不能跟 Boss 一个厚度，不能有甲
  report.checks.foesAreThin = keys.every((k) => {
    const f = report.battle[k]?.foe;
    if (!f) return true; // 该场没刷出普通敌人就跳过
    return f.barH < 5 && f.armorLayers === 0 && f.hasAura === false;
  });
  // Boss 推镜结束后必须回到超采样倍数，不允许停在 1（会缩成左上角 1/R²）
  report.checks.cameraZoomRestoredAfterBoss = keys.every((k) => {
    const z = report.battle[k]?.zoomAfterBoss;
    return !!z && z.R > 1 && Math.abs(z.zoom - z.R) <= 0.02;
  });
  report.checks.noConsoleErrors = report.errors.length === 0;
  // ---------- v2.9 判定框 / 反击 ----------
  // 站着不动的玩家仍然会被近战兵砍到（防止「改了判定框之后谁都打不到」）
  report.checks.idlePlayerStillGetsHit = (() => {
    const b = report.battle.act1;
    return !!b?.idleHit && typeof b.idleHitAfter === 'number' && b.idleHitAfter < b.idleHit.hp0;
  })();
  // 精英挨打会还手：进入短前摇的 windup 且标记为反击
  report.checks.eliteCounterFires = (() => {
    const e = report.battle.act1?.eliteCounter;
    return !!e && e.countering === true && e.state === 'windup';
  })();
  // Boss 挨打会「催招」：招式计时器必须被清零
  report.checks.bossCounterAccelerates = keys.every(
    (k) => (report.battle[k]?.bossCounter?.after ?? -1) === 0,
  );
  report.failed = Object.entries(report.checks).filter(([, v]) => !v).map(([k]) => k);
  report.ok = report.failed.length === 0;
} catch (err) {
  report.fatal = String(err?.message ?? err);
} finally {
  try { ws?.close(); } catch { /* 已关闭 */ }
  try { edge.kill(); } catch { /* 已退出 */ }
  await sleep(300);
  if (server) server.close();
  try { await rm(profile, { recursive: true, force: true }); } catch { /* 清理失败不影响结果 */ }
}

await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
