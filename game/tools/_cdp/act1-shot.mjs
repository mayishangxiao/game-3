/**
 * 一次性小工具：把第一幕两张图（act1a 销烟池 / act1b 威远炮台）各拍一张大图，
 * 用于人工评审「空气墙是否清干净、布景有没有浮空、观众是否已去掉」。
 * 不是正式探针（没有断言），产物在 <outDir>/*.png。
 *
 * 用法：node tools/_cdp/act1-shot.mjs "<edgePath>" "<baseUrl>" <outDir>
 * 端口 9413。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const [edgePath, baseUrl, outDirArg] = process.argv.slice(2);
const outDir = resolve(outDirArg ?? 'tools/_cdp-props');
const profile = join(tmpdir(), `dsh-act1-${process.pid}`);
const PORT = 9413;
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(
  edgePath,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=960,540', '--no-first-run', '--disable-gpu', 'about:blank'],
  { stdio: 'ignore' },
);

const results = {};
try {
  let list = null;
  for (let i = 0; i < 80 && !list; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) list = await r.json();
    } catch {
      /* 等浏览器起 */
    }
    if (!list) await sleep(150);
  }
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      const { res, rej } = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      waiting.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };
  const shot = async (name) => {
    await ev('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');
    const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    writeFileSync(join(outDir, name), Buffer.from(data, 'base64'));
  };
  // 点掉开场引导层（DOM 遮罩，不点的话游戏冻结在标题）
  const tapGate = () =>
    ev(
      "(function(){const g=document.getElementById('tap-gate'); if(!g) return false; const b=g.querySelector('button')||g; b.click(); g.click(); g.style.display='none'; return true;})()",
    );
  // 清掉开局的全部闸门：DOM 遮罩 → 开场情境卡（`tapCard()`）→ 旁白对话（`dialogue.advance()`）。
  // 抄自 `tools/_cdp/parts.mjs` 的 settleIntro：卡片和对话一帧只会关一层，必须循环到连续 6 帧全静为止。
  const settleIntro = async (label) => {
    let idle = 0;
    for (let i = 0; i < 160; i++) {
      const s = await ev(`(function(){
        var l = window.__dshGame.scene.getScene('Level');
        if (!l || !l.scene.isActive()) return null;
        return { intro: !!l.introOpen, card: !!l.pendingCardTap,
                 dlg: !!(l.dialogue && l.dialogue.visible),
                 dlgActive: !!(l.dialogue && l.dialogue.isActive),
                 mode: l.mode, trans: !!l.transitioning };
      })()`);
      if (!s) {
        await sleep(150);
        continue;
      }
      if (s.intro || s.card) {
        idle = 0;
        await ev(`(function(){var l=window.__dshGame.scene.getScene('Level');l.tapCard();return 1;})()`);
        await sleep(160);
        continue;
      }
      if (s.dlgActive || s.dlg) {
        idle = 0;
        await ev(`(function(){var l=window.__dshGame.scene.getScene('Level');l.dialogue.advance();return 1;})()`);
        await sleep(130);
        continue;
      }
      idle += 1;
      if (idle >= 6 && !s.trans) return `${label}:mode=${s.mode}`;
      await sleep(130);
    }
    return `${label}:timeout`;
  };
  const enter = async (key, actId, startNode) =>
    ev(`(async () => {
      const game = window.__dshGame;
      for (const s of game.scene.getScenes(true)) if (s.sys.settings.key !== '${key}') game.scene.stop(s.sys.settings.key);
      game.scene.start('${key}', { chapterId: 'ch00', actId: '${actId}', startNode: ${startNode} });
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (window.__dshLevel && window.__dshLevel.props) break;
      }
      return !!window.__dshLevel;
    })()`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: baseUrl });
  for (let i = 0; i < 120; i++) {
    if (await ev('!!window.__dshGame')) break;
    await sleep(250);
  }
  await tapGate();
  await sleep(800);

  // 1a：销烟池现场
  results.act1a = await enter('Level', 'ch00_act1', 0);
  await sleep(1200);
  await tapGate();
  results.mode1a = await settleIntro('act1a');
  await sleep(300);
  await shot('s1-act1a.png');
  // 相机：从 <Level> 这个场景实例上取（`__dshLevel` 是调试钩子对象，没有 cameras）
  results.pan1a = await ev(`(() => {
    const game = window.__dshGame;
    const lvl = game.scene.getScene('Level');
    if (!lvl || !lvl.cameras) return 'no scene';
    const cam = lvl.cameras.main; cam.stopFollow(); cam.setScroll(220, 40); return [cam.scrollX, cam.scrollY];
  })()`);
  await sleep(500);
  await shot('s2-act1a-pan.png');

  // 1b：威远炮台
  results.act1b = await enter('Level', 'ch00_act1', 2);
  await sleep(1200);
  await tapGate();
  results.mode1b = await settleIntro('act1b');
  await sleep(300);
  await shot('s3-act1b.png');
  results.pan1b = await ev(`(() => {
    const game = window.__dshGame;
    const lvl = game.scene.getScene('Level');
    if (!lvl || !lvl.cameras) return 'no scene';
    const cam = lvl.cameras.main; cam.stopFollow(); cam.setScroll(180, 20); return [cam.scrollX, cam.scrollY];
  })()`);
  await sleep(500);
  await shot('s4-act1b-pan.png');
  ws.close();
} catch (e) {
  results.error = String(e && e.stack ? e.stack : e);
} finally {
  try {
    edge.kill();
  } catch {
    /* 已退出 */
  }
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}
console.log(JSON.stringify(results, null, 2));
process.exit(0);