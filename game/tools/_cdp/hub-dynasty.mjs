// 五幕长廊 + 国运血条 + 新增三幕可玩性实拍探针（v2.0）
//
// 对应甲方 2026-11-15 的四条反馈里能自动化的部分：
//   · 长廊要显示国运（清王朝）血条，且随每一幕下降 —— 断言 5 个门、年代、血条文字、光标切换后的目标刻度；
//   · 开场「战力对比」卡文字重叠 —— 断言 #dom-overlay 里所有文字块互不重叠；
//   · 抉择（答题）画面文字被遮挡 —— 断言题干底边在首个选项顶边之上；
//   · 洋务 / 戊戌 / 辛亥 三幕真的能进（数据 + 地图 + Boss 都对得上），控制台零异常。
//
// 用法：node tools/_cdp/hub-dynasty.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_hub-dynasty-out');
const CDP_PORT = 9502;
const HTTP_PORT = 9501;
const profile = join(outDir, '_profile');

if (!edgePath) {
  console.error('usage: node tools/_cdp/hub-dynasty.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
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

const report = { url: baseUrl, checks: {}, snapshots: {}, errors: [] };
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
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) params.clip = { ...clip, scale: 1 };
    const r = await send('Page.captureScreenshot', params);
    await writeFile(join(outDir, name), Buffer.from(r.data, 'base64'));
  };
  const drainDialogue = async (max = 80) => {
    for (let i = 0; i < max; i++) {
      const active = await evaluate(`!!window.__dshGame.scene.getScene('Level')?.dialogue?.isActive`);
      if (!active) return i;
      await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance()`);
      await sleep(115);
    }
    return -1;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl }); await sleep(600);
  // 上一轮跑过终局卡会把国运写成 0（showEnding 落存档）：每次先清档，截图才从 100 起。
  await evaluate('(() => { try { localStorage.clear(); } catch {} return true; })()').catch(() => {});
  await send('Page.reload', { ignoreCache: true });
  await sleep(800);
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await sleep(300);
  await evaluate(`(() => { const g=document.getElementById('tap-gate'); const b=g&&g.querySelector('.tg-go'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(500);

  /* ---------------- 1. 长廊：五幕 + 国运血条 ---------------- */
  await evaluate(`(() => { window.__dshGame.scene.start('Hub', { chapterId: 'ch00' }); return true; })()`);
  await waitFor(() => evaluate(`window.__dshGame.scene.isActive('Hub') && window.__dshGame.scene.getScene('Hub').doors?.length > 0`), 30000, 'hub ready');
  await sleep(900);

  const hub = await evaluate(`(() => {
    const h = window.__dshGame.scene.getScene('Hub');
    const texts = h.children.list.filter(o => o.type === 'Text').map(o => ({ t: o.text, x: Math.round(o.x), y: Math.round(o.y), d: o.depth }));
    const labels = h.doorLabelEls.map(el => el.textContent);
    return {
      doors: h.doors.map(d => ({ actId: d.actId, name: d.name })),
      years: h.doors.map((d, i) => h.actDefs[i]?.year_label ?? null),
      dynasty: h.actDefs.map(a => a?.dynasty_after ?? null),
      targetText: texts.filter(x => /国运|清王朝/.test(x.t)).map(x => x.t),
      allTexts: texts.map(x => x.t),
      labels,
      mode: h.cursor,
    };
  })()`);
  report.snapshots.hub = hub;
  await shot('hub-5-acts.png', { x: 0, y: 0, width: 960, height: 540 });

  report.checks.fiveDoors = hub.doors.length === 5;
  report.checks.yearsOrdered = JSON.stringify(hub.years) === JSON.stringify(['1840', '1851', '1861', '1898', '1911']);
  report.checks.dynastyBarVisible = hub.allTexts.some((t) => /^清王朝\s*\d+/.test(t));
  report.checks.dynastyTargetShown = hub.targetText.some((t) => /国运\s*→/.test(t));

  // 光标移到最后一幕：目标刻度应变成 0（清王朝覆灭）
  for (let i = 0; i < 4; i++) {
    await evaluate(`(() => { const h = window.__dshGame.scene.getScene('Hub'); h.moveCursor(1); return h.cursor; })()`);
    await sleep(120);
  }
  const lastTarget = await evaluate(`(() => {
    const h = window.__dshGame.scene.getScene('Hub');
    const t = h.children.list.filter(o => o.type === 'Text').map(o => o.text);
    return { cursor: h.cursor, target: t.filter(x => /国运\\s*→/.test(x)) };
  })()`);
  report.snapshots.hubLast = lastTarget;
  report.checks.lastActTargetZero = lastTarget.target.some((t) => /→\s*0$/.test(t));
  await shot('hub-last-act.png', { x: 0, y: 0, width: 960, height: 540 });

  /* ---------------- 2. 开场战力卡：文字块互不重叠 ---------------- */
  const enterNode = async (actId, startNode, label, expectOverlay) => {
    await evaluate(`(() => { const g = window.__dshGame; g.scene.start('Level', { actId: '${actId}', chapterId: 'ch00', startNode: ${startNode} }); return true; })()`);
    // 抉择/过场节点没有地图（`map` 恒为 null），节点就绪的判据是 `node` 已切过去
    await waitFor(() => evaluate(`window.__dshGame.scene.isActive('Level') && !!window.__dshGame.scene.getScene('Level').node`), 40000, label);
    await sleep(700);
    if (expectOverlay) {
      await waitFor(() => evaluate(`(() => { const o = document.getElementById('dom-overlay'); return !!(o && o.style.display !== 'none' && o.children.length); })()`), 15000, `${label} overlay`);
      await sleep(500);
    }
    return evaluate(`(() => {
      const o = document.getElementById('dom-overlay');
      if (!o) return { blocks: [], visible: false };
      const box = o.getBoundingClientRect();
      const kids = Array.from(o.children).filter(el => getComputedStyle(el).display !== 'none');
      const blocks = kids.map(el => {
        const r = el.getBoundingClientRect();
        return { text: (el.textContent || '').slice(0, 24), top: Math.round((r.top - box.top) ), bottom: Math.round(r.bottom - box.top), left: Math.round(r.left - box.left), right: Math.round(r.right - box.left) };
      }).filter(b => b.bottom > b.top);
      return { visible: true, blocks };
    })()`);
  };

  const introCard = await enterNode('ch00_act3', 2, 'act3 battle', true);
  report.snapshots.introCard = introCard;
  // 只比较「有内容」的块（空 div 高度为 0 已被过滤）
  const overlaps = [];
  for (let i = 0; i < introCard.blocks.length; i++) {
    for (let j = i + 1; j < introCard.blocks.length; j++) {
      const a = introCard.blocks[i], b = introCard.blocks[j];
      const v = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const h = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      // 只关心同一列的文字块（左右有交叠）——左右两栏并排不算重叠
      if (v > 2 && h > 8) overlaps.push({ a: a.text, b: b.text, v, h });
    }
  }
  report.snapshots.introOverlaps = overlaps;
  report.checks.introCardNoOverlap = introCard.visible && introCard.blocks.length >= 3 && overlaps.length === 0;
  await shot('act3-intro-card.png', { x: 0, y: 0, width: 960, height: 540 });

  /* ---------------- 3. 抉择节点：题干与选项不压 ---------------- */
  await enterNode('ch00_act4', 3, 'act4 choice', false);
  await drainDialogue();
  await waitFor(() => evaluate(`(() => {
    const l = window.__dshGame.scene.getScene('Level');
    const flat = [];
    const walk = (list) => { for (const o of list) { flat.push(o); if (o.list) walk(o.list); } };
    walk(l.children.list);
    return flat.some(o => o.type === 'Text' && /你走，还是留/.test(o.text));
  })()`), 20000, 'choice prompt');
  await sleep(400);

  const choice = await evaluate(`(() => {
    const l = window.__dshGame.scene.getScene('Level');
    // 抉择面板的文字挂在 overlay 容器里，必须递归收集，不能只看 children.list
    const flat = [];
    const walk = (list) => { for (const o of list) { flat.push(o); if (o.list) walk(o.list); } };
    walk(l.children.list);
    const texts = flat.filter(o => o.type === 'Text' && o.visible).map(o => {
      const b = o.getBounds();
      return { t: o.text.slice(0, 18), top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) };
    });
    const prompt = texts.find(x => /你走，还是留/.test(x.t));
    const options = texts.filter(x => /留下|走，去日本|袁世凯/.test(x.t));
    return { prompt, options, count: texts.length };
  })()`);
  report.snapshots.choice = choice;
  const firstOptTop = choice.options.length ? Math.min(...choice.options.map((o) => o.top)) : -1;
  report.checks.choicePromptAboveOptions = !!choice.prompt && firstOptTop > choice.prompt.bottom - 1;
  report.checks.choiceOptionsPresent = choice.options.length >= 3;
  await shot('act4-choice.png', { x: 0, y: 0, width: 960, height: 540 });

  /* ---------------- 4. 第五幕能进（地图 + 敌兵 + Boss 数据） ---------------- */
  await evaluate(`(() => { const g = window.__dshGame; g.scene.start('Level', { actId: 'ch00_act5', chapterId: 'ch00', startNode: 0 }); return true; })()`);
  await waitFor(() => evaluate(`window.__dshGame.scene.isActive('Level') && !!window.__dshGame.scene.getScene('Level').map`), 40000, 'act5 level');
  await sleep(900);
  const act5 = await evaluate(`(() => {
    const l = window.__dshGame.scene.getScene('Level');
    return {
      act: l.act?.id, node: l.node?.id, map: l.map?.def?.id,
      boss: l.node?.params?.boss ?? null,
      enemyCount: l.enemies.length,
      overlayText: (document.getElementById('dom-overlay')?.textContent ?? '').slice(0, 60),
    };
  })()`);
  report.snapshots.act5 = act5;
  report.checks.act5Loaded = act5.act === 'ch00_act5' && !!act5.map;
  report.checks.act5Boss = act5.boss === 'en_boss_qing_zhitong';
  await shot('act5-wuchang.png', { x: 0, y: 0, width: 960, height: 540 });

  /* ---------------- 5. 终局卡：清王朝覆灭 ---------------- */
  await evaluate(`(() => { window.__dshGame.scene.getScene('Level').showEnding(); return true; })()`);
  await sleep(700);
  const endingTexts = await evaluate(`(() => {
    const l = window.__dshGame.scene.getScene('Level');
    const flat = [];
    const walk = (list) => { for (const o of list) { flat.push(o); if (o.list) walk(o.list); } };
    walk(l.children.list);
    return flat.filter(o => o.type === 'Text').map(o => o.text);
  })()`);
  report.snapshots.ending = endingTexts;
  report.checks.endingShown =
    endingTexts.some((t) => /清 王 朝 覆 灭/.test(t)) && endingTexts.some((t) => /全篇终/.test(t));
  await shot('ending.png', { x: 0, y: 0, width: 960, height: 540 });

  report.checks.noConsoleErrors = report.errors.length === 0;
  report.verdict = {
    total: Object.keys(report.checks).length,
    failed: Object.entries(report.checks).filter(([, v]) => !v).map(([k]) => k),
  };
  report.verdict.pass = report.verdict.failed.length === 0;
  await writeFile(join(outDir, 'hub-dynasty.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    total: report.verdict.total,
    passed: report.verdict.total - report.verdict.failed.length,
    failed: report.verdict.failed,
    doors: hub.doors.map((d) => d.name),
    years: hub.years,
    dynastyTexts: hub.targetText,
    overlaps: overlaps.length,
  }, null, 2));
} catch (e) {
  report.errors.push(String(e));
  report.verdict = { pass: false, failed: ['probe-crashed'], total: Object.keys(report.checks).length };
  await writeFile(join(outDir, 'hub-dynasty.json'), JSON.stringify(report, null, 2)).catch(() => {});
  console.error('PROBE FAILED:', e.message);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  edge.kill();
  if (server) server.close();
  setTimeout(() => process.exit(report.verdict?.pass ? 0 : 1), 200);
}
