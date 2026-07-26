// Run a JS expression inside the live TV app via CDP and print the result.
// Usage: node tools/_cdp.mjs <exprFile> [passphrase]
import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import http from 'http';
import net from 'net';

const TV = { host: '192.168.50.94', port: 9922, user: 'prisoner' };
const KEY = process.env.HOME + '/.ssh/tv_webos';
const PASSPHRASE = process.argv[3] || '4E7082';
const REMOTE_DEBUG_PORT = 9998;
const LOCAL_PORT = 19997;
const EXPR = readFileSync(process.argv[2], 'utf8');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({
      host: TV.host, port: TV.port, username: TV.user,
      privateKey: readFileSync(KEY), passphrase: PASSPHRASE,
      algorithms: { serverHostKey: ['ssh-rsa'] },
    });
  });
  const server = net.createServer((localSocket) => {
    conn.forwardOut('127.0.0.1', LOCAL_PORT, '127.0.0.1', REMOTE_DEBUG_PORT, (err, remoteStream) => {
      if (err) { localSocket.end(); return; }
      localSocket.pipe(remoteStream).pipe(localSocket);
    });
  });
  await new Promise(r => server.listen(LOCAL_PORT, '127.0.0.1', r));

  const pages = await fetchJSON(`http://127.0.0.1:${LOCAL_PORT}/json`);
  const appPage = pages.find(p => p.url?.includes('biliwebos') || p.title?.includes('哔哩') || p.title?.includes('Bili'));
  if (!appPage) { console.error('App not found. Pages:', pages.map(p => p.title)); process.exit(2); }
  const wsUrl = appPage.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${LOCAL_PORT}`);

  const { WebSocket } = await import('ws');
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.on('open', r));

  const result = await new Promise((resolve, reject) => {
    const id = 42;
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.id === id) {
        if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
        if (msg.result?.exceptionDetails) return reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
        resolve(msg.result?.result?.value);
      }
    });
    ws.send(JSON.stringify({
      id, method: 'Runtime.evaluate',
      params: { expression: EXPR, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlocklist: false },
    }));
  });

  console.log(typeof result === 'string' ? result : JSON.stringify(result));
  ws.close();
  server.close();
  conn.end();
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
