// Real loopback WebSockets through the production dev bridge dispatch, the
// actual webos-service stub and production service.js subscription handlers.
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const serviceSource = new URL('../service/com.biliwebos.app.service/service.js', import.meta.url);
const serviceText = readFileSync(serviceSource, 'utf8');
const bridgeText = readFileSync(process.env.BRIDGE_SOURCE || new URL('./dev-service.mjs', import.meta.url), 'utf8');
const dispatchStart = bridgeText.indexOf('let nextMessageToken') >= 0 ? bridgeText.indexOf('let nextMessageToken') : bridgeText.indexOf('const call =');
const dispatchEnd = bridgeText.indexOf('\nserver.listen(PORT');
assert.ok(dispatchStart >= 0 && dispatchEnd > dispatchStart, 'bridge dispatch boundaries missing');
const require = createRequire(serviceSource);
const Stub = require('../../tools/test-node8/stub/webos-service/index.js');
const output = process.env.BRIDGE_SUB_OUTPUT || '/tmp/bili-dev-bridge-subscriptions';
const results = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture() {
  let local, agent;
  const timers = new Set();
  const context = vm.createContext({
    require(name) {
      if (name === 'webos-service') return Stub;
      if (name === 'https') return { Agent: function (opts) { agent = new http.Agent(opts); return agent; }, request() { throw new Error('unexpected external request'); } };
      if (name === 'http') return { ...http, createServer(handler) {
        local = http.createServer(handler); const listen = local.listen.bind(local);
        local.listen = (...args) => listen(0, '127.0.0.1', typeof args.at(-1) === 'function' ? args.at(-1) : undefined); return local;
      } };
      if (name === 'fs') return { existsSync: p => p.endsWith('bili_cookies.json'), readFileSync: () => '{"buvid3":"anonymous-fixture"}', writeFileSync() {} };
      if (name === './cast/ssdpServer') return { CastLanServer: class { start() {} } };
      if (name === './danmaku') return {};
      return require(name);
    },
    Buffer, console: { log() {}, error() {} }, process: { version: process.version, uptime: process.uptime, on() {} }, setTimeout, clearTimeout,
  });
  vm.runInContext(serviceText, context, { filename: serviceSource.pathname });
  if (!local.listening) await new Promise(resolve => local.once('listening', resolve));
  const bridgeContext = vm.createContext({
    http, WebSocketServer, URL, svc: Stub.last, methods: Object.keys(Stub.last.methods), console: { log() {} },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; }, clearTimeout,
  });
  vm.runInContext(bridgeText.slice(dispatchStart, dispatchEnd) + '\nglobalThis.fixtureBridge = { server, wss };', bridgeContext);
  const { server, wss } = bridgeContext.fixtureBridge;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const clients = new Set();
  return { context,
    open(method) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket('ws://127.0.0.1:' + server.address().port + '/luna-sub/' + method + '?subscribe=true');
        clients.add(ws); const timeout = setTimeout(() => { ws.terminate(); reject(new Error('no initial subscription frame')); }, 1000);
        ws.on('error', reject);
        ws.once('message', bytes => {
          clearTimeout(timeout);
          try { const reply = JSON.parse(bytes.toString()); assert.equal(reply.subscribed, true); resolve(ws); }
          catch (error) { reject(error); }
        });
      });
    },
    async closeClient(ws) {
      const expected = clients.size - 1;
      const closed = new Promise(resolve => ws.once('close', resolve)); ws.close(); await closed; clients.delete(ws);
      const until = Date.now() + 1000;
      while (wss.clients.size > expected && Date.now() < until) await sleep(1);
      assert.equal(wss.clients.size, expected, 'bridge did not observe the closed socket');
    },
    async close() {
      for (const ws of clients) ws.terminate(); for (const ws of wss.clients) ws.terminate();
      for (const timer of timers) clearTimeout(timer);
      await new Promise(resolve => wss.close(resolve)); agent.destroy();
      await Promise.all([server, local].map(s => new Promise(resolve => { s.closeAllConnections(); s.close(resolve); })));
    },
  };
}
async function check(name, fn) {
  const f = await fixture();
  try { const details = await fn(f); results.push({ name, pass: true, ...details }); console.log('PASS', name); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.log('FAIL', name, error.message); }
  finally { await f.close(); }
}
for (const [method, list] of [['castSubscribe', 'castSubscribers'], ['danmakuSubscribe', 'danmakuSubscribers']]) {
  await check(`50 real WebSocket ${method} close cycles return service to baseline`, async f => {
    const tokens = [];
    for (let i = 0; i < 50; i++) {
      const ws = await f.open(method); tokens.push(f.context[list].at(-1).uniqueToken); await f.closeClient(ws);
    }
    assert.equal(f.context[list].length, 0, `retained ${f.context[list].length} service messages after 50 WebSocket closes`);
    assert.equal(new Set(tokens).size, 50); assert.ok(tokens.every(token => typeof token === 'string'));
    return { cycles: 50, retained: 0, uniqueTokens: 50 };
  });
}
await check('closing one bridge connection preserves another subscription', async f => {
  const a = await f.open('castSubscribe'), b = await f.open('castSubscribe');
  await f.closeClient(a); assert.equal(f.context.castSubscribers.length, 1);
  const next = new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('active subscription did not receive event')), 1000); b.once('message', bytes => { clearTimeout(timeout); resolve(JSON.parse(bytes.toString())); }); });
  f.context.notifyCastSubscribers({ kind: 'fixture-event' }); assert.equal((await next).event.kind, 'fixture-event');
  await f.closeClient(b); assert.equal(f.context.castSubscribers.length, 0);
  return { activeListenerKept: true, finalRetained: 0 };
});
await mkdir(output, { recursive: true });
await writeFile(output + '/results.json', JSON.stringify({ at: new Date().toISOString(), bridgeSourceSha256: createHash('sha256').update(bridgeText).digest('hex'), serviceSourceSha256: createHash('sha256').update(serviceText).digest('hex'), results,
  limitations: ['actual bridge dispatch/HTTP/WS handler source executes with the real stub and isolated production service; bridge process startup/module-loader hook is covered by simulator separately', 'all WebSockets are loopback; no TV LS2 bus, real relay, real cookie files or outside hosts'],
}, null, 2) + '\n');
process.exitCode = results.some(row => !row.pass) ? 1 : 0;
