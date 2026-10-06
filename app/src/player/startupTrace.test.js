import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartupTrace, startupReportLines } from './startupTrace.js';
import { startPlaybackReport, getPlaybackReport } from './playbackHealth.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture() {
  let time = 1000, last;
  const trace = createStartupTrace(value => { last = value; }, { now: () => time });
  return { trace, at: n => { time = 1000 + n; }, read: () => last };
}
test('concurrent stage durations are measured from dispatch and preserve repeated failures', async () => {
  const f = fixture(), engine = deferred(), view = deferred();
  const a = f.trace.measure('engine', () => engine.promise);
  f.at(20); const b = f.trace.measure('view', () => view.promise);
  f.at(100); view.resolve({ code: 0 }); await b;
  const snapshot = f.read();
  f.at(500); engine.resolve(); await a;
  assert.equal(f.read().stages.view.ms, 80);
  assert.equal(f.read().stages.engine.ms, 500);
  assert.equal(snapshot.stages.engine.pending, 1, 'published snapshots do not mutate');
  await assert.rejects(f.trace.measure('url', () => { throw new Error('https://signed/?SESSDATA=secret'); }));
  await f.trace.measure('url', () => ({ code: -352 }));
  assert.equal(f.read().stages.url.count, 2);
  assert.equal(f.read().stages.url.errors, 2);
  assert.ok(!JSON.stringify(f.read()).includes('secret'));
});
test('media milestones distinguish response, metadata, data and playing; stop network counting after readiness', async () => {
  const f = fixture(), load = deferred();
  const task = f.trace.measure('load', () => load.promise);
  f.at(100); f.trace.request(); f.trace.retry();
  f.at(700); f.trace.response({ timeMs: 600, uri: 'https://signed/secret' }, { stream: { type: 'video' } });
  f.at(720); f.trace.point('metadata');
  f.at(16000); f.trace.point('data');
  f.at(16020); f.trace.point('playing'); load.resolve(); await task;
  f.trace.request(); f.trace.retry(); f.trace.response({ timeMs: 99999 }); f.trace.point('data');
  const r = f.read();
  assert.equal(r.state, 'ready'); assert.equal(r.elapsedMs, 16000);
  assert.deepEqual(r.points, { request: 100, response: 700, video: 700, metadata: 720, data: 16000, playing: 16020 });
  assert.equal(r.stages.load.ms, 16020); assert.equal(r.stages.load.pending, 0);
  assert.equal(r.requests, 1); assert.equal(r.responses, 1); assert.equal(r.retries, 1);
  assert.equal(r.maxRequestMs, 600);
  const text = startupReportLines(r).join('\n');
  assert.match(text, /data=16000ms/); assert.ok(!text.includes('secret')); assert.match(text, /^[\x00-\x7f]*$/);
});
for (const state of ['failed', 'cancelled']) test(state + ' keeps partial evidence and ignores late events', async () => {
  const f = fixture(), pending = deferred();
  const task = f.trace.measure('view', () => pending.promise);
  f.at(900); if (state === 'failed') f.trace.fail(); else f.trace.dispose();
  assert.equal(f.read().state, state); assert.equal(f.read().elapsedMs, 900);
  f.trace.dispose(); const saved = f.read();
  f.at(5000); pending.resolve({ code: 0 }); await task;
  f.trace.point('data'); f.trace.response({ timeMs: 22 });
  assert.deepEqual(f.read(), saved);
  assert.ok(!startupReportLines(saved).join('\n').includes('data=0'));
});
test('a previous video cannot publish startup evidence into a later report', () => {
  const previous = startPlaybackReport('auto');
  const next = startPlaybackReport('ali');
  next({ startupMs: 123 }); previous({ startupMs: 999 });
  assert.equal(getPlaybackReport().startupMs, 123);
  assert.equal(getPlaybackReport().route, 'ali');
  assert.deepEqual(startupReportLines(null), []);
});
