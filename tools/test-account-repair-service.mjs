// Production service wiring in a VM. Every socket/server, filesystem mutation,
// webOS bridge, timer and cast dependency is an in-memory substitute.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../service/com.biliwebos.app.service/', import.meta.url));
const nativeRequire = createRequire(new URL('../package.json', import.meta.url));
const cookieFile = '/media/internal/bili_cookies.json';
const original = { SESSDATA: 'private-session-fixture', DedeUserID: '123', bili_jct: 'private-csrf-fixture', buvid3: 'old-buvid3-abcdefghijklmnop', buvid4: 'old-buvid4-abcdefghijklmnop', b_nut: '1600000000' };
const newIdentity = { code: 0, data: { b_3: 'new-buvid3-abcdefghijklmnop', b_4: 'new-buvid4-abcdefghijklmnop' } };
const clone = value => JSON.parse(JSON.stringify(value));

function fixture({ bootstrap = false } = {}) {
  const initial = clone(original);
  if (bootstrap) { delete initial.buvid3; delete initial.buvid4; delete initial.b_nut; }
  const disk = new Map([[cookieFile, JSON.stringify(initial)]]);
  const descriptors = new Map(), timers = new Map(), requests = [], servers = [];
  let fd = 10, timerId = 1, service;
  const fs = {
    existsSync: p => disk.has(p), readFileSync: p => disk.get(p),
    writeFileSync: (p, value) => disk.set(descriptors.has(p) ? descriptors.get(p) : p, String(value)),
    writeSync: (id, buffer, offset, length, position) => {
      assert.ok(descriptors.has(id)); const p = descriptors.get(id);
      const previous = Buffer.from(disk.get(p) || ''); const next = Buffer.alloc(Math.max(previous.length, position + length));
      previous.copy(next); buffer.copy(next, position, offset, offset + length); disk.set(p, next); return length;
    },
    openSync: (p, flags, mode) => { assert.equal(flags, 'wx'); assert.equal(mode, 384); assert.equal(disk.has(p), false); disk.set(p, ''); descriptors.set(++fd, p); return fd; },
    fsyncSync: id => assert.ok(descriptors.has(id)), closeSync: id => descriptors.delete(id),
    renameSync: (from, to) => { assert.ok(disk.has(from)); disk.set(to, disk.get(from)); disk.delete(from); }, unlinkSync: p => disk.delete(p),
  };
  function Service() { service = this; this.methods = {}; this.activityManager = { create() {} }; }
  Service.prototype.register = function (name, handler) { this.methods[name] = handler; };
  class CastController { onIntent() {} setNetworkInfo() {} getStatus() { return {}; } }
  const substitutions = {
    './compat': {}, './danmaku': {}, fs,
    'webos-service': Service,
    https: { Agent: function () {}, request: (options, callback) => {
      const request = new EventEmitter(); Object.assign(request, { options, callback, destroyed: false, ends: 0 });
      request.end = () => request.ends++;
      request.write = () => { throw new Error('fixture forbids unexpected body write'); };
      request.setTimeout = () => {};
      request.destroy = request.abort = () => { request.destroyed = true; };
      requests.push(request); return request;
    } },
    http: { createServer: handler => {
      const server = new EventEmitter(); server.handler = handler;
      server.listen = (...args) => { server.emit('listening'); if (typeof args.at(-1) === 'function') args.at(-1)(); };
      servers.push(server); return server;
    } },
    os: { networkInterfaces: () => ({}) },
    child_process: { execFile: () => { throw new Error('fixture forbids process execution'); } },
    './cast/deviceProfile': { createDeviceProfile: options => ({ ...options, uuid: 'fixture-device' }) },
    './cast/castController': { CastController },
    './cast/ssdpServer': { CastLanServer: class { start() {} } },
  };
  const cache = new Map();
  const context = vm.createContext({ Buffer, console: { log() {}, error() {} },
    process: { version: process.version, uptime: () => 1, on() {} },
    setTimeout: (fn, ms) => { const id = timerId++; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
  });
  function load(name) {
    if (Object.hasOwn(substitutions, name)) return substitutions[name];
    if (!name.startsWith('.')) {
      assert.ok(['url', 'path', 'zlib'].includes(name), 'unexpected native dependency: ' + name);
      return nativeRequire(name);
    }
    const filename = path.join(root, name + '.js');
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const fn = vm.runInContext('(function(require,module,exports){\n' + readFileSync(filename, 'utf8') + '\n})', context, { filename });
    fn(load, module, module.exports); return module.exports;
  }
  load('./service');
  function call(name, payload = {}) {
    const results = [];
    assert.equal(typeof service.methods[name], 'function', name + ' must be registered');
    service.methods[name]({ payload, respond: value => results.push(clone(value)) });
    return results;
  }
  function headers(index, cookies = [], status = 200) {
    const response = new EventEmitter(); response.statusCode = status;
    response.headers = { 'content-type': 'application/json', 'set-cookie': cookies };
    response.destroyed = false; response.destroy = () => { response.destroyed = true; };
    response.resume = () => {};
    requests[index].callback(response); return response;
  }
  function body(response, value) { response.emit('data', Buffer.from(JSON.stringify(value))); response.emit('end'); }
  function reply(index, value = newIdentity, cookies = ['b_nut=1700000000; Domain=.bilibili.com; Path=/']) {
    const response = headers(index, cookies); body(response, value); return response;
  }
  const cookies = () => call('getCookies')[0].cookies;
  return { call, requests, servers, timers, disk, cookies, headers, body, reply };
}

let passed = 0;
function check(name, run) { run(); passed++; console.log('PASS ' + name); }

check('real handlers expose safe status and explicit confirmation gate', () => {
  const f = fixture();
  assert.deepEqual(f.call('getAccountRepairStatus')[0], { returnValue: true, supported: true, hasDeviceIdentity: true, hasAccount: true, busy: false, retryAfterSeconds: 0 });
  assert.equal(f.call('repairDeviceIdentity')[0].errorCode, 'CONFIRM_REQUIRED');
  assert.equal(f.requests.length, 0);
});

check('late normal headers cannot write old cookies after successful repair', () => {
  const f = fixture(); const old = f.call('fetch', { url: 'https://api.bilibili.com/old' });
  const repair = f.call('repairDeviceIdentity', { confirm: true });
  assert.equal(f.requests.length, 2); f.reply(1);
  assert.equal(repair[0].returnValue, true);
  const late = f.reply(0, { code: 0 }, ['SESSDATA=old-account', 'buvid3=late-old-device']);
  assert.equal(late.destroyed, true); assert.equal(old[0].returnValue, false);
  assert.equal(f.cookies().SESSDATA, original.SESSDATA); assert.equal(f.cookies().buvid3, newIdentity.data.b_3);
  assert.deepEqual(JSON.parse(f.disk.get(cookieFile)), f.cookies());
});

check('already received normal response body is rejected across repair boundary', () => {
  const f = fixture(); const old = f.call('fetch', { url: 'https://api.bilibili.com/old-body' }); const response = f.headers(0);
  const repair = f.call('repairDeviceIdentity', { confirm: true }); f.reply(1); f.body(response, { code: 0, data: { private: true } });
  assert.equal(repair[0].returnValue, true); assert.equal(old[0].returnValue, false); assert.equal(old[0].body, undefined);
  assert.equal(f.cookies().buvid3, newIdentity.data.b_3);
});

for (const phase of ['headers', 'body']) check('startup ' + phase + ' and manual repair are mutually exclusive', () => {
  const f = fixture({ bootstrap: true }); assert.equal(f.requests.length, 1);
  const response = phase === 'body' ? f.headers(0) : null;
  const blocked = f.call('repairDeviceIdentity', { confirm: true });
  assert.equal(blocked[0].errorCode, 'BUSY'); assert.equal(f.requests.length, 1);
  const initial = { code: 0, data: { b_3: 'initial-bootstrap-buvid3', b_4: 'initial-bootstrap-buvid4' } };
  if (response) f.body(response, initial); else f.reply(0, initial);
  const repair = f.call('repairDeviceIdentity', { confirm: true }); f.reply(1);
  assert.equal(repair[0].returnValue, true);
  assert.equal(f.cookies().buvid3, newIdentity.data.b_3); assert.equal(f.cookies().buvid4, newIdentity.data.b_4);
  assert.equal(f.requests.length, 2); assert.equal(f.timers.size, 0);
});

check('manual repair and automatic recovery share persisted cooldown', () => {
  const f = fixture(); const repair=f.call('repairDeviceIdentity',{confirm:true}); f.reply(0);
  assert.equal(repair[0].returnValue,true);
  assert.equal(f.call('getAccountRepairStatus')[0].retryAfterSeconds,300);
  const reset=f.call('resetDeviceIdentity');
  assert.equal(reset[0].returnValue,false); assert.match(reset[0].error,/cooldown/);
  assert.equal(f.requests.length,1);
});

check('clearCookies interrupts repair without restoring account from its snapshot', () => {
  const f = fixture(); const repair = f.call('repairDeviceIdentity', { confirm: true });
  assert.equal(f.call('clearCookies')[0].returnValue, true); f.reply(0);
  assert.equal(repair[0].errorCode, 'SESSION_CHANGED'); assert.equal(f.cookies().SESSDATA, undefined);
  assert.equal(f.cookies().DedeUserID, undefined); assert.equal(f.cookies().buvid3, original.buvid3);
  assert.deepEqual(JSON.parse(f.disk.get(cookieFile)), f.cookies());
});

check('setCookies and normal fetch are blocked during repair, then resume', () => {
  const f = fixture(); const repair = f.call('repairDeviceIdentity', { confirm: true });
  assert.equal(f.call('setCookies', { cookies: { SESSDATA: 'unexpected-account' } })[0].returnValue, false);
  assert.equal(f.call('fetch', { url: 'https://api.bilibili.com/blocked' })[0].returnValue, false);
  assert.equal(f.requests.length, 1); f.reply(0); assert.equal(repair[0].returnValue, true);
  assert.equal(f.call('setCookies', { cookies: { extra: 'new-field' } })[0].returnValue, true);
  const fresh = f.call('fetch', { url: 'https://api.bilibili.com/fresh' }); f.reply(1, { code: 0 }, []);
  assert.equal(fresh[0].returnValue, true); assert.equal(f.cookies().extra, 'new-field'); assert.equal(f.cookies().SESSDATA, original.SESSDATA);
});

check('setCookies invalidates pre-existing normal requests', () => {
  const f = fixture(); const old = f.call('fetch', { url: 'https://api.bilibili.com/old-account' });
  assert.equal(f.call('setCookies', { cookies: { SESSDATA: 'new-account' } })[0].returnValue, true);
  f.reply(0, { code: 0 }, ['SESSDATA=stale-account']);
  assert.equal(old[0].returnValue, false); assert.equal(f.cookies().SESSDATA, 'new-account');
});

check('local proxy close during repair is safe without a request handle', () => {
  const f = fixture(); f.call('repairDeviceIdentity', { confirm: true });
  const req = new EventEmitter(); req.url = '/proxy/i0.hdslb.com/cover.jpg'; req.method = 'GET'; req.headers = {};
  const res = new EventEmitter(); res.writeHead = status => { res.status = status; }; res.end = () => {}; res.destroy = () => {};
  f.servers[0].handler(req, res); assert.equal(res.status, 502);
  assert.doesNotThrow(() => res.emit('close')); assert.equal(f.requests.length, 1);
  f.reply(0);
});

check('a bootstrap retry queued before repair cannot restart after repair failure', () => {
  const f = fixture({ bootstrap: true });
  f.requests[0].emit('error', new Error('fixture DNS failure'));
  assert.equal([...f.timers.values()].filter(timer => timer.ms === 15000).length, 1);
  const repair = f.call('repairDeviceIdentity', { confirm: true });
  assert.equal(f.requests[1].options.agent, false);
  f.requests[1].emit('error', new Error('private TLS failure detail'));
  assert.equal(repair[0].errorCode, 'REQUEST_FAILED');
  assert.equal(JSON.stringify(repair).includes('private TLS failure detail'), false);
  for (const [id, timer] of f.timers) if (timer.ms === 15000) { f.timers.delete(id); timer.fn(); }
  assert.equal(f.requests.length, 2);
  assert.equal(f.cookies().buvid3, undefined);
  assert.equal(f.cookies().SESSDATA, original.SESSDATA);
  assert.equal(f.timers.size, 0);
});

check('a delayed conditional bootstrap cannot overwrite a completed manual repair', () => {
  const f = fixture();
  // Capture the already-dispatched payload, but hold service delivery until
  // after the newer repair completes, as independent bridge calls can reorder.
  const queued = { onlyIfDeviceMissing: true, cookies: { buvid3: 'stale-queued-buvid3', buvid4: 'stale-queued-buvid4' } };
  const repair = f.call('repairDeviceIdentity', { confirm: true }); f.reply(0);
  assert.equal(repair[0].returnValue, true);
  const before = clone(f.cookies()); const persisted = String(f.disk.get(cookieFile));
  // A rejected conditional write must not bump the session generation either.
  const fresh = f.call('fetch', { url: 'https://api.bilibili.com/current-session' });
  const rejected = f.call('setCookies', queued)[0];
  assert.deepEqual(rejected, { returnValue: false, errorCode: 'IDENTITY_EXISTS', error: 'Device identity already exists' });
  assert.deepEqual(f.cookies(), before); assert.equal(String(f.disk.get(cookieFile)), persisted);
  f.reply(1, { code: 0 }, []); assert.equal(fresh[0].returnValue, true);
});

check('conditional bootstrap fills a missing device once and ordinary writes remain available', () => {
  const f = fixture({ bootstrap: true });
  const payload = { onlyIfDeviceMissing: true, cookies: { buvid3: 'first-bootstrap-buvid3', buvid4: 'first-bootstrap-buvid4' } };
  assert.equal(f.call('setCookies', payload)[0].returnValue, true);
  assert.equal(f.cookies().buvid3, payload.cookies.buvid3);
  assert.equal(f.call('setCookies', { ...payload, cookies: { buvid3: 'second-bootstrap-buvid3' } })[0].errorCode, 'IDENTITY_EXISTS');
  assert.equal(f.cookies().buvid3, payload.cookies.buvid3);
  assert.equal(f.call('setCookies', { cookies: { buvid3: 'ordinary-explicit-buvid3', extra: 'ordinary-write' } })[0].returnValue, true);
  assert.equal(f.cookies().buvid3, 'ordinary-explicit-buvid3'); assert.equal(f.cookies().extra, 'ordinary-write');
  assert.equal(f.cookies().SESSDATA, original.SESSDATA);
  assert.deepEqual(JSON.parse(f.disk.get(cookieFile)), f.cookies());
});

console.log('PASS production account repair wiring: ' + passed + ' pure mock cases; no sockets or real state');
