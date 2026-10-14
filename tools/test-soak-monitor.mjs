// Exact injected soak monitor with controlled media/clock boundaries; no TV.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(new URL('../app/package.json', import.meta.url));
const acorn = require('acorn');
const text = fs.readFileSync(new URL('./test-network-soak-tv.mjs', import.meta.url), 'utf8');
const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
const fn = ast.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'installSoakMonitor');
assert.ok(fn, 'production monitor function must exist');
const source = text.slice(fn.start, fn.end);
const output = process.env.SOAK_MONITOR_OUTPUT || '/tmp/bili-soak-monitor';
fs.mkdirSync(output, { recursive: true });
const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, pass: true }); console.log('PASS', name); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.log('FAIL', name, error.message); }
};
function fixture(supported = true) {
  let now = 10000, stats = supported ? { decodedFrames: 100, droppedFrames: 0 } : {};
  const listeners = new Map(), timers = new Map(); let timerId = 0;
  const video = { currentTime: 5, readyState: 4, paused: false, seeking: false, error: null,
    buffered: { length: 1, start: () => 0, end: () => 120 },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); } };
  const window = { __shakaPlayer: { getStats: () => stats }, __soakDocument: 'fixture' };
  const context = vm.createContext({ window, document: { querySelector: () => video }, Date: { now: () => now }, Number, Math,
    setInterval(fn) { timers.set(++timerId, fn); return timerId; }, clearInterval(id) { timers.delete(id); } });
  vm.runInContext(source + ';installSoakMonitor("fixture");', context);
  return { window, video, listeners, timers, setTime(value) { now = value; }, setStats(value) { stats = value; },
    read: () => window.__soak.read(), event: name => listeners.get(name)?.({ type: name }) };
}
const media = fixture(), unknown = fixture(false);
try {
  check('initial observation does not count existing cumulative frames', () => assert.equal(media.read().segments[0].decodedDelta, 0));
  media.setTime(11000); media.video.currentTime = 6; media.setStats({ decodedFrames: 150, droppedFrames: 0 });
  check('repeated snapshots count only frame differences', () => {
    assert.equal(media.read().segments[0].decodedDelta, 50); assert.equal(media.read().segments[0].decodedDelta, 50);
  });
  media.event('waiting'); media.setTime(15000);
  check('over-three-second gap retains buffer state and nearby event evidence', () => {
    const state = media.read(); assert.equal(state.gaps.length, 1); assert.equal(state.gaps[0].durationMs, 4000);
    assert.equal(state.gaps[0].completed, false); assert.equal(state.gaps[0].events.at(-1).type, 'waiting');
    assert.equal(state.gaps[0].start.bufferSec, 114);
  });
  media.setTime(16000); media.video.currentTime = 7; media.setStats({ decodedFrames: 200, droppedFrames: 1 });
  check('advancing closes the original gap without creating duplicates', () => {
    const state = media.read(); assert.equal(state.gaps.length, 1); assert.equal(state.gaps[0].durationMs, 5000);
    assert.equal(state.gaps[0].completed, true); assert.equal(state.longestGap, 5000);
  });
  media.event('ended'); media.setTime(17000); media.read(); media.setTime(18000);
  media.video.currentTime = .1; media.setStats({ decodedFrames: 210, droppedFrames: 1 });
  check('natural loop splits segments even when ended was sampled earlier', () => {
    const state = media.read(); assert.equal(state.segments.length, 2); assert.equal(state.segments[1].reason, 'natural-loop');
    assert.equal(state.segments[1].decodedDelta, 10);
  });
  media.setTime(19000); media.video.currentTime = 1.1; media.setStats({ decodedFrames: 50, droppedFrames: 0 });
  check('counter reset opens a segment without summing cumulative frame counts', () => {
    const state = media.read(); assert.equal(state.counterResets, 1); assert.equal(state.segments.length, 3);
    assert.equal(state.segments.reduce((sum, row) => sum + row.decodedDelta, 0), 160);
    assert.equal(state.segments.reduce((sum, row) => sum + row.droppedDelta, 0), 1);
  });
  check('unavailable counters remain null and explicitly incomplete', () => {
    const state = unknown.read(); assert.equal(state.segments[0].decodedDelta, null);
    assert.equal(state.segments[0].counterUnavailable, true); assert.equal(state.longTasks, null);
  });
} finally {
  check('cleanup removes every listener, timer and monitor ownership', () => {
    for (const fixture of [media, unknown]) {
      assert.equal(fixture.window.__soak.clean().removed, true); assert.equal(fixture.listeners.size, 0);
      assert.equal(fixture.timers.size, 0); assert.equal(fixture.window.__soak, undefined);
    }
  });
  fs.writeFileSync(output + '/results.json', JSON.stringify({ at: new Date().toISOString(),
    sourceSha256: createHash('sha256').update(text).digest('hex'),
    scope: 'Exact monitor extracted from TV tool; virtual clock/video/counters; no TV, build or platform decoder', results }, null, 2) + '\n');
  if (results.some(row => !row.pass)) process.exitCode = 1;
}
