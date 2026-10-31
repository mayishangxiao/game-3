/**
 * 专项检查：走真实入口（Title.startGame）时，TitleScene 是否被正确停止，
 * 以及 Enter 键是否会同时在 Title 与 Hub 上触发（键盘处理器冲突）。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';

const edge = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4173';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const port = 9334;

let ws;
let msgId = 0;
const pending = new Map();
const errors = [];

function send(method, params = {}) {
  return new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r?.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r?.result?.result?.value;
}

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(200);
  }
  throw new Error('timeout: ' + label);
}

const proc = spawn(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(outDir, 'profile2')}`,
    '--window-size=960,540',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

try {
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
    } catch {
      return false;
    }
  }, 20000, 'devtools');

  let target;
  try {
    target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(baseUrl + '/')}`, { method: 'PUT' })).json();
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
      errors.push(String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 300));
    }
  };

  await send('Runtime.enable');
  await send('Page.enable');

  await waitFor(async () => await evaluate('!!window.__dshGame'), 15000, 'game');
  await sleep(2500);

  const before = await evaluate(`
    (function(){ var g=window.__dshGame;
      return { active: g.scene.scenes.filter(function(s){return s.scene.isActive();}).map(function(s){return s.scene.key;}) }; })()
  `);

  // 调用标题画面上「开始 / 继续」按钮实际调用的方法
  await evaluate("window.__dshGame.scene.getScene('Title').startGame(false); 'ok'");
  await sleep(2200);

  const after = await evaluate(`
    (function(){ var g=window.__dshGame;
      var t = g.scene.getScene('Title');
      var hub = g.scene.getScene('Hub');
      return {
        active: g.scene.scenes.filter(function(s){return s.scene.isActive();}).map(function(s){return s.scene.key;}),
        titleActive: t.scene.isActive(),
        hubActive: hub.scene.isActive(),
        hubDoors: hub.doors ? hub.doors.length : null,
        titleKeyListeners: t.input && t.input.keyboard ? t.input.keyboard.listenerCount('keydown-ENTER') : null,
        hubKeyListeners: hub.input && hub.input.keyboard ? hub.input.keyboard.listenerCount('keydown-ENTER') : null
      }; })()
  `);

  // Enter 键只应触发一次（进入第 1 幕）
  await evaluate(`
    (function(){
      var g = window.__dshGame;
      var hub = g.scene.getScene('Hub');
      hub.input.keyboard.emit('keydown-ENTER');
      return 1;
    })()
  `);
  await sleep(2500);
  const afterEnter = await evaluate(`
    (function(){ var g=window.__dshGame;
      return {
        active: g.scene.scenes.filter(function(s){return s.scene.isActive();}).map(function(s){return s.scene.key;}),
        levelNode: g.scene.getScene('Level').node ? g.scene.getScene('Level').node.id : null
      }; })()
  `);

  console.log(JSON.stringify({ errors, before, after, afterEnter }, null, 2));
} finally {
  try {
    proc.kill();
  } catch {
    /* ignore */
  }
}