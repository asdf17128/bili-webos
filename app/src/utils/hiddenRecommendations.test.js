import test from 'node:test';
import assert from 'node:assert/strict';

const STORAGE_KEY = 'bili_hiddenRecommendations';
const BV = 'BV1xx411c7mD';
const OTHER_BV = 'BV1AbCdEfG12';
let moduleId = 0;
const fresh = () => import('./hiddenRecommendations.js?fixture=' + (++moduleId));
function store(t, raw = null) {
  let value = raw;
  const state = { reads: 0, writes: [], readError: false, writeError: false };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) {
      assert.equal(key, STORAGE_KEY); state.reads++;
      if (state.readError) throw new Error('fixture read failure');
      return value;
    },
    setItem(key, next) {
      assert.equal(key, STORAGE_KEY);
      if (state.writeError) throw new Error('fixture write failure');
      state.writes.push(next); value = next;
    },
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  return { state, read: () => value };
}

test('canonical recommendation identities prefer valid BV aliases and normalize integer IDs', async () => {
  const { recommendationKey } = await fresh();
  assert.equal(recommendationKey({ bvid: BV, bv_id: OTHER_BV, aid: 9 }), 'bv:' + BV);
  assert.equal(recommendationKey({ bvid: 'bad', bv_id: OTHER_BV, aid: 9, goto: 'av' }), 'bv:' + OTHER_BV);
  assert.equal(recommendationKey({ aid: '0009' }), 'av:9');
  assert.equal(recommendationKey({ aid: false, id: 10 }), 'av:10');
  assert.equal(recommendationKey({ aid: Number.MAX_SAFE_INTEGER }), 'av:9007199254740991');
  assert.equal(recommendationKey({ bvid: BV.toLowerCase(), aid: 4 }), 'av:4');
  for (const value of [true, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1e3', '1.2', ' 1', '+1', '', '0'.repeat(33) + '1']) {
    assert.equal(recommendationKey({ aid: value }), null);
  }
});

test('live, PGC and non-video identities are rejected before storing even with a valid BV', async t => {
  const f = store(t), api = await fresh();
  const invalid = [null, undefined, false, BV, [], {}, { aid: 0 }, { bvid: 'BVtooshort' },
    ...[{ goto: 'live' }, { goto: 'bangumi' }, { goto: '' }, { isLive: true }, { isBangumi: true },
      { isPgc: true }, { isPGC: true }, { pgc: {} }, { business: 'pgc' }, { badge: '番剧' },
      { epid: 1 }, { ep_id: 1 }, { seasonId: 1 }, { season_id: 1 }, { uri: 'https://fixture.invalid/bangumi/play/ep123' }]
      .map(fields => ({ bvid: BV, ...fields }))];
  for (const video of invalid) assert.deepEqual(api.hideRecommendation(video), { key: null, persistent: false, changed: false });
  for (const key of [null, {}, 'av:0', 'av:01', 'av:1.5', 'av:9007199254740992', 'bv:bad', BV, 'https://fixture.invalid']) {
    assert.deepEqual(api.restoreRecommendation(key), { persistent: false, changed: false });
  }
  assert.equal(f.state.reads, 0);
  assert.deepEqual(f.state.writes, []);
});

test('reload preserves only keys, and callers cannot mutate the stored Set', async t => {
  const f = store(t), api = await fresh();
  assert.deepEqual(api.hideRecommendation({ bvid: BV, title: 'private title', track_id: 'private track', owner: { mid: 123 } }),
    { key: 'bv:' + BV, persistent: true, changed: true });
  const keys = api.getHiddenRecommendationKeys();
  keys.clear(); keys.add('av:99');
  assert.deepEqual([...api.getHiddenRecommendationKeys()], ['bv:' + BV]);
  assert.equal(f.read(), JSON.stringify(['bv:' + BV]));
  const reloaded = await fresh();
  assert.deepEqual([...reloaded.getHiddenRecommendationKeys()], ['bv:' + BV]);
  assert.equal(reloaded.lastHiddenRecommendation(), 'bv:' + BV);
  assert.equal(f.state.reads, 2);
});

test('duplicates preserve order and restoration targets the supplied key', async t => {
  const f = store(t), api = await fresh();
  assert.equal(api.lastHiddenRecommendation(), null);
  api.hideRecommendation({ aid: 1 }); api.hideRecommendation({ aid: 2 });
  assert.deepEqual(api.hideRecommendation({ id: '001' }), { key: 'av:1', persistent: true, changed: false });
  assert.equal(f.state.writes.length, 2);
  assert.equal(api.lastHiddenRecommendation(), 'av:2');
  assert.deepEqual(api.restoreRecommendation('av:1'), { persistent: true, changed: true });
  assert.equal(api.lastHiddenRecommendation(), 'av:2');
  assert.deepEqual(api.restoreRecommendation('av:1'), { persistent: true, changed: false });
  api.hideRecommendation({ aid: 1 });
  assert.deepEqual([...api.getHiddenRecommendationKeys()], ['av:2', 'av:1']);
  api.restoreRecommendation(api.lastHiddenRecommendation());
  assert.equal(api.lastHiddenRecommendation(), 'av:2');
  api.restoreRecommendation('av:2');
  assert.equal(api.lastHiddenRecommendation(), null);
  assert.equal(f.read(), '[]');
});

test('capacity evicts the oldest key while repeated hiding does not change recency', async t => {
  const f = store(t), api = await fresh();
  for (let aid = 1; aid <= 500; aid++) api.hideRecommendation({ aid });
  api.hideRecommendation({ aid: 1 });
  api.hideRecommendation({ aid: 501 });
  const keys = [...api.getHiddenRecommendationKeys()];
  assert.equal(keys.length, 500); assert.equal(keys[0], 'av:2'); assert.equal(keys.at(-1), 'av:501');
  assert.equal(JSON.parse(f.read()).length, 500);
  assert.equal(api.lastHiddenRecommendation(), 'av:501');
});

test('stored keys are validated, deduplicated before trimming and never reordered by duplicates', async t => {
  const raw = ['av:1', 'av:1', 'av:0', 'av:01', { title: 'private title' }, 'private title', 'bv:' + BV,
    ...Array.from({ length: 501 }, (_, i) => 'av:' + (i + 2)), 'av:1'];
  const f = store(t, JSON.stringify(raw)), api = await fresh();
  const keys = [...api.getHiddenRecommendationKeys()];
  assert.equal(keys.length, 500); assert.equal(keys[0], 'av:3'); assert.equal(keys.at(-1), 'av:502');
  assert.deepEqual(api.hideRecommendation({ aid: 502 }), { key: 'av:502', persistent: true, changed: false });
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.read(), JSON.stringify(keys));
});

for (const [name, raw] of [['malformed JSON', '{broken'], ['object payload', '{"title":"private"}'], ['oversized content', ' '.repeat(32769)]]) {
  test(name + ' reads as empty and is replaced only by a valid operation', async t => {
    const f = store(t, raw), api = await fresh();
    assert.deepEqual([...api.getHiddenRecommendationKeys()], []);
    assert.deepEqual(f.state.writes, []);
    assert.deepEqual(api.hideRecommendation({ aid: 7 }), { key: 'av:7', persistent: true, changed: true });
    assert.equal(f.read(), '["av:7"]');
  });
}

test('write failure preserves memory and repeated hide retries persistence without reordering', async t => {
  const f = store(t, '["av:1"]'), api = await fresh();
  f.state.writeError = true;
  assert.deepEqual(api.hideRecommendation({ aid: 2 }), { key: 'av:2', persistent: false, changed: true });
  assert.deepEqual([...api.getHiddenRecommendationKeys()], ['av:1', 'av:2']);
  assert.equal(f.read(), '["av:1"]');
  assert.deepEqual(api.hideRecommendation({ aid: 2 }), { key: 'av:2', persistent: false, changed: false });
  f.state.writeError = false;
  assert.deepEqual(api.hideRecommendation({ aid: 2 }), { key: 'av:2', persistent: true, changed: false });
  assert.equal(f.read(), '["av:1","av:2"]');
});

test('failed restore remains effective in memory and a repeated restore can persist it later', async t => {
  const f = store(t, '["av:1","av:2"]'), api = await fresh();
  f.state.writeError = true;
  assert.deepEqual(api.restoreRecommendation('av:2'), { persistent: false, changed: true });
  assert.equal(api.lastHiddenRecommendation(), 'av:1');
  assert.deepEqual(api.restoreRecommendation('av:2'), { persistent: false, changed: false });
  f.state.writeError = false;
  assert.deepEqual(api.restoreRecommendation('av:2'), { persistent: true, changed: false });
  assert.equal(f.read(), '["av:1"]');
});

test('unreadable initial storage stays in memory mode without overwriting unknown existing preferences', async t => {
  const f = store(t, '["av:99"]'), api = await fresh();
  f.state.readError = true;
  assert.deepEqual(api.hideRecommendation({ aid: 1 }), { key: 'av:1', persistent: false, changed: true });
  f.state.readError = false;
  assert.deepEqual(api.hideRecommendation({ aid: 2 }), { key: 'av:2', persistent: false, changed: true });
  assert.deepEqual([...api.getHiddenRecommendationKeys()], ['av:1', 'av:2']);
  assert.equal(f.read(), '["av:99"]'); assert.deepEqual(f.state.writes, []);
  const reloaded = await fresh();
  assert.deepEqual([...reloaded.getHiddenRecommendationKeys()], ['av:99']);
});

test('missing or inaccessible localStorage is safe and still supports hide/restore', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; });
  for (const inaccessible of [false, true]) {
    delete globalThis.localStorage;
    if (inaccessible) Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('fixture access failure'); } });
    const api = await fresh();
    assert.deepEqual([...api.getHiddenRecommendationKeys()], []);
    assert.deepEqual(api.hideRecommendation({ aid: 1 }), { key: 'av:1', persistent: false, changed: true });
    assert.deepEqual(api.restoreRecommendation('av:1'), { persistent: false, changed: true });
    assert.equal(api.lastHiddenRecommendation(), null);
  }
});

test('notifications are synchronous, isolated and unsubscribe is idempotent', async t => {
  const f = store(t), api = await fresh(), observed = [];
  api.subscribeHiddenRecommendations(() => { throw new Error('fixture listener failure'); });
  const unsubscribe = api.subscribeHiddenRecommendations(() => observed.push([...api.getHiddenRecommendationKeys()]));
  f.state.writeError = true;
  api.hideRecommendation({ aid: 1 });
  assert.deepEqual(observed, [['av:1']]);
  api.hideRecommendation({ aid: 1 });
  assert.equal(observed.length, 1);
  api.restoreRecommendation('av:1');
  assert.deepEqual(observed, [['av:1'], []]);
  unsubscribe(); unsubscribe();
  api.hideRecommendation({ aid: 2 });
  assert.equal(observed.length, 2);
  assert.doesNotThrow(() => api.subscribeHiddenRecommendations(null)());
});

test('listeners that replace their own subscription are visited once per change', async t => {
  store(t); const api = await fresh();
  let calls = 0, unsubscribe;
  const listener = () => { calls++; unsubscribe(); unsubscribe = api.subscribeHiddenRecommendations(listener); };
  unsubscribe = api.subscribeHiddenRecommendations(listener);
  api.hideRecommendation({ aid: 1 }); assert.equal(calls, 1);
  api.hideRecommendation({ aid: 2 }); assert.equal(calls, 2);
  unsubscribe();
});
