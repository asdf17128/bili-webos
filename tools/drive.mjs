// Drive the TV app via CDP: inject remote-control key events, then screenshot.
// Usage: node tools/drive.mjs "<keys>" [outfile] [pass] [perKeyMs]
//   keys: comma-separated — up,down,left,right,ok,back,home (home=many lefts)
//   e.g. node tools/drive.mjs "down,down,right" up.png
// Lets Claude operate + verify the app without a human.
import { Client } from 'ssh2';
import { readFileSync, writeFileSync } from 'fs';
import http from 'http';
import net from 'net';
import { WebSocket } from 'ws';

const TV = { host: '192.168.50.94', port: 9922 };
const KEYSEQ = (process.argv[2] || '').split(',').map(s => s.trim()).filter(Boolean);
const OUT = process.argv[3] || 'drive.png';
const PASS = process.argv[4] || '4E7082';
const PER_KEY_MS = parseInt(process.argv[5]) || 450;

const KEYMAP = {
  up: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  ok: { key: 'Enter', code: 'Enter', vk: 13 },
  enter: { key: 'Enter', code: 'Enter', vk: 13 },
  back: { key: 'Backspace', code: 'Backspace', vk: 8 },
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const conn = new Client();
conn.on('ready', () => {
  const server = net.createServer(s => {
    conn.forwardOut('127.0.0.1', 0, '127.0.0.1', 9998, (err, rs) => {
      if (err) { s.end(); return; } s.pipe(rs).pipe(s);
    });
  });
  server.listen(19994, '127.0.0.1', () => {
    http.get('http://127.0.0.1:19994/json', res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', async () => {
        const app = JSON.parse(d).find(p => p.title?.includes('哔哩') || p.url?.includes('biliwebos'));
        if (!app) { console.log('App not running'); process.exit(1); }
        const ws = new WebSocket(app.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, '127.0.0.1:19994'));
        let id = 1;
        const send = (method, params) => { ws.send(JSON.stringify({ id: id++, method, params: params || {} })); };
        const call = (method, params) => new Promise(resolve => {
          const myId = id;
          send(method, params);
          const h = (raw) => { const m = JSON.parse(raw); if (m.id === myId) { ws.off('message', h); resolve(m.result); } };
          ws.on('message', h);
        });

        await new Promise(r => ws.on('open', r));
        await call('Runtime.enable');

        // Expand "home" → several lefts to get back to the sidebar
        const seq = [];
        for (const k of KEYSEQ) {
          if (k === 'home') { for (let i = 0; i < 6; i++) seq.push('left'); }
          else seq.push(k);
        }

        for (const k of seq) {
          const m = KEYMAP[k];
          if (!m) { console.log('unknown key: ' + k); continue; }
          await call('Input.dispatchKeyEvent', { type: 'keyDown', key: m.key, code: m.code, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk });
          await call('Input.dispatchKeyEvent', { type: 'keyUp', key: m.key, code: m.code, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk });
          await sleep(PER_KEY_MS);
        }

        // Let the UI settle (loads/animations), then read state + screenshot.
        await sleep(1200);
        const diag = await call('Runtime.evaluate', { expression: `JSON.stringify({
          focus: document.querySelector('.focused, [data-focus-id].focused')?.getAttribute('data-focus-id') || null,
          v: (function(){var v=document.querySelector('video');return v?{t:+v.currentTime.toFixed(1),ready:v.readyState,paused:v.paused}:null;})(),
          imgs: document.querySelectorAll('img').length,
          brokenImgs: Array.from(document.querySelectorAll('img')).filter(i=>i.complete&&i.naturalWidth===0).length,
        })`, returnByValue: true });
        console.log('STATE: ' + (diag?.result?.value || 'n/a'));

        const shot = await call('Page.captureScreenshot', { format: 'png' });
        if (shot?.data) { writeFileSync(OUT, Buffer.from(shot.data, 'base64')); console.log('shot: ' + OUT); }
        ws.close(); server.close(); conn.end(); process.exit(0);
      });
    });
  });
});
conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
conn.connect({
  host: TV.host, port: TV.port, username: 'prisoner',
  privateKey: readFileSync(process.env.HOME + '/.ssh/tv_webos'),
  passphrase: PASS, algorithms: { serverHostKey: ['ssh-rsa'] },
});
setTimeout(() => { console.error('timeout'); process.exit(1); }, 60000);
