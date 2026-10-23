// Pure in-memory fixtures: no service startup, sockets, real account, or disk writes.
// ES5 syntax permits running this file directly with Node 0.12 and Node 8.
'use strict';
var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var repairModule = require('../service/com.biliwebos.app.service/accountRepair');

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function bytes(value) { return typeof Buffer.from === 'function' ? Buffer.from(value) : new Buffer(value); }
function fixture() {
  var file = '/fixture/bili_cookies.json';
  var original = { SESSDATA: 'private-session-fixture', DedeUserID: '123', bili_jct: 'private-csrf-fixture', custom: 'preserve-me', buvid3: 'old-buvid3-abcdefghijklmnop', buvid4: 'old-buvid4-abcdefghijklmnop', b_nut: '1600000000' };
  var state = { jar: copy(original), generation: 0, time: 1700000000000, calls: [], responses: [], fail: '', writes: [], opened: [], closed: [], renamed: [] };
  var disk = {}, descriptors = {}, timers = {}, nextFd = 10, nextTimer = 1;
  disk[file] = JSON.stringify(original);
  function fail(stage) { if (state.fail === stage) throw new Error('private failure fixture: ' + stage); }
  var fakeFs = {
    openSync: function (path, flags, mode) { fail('open'); assert.strictEqual(flags, 'wx'); assert.strictEqual(mode, 384); if (Object.prototype.hasOwnProperty.call(disk, path)) throw new Error('EEXIST'); var fd = nextFd++; descriptors[fd] = path; disk[path] = ''; state.opened.push(path); return fd; },
    writeFileSync: function (fd, value) { fail('write'); assert.ok(descriptors[fd], 'write must use exclusive temporary fd'); disk[descriptors[fd]] = String(value); state.writes.push(fd); },
    writeSync: function (fd, buffer, offset, length, position) {
      fail('write'); assert.ok(descriptors[fd], 'write must use exclusive temporary fd');
      if (state.fail === 'zero') return 0;
      var written = state.partialWrite ? Math.min(length, state.partialWrite) : length;
      var previous = bytes(disk[descriptors[fd]] || '');
      var next = new Buffer(Math.max(previous.length, position + written)); next.fill(0);
      previous.copy(next); buffer.copy(next, position, offset, offset + written);
      disk[descriptors[fd]] = next; state.writes.push({ fd: fd, offset: offset, written: written, position: position }); return written;
    },
    fsyncSync: function (fd) { fail('fsync'); assert.ok(descriptors[fd]); },
    closeSync: function (fd) { fail('close'); state.closed.push(fd); delete descriptors[fd]; },
    renameSync: function (from, to) { fail('rename'); assert.strictEqual(to, file); assert.ok(Object.prototype.hasOwnProperty.call(disk, from)); disk[to] = disk[from]; delete disk[from]; state.renamed.push([from, to]); },
    unlinkSync: function (path) { delete disk[path]; }
  };
  var api = repairModule.createAccountRepair({
    fs: fakeFs, cookieFile: file, agent: { fixture: true },
    https: { request: function (options, callback) { var req = new EventEmitter(); req.options = options; req.callback = callback; req.ends = 0; req.destroyed = false; req.end = function () { req.ends++; }; req.destroy = function () { req.destroyed = true; }; req.abort = req.destroy; req.setTimeout = function () {}; state.calls.push(req); return req; } },
    getCookies: function () { return state.jar; }, setCookies: function (next) { state.jar = next; },
    getGeneration: function () { return state.generation; }, advanceGeneration: function () { return ++state.generation; },
    now: function () { return state.time; },
    setTimeout: function (fn, ms) { var id = nextTimer++; timers[id] = { fn: fn, due: state.time + ms }; return id; },
    clearTimeout: function (id) { delete timers[id]; }
  });
  function start(payload) { var results = []; api.repair(payload === undefined ? { confirm: true } : payload, function (result) { results.push(result); }); return results; }
  function headers(options) { options = options || {}; var req = state.calls[state.calls.length - 1]; assert.ok(req); var res = new EventEmitter(); res.statusCode = options.status === undefined ? 200 : options.status; res.headers = options.headers || { 'set-cookie': ['b_nut=1700000000; Domain=.bilibili.com; Path=/; Secure'] }; res.destroyed = false; res.destroy = function () { res.destroyed = true; }; state.responses.push(res); req.callback(res); return res; }
  function body(res, value) { res.emit('data', bytes(typeof value === 'string' ? value : JSON.stringify(value))); res.emit('end'); }
  function valid() { return { code: 0, data: { b_3: 'new-buvid3-abcdefghijklmnop', b_4: 'new-buvid4-abcdefghijklmnop' } }; }
  function reply(options) { options = options || {}; var res = headers(options); body(res, options.body === undefined ? valid() : options.body); return res; }
  function advance(ms) { state.time += ms; var again = true; while (again) { again = false; Object.keys(timers).forEach(function (id) { if (timers[id] && timers[id].due <= state.time) { var fn = timers[id].fn; delete timers[id]; fn(); again = true; } }); } }
  return { api: api, state: state, disk: disk, file: file, original: original, start: start, headers: headers, body: body, valid: valid, reply: reply, advance: advance, pendingTimers: function () { return Object.keys(timers).length; }, descriptors: descriptors };
}

function run() {
  var count = 0;
  function check(name, fn) { fn(); count++; console.log('PASS ' + name); }
  check('confirmation required before any mutation', function () { var f = fixture(); var result = f.start({ confirm: 'true' }); assert.strictEqual(result[0].errorCode, 'CONFIRM_REQUIRED'); assert.strictEqual(f.state.calls.length, 0); assert.strictEqual(f.state.generation, 0); });
  check('single anonymous TLS request commits only device keys', function () { var f = fixture(); var result = f.start(); assert.strictEqual(f.state.calls.length, 1); var options = f.state.calls[0].options; assert.strictEqual(options.hostname, 'api.bilibili.com'); assert.strictEqual(options.path, '/x/frontend/finger/spi'); assert.strictEqual(options.method, 'GET'); assert.strictEqual(options.rejectUnauthorized, true); assert.strictEqual(options.agent, false); assert.strictEqual(Object.keys(options.headers).filter(function (key) { return key.toLowerCase() === 'cookie'; }).length, 0); f.reply(); assert.deepEqual(result[0], { returnValue: true, changed: true, accountPreserved: true }); assert.strictEqual(f.state.jar.SESSDATA, f.original.SESSDATA); assert.strictEqual(f.state.jar.custom, f.original.custom); assert.strictEqual(f.state.jar.buvid3, f.valid().data.b_3); assert.deepEqual(JSON.parse(f.disk[f.file]), f.state.jar); assert.strictEqual(f.state.renamed.length, 1); assert.strictEqual(f.pendingTimers(), 0); });
  ['open', 'write', 'fsync', 'close', 'rename'].forEach(function (stage) { check(stage + ' failure preserves original memory and disk', function () { var f = fixture(); f.state.fail = stage; var result = f.start(); f.reply(); assert.strictEqual(result[0].errorCode, 'PERSISTENCE_FAILED'); assert.deepEqual(f.state.jar, f.original); assert.deepEqual(JSON.parse(f.disk[f.file]), f.original); assert.strictEqual(Object.keys(f.disk).length, 1); }); });
  check('short fd writes finish the entire UTF-8 candidate', function () { var f = fixture(); f.state.partialWrite = 3; f.state.jar.custom = '\u4fdd\u7559\u504f\u597d'; var result = f.start(); f.reply(); assert.strictEqual(result[0].returnValue, true); assert.deepEqual(JSON.parse(f.disk[f.file]), f.state.jar); assert.ok(f.state.writes.length > 1); });
  check('zero fd write fails without replacing original file', function () { var f = fixture(); f.state.fail = 'zero'; var result = f.start(); f.reply(); assert.strictEqual(result[0].errorCode, 'PERSISTENCE_FAILED'); assert.deepEqual(f.state.jar, f.original); assert.deepEqual(JSON.parse(f.disk[f.file]), f.original); });
  check('generation change prevents late identity commit', function () { var f = fixture(); var result = f.start(); f.state.generation++; f.reply(); assert.strictEqual(result[0].errorCode, 'SESSION_CHANGED'); assert.deepEqual(f.state.jar, f.original); assert.deepEqual(JSON.parse(f.disk[f.file]), f.original); });
  check('body stall obeys total deadline and rejects late body', function () { var f = fixture(); var result = f.start(); var response = f.headers(); f.advance(7500); assert.strictEqual(result[0].errorCode, 'REQUEST_TIMEOUT'); f.body(response, f.valid()); assert.strictEqual(result.length, 1); assert.deepEqual(f.state.jar, f.original); assert.strictEqual(f.state.calls.length, 1); });
  check('peer reset has no automatic retry', function () { var f = fixture(); var result = f.start(); var error = new Error('private upstream detail'); error.code = 'ECONNRESET'; f.state.calls[0].emit('error', error); assert.strictEqual(result[0].errorCode, 'REQUEST_FAILED'); assert.strictEqual(f.state.calls.length, 1); assert.strictEqual(JSON.stringify(result).indexOf('private upstream detail'), -1); });
  check('concurrent attempt and ten-minute cooldown are bounded', function () { var f = fixture(); var first = f.start(); assert.strictEqual(f.start()[0].errorCode, 'BUSY'); f.reply(); assert.strictEqual(first.length, 1); assert.strictEqual(f.start()[0].errorCode, 'COOLDOWN'); f.advance(600000); assert.strictEqual(f.start().length, 0); assert.strictEqual(f.state.calls.length, 2); });
  console.log('PASS account repair ES5 mock checks: ' + count + ' on ' + process.version);
}

module.exports = { fixture: fixture, run: run };
if (require.main === module) run();
