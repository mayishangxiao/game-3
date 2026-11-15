// 像素中文字（设计书 4.9.2 方案 ②：1px 描边 + 点阵化常规字体）实拍探针（v1.9.1）
//
// 设计书 7.1 的「像素中文字体 ⬜」与甲方 m01507 / m14676「文字不要像素感」
// 「我只要清晰的文字」是直接冲突的两条。本轮的解法是**按字号分级**：
// ≥16px 的短标题点阵化，其余保持清晰（判据在 `core/pixelFont.ts`）。
// 单元测试只能证明「判定函数对不对」，而「字到底有没有变成方块」必须在浏览器里看：
//
// 断言：
//   1) 26px 短标题：文字画布按 1 倍栅格生成（canvas 高 ≈ 文字高，比值 1）；
//   2) 同一段字用清晰路径（显式 resolution: 4）时画布是 4 倍栅格——对照组成立；
//   3) 点阵字的纹理是 NEAREST（渲染器放大时才是方块，不是插值糊）；
//   4) 点阵字自带 1px 描边；调用点已配描边的（林则徐头顶 `!` 那种 3px）不被覆盖；
//   5) 9px / 14px 小字一律不点阵化（甲方两次投诉的对象，画布仍是 4 倍栅格）；
//   6) 26px 但超过 18 个字的段落不点阵化（那是正文）；
//   7) 画面上「点阵字 + 清晰小字」同屏共存（分级生效的直接证据）；
//   8) 控制台零异常。
//
// 用法：node tools/_cdp/pixel-font.mjs "<edgePath>" [staticDir|baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { Buffer } from 'node:buffer';

const edgePath = process.argv[2];
const target = process.argv[3] ?? 'dist';
const outDir = resolve(process.argv[4] ?? 'tools/_cdp/_pixel-font-out');
const CDP_PORT = 9504;
const HTTP_PORT = 9503;
const profile = join(outDir, '_profile');

if (!edgePath) {
  console.error('usage: node tools/_cdp/pixel-font.mjs "<edgePath>" [staticDir|baseUrl] [outDir]');
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
        const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const rel = normalize(p.replace(/^\/+/, '')).replace(/^(\.\.[/\\])+/, '');
        const file = resolve(staticDir, rel === '' || rel === '.' ? 'index.html' : rel);
        if (!file.startsWith(staticDir)) {
          res.writeHead(403).end();
          return;
        }
        const body = await readFile(file);
        res.writeHead(200, {
          'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
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

const report = { url: baseUrl, checks: {}, snapshots: {}, errors: [] };
let ws;
let failed = 0;

try {
  const wsUrl = await waitFor(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const j = await r.json();
      const page = j.find((t) => t.type === 'page');
      return page ? page.webSocketDebuggerUrl : null;
    } catch {
      return null;
    }
  }, 20000, 'devtools');

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error)));
      else res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      report.errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception');
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      report.errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
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
    if (r.exceptionDetails) throw new Error(`EVAL FAILED: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 };
    const r = await send('Page.captureScreenshot', params);
    await writeFile(join(outDir, name), Buffer.from(r.data, 'base64'));
  };
  const drainDialogue = async (max = 60) => {
    for (let i = 0; i < max; i++) {
      if (!(await evaluate(`!!window.__dshGame.scene.getScene('Level').dialogue?.isActive`))) return i;
      await evaluate(`window.__dshGame.scene.getScene('Level').dialogue.advance()`);
      await sleep(115);
    }
    return -1;
  };
  const check = (name, ok, detail) => {
    report.checks[name] = !!ok;
    if (!ok) failed++;
    if (detail !== undefined) report.snapshots[name] = detail;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  // 每次构建的 bundle 名都会变，不禁缓存会跑到上次的 boot-*.js
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl });
  await sleep(500);
  await waitFor(() => evaluate('!!window.__dshGate'), 40000, 'gate');
  await sleep(300);
  await evaluate(
    `(() => { const g=document.getElementById('tap-gate'); const b=g&&g.querySelector('.tg-go'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; })()`,
  );
  await waitFor(() => evaluate(`!!window.__dshGame && window.__dshGame.scene.isActive('Title')`), 40000, 'title');
  await sleep(600);

  // ① 标题页：那行 26px「党史像素 RPG」是 canvas 上唯一的大字（DOM 版盖在上面，
  //    但对象本身在，判据读的是它）。它应该走点阵路径。
  const titleProbe = await evaluate(`(() => {
    const s = window.__dshGame.scene.getScene('Title');
    const texts = s.children.list.filter(o => o.type === 'Text');
    const big = texts.find(t => t.style.fontSize === '26px');
    const read = (t) => t ? {
      text: t.text,
      fontSize: t.style.fontSize,
      strokeThickness: t.style.strokeThickness ?? 0,
      stroke: t.style.stroke ?? null,
      resolution: t.frame.source.resolution,
      canvasH: t.canvas.height,
      textH: Math.round(t.height),
      scaleMode: t.frame.source.scaleMode,
      // 画布高 / 文字逻辑高：点阵 ≈1，超采样 ≈4
      overSample: Math.round((t.canvas.height / Math.max(1, t.height)) * 10) / 10,
    } : null;
    // 同屏的小字随便挑一个做对照
    const small = texts.filter(t => t.style.fontSize && parseFloat(t.style.fontSize) <= 11)[0];
    return { big: read(big), small: read(small), total: texts.length };
  })()`);
  report.snapshots.title = titleProbe;
  check('titleBigTextIsPixel', !!titleProbe.big && titleProbe.big.resolution === 1 && titleProbe.big.overSample === 1, titleProbe.big);
  check('titleBigTextHasStroke', !!titleProbe.big && titleProbe.big.strokeThickness === 1, titleProbe.big?.strokeThickness);
  // 注意：`Phaser.Textures.FilterMode.NEAREST === 1`、`LINEAR === 0`（容易记反，踩过）
  check('titleBigTextNearest', !!titleProbe.big && titleProbe.big.scaleMode === 1, titleProbe.big?.scaleMode);
  check('titleSmallTextStaysCrisp', !!titleProbe.small && titleProbe.small.resolution >= 4 && titleProbe.small.strokeThickness === 0, titleProbe.small);

  // ② 进关卡，做一组受控对照：同一句话分别用「默认路径」和「显式清晰路径」
  await evaluate(`(() => {
    const g = window.__dshGame;
    g.scene.getScene('Title').scene.start('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 0 });
    return true;
  })()`);
  await waitFor(
    () => evaluate(`(() => { const l=window.__dshGame.scene.getScene('Level'); return !!(window.__dshLevel && l && l.map && l.map.grid); })()`),
    40000,
    'level ready',
  );
  await sleep(500);
  // 每个场景都有开场对白，对白期间 DOM 面板盖住画面上半部分——先读完再取景
  await drainDialogue();
  await sleep(300);

  const ab = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif';
    const read = (t) => ({
      text: t.text,
      fontSize: t.style.fontSize,
      strokeThickness: t.style.strokeThickness ?? 0,
      resolution: t.frame.source.resolution,
      canvasH: t.canvas.height,
      textH: Math.round(t.height),
      overSample: Math.round((t.canvas.height / Math.max(1, t.height)) * 10) / 10,
    });
    // A：默认路径（应点阵化）
    const a = lvl.add.text(240, 60, '虎门销烟', { fontFamily: FONT, fontSize: '26px', color: '#F0C419', fontStyle: 'bold' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(9000);
    // B：显式要 4 倍栅格（调用点自己要清晰，包装器不能插手）
    const b = lvl.add.text(240, 96, '虎门销烟', { fontFamily: FONT, fontSize: '26px', color: '#F0C419', fontStyle: 'bold', resolution: 4 })
      .setOrigin(0.5).setScrollFactor(0).setDepth(9000);
    // C：小字（甲方要的清晰）
    const c = lvl.add.text(240, 126, '虎门销烟', { fontFamily: FONT, fontSize: '9px', color: '#F2EDE4' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(9000);
    // D：大字但长段落（正文，不该点阵化）
    const d = lvl.add.text(240, 150, '你扮演历史中的人，亲手把每一件大事都「做」一遍，然后看着它变成书上的几行字', { fontFamily: FONT, fontSize: '16px', color: '#C2BCD1' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(9000);
    // E：自带 3px 描边的大字（林则徐头顶那种标记），描边不能被压成 1px
    const e = lvl.add.text(240, 176, '!', { fontFamily: FONT, fontSize: '16px', color: '#F0C419', fontStyle: 'bold', stroke: '#2A2438', strokeThickness: 3 })
      .setOrigin(0.5).setScrollFactor(0).setDepth(9000);
    // 底板：地图上是黄土地/瓦片，字压上去分不清是「点阵」还是「背景纹理」
    const panel = lvl.add.rectangle(240, 118, 420, 150, 0x0d0b14, 1)
      .setStrokeStyle(1, 0x948dab).setScrollFactor(0).setDepth(8999);
    [a, b, c, d, e].forEach(t => t.setDepth(9000));
    window.__pixelProbe = { a, b, c, d, e, panel };
    return { a: read(a), b: read(b), c: read(c), d: read(d), e: read(e) };
  })()`);
  report.snapshots.ab = ab;

  // A 点阵：1 倍栅格 + 1px 描边
  check('pixelTextUses1xCanvas', ab.a.resolution === 1 && ab.a.overSample === 1, { a: ab.a });
  check('pixelTextBoldKept', ab.a.fontSize === '26px', ab.a.fontSize);
  check('pixelTextHas1pxStroke', ab.a.strokeThickness === 1, ab.a.strokeThickness);
  // B 对照：显式 resolution 时包装器不插手（4 倍栅格、无描边）
  check('explicitResolutionRespected', ab.b.resolution === 4 && ab.b.overSample === 4 && ab.b.strokeThickness === 0, { b: ab.b });
  check('abDiffers', ab.a.canvasH < ab.b.canvasH, { aCanvasH: ab.a.canvasH, bCanvasH: ab.b.canvasH });
  // C 小字：清晰（甲方那条）
  check('smallTextNotPixelated', ab.c.resolution >= 4 && ab.c.overSample >= 4 && ab.c.strokeThickness === 0, { c: ab.c });
  // D 长段落：不点阵化
  check('longTextNotPixelated', ab.d.overSample >= 4 && ab.d.strokeThickness === 0, { d: ab.d });
  // E 已有描边：保留 3px（不覆盖）
  check('explicitStrokeKept', ab.e.strokeThickness === 3 && ab.e.resolution === 1, { e: ab.e });

  // ③ 同屏共存：这一帧里既有 1 倍栅格的字，也有 ≥4 倍栅格的字
  const mixed = await evaluate(`(() => {
    const lvl = window.__dshGame.scene.getScene('Level');
    const texts = lvl.children.list.filter(o => o.type === 'Text' && o.visible && o.text);
    const pixel = texts.filter(t => t.frame.source.resolution === 1).length;
    const crisp = texts.filter(t => t.frame.source.resolution >= 4).length;
    return { pixel, crisp, total: texts.length };
  })()`);
  report.snapshots.mixed = mixed;
  check('pixelAndCrispCoexist', mixed.pixel > 0 && mixed.crisp > 0, mixed);

  // ④ 实拍：把 A/B/C/D/E 那一块裁出来放大看
  await sleep(200);
  const cv = await evaluate(`(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, h: r.height, scale: r.width / 480 };
  })()`);
  report.snapshots.canvasBox = cv;
  // 底板是 (240,118) 中心、420×150，逻辑坐标 → CSS 像素
  const clip = {
    x: Math.max(0, Math.round(cv.left + 30 * cv.scale)),
    y: Math.max(0, Math.round(cv.top + 43 * cv.scale)),
    width: Math.round(420 * cv.scale),
    height: Math.round(150 * cv.scale),
  };
  await shot('pf-1-ab.png');
  await shot('pf-2-ab-crop.png', clip);

  // ⑤ 收尾：把探针造的字清掉，再截一张干净的 HUD（证明小字没被带跑）
  await evaluate(`(() => {
    const p = window.__pixelProbe;
    Object.values(p).forEach(t => t.destroy());
    delete window.__pixelProbe;
    return true;
  })()`);
  await sleep(300);
  await shot('pf-3-hud.png');

  check('noConsoleErrors', report.errors.length === 0, report.errors.slice(0, 3));
} catch (err) {
  report.fatal = String(err && err.stack ? err.stack : err);
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  edge.kill();
  if (server) server.close();
  report.summary = { total: Object.keys(report.checks).length, passed: Object.values(report.checks).filter(Boolean).length, failed, errors: report.errors.length };
  report.summary.ok = failed === 0 && !report.fatal;
  await writeFile(join(outDir, 'pixel-font.json'), JSON.stringify(report, null, 2));
  const s = report.summary;
  console.log(`${s.ok ? 'PASS' : 'FAIL'} ${s.passed}/${s.total} checks, ${s.errors} console errors`);
  if (report.fatal) console.log('FATAL:', report.fatal.split('\n').slice(0, 4).join('\n'));
  for (const [k, v] of Object.entries(report.checks)) if (!v) console.log('  ✗', k, JSON.stringify(report.snapshots[k] ?? null).slice(0, 300));
}
process.exit(report.summary.ok ? 0 : 1);
