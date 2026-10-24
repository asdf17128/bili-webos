// Execute production service.js request/cancel handlers with isolated webOS,
// disk and relay boundaries. No TV, account credentials or external network.
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = new URL('../service/com.biliwebos.app.service/service.js', import.meta.url);
const require = createRequire(source);
const sourceText = readFileSync(process.env.SERVICE_SOURCE || source, 'utf8');
const output = process.env.SERVICE_SUB_OUTPUT || '/tmp/bili-service-subscriptions';
const results = [];
const rounds = 50;
async function fixture() {
  let service, server, agent;
  const relay = { opened: 0, stopped: 0, broadcast: null };
  function Service() { service = this; this.methods = {}; this.activityManager = { create() {} }; }
  Service.prototype.register = function (name, request, cancel) { this.methods[name] = { request, cancel }; };
  const context = vm.createContext({
    require(name) {
      if (name === 'webos-service') return Service;
      if (name === 'https') return { Agent: function (options) { agent = new http.Agent(options); return agent; }, request() { throw new Error('unexpected upstream request'); } };
      if (name === 'http') return { ...http, createServer(handler) {
        server = http.createServer(handler); const listen = server.listen.bind(server);
        server.listen = (...args) => listen(0, '127.0.0.1', typeof args.at(-1) === 'function' ? args.at(-1) : undefined); return server;
      } };
      if (name === 'fs') return { existsSync: p => p.endsWith('bili_cookies.json'), readFileSync: () => '{"buvid3":"anonymous-fixture"}', writeFileSync() {} };
      if (name === './cast/ssdpServer') return { CastLanServer: class { start() {} } };
      if (name === './danmaku') return { connectDanmaku(_opts, broadcast) { relay.opened++; relay.options = _opts; relay.broadcast = broadcast; return () => { relay.stopped++; }; } };
      return require(name);
    },
    Buffer, console: { log() {}, error() {} }, process: { version: process.version, uptime: process.uptime, on() {} }, setTimeout, clearTimeout,
  });
  vm.runInContext(sourceText, context, { filename: source.pathname });
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  return {
    context, relay,
    subscribe(method, token) {
      const replies = [];
      const message = { uniqueToken: token, isSubscription: true, payload: { subscribe: true, roomid: 1, token: 'fixture-relay-token' }, respond: data => replies.push(data) };
      service.methods[method].request(message);
      return { message, replies };
    },
    cancel(method, message) { const callback = service.methods[method].cancel; if (callback) callback(message); return !!callback; },
    async close() { agent.destroy(); await new Promise(resolve => server.close(resolve)); },
  };
}
async function check(name, fn) {
  const f = await fixture();
  try { const details = await fn(f); results.push({ name, pass: true, ...details }); console.log('PASS', name); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.log('FAIL', name, error.message); }
  finally { await f.close(); }
}

await check('50 cast subscribe/cancel cycles leave no references or stale broadcast', async f => {
  const messages = [];
  for (let i = 0; i < rounds; i++) { const sub = f.subscribe('castSubscribe', 'cast-' + i); messages.push(sub); f.cancel('castSubscribe', { uniqueToken: sub.message.uniqueToken }); }
  const retained = f.context.castSubscribers.length;
  f.context.notifyCastSubscribers({ kind: 'fixture-event' });
  const staleReplies = messages.reduce((sum, sub) => sum + sub.replies.length - 1, 0);
  assert.equal(retained, 0, `retained ${retained} cancelled cast messages`); assert.equal(staleReplies, 0);
  return { created: rounds, retained, staleReplies };
});
await check('cast cancellation matches token without removing another subscriber', async f => {
  const a = f.subscribe('castSubscribe', 'cast-a'), b = f.subscribe('castSubscribe', 'cast-b');
  assert.equal(f.cancel('castSubscribe', { uniqueToken: 'cast-a' }), true, 'missing registered cancel callback');
  f.cancel('castSubscribe', { uniqueToken: 'cast-a' });
  f.cancel('castSubscribe', { uniqueToken: 'unknown' });
  f.context.notifyCastSubscribers({ kind: 'fixture-event' });
  assert.equal(a.replies.length, 1); assert.equal(b.replies.length, 2); assert.equal(f.context.castSubscribers.length, 1);
  f.cancel('castSubscribe', { uniqueToken: 'cast-b' }); assert.equal(f.context.castSubscribers.length, 0);
  return { activeSubscriberKept: true, duplicateCancelSafe: true };
});
await check('live relay uses the current service identity after repair', async f => {
  f.context.storedCookies.buvid3 = 'repaired-fixture';
  const sub = f.subscribe('danmakuSubscribe', 'identity');
  assert.equal(f.relay.options.buvid, 'repaired-fixture');
  f.cancel('danmakuSubscribe', {uniqueToken:sub.message.uniqueToken});
  return {currentIdentityUsed:true};
});
await check('50 live subscribe/cancel cycles close idle relay immediately', async f => {
  for (let i = 0; i < rounds; i++) { const sub = f.subscribe('danmakuSubscribe', 'live-' + i); f.cancel('danmakuSubscribe', { uniqueToken: sub.message.uniqueToken }); }
  assert.equal(f.context.danmakuSubscribers.length, 0, `retained ${f.context.danmakuSubscribers.length} cancelled live messages`);
  assert.equal(f.relay.opened, rounds); assert.equal(f.relay.stopped, rounds); assert.equal(f.context.danmakuRoom, null);
  return { created: rounds, retained: 0, relayOpened: f.relay.opened, relayStopped: f.relay.stopped };
});
await check('live relay remains while one listener survives and stops after the last', async f => {
  const a = f.subscribe('danmakuSubscribe', 'live-a'), b = f.subscribe('danmakuSubscribe', 'live-b');
  f.cancel('danmakuSubscribe', { uniqueToken: 'live-a' }); f.cancel('danmakuSubscribe', { uniqueToken: 'live-a' });
  assert.equal(f.relay.stopped, 0); assert.equal(f.relay.opened, 1);
  f.relay.broadcast('fixture chat'); assert.equal(a.replies.length, 1); assert.equal(b.replies.length, 2);
  f.cancel('danmakuSubscribe', { uniqueToken: 'live-b' }); assert.equal(f.relay.stopped, 1); assert.equal(f.context.danmakuSubscribers.length, 0);
  return { opened: 1, stopped: 1, activeSubscriberKept: true };
});
await check('identity fallback does not treat all missing tokens as one subscription', async f => {
  const a = f.subscribe('castSubscribe', undefined), b = f.subscribe('castSubscribe', undefined);
  f.cancel('castSubscribe', a.message);
  assert.equal(f.context.castSubscribers.length, 1); assert.equal(f.context.castSubscribers[0], b.message);
  f.cancel('castSubscribe', {}); assert.equal(f.context.castSubscribers.length, 1);
  f.cancel('castSubscribe', b.message); assert.equal(f.context.castSubscribers.length, 0);
  return { identityFallback: true, unknownMissingTokenSafe: true };
});
await mkdir(output, { recursive: true });
await writeFile(output + '/results.json', JSON.stringify({ at: new Date().toISOString(), sourceSha256: createHash('sha256').update(sourceText).digest('hex'), rounds, results,
  limitations: ['production handlers execute in VM; native LS2 cancellation delivery must also be tested on TV', 'relay connect/stop is a controlled boundary; no claim that this alone verifies actual WebSocket teardown'],
  references: ['https://webostv.developer.lge.com/develop/references/webos-service-reference', 'https://webostv.developer.lge.com/develop/guides/js-service-usage'],
}, null, 2) + '\n');
process.exitCode = results.some(row => !row.pass) ? 1 : 0;
