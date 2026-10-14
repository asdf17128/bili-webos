// In-memory production DEV client bundle with controlled bridge discovery and
// WebSocket boundaries. No app/dist build, Vite, account, TV or network needed.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const require = createRequire(new URL('../app/package.json', import.meta.url));
const { build } = require('esbuild');
const root = new URL('../', import.meta.url).pathname;
const source = readFileSync(process.env.CLIENT_SOURCE || root + 'app/src/api/client.js', 'utf8');
const bundled = await build({ stdin: { contents: source, resolveDir: root + 'app/src/api', sourcefile: 'client.js' }, bundle: true, write: false,
  format: 'iife', globalName: '__clientUnderTest', platform: 'browser', target: 'es2016', define: { 'import.meta.env.DEV': 'true' } });
const output = process.env.DEV_SUB_OUTPUT || '/tmp/bili-dev-subscription-cleanup';
const results = [];
function fixture() {
  const values = new Map(), sockets = [], probes = [], timers = new Set();
  class Socket {
    constructor(url) { this.url = url; this.closeCalls = 0; this.onmessage = null; sockets.push(this); }
    close() { this.closeCalls++; }
    deliver(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  }
  const sandbox = { console: { info() {} }, URL, URLSearchParams, WebSocket: Socket,
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timers.add(timer); return timer; }, clearTimeout,
    localStorage: { getItem: k => values.get(k) ?? null, setItem: (k, value) => values.set(k, String(value)), removeItem: k => values.delete(k) },
    navigator: { userAgent: 'browser fixture' }, addEventListener() {}, removeEventListener() {},
    fetch(url) { assert.equal(url, 'http://127.0.0.1:9528/ping'); return new Promise(resolve => probes.push(resolve)); },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(bundled.outputFiles[0].text, context);
  return { client: context.__clientUnderTest, sockets,
    async discover(up) { probes.splice(0).forEach(resolve => resolve({ ok: up })); await new Promise(resolve => setImmediate(resolve)); },
    active() { return sockets.filter(socket => socket.closeCalls === 0); },
    dispose() { for (const timer of timers) clearTimeout(timer); },
  };
}
async function check(name, fn) {
  const f = fixture();
  try { const details = await fn(f); results.push({ name, pass: true, ...details }); console.log('PASS', name); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.log('FAIL', name, error.message); }
  finally { f.dispose(); }
}
await check('20 cancellations before successful discovery cannot create late bridge subscriptions', async f => {
  let delivered = 0;
  for (let i = 0; i < 20; i++) { const stop = f.client.danmakuSubscribe({ roomid: i + 1 }, () => delivered++); stop(); stop(); }
  await f.discover(true);
  for (const socket of f.sockets) socket.deliver({ danmaku: 'late' });
  assert.equal(f.active().length, 0, `left ${f.active().length} active WebSockets after cancellation`);
  assert.equal(delivered, 0);
  return { subscriptions: 20, activeSockets: 0, lateDelivered: delivered };
});
await check('successful discovery selects one bridge transport and cleanup suppresses late frames', async f => {
  let delivered = 0;
  const stop = f.client.danmakuSubscribe({ roomid: 1 }, () => delivered++);
  await f.discover(true);
  assert.equal(f.active().length, 1, 'proxy and bridge must not both subscribe');
  assert.ok(f.active()[0].url.includes(':9528/luna-sub/'));
  f.active()[0].deliver({ danmaku: 'active' }); assert.equal(delivered, 1);
  stop(); stop();
  for (const socket of f.sockets) socket.deliver({ danmaku: 'late' });
  assert.equal(delivered, 1); assert.equal(f.active().length, 0); assert.equal(f.sockets[0].closeCalls, 1);
  return { transports: f.sockets.length, activeDelivered: 1, lateDelivered: 0, closeCalls: f.sockets[0].closeCalls };
});
await check('unavailable bridge falls back once and cleanup suppresses late proxy frames', async f => {
  let delivered = 0;
  const stop = f.client.danmakuSubscribe({ roomid: 1 }, () => delivered++);
  await f.discover(false);
  assert.equal(f.active().length, 1); assert.ok(f.active()[0].url.includes('/danmaku?'));
  f.active()[0].deliver({ danmaku: 'active' }); assert.equal(delivered, 1);
  stop(); stop(); f.sockets[0].deliver({ danmaku: 'late' });
  assert.equal(delivered, 1); assert.equal(f.active().length, 0); assert.equal(f.sockets[0].closeCalls, 1);
  return { transports: 1, activeDelivered: 1, lateDelivered: 0, closeCalls: 1 };
});
await check('cancel before failed discovery also suppresses fallback creation', async f => {
  let delivered = 0;
  const stop = f.client.danmakuSubscribe({ roomid: 1 }, () => delivered++); stop();
  await f.discover(false); for (const socket of f.sockets) socket.deliver({ danmaku: 'late' });
  assert.equal(f.active().length, 0); assert.equal(delivered, 0);
  return { activeSockets: 0, lateDelivered: 0 };
});
mkdirSync(output, { recursive: true });
writeFileSync(output + '/results.json', JSON.stringify({ sourceSha256: createHash('sha256').update(source).digest('hex'), at: new Date().toISOString(), results,
  limitations: ['production DEV client logic; discovery and WebSocket events are deterministic fixtures, not a network throughput or native TV test', 'module is compiled in memory with write:false; no production build output is touched'],
}, null, 2) + '\n');
process.exitCode = results.some(row => !row.pass) ? 1 : 0;
