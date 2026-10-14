// Execute the production relay with a controlled transport/clock. Old source
// snapshots use RELAY_SOURCE; no TV, credentials or external hosts are touched.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const file = new URL('../service/com.biliwebos.app.service/danmaku.js', import.meta.url);
const source = readFileSync(process.env.RELAY_SOURCE || file, 'utf8');
const output = process.env.RELAY_STABILITY_OUTPUT || '/tmp/bili-live-relay-reconnect';
mkdirSync(output, { recursive: true });
const report = { source: 'service/com.biliwebos.app.service/danmaku.js', sha256: createHash('sha256').update(source).digest('hex'),
  boundary: 'Actual relay, controlled WebSocket and virtual time. Real legacy socket teardown is separately exercised below.', checks: [] };
const EPOCH = 1800000000000;
function packet(op, body = Buffer.alloc(0), version = 1) {
  if (!Buffer.isBuffer(body)) body = Buffer.from(JSON.stringify(body));
  const head = Buffer.alloc(16); head.writeUInt32BE(16 + body.length, 0); head.writeUInt16BE(16, 4);
  head.writeUInt16BE(version, 6); head.writeUInt32BE(op, 8); return Buffer.concat([head, body]);
}
const auth = code => packet(8, { code });
const heartbeat = () => packet(3, Buffer.alloc(4));
const chat = () => packet(5, { cmd: 'DANMU_MSG', info: [null, 'fixture chat', [0, 'fixture user']] }, 0);
function fixture() {
  let now = 0, nextId = 0, throws = false, delivered = 0;
  const timers = new Map(), sockets = [], packets = [], sendErrors = new Set();
  const schedule = (fn, delay, repeat) => { const id = ++nextId; timers.set(id, { fn, due: now + delay, repeat }); return id; };
  const advance = ms => {
    const end = now + ms; let steps = 0;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break; if (++steps > 10000) throw new Error('Virtual timer watchdog exceeded');
      const [id, t] = next; now = t.due; if (t.repeat) t.due += t.repeat; else timers.delete(id); t.fn();
    }
    now = end;
  };
  class WebSocket extends EventEmitter {
    constructor(url, options) { super(); if (throws) throw new Error('constructor fixture'); this.readyState = 0; this.atMs = now; this.options = options; sockets.push(this); }
    open() { this.readyState = 1; this.emit('open'); }
    send(buf, cb) {
      if (this.readyState !== 1) throw new Error('closed transport');
      const op = buf.readUInt32BE(8); packets.push({ op, socket: sockets.indexOf(this), atMs: now });
      if (sendErrors.has(op) && cb) schedule(() => cb(new Error('send fixture')), 0, 0);
    }
    close() { if (this.readyState !== 3) { this.readyState = 3; this.emit('close', 1006); } }
    terminate() { this.close(); }
  }
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Buffer, Date: class extends Date { static now() { return EPOCH + now; } },
    require(name) { if (name === 'ws') return WebSocket; if (['zlib', 'https'].includes(name)) return require(name); throw new Error('Unexpected dependency: ' + name); },
    setTimeout: (fn, delay) => schedule(fn, delay, 0), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, delay), clearInterval: id => timers.delete(id),
  }, { filename: file.pathname, timeout: 1000 });
  const stop = module.exports.connectDanmaku({ roomid: 1, token: 'fixture-secret', cookie: 'fixture-cookie' }, () => delivered++);
  const state = () => { assert.equal(typeof stop.getState, 'function', 'actual state must be observable'); return stop.getState(); };
  const healthy = socket => { socket.open(); socket.emit('message', auth(0)); socket.emit('message', heartbeat()); };
  return { sockets, packets, timers, sendErrors, advance, stop, state, healthy, throwConstructors: () => { throws = true; },
    get delivered() { return delivered; },
    summary: () => ({ connections: sockets.length, atMs: sockets.map(s => s.atMs), timers: timers.size, delivered,
      authPackets: packets.filter(p => p.op === 7).length, heartbeatPackets: packets.filter(p => p.op === 2).length,
      state: typeof stop.getState === 'function' ? stop.getState() : null }) };
}
function test(name, fn) {
  const f = fixture(); let error;
  try { fn(f); } catch (e) { error = e; }
  const detail = f.summary();
  try { f.stop(); f.advance(300000); assert.equal(f.timers.size, 0, 'cleanup must leave no timers'); } catch (e) { error ||= e; }
  report.checks.push({ name, pass: !error, ...(error ? { error: error.message } : {}), detail }); console.log(error ? 'FAIL' : 'PASS', name, error?.message || '');
}
test('six healthy reconnects restore budget and continue delivery', f => {
  for (let i = 0; i < 7; i++) {
    assert.equal(f.sockets.length, i + 1, 'healthy connections exhausted lifetime retry budget');
    const s = f.sockets[i]; f.healthy(s); f.advance(30000); s.emit('message', heartbeat()); s.emit('message', chat()); s.close(); f.advance(3000);
  }
  assert.equal(f.sockets.length, 8); assert.equal(f.delivered, 7); assert.equal(f.state().consecutiveFailures, 1);
});
test('handshake deadline terminates hung CONNECTING socket', f => {
  f.advance(10000); assert.equal(f.sockets[0].readyState, 3); assert.equal(f.state().lastError, 'connect-timeout'); f.advance(3000); assert.equal(f.sockets.length, 2);
});
test('chat and heartbeat cannot replace authentication; auth has a deadline', f => {
  const s = f.sockets[0]; s.open(); s.emit('message', chat()); s.emit('message', heartbeat()); f.advance(10000);
  assert.equal(f.delivered, 0); assert.equal(s.readyState, 3); assert.equal(f.state().lastError, 'auth-timeout');
});
test('auth rejection is visible and waits sixty seconds before retry', f => {
  const s = f.sockets[0]; s.open(); s.emit('message', auth(-101)); assert.equal(s.readyState, 3);
  assert.equal(f.state().lastError, 'auth-rejected'); assert.equal(f.state().lastAuthCode, -101); assert.equal(f.packets.filter(p => p.op === 2).length, 0);
  f.advance(59999); assert.equal(f.sockets.length, 1); f.advance(1); assert.equal(f.sockets.length, 2);
});
test('quiet room with heartbeat replies remains connected for ten minutes', f => {
  const s = f.sockets[0]; f.healthy(s); for (let i = 0; i < 20; i++) { f.advance(30000); s.emit('message', heartbeat()); }
  assert.equal(f.sockets.length, 1); assert.equal(f.delivered, 0); assert.equal(f.state().connected, true); assert.equal(f.state().heartbeatsReceived, 21);
});
test('half-open heartbeat timeout destroys connection and schedules recovery', f => {
  const s = f.sockets[0]; f.healthy(s); f.advance(50000); assert.equal(s.readyState, 3); assert.equal(f.state().lastError, 'heartbeat-timeout');
  assert.equal(f.state().connected, false); f.advance(3000); assert.equal(f.sockets.length, 2);
});
test('nineteen-second heartbeat delay is tolerated', f => {
  const s = f.sockets[0]; s.open(); s.emit('message', auth(0)); f.advance(19000); s.emit('message', heartbeat());
  f.advance(30000); s.emit('message', heartbeat()); assert.equal(f.sockets.length, 1); assert.equal(f.state().connected, true);
});
test('persistent failures use capped backoff with one retry and no permanent stop', f => {
  for (let i = 0; i < 12; i++) {
    const s = f.sockets[i]; assert.ok(s, 'relay stopped permanently'); s.emit('error', new Error('failure')); s.emit('close', 1006);
    assert.equal(f.timers.size, 1, 'error and close must not duplicate retry'); const delay = [3000, 6000, 12000, 30000, 60000][Math.min(i, 4)];
    f.advance(delay - 1); assert.equal(f.sockets.length, i + 1); f.advance(1); assert.equal(f.sockets.length, i + 2);
  }
  assert.equal(f.state().connections, 13); assert.equal(f.state().consecutiveFailures, 12);
});
test('brief authenticated connections do not wash repeated-failure backoff', f => {
  for (let i = 0; i < 6; i++) {
    const s = f.sockets[i]; f.healthy(s); s.close(); const delay = [3000, 6000, 12000, 30000, 60000][Math.min(i, 4)];
    f.advance(delay - 1); assert.equal(f.sockets.length, i + 1); f.advance(1);
  }
  assert.equal(f.state().consecutiveFailures, 6);
});
test('late old socket open/message/error/close cannot touch newer connection', f => {
  const old = f.sockets[0]; old.close(); f.advance(3000); const current = f.sockets[1]; f.healthy(current); const sent = f.packets.length;
  old.emit('open'); old.emit('message', chat()); old.emit('error', new Error('late')); old.emit('close', 1006);
  assert.equal(f.delivered, 0); assert.equal(f.packets.length, sent); assert.equal(current.readyState, 1); assert.equal(f.state().connected, true);
});
test('stop clears retry immediately and prevents reconnect', f => {
  f.sockets[0].close(); assert.equal(f.timers.size, 1); f.stop(); f.stop(); assert.equal(f.timers.size, 0); f.advance(300000); assert.equal(f.sockets.length, 1);
});
test('stop during connect suppresses late auth send and message delivery', f => {
  const s = f.sockets[0]; f.stop(); s.emit('open'); s.emit('message', auth(0)); s.emit('message', chat());
  assert.equal(f.packets.length, 0); assert.equal(f.delivered, 0); assert.equal(f.timers.size, 0);
});
test('stop while connected suppresses late messages and releases all timers', f => {
  const s = f.sockets[0]; f.healthy(s); f.stop(); s.emit('message', chat()); s.emit('close', 1006);
  assert.equal(f.delivered, 0); assert.equal(f.timers.size, 0); assert.equal(s.readyState, 3); assert.equal(f.state().connected, false);
});
test('async heartbeat send failure and close create exactly one retry', f => {
  const s = f.sockets[0]; f.sendErrors.add(2); s.open(); s.emit('message', auth(0)); f.advance(0); s.emit('close', 1006);
  assert.equal(s.readyState, 3); assert.equal(f.state().lastError, 'send-error'); assert.equal(f.timers.size, 1); f.advance(3000); assert.equal(f.sockets.length, 2);
});
test('async auth send failure and constructor exceptions remain bounded', f => {
  f.sendErrors.add(7); f.sockets[0].open(); f.advance(0); assert.equal(f.state().lastError, 'send-error'); f.throwConstructors(); f.advance(3000);
  assert.equal(f.state().lastError, 'connect-error'); assert.equal(f.timers.size, 1); assert.equal(f.state().retryAt, EPOCH + 9000);
});
test('malformed authentication does not authorize or throw', f => {
  const s = f.sockets[0]; s.open(); s.emit('message', packet(8, null)); s.emit('message', packet(8));
  assert.equal(f.state().connected, false); f.advance(10000); assert.equal(f.state().lastError, 'auth-timeout');
});
test('compressed multiple packets and malformed lengths are isolated', f => {
  const s = f.sockets[0]; f.healthy(s); s.emit('message', packet(5, require('zlib').deflateSync(Buffer.concat([chat(), chat()])), 2)); assert.equal(f.delivered, 2);
  const bad = chat(); bad.writeUInt32BE(15, 0); s.emit('message', bad); assert.equal(f.delivered, 2); assert.ok(f.state().parseErrors > 0);
  s.emit('message', chat()); assert.equal(f.delivered, 3);
});
test('diagnostic snapshot exposes state and counters without credentials or content', f => {
  const s = f.sockets[0]; f.healthy(s); s.emit('message', chat()); const state = f.state();
  assert.equal(state.phase, 'connected'); assert.equal(state.lastEventAt, EPOCH); assert.equal(state.messagesReceived, 1); assert.equal(state.eventsDelivered, 1);
  assert.equal(state.lastHeartbeatReplyAt, EPOCH); assert.doesNotMatch(JSON.stringify(state), /fixture|cookie|token|roomid|user|chat/i);
  state.connected = false; assert.equal(f.state().connected, true);
});
// Real ws@1 sockets: a fake close() is not evidence that its hidden HTTP
// request is gone. Generate a disposable localhost-only TLS identity.
const { createServer: createTcpServer } = await import('node:net');
const https = await import('node:https');
const { createHash: hash } = await import('node:crypto');
const { execFileSync } = await import('node:child_process');
const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const serviceRequire = createRequire(file);
const LegacyWebSocket = serviceRequire('ws-legacy');
const tlsDir = mkdtempSync(tmpdir() + '/bili-relay-tls-');
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-days', '1',
    '-keyout', tlsDir + '/key.pem', '-out', tlsDir + '/cert.pem'], { stdio: 'ignore', timeout: 15000 });
  const credentials = { key: readFileSync(tlsDir + '/key.pem'), cert: readFileSync(tlsDir + '/cert.pem') };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitUntil = async (fn, limit = 2500) => {
    const end = Date.now() + limit;
    while (!fn()) { if (Date.now() >= end) throw new Error('local socket observation timed out'); await delay(10); }
  };
  async function legacyCase(stage, deadline) {
    const active = new Set(), clients = [], requests = [], closedRequests = new Set(), upgradedRequests = new Set(), clientSockets = new Set(), closedSockets = new Set(); let opened = 0, upgrades = 0, stop, failure, detail;
    const httpModule = serviceRequire('https'), originalRequest = httpModule.request;
    httpModule.request = function () {
      const request = originalRequest.apply(this, arguments); requests.push(request);
      request.once('close', () => closedRequests.add(request)); request.once('upgrade', () => upgradedRequests.add(request));
      request.on('socket', socket => { clientSockets.add(socket); socket.once('close', () => closedSockets.add(socket)); });
      return request;
    };
    const server = stage === 'tls-stall' ? createTcpServer() : https.createServer(credentials);
    server.on('connection', socket => { opened++; active.add(socket); if (stage === 'tls-stall') socket.resume(); socket.on('error', () => {}); socket.once('close', () => active.delete(socket)); });
    server.on('tlsClientError', () => {});
    server.on('upgrade', (request, socket) => {
      upgrades++; socket.on('error', () => {});
      if (stage === 'open-no-close-reply') {
        const accept = hash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
        socket.on('data', () => {}); // Deliberately never acknowledges a close frame.
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      function ObservedLegacy(url, options) {
        const client = new LegacyWebSocket(url, options); clients.push(client); return client;
      }
      ObservedLegacy.Receiver = LegacyWebSocket.Receiver;
      const module = { exports: {} };
      vm.runInNewContext(source, { module, exports: module.exports, Buffer, Date, setTimeout, clearTimeout, setInterval, clearInterval,
        require(name) {
          if (name === 'ws') throw new SyntaxError('force legacy transport');
          if (name === 'ws-legacy') return ObservedLegacy;
          return serviceRequire(name);
        },
      }, { filename: file.pathname, timeout: 1000 });
      const started = Date.now();
      stop = module.exports.connectDanmaku({ host: '127.0.0.1', port: server.address().port, roomid: 1, token: 'anonymous-fixture' }, () => {});
      await waitUntil(() => active.size === 1);
      if (stage === 'upgrade-stall') await waitUntil(() => upgrades === 1);
      if (stage === 'open-no-close-reply') await waitUntil(() => clients[0]?.readyState === LegacyWebSocket.OPEN);
      if (deadline) {
        await delay(Math.max(0, started + 10500 - Date.now()));
        assert.equal([...clientSockets].filter(s => !s.destroyed).length, 0, 'ten-second handshake timeout must destroy the old client socket');
        assert.equal(closedSockets.size, clientSockets.size, 'timed-out client sockets must emit close');
        assert.equal(stop.getState().lastError, 'connect-timeout');
        await waitUntil(() => opened === 2, 4000);
        assert.equal(active.size, 1, 'retry must own one new socket only');
      }
      stop();
      await delay(150);
      detail = { stage, deadline, opened, upgrades, activeAfterStop: active.size, requests: requests.length,
        requestCloseEvents: closedRequests.size, upgradedRequests: upgradedRequests.size, clientSockets: clientSockets.size, clientSocketCloseEvents: closedSockets.size, clientSocketsAlive: [...clientSockets].filter(s => !s.destroyed).length, clientStates: clients.map(c => c.readyState),
        elapsedMs: Date.now() - started, state: stop.getState?.() || null };
      assert.equal([...clientSockets].filter(s => !s.destroyed).length, 0, 'stop left an owned legacy client socket alive');
      assert.equal(closedSockets.size, clientSockets.size, 'owned client socket missed close');
      assert.ok(requests.every(r => closedRequests.has(r) || upgradedRequests.has(r)), 'HTTP request neither closed nor upgraded');
      assert.equal(active.size, 0, 'fixture TCP peers did not finish after client teardown');
      await delay(100); assert.equal(opened, deadline ? 2 : 1, 'late close created a new connection after stop');
    } catch (error) { failure = error; }
    finally {
      stop?.(); httpModule.request = originalRequest;
      detail ||= { stage, deadline, opened, upgrades, activeAfterStop: active.size, requests: requests.length, requestCloseEvents: closedRequests.size, upgradedRequests: upgradedRequests.size, clientSockets: clientSockets.size, clientSocketCloseEvents: closedSockets.size, clientSocketsAlive: [...clientSockets].filter(s => !s.destroyed).length, clientStates: clients.map(c => c.readyState) };
      for (const request of requests) { try { request.destroy(); } catch {} }
      for (const socket of clientSockets) socket.destroy();
      for (const socket of active) socket.destroy();
      for (const client of clients) { try { client.terminate(); } catch {} }
      await new Promise(resolve => server.close(resolve));
    }
    const name = `real ws-legacy ${stage}: ${deadline ? 'deadline, recovery and stop' : 'stop releases transport'}`;
    report.checks.push({ name, pass: !failure, ...(failure ? { error: failure.message } : {}), detail });
    console.log(failure ? 'FAIL' : 'PASS', name, failure?.message || '');
  }
  await legacyCase('tls-stall', false);
  await legacyCase('upgrade-stall', false);
  await legacyCase('open-no-close-reply', false);
  await legacyCase('tls-stall', true);
} finally { rmSync(tlsDir, { recursive: true, force: true }); }

report.pass = report.checks.every(c => c.pass);
writeFileSync(`${output}/results.json`, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.checks.filter(c => c.pass).length}/${report.checks.length} passed`);
if (!report.pass) process.exitCode = 1;
