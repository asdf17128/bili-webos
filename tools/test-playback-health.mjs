import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { createStallMonitor } from '../app/src/player/playbackHealth.js';
import { diagnosticHosts } from '../app/src/player/cdnProbe.js';
import { CDN_ROUTES } from '../app/src/player/cdn.js';

for (const route of ['ali', 'cos', 'cosov', 'aliov', 'ks3', 'hwo1']) {
  const hosts = diagnosticHosts('https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/a.m4s', route);
  assert.equal(hosts[0], CDN_ROUTES[route]);
  assert.equal(new Set(hosts).size, hosts.length);
}
const video = { currentTime: 30, readyState: 1, paused: false, ended: false, seeking: false };
const sample = createStallMonitor();
const states = Array.from({ length: 34 }, (_, i) => sample(video, false, i * 1000));
assert.ok(states.some(s => s.buffering && s.retry), 'readyState=1 must recover');
assert.equal(states.filter(s => s.retry).length, 4, 'bounded retries');
assert.ok(states[33].failed, 'permanent stalls must stop spinning');
for (const flag of ['paused', 'ended', 'seeking']) {
  video[flag] = true;
  assert.deepEqual(sample(video, false, 35000), { buffering: false, retry: false, failed: false });
  video[flag] = false;
}
video.currentTime++;
assert.equal(sample(video, false, 36000).buffering, false);
console.log('PASS selected CDN ordering, exhausted-buffer recovery, pause/seek/end and retry budget');

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length');
  if (req.method === 'OPTIONS') { res.end(); return; }
  const headers = { 'Content-Range': 'bytes 0-31/1000', 'Content-Length': '32' };
  if (req.url === '/wrong') headers['Content-Range'] = 'bytes 32-63/1000';
  if (req.url === '/short-body') headers['Content-Length'] = '16';
  if (req.url === '/short-range' || req.url === '/eof') {
    headers['Content-Range'] = req.url === '/eof' ? 'bytes 0-15/16' : 'bytes 0-15/1000';
    headers['Content-Length'] = '16';
  }
  res.writeHead(req.url === '/ignored' ? 200 : 206, headers);
  if (req.url === '/slow' || req.url === '/cancel') { res.flushHeaders(); return; }
  res.end(Buffer.alloc(Number(headers['Content-Length'])));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173');
  const result = await page.evaluate(async port => {
    const { probeRange } = await import('/src/player/cdnProbe.js');
    const base = `http://127.0.0.1:${port}`;
    const active = new Set(), results = {};
    for (const path of ['ok', 'ignored', 'wrong', 'slow', 'short-body', 'short-range', 'eof']) {
      try { results[path] = await probeRange(base + '/' + path, 0, 31, { timeoutMs: 150, active }); }
      catch (e) { results[path] = e.message; }
    }
    const pending = probeRange(base + '/cancel', 0, 31, { active }).catch(e => e.message);
    active.forEach(xhr => xhr.abort());
    results.cancel = await pending;
    results.remaining = active.size;
    return results;
  }, server.address().port);
  assert.equal(result.ok.bytes, 32);
  assert.equal(result.ok.total, 1000);
  assert.match(result.ignored, /HTTP 200/);
  assert.match(result.wrong, /Invalid range/);
  assert.match(result.slow, /Timeout/);
  assert.match(result['short-body'], /Incomplete range/);
  assert.match(result['short-range'], /Invalid range/);
  assert.equal(result.eof.bytes, 16);
  assert.equal(result.cancel, 'Cancelled');
  assert.equal(result.remaining, 0);
  console.log('PASS real HTTP range probes: success, ignored/wrong/short Range, short body, valid EOF, stalled body timeout, cancellation');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
