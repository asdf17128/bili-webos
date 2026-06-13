// Capture network responses going through the local proxy (:7654) so we can
// see the real CDN host + the proxy's HTTP status for each segment request.
import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import http from 'http';
import net from 'net';

const TV = { host: '192.168.50.94', port: 9922, user: 'prisoner' };
const KEY = process.env.HOME + '/.ssh/tv_webos';
const PASSPHRASE = process.argv[2] || '4E7082';
const DURATION_MS = (parseInt(process.argv[3]) || 70) * 1000;
const LOCAL_PORT = 19995;

function ts() { return new Date().toISOString().slice(11, 19); }

async function main() {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve); conn.on('error', reject);
    conn.connect({ host: TV.host, port: TV.port, username: TV.user,
      privateKey: readFileSync(KEY), passphrase: PASSPHRASE,
      algorithms: { serverHostKey: ['ssh-rsa'] } });
  });
  const server = net.createServer((s) => {
    conn.forwardOut('127.0.0.1', LOCAL_PORT, '127.0.0.1', 9998, (err, rs) => {
      if (err) { s.end(); return; } s.pipe(rs).pipe(s);
    });
  });
  await new Promise(r => server.listen(LOCAL_PORT, '127.0.0.1', r));

  const pages = await fetchJSON(`http://127.0.0.1:${LOCAL_PORT}/json`);
  const appPage = pages.find(p => p.url?.includes('biliwebos') || p.title?.includes('哔哩'));
  if (!appPage) { console.log('app page not found'); process.exit(1); }
  const wsUrl = appPage.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${LOCAL_PORT}`);
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const reqHost = {}; // requestId -> proxied host
  const reqStart = {}; // requestId -> ms timestamp

  ws.on('open', () => {
    ws.send(JSON.stringify({ id: id++, method: 'Network.enable' }));
    ws.send(JSON.stringify({ id: id++, method: 'Console.enable' }));
    ws.send(JSON.stringify({ id: id++, method: 'Runtime.enable' }));
    console.log(`[${ts()}] network+console capture ${DURATION_MS / 1000}s — retry the failing video now`);
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Console.messageAdded') {
      const m = msg.params?.message;
      console.log(`[${ts()}] console.${m?.level}: ${m?.text}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      console.log(`[${ts()}] EXCEPTION: ${msg.params?.exceptionDetails?.text}`);
    }
    if (msg.method === 'Network.requestWillBeSent') {
      const url = msg.params?.request?.url || '';
      if (url.includes('/proxy/')) {
        const m = url.match(/\/proxy\/([^/]+)/);
        reqHost[msg.params.requestId] = m ? m[1] : url.slice(0, 60);
        reqStart[msg.params.requestId] = msg.params.timestamp * 1000; // s -> ms
        const range = msg.params?.request?.headers?.Range || msg.params?.request?.headers?.range || '';
        if (range) reqHost[msg.params.requestId] += ' ' + range;
      }
    }
    if (msg.method === 'Network.loadingFinished') {
      const host = reqHost[msg.params.requestId];
      if (host) {
        const dur = Math.round(msg.params.timestamp * 1000 - (reqStart[msg.params.requestId] || msg.params.timestamp * 1000));
        const kb = Math.round((msg.params.encodedDataLength || 0) / 1024);
        console.log(`[${ts()}] done ${dur}ms ${kb}KB ${host}`);
      }
    }
    if (msg.method === 'Network.loadingFailed') {
      const host = reqHost[msg.params.requestId];
      if (host) console.log(`[${ts()}] FAILED ${host} — ${msg.params.errorText}`);
    }
  });

  await new Promise(r => setTimeout(r, DURATION_MS));
  ws.close(); server.close(); conn.end();
  console.log(`[${ts()}] netcap done`); process.exit(0);
}
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('bad json')); } }); }).on('error', reject);
  });
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
