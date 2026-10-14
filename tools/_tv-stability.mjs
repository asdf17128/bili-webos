// Bounded CDP transport for stability tools. Credentials and request URLs stay
// in memory; exported network observations contain counts only.
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tvPassphrase } from './_tvpass.mjs';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Also exercised with a local EventEmitter socket; no television is required
// to verify disconnects, failed sends and deadlines in the test harness itself.
export function createCdpTransport(ws) {
  const pending = new Map();
  let sequence = 0, closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('CDP closed')); }
    pending.clear();
  };
  ws.on('close', close);
  ws.on('error', close); // Keep a listener even after close: late errors are safe.
  ws.on('message', raw => {
    let message; try { message = JSON.parse(raw); } catch { return; }
    const job = pending.get(message.id);
    if (!job) return;
    pending.delete(message.id); clearTimeout(job.timer);
    message.error ? job.reject(new Error('CDP command failed: ' + job.method)) : job.resolve(message.result);
  });
  const call = (method, params = {}, timeout = 30000) => new Promise((resolve, reject) => {
    if (closed || ws.readyState !== 1) { reject(new Error('CDP closed')); return; }
    if (!Number.isFinite(timeout) || timeout <= 0) { reject(new Error('CDP deadline expired')); return; }
    const id = ++sequence;
    const fail = message => {
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id); clearTimeout(job.timer); job.reject(new Error(message));
    };
    const timer = setTimeout(() => fail('CDP timeout: ' + method), timeout);
    pending.set(id, { resolve, reject, timer, method });
    try { ws.send(JSON.stringify({ id, method, params }), error => { if (error) fail('CDP send failed: ' + method); }); }
    catch { fail('CDP send failed: ' + method); }
  });
  const evaluate = async (expression, timeout = 30000) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeout);
    if (result.exceptionDetails) throw new Error('TV expression failed: ' + result.exceptionDetails.text);
    return result.result?.value;
  };
  const wait = async (expression, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      // A 5-second state wait must not issue a default 30-second evaluation.
      const value = await evaluate(expression, Math.max(1, end - Date.now()));
      if (value) return value;
      const remaining = end - Date.now();
      if (remaining > 0) await sleep(Math.min(250, remaining));
    }
    throw new Error('TV state wait expired');
  };
  return { call, evaluate, wait, close };
}

// Read the debugger inventory before touching application state. A request
// inactivity timeout misses truncated bodies and continuously trickling data.
export function readInventory(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!Number.isFinite(timeout) || timeout <= 0) { reject(new Error('CDP inventory timeout')); return; }
    let request, response, done = false;
    const finish = (error, pages) => {
      if (done) return;
      done = true; clearTimeout(deadline);
      if (error) {
        response?.destroy(); request?.destroy();
        reject(new Error(error));
      } else resolve(pages);
    };
    const deadline = setTimeout(() => finish('CDP inventory timeout'), timeout);
    try {
      request = http.get(url, { agent: false }, res => {
        response = res;
        // Keep error listeners installed after settlement: destroy/abort can
        // emit more than one terminal event, all handled by the same guard.
        res.on('error', () => finish('CDP inventory response failed'));
        res.on('aborted', () => finish('CDP inventory truncated'));
        res.on('close', () => { if (!res.complete) finish('CDP inventory truncated'); });
        if (res.statusCode !== 200) { finish('CDP inventory HTTP failure'); return; }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', part => { body += part; });
        res.on('end', () => {
          if (!res.complete) { finish('CDP inventory truncated'); return; }
          try {
            const pages = JSON.parse(body);
            if (!Array.isArray(pages)) throw new Error();
            finish(null, pages);
          } catch { finish('Invalid CDP inventory'); }
        });
      });
      request.on('error', () => finish('CDP inventory request failed'));
      request.on('close', () => { if (!response) finish('CDP inventory connection closed'); });
    } catch { finish('CDP inventory request failed'); }
  });
}

export async function connectTv() {
  const conn = new Client(), sockets = new Set();
  let server, ws, transport, disposed = false;
  const requests = new Map(), errors = [], scripts = new Set();
  let startedMedia = 0, completedMedia = 0, failedMedia = 0;
  const close = () => {
    if (disposed) return;
    disposed = true; transport?.close();
    ws?.terminate();
    for (const socket of sockets) socket.destroy();
    sockets.clear(); server?.close(); conn.end();
  };
  conn.on('error', () => transport?.close());
  conn.on('close', () => transport?.close());
  try {
    await new Promise((resolve, reject) => {
      conn.once('ready', resolve).once('error', reject);
      conn.connect({ host: '192.168.50.94', port: 9922, username: 'prisoner',
        privateKey: readFileSync(process.env.HOME + '/.ssh/tv_webos'), passphrase: tvPassphrase(),
        algorithms: { serverHostKey: ['ssh-rsa'] }, readyTimeout: 10000 });
    });
    server = net.createServer(socket => {
      sockets.add(socket); socket.once('close', () => sockets.delete(socket));
      socket.on('error', () => socket.destroy());
      conn.forwardOut('127.0.0.1', 0, '127.0.0.1', 9998, (error, remote) => {
        if (error || socket.destroyed) { socket.destroy(); remote?.destroy(); return; }
        socket.once('close', () => remote.destroy()); remote.once('error', () => socket.destroy());
        socket.pipe(remote).pipe(socket);
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    const pages = await readInventory(`http://127.0.0.1:${port}/json`);
    const page = pages.find(p => p.url?.includes('biliwebos'));
    if (!page) throw new Error('Launch BiliTV before this test');
    ws = new WebSocket(page.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${port}`), { handshakeTimeout: 10000 });
    transport = createCdpTransport(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve); ws.once('error', () => reject(new Error('CDP connection failed')));
      ws.once('close', () => reject(new Error('CDP closed before ready')));
    });
    ws.on('message', raw => {
      let message; try { message = JSON.parse(raw); } catch { return; }
      const p = message.params;
      if (message.method === 'Debugger.scriptParsed') {
        const name=(p.url||'').split('/').pop();
        if (/^(index|PlayerPage|LivePlayerPage).*\.js$/.test(name)) scripts.add(name);
      }
      if (message.method === 'Network.requestWillBeSent') {
        const media = p.type === 'Media' || /upgcxcode|\.(?:m4s|mp4|m3u8)(?:\?|$)/.test(p.request.url);
        if (media) startedMedia++;
        requests.set(p.requestId, { media });
      }
      if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') {
        if (requests.get(p.requestId)?.media) { if (message.method.endsWith('Finished')) completedMedia++; else failedMedia++; }
        requests.delete(p.requestId);
      }
      if (message.method === 'Runtime.exceptionThrown' && errors.length < 50) errors.push({ at: Date.now(), kind: 'uncaught', line: p.exceptionDetails?.lineNumber });
    });
    const { call, evaluate, wait } = transport;
    const key = async (name, delay = 150) => {
      const code = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, GoBack: 461, Backspace: 8 }[name];
      if (!code) throw new Error('Unsupported test key');
      for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      if (delay) await sleep(delay);
    };
    const back = async () => {
      for (let i = 0; i < 6 && await evaluate("!!document.querySelector('video')"); i++) await key('GoBack', 250);
      await wait("!document.querySelector('video')", 5000);
    };
    // Only CDP-observed traffic; native platform HLS may not expose every socket.
    const network = () => ({ active: requests.size, media: [...requests.values()].filter(r => r.media).length, startedMedia, completedMedia, failedMedia });
    const metrics = async ({ collect = false } = {}) => {
      if (collect) await call('HeapProfiler.collectGarbage');
      const heap = await call('Runtime.getHeapUsage'), dom = await call('Memory.getDOMCounters');
      return { heapBytes: heap.usedSize, documents: dom.documents, nodes: dom.nodes, listeners: dom.jsEventListeners, network: network() };
    };
    await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable');
    await wait("typeof window.__openVideo==='function' && document.visibilityState==='visible'");
    const onEvent = (method, listener) => {
      const handler = raw => {
        let message; try { message = JSON.parse(raw); } catch { return; }
        if (message.method === method) listener(message.params);
      };
      ws.on('message', handler);
      return () => ws.off('message', handler);
    };
    return { call, evaluate, wait, key, back, metrics, network, errors, scripts, onEvent, close };
  } catch (error) { close(); throw error; }
}
