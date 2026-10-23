import test from 'node:test';
import assert from 'node:assert/strict';

const STORAGE_KEY = 'bili_hiddenRecommendationAuthors';
const BV = 'BV1xx411c7mD';
const video = (mid, fields = {}) => ({ bvid: BV, goto: 'av', owner: { mid }, ...fields });
let moduleId = 0;
const fresh = () => import('./hiddenRecommendationAuthors.js?fixture=' + (++moduleId));
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

test('author identity uses only the original owner.mid and shares video eligibility', async () => {
  const { recommendationAuthorKey } = await fresh();
  assert.equal(recommendationAuthorKey(video('00042')), 'up:42');
  assert.equal(recommendationAuthorKey(video(Number.MAX_SAFE_INTEGER)), 'up:9007199254740991');
  assert.equal(recommendationAuthorKey({ aid: 7, owner: { mid: 42 } }), 'up:42');
  for (const invalid of [null, undefined, true, 0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1,
    '1e3', '1.5', '+1', ' 1', '', '0'.repeat(33) + '1']) {
    assert.equal(recommendationAuthorKey(video(invalid)), null);
  }
  for (const fields of [{ owner: null }, { owner: [] }, { owner: { name: '42' }, mid: 42, author: { mid: 42 } },
    { goto: 'live' }, { goto: 'bangumi' }, { goto: '' }, { isLive: true }, { isBangumi: true },
    { isPgc: true }, { isPGC: true }, { pgc: {} }, { business: 'pgc' }, { badge: '番剧' },
    { epid: 1 }, { ep_id: 1 }, { seasonId: 1 }, { season_id: 1 }, { uri: 'https://fixture.invalid/bangumi/play/ep123' }]) {
    assert.equal(recommendationAuthorKey(video(42, fields)), null);
  }
  assert.equal(recommendationAuthorKey({ owner: { mid: 42 } }), null);
});

test('account scope requires a session and a valid UID; missing UID never becomes guest', async () => {
  const { recommendationAccountScope } = await fresh();
  for (const auth of [null, undefined, {}, { DedeUserID: 42 }, { SESSDATA: '', DedeUserID: 42 }]) {
    assert.equal(recommendationAccountScope(auth), 'guest');
  }
  assert.equal(recommendationAccountScope({ SESSDATA: 'synthetic-session', DedeUserID: '00042' }), 'user:42');
  assert.equal(recommendationAccountScope({ SESSDATA: 'replacement-session', DedeUserID: 42 }), 'user:42');
  for (const uid of [undefined, null, false, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '', '1e3', ' 42', '0'.repeat(33) + '1']) {
    assert.equal(recommendationAccountScope({ SESSDATA: 'synthetic-session', DedeUserID: uid }), null);
  }
});

test('unsupported author or account operations perform no storage reads or writes', async t => {
  const f = store(t), api = await fresh();
  const unsupported = { key: null, persistent: false, changed: false, supported: false };
  for (const scope of [null, undefined, '', 'member', 'user:0', 'user:01', 'user:1.5', 'user:9007199254740992', {}]) {
    assert.deepEqual(api.hideRecommendationAuthor(video(42), scope), unsupported);
    assert.deepEqual(api.restoreRecommendationAuthor('up:42', scope), { persistent: false, changed: false, supported: false });
    assert.deepEqual([...api.getHiddenRecommendationAuthorKeys(scope)], []);
    assert.equal(api.lastHiddenRecommendationAuthor(scope), null);
  }
  for (const item of [null, {}, video(null), video(42, { goto: 'live' })]) {
    assert.deepEqual(api.hideRecommendationAuthor(item, 'guest'), unsupported);
  }
  for (const key of [null, {}, 'up:0', 'up:01', 'up:1.5', 'up:9007199254740992', 'av:42', BV]) {
    assert.deepEqual(api.restoreRecommendationAuthor(key, 'guest'), { persistent: false, changed: false, supported: false });
  }
  assert.equal(f.state.reads, 0);
  assert.deepEqual(f.state.writes, []);
});

test('guest and accounts remain isolated across reload, restore and session replacement', async t => {
  const f = store(t), api = await fresh();
  const a = api.recommendationAccountScope({ SESSDATA: 'synthetic-a', DedeUserID: 11 });
  const b = api.recommendationAccountScope({ SESSDATA: 'synthetic-b', DedeUserID: 22 });
  api.hideRecommendationAuthor(video(1), 'guest');
  api.hideRecommendationAuthor(video(2, { title: 'private-title', track_id: 'private-track', owner: { mid: 2, name: 'private-name' } }), a);
  api.hideRecommendationAuthor(video(2), b);
  api.hideRecommendationAuthor(video(3), b);
  assert.deepEqual([...api.getHiddenRecommendationAuthorKeys('guest')], ['up:1']);
  assert.deepEqual([...api.getHiddenRecommendationAuthorKeys(a)], ['up:2']);
  assert.deepEqual([...api.getHiddenRecommendationAuthorKeys(b)], ['up:2', 'up:3']);
  const copy = api.getHiddenRecommendationAuthorKeys(a); copy.clear(); copy.add('up:99');
  const rotated = api.recommendationAccountScope({ SESSDATA: 'synthetic-new-session', DedeUserID: '0011' });
  assert.deepEqual([...api.getHiddenRecommendationAuthorKeys(rotated)], ['up:2']);
  assert.deepEqual(api.restoreRecommendationAuthor('up:2', a), { persistent: true, changed: true, supported: true });
  assert.equal(api.lastHiddenRecommendationAuthor(a), null);
  assert.equal(api.lastHiddenRecommendationAuthor(b), 'up:3');
  assert.equal(f.read(), JSON.stringify([['guest', ['up:1']], ['user:22', ['up:2', 'up:3']]]));
  const reloaded = await fresh();
  assert.deepEqual([...reloaded.getHiddenRecommendationAuthorKeys(a)], []);
  assert.deepEqual([...reloaded.getHiddenRecommendationAuthorKeys(b)], ['up:2', 'up:3']);
  assert.deepEqual([...reloaded.getHiddenRecommendationAuthorKeys('guest')], ['up:1']);
});

test('restore targets the selected author and scope; duplicate hides preserve last-hidden order', async t => {
  const f = store(t), api = await fresh();
  api.hideRecommendationAuthor(video(1), 'guest'); api.hideRecommendationAuthor(video(2), 'guest');
  assert.deepEqual(api.hideRecommendationAuthor(video('001'), 'guest'), { key: 'up:1', persistent: true, changed: false, supported: true });
  assert.equal(f.state.writes.length, 2);
  assert.equal(api.lastHiddenRecommendationAuthor('guest'), 'up:2');
  assert.deepEqual(api.restoreRecommendationAuthor('up:1', 'guest'), { persistent: true, changed: true, supported: true });
  assert.deepEqual(api.restoreRecommendationAuthor('up:1', 'guest'), { persistent: true, changed: false, supported: true });
  api.hideRecommendationAuthor(video(1), 'guest');
  assert.equal(api.lastHiddenRecommendationAuthor('guest'), 'up:1');
  api.restoreRecommendationAuthor(api.lastHiddenRecommendationAuthor('guest'), 'guest');
  assert.deepEqual([...api.getHiddenRecommendationAuthorKeys('guest')], ['up:2']);
  api.restoreRecommendationAuthor('up:2', 'guest');
  assert.equal(f.read(), '[]');
});

test('each scope is bounded to 500 authors and the store to eight scopes', async t => {
  const f = store(t), api = await fresh();
  for (let id = 1; id <= 500; id++) api.hideRecommendationAuthor(video(id), 'guest');
  api.hideRecommendationAuthor(video(1), 'guest');
  api.hideRecommendationAuthor(video(501), 'guest');
  const keys = [...api.getHiddenRecommendationAuthorKeys('guest')];
  assert.equal(keys.length, 500); assert.equal(keys[0], 'up:2'); assert.equal(keys.at(-1), 'up:501');
  for (let uid = 1; uid <= 7; uid++) api.hideRecommendationAuthor(video(uid), 'user:' + uid);
  assert.equal(JSON.parse(f.read()).length, 8);
  api.hideRecommendationAuthor(video(501), 'guest'); // Reading/repeating does not reorder scopes.
  api.hideRecommendationAuthor(video(8), 'user:8');
  assert.deepEqual([...api.getHiddenRecommendationAuthorKeys('guest')], []);
  assert.deepEqual(JSON.parse(f.read()).map(([scope]) => scope), Array.from({ length: 8 }, (_, i) => 'user:' + (i + 1)));
  assert.deepEqual([...api.getHiddenRecommendationAuthorKeys('user:1')], ['up:1']);
  const reloaded = await fresh();
  assert.equal(reloaded.lastHiddenRecommendationAuthor('user:8'), 'up:8');
  assert.deepEqual([...reloaded.getHiddenRecommendationAuthorKeys('guest')], []);
});

test('stored scopes and authors are validated, deduplicated and bounded before use', async t => {
  const raw = [
    ['user:01', ['up:9']], ['unknown', ['up:9']], { title: 'private-title' },
    ['guest', ['up:1', 'up:1', 'up:0', 'up:01', 'av:2', { name: 'private-name' }]],
    ['guest', [...Array.from({ length: 501 }, (_, i) => 'up:' + (i + 2)), 'up:1']],
    ['user:1', []], ['user:2', 'up:1'], ['user:3', ['up:3'], 'private-track'],
  ];
  const f = store(t, JSON.stringify(raw)), api = await fresh();
  const keys = [...api.getHiddenRecommendationAuthorKeys('guest')];
  assert.equal(keys.length, 500); assert.equal(keys[0], 'up:3'); assert.equal(keys.at(-1), 'up:502');
  assert.deepEqual([...api.getHiddenRecommendationAuthorKeys('user:3')], []);
  assert.equal(f.state.writes.length, 0);
  assert.deepEqual(api.hideRecommendationAuthor(video(502), 'guest'), { key: 'up:502', persistent: true, changed: false, supported: true });
  assert.equal(f.read(), JSON.stringify([['guest', keys]]));
});

test('oversized stored scope count keeps the newest eight valid scopes', async t => {
  const raw = Array.from({ length: 10 }, (_, i) => ['user:' + (i + 1), ['up:' + (i + 1)]]);
  const f = store(t, JSON.stringify(raw)), api = await fresh();
  assert.deepEqual([...api.getHiddenRecommendationAuthorKeys('user:1')], []);
  assert.deepEqual([...api.getHiddenRecommendationAuthorKeys('user:3')], ['up:3']);
  api.hideRecommendationAuthor(video(10), 'user:10');
  assert.deepEqual(JSON.parse(f.read()), raw.slice(2));
});

test('duplicate scope entries cannot reintroduce an evicted author by changing its recency', async t => {
  const original = Array.from({ length: 501 }, (_, i) => 'up:' + (i + 1));
  const f = store(t, JSON.stringify([['guest', original], ['guest', ['up:1']]])), api = await fresh();
  assert.deepEqual([...api.getHiddenRecommendationAuthorKeys('guest')], original.slice(1));
  api.hideRecommendationAuthor(video(501), 'guest');
  assert.equal(f.read(), JSON.stringify([['guest', original.slice(1)]]));
});

for (const [name, raw] of [['malformed JSON', '{broken'], ['object payload', '{"guest":["up:1"]}'], ['oversized content', ' '.repeat(131073)]]) {
  test(name + ' is read as empty and replaced only by a valid operation', async t => {
    const f = store(t, raw), api = await fresh();
    assert.deepEqual([...api.getHiddenRecommendationAuthorKeys('guest')], []);
    assert.deepEqual(f.state.writes, []);
    assert.deepEqual(api.hideRecommendationAuthor(video(7), 'guest'), { key: 'up:7', persistent: true, changed: true, supported: true });
    assert.equal(f.read(), '[["guest",["up:7"]]]');
  });
}

test('quota failures preserve scoped memory; repeating hide and restore retries persistence', async t => {
  const f = store(t, '[["guest",["up:1"]],["user:11",["up:4"]]]'), api = await fresh();
  f.state.writeError = true;
  assert.deepEqual(api.hideRecommendationAuthor(video(2), 'guest'), { key: 'up:2', persistent: false, changed: true, supported: true });
  assert.deepEqual(api.hideRecommendationAuthor(video(2), 'guest'), { key: 'up:2', persistent: false, changed: false, supported: true });
  assert.deepEqual([...api.getHiddenRecommendationAuthorKeys('guest')], ['up:1', 'up:2']);
  f.state.writeError = false;
  assert.deepEqual(api.hideRecommendationAuthor(video(2), 'guest'), { key: 'up:2', persistent: true, changed: false, supported: true });
  f.state.writeError = true;
  assert.deepEqual(api.restoreRecommendationAuthor('up:4', 'user:11'), { persistent: false, changed: true, supported: true });
  assert.equal(api.lastHiddenRecommendationAuthor('user:11'), null);
  assert.deepEqual(api.restoreRecommendationAuthor('up:4', 'user:11'), { persistent: false, changed: false, supported: true });
  f.state.writeError = false;
  assert.deepEqual(api.restoreRecommendationAuthor('up:4', 'user:11'), { persistent: true, changed: false, supported: true });
  assert.equal(f.read(), '[["guest",["up:1","up:2"]]]');
});

test('unreadable initial storage stays in memory without overwriting unknown account preferences', async t => {
  const f = store(t, '[["user:11",["up:99"]]]'), api = await fresh();
  f.state.readError = true;
  assert.deepEqual(api.hideRecommendationAuthor(video(1), 'guest'), { key: 'up:1', persistent: false, changed: true, supported: true });
  f.state.readError = false;
  assert.deepEqual(api.hideRecommendationAuthor(video(2), 'user:11'), { key: 'up:2', persistent: false, changed: true, supported: true });
  assert.deepEqual([...api.getHiddenRecommendationAuthorKeys('user:11')], ['up:2']);
  assert.equal(f.read(), '[["user:11",["up:99"]]]'); assert.deepEqual(f.state.writes, []);
  const reloaded = await fresh();
  assert.deepEqual([...reloaded.getHiddenRecommendationAuthorKeys('user:11')], ['up:99']);
});

test('missing or inaccessible localStorage still supports isolated hide and restore in memory', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; });
  for (const inaccessible of [false, true]) {
    delete globalThis.localStorage;
    if (inaccessible) Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('fixture access failure'); } });
    const api = await fresh();
    assert.deepEqual(api.hideRecommendationAuthor(video(1), 'guest'), { key: 'up:1', persistent: false, changed: true, supported: true });
    assert.deepEqual([...api.getHiddenRecommendationAuthorKeys('user:11')], []);
    assert.deepEqual(api.restoreRecommendationAuthor('up:1', 'guest'), { persistent: false, changed: true, supported: true });
    assert.equal(api.lastHiddenRecommendationAuthor('guest'), null);
  }
});

test('notifications expose current scoped state, isolate failures and support unsubscribe during delivery', async t => {
  const f = store(t), api = await fresh(), observed = [];
  api.subscribeHiddenRecommendationAuthors(() => { throw new Error('fixture listener failure'); });
  let unsubscribe;
  const listener = () => {
    observed.push([api.lastHiddenRecommendationAuthor('guest'), api.lastHiddenRecommendationAuthor('user:11')]);
    unsubscribe(); unsubscribe = api.subscribeHiddenRecommendationAuthors(listener);
  };
  unsubscribe = api.subscribeHiddenRecommendationAuthors(listener);
  f.state.writeError = true;
  api.hideRecommendationAuthor(video(1), 'guest');
  api.hideRecommendationAuthor(video(1), 'guest');
  api.hideRecommendationAuthor(video(2), 'user:11');
  api.restoreRecommendationAuthor('up:1', 'guest');
  assert.deepEqual(observed, [['up:1', null], ['up:1', 'up:2'], [null, 'up:2']]);
  unsubscribe(); unsubscribe();
  api.hideRecommendationAuthor(video(3), 'guest');
  assert.equal(observed.length, 3);
  assert.doesNotThrow(() => api.subscribeHiddenRecommendationAuthors(null)());
});
