import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = "http://localhost:5173/";
const OUT = "D:\\game_project\\game 3\\_art_review\\screenshot_player.png";

const edge = spawn(EDGE, [
  "--remote-debugging-port=9336",
  "--headless=new",
  "--window-size=960,540",
  "--no-first-run",
  "--disable-gpu",
  URL
]);

const timeout = setTimeout(() => { console.error('TIMEOUT'); edge.kill(); process.exit(1); }, 25000);

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:9336${path}`, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch(e){reject(e)} });
    }).on('error', reject);
  });
}

await new Promise(r => setTimeout(r, 4000));
try {
  const tabs = await getJSON('/json');
  const page = tabs.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  
  let id = 0;
  const send = (method, params={}) => new Promise((res, rej) => {
    const mid = ++id;
    const timer = setTimeout(() => rej(new Error('timeout '+method)), 5000);
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === mid) { clearTimeout(timer); ws.removeEventListener('message', handler); res(msg.result); }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({id: mid, method, params}));
  });

  await send('Page.enable');
  await new Promise(r => setTimeout(r, 1500));
  await send('Input.dispatchMouseEvent', {type:'mousePressed', x:480, y:270, button:'left', clickCount:1});
  await send('Input.dispatchMouseEvent', {type:'mouseReleased', x:480, y:270, button:'left'});
  await new Promise(r => setTimeout(r, 4000));
  const shot = await send('Page.captureScreenshot', {format: 'png'});
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('OK:', OUT);
} catch(e) {
  console.error('ERR:', e.message);
}
clearTimeout(timeout);
edge.kill();
process.exit(0);
