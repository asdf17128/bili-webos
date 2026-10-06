import test from 'node:test';
import assert from 'node:assert/strict';
import { createCdnHealthStore, createAutoCdnRouter, rankCdnUrls, HEALTH_KEY } from './cdnAuto.js';
import { AUTO_MIRRORS, CDN_ROUTES, playbackCdnUrls, cdnHostOf, markFail, resetCdnState } from './cdn.js';

const a = CDN_ROUTES.ali, b = CDN_ROUTES.hwo1;
const url = host => `https://${host}/upgcxcode/fixture.m4s?upsig=fixture%2Fonly&x=1&x=2`;
const rep = { baseUrl: url(a), backupUrl: ['https://upos-hz-mirrorakam.akamaized.net/upgcxcode/fixture.m4s?hdnts=native%2Fonly'] };
function store() {
  let time = 1000000, disk = {};
  const storage = { getItem: k => disk[k], setItem: (k, v) => { disk[k] = v; } };
  return { health: createCdnHealthStore(storage, () => time), storage, disk, now: () => time, advance: ms => { time += ms; } };
}
test('cached measurements promote a faster mirror, retaining exact native signed URLs', () => {
  const { health } = store();
  health.put(a, { ok: true, rateMbps: 1 }); health.put(b, { ok: true, rateMbps: 10 });
  const urls = playbackCdnUrls(rep, 'auto'), ranked = rankCdnUrls(urls, health);
  assert.equal(cdnHostOf(ranked[0]), b);
  assert.ok(ranked.includes(rep.baseUrl)); assert.ok(ranked.includes(rep.backupUrl[0]));
});
test('Akamai-only and live URLs are never mirror templates', () => {
  for (const source of [rep.backupUrl[0], 'https://cn-live.bilivideo.com/live-bvc/x.m3u8?sign=native']) {
    assert.deepEqual(playbackCdnUrls({ baseUrl: source }, 'hwo1'), [source]);
  }
});
test('similar measurements preserve incumbent, all-failed restores original order', () => {
  const { health } = store(), urls = [url(a), url(b)];
  health.put(a, { ok: true, rateMbps: 10 }); health.put(b, { ok: true, rateMbps: 11 });
  assert.deepEqual(rankCdnUrls(urls, health, a), urls);
  health.put(a, { ok: false }); health.put(b, { ok: false });
  assert.deepEqual(rankCdnUrls(urls, health), urls);
});
test('cache expires, survives restart, strips private fields and handles corrupt storage', () => {
  const s = store(); s.health.put(a, { ok: true, rateMbps: 10, url: 'private', token: 'private' });
  assert.ok(!/private|upsig/.test(s.disk[HEALTH_KEY]));
  assert.equal(createCdnHealthStore(s.storage, s.now).get(a).rateMbps, 10);
  s.advance(4 * 60 * 60 * 1000); assert.equal(s.health.get(a), null);
  s.health.put(b, { ok: false }); s.advance(15 * 60 * 1000); assert.equal(s.health.get(b), null);
  assert.equal(createCdnHealthStore({ getItem: () => '{bad' }).get(a), null);
});
test('untrusted cache host cannot insert a new destination into requests', () => {
  const s = store(); s.health.put('evil.example', { ok: true, rateMbps: 100 });
  assert.equal(s.health.get('evil.example'), null);
  s.health.put('other.bilivideo.com', { ok: true, rateMbps: 100 });
  const r = createAutoCdnRouter({ health: s.health, getRoute: () => 'auto', canProbe: () => false, proxyBase: () => '', intervalMs: 0 });
  assert.ok(!r.order([url(a)]).some(u => u.includes('other.'))); r.dispose();
});
test('native .cn hosts are measured once; uncacheable hosts cannot monopolize probes', async () => {
  const s = store(), calls = [], native = 'cn-native.bilivideo.cn';
  const r = createAutoCdnRouter({ health: s.health, now: s.now, getRoute: () => 'auto', canProbe: () => true,
    proxyBase: () => 'http://local', intervalMs: 0, probe: async u => {
      calls.push(cdnHostOf(u)); return { bytes: 262144, total: 4000000, ms: 100 };
    } });
  const source = { baseUrl: url(native), backupUrl: [url('unknown.example'), url(a)] };
  r.setSource(source);
  for (let i = 0; i < 10; i++) await r.tick();
  assert.equal(calls.filter(h => h === native).length, 2);
  assert.equal(calls.filter(h => h === 'unknown.example').length, 0);
  assert.equal(s.health.get(a)?.ok, true);
  assert.ok(r.order(playbackCdnUrls(source, 'auto')).includes(url('unknown.example')));
  r.dispose();
});
test('two completed samples rank by slower transfer; every candidate is visited', async () => {
  const s = store(), calls = [];
  const router = createAutoCdnRouter({ health: s.health, now: s.now, getRoute: () => 'auto', canProbe: () => true,
    proxyBase: () => 'http://local', intervalMs: 0, probe: async (u, start) => {
      calls.push({ host: cdnHostOf(u), start });
      return { bytes: 262144, total: 4000000, ms: cdnHostOf(u) === b ? 20 : start ? 2000 : 5 };
    } });
  router.setSource(rep);
  for (let i = 0; i < AUTO_MIRRORS.length + 1; i++) await router.tick();
  assert.equal(cdnHostOf(router.order(playbackCdnUrls(rep, 'auto'))[0]), b);
  assert.equal(new Set(calls.map(x => x.host)).size, AUTO_MIRRORS.length + 1);
  assert.equal(calls.length, (AUTO_MIRRORS.length + 1) * 2);
  router.dispose();
});
test('loading/buffer gate and manual choice prevent probes and automatic override', async () => {
  const s = store(); let allowed = false, route = 'auto', calls = 0;
  s.health.put(b, { ok: true, rateMbps: 20 });
  const r = createAutoCdnRouter({ health: s.health, getRoute: () => route, canProbe: () => allowed, proxyBase: () => '', intervalMs: 0,
    probe: async () => { calls++; throw new Error('unreachable'); } });
  r.setSource(rep); await r.tick(); assert.equal(calls, 0);
  allowed = true; route = 'ali'; await r.tick(); assert.equal(calls, 0);
  assert.equal(cdnHostOf(r.order(playbackCdnUrls(rep, route))[0]), a);
  r.dispose();
});
test('buffer loss aborts active probe without poisoning cache', async () => {
  const s = store(); let allowed = true, aborted = false;
  const r = createAutoCdnRouter({ health: s.health, getRoute: () => 'auto', canProbe: () => allowed, proxyBase: () => '', intervalMs: 0,
    probe: (u, start, end, { active }) => new Promise((resolve, reject) => active.add({ abort() { aborted = true; reject(new Error('Cancelled')); } })) });
  r.setSource(rep); const pending = r.tick(); allowed = false; await r.tick(); await pending;
  assert.equal(aborted, true); assert.equal(s.health.get(a), null); r.dispose();
});
test('late result after source change or exit cannot update routing/cache', async () => {
  for (const exit of [false, true]) {
    const s = store(); let resolve;
    const r = createAutoCdnRouter({ health: s.health, getRoute: () => 'auto', canProbe: () => true, proxyBase: () => '', intervalMs: 0,
      probe: () => new Promise(r => { resolve = r; }) });
    r.setSource(rep); const pending = r.tick();
    if (exit) r.dispose(); else r.setSource({ baseUrl: url(b) });
    resolve({ bytes: 262144, total: 4000000, ms: 10 }); await pending;
    assert.equal(s.health.get(a), null); r.dispose();
  }
});
test('partial/timeout sample is failure and banned winner yields to healthy fallback', async () => {
  resetCdnState(); const s = store();
  const r = createAutoCdnRouter({ health: s.health, getRoute: () => 'auto', canProbe: () => true, proxyBase: () => '', intervalMs: 0,
    probe: async () => ({ bytes: 1000, total: 4000000, ms: 4000, timedOut: true }) });
  r.setSource(rep); await r.tick(); assert.equal(s.health.get(a).ok, false);
  s.health.put(a, { ok: true, rateMbps: 3 }); s.health.put(b, { ok: true, rateMbps: 20 });
  markFail(b); markFail(b); r.failed(b);
  assert.equal(cdnHostOf(r.order(playbackCdnUrls(rep, 'auto'))[0]), a);
  r.dispose(); resetCdnState();
});
