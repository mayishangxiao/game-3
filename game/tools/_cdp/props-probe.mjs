/**
 * 场景布景（Sunny Land 静态道具）专项探针。
 *
 * 为什么要有它：`kind:'prop'` 的布景**只画不登记**（不进 `worldObjects`），
 * `tests/` 里只能证明「文件在、尺寸对、payload 登记了」，证明不了
 * 「这一格真的摆了块路牌而不是又退回 12×12 青紫色块」。这一层用真实浏览器补上。
 *
 * 判据（写进 <outDir>/props.json）：
 *   propsDrawn      —— 第一幕战斗节点地图上摆出来的布景数 > 0，且全部 `drawn:true`
 *   texturesLoaded  —— 每件布景的 texture key 都是 `sunny_*`（不是 _____ 之类的缺图占位）
 *   noPlaceholder   —— 场上**没有** 12×12 或 40×26 的纯色 Rectangle 躺在布景格上
 *   allInBounds     —— 布景坐标都落在地图像素范围里
 *
 * 用法：node tools/_cdp/props-probe.mjs "<edgePath>" "<baseUrl>" <outDir>
 * 端口 9411（和 cdp-e2e 的 9341、其他专项的 939x–940x 错开）。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const [edgePath, baseUrl, outDirArg] = process.argv.slice(2);
if (!edgePath || !baseUrl) {
  console.error('用法: node tools/_cdp/props-probe.mjs "<edgePath>" "<baseUrl>" <outDir>');
  process.exit(2);
}
const outDir = resolve(outDirArg ?? 'tools/_cdp-props');
const profile = join(tmpdir(), `dsh-props-${process.pid}`);
const PORT = 9411;

mkdirSync(outDir, { recursive: true });
const results = {};
const shots = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path) {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.ok) return await r.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(150);
  }
  throw new Error(`CDP ${path} 连不上`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.waiting.has(msg.id)) {
        const { res, rej } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.waiting.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  }
  async shot(name) {
    // 必须等两帧再截：Page.captureScreenshot 直接调用会拿到上一次合成的帧（见 tools/README.md）
    await this.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const p = join(outDir, name);
    writeFileSync(p, Buffer.from(data, 'base64'));
    shots.push(name);
  }
}

const edge = spawn(
  edgePath,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=960,540',
    '--no-first-run',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let code = 0;
try {
  const version = await getJson('/json/version');
  const targets = await getJson('/json/list');
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  results.browser = version.Browser;

  await cdp.send('Page.navigate', { url: baseUrl });
  // 等引擎与场景起来
  for (let i = 0; i < 120; i++) {
    const ok = await cdp.eval('!!window.__dshGame && !!window.__dshGate');
    if (ok) break;
    await sleep(250);
  }
  results.booted = await cdp.eval('!!window.__dshGame');

  // 点掉引导层（要点两次：引擎未就绪时第一次只是记下 tap）
  await cdp.eval(
    "(function(){const g=document.getElementById('tap-gate'); if(!g) return 'no-gate'; const b=g.querySelector('button')||g; b.click(); g.click(); g.style.display='none'; return 'ok';})()",
  );
  await sleep(600);

  // 直接进第一幕战斗节点（和 enemy-bounds.mjs 同一套）：startNode: 2 = nd_1841_humen_battle
  const started = await cdp.eval(`(async () => {
    const game = window.__dshGame;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.sys.settings.key);
    game.scene.start('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 });
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 250));
      const lvl = game.scene.getScene('Level');
      if (lvl && lvl.dungeon !== undefined && window.__dshLevel) return 'level-up';
    }
    return 'timeout';
  })()`);
  results.started = started;

  // 点掉开场情境卡与对白，否则世界冻结
  // 顺序很重要：卡片的按钮是 **Phaser 里的 Text**（不是 DOM），DOM 里只有 `#tap-gate`。
  // 先 `#tap-gate` 再调 `lvl.introOpen` 那张卡上的按钮；对白用 `dialogue.advance()` 循环点掉。
  for (let i = 0; i < 40; i++) {
    const done = await cdp.eval(`(() => {
      const game = window.__dshGame;
      const g = document.getElementById('tap-gate');
      if (g && g.style.display !== 'none') { (g.querySelector('button') || g).click(); g.click(); g.style.display = 'none'; }
      const lvl = game.scene.getScene('Level');
      if (!lvl) return false;
      // LevelScene.ts:1012 把「点击继续」暴露成 tapCard()，它只认 pendingCardTap
      // （introOpen 的开场卡与史料卡都走这条路，见 LevelScene.ts:1127 / 1290）。
      if ((lvl.introOpen || lvl.pendingCardTap) && typeof lvl.tapCard === 'function') { lvl.tapCard(); return false; }
      if (lvl.dialogue && (lvl.dialogue.isActive || lvl.dialogue.visible)) { lvl.dialogue.advance(); return false; }
      return !!window.__dshLevel;
    })()`);
    await sleep(150);
    if (done) break;
  }
  await sleep(400);
  // 兜底：卡片也可能挂在别的场景里（history card 之类），扫一遍所有活场景的容器按钮文字。
  await cdp.eval(`(() => {
    const game = window.__dshGame;
    for (const s of game.scene.getScenes(true)) {
      for (const o of s.children.list) {
        if (o.type === 'Container' && o.list) {
          const txt = o.list.filter(c => c.type === 'Text').map(c => c.text).join('');
          if (/开始战斗|开始/.test(txt) && o.visible) { const b = o.list.find(c => c.type === 'Text' && /开始战斗/.test(c.text)) || o.list.find(c => c.type === 'Text'); if (b && b.emit) b.emit('pointerdown'); }
        }
      }
    }
    return true;
  })()`);
  await sleep(500);
  results.props = await cdp.eval('(window.__dshLevel && window.__dshLevel.props) ? window.__dshLevel.props() : null');
  results.map = await cdp.eval('window.__dshLevel ? window.__dshLevel.map() : null');

  const props = results.props ?? [];
  results.propsDrawn = props.length > 0 && props.every((p) => p.drawn);
  results.propsCount = props.length;
  results.texturesLoaded = props.every((p) => typeof p.texture === 'string' && p.texture.startsWith('sunny_'));
  results.allInBounds =
    !!results.map && props.every((p) => p.x >= 0 && p.y >= 0 && p.x <= results.map.w && p.y <= results.map.h);

  // 兜底方块检查：场上不该再有 12×12 / 40×26 的纯色 Rectangle（那就是旧的 prop 占位）
  results.noPlaceholder = await cdp.eval(`(() => {
    const game = window.__dshGame;
    const lvl = game.scene.getScene('Level');
    if (!lvl) return null;
    const bad = [];
    const walk = (list) => {
      for (const o of list) {
        if (o.type === 'Rectangle' && ((o.width === 12 && o.height === 12) || (o.width === 40 && o.height === 26))) {
          bad.push({ x: o.x, y: o.y, w: o.width, h: o.height });
        }
        if (o.list) walk(o.list);
      }
    };
    walk(lvl.children.list);
    return bad.length === 0 ? true : bad;
  })()`);

  await cdp.shot('p1-level.png');

  // 把镜头对准布景最密的一带：相机**跟随 player.rig**（不是 player），所以挪 rig。
  // 反复监听到位为止——一帧就 16ms，一次性 setPosition 会被跟随插值拉回去。
  results.camera = await cdp.eval(`(async () => {
    const lvl = window.__dshGame.scene.getScene('Level');
    const ps = window.__dshLevel.props();
    if (!ps.length) return 'no-props';
    // 取中间那件，避开地图边缘（贴边时相机被 bounds 卡住看不到中心）
    const p = ps[Math.floor(ps.length / 2)];
    const rig = lvl.player && lvl.player.rig;
    if (!rig) return 'no-rig';
    for (let i = 0; i < 90; i++) {
      rig.setPosition(p.x, p.y + 6);
      if (lvl.player) { lvl.player.x = rig.x; lvl.player.y = rig.y; }
      if (Math.abs(lvl.cameras.main.scrollX - (rig.x - lvl.cameras.main.width / 2)) < 2) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const c = lvl.cameras.main;
    return { scrollX: Math.round(c.scrollX), scrollY: Math.round(c.scrollY), w: c.width, h: c.height };
  })()`);
  await sleep(500);
  await cdp.shot('p2-props-closeup.png');

  // 第二幕（act1b）同样拍一张：那张图 top 6 行是远景带，布景不能压进去
  results.act1b = await cdp.eval(`(async () => {
    const game = window.__dshGame;
    // 第二幕的关卡数据在 acts/ch00_act1.json 里（没有 ch00_act1b.json 这个文件），
    // 地图由节点 nd_1841_humen_battle 的 map_ref 决定 → startNode: 2
    const l = game.scene.getScene('Level');
    l.scene.start('Level', { actId: 'ch00_act1', chapterId: 'ch00', startNode: 2 });
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 250));
      const lv = game.scene.getScene('Level');
      if (lv && window.__dshLevel && typeof lv.tapCard === 'function' && lv.map && lv.map.def.id === 'map_ch00_act1b') {
        if (lv.introOpen || lv.pendingCardTap) { lv.tapCard(); continue; }
        if (lv.dialogue && (lv.dialogue.isActive || lv.dialogue.visible)) { lv.dialogue.advance(); continue; }
        const ps = window.__dshLevel.props();
        if (ps.length) {
          const rig = lv.player && lv.player.rig;
          const p = ps[Math.floor(ps.length / 2)];
          if (rig) { rig.setPosition(p.x, p.y + 6); if (lv.player) { lv.player.x = rig.x; lv.player.y = rig.y; } }
          return {
            mapId: lv.map.def.id,
            count: ps.length,
            textures: ps.every(q => q.texture.startsWith('sunny_')),
            drawn: ps.every(q => q.drawn),
            inBounds: ps.every(q => q.x >= 0 && q.y >= 0 && q.x <= lv.map.pixelWidth && q.y <= lv.map.pixelHeight),
          };
        }
      }
    }
    const lv = game.scene.getScene('Level');
    return { timeout: true, mapId: lv && lv.map ? lv.map.def.id : null };
  })()`);
  await sleep(600);
  await cdp.shot('p3-act1b.png');

  // 其他三张已经铺了布景的地图也拍：act2a（第二幕节点 0）/ act2b（节点 1）/ dg01（副本）
  // 地图 id 从 LevelScene 里读回来，不靠猜——猜错过一次（ch00_act1b.json 根本不存在）。
  //
  // `dismiss`：有些图开场带**别种**闸门（act2b 是「粮草/兵员/民心」月度分配面板），
  // 卡住时必须先关掉，否则世界里的一切都会被面板压住——第一次跑到这里，截图里全是面板，
  // 布景其实画出来了，只是看不见。
  results.otherMaps = [];
  for (const [tag, start, dismiss] of [
    ['p4-act2a.png', { actId: 'ch00_act2', chapterId: 'ch00', startNode: 0 }, 'card'],
    ['p5-act2b.png', { actId: 'ch00_act2', chapterId: 'ch00', startNode: 1 }, 'alloc'],
    ['p6-dg01.png', { actId: 'ch00_act1', chapterId: 'ch00', dungeonId: 'dg01_alley' }, 'card'],
  ]) {
    const info = await cdp.eval(`(async () => {
      const game = window.__dshGame;
      const l = game.scene.getScene('Level');
      l.scene.start('Level', ${JSON.stringify(start)});
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 250));
        const lv = game.scene.getScene('Level');
        if (!lv || !lv.map || !window.__dshLevel) continue;
        if (lv.introOpen || lv.pendingCardTap) { lv.tapCard(); continue; }
        if (lv.dialogue && (lv.dialogue.isActive || lv.dialogue.visible)) { lv.dialogue.advance(); continue; }
        if ('${dismiss}' === 'alloc') {
          // 月度分配面板：「确认本月分配」是容器里的一段 Text，点它 = 接受默认分配
          let hit = false;
          for (const s of game.scene.getScenes(true)) {
            for (const o of s.children.list) {
              if (o.type !== 'Container' || !o.list) continue;
              for (const c of o.list) {
                if (c.type === 'Text' && /确认本月分配|记下这段历史|继续|确认/.test(c.text)) { c.emit('pointerdown'); hit = true; }
              }
            }
          }
          if (hit) continue;
        }
        const ps = window.__dshLevel.props();
        if (!ps.length) continue;
        const rig = lv.player && lv.player.rig;
        const p = ps[Math.floor(ps.length / 2)];
        for (let k = 0; k < 40; k++) {
          if (rig) { rig.setPosition(p.x, p.y + 6); if (lv.player) { lv.player.x = rig.x; lv.player.y = rig.y; } }
          if (Math.abs(lv.cameras.main.scrollX - (p.x - lv.cameras.main.width / 2)) < 4) break;
          await new Promise(r => setTimeout(r, 100));
        }
        return {
          mapId: lv.map.def.id,
          count: ps.length,
          textures: ps.every(q => q.texture.startsWith('sunny_')),
          drawn: ps.every(q => q.drawn),
          scale: lv.cameras.main.zoom,
        };
      }
      const lv = game.scene.getScene('Level');
      return { timeout: true, mapId: lv && lv.map ? lv.map.def.id : null };
    })()`);
    results.otherMaps.push({ shot: tag, ...info });
    await sleep(500);
    await cdp.shot(tag);
  }

  ws.close();
} catch (e) {
  results.error = String(e && e.stack ? e.stack : e);
  code = 1;
} finally {
  try {
    edge.kill();
  } catch {
    /* 已退出 */
  }
  writeFileSync(join(outDir, 'props.json'), JSON.stringify({ ...results, shots }, null, 2));
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* 浏览器还没放开，留着也无所谓 */
  }
}
console.log(JSON.stringify(results, null, 2));
process.exit(code);