// Offline fault paths for the exact shared TV stability transport. No TV needed.
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createCdpTransport, readInventory } from './_tv-stability.mjs';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/bili-tv-stability-transport';
mkdirSync(output, { recursive: true });
const results = [];
class Socket extends EventEmitter {
  readyState = 1;
  send(body, callback) { this.handler?.(JSON.parse(body), callback); }
  reply(id, result) { this.emit('message', JSON.stringify({ id, result })); }
}
async function run(name, fn) {
  const socket = new Socket(), transport = createCdpTransport(socket);
  try { await fn(socket, transport); results.push({ name, pass: true }); console.log('PASS', name); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.log('FAIL', name, error.message); }
  finally { transport.close(); }
}
await run('real response envelope and evaluated value', async (socket, transport) => {
  socket.handler = req => socket.reply(req.id, { result: { value: 42 } });
  assert.equal(await transport.evaluate('fixture'), 42);
});
await run('close rejects pending commands immediately and forbids future sends', async (socket, transport) => {
  let sends = 0; socket.handler = () => sends++;
  const pending = transport.call('fixture', {}, 20000);
  socket.readyState = 3; socket.emit('close');
  await assert.rejects(pending, /CDP closed/);
  await assert.rejects(transport.call('after'), /CDP closed/);
  assert.equal(sends, 1);
});
await run('late repeated socket errors never escape or leave pending work', async (socket, transport) => {
  const pending = transport.call('fixture', {}, 20000);
  socket.emit('error', new Error('fixture'));
  await assert.rejects(pending, /CDP closed/);
  assert.doesNotThrow(() => socket.emit('error', new Error('second fixture')));
});
await run('send callback and synchronous failures reject without a timer leak', async (socket, transport) => {
  socket.handler = (_request, callback) => callback(new Error('fixture'));
  await assert.rejects(transport.call('callback'), /CDP send failed/);
  socket.handler = () => { throw new Error('fixture'); };
  await assert.rejects(transport.call('throw'), /CDP send failed/);
});
await run('state wait uses its remaining budget even for a hung evaluation', async (_socket, transport) => {
  const started = Date.now();
  await assert.rejects(transport.wait('fixture', 60), /CDP timeout/);
  assert.ok(Date.now() - started < 500, 'short wait must not become a 30-second command');
});
await run('false state polling respects total deadline and ignores late replies', async (socket, transport) => {
  let sent; socket.handler = request => { sent = request.id; socket.reply(request.id, { result: { value: false } }); };
  const started = Date.now();
  await assert.rejects(transport.wait('fixture', 60), /state wait expired/);
  assert.ok(Date.now() - started < 500);
  assert.doesNotThrow(() => socket.reply(sent, { result: { value: 'late' } }));
});
await run('malformed events and unrelated responses do not satisfy commands', async (socket, transport) => {
  socket.handler = request => {
    socket.emit('message', '{broken'); socket.reply(request.id + 50, {});
    socket.reply(request.id, { result: { value: 'correct' } });
  };
  assert.equal(await transport.evaluate('fixture'), 'correct');
});
await run('explicit disposal drains every pending command', async (_socket, transport) => {
  const promises = Array.from({ length: 20 }, () => transport.call('fixture', {}, 20000));
  const observed = Promise.allSettled(promises);
  transport.close(); transport.close();
  assert.ok((await observed).every(row => row.status === 'rejected' && row.reason.message === 'CDP closed'));
});
// Real HTTP boundaries, including a body that keeps arriving. The timeout is
// deliberately short for a local fixture; production still uses 10 seconds.
const connections = new Set();
const server = http.createServer((req, res) => {
  if (req.url === '/json') { res.end(JSON.stringify([{ url: 'fixture', webSocketDebuggerUrl: 'fixture' }])); return; }
  if (req.url === '/invalid') { res.end('PRIVATE_BODY invalid JSON'); return; }
  if (req.url === '/wrong-shape') { res.end('{}'); return; }
  if (req.url === '/close') { req.socket.destroy(); return; }
  if (req.url === '/no-headers') return;
  if (req.url === '/truncated') {
    res.writeHead(200, { 'Content-Length': '1000' }); res.write('[{"url":');
    setTimeout(() => res.destroy(), 15); return;
  }
  if (req.url === '/dribble') {
    res.writeHead(200); res.write('[');
    const timer = setInterval(() => res.write(' '), 15);
    res.on('close', () => clearInterval(timer)); return;
  }
  res.writeHead(503); res.end('PRIVATE_BODY');
});
server.on('connection', socket => { connections.add(socket); socket.on('error', () => {}); socket.on('close', () => connections.delete(socket)); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const cases = [
    ['normal complete JSON', '/json', null],
    ['malformed JSON', '/invalid', /Invalid CDP inventory/],
    ['non-list JSON', '/wrong-shape', /Invalid CDP inventory/],
    ['headers then truncated body', '/truncated', /CDP inventory (truncated|response failed)/],
    ['no headers reaches absolute deadline', '/no-headers', /CDP inventory timeout/],
    ['active body still reaches absolute deadline', '/dribble', /CDP inventory timeout/],
    ['connection closes before headers', '/close', /CDP inventory (request failed|connection closed)/],
    ['non-success HTTP status', '/status', /CDP inventory HTTP failure/],
  ];
  for (const [name, path, failure] of cases) {
    const started = Date.now();
    try {
      if (failure) await assert.rejects(readInventory(base + path, 100), error => {
        assert.match(error.message, failure); assert.doesNotMatch(error.message, /http|127\.0\.0\.1|PRIVATE_BODY/); return true;
      });
      else assert.deepEqual(await readInventory(base + path, 100), [{ url: 'fixture', webSocketDebuggerUrl: 'fixture' }]);
      const elapsedMs = Date.now() - started;
      assert.ok(elapsedMs < 700, 'inventory must settle within the local deadline tolerance');
      results.push({ name: 'inventory: ' + name, pass: true, elapsedMs }); console.log('PASS inventory:', name);
    } catch(error) { results.push({ name: 'inventory: ' + name, pass: false, error: error.message }); console.log('FAIL inventory:', name, error.message); }
  }
  const limit = Date.now() + 500;
  while (connections.size && Date.now() < limit) await new Promise(resolve => setTimeout(resolve, 10));
  results.push({ name: 'inventory: all fixture connections closed', pass: connections.size === 0, connections: connections.size });
} finally {
  for (const socket of connections) socket.destroy();
  await new Promise(resolve => server.close(resolve));
}
writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2) + '\n');
if (results.some(row => !row.pass)) process.exitCode = 1;
