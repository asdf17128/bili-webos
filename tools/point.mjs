// Drive the TV app's POINTER (LG Magic Remote emulation) via CDP mouse events.
// The Magic Remote generates DOM mousemove/wheel/click events; Input.dispatchMouseEvent
// reproduces exactly those, so this faithfully tests hover-focus / wheel / click-at-pointer.
//
// Usage: node tools/point.mjs "<cmds>" [outfile] [pass]
//   cmds: comma-separated; each is verb:args (colon-separated)
//     move:X:Y     move pointer to (X,Y)  → fires mousemove/mouseenter
//     wheel:DY     scroll wheel by DY at the last pointer pos (DY>0 = down)
//     click:X:Y    move to (X,Y) then press+release (click whatever is under it)
//     click        press+release at the last pointer pos
//   e.g. node tools/point.mjs "move:960:400,wheel:300,move:1500:760,click"
//
// STATE reports both the FOCUSED card and the card UNDER THE POINTER so a
// mismatch (the #11 desync) is measurable.
import { Client } from 'ssh2';
import { readFileSync, writeFileSync } from 'fs';
import http from 'http';
import net from 'net';
import { WebSocket } from 'ws';

const TV = { host: '192.168.50.94', port: 9922 };
const CMDS = (process.argv[2] || '').split(',').map(s => s.trim()).filter(Boolean);
const OUT = process.argv[3] || 'point.png';
const PASS = process.argv[4] || '4E7082';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let px = 960, py = 540; // last pointer position

const conn = new Client();
conn.on('ready', () => {
  const server = net.createServer(s => {
    conn.forwardOut('127.0.0.1', 0, '127.0.0.1', 9998, (err, rs) => {
      if (err) { s.end(); return; } s.pipe(rs).pipe(s);
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const _port = server.address().port;
    http.get('http://127.0.0.1:'+_port+'/json', res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', async () => {
        const app = JSON.parse(d).find(p => p.title?.includes('哔哩') || p.url?.includes('biliwebos'));
        if (!app) { console.log('App not running'); process.exit(1); }
        const ws = new WebSocket(app.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, '127.0.0.1:'+_port));
        let id = 1;
        const call = (method, params) => new Promise(resolve => {
          const myId = id++;
          ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
          const h = (raw) => { const m = JSON.parse(raw); if (m.id === myId) { ws.off('message', h); resolve(m.result); } };
          ws.on('message', h);
        });
        await new Promise(r => ws.on('open', r));
        await call('Runtime.enable');

        const move = (x, y) => { px = x; py = y; return call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); };
        const wheel = (dy) => call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: px, y: py, deltaX: 0, deltaY: dy });
        const click = (x, y) => (async () => {
          if (x != null) await move(x, y);
          await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 });
          await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 });
        })();

        for (const cmd of CMDS) {
          const [verb, a, b] = cmd.split(':');
          if (verb === 'move') await move(+a, +b);
          else if (verb === 'wheel') await wheel(+a);
          else if (verb === 'click') await click(a != null ? +a : null, b != null ? +b : null);
          else console.log('unknown cmd: ' + cmd);
          await sleep(500);
        }

        await sleep(1000);
        const diag = await call('Runtime.evaluate', {
          expression: `(function(){
            var focused = document.querySelector('[data-focus-id].focused');
            var under = document.elementFromPoint(${px}, ${py});
            var underCard = under && under.closest ? under.closest('[data-focus-id]') : null;
            return JSON.stringify({
              pointer: [${px}, ${py}],
              focus: focused ? focused.getAttribute('data-focus-id') : null,
              underPointer: underCard ? underCard.getAttribute('data-focus-id') : (under ? (under.className||under.tagName) : null),
              match: !!(focused && underCard && focused.getAttribute('data-focus-id') === underCard.getAttribute('data-focus-id')),
              v: (function(){var v=document.querySelector('video');return v?{t:+v.currentTime.toFixed(1),ready:v.readyState,paused:v.paused}:null;})()
            });
          })()`, returnByValue: true
        });
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
