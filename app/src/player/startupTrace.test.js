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
test('retry classification uses Shaka error layouts and bounds retained failure groups', () => {
  const f = fixture();
  for(let i=0;i<4;i++)f.trace.retry({code:1002,data:['blob:https://app/secret',{},0]});
  f.trace.retry({code:1001,data:['http://127.0.0.1:7654/proxy/cdn.bilivideo.com/signed?token=secret',502,'secret body',{Cookie:'secret'},1]});
  f.trace.retry({code:1003,data:['https://cdn.bilivideo.com/secret',1]});
  f.trace.retry({code:9999,data:['data:secret',1]});
  f.trace.retry({code:9998,data:['https://unknown.example/secret']});
  assert.equal(f.read().retries,8);assert.equal(f.read().retryKinds.length,4);assert.equal(f.read().retryOverflow,1);
  assert.deepEqual(f.read().retryKinds[0],{code:1002,kind:'manifest',scheme:'blob',host:'',count:4});
  assert.equal(f.read().retryKinds[1].kind,'media');assert.equal(f.read().retryKinds[1].host,'cdn.bilivideo.com');
  assert.equal(f.read().retryKinds[2].kind,'media');assert.equal(f.read().retryKinds[3].kind,'other');
  assert.ok(!JSON.stringify(f.read()).includes('secret'));
  assert.match(startupReportLines(f.read()).join('\n'),/manifest\/blob\/1002x4/);
});
test('first hosts, append completion and buffer snapshots remain stable across later responses', () => {
  const f=fixture();
  const media={readyState:1,currentTime:10,buffered:{length:1,start:()=>10,end:()=>12.5}};
  f.at(100);f.trace.request({uris:['http://127.0.0.1:7654/proxy/first.bilivideo.com/path?secret=1']});
  f.at(200);f.trace.response({uri:'https://fallback.bilivideo.com/secret',timeMs:100},{stream:{type:'video'}});
  f.at(250);f.trace.point('metadata',media);
  f.at(300);f.trace.append('video',media);const snapshot=f.read();
  f.at(400);f.trace.request({uris:['https://later.bilivideo.com/']});f.trace.response({uri:'https://later.bilivideo.com/'},{stream:{type:'video'}});
  f.trace.append('video',media);media.readyState=4;f.trace.point('data',media);
  f.at(405);f.trace.append('audio',media);f.trace.append('text',media);
  assert.deepEqual(f.read().hosts,{request:'first.bilivideo.com',response:'fallback.bilivideo.com',video:'fallback.bilivideo.com'});
  assert.equal(f.read().points.vappend,300);assert.equal(f.read().points.aappend,405);
  assert.deepEqual(f.read().media.data,{ready:4,bufferMs:2500});
  assert.equal(snapshot.media.vappend.ready,1);assert.equal(snapshot.points.aappend,undefined);
  assert.ok(!JSON.stringify(f.read()).includes('secret'));
  f.trace.dispose();const saved=f.read();f.trace.append('audio',media);assert.deepEqual(f.read(),saved);
});
