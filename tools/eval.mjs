// Evaluate a JS expression inside the running TV app (CDP). Awaits promises.
// Usage: node tools/eval.mjs "<expression>" [pass]
//   e.g. node tools/eval.mjs "document.title"
import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import http from 'http';
import net from 'net';
import { WebSocket } from 'ws';

const TV = { host: '192.168.50.94', port: 9922 };
const EXPR = process.argv[2] || 'document.title';
const PASS = process.argv[3] || '4E7082';

const conn = new Client();
conn.on('ready', () => {
  const server = net.createServer(s => {
    conn.forwardOut('127.0.0.1', 0, '127.0.0.1', 9998, (err, rs) => {
      if (err) { s.end(); return; } s.pipe(rs).pipe(s);
    });
  });
  server.listen(19996, '127.0.0.1', () => {
    http.get('http://127.0.0.1:19996/json', res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', async () => {
        const app = JSON.parse(d).find(p => p.title?.includes('哔哩') || p.url?.includes('biliwebos'));
        if (!app) { console.log('App not running'); process.exit(1); }
        const ws = new WebSocket(app.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, '127.0.0.1:19996'));
        let id = 1;
        const call = (method, params) => new Promise(resolve => {
          const myId = id++;
          ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
          const h = (raw) => { const m = JSON.parse(raw); if (m.id === myId) { ws.off('message', h); resolve(m); } };
          ws.on('message', h);
        });
        await new Promise(r => ws.on('open', r));
        await call('Runtime.enable');
        const r = await call('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true });
        if (r.error) console.log('ERROR:', JSON.stringify(r.error));
        else if (r.result?.exceptionDetails) console.log('EXCEPTION:', JSON.stringify(r.result.exceptionDetails));
        else console.log('RESULT:', JSON.stringify(r.result?.result?.value));
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
setTimeout(() => { console.error('timeout'); process.exit(1); }, 30000);
