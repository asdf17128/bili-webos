// Anonymous fingerprint bootstrap, real 10s deadlines / 15s backoff. Loopback
// only, isolated disk/webOS, no TV or real credentials. Old-source comparison:
// BUVID_SOURCE=/tmp/old-service.js BUVID_BASELINE=1 node tools/test-buvid-stability.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = new URL('../service/com.biliwebos.app.service/service.js', import.meta.url);
const require = createRequire(source);
const sourceText = readFileSync(process.env.BUVID_SOURCE || source, 'utf8');
const output = process.env.BUVID_OUTPUT || '/tmp/bili-buvid-stability';
const baseline = process.env.BUVID_BASELINE === '1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const count = table => Object.values(table).reduce((sum, entries) => sum + entries.length, 0);
const modes = ['dns', 'headers', 'truncated', 'body-stall', 'invalid-json', 'null-json', 'http503', 'always-invalid'];
const uncaughtErrors = [];
// Production catches uncaught errors process-wide. Preserve the old null-body
// failure without killing this evidence collector; any such error fails gate.
const observeUncaught = error => uncaughtErrors.push({ name: error.name, message: error.message });
const started = Date.now();

async function fixture(mode) {
  const sockets = new Set(), requests = new Set(), timers = new Set(), disk = new Map();
  const state = { mode, starts: [], closes: [], bodyErrors: [], logs: [], attempts: 0 };
  let service, local, agent, closing = false;
  const defaultAgent = new http.Agent({ keepAlive: true });
  const server = http.createServer((req, res) => {
    res.on('error', () => {});
    const fail = req.url.includes('/finger/spi') && (state.attempts === 1 || mode === 'always-invalid');
    if (fail && mode === 'headers') return;
    if (fail && (mode === 'truncated' || mode === 'body-stall')) {
      res.writeHead(200, { 'Content-Length': 100 }); res.write('{"code":');
      if (mode === 'truncated') {
        const timer = setTimeout(() => { timers.delete(timer); res.destroy(); }, 10); timers.add(timer);
      }
      return;
    }
    if (fail && (mode === 'invalid-json' || mode === 'always-invalid')) { res.end('broken json'); return; }
    if (fail && mode === 'null-json') { res.end('null'); return; }
    if (fail && mode === 'http503') { res.writeHead(503); res.end('{"code":0,"data":{"b_3":"must-not-accept-error-status"}}'); return; }
    res.end(JSON.stringify({ code: 0, data: { b_3: 'fixture-buvid-' + mode, b_4: 'fixture-anonymous-four' } }));
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  function Service() { service = this; this.methods = {}; this.activityManager = { create() {} }; }
  Service.prototype.register = function (name, cb) { this.methods[name] = cb; };
  function Agent(options) { agent = new http.Agent(options); return agent; }
  vm.runInNewContext(sourceText, {
    require(name) {
      if (name === 'webos-service') return Service;
      if (name === 'https') return { Agent, request(opts, callback) {
        const bootstrap = opts.path.includes('/finger/spi');
        if (bootstrap) { state.attempts++; state.starts.push(Date.now() - started); }
        const attempt = state.attempts;
        const requestOptions = { ...opts, hostname: '127.0.0.1', port: server.address().port, agent: opts.agent === undefined ? defaultAgent : opts.agent };
        if (bootstrap && attempt === 1 && mode === 'dns') { requestOptions.hostname = 'fixture.invalid'; requestOptions.lookup = () => {}; }
        const req = http.request(requestOptions, res => {
          // The harness must survive the old unhandled response error. Record
          // whether production attached any error handler besides this guard.
          const guard = error => state.bodyErrors.push({ code: error.code || error.message, applicationErrorListeners: res.listeners('error').filter(fn => fn !== guard).length });
          res.on('error', guard); callback(res);
        });
        requests.add(req);
        req.once('close', () => { requests.delete(req); if (bootstrap) state.closes.push({ attempt, atMs: Date.now() - started }); });
        return req;
      } };
      if (name === 'http') return { ...http, createServer(handler) {
        local = http.createServer(handler); const listen = local.listen.bind(local);
        local.listen = (...args) => listen(0, '127.0.0.1', typeof args.at(-1) === 'function' ? args.at(-1) : undefined); return local;
      } };
      if (name === 'fs') return { existsSync: p => disk.has(p), readFileSync: p => disk.get(p), writeFileSync: (p, data) => disk.set(p, data) };
      if (name === './cast/ssdpServer') return { CastLanServer: class { start() {} } };
      if (name === './danmaku') return {};
      return require(name);
    },
    Buffer, console: { log() {}, error: (...items) => state.logs.push(items.join(' ')) },
    process: { version: process.version, uptime: process.uptime, on() {} },
    setTimeout: (fn, ms) => {
      if (closing) return 0;
      // The budget case compresses only the five 15s retries; the six recovery
      // scenarios retain both production wall-clock values unchanged.
      const timer = setTimeout(() => { timers.delete(timer); fn(); }, mode === 'always-invalid' && ms === 15000 ? 20 : ms);
      timers.add(timer); return timer;
    },
    clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); },
  }, { filename: source.pathname });
  if (!local.listening) await new Promise(resolve => local.once('listening', resolve));
  const cookies = () => JSON.parse(disk.get('/media/internal/bili_cookies.json') || '{}');
  const snapshot = () => ({ atMs: Date.now() - started, outstandingRequests: requests.size, sockets: sockets.size, active: count(agent.sockets), queued: count(agent.requests), idle: count(agent.freeSockets), fingerprint: cookies().buvid3 || null, retryTimers: timers.size });
  return { state, snapshot, cookies,
    async healthy() {
      const result = await new Promise(resolve => service.methods.fetch({ payload: { url: 'https://api.bilibili.com/healthy' }, respond: resolve }));
      assert.equal(result.returnValue, true); return true;
    },
    async close() {
      closing = true;
      for (const timer of timers) clearTimeout(timer);
      for (const req of requests) req.destroy(); agent.destroy(); defaultAgent.destroy();
      await Promise.all([local, server].map(s => new Promise(resolve => { s.closeAllConnections(); s.close(resolve); })));
      await sleep(10);
      return { requests: requests.size, sockets: sockets.size };
    },
  };
}

await mkdir(output, { recursive: true });
const report = { started: new Date(started).toISOString(), baseline, node: process.version, sourceSha256: createHash('sha256').update(sourceText).digest('hex'), realDeadlineMs: 10000, realBackoffMs: 15000, results: [] };
const watchdog = setTimeout(async () => {
  await writeFile(output + '/results.json', JSON.stringify({ ...report, pass: false, completed: false, error: '45s suite watchdog' }, null, 2) + '\n');
  process.exit(2);
}, 45000);
process.on('uncaughtException', observeUncaught);
const fixtures = await Promise.all(modes.map(fixture));
try {
  await sleep(11200);
  for (const f of fixtures) f.state.afterDeadline = f.snapshot();
  if (!baseline) {
    const until = started + 28000;
    while (Date.now() < until && fixtures.some(f => f.state.mode !== 'always-invalid' && f.cookies().buvid3 !== 'fixture-buvid-' + f.state.mode)) await sleep(100);
  }
  for (const f of fixtures) {
    const result = { ...f.state, final: f.snapshot(), checks: {} };
    result.checks.firstAttemptClosed = f.state.closes.some(row => row.attempt === 1 && row.atMs < 11000);
    result.checks.failureLogged = f.state.logs.some(line => /buvid.*fail/i.test(line));
    result.checks.bodyErrorHandled = !['truncated', 'body-stall'].includes(f.state.mode) || (f.state.bodyErrors.length > 0 && f.state.bodyErrors.every(row => row.applicationErrorListeners > 0));
    result.checks.badHttpDataRejected = f.state.mode !== 'http503' || f.state.afterDeadline.fingerprint !== 'must-not-accept-error-status';
    result.checks.retryScheduled = f.state.mode === 'always-invalid' ? null : f.state.afterDeadline.retryTimers === 1;
    result.checks.recoveredAfterBackoff = baseline || f.state.mode === 'always-invalid' ? null : f.cookies().buvid3 === 'fixture-buvid-' + f.state.mode;
    result.checks.boundedAttempts = f.state.mode === 'always-invalid' ? f.state.attempts === 6 && f.state.afterDeadline.retryTimers === 0 : f.state.attempts <= 2;
    result.checks.noAccountCredentials = !f.cookies().SESSDATA && !f.cookies().DedeUserID && !f.cookies().bili_jct;
    result.checks.healthyServiceRequest = await f.healthy();
    result.pass = Object.values(result.checks).every(value => value !== false);
    report.results.push(result); console.log(result.pass ? 'PASS' : 'FAIL', result.mode, JSON.stringify(result.checks));
  }
} finally {
  report.cleanup = await Promise.all(fixtures.map(f => f.close()));
  process.removeListener('uncaughtException', observeUncaught);
  clearTimeout(watchdog);
  report.finished = new Date().toISOString();
  report.uncaughtErrors = uncaughtErrors;
  report.pass = report.results.length === modes.length && report.results.every(row => row.pass) && report.cleanup.every(row => row.requests === 0 && row.sockets === 0) && uncaughtErrors.length === 0;
  report.limitations = ['loopback HTTP; no TLS, actual DNS infrastructure, real fingerprint/account, or television involved', 'baseline ends at 11.2s and does not wait for backoff; new-source run verifies the real 15s backoff recovery', 'always-invalid case alone compresses the five 15s backoffs to 20ms and checks exactly six total attempts', 'error observer keeps old unhandled response errors from terminating the harness and records missing production listeners'];
  await writeFile(output + '/results.json', JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.pass ? 0 : 1;
}
