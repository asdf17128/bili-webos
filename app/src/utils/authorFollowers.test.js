// All requests and time are fixtures; these tests never access an account or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { authorFollowerCount, createAuthorFollowersStore, normalizeAuthorMid } from './authorFollowers.js';

const response = count => ({ code: 0, data: { follower: count } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(request, options = {}) {
  let time = 0, id = 0;
  const timers = new Map(), calls = [];
  const store = createAuthorFollowersStore(mid => { calls.push(mid); return request(mid); }, {
    now: () => time,
    setTimer(fn, delay) { const timer = ++id; timers.set(timer, { fn, at: time + delay }); return timer; },
    clearTimer: timer => timers.delete(timer),
    ...options,
  });
  return { store, calls, timers, advance(ms) {
    time += ms;
    for (const [timer, entry] of timers) if (entry.at <= time) { timers.delete(timer); entry.fn(); }
  } };
}

test('stable author IDs accept safe positive integer numbers or digit strings only', () => {
  assert.equal(normalizeAuthorMid(42), '42');
  assert.equal(normalizeAuthorMid('00042'), '42');
  for (const mid of [null, undefined, '', 0, '0', -1, 1.5, true, false, {}, [], 'name', '1e2', ' 1', '1.0',
    Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.equal(normalizeAuthorMid(mid), null, String(mid));
  }
});

test('only a successful nonnegative safe integer count is known; zero remains zero', () => {
  assert.equal(authorFollowerCount(response(0)), 0);
  assert.equal(authorFollowerCount(response(12345)), 12345);
  for (const count of [undefined, null, '', '42', false, true, -1, .5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(authorFollowerCount(response(count)), null, String(count));
  }
  for (const value of [null, {}, { code: 0 }, { code: '0', data: { follower: 1 } }, { code: -1, data: { follower: 1 } }]) {
    assert.equal(authorFollowerCount(value), null);
  }
});

test('invalid authors never dispatch a request', async () => {
  const { store, calls } = fixture(() => response(1));
  for (const mid of [null, 0, -1, 'display name', { mid: 42 }, Infinity]) assert.equal(await store.load(mid), null);
  assert.deepEqual(calls, []);
});

test('same normalized author shares one in-flight request and returns only the count', async () => {
  const pending = deferred(), { store, calls, timers } = fixture(() => pending.promise);
  const a = store.load(42), b = store.load('00042');
  assert.strictEqual(a, b);
  await tick();
  assert.deepEqual(calls, ['42']);
  pending.resolve({ ...response(12), data: { follower: 12, name: 'private-profile-fixture' }, token: 'private-token-fixture' });
  assert.equal(await a, 12);
  assert.equal(await b, 12);
  assert.equal(await store.load(42), 12);
  assert.equal(calls.length, 1);
  assert.equal(timers.size, 0);
});

test('different author requests remain independent even when they finish out of order', async () => {
  const a = deferred(), b = deferred();
  const { store, calls } = fixture(mid => mid === '1' ? a.promise : b.promise);
  const first = store.load(1), second = store.load(2);
  await tick();
  b.resolve(response(222));
  assert.equal(await second, 222);
  a.resolve(response(111));
  assert.equal(await first, 111);
  assert.equal(await store.load(2), 222);
  assert.deepEqual(calls, ['1', '2']);
});

test('success cache lasts five minutes, including a real zero', async () => {
  let count = 0;
  const { store, calls, advance } = fixture(() => response(count++));
  assert.equal(await store.load(1), 0);
  advance(299999);
  assert.equal(await store.load(1), 0);
  assert.equal(calls.length, 1);
  advance(1);
  assert.equal(await store.load(1), 1);
  assert.equal(calls.length, 2);
});

for (const failure of [() => { throw new Error('private error'); }, () => Promise.reject(new Error('private error')),
  () => ({ code: -412, data: { follower: 9 } }), () => response(null)]) {
  test('failure is null with a short 30-second retry backoff', async () => {
    let failed = true;
    const { store, calls, advance, timers } = fixture(() => failed ? failure() : response(5));
    assert.equal(await store.load(1), null);
    failed = false;
    advance(29999);
    assert.equal(await store.load(1), null);
    assert.equal(calls.length, 1);
    advance(1);
    assert.equal(await store.load(1), 5);
    assert.equal(calls.length, 2);
    assert.equal(timers.size, 0);
  });
}

test('bounded cache evicts the least recently used author', async () => {
  const { store, calls } = fixture(mid => response(Number(mid)), { maxEntries: 2 });
  for (const mid of [1, 2, 1, 3, 1]) assert.equal(await store.load(mid), mid);
  assert.deepEqual(calls, ['1', '2', '3']);
  assert.equal(await store.load(2), 2);
  assert.deepEqual(calls, ['1', '2', '3', '2']);
});

test('in-flight entries are also bounded without evicting deduplication locks', async () => {
  const a = deferred(), b = deferred();
  const { store, calls } = fixture(mid => mid === '1' ? a.promise : b.promise, { maxEntries: 2 });
  const first = store.load(1), second = store.load(2);
  assert.equal(await store.load(3), null);
  assert.strictEqual(store.load(1), first);
  assert.deepEqual(calls, ['1', '2']);
  a.resolve(response(1)); b.resolve(response(2));
  await Promise.all([first, second]);
});

for (const late of ['resolve', 'reject']) {
  test('timeout releases the lock and late ' + late + ' cannot overwrite a retry', async () => {
    const old = deferred(), retry = deferred();
    let call = 0;
    const { store, advance, calls, timers } = fixture(() => ++call === 1 ? old.promise : retry.promise);
    const first = store.load(1);
    await tick();
    advance(12000);
    assert.equal(await first, null);
    assert.equal(await store.load(1), null, 'deadline failure uses normal backoff');
    advance(30000);
    const next = store.load(1);
    await tick();
    if (late === 'resolve') old.resolve(response(999)); else old.reject(new Error('old failure'));
    await tick();
    assert.strictEqual(store.load(1), next, 'late response cannot release the new lock');
    retry.resolve(response(7));
    assert.equal(await next, 7);
    assert.equal(await store.load(1), 7);
    assert.deepEqual(calls, ['1', '1']);
    assert.equal(timers.size, 0);
  });
}
