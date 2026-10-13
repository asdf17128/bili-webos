// Standalone browser proxy: execute its real handler with isolated disk and
// loopback upstream sockets. Only ESM imports and I/O boundaries are adapted.
import http from 'node:http';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream';
import biliReferer from '../service/com.biliwebos.app.service/biliReferer.js';

let held, failSave = false;
let saved = JSON.stringify({ SESSDATA: 'proxy-fixture', DedeUserID: '123', buvid3: 'anonymous-fixture' });
const upstream = http.createServer((req, res) => {
  held = () => { res.setHeader('Set-Cookie', 'SESSDATA=late-proxy-fixture'); res.setHeader('Content-Type', 'application/json'); res.end('{"code":0}'); };
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
let server, ready;
const listening = new Promise(resolve => { ready = resolve; });
const sourceUrl = new URL('../proxy/server.js', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8').replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', JSON.stringify(sourceUrl.href));
vm.runInNewContext(source, {
  http: { createServer: handler => {
    server = http.createServer(handler);
    const listen = server.listen.bind(server);
    server.listen = () => listen(0, '127.0.0.1', ready);
    return server;
  } },
  https: { request: (opts, cb) => http.request({ ...opts, hostname: '127.0.0.1', port: upstream.address().port }, cb) },
  URL, Buffer, zlib, pipeline, WebSocketServer, createRequire, biliReferer,
  existsSync: () => true, readSync: () => saved,
  writeSync: (path, value) => { if (failSave) throw new Error('fixture disk full'); saved = value; },
  process: { on() {} }, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
}, { filename: sourceUrl.pathname });
await listening;
const base = 'http://127.0.0.1:' + server.address().port;
try {
  const old = fetch(base + '/proxy/api.bilibili.com/late-cookie');
  const until = Date.now() + 3000;
  while (!held && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(held, 'upstream request missing');
  assert.deepEqual(await (await fetch(base + '/cookies/clear', { method: 'POST' })).json(), { ok: true });
  assert.equal(JSON.parse(saved).SESSDATA, undefined);
  assert.equal(JSON.parse(saved).DedeUserID, undefined);
  assert.equal(JSON.parse(saved).buvid3, 'anonymous-fixture');
  console.log('PASS proxy clears account credentials and persists anonymous fingerprints');
  held();
  const response = await old;
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('X-Set-Cookie'), null);
  assert.equal(JSON.parse(saved).SESSDATA, undefined);
  console.log('PASS proxy rejects late Set-Cookie and old account response');
  failSave = true;
  const failed = await fetch(base + '/cookies/clear', { method: 'POST' });
  assert.equal(failed.status, 500); assert.equal((await failed.json()).ok, false);
  failSave = false;
  assert.equal((await (await fetch(base + '/cookies/clear', { method: 'POST' })).json()).ok, true);
  console.log('PASS proxy persistence failure is retryable');
} finally {
  await Promise.all([server, upstream].map(s => new Promise(resolve => { s.closeAllConnections(); s.close(resolve); })));
}
