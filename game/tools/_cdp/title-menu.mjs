/**
 * Title menu probe (ASCII only): 继续 / 重新开始 must do the right thing with saves.
 *
 * Why this probe exists: two bugs shipped that no unit test caught, because both
 * live in the wiring between TitleScene, the save module and localStorage:
 *   1) 「重新开始」 called saveManager.reset() and then scene.restart() — the title
 *      redrew, so nothing visibly changed: it looked like a dead button.
 *   2) reset() only wrote localStorage, but BootScene keeps its own SAVE object, so
 *      the next persist() wrote the old progress straight back. A "restart" that
 *      keeps the old progress is a restart that does nothing.
 *
 * The probe seeds a save (章 = ch00, 幕 = ch00_act2, 等级 7), reloads, then:
 *   1) 「继续」    -> Hub opens with the SAVED chapter/act, save untouched
 *   2) 「重新开始」-> progress wiped to defaults, title still shown (not a dead click)
 *   3) 「开始」    -> new game really starts a fresh save at act 1, nothing comes back
 *
 * Usage: node tools/_cdp/title-menu.mjs <edgePath> <baseUrl> <outDir>
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';

const edge = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:4173';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/title-menu');
const port = Number(process.env.PROBE_PORT ?? 9398);

// 与 src/core/constants.ts 的 SAVE_KEY 一致
const SAVE_KEY = 'dsp_save_v1';

const errors = [];
const report = { steps: [], shots: [] };
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
  const d = r?.result?.exceptionDetails;
  if (d) {
    const text = String(d?.exception?.description ?? d?.text ?? '').slice(0, 400);
    console.log('EVAL FAILED:', text, '| expr head:', expression.slice(0, 80));
    throw new Error('evaluate threw: ' + text.slice(0, 240));
  }
  return r?.result?.result?.value;
}

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true;
    await sleep(200);
  }
  throw new Error('timeout: ' + label);
}

async function shot(name) {
  await evaluate(
    'new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(1); }); }); })',
  );
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const b64 = r?.result?.data;
  if (b64) await writeFile(join(outDir, name), Buffer.from(b64, 'base64'));
  report.shots.push(name);
}

/** 页面上看到的状态：标题按钮、存档内容、当前场景 */
const probe = `(function () {
  var t = window.__dshTitle || null;
  var g = window.__dshGame || null;
  var raw = null;
  try { raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)}); } catch (e) { raw = 'ERR'; }
  var s = null;
  try { s = raw ? JSON.parse(raw) : null; } catch (e) { s = 'PARSE_ERR'; }
  return {
    titleActive: !!(g && g.scene && g.scene.isActive('Title')),
    hubActive: !!(g && g.scene && g.scene.isActive('Hub')),
    levelActive: !!(g && g.scene && g.scene.isActive('Level')),
    buttons: t && t.list ? t.list().map(function (b) { return b.label; }) : null,
    save: s && typeof s === 'object' ? {
      chapter: s.progress ? s.progress.chapter : null,
      act: s.progress ? s.progress.act : null,
      level: s.player ? s.player.level : null,
      scrap: s.scrap,
      achievements: s.achievements ? s.achievements.length : null
    } : s
  };
})()`;

/** 点标题上的第 i 个按钮：用场景里的真实对象触发出 pointerdown（等同手指按下） */
async function pressTitleButton(label) {
  return await evaluate(
    `(function () {
       var t = window.__dshTitle;
       if (!t) return { error: 'no title api' };
       var list = t.list();
       var idx = -1;
       for (var i = 0; i < list.length; i++) if (list[i].label === ${JSON.stringify(label)}) idx = i;
       if (idx < 0) return { error: 'no button ' + ${JSON.stringify(label)}, have: list.map(function (b) { return b.label; }) };
       var ok = t.press(idx);
       return { pressed: idx, label: ${JSON.stringify(label)}, ok: ok, scene: t.sceneKey ? t.sceneKey() : null };
     })()`,
  );
}

async function seedSave() {
  // 造一份「玩过第二幕」的存档：章节 ch00、幕 ch00_act2、等级 7、已通关一幕。
  // 直接写在 localStorage 里，然后整页重载，让 BootScene 从磁盘读它。
  const seeded = {
    version: 1,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    player: { level: 7, exp: 120, hp: 99, atk: 12, def: 6 },
    progress: {
      chapter: 'ch00',
      act: 'ch00_act2',
      events: [],
      nodes_done: [],
      completion: {},
      graph: [],
      dynasty: 100
    },
    equipment: { weapon: null, head: null, body: null, legs: null, accessory: null },
    inventory: [],
    bag: { slots: 60, items: [] },
    scrap: 30,
    weapons: ['wp_dao'],
    skills: [],
    knowledge: [],
    quiz: {},
    dungeons: {},
    achievements: ['act_cleared_ch00_act1'],
    settings: { sound: 0.8, music: 0.6, rhythmSlow: false, colorblind: false }
  };
  await evaluate(
    `localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(JSON.stringify(seeded))}); 1`,
  );
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const profile = join(outDir, 'profile');
  const proc = spawn(
    edge,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=900,520',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
      } catch {
        /* not up yet */
      }
      if (!target) await sleep(300);
    }
    if (!target) throw new Error('devtools not up');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails;
        errors.push(String(d?.exception?.description ?? d?.text ?? 'exception').split('\n')[0].slice(0, 200));
      }
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 520, deviceScaleFactor: 2, mobile: false });

    const base = baseUrl.replace(/\/$/, '');
    const sep = base.includes('?') ? '&' : '?';

    // ── 第 0 步：进页面一次、写入存档、再整页重载 ──
    await send('Page.navigate', { url: base + sep + 'v=' + Date.now() });
    await waitFor(async () => await evaluate('!!window.__dshGame'), 40000, 'game ready');
    await seedSave();
    await send('Page.navigate', { url: base + sep + 'v=' + Date.now() + 'r' });
    await waitFor(async () => await evaluate('!!(window.__dshTitle && window.__dshTitle.list().length)'), 40000, 'title ready');
    await sleep(600);
    const loaded = await evaluate(probe);
    report.steps.push({ step: 'seeded-load', ...loaded });
    await shot('t1-title-with-save.png');

    // ── 第 1 步：「继续」应带着存档进长廊，存档原封不动 ──
    const pressContinue = await pressTitleButton('继 续');
    report.steps.push({ step: 'press-continue', ...pressContinue });
    await sleep(2500);
    const afterContinue = await evaluate(probe);
    report.steps.push({ step: 'after-continue', ...afterContinue });
    await shot('t2-after-continue.png');

    // 回到标题：直接整页重载（标题只在开局出现，没有「回标题」按钮之外的路子）
    await send('Page.navigate', { url: base + sep + 'v=' + Date.now() + 'c' });
    await waitFor(async () => await evaluate('!!(window.__dshTitle && window.__dshTitle.list().length)'), 40000, 'title ready 2');
    await sleep(600);

    // ── 第 2 步：「重新开始」→ 存档清零，但人还站在标题页（不是死按钮）──
    // 注意：按钮回调里 scene.restart() 的按下反馈有 40ms 延迟 + 用上 setTimeout，
    // 场景重建要等下一帧。这里必须等 __dshTitle 换成重建后的新对象，否则按到的是
    // 已经销毁的旧按钮（第一次跑就是这么假红的）。
    const titleApiV1 = await evaluate('(function(){return window.__dshTitle ? window.__dshTitle.list().length + ":" + window.__dshTitle.list()[0].label : "none";})()');
    const pressReset = await pressTitleButton('重 新 开 始');
    report.steps.push({ step: 'press-restart', before: titleApiV1, ...pressReset });
    await waitFor(
      async () => {
        const st = await evaluate(
          `(function(){
             var t = window.__dshTitle;
             var g = window.__dshGame && window.__dshGame.scene;
             return { api: !!t, labels: t && t.list ? t.list().map(function(b){return b.label;}) : null,
                      active: g ? g.getScenes(true).map(function(x){return x.scene.key;}) : null };
           })()`,
        );
        if (report.steps.length < 40) report.steps.push({ step: 'wait-restart', ...st });
        return !!(st && st.labels && st.labels[0] === '开 始');
      },
      15000,
      'title rebuilt after restart',
    );
    await sleep(500);
    const afterReset = await evaluate(probe);
    report.steps.push({ step: 'after-restart', ...afterReset });
    await shot('t3-after-restart.png');

    // ── 第 3 步：新一局真的从头开始，且死过一次也不会把旧进度写回来 ──
    const pressStart = await pressTitleButton('开 始');
    report.steps.push({ step: 'press-start', ...pressStart });
    await sleep(2500);
    const afterStart = await evaluate(probe);
    report.steps.push({ step: 'after-start', ...afterStart });
    await shot('t4-after-start.png');

    const freshSave = (s) =>
      !!s && typeof s === 'object' && s.act === 'ch00_act1' && s.level === 1 && s.achievements === 0;

    report.verdict = {
      ok:
        !!loaded.save &&
        loaded.save.act === 'ch00_act2' &&
        loaded.save.level === 7 &&
        loaded.buttons &&
        loaded.buttons.includes('继 续') &&
        loaded.buttons.includes('重 新 开 始'),
      continueKeepsProgress:
        !!afterContinue.save && afterContinue.save.act === 'ch00_act2' && afterContinue.save.level === 7,
      continueEntersHub: afterContinue.hubActive === true,
      restartWipesSave: freshSave(afterReset.save),
      restartStaysOnTitle: afterReset.titleActive === true && afterReset.hubActive === false,
      restartShowsStartButton:
        !!afterReset.buttons && afterReset.buttons.includes('开 始') && !afterReset.buttons.includes('继 续'),
      startBeginsFreshGame: afterStart.hubActive === true && freshSave(afterStart.save),
      errors: errors.slice(0, 8),
    };
    report.verdict.allOk = Object.entries(report.verdict)
      .filter(([k]) => k !== 'errors' && k !== 'allOk')
      .every(([, v]) => v === true);
  } catch (e) {
    report.error = String(e && e.stack ? e.stack : e).slice(0, 1200);
    errors.push(String(e && e.message ? e.message : e).slice(0, 200));
  } finally {
    try {
      await writeFile(join(outDir, 'title-menu.json'), JSON.stringify(report, null, 2));
    } catch (e) {
      console.log('WRITE FAILED:', String(e));
    }
    if (report.error) console.log('PROBE ERROR:', report.error);
    console.log(JSON.stringify(report.verdict ?? { failed: true, error: report.error ?? 'no verdict' }));
    console.log('shots:', report.shots.join(', '));
    try {
      await proc.kill();
    } catch {
      /* already gone */
    }
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    process.exit(report.verdict && report.verdict.allOk ? 0 : 2);
  }
}

void readFile;
void main();