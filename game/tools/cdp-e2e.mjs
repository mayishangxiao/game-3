/**
 * 主链路端到端验证（CDP 驱动一个真实的 headless Edge，不是 virtual-time）。
 *
 * 为什么不用 `--dump-dom`：那个模式下 requestAnimationFrame 被冻结，Phaser 的时钟不走，
 * 所有 delayedCall 都不触发，测不出真实行为。这里真实等待若干秒，让游戏循环真正跑起来。
 *
 * 覆盖：点击开始引导层 → 走廊 → 第一幕开场（对话/探索/战斗/掉落）→ 副本 dg01 两刷（保底计数）
 *      → 副本 dg02（含 Boss 结算）→ 装备（穿上/强化/拆解）→ 知识图谱（连错拒绝/连满/重启读回）
 *      → 走廊副本面板 → 第二幕经营节点冒烟。
 *
 * 用法: node tools/cdp-e2e.mjs <edgePath> <baseUrl> <outDir>
 *   例如: node tools/cdp-e2e.mjs "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
 *           http://127.0.0.1:4173 tools/_cdp
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';

const edge = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4173';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const port = 9341;

const errors = [];
let ws;
let msgId = 0;
const pending = new Map();

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
    const d = r.result.exceptionDetails;
    throw new Error('evaluate threw: ' + (d?.exception?.description ?? JSON.stringify(d)).slice(0, 500));
  }
  return r?.result?.result?.value;
}

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true;
    await sleep(200);
  }
  throw new Error(`等待超时: ${label}`);
}

async function shot(name) {
  try {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const b64 = r?.result?.data;
    if (b64) await writeFile(join(outDir, name), Buffer.from(b64, 'base64'));
  } catch {
    /* 截图失败不影响断言 */
  }
}

/** 只启动目标场景：game.scene.start() 是全局管理器，不会停掉调用者，必须自己停。
 *  注意 stop 与 start 不能挤在同一个 tick 里：Phaser 排在后面的 shutdown 会把新建的显示列表清空，
 *  表现为「场景 active、但 children 为空、字段还是上一轮的」。中间必须让出一帧以上。 */
async function gotoScene(key, data = {}) {
  const stopped = await evaluate(`
    (function () {
      var g = window.__dshGame;
      var done = [];
      ['Title', 'Hub', 'Level', 'UI', 'Equipment', 'Graph', 'Codex', 'Quiz'].forEach(function (k) {
        var s = g.scene.getScene(k);
        if (s && s.scene.isActive()) { g.scene.stop(k); done.push(k); }
      });
      return done;
    })()
  `);
  await sleep(stopped && stopped.length ? 450 : 60);
  await evaluate(`window.__dshGame.scene.start(${JSON.stringify(key)}, ${JSON.stringify(data)}), 'ok'`);
  await waitFor(
    async () => await evaluate(`(function () { var s = window.__dshGame.scene.getScene(${JSON.stringify(key)}); return !!(s && s.scene.isActive()); })()`),
    10000,
    key + ' 场景激活',
  );
  return stopped;
}

async function restartScene(key, data = {}) {
  await evaluate(`
    (function () {
      var g = window.__dshGame;
      var s = g.scene.getScene(${JSON.stringify(key)});
      if (s && s.scene.isActive()) g.scene.stop(${JSON.stringify(key)});
      return 'ok';
    })()
  `);
  await sleep(400);
  await gotoScene(key, data);
}

/** 反复把场上敌人打死，直到 predicate 成立；用于「一波一波清」的场景。 */
async function clearAll(timeoutMs, doneExpr) {
  const t0 = Date.now();
  let rounds = 0;
  while (Date.now() - t0 < timeoutMs) {
    const done = await evaluate(`(function () { try { return !!(${doneExpr}); } catch (e) { return false; } })()`);
    if (done) return { rounds, done: true };
    await evaluate(`
      (function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        lvl.enemies.slice().forEach(function (e) {
          if (e.takeDamage(1e6, false, lvl.cfg)) lvl.onEnemyDeath(e);
        });
        return lvl.enemies.length;
      })()
    `);
    rounds++;
    await sleep(700);
  }
  return { rounds, done: false };
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const proc = spawn(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--disable-features=HttpsUpgrades,HttpsFirstBalancedMode,HttpsFirstModeV2ForDesktop',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${join(outDir, 'profile')}`,
      '--window-size=960,540',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    await waitFor(
      async () => {
        try {
          return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
        } catch {
          return false;
        }
      },
      20000,
      'DevTools 端口',
    );

    let target;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(baseUrl + '/')}`, {
        method: 'PUT',
      });
      target = await r.json();
    } catch {
      const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(baseUrl + '/')}`);
      target = await r.json();
    }

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = (e) => rej(new Error('ws error ' + String(e?.message ?? e)));
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
        errors.push('exception: ' + (d?.exception?.description ?? d?.text ?? '').slice(0, 400));
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
        errors.push('console.error: ' + (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
      }
    };

    await send('Runtime.enable');
    await send('Page.enable');

    // 先把「这是一块触摸屏」告诉页面，再重载：Phaser 在启动时用 'ontouchstart' 判断
    // 该注册哪套输入监听，页面加载之后再开触摸模拟是没用的——指针永远不 down。
    // 后面第一幕那段「按在按钮上不该移动」的断言靠的就是这里。
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Page.reload');
    await sleep(1400);

    const report = { stages: {}, dungeon: {}, equipment: {}, graph: {}, hub: {}, act2: {} };

    // ---------- 0) 引导层 → 标题 ----------
    await waitFor(async () => await evaluate('!!window.__dshGame'), 15000, '__dshGame');
    await waitFor(async () => await evaluate("!!document.querySelector('#tap-gate')"), 10000, 'tap-gate');
    report.stages.gate = await evaluate(`
      (function () {
        var g = document.getElementById('tap-gate');
        var before = g ? g.className : null;
        if (g) g.click();
        return { classNameBefore: before, gateClassAfter: 'see-next', gateInstalled: !!window.__dshGate };
      })()
    `);
    await sleep(1200);
    report.stages.gate.afterTap = await evaluate(`
      (function () {
        var g = document.getElementById('tap-gate');
        return {
          gateHidden: !!g && g.classList.contains('hidden'),
          tapped: window.__dshGate ? window.__dshGate.tapped : null,
          rotated: window.__dshGate ? window.__dshGate.rotated : null,
          active: window.__dshGame.scene.scenes.filter(function (s) { return s.scene.isActive(); }).map(function (s) { return s.scene.key; })
        };
      })()
    `);

    // 清存档，从干净状态开始
    await evaluate("try { localStorage.removeItem('dsp_save_v1'); } catch (e) {} 'ok'");
    await evaluate("window.location.reload(); 'ok'");
    await sleep(3200);
    await waitFor(async () => await evaluate('!!window.__dshGame'), 15000, '__dshGame(2)');
    await evaluate("(() => { const g = document.getElementById('tap-gate'); if (g) g.click(); return true; })()");
    await sleep(1200);

    // ---------- 1) 走廊 ----------
    await gotoScene('Hub', { chapterId: 'ch00' });
    await sleep(1600);
    report.stages.hub = await evaluate(`
      (function () {
        var hub = window.__dshGame.scene.getScene('Hub');
        var texts = [];
        (function walk(o) {
          if (!o) return;
          if (typeof o.text === 'string') texts.push(o.text);
          if (o.list) o.list.forEach(walk);
        });
        (hub.children ? hub.children.list : []).forEach(function (o) {
          (function walk(node) {
            if (!node) return;
            if (typeof node.text === 'string') texts.push(node.text);
            if (node.list) node.list.forEach(walk);
          })(o);
        });
        return {
          active: hub.scene.isActive(),
          doors: hub.doors ? hub.doors.length : null,
          cursor: hub.cursor,
          hasDungeonPanel: texts.some(function (t) { return t.indexOf('副本') >= 0; }),
          bottomBar: texts.filter(function (t) { return /^(图鉴|装备|图谱|测验)$/.test(t); })
        };
      })()
    `);
    await shot('screenshot-hub.png');

    // ---------- 2) 第一幕：战斗节点（nd_1841_humen_battle，索引 2） ----------
    await gotoScene('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 });
    await sleep(2600);

    // 这一节点带开场情境卡（banner）：卡片开着时世界冻结、操控也收起来了，
    // 必须先点掉卡片、读完关天培那句对白，才会真正开打。
    const introCard = await evaluate(`
      (function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        return { open: !!lvl.introOpen, hasTap: typeof lvl.pendingCardTap === 'function' };
      })()
    `);
    for (let i = 0; i < 6 && (await evaluate("!!window.__dshGame.scene.getScene('Level').introOpen")); i++) {
      await evaluate("(function(){var l=window.__dshGame.scene.getScene('Level'); if (l.pendingCardTap) l.pendingCardTap(); return 1;})()");
      await sleep(400);
    }
    await sleep(400);

    let advances = 0;
    while ((await evaluate("window.__dshGame.scene.getScene('Level').dialogue.isActive")) && advances < 30) {
      await evaluate("window.__dshGame.scene.getScene('Level').dialogue.advance(); 1");
      advances++;
      await sleep(160);
    }
    report.stages.act1 = await evaluate(`
      (function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        return {
          mode: lvl.mode,
          nodeId: lvl.node && lvl.node.id,
          mapId: lvl.map && lvl.map.def.id,
          worldObjects: lvl.worldObjects.length,
          enemies: lvl.enemies.length,
          playerLevel: lvl.save.player.level,
          knowledge: lvl.save.knowledge.length,
          uiActive: window.__dshGame.scene.getScene('UI').scene.isActive()
        };
      })()
    `);
    report.stages.act1.dialogueAdvances = advances;
    report.stages.act1.introCard = introCard;

    // 敌人主动进攻：玩家不动，远处的敌人也该自己压上来（用户反馈「不靠近敌人敌人就不动」）
    report.stages.act1.aggroBefore = await evaluate(`
      (function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        var alive = lvl.enemies.filter(function (e) { return e.alive; });
        if (!alive.length) return { skipped: true };
        var best = alive[0];
        var bd = -1;
        alive.forEach(function (e) {
          var d = Math.hypot(e.x - lvl.player.x, e.y - lvl.player.y);
          if (d > bd) { bd = d; best = e; }
        });
        window.__aggroId = best.def.id;
        return { id: best.def.id, state: best.state, dist: Math.round(bd) };
      })()
    `);
    await sleep(1500);
    report.stages.act1.aggroAfter = await evaluate(`
      (function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        var e = lvl.enemies.filter(function (x) { return x.alive && x.def.id === window.__aggroId; })[0];
        if (!e) return { skipped: true };
        var d = Math.hypot(e.x - lvl.player.x, e.y - lvl.player.y);
        return { id: e.def.id, state: e.state, dist: Math.round(d) };
      })()
    `);

    // 打一刀，确认伤害链路（takeDamage → onEnemyDeath）是通的
    report.stages.act1.melee = await evaluate(`
      (function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        var e = lvl.enemies.filter(function (x) { return x.alive; })[0];
        if (!e) return { skipped: true };
        var before = e.hp;
        lvl.player.rig.setFacing('right');
        lvl.player.rig.setPosition(e.x - 18, e.y);
        lvl.playerAttack();
        return { before: before, after: e.hp, damage: before - e.hp, weapon: lvl.player.weapon.id };
      })()
    `);
    await sleep(600);
    await shot('screenshot-act1.png');

    // 自动瞄准：故意背对敌人站着，攻击仍然要打到它（玩家反馈「攻击朝着走的方向挥」）
    report.stages.act1.autoAim = await evaluate(`
      (function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        var e = lvl.enemies.filter(function (x) { return x.alive; })[0];
        if (!e) return { skipped: true };
        lvl.player.rig.setPosition(e.x - 20, e.y);
        lvl.player.rig.setFacing('left'); // 背对敌人
        lvl.player.attackCd = 0;
        var before = e.hp;
        var facingBefore = lvl.player.rig.currentFacing;
        lvl.playerAttack();
        // 命中方向按「最近的敌人」定：站到目标左侧 20px 后，最近的也可能是别的敌人，
        // 所以断言不是写死 'right'，而是「朝向必须指向当时最近的敌人」。
        var near = null;
        var nd = Infinity;
        lvl.enemies.forEach(function (x) {
          if (!x.alive) return;
          var d = Math.hypot(x.x - lvl.player.rig.x, x.y - lvl.player.rig.y);
          if (d < nd) { nd = d; near = x; }
        });
        var expect = 'right';
        if (near) {
          var dx = near.x - lvl.player.rig.x;
          var dy = near.y - lvl.player.rig.y;
          expect = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up');
        }
        return {
          before: before,
          after: e.hp,
          damage: before - e.hp,
          facingBefore: facingBefore,
          facingAfter: lvl.player.rig.currentFacing,
          expectFacing: expect,
          ok: before - e.hp > 0 && lvl.player.rig.currentFacing === expect
        };
      })()
    `);

    // 触摸隔离：手指落在「查」「攻」这类按钮上时，一抖不能让角色跟着走；
    // 只有按在摇杆圈里的手指才驱动移动。（用户实测「点查变成移动、查点不了」）
    const tGeom = await evaluate(`
      (function () {
        var r = window.__dshGame.canvas.getBoundingClientRect();
        return { left: r.left, top: r.top, s: r.width / 480 };
      })()
    `);
    const at = (gx, gy) => ({ x: tGeom.left + gx * tGeom.s, y: tGeom.top + gy * tGeom.s });
    const touch = (type, pts) =>
      send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })),
      });
    const levelState = () =>
      evaluate(`
        (function () {
          var l = window.__dshGame.scene.getScene('Level');
          var ui = window.__dshGame.scene.getScene('UI');
          var p = window.__dshGame.input.activePointer;
          return {
            mx: Math.round(window.__dshControls.moveX * 100) / 100,
            my: Math.round(window.__dshControls.moveY * 100) / 100,
            x: Math.round(l.player.x),
            y: Math.round(l.player.y),
            shown: ui && ui.inputSystem ? ui.inputSystem.shown : null,
            mode: l.mode,
            ptr: { x: Math.round(p.x), y: Math.round(p.y), down: p.isDown, id: p.id }
          };
        })()
      `);

    // 1) 在对准「查」的位置按下并横向拖动
    await evaluate("(function(){ window.__dshGame.scene.getScene('Level').player.rig.setPosition(240,150); return 1; })()");
    await sleep(120);
    const beforeBtn = await levelState();
    await touch('touchStart', [at(240, 240)]);
    await sleep(60);
    await touch('touchMove', [at(276, 240)]);
    await sleep(80);
    await touch('touchMove', [at(300, 244)]);
    await sleep(260);
    const afterBtn = await levelState();
    await touch('touchEnd', []);
    await sleep(140);

    // 2) 按在摇杆圈里再拖：这时才该有移动向量
    await touch('touchStart', [at(56, 200)]);
    await sleep(60);
    await touch('touchMove', [at(88, 200)]);
    await sleep(260);
    const onStick = await levelState();
    await touch('touchEnd', []);
    await sleep(160);
    const afterStick = await levelState();

    report.stages.act1.touch = { beforeBtn, afterBtn, onStick, afterStick };
    report.stages.act1.touch.ok =
      afterBtn.mx === 0 && afterBtn.my === 0 && afterBtn.x === beforeBtn.x && afterBtn.y === beforeBtn.y &&
      onStick.mx > 0.3 &&
      afterStick.mx === 0;

    // 3) 单指点击「攻 / 炮 / 闪」：每个都必须真的驱动角色。
    //    这里守的是一个真实事故：一格时间戳错位会让触屏单点在被读到之前就被清掉，
    //    表现成「按住摇杆再按攻能打，单点攻毫无反应」，而摇杆一切正常。
    const cdState = () =>
      evaluate(`
        (function () {
          var p = window.__dshGame.scene.getScene('Level').player;
          return {
            attackCd: Math.round(p.attackCd),
            dodgeCd: Math.round(p.dodgeCd),
            cannonCd: Math.round(p.cannonCd || 0),
            cannonVisible: (function () {
              try { return window.__dshGame.scene.getScene('UI').controlsCannonShown(); } catch (e) { return null; }
            })(),
            x: Math.round(p.x),
            y: Math.round(p.y)
          };
        })()
      `);
    const resetCd = () =>
      evaluate("(function(){var p=window.__dshGame.scene.getScene('Level').player;p.attackCd=0;p.dodgeCd=0;return 1;})()");
    const tapKey = async (gx, gy) => {
      await resetCd();
      await touch('touchStart', [at(gx, gy)]);
      await sleep(110);
      const st = await cdState();
      await touch('touchEnd', []);
      await sleep(340);
      return st;
    };
    // 按钮位置不硬编码：加一个键就会重排（加「炮」那次就把「技」从 336,232 挪到 300,200，
    // 旧坐标正好落进「炮」的命中区，于是断言看起来像「技失灵」）
    // 「技」键已按甲方要求删除；炮键只在战斗幕出现（本轮新增断言）
    const layout = await evaluate(
      "(function(){var L=window.__dshLayout;return L?{a:{x:L.attack.x,y:L.attack.y},c:{x:L.cannon.x,y:L.cannon.y},d:{x:L.dodge.x,y:L.dodge.y}}:null;})()",
    );
    const tapAttack = await tapKey(layout.a.x, layout.a.y);
    const tapDodge = await tapKey(layout.d.x, layout.d.y);
    report.stages.act1.buttons = { tapAttack, tapDodge };
    report.stages.act1.buttons.ok =
      tapAttack.attackCd > 0 && tapDodge.dodgeCd > 0 && !('skillCd' in tapAttack);

    // 一路清场，直到这一节点结算
    report.stages.act1.clear = await clearAll(45000, "window.__dshGame.scene.getScene('Level').nodeBusy === false && window.__dshGame.scene.getScene('Level').enemies.filter(function(e){return e.alive;}).length === 0 && window.__dshGame.scene.getScene('Level').mode !== 'combat'");
    report.stages.act1.afterClear = await evaluate(`
      (function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        var raw = null;
        try { raw = localStorage.getItem('dsp_save_v1'); } catch (e) { raw = null; }
        var s = raw ? JSON.parse(raw) : null;
        return {
          mode: lvl.mode,
          nodeId: lvl.node && lvl.node.id,
          spawnedTotal: lvl.spawnedTotal,
          waveIndex: lvl.waveIndex,
          bagItems: s ? s.bag.items.length : null,
          nodesDone: s ? s.progress.nodes_done.length : null,
          achievements: s ? s.achievements.length : null
        };
      })()
    `);

    // ---------- 3) 副本 dg01：两刷看保底计数 ----------
    // 开副本要先通关两幕：这里直接把成就塞进存档，并补满知识，避免依赖主线跑完
    await gotoScene('Level', { actId: 'ch00_act1', chapterId: 'ch00', dungeonId: 'dg01_alley' });
    await sleep(2600);
    report.dungeon.seed = await evaluate(`
      (async function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        var s = lvl.save;
        ['act_cleared_ch00_act1', 'act_cleared_ch00_act2'].forEach(function (a) {
          if (s.achievements.indexOf(a) < 0) s.achievements.push(a);
        });
        s.player.level = 8;
        var kc = await (await fetch('data/knowledge/knowledge_all.json')).json();
        kc.cards.forEach(function (c) { if (s.knowledge.indexOf(c.id) < 0) s.knowledge.push(c.id); });
        var ev = await (await fetch('data/events/events_ch00.json')).json();
        ev.events.forEach(function (e) {
          if (s.progress.events.indexOf(e.id) < 0) s.progress.events.push(e.id);
        });
        return { level: s.player.level, knowledge: s.knowledge.length, events: s.progress.events.length };
      })()
    `);

    report.dungeon.enter = await evaluate(`
      (function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        return {
          mode: lvl.mode,
          dungeonId: lvl.dungeon && lvl.dungeon.id,
          mapId: lvl.map && lvl.map.def.id,
          enemyLevel: lvl.enemyLevel,
          waveIndex: lvl.waveIndex,
          waveCount: lvl.dungeon ? lvl.dungeon.waves.length + (lvl.dungeon.boss ? 1 : 0) : null
        };
      })()
    `);

    report.dungeon.clear1 = await clearAll(40000, "!!window.__dshGame.scene.getScene('Level').dungeonResultOpen");
    await sleep(800);
    report.dungeon.result1 = await evaluate(`
      (function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        var raw = JSON.parse(localStorage.getItem('dsp_save_v1') || '{}');
        var ui = window.__dshGame.scene.getScene('UI');
        return {
          resultOpen: !!lvl.dungeonResultOpen,
          controlsShown: ui.controlsShown ? ui.controlsShown() : null,
          dungeonState: raw.dungeons ? raw.dungeons.dg01_alley : null,
          scrap: raw.scrap,
          bagItems: raw.bag ? raw.bag.items.length : null,
          level: raw.player ? raw.player.level : null
        };
      })()
    `);
    await shot('screenshot-dungeon-result.png');

    // 再刷一次（结算面板上的「再刷一次」按钮走的就是 startDungeon）
    await evaluate("window.__dshGame.scene.getScene('Level').startDungeon(); 'ok'");
    await sleep(2600);
    report.dungeon.clear2 = await clearAll(40000, "!!window.__dshGame.scene.getScene('Level').dungeonResultOpen");
    await sleep(800);
    report.dungeon.result2 = await evaluate(`
      (function () {
        var raw = JSON.parse(localStorage.getItem('dsp_save_v1') || '{}');
        var ui = window.__dshGame.scene.getScene('UI');
        return {
          dungeonState: raw.dungeons ? raw.dungeons.dg01_alley : null,
          controlsShown: ui.controlsShown ? ui.controlsShown() : null,
          uniqueOwned: (raw.bag ? raw.bag.items : []).some(function (i) { return i.base_id === 'eq_acc_concession_blue_01'; })
        };
      })()
    `);

    // ---------- 4) 副本 dg02：含 Boss ----------
    await gotoScene('Level', { actId: 'ch00_act2', chapterId: 'ch00', dungeonId: 'dg02_bandit' });
    await sleep(2800);
    report.dungeon.bossEnter = await evaluate(`
      (function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        return {
          dungeonId: lvl.dungeon && lvl.dungeon.id,
          waveCount: lvl.dungeon ? lvl.dungeon.waves.length : null,
          hasBoss: !!(lvl.dungeon && lvl.dungeon.boss)
        };
      })()
    `);
    report.dungeon.bossClear = await clearAll(60000, "!!window.__dshGame.scene.getScene('Level').dungeonResultOpen");
    await sleep(800);
    report.dungeon.bossResult = await evaluate(`
      (function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        var raw = JSON.parse(localStorage.getItem('dsp_save_v1') || '{}');
        return {
          resultOpen: !!lvl.dungeonResultOpen,
          bossSpawned: !!lvl.bossSpawned,
          dungeonState: raw.dungeons ? raw.dungeons.dg02_bandit : null,
          uniqueOwned: (raw.bag ? raw.bag.items : []).some(function (i) { return i.base_id === 'eq_wp_dao_bandit_blue_01'; })
        };
      })()
    `);
    await shot('screenshot-dungeon-boss.png');

    // ---------- 5) 装备界面 ----------
    await gotoScene('Equipment', {});
    await sleep(1400);
    report.equipment.opened = await evaluate(`
      (function () {
        var sc = window.__dshGame.scene.getScene('Equipment');
        return { active: sc.scene.isActive(), items: sc.items().length, page: sc.page, cursor: sc.cursor };
      })()
    `);
    report.equipment.equip = await evaluate(`
      (function () {
        var sc = window.__dshGame.scene.getScene('Equipment');
        var raw0 = JSON.parse(localStorage.getItem('dsp_save_v1') || '{}');
        var before = sc.items().length;
        var slotsBefore = Object.keys(raw0.equipment).filter(function (k) { return !!raw0.equipment[k]; }).length;
        sc.equipSelected();
        var raw1 = JSON.parse(localStorage.getItem('dsp_save_v1') || '{}');
        var slotsAfter = Object.keys(raw1.equipment).filter(function (k) { return !!raw1.equipment[k]; }).length;
        return {
          bagBefore: before,
          bagAfter: sc.items().length,
          slotsBefore: slotsBefore,
          slotsAfter: slotsAfter,
          message: sc.message ? sc.message.text : null
        };
      })()
    `);
    report.equipment.enhance = await evaluate(`
      (function () {
        var sc = window.__dshGame.scene.getScene('Equipment');
        var raw0 = JSON.parse(localStorage.getItem('dsp_save_v1') || '{}');
        var scrapBefore = raw0.scrap;
        sc.equipSel = null;
        sc.cursor = 0;
        var target = sc.items()[0];
        var lvBefore = target ? target.enhance : null;
        var uid = target ? target.uid : null;
        sc.enhanceSelected();
        var raw1 = JSON.parse(localStorage.getItem('dsp_save_v1') || '{}');
        var after = (raw1.bag.items || []).filter(function (i) { return i.uid === uid; })[0];
        return {
          uid: uid,
          scrapBefore: scrapBefore,
          scrapAfter: raw1.scrap,
          levelBefore: lvBefore,
          levelAfter: after ? after.enhance : null,
          message: sc.message ? sc.message.text : null
        };
      })()
    `);
    report.equipment.salvage = await evaluate(`
      (function () {
        var sc = window.__dshGame.scene.getScene('Equipment');
        var raw0 = JSON.parse(localStorage.getItem('dsp_save_v1') || '{}');
        var bagBefore = sc.items().length;
        sc.cursor = sc.items().length - 1;
        sc.salvageSelected();
        var raw1 = JSON.parse(localStorage.getItem('dsp_save_v1') || '{}');
        return {
          bagBefore: bagBefore,
          bagAfter: sc.items().length,
          scrapBefore: raw0.scrap,
          scrapAfter: raw1.scrap,
          message: sc.message ? sc.message.text : null
        };
      })()
    `);
    await shot('screenshot-equipment.png');

    // ---------- 6) 知识图谱 ----------
    await gotoScene('Graph', {});
    await sleep(1600);
    report.graph.opened = await evaluate(`
      (function () {
        var sc = window.__dshGame.scene.getScene('Graph');
        var collected = sc.nodes.filter(function (n) { return n.collected; }).length;
        return {
          active: sc.scene.isActive(),
          nodes: sc.nodes.length,
          edges: sc.edges.length,
          collected: collected,
          accepted: sc.accepted.size,
          progress: sc.progressText ? sc.progressText.text : null
        };
      })()
    `);
    report.graph.invalid = await evaluate(`
      (function () {
        var sc = window.__dshGame.scene.getScene('Graph');
        var ids = sc.edges.map(function (e) { return e.a; }).concat(sc.edges.map(function (e) { return e.b; }));
        var uniq = ids.filter(function (v, i) { return ids.indexOf(v) === i; });
        var pair = null;
        for (var i = 0; i < uniq.length && !pair; i++) {
          for (var j = i + 1; j < uniq.length && !pair; j++) {
            var a = uniq[i], b = uniq[j];
            var key = a < b ? a + '|' + b : b + '|' + a;
            if (!sc.requiredKeys.has(key)) pair = [a, b];
          }
        }
        if (!pair) return { skipped: true };
        var before = sc.accepted.size;
        sc.pickNode(pair[0]);
        sc.pickNode(pair[1]);
        return { pair: pair, acceptedBefore: before, acceptedAfter: sc.accepted.size, hint: sc.hintText ? sc.hintText.text : null };
      })()
    `);
    await shot('screenshot-graph.png');

    report.graph.complete = await evaluate(`
      (function () {
        var sc = window.__dshGame.scene.getScene('Graph');
        var keys = Array.from(sc.requiredKeys);
        keys.forEach(function (k) { sc.accepted.add(k); });
        sc.redraw();
        sc.saveGraph();
        var raw = JSON.parse(localStorage.getItem('dsp_save_v1') || '{}');
        return {
          required: keys.length,
          accepted: sc.accepted.size,
          saved: raw.progress && raw.progress.graph ? raw.progress.graph.length : null,
          progress: sc.progressText ? sc.progressText.text : null,
          achievement: (raw.achievements || []).indexOf('graph_complete_ch00') >= 0
        };
      })()
    `);
    await shot('screenshot-graph-complete.png');

    await restartScene('Graph', {});
    await sleep(1800);
    report.graph.reload = await evaluate(`
      (function () {
        var sc = window.__dshGame.scene.getScene('Graph');
        return {
          acceptedFromSave: sc.accepted.size,
          progress: sc.progressText ? sc.progressText.text : null
        };
      })()
    `);

    // ---------- 7) 走廊：副本面板 ----------
    await gotoScene('Hub', { chapterId: 'ch00' });
    await sleep(1600);
    report.hub = await evaluate(`
      (function () {
        var hub = window.__dshGame.scene.getScene('Hub');
        // 底部入口与副本面板都是 DOM 层（HubScene 往 #dom-ui 塞 div），
        // 遍历 canvas children 永远拿不到 —— 2026-11 之前这段一直假报 []，
        // 因为探针写的时候它们还在 canvas 上。现在改成读 DOM 文本。
        var ui = document.getElementById('dom-ui');
        var html = ui ? ui.innerHTML : '';
        return {
          active: hub.scene.isActive(),
          hasDungeonTitle: html.indexOf('副本') >= 0,
          dungeonLabels: (html.match(/（[^）]*）/g) || []).slice(0, 8),
          bottomBar: ['图鉴', '装备', '图谱', '测验'].filter(function (t) { return html.indexOf(t) >= 0; })
        };
      })()
    `);
    await shot('screenshot-hub-dungeons.png');

    // ---------- 8) 第二幕经营节点冒烟（act2 的 nodes[1] = nd_1853_tianjing_manage） ----------
    await gotoScene('Level', { actId: 'ch00_act2', chapterId: 'ch00', startNode: 1 });
    await sleep(3000);
    report.act2.management = await evaluate(`
      (function () {
        var lvl = window.__dshGame.scene.getScene('Level');
        var texts = [];
        (lvl.children ? lvl.children.list : []).forEach(function (o) {
          (function walk(node) {
            if (!node) return;
            if (typeof node.text === 'string') texts.push(node.text);
            if (node.list) node.list.forEach(walk);
          })(o);
        });
        return {
          init: window.__dshGame.registry.get('levelInit'),
          mode: lvl.mode,
          nodeId: lvl.node && lvl.node.id,
          actId: lvl.act && lvl.act.id,
          hasManage: !!lvl.manage,
          month: lvl.manage ? lvl.manage.month : null,
          stock: lvl.manage ? lvl.manage.stock : null,
          hasUI: !!lvl.manageUI,
          alloc: lvl.manageAlloc,
          dialogActive: lvl.dialogue.isActive,
          texts: texts.slice(0, 14)
        };
      })()
    `);
    if (report.act2.management && report.act2.management.hasManage) {
      // 经营面板：先让开场对话走完，再找到「结算/下月」按钮，连点 8 个月
      let steps = 0;
      while (steps < 46) {
        steps++;
        const res = await evaluate(`
          (function () {
            var lvl = window.__dshGame.scene.getScene('Level');
            if (!lvl.manage) return { finished: true };
            if (lvl.dialogue && lvl.dialogue.isActive) { lvl.dialogue.advance(); return { dialog: true }; }
            var alloc = lvl.manageAlloc;
            var total = alloc.food + alloc.troops + alloc.morale;
            if (total !== 6) { lvl.adjust(1); return { adjusted: true, total: total }; }
            // 面板上的按钮：找交互 Rectangle，且离「结算/下月/确认」这类文字最近的那个
            var rects = [];
            var texts = [];
            (function walk(o) {
              if (!o) return;
              if (o.type === 'Rectangle' && o.input && o.input.enabled) rects.push(o);
              if (typeof o.text === 'string') texts.push(o);
              if (o.list) o.list.forEach(walk);
            })(lvl.manageUI);
            var key = texts.filter(function (t) { return /结算|下月|确认|继续/.test(t.text); })[0];
            if (!key) return { waiting: true, rects: rects.length, texts: texts.length };
            var best = null, bestD = 1e9;
            rects.forEach(function (r) {
              var d = Math.abs(r.x - key.x) + Math.abs(r.y - key.y);
              if (d < bestD) { bestD = d; best = r; }
            });
            if (best) { best.emit('pointerdown'); return { clicked: key.text, rects: rects.length }; }
            return { waiting: true, rects: rects.length };
          })()
        `);
        await sleep(500);
        const stage = await evaluate(`
          (function () {
            var lvl = window.__dshGame.scene.getScene('Level');
            return {
              month: lvl.manage ? lvl.manage.month : null,
              history: lvl.manage ? lvl.manage.history.length : null,
              mode: lvl.mode,
              step: ${steps}
            };
          })()
        `);
        report.act2.lastMonth = stage;
        report.act2.lastAction = res;
        if (stage && stage.history >= 8) break;
        if (res && res.finished) break;
      }
      report.act2.settle = await evaluate(`
        (function () {
          var lvl = window.__dshGame.scene.getScene('Level');
          return {
            month: lvl.manage ? lvl.manage.month : null,
            history: lvl.manage ? lvl.manage.history.length : null,
            verdict: lvl.manage && lvl.manage.history.length ? lvl.manage.history[lvl.manage.history.length - 1].golden : null,
            stockAfter: lvl.manage && lvl.manage.history.length ? lvl.manage.history[lvl.manage.history.length - 1].stockAfter : null,
            mode: lvl.mode
          };
        })()
      `);
    }
    await shot('screenshot-act2.png');

    report.finalErrors = errors;
    await writeFile(join(outDir, 'cdp-e2e.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error('CDP E2E FAILED:', e?.message ?? e);
  console.error('collected errors:', JSON.stringify(errors, null, 2));
  process.exit(1);
});