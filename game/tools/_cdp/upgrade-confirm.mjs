// 强化三选一「选中 → 确认」两步流程专项探针（v1.8.6）。
//
// 甲方反馈：玩家快速点击时误选、且不清楚已选内容。旧版 point card = 立即生效 + 关界面 +
// 推下一波，手指一抖就把还没看清的强化定死了。现在必须验证**真实鼠标**路径：
//   ① 连点 / 双击卡片绝不生效、绝不结算、绝不关闭界面；
//   ② 选中项有醒目状态（金色描边 + ✓ 已选角标）与「当前选中 + 效果说明」；
//   ③ 可切换、可取消；
//   ④ 未选中按确认无效（只提示）；
//   ⑤ 只有确认才生效，并给出「已生效：…」结果反馈。
//
// 用法：
//   node tools/_cdp/upgrade-confirm.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
// 自带静态服务（传本地 dist 目录），输出 upgrade-confirm.json + uc-*.png。
//
// 注意：卡片几何（cardW=132 / gap=12 / cardY=137 / 确认框 y=236 / 取消 y=236 x=132）
// 与 LevelScene.showUpgradeCard() 一一对应；改了布局要同步改这里，否则会点到空白处假红。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp');
const CDP_PORT = 9412;
const HTTP_PORT = 9413;
const profile = join(outDir, '_profile-upgrade-confirm');

if (!edgePath) {
  console.error('usage: node tools/_cdp/upgrade-confirm.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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

const report = { url: baseUrl, node: 'ch00_act1 / startNode 2', checks: {}, snapshots: {}, errors: [] };

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
      console.log('EVAL FAILED:', text);
      throw new Error(`EVAL FAILED: ${text}`);
    }
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, name), Buffer.from(r.data, 'base64'));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  // 960×540 正好是 480×270 的 2 倍，无 letterbox，逻辑坐标换算最干净
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl });
  await sleep(500);

  // 引导层 → 标题 → 虎门炮台战斗节点（与 wave-upgrade.mjs 同一节点）
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate handler ready');
  await evaluate(`(() => {
    const g = document.getElementById('tap-gate');
    const b = g && g.querySelector('.tg-go');
    if (b) b.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
    return true;
  })()`);
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(600);
  await evaluate(`(() => {
    window.__dshGame.scene.getScene('Title').scene.start('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 });
    return true;
  })()`);
  await waitFor(() => evaluate('!!window.__dshLevel'), 40000, 'level hook');
  await sleep(2000);

  for (let i = 0; i < 8 && (await evaluate(`!!window.__dshGame.scene.getScene('Level').introOpen`)); i++) {
    await evaluate(`(function(){var l=window.__dshGame.scene.getScene('Level'); if (l.pendingCardTap) l.pendingCardTap(); return 1;})()`);
    await sleep(400);
  }
  for (let i = 0; i < 30 && (await evaluate(`!!window.__dshGame.scene.getScene('Level').dialogue?.isActive`)); i++) {
    await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance(); 1`);
    await sleep(160);
  }
  await waitFor(() => evaluate('window.__dshLevel.allEnemies().length > 0'), 20000, 'first wave');
  await waitFor(
    () => evaluate('window.__dshGame.scene.getScene("Level").wavePending === false'),
    20000,
    'wave settled',
  );
  await sleep(300);

  // 记录所有 toast 文案：确认反馈 / 未选中提示都要靠它验（toast 只有 1~1.8s 会消失）
  await evaluate(`(() => {
    window.__toastLog = [];
    const t = document.querySelector('#dom-toast');
    if (!t) return false;
    new MutationObserver(() => {
      const s = (t.textContent || '').trim();
      if (s && window.__toastLog[window.__toastLog.length - 1] !== s) window.__toastLog.push(s);
    }).observe(t, { childList: true, characterData: true, subtree: true, attributes: true });
    return true;
  })()`);

  const canvasRect = await evaluate(`(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  if (!canvasRect) throw new Error('canvas not found');
  report.snapshots.canvas = canvasRect;

  /** 逻辑坐标（480×270）→ CSS 像素 → 真实鼠标事件 */
  const clickAt = async (lx, ly) => {
    const x = canvasRect.left + (lx / 480) * canvasRect.width;
    const y = canvasRect.top + (ly / 270) * canvasRect.height;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(45);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  };
  /** 快速连点：模拟玩家手指抖动 / 误触，间隔 55ms */
  const rapidClick = async (lx, ly, n) => {
    for (let i = 0; i < n; i++) {
      await clickAt(lx, ly);
      await sleep(55);
    }
  };

  /** 当前卡片容器里的文字 / 选中角标 / 卡片描边，用于验「明显选中状态」 */
  const readCard = () =>
    evaluate(`(() => {
      const L = window.__dshGame.scene.getScene('Level');
      const texts = [], badges = [], boxes = [];
      L.children.list.forEach((o) => {
        if (o.type !== 'Container' || !o.list || o.depth < 90) return;
        o.list.forEach((c) => {
          if (c.type === 'Text') {
            texts.push(c.text);
            if (String(c.text).includes('✓ 已选')) badges.push({ visible: c.visible, x: c.x, y: c.y });
          }
          if (c.type === 'Rectangle' && c.width === 132 && c.height === 96) {
            // Phaser Shape 的描边宽度字段是 lineWidth（不是 strokeWidth），颜色是 strokeColor
            boxes.push({ x: c.x, y: c.y, stroke: c.lineWidth ?? c.strokeWidth ?? null, color: c.strokeColor });
          }
        });
      });
      // 「当前选中」与「效果说明」是容器里相邻的两个 Text，比按 y 坐标猜更稳
      const ti = texts.findIndex((t) => String(t).includes('当前选中：') || String(t).includes('尚未选择'));
      const selTitle = ti >= 0 ? texts[ti] : null;
      const selDesc = ti >= 0 ? (texts[ti + 1] ?? null) : null;
      return {
        texts, badges, boxes, selTitle, selDesc,
        state: window.__dshLevel.upgradeSelection(),
        picked: window.__dshLevel.upgrades().picked,
        waveIndex: L.waveIndex,
        introOpen: L.introOpen,
        toasts: [...(window.__toastLog || [])],
      };
    })()`);

  // —— 清波 → 弹出强化卡 ——
  await evaluate('window.__dshLevel.clearWave()');
  const cardShown = await waitFor(
    async () => (await evaluate('window.__dshLevel.upgradeSelection().cardOpen')) === true,
    15000,
    'upgrade card',
  ).catch(() => false);
  report.checks.cardAppears = cardShown === true;
  if (!cardShown) throw new Error('强化卡没有弹出');
  await sleep(400);
  await shot('uc-1-card-initial.png');

  const cardXs = [96, 240, 384]; // 三张卡中心（cardW=132, gap=12, startX=96）
  const CARD_Y = 137;
  const CONFIRM_X = 240;
  const CONFIRM_Y = 236;
  const CANCEL_X = 132;

  const initial = await readCard();
  report.snapshots.initial = initial;
  report.checks.threeChoices = initial.state.choices.length === 3;
  report.checks.initialNoSelection = initial.state.selected === null && initial.state.picked === 0;
  report.checks.initialShowsPlaceholder = (initial.texts || []).some((t) => String(t).includes('尚未选择'));
  report.checks.initialConfirmDisabledLook = (initial.texts || []).some((t) => String(t).includes('确 认 强 化'));

  // —— ① 真实鼠标快速连点 5 次：绝不能生效 / 结算 / 关界面 ——
  await rapidClick(cardXs[0], CARD_Y, 5);
  await sleep(250);
  const afterRapid = await readCard();
  report.snapshots.afterRapid = afterRapid;
  report.checks.rapidClicksNeverCommit = afterRapid.state.picked === 0 && afterRapid.state.cardOpen === true;
  report.checks.rapidClicksNoSettlement =
    afterRapid.waveIndex === initial.waveIndex && afterRapid.introOpen === true;
  report.checks.rapidClicksNoEffectToast = !afterRapid.toasts.some((t) => t.includes('已生效'));
  // 5 次连点（奇数）后应恰好停在「已选中第一项」，且不会自动完成
  report.checks.rapidClicksStillSelected = afterRapid.state.selected === initial.state.choices[0];
  await shot('uc-2-rapid-selected.png');

  // —— ② 选中态醒目 + 当前选中项与效果说明 ——
  report.checks.selectedBadgeVisible = (afterRapid.badges || []).filter((b) => b.visible).length === 1;
  // 选中态：金色描边 0xF0C419（15778841）+ 3px 粗；未选中是暗红 0x6B2330 + 1px
  report.checks.selectedCardHighlighted = (afterRapid.boxes || []).some(
    (b) => Math.abs(b.x - cardXs[0]) < 1 && b.color === 0xf0c419 && (b.stroke ?? 0) >= 3,
  );
  report.checks.showsCurrentSelection = !!afterRapid.selTitle && afterRapid.selTitle.includes('当前选中：');
  report.checks.showsEffectDescription =
    !!afterRapid.selDesc && !String(afterRapid.selDesc).includes('确认前可切换') && String(afterRapid.selDesc).length > 4;

  // —— ③ 切换到另一张卡 ——
  await clickAt(cardXs[1], CARD_Y);
  await sleep(220);
  const afterSwitch = await readCard();
  report.snapshots.afterSwitch = afterSwitch;
  report.checks.switchSelectionWorks =
    afterSwitch.state.selected === initial.state.choices[1] &&
    afterSwitch.state.selected !== afterRapid.state.selected;
  report.checks.switchStillNotCommitted = afterSwitch.state.picked === 0 && afterSwitch.state.cardOpen === true;
  report.checks.switchUpdatesTitle = !!afterSwitch.selTitle && afterSwitch.selTitle !== afterRapid.selTitle;
  report.checks.switchUpdatesEffectDescription =
    !!afterSwitch.selDesc && afterSwitch.selDesc !== afterRapid.selDesc;
  report.checks.exactlyOneBadgeAfterSwitch = (afterSwitch.badges || []).filter((b) => b.visible).length === 1;
  await shot('uc-3-switched.png');

  // —— ④ 取消选择：点「取消选择」按钮，界面必须保持打开 ——
  await clickAt(CANCEL_X, CONFIRM_Y);
  await sleep(220);
  const afterCancel = await readCard();
  report.snapshots.afterCancel = afterCancel;
  report.checks.cancelSelectionWorks = afterCancel.state.selected === null;
  report.checks.cancelKeepsCardOpen = afterCancel.state.cardOpen === true && afterCancel.introOpen === true;
  report.checks.cancelBadgeHidden = (afterCancel.badges || []).every((b) => !b.visible);
  report.checks.cancelStillNotCommitted = afterCancel.state.picked === 0;
  await shot('uc-4-cancelled.png');

  // —— ⑤ 未选中按确认：只提示，绝不生效 ——
  await clickAt(CONFIRM_X, CONFIRM_Y);
  await sleep(220);
  const afterEmptyConfirm = await readCard();
  report.snapshots.afterEmptyConfirm = afterEmptyConfirm;
  report.checks.confirmWithoutSelectionBlocked =
    afterEmptyConfirm.state.cardOpen === true && afterEmptyConfirm.state.picked === 0;
  report.checks.confirmWithoutSelectionHints = afterEmptyConfirm.toasts.some((t) => t.includes('请先选择一项强化'));
  report.checks.confirmWithoutSelectionNoEffectToast = !afterEmptyConfirm.toasts.some((t) => t.includes('已生效'));

  // —— ⑥ 明确选中第三项后按确认：唯一生效入口 ——
  await clickAt(cardXs[2], CARD_Y);
  await sleep(200);
  const beforeConfirm = await readCard();
  report.checks.finalSelectionIsExplicit = beforeConfirm.state.selected === initial.state.choices[2];
  report.snapshots.beforeConfirm = beforeConfirm;
  await clickAt(CONFIRM_X, CONFIRM_Y);
  await sleep(450);
  const afterConfirm = await readCard();
  report.snapshots.afterConfirm = afterConfirm;
  report.checks.confirmCommitsExactlyOnce = afterConfirm.state.picked === 1;
  report.checks.confirmClosesCard = afterConfirm.state.cardOpen === false;
  report.checks.confirmShowsResultToast = afterConfirm.toasts.some((t) => t.includes('已生效：'));
  report.checks.confirmResumesWorld = afterConfirm.introOpen === false;
  report.checks.confirmNoDoubleApply = (await evaluate('window.__dshLevel.confirmUpgrade()')) === false;
  await shot('uc-5-confirmed.png');

  report.passed = Object.values(report.checks).filter(Boolean).length;
  report.total = Object.keys(report.checks).length;
  report.failed = Object.entries(report.checks).filter(([, v]) => !v).map(([k]) => k);
  report.ok = report.failed.length === 0 && report.errors.length === 0;
  ws.close();
} catch (e) {
  report.errors.push(String(e && e.stack ? e.stack : e));
  report.ok = false;
} finally {
  try { edge.kill(); } catch { /* 已退出 */ }
  await sleep(300);
  if (server) server.close();
  try { await rm(profile, { recursive: true, force: true }); } catch { /* 清理失败不影响结果 */ }
  await writeFile(join(outDir, 'upgrade-confirm.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ok: report.ok,
    passed: report.passed,
    total: report.total,
    failed: report.failed,
    errors: report.errors,
  }, null, 2));
  process.exit(report.ok ? 0 : 1);
}
