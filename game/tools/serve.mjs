/**
 * 极简静态服务器（无依赖），用于本地验证 dist 产物 / 手机同网试玩。
 * 用法: node tools/serve.mjs <dir> <port> [host]
 *   host 省略时监听 127.0.0.1（只本机）；手机试玩传 0.0.0.0 并访问本机局域网 IP。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const dir = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4173);
const host = process.argv[4] ?? '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let rel = normalize(urlPath).replace(/^([/\\])+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const full = join(dir, rel);
    if (!full.startsWith(dir)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(full);
    if (info.isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = await readFile(full);
    const type = MIME[extname(full).toLowerCase()] ?? 'application/octet-stream';
    // 文本资源开 gzip：1.4 MB 的 dist 到手机上是 0.36 MB（局域网/流量都省）
    const gz = /^(text\/|application\/(json|javascript))/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    const payload = gz ? gzipSync(body, { level: 9 }) : body;
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': payload.length,
      'Cache-Control': 'no-store',
      ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
    });
    res.end(payload);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(port, host, () => {
  console.log(`serving ${dir} at http://${host}:${port}/`);
  if (host === '0.0.0.0') {
    const nets = networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const net of list ?? []) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  手机同网可访问: http://${net.address}:${port}/`);
        }
      }
    }
  }
});