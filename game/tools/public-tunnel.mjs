/**
 * 公网入口守护：静态服务器 + Cloudflare 快速隧道（quick tunnel）。
 *
 * 为什么不再用 localhost.run：免费版**每 5 分钟换一次域名**，用户在手机上刷到的是 502，
 * 每次都要我重新发链接。Cloudflare 的快速隧道不需要账号，地址在一次隧道生命周期内**不变**，
 * 断了自动重连时才会换。配合本脚本的守护循环，用户拿到的链接能连续用几小时。
 *
 * 用法: node tools/public-tunnel.mjs [--port 4173] [--root dist] [--url-file tools/_public-url.txt]
 *
 * 前提：`tools/_bin/cloudflared.exe` 存在（见 tools/README.md 的下载说明）。
 * 输出：把当前公网地址写进 url-file，并在 stdout 打印 `PUBLIC URL: https://xxx.trycloudflare.com`。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** 极简参数解析：只认 `--key value`，够用且不引第三方库 */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const port = Number(arg('port', '4173'));
const root = arg('root', 'dist');
const urlFile = resolve(ROOT, arg('url-file', 'tools/_public-url.txt'));
const exe = join(ROOT, 'tools', '_bin', 'cloudflared.exe');

if (!existsSync(exe)) {
  console.error(`缺少 cloudflared：${exe}`);
  process.exit(2);
}

/** 把地址落盘，外部脚本/我自己都从这里读，省得猜 */
function publish(url) {
  mkdirSync(dirname(urlFile), { recursive: true });
  writeFileSync(urlFile, `${url}\n`, 'utf8');
  console.log(`PUBLIC URL: ${url}`);
}

// ---- 静态服务器（已经在跑就不重复起）----
let serve = null;
async function ensureServe() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/index.html`);
    if (res.ok) return;
  } catch {
    /* 没起来，往下走去起一个 */
  }
  serve = spawn(process.execPath, [join(HERE, 'serve.mjs'), root, String(port)], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/index.html`);
      if (res.ok) return;
    } catch {
      /* 继续等 */
    }
  }
  throw new Error(`静态服务器没有在 ${port} 起来`);
}

// ---- 隧道（断了就重连，重连后地址会变，所以每次都重新发布）----
let child = null;

function startTunnel() {
  child = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let seen = false;
  const scan = (buf) => {
    const text = buf.toString('utf8');
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !seen) {
      seen = true;
      publish(m[0]);
    }
  };
  child.stdout.on('data', scan);
  child.stderr.on('data', scan);

  child.on('exit', (code) => {
    console.error(`tunnel 退出（code ${code}），5 秒后重连`);
    setTimeout(() => startTunnel(), 5000);
  });
}

// ---- 守护：服务器挂了就重启 ----
async function main() {
  await ensureServe();
  startTunnel();
  setInterval(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/index.html`);
      if (!res.ok) throw new Error('bad status');
    } catch {
      console.error('静态服务器掉了，重启');
      try {
        if (serve) serve.kill();
        serve = null;
        await ensureServe();
      } catch (err) {
        console.error(String(err));
      }
    }
  }, 30000);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (child) child.kill();
    if (serve) serve.kill();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});