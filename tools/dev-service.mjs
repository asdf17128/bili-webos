// Run the REAL TV service on the Mac and expose it to the dev browser.
//
// Why: dev used to talk to proxy/server.js while the TV talks to
// service/com.biliwebos.app.service/service.js — two different implementations
// of fetching, cookies, WBI, risk-control fingerprints, danmaku and cast. So
// "works in the simulator" never guaranteed "works on the TV" (owner
// 2026-08-02: "可以实现模拟器和真机一个效果吗").
//
// This loads that exact service file with the same webos-service stub the
// Node-8 test harness uses, then bridges every Luna method it registers:
//   POST /luna/<method>   {…params}     → one-shot call, JSON reply
//   WS   /luna-sub/<method>?a=b         → subscription, one JSON frame per respond()
//   GET  /ping                          → bridge health + method list
//
// Usage: node tools/dev-service.mjs   (port 9528; app/src/api/client.js finds it)
import http from 'node:http';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE_DIR = path.join(ROOT, 'service/com.biliwebos.app.service');
const STUB = path.join(ROOT, 'tools/test-node8/stub/webos-service');
const PORT = 9528;

// The service does `require('webos-service')`; point that at the stub without
// polluting node_modules (the Node-8 harness copies it into a temp dir — here
// a resolver hook is cleaner and leaves the checkout untouched).
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'webos-service') return origResolve.call(this, STUB, ...rest);
  return origResolve.call(this, request, ...rest);
};

// The TV writes cookies to /media/internal; on the Mac keep them beside the
// checkout so a dev session persists its login the same way.
const requireCjs = Module.createRequire(path.join(SERVICE_DIR, 'service.js'));
const fs = requireCjs('fs');
const MAC_COOKIES = path.join(ROOT, 'proxy/cookies.json');
if (!fs.existsSync('/media/internal')) {
  try { fs.mkdirSync('/media/internal', { recursive: true }); }
  catch (e) {
    // Can't create it (permissions) — seed the service's in-memory jar from the
    // proxy's cookie file instead, below.
  }
}

console.log('[dev-service] loading real service.js …');
requireCjs('./service.js');
const svc = requireCjs('webos-service').last;
if (!svc) { console.error('[dev-service] service did not register — abort'); process.exit(1); }
const methods = Object.keys(svc.methods).sort();
console.log('[dev-service] registered methods:', methods.join(', '));

// Seed cookies from the proxy jar so dev keeps the same login/buvid3.
if (svc.methods.setCookies && fs.existsSync(MAC_COOKIES)) {
  try {
    const jar = JSON.parse(fs.readFileSync(MAC_COOKIES, 'utf-8'));
    svc.methods.setCookies({ payload: { cookies: jar }, respond() {} });
    console.log('[dev-service] seeded cookies:', Object.keys(jar).join(','));
  } catch (e) { console.warn('[dev-service] cookie seed failed:', e.message); }
}

const call = (method, payload, onRespond, isSub) => {
  const handler = svc.methods[method];
  if (!handler) { onRespond({ returnValue: false, errorText: 'no such method: ' + method }); return; }
  try {
    handler({ payload: payload || {}, isSubscription: !!isSub, respond: onRespond, cancel() {} });
  } catch (e) {
    onRespond({ returnValue: false, errorText: e.message });
  }
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, bridge: 'dev-service', methods }));
    return;
  }
  const m = /^\/luna\/([\w.]+)$/.exec(req.url || '');
  if (!m) { res.writeHead(404); res.end('not found'); return; }

  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let payload = {};
    try { payload = body ? JSON.parse(body) : {}; } catch (e) { /* empty */ }
    let done = false;
    const reply = (r) => {
      if (done) return;             // one-shot: ignore extra respond() calls
      done = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r || {}));
    };
    call(m[1], payload, reply, false);
    setTimeout(() => reply({ returnValue: false, errorText: 'timeout' }), 20000);
  });
});

// Subscriptions (danmakuSubscribe, castSubscribe): every respond() becomes a frame.
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, 'http://localhost');
  const m = /^\/luna-sub\/([\w.]+)$/.exec(u.pathname);
  if (!m) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const payload = {};
    u.searchParams.forEach((v, k) => { payload[k] = /^\d+$/.test(v) ? parseInt(v, 10) : v; });
    console.log('[dev-service] subscribe', m[1], JSON.stringify(payload).slice(0, 80));
    call(m[1], payload, (r) => {
      if (ws.readyState === 1) { try { ws.send(JSON.stringify(r || {})); } catch (e) { /* ignore */ } }
    }, true);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-service] bridge ready on http://127.0.0.1:${PORT}`);
  console.log('[dev-service] the dev app will use the SAME code path as the TV');
});
