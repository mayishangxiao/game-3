// 开炮提示文案专项探针（v1.7.1）：炮键在虎门、天京、副本都能按，
// 开炮后的 toast 必须按战场区分——虎门保留「虎门重炮！」，其它战场一律「重炮！」。
//
// 为什么要跑真浏览器：纯函数单测只能证明 `cannonDisplayName()` 算得对，
// 证明不了「LevelScene 拿到的 act/node/dungeon 真的是我以为的那个」——
// 副本不加载幕（this.act 是上一关残留值），正是最容易串错名字的地方。
//
// 用法：
//   node tools/_cdp/cannon-label.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
// 传本地目录（默认 dist）时自带静态服务，不依赖常驻预览进程；传 http(s):// 则直连。
// 输出 <outDir>/cannon-label.json + 每个战场一张开炮实拍。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const CDP_PORT = 9424;
const HTTP_PORT = 9423;
const profile = join(outDir, '_profile-cannon-label');

if (!edgePath) {
  console.error('usage: node tools/_cdp/cannon-label.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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

const report = { url: baseUrl, scenes: [], checks: {}, errors: [] };

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
      throw new Error(`EVAL FAILED: ${text}`);
    }
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(join(outDir, name), Buffer.from(r.data, 'base64'));
  };

  /** 从引导层 → 标题页 → 指定关卡；每次都重新导航，避免上一关状态串味 */
  async function enterLevel(init) {
    await send('Page.navigate', { url: baseUrl });
    await sleep(600);
    await waitFor(() => evaluate('!!window.__dshGate'), 30000, 'gate');
    await evaluate(`(() => {
      const g = document.getElementById('tap-gate');
      const b = g && g.querySelector('.tg-go');
      if (b) b.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
      return true;
    })()`);
    await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 30000, 'title');
    await sleep(500);
    await evaluate(`(() => {
      window.__dshGame.scene.getScene('Title').scene.start('Level', ${JSON.stringify(init)});
      return true;
    })()`);
    await waitFor(
      () => evaluate(`!!window.__dshLevel && !!window.__dshGame.scene.getScene('Level').map`),
      30000,
      'level map',
    );
    await sleep(1200);
    // 开场情境卡 / 对白会挡住战场，先点掉（与 cannon-fx.mjs 同一套处理）
    for (let i = 0; i < 8 && (await evaluate(`!!window.__dshGame.scene.getScene('Level').introOpen`)); i++) {
      await evaluate(`(function(){var l=window.__dshGame.scene.getScene('Level'); if (l.pendingCardTap) l.pendingCardTap(); return 1;})()`);
      await sleep(300);
    }
    for (let i = 0; i < 30 && (await evaluate(`!!window.__dshGame.scene.getScene('Level').dialogue.isActive`)); i++) {
      await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance(); 1`);
      await sleep(140);
    }
    await waitFor(() => evaluate('window.__dshLevel.allEnemies().length > 0'), 25000, 'enemies');
  }

  /** 把玩家挪到敌人旁边、清冷却、开一炮，立刻读 toast（DOM 层，同步更新） */
  const FIRE = `(() => {
    const L = window.__dshGame.scene.getScene('Level');
    const M = window.__dshLevel.map();
    const E = window.__dshLevel.enemies();
    if (!E.length) return { ok: false, why: 'no enemies' };
    const e = E[0];
    const px = Math.max(24, Math.min(M.w - 24, e.x - 44));
    const py = Math.max(24, Math.min(M.h - 24, e.y));
    L.player.x = px; L.player.y = py;
    if (L.player.rig) L.player.rig.setPosition(px, py);
    L.cannonCd = 0;
    // 炸膛（10%）会换一句 toast，固定随机数让这一炮必定正常击发
    const orig = Math.random;
    Math.random = () => 0.99;
    try { L.fireCannon(); } finally { Math.random = orig; }
    const t = document.getElementById('dom-toast');
    const cs = t ? getComputedStyle(t) : null;
    return {
      ok: true,
      toast: t ? t.textContent : '',
      display: t ? t.style.display : '',
      style: cs ? { left: cs.left, top: cs.top, transform: cs.transform,
                     fontSize: cs.fontSize, background: cs.backgroundColor, color: cs.color } : null,
      cdAfter: L.cannonCd,
      actId: L.act && L.act.id ? L.act.id : null,
      nodeId: L.node && L.node.id ? L.node.id : null,
      dungeon: !!L.dungeon,
      mode: L.mode,
    };
  })()`;

  /** 冷却中再按一次炮：不给开炮，但要显示「XX冷却中 N 秒」 */
  const COOLDOWN = `(() => {
    const L = window.__dshGame.scene.getScene('Level');
    L.fireCannon();
    const t = document.getElementById('dom-toast');
    return { toast: t ? t.textContent : '', cdAfter: L.cannonCd };
  })()`;

  const scenes = [
    {
      key: 'humen',
      name: '虎门炮台守卫战',
      init: { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 },
      expect: '虎门重炮！',
      expectCooldown: '虎门重炮冷却中',
      humen: true,
    },
    {
      key: 'tianjing',
      name: '天京陷落',
      init: { actId: 'ch00_act2', chapterId: 'ch00', startNode: 3 },
      expect: '重炮！',
      expectCooldown: '重炮冷却中',
      humen: false,
    },
    {
      key: 'dg01',
      name: '副本·租界暗巷',
      init: { actId: 'ch00_act1', chapterId: 'ch00', dungeonId: 'dg01_alley' },
      expect: '重炮！',
      expectCooldown: '重炮冷却中',
      humen: false,
    },
    {
      key: 'dg02',
      name: '副本·山匪寨',
      init: { actId: 'ch00_act2', chapterId: 'ch00', dungeonId: 'dg02_bandit' },
      expect: '重炮！',
      expectCooldown: '重炮冷却中',
      humen: false,
    },
    {
      key: 'dg03',
      name: '副本·码头攻坚',
      init: { actId: 'ch00_act2', chapterId: 'ch00', dungeonId: 'dg03_dock' },
      expect: '重炮！',
      expectCooldown: '重炮冷却中',
      humen: false,
    },
  ];

  for (const s of scenes) {
    const entry = { key: s.key, name: s.name, init: s.init, expect: s.expect };
    try {
      if (s.init.dungeonId) {
        // 副本不加载幕，this.act 是上一关的残留值（真实流程：长廊 → 副本）。
        // 先走一遍虎门关让 act 有值，再切副本，才能验证「带 act1 残留也不串名字」。
        await enterLevel({ actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 });
        await evaluate(`(() => {
          window.__dshGame.scene.getScene('Level').scene.start('Level', ${JSON.stringify(s.init)});
          return true;
        })()`);
        await waitFor(
          () => evaluate(`!!window.__dshGame.scene.getScene('Level').dungeon && !!window.__dshLevel.map()`),
          30000,
          'dungeon map',
        );
        await sleep(1200);
        // v1.8.7：副本开场对白读完才放第一波，先把台词推进完再等敌人。
        for (let i=0;i<40;i++){
          const active = await evaluate(`!!window.__dshGame.scene.getScene('Level').dialogue?.isActive`);
          if (!active) break;
          await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance()`);
          await sleep(120);
        }
        await waitFor(() => evaluate('window.__dshLevel.allEnemies().length > 0'), 25000, 'dungeon enemies');
      } else {
        await enterLevel(s.init);
      }

      entry.fired = await evaluate(FIRE);
      await shot(`${s.key}-cannon-toast.png`);
      entry.cooldown = await evaluate(COOLDOWN);
      entry.labelOk = entry.fired?.toast === s.expect;
      entry.noHumenOnOtherField = s.humen ? true : !String(entry.fired?.toast ?? '').includes('虎门');
      entry.cooldownOk =
        String(entry.cooldown?.toast ?? '').startsWith(s.expectCooldown) &&
        (s.humen || !String(entry.cooldown?.toast ?? '').includes('虎门'));
      entry.cooldownStillOn = (entry.cooldown?.cdAfter ?? 0) > 0;
      entry.toastVisible = entry.fired?.display === 'block';
      entry.modeCombat = entry.fired?.mode === 'combat';
      report.checks[`${s.key}_label`] = entry.labelOk;
      report.checks[`${s.key}_noHumenWhenAway`] = entry.noHumenOnOtherField;
      report.checks[`${s.key}_cooldownLabel`] = entry.cooldownOk;
      report.checks[`${s.key}_cooldownStillOn`] = entry.cooldownStillOn;
      report.checks[`${s.key}_toastVisible`] = entry.toastVisible;
      report.checks[`${s.key}_modeCombat`] = entry.modeCombat;
      report.scenes.push(entry);
    } catch (e) {
      entry.fatal = String(e && e.message ? e.message : e);
      report.scenes.push(entry);
      report.checks[`${s.key}_sceneReady`] = false;
      console.log(`SCENE ${s.key} FAILED:`, entry.fatal);
    }
  }

  // 显示位置/样式在五个战场完全一致：证明只换了字符串，没动 DOM 样式。
  // 例外：`transform` 的 translateX 是 toast 自身宽度的 -50%，文字变短（虎门重炮！→重炮！）
  // 时必然从 -53px 变成 -35px，这不是样式改动，比较时要把这一项排除。
  const invariantStyle = (s) => {
    const st = s.fired?.style;
    if (!st) return null;
    return JSON.stringify({
      left: st.left,
      top: st.top,
      fontSize: st.fontSize,
      background: st.background,
      color: st.color,
    });
  };
  const styles = report.scenes.map(invariantStyle);
  report.checks.toastStyleUnchangedAcrossScenes =
    styles.length === scenes.length && styles.every((v) => v && v === styles[0]);
  report.checks.toastCenteringScalesWithText =
    report.scenes.length === scenes.length &&
    report.scenes.every((s) => /^matrix\(1, 0, 0, 1, -\d/.test(s.fired?.style?.transform ?? ''));
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
  await writeFile(join(outDir, 'cannon-label.json'), JSON.stringify(report, null, 2), 'utf8');
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
