// Long-running log monitor for the TV app.
// Captures console + runtime exceptions, timestamps each line, and flags
// stall-related messages (Payload mismatch / Shaka error / watchdog / retry).
import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import http from 'http';
import net from 'net';

const TV = { host: '192.168.50.94', port: 9922, user: 'prisoner' };
const KEY = process.env.HOME + '/.ssh/tv_webos';
const PASSPHRASE = process.argv[2] || '4E7082';
const DURATION_MS = (parseInt(process.argv[3]) || 300) * 1000;
const REMOTE_DEBUG_PORT = 9998;
const LOCAL_PORT = parseInt(process.argv[4]) || 19997;

function ts() { return new Date().toISOString().slice(11, 19); }
function flag(text) {
  return /payload length|shaka error|watchdog|retrystreaming|stall|error|fail|fatal|buffer/i.test(text);
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
  const appPage = pages.find(p => p.url?.includes('biliwebos') || p.title?.includes('哔哩'));
  if (!appPage) { console.log('App page not found'); process.exit(1); }

  const wsUrl = appPage.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${LOCAL_PORT}`);
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(wsUrl);
  let msgId = 1;

  ws.on('open', () => {
    ws.send(JSON.stringify({ id: msgId++, method: 'Console.enable' }));
    ws.send(JSON.stringify({ id: msgId++, method: 'Runtime.enable' }));
    console.log(`[${ts()}] monitoring for ${DURATION_MS / 1000}s — play a video now`);

    // Poll playback position every 5s so we can see exactly when it freezes.
    setInterval(() => {
      ws.send(JSON.stringify({
        id: 200, method: 'Runtime.evaluate',
        params: { expression: `(function(){var v=document.querySelector('video');return v?JSON.stringify({t:+v.currentTime.toFixed(1),paused:v.paused,ended:v.ended,ready:v.readyState,buffered:v.buffered.length?+v.buffered.end(v.buffered.length-1).toFixed(1):0}):'no-video';})()` }
      }));
    }, 5000);
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Console.messageAdded') {
      const m = msg.params?.message;
      const text = m?.text || '';
      const mark = flag(text) ? ' <<<' : '';
      console.log(`[${ts()}] console.${m?.level}: ${text}${mark}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const ex = msg.params?.exceptionDetails;
      console.log(`[${ts()}] EXCEPTION: ${ex?.text} ${ex?.exception?.description || ''} <<<`);
    }
    if (msg.id === 200 && msg.result?.result?.value) {
      console.log(`[${ts()}] video: ${msg.result.result.value}`);
    }
  });

  ws.on('error', (e) => console.log(`[${ts()}] ws error: ${e.message}`));

  await new Promise(r => setTimeout(r, DURATION_MS));
  ws.close(); server.close(); conn.end();
  console.log(`[${ts()}] monitor done`);
  process.exit(0);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad JSON')); } });
    }).on('error', reject);
  });
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
