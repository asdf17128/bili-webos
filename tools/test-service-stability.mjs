// Bounded loopback stress: production transport helpers + isolated service.js.
// No account files, external hosts, TV operations, or third-party requests.
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const upstreamRequest = require('../service/com.biliwebos.app.service/upstreamRequest.js');
const readBody = require('../service/com.biliwebos.app.service/httpBody.js');
const rounds = Number(process.env.STABILITY_ROUNDS || 50);
assert.ok(Number.isInteger(rounds) && rounds >= 20 && rounds <= 500, 'STABILITY_ROUNDS must be 20..500');
const output = process.env.STABILITY_OUTPUT || '/tmp/bili-service-stability';
const deadlineMs = 120;
const started = new Date().toISOString();
const results = [], checkpoints = [];
const metrics = { helperRequestsCreated: 0, helperRequestsClosed: 0, helperOperations: 0, proxyOperations: 0, positiveControls: 0 };
const warnings = [];
const warningHandler = warning => warnings.push({ name: warning.name, message: warning.message });
process.on('warning', warningHandler);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const countPool = table => Object.values(table).reduce((n, list) => n + list.length, 0);
const eventually = async (predicate, message, limit = 1500) => {
  const until = performance.now() + limit;
  while (!predicate() && performance.now() < until) await sleep(5);
  assert.ok(predicate(), typeof message === 'function' ? message() : message);
};
async function check(name, fn) {
  const start = performance.now();
  try {
    const detail = await fn();
    results.push({ name, pass: true, ms: Math.round(performance.now() - start), ...detail });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, pass: false, ms: Math.round(performance.now() - start), error: error.stack });
    console.error('FAIL', name, error.message);
  }
}
async function batches(fn, total = rounds, width = 5) {
  for (let start = 0; start < total; start += width) {
    await Promise.all(Array.from({ length: Math.min(width, total - start) }, (_, i) => fn(start + i)));
  }
}
const fixtureSockets = new Set(), fixtureTimers = new Set(), hits = new Map();
const fixture = http.createServer((req, res) => {
  const key = req.url;
  req.socket.fixtureLastPath = key;
  const attempt = (hits.get(key) || 0) + 1; hits.set(key, attempt);
  const mode = key.split('/')[1];
  res.on('error', () => {});
  if (mode === 'reset-always' || (mode === 'reset-once' && attempt === 1)) return req.socket.destroy();
  if (mode === 'header-stall') return;
  if (mode === 'truncate' || mode === 'body-stall') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 100 });
    res.write('{"code":');
    if (mode === 'truncate') {
      const timer = setTimeout(() => { fixtureTimers.delete(timer); res.destroy(); }, 8);
      fixtureTimers.add(timer);
    }
    return;
  }
  if (mode === 'http503') { res.writeHead(503); res.end('busy'); return; }
  if (mode === 'gzip-bad') { res.writeHead(200, { 'Content-Encoding': 'gzip' }); res.end('not gzip'); return; }
  const body = JSON.stringify({ code: 0, data: { mode, attempt } });
  if (mode === 'gzip-good') { res.writeHead(200, { 'Content-Encoding': 'gzip' }); res.end(zlib.gzipSync(body)); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body);
});
fixture.on('connection', socket => { fixtureSockets.add(socket); socket.once('close', () => fixtureSockets.delete(socket)); });
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const port = fixture.address().port;
const agent = new http.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 8 });
const requests = new Set();
let serial = 0;
const options = (path, selectedAgent = agent) => ({ hostname: '127.0.0.1', port, path, agent: selectedAgent });
function trackedRequest(opts, cb) {
  const req = http.request(opts, cb); metrics.helperRequestsCreated++; requests.add(req);
  req.once('close', () => { metrics.helperRequestsClosed++; requests.delete(req); });
  return req;
}
function begin(mode, { method = 'GET', body = null, selectedAgent = agent, requestOptions = {}, timeout = deadlineMs } = {}) {
  const path = '/' + mode + '/' + (++serial);
  const record = { path, headerCallbacks: 0, bodyCallbacks: 0, retries: 0, calls: 0, cancelled: false };
  const start = performance.now();
  let handle;
  const promise = new Promise(resolve => {
    handle = upstreamRequest((opts, cb) => { record.calls++; return trackedRequest(opts, cb); },
      { ...options(path, selectedAgent), method, ...requestOptions }, body, (error, res) => {
        record.headerCallbacks++;
        if (error) return resolve({ error: error.code || error.message, ms: performance.now() - start, record });
        readBody(res, (error, bytes) => {
          record.bodyCallbacks++;
          resolve({ error: error && (error.code || error.message), status: res.statusCode, body: bytes && bytes.toString(), ms: performance.now() - start, record });
        });
      }, timeout, () => record.retries++);
  });
  metrics.helperOperations++;
  return { path, record, promise, cancel() { record.cancelled = true; handle.cancel(); } };
}
async function complete(operation) {
  let timer;
  try {
    return await Promise.race([operation.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('operation exceeded 1.5s watchdog: ' + operation.path)), 1500); })]);
  } finally { clearTimeout(timer); }
}
async function healthy(selectedAgent = agent) {
  const result = await complete(begin('healthy', { selectedAgent, timeout: 700 }));
  assert.equal(result.error, null); assert.equal(result.status, 200); assert.equal(JSON.parse(result.body).code, 0);
  assert.equal(result.record.headerCallbacks, 1); assert.equal(result.record.bodyCallbacks, 1);
}
async function drain(label, selectedAgent = agent, limit = 8) {
  await eventually(() => countPool(selectedAgent.sockets) === 0 && countPool(selectedAgent.requests) === 0 && requests.size === 0, 'unfinished requests/pool queue after ' + label);
  const snapshot = { label, active: countPool(selectedAgent.sockets), queued: countPool(selectedAgent.requests), idle: countPool(selectedAgent.freeSockets), ownedRequests: requests.size, fixtureConnections: fixtureSockets.size };
  assert.ok(snapshot.idle <= limit, 'idle pool exceeds configured maximum');
  // Different agents may retain bounded idle sockets; the final destruction
  // check below independently verifies zero owned sockets and requests.
  checkpoints.push(snapshot);
}

let service, serviceAgent, serviceServer, serviceDefaultAgent;
const serviceTimers = new Set();
const reportPath = output + '/results.json';
await mkdir(output, { recursive: true });
// A hard upper bound also produces a machine-readable failure instead of an
// indefinite "test running" if a future regression strands an await.
const watchdog = setTimeout(async () => {
  await writeFile(reportPath, JSON.stringify({ started, completed: false, error: '180s suite watchdog', metrics, results, checkpoints }, null, 2));
  process.exit(2);
}, 180000);
try {
  await check('positive controls distinguish raw socket failure and incomplete body', async () => {
    const resetPath = '/reset-always/control';
    const reset = await new Promise(resolve => { const req = http.get(options(resetPath, false)); req.on('error', resolve); });
    assert.equal(reset.code, 'ECONNRESET'); assert.equal(hits.get(resetPath), 1);
    let plainBodyEnded = false, plainBodyClosed = false;
    await new Promise(resolve => {
      const req = http.get(options('/truncate/control', false), res => {
        res.resume(); res.on('end', () => { plainBodyEnded = true; }); res.on('error', () => {});
        res.on('close', () => { plainBodyClosed = true; resolve(); });
      }); req.on('error', resolve);
    });
    assert.equal(plainBodyClosed, true); assert.equal(plainBodyEnded, false, 'naive end-only consumer would incorrectly settle');
    let socketTimedOut = false;
    const pending = http.get({ hostname: 'fixture.invalid', lookup() {} }); pending.on('error', () => {});
    pending.setTimeout(30, () => { socketTimedOut = true; });
    await sleep(90); assert.equal(socketTimedOut, false); pending.destroy();
    metrics.positiveControls += 3;
    return { rawReset: reset.code, truncatedStreamHasNoEnd: true, socketTimeoutMissesPendingDns: true };
  });

  for (const scenario of [
    { mode: 'healthy', error: false, attempts: 1 },
    { mode: 'gzip-good', error: false, attempts: 1 },
    { mode: 'reset-once', error: false, attempts: 2, retries: 1 },
    { mode: 'reset-always', error: 'ECONNRESET', attempts: 2, retries: 1 },
    { mode: 'reset-always', method: 'POST', body: 'fixture-write', error: 'ECONNRESET', attempts: 1 },
    { mode: 'http503', error: false, attempts: 1, status: 503 },
    { mode: 'truncate', error: true, attempts: 1 },
    { mode: 'body-stall', error: true, attempts: 1 },
    { mode: 'header-stall', error: 'ETIMEDOUT', attempts: 1 },
    { mode: 'gzip-bad', error: true, attempts: 1 },
  ]) {
    await check(`${rounds} × ${scenario.method || 'GET'} ${scenario.mode}, followed by healthy recovery`, async () => {
      const records = [], times = [];
      await batches(async () => {
        const op = begin(scenario.mode, { method: scenario.method, body: scenario.body });
        const result = await complete(op); records.push(result.record); times.push(result.ms);
        if (scenario.error === false) assert.equal(result.error, null);
        else if (typeof scenario.error === 'string') assert.equal(result.error, scenario.error);
        else assert.ok(result.error, 'incomplete/corrupt response accepted');
        if (!scenario.error) assert.equal(result.status, scenario.status || 200);
        assert.equal(result.record.calls, scenario.attempts);
        assert.equal(hits.get(op.path), scenario.attempts);
        assert.equal(result.record.retries, scenario.retries || 0);
        assert.equal(result.record.headerCallbacks, 1);
        if (result.status) assert.equal(result.record.bodyCallbacks, 1);
        if (scenario.mode.includes('stall')) assert.ok(result.ms >= deadlineMs * 0.8 && result.ms < 700, 'deadline outside bound');
        await healthy();
      });
      // Let every short deadline elapse before asserting no delayed duplicate
      // callback, then verify the next workload can reuse the same pool.
      await sleep(deadlineMs + 20);
      assert.ok(records.every(record => record.headerCallbacks === 1 && record.bodyCallbacks <= 1));
      await drain(scenario.mode);
      times.sort((a, b) => a - b);
      return { iterations: rounds, recoveryRequests: rounds, p95Ms: Math.round(times[Math.ceil(times.length * .95) - 1]), maxMs: Math.round(times.at(-1)) };
    });
  }

  await check(`${rounds} × pending DNS deadline and cancellation`, async () => {
    const cancelled = [];
    await batches(async () => {
      const requestOptions = { hostname: 'fixture.invalid', lookup() {}, agent: false };
      const timeout = begin('dns', { requestOptions });
      const result = await complete(timeout);
      assert.equal(result.error, 'ETIMEDOUT'); assert.equal(result.record.calls, 1);
      const cancel = begin('dns', { requestOptions }); cancelled.push(cancel.record); cancel.cancel();
      await healthy();
    });
    await sleep(deadlineMs + 20);
    assert.ok(cancelled.every(record => record.headerCallbacks === 0));
    await drain('pending-dns');
    return { timeouts: rounds, cancellations: rounds, lateCallbacks: 0 };
  });

  await check(`${rounds} × cancel active retry then reuse connection pool`, async () => {
    const cancelled = [];
    await batches(async () => {
      // The first attempt resets. The second is deliberately held without
      // headers so cancel must follow the new request, not the old socket.
      // This case uses a dedicated callback factory below: choose the held
      // path per attempt while retaining the production retry implementation.
      let calls = 0, callbacks = 0, retryPath = '/header-stall/retry-' + (++serial);
      const handle = upstreamRequest((opts, cb) => {
        calls++;
        return trackedRequest({ ...opts, path: calls === 1 ? '/reset-always/cancel-' + serial : retryPath }, cb);
      }, options('/unused'), null, () => callbacks++, deadlineMs);
      metrics.helperOperations++;
      await eventually(() => hits.get(retryPath) === 1, 'active retry never reached fixture');
      handle.cancel(); cancelled.push(() => callbacks);
      assert.equal(calls, 2); await healthy();
    });
    await sleep(deadlineMs + 20);
    assert.ok(cancelled.every(value => value() === 0)); await drain('cancel-retry');
    return { cancelledRetries: rounds, lateCallbacks: 0 };
  });

  await check(`${rounds} × saturated pool, 12 expirations + 6 cancellations, then recovery`, async () => {
    const pool = new http.Agent({ keepAlive: true, maxSockets: 2, maxFreeSockets: 2 });
    try {
      for (let i = 0; i < rounds; i++) {
        const blockers = Array.from({ length: 2 }, () => begin('header-stall', { selectedAgent: pool, timeout: 1000 }));
        await eventually(() => blockers.every(op => hits.get(op.path) === 1), 'pool blockers did not acquire sockets');
        const expiring = Array.from({ length: 12 }, () => begin('healthy', { selectedAgent: pool }));
        const cancelled = Array.from({ length: 6 }, () => begin('healthy', { selectedAgent: pool }));
        assert.equal(countPool(pool.requests), 18, 'requests did not queue behind saturated pool');
        cancelled.forEach(op => op.cancel());
        const replies = await Promise.all(expiring.map(complete));
        assert.ok(replies.every(result => result.error === 'ETIMEDOUT'));
        assert.ok([...expiring, ...cancelled].every(op => !hits.has(op.path)), 'cancelled/expired queued request reached fixture');
        blockers.forEach(op => op.cancel());
        await healthy(pool);
        await drain('queue-round-' + i, pool, 2);
        assert.ok(cancelled.every(op => op.record.headerCallbacks === 0));
        assert.ok(blockers.every(op => op.record.headerCallbacks === 0));
      }
    } finally { pool.destroy(); }
    return { rounds, expiredQueuedRequests: rounds * 12, cancelledQueuedRequests: rounds * 6, recoveryRequests: rounds };
  });

  await check('isolated production service starts without account files or external sockets', async () => {
    const source = new URL('../service/com.biliwebos.app.service/service.js', import.meta.url);
    const serviceRequire = createRequire(source);
    function Service() { this.methods = {}; this.activityManager = { create() {} }; service = this; }
    Service.prototype.register = function (name, callback) { this.methods[name] = callback; };
    const disk = new Map();
    // Modern Node's default HTTP agent retains idle sockets. Own that pool as
    // well as the service's explicit pool, so fixture teardown is complete.
    serviceDefaultAgent = new http.Agent({ keepAlive: true });
    function FixtureAgent(opts) { serviceAgent = new http.Agent(opts); return serviceAgent; }
    vm.runInNewContext(readFileSync(source, 'utf8'), {
      require(name) {
        if (name === 'webos-service') return Service;
        if (name === 'https') return { Agent: FixtureAgent, request: (opts, cb) => http.request({ ...opts, agent: opts.agent === undefined ? serviceDefaultAgent : opts.agent, hostname: '127.0.0.1', port }, cb) };
        if (name === 'http') return { ...http, createServer(handler) {
          serviceServer = http.createServer(handler);
          const listen = serviceServer.listen.bind(serviceServer);
          serviceServer.listen = (...args) => listen(0, '127.0.0.1', typeof args.at(-1) === 'function' ? args.at(-1) : undefined);
          return serviceServer;
        } };
        if (name === 'fs') return { existsSync: p => disk.has(p), readFileSync: p => disk.get(p), writeFileSync: (p, data) => disk.set(p, data) };
        if (name === './cast/ssdpServer') return { CastLanServer: class { start() {} } };
        if (name === './danmaku') return {};
        return serviceRequire(name);
      },
      Buffer, console: { log() {}, error() {} }, process: { version: process.version, uptime: process.uptime, on() {} },
      setTimeout: (fn, ms) => { const timer = setTimeout(() => { serviceTimers.delete(timer); fn(); }, ms); serviceTimers.add(timer); return timer; },
      clearTimeout: timer => { serviceTimers.delete(timer); clearTimeout(timer); },
    }, { filename: source.pathname });
    if (!serviceServer.listening) await new Promise(resolve => serviceServer.once('listening', resolve));
    const diag = await new Promise(resolve => service.methods.getDiagnostics({ payload: {}, respond: resolve }));
    assert.equal(diag.loggedIn, false);
    return { isolation: 'production source, only filesystem/network/webOS side effects replaced', loggedIn: false };
  });

  function proxyRequest(mode, cancelAt) {
    metrics.proxyOperations++;
    const upstreamPath = '/' + mode + '/proxy-' + (++serial);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, data) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(data); };
      const req = http.get({ hostname: '127.0.0.1', port: serviceServer.address().port, path: '/proxy/api.bilibili.com' + upstreamPath, agent: false }, res => {
        if (cancelAt === 'body') { res.once('data', () => { req.destroy(); finish(null, { cancelled: true }); }); res.on('error', () => {}); return; }
        readBody(res, (error, bytes) => finish(null, { error: error && error.message, status: res.statusCode, bytes: bytes && bytes.toString(), cors: res.headers['access-control-allow-origin'] }));
      });
      const timer = setTimeout(() => { req.destroy(); finish(new Error('proxy operation exceeded 1.5s')); }, 1500);
      req.on('error', error => { if (cancelAt) finish(null, { cancelled: true }); else finish(error); });
      if (cancelAt === 'headers') eventually(() => hits.has(upstreamPath), 'proxy upstream did not start').then(() => { req.destroy(); finish(null, { cancelled: true }); }, finish);
    });
  }
  for (const scenario of [
    { mode: 'header-stall', cancelAt: 'headers' },
    { mode: 'body-stall', cancelAt: 'body' },
    { mode: 'truncate' },
    { mode: 'reset-always' },
  ]) {
    await check(`${rounds} × production proxy ${scenario.mode}/${scenario.cancelAt || 'error'} then recovery`, async () => {
      assert.ok(serviceServer, 'isolated service failed to start');
      await batches(async () => {
        const failed = await proxyRequest(scenario.mode, scenario.cancelAt);
        if (scenario.cancelAt) assert.equal(failed.cancelled, true);
        else if (scenario.mode === 'truncate') assert.ok(failed.error, 'truncated proxy response completed successfully');
        else { assert.equal(failed.status, 502); assert.equal(failed.cors, '*'); }
        const recovered = await proxyRequest('healthy');
        assert.equal(recovered.error, null); assert.equal(recovered.status, 200); assert.equal(JSON.parse(recovered.bytes).code, 0);
      }, rounds, 4);
      await eventually(() => countPool(serviceAgent.sockets) === 0 && countPool(serviceAgent.requests) === 0, 'production proxy left active upstream requests');
      assert.ok(countPool(serviceAgent.freeSockets) <= 8);
      checkpoints.push({ label: 'proxy-' + scenario.mode + '-' + (scenario.cancelAt || 'error'), active: countPool(serviceAgent.sockets), queued: countPool(serviceAgent.requests), idle: countPool(serviceAgent.freeSockets), fixtureConnections: fixtureSockets.size });
      return { iterations: rounds, recoveryRequests: rounds, activeUpstreamsAfter: 0, queuedAfter: 0 };
    });
  }
} finally {
  for (const timer of [...fixtureTimers, ...serviceTimers]) clearTimeout(timer);
  agent.destroy(); if (serviceAgent) serviceAgent.destroy(); if (serviceDefaultAgent) serviceDefaultAgent.destroy();
  for (const req of requests) req.destroy();
  if (serviceServer) await new Promise(resolve => { serviceServer.closeAllConnections(); serviceServer.close(resolve); });
  await check('all owned upstream requests, server sockets and pool slots are released', async () => {
    await eventually(() => fixtureSockets.size === 0 && requests.size === 0, () => 'socket/request survives explicit pool destruction: ' + JSON.stringify({ sockets: [...fixtureSockets].map(socket => ({ path: socket.fixtureLastPath, destroyed: socket.destroyed, readableEnded: socket.readableEnded, writableEnded: socket.writableEnded })), requests: requests.size }));
    assert.equal(metrics.helperRequestsCreated, metrics.helperRequestsClosed);
    assert.equal(countPool(agent.requests), 0); assert.equal(countPool(agent.sockets), 0); assert.equal(countPool(agent.freeSockets), 0);
    assert.deepEqual(warnings, []);
    return { fixtureSockets: fixtureSockets.size, ownedRequests: requests.size, created: metrics.helperRequestsCreated, closed: metrics.helperRequestsClosed, warnings };
  });
  for (const socket of fixtureSockets) socket.destroy();
  await new Promise(resolve => fixture.close(resolve));
  clearTimeout(watchdog); process.removeListener('warning', warningHandler);
  const report = { started, finished: new Date().toISOString(), completed: true, node: process.version, rounds, deadlineMs, metrics, results, checkpoints,
    limitations: ['loopback HTTP does not test TLS, real DNS infrastructure, webOS Node runtime, overseas routing, device memory/GPU, or 24h longevity', 'DNS stall is an injected lookup callback; cancellation and all HTTP failures use real ClientRequest/socket lifecycle', 'service proxy runs unmodified service.js with isolated filesystem/webOS and loopback HTTPS transport replacement', 'resource assertions cover owned ClientRequests, Agent queues and sockets; no claim about all process memory or activeHandles'] };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`${results.filter(r => r.pass).length}/${results.length} passed; ${reportPath}`);
  process.exitCode = results.some(r => !r.pass) ? 1 : 0;
}
