import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const NOW = 1700000000000;
const TTL = 600000;
const KEYS = { imgKey: '0123456789abcdef0123456789abcdef', subKey: 'fedcba9876543210fedcba9876543210' };
const NEXT_KEYS = { imgKey: 'abcdefghijklmnopqrstuvwxyz123456', subKey: '654321zyxwvutsrqponmlkjihgfedcba' };
const expectedSignature = 'cid=123&wts=1700000000&w_rid=f197a96260cbd8ba7cd40f4e30dc3fef';
const nav = (keys = KEYS, code = 0) => ({ code, data: { wbi_img: {
  img_url: 'https://fixture.invalid/' + keys.imgKey + '.png',
  sub_url: 'https://fixture.invalid/' + keys.subKey + '.png',
} } });
let fixtureId = 0;
const fresh = () => import('./wbi.js?fixture=' + (++fixtureId));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
function clock(t) {
  let now = NOW;
  t.mock.method(Date, 'now', () => now);
  return value => { now = value; };
}

test('HTML nav failure cannot poison the next real WBI signature for ten minutes', async t => {
  clock(t);
  const { getWbiKeys, signWbi } = await fresh();
  let calls = 0, firstError;
  const fetch = async () => ++calls === 1
    ? { returnValue: true, status: 503, contentType: 'text/html', body: '<html>temporary outage</html>' }
    : nav();
  try { await getWbiKeys(fetch); } catch (error) { firstError = error; }
  const recovered = await getWbiKeys(fetch);
  const signed = signWbi({ cid: 123 }, recovered.imgKey, recovered.subKey);
  const query = signed.slice(0, signed.lastIndexOf('&w_rid='));
  assert.deepEqual({
    firstRejected: firstError instanceof Error,
    nextAttemptRefetched: calls === 2,
    validReplacementUsed: recovered.imgKey === KEYS.imgKey && recovered.subKey === KEYS.subKey,
    signatureUsesEmptyMixin: signed.endsWith('w_rid=' + createHash('md5').update(query).digest('hex')),
  }, { firstRejected: true, nextAttemptRefetched: true, validReplacementUsed: true, signatureUsesEmptyMixin: false });
  assert.equal(signed, expectedSignature);
});

const invalidResponses = [
  ['null body', null],
  ['business failure without keys', { code: -352, message: 'fixture upstream error' }],
  ['missing image object', { code: 0, data: {} }],
  ['missing second key', { code: 0, data: { wbi_img: { img_url: nav().data.wbi_img.img_url } } }],
  ['non-string image URL', { code: 0, data: { wbi_img: { ...nav().data.wbi_img, img_url: 123 } } }],
  ['empty key', nav({ ...KEYS, imgKey: '' })],
  ['short key', nav({ ...KEYS, imgKey: KEYS.imgKey.slice(1) })],
  ['overlong key', nav({ ...KEYS, subKey: KEYS.subKey + '0' })],
  ['invalid key character', nav({ ...KEYS, imgKey: '!' + KEYS.imgKey.slice(1) })],
];
for (const [name, response] of invalidResponses) test(name + ' is rejected without caching or exposing its contents', async t => {
  clock(t);
  const { getWbiKeys } = await fresh();
  let calls = 0;
  const fetch = async () => ++calls === 1 ? response : nav();
  await assert.rejects(getWbiKeys(fetch), error => {
    assert.equal(error.code, 'WBI_KEYS_INVALID');
    assert.equal(error.message, 'Invalid WBI key response');
    return true;
  });
  assert.deepEqual(await getWbiKeys(fetch), KEYS);
  assert.equal(calls, 2);
});

test('anonymous nav keys remain usable and successful keys are cached', async t => {
  clock(t);
  const { getWbiKeys, signWbi } = await fresh();
  let calls = 0;
  const fetch = async () => { calls++; return nav(KEYS, -101); };
  assert.deepEqual(await getWbiKeys(fetch), KEYS);
  const cached = await getWbiKeys(fetch);
  assert.equal(calls, 1);
  assert.equal(signWbi({ cid: 123 }, cached.imgKey, cached.subKey), expectedSignature);
});

test('complete opaque alphanumeric keys and URL query suffixes are retained', async t => {
  clock(t);
  const { getWbiKeys } = await fresh();
  const response = nav(NEXT_KEYS);
  response.data.wbi_img.img_url += '?cache=fixture#image';
  assert.deepEqual(await getWbiKeys(async () => response), NEXT_KEYS);
});

test('concurrent cache misses keep independent nav requests', async t => {
  clock(t);
  const { getWbiKeys } = await fresh();
  const first = deferred(), second = deferred();
  let calls = 0;
  const fetch = () => ++calls === 1 ? first.promise : second.promise;
  const a = getWbiKeys(fetch), b = getWbiKeys(fetch);
  second.resolve(nav(NEXT_KEYS));
  assert.deepEqual(await b, NEXT_KEYS, 'the second request can finish while the first remains in flight');
  first.resolve(nav());
  assert.deepEqual(await a, KEYS);
  assert.equal(calls, 2);
});

test('one failed concurrent request cannot reject or poison another successful request', async t => {
  clock(t);
  const { getWbiKeys } = await fresh();
  const first = deferred(), second = deferred(), failure = new Error('fixture network failure');
  let calls = 0;
  const fetch = () => ++calls === 1 ? first.promise : second.promise;
  const a = getWbiKeys(fetch), b = getWbiKeys(fetch);
  const rejected = assert.rejects(a, error => error === failure);
  second.resolve(nav());
  assert.deepEqual(await b, KEYS);
  first.reject(failure);
  await rejected;
  assert.deepEqual(await getWbiKeys(fetch), KEYS, 'late failure leaves the valid cache intact');
  assert.equal(calls, 2);
});

test('synchronous fetch exceptions do not cache invalid keys', async t => {
  clock(t);
  const { getWbiKeys } = await fresh();
  const failure = new Error('fixture synchronous failure');
  await assert.rejects(getWbiKeys(() => { throw failure; }), error => error === failure);
  assert.deepEqual(await getWbiKeys(async () => nav()), KEYS);
});

test('cache TTL begins when valid keys arrive and refreshes at its boundary', async t => {
  const at = clock(t);
  const { getWbiKeys } = await fresh();
  const pending = deferred();
  let calls = 0;
  const fetch = () => { calls++; return calls === 1 ? pending.promise : Promise.resolve(nav(NEXT_KEYS)); };
  const initial = getWbiKeys(fetch);
  at(NOW + 5000); pending.resolve(nav()); await initial;
  at(NOW + 5000 + TTL - 1);
  assert.deepEqual(await getWbiKeys(fetch), KEYS);
  assert.equal(calls, 1);
  at(NOW + 5000 + TTL);
  assert.deepEqual(await getWbiKeys(fetch), NEXT_KEYS);
  assert.equal(calls, 2);
});

test('an invalid refresh neither serves stale keys nor prevents immediate recovery', async t => {
  const at = clock(t);
  const { getWbiKeys } = await fresh();
  let calls = 0;
  const fetch = async () => { calls++; return calls === 1 ? nav() : calls === 2 ? { code: -503 } : nav(NEXT_KEYS); };
  await getWbiKeys(fetch);
  at(NOW + TTL);
  await assert.rejects(getWbiKeys(fetch), { code: 'WBI_KEYS_INVALID' });
  assert.deepEqual(await getWbiKeys(fetch), NEXT_KEYS);
  assert.equal(calls, 3);
});

test('wall clock rollback expires cached keys instead of extending them', async t => {
  const at = clock(t);
  const { getWbiKeys } = await fresh();
  let calls = 0;
  const fetch = async () => ++calls === 1 ? nav() : nav(NEXT_KEYS);
  await getWbiKeys(fetch);
  at(NOW - 1);
  assert.deepEqual(await getWbiKeys(fetch), NEXT_KEYS);
  assert.equal(calls, 2);
});

test('manual clear expires cached keys immediately without waiting for the TTL', async t => {
  clock(t);
  const { getWbiKeys, clearWbiKeys } = await fresh();
  let calls = 0;
  const fetch = async () => ++calls === 1 ? nav() : nav(NEXT_KEYS);
  assert.deepEqual(await getWbiKeys(fetch), KEYS);
  clearWbiKeys();
  assert.deepEqual(await getWbiKeys(fetch), NEXT_KEYS);
  assert.equal(calls, 2);
});

test('a pre-clear response cannot replace freshly fetched keys or be used to sign', async t => {
  clock(t);
  const { getWbiKeys, clearWbiKeys } = await fresh();
  const old = deferred();
  const pending = getWbiKeys(() => old.promise);
  const rejected = assert.rejects(pending, { code: 'WBI_KEYS_STALE', message: 'WBI key request expired' });
  clearWbiKeys();
  assert.deepEqual(await getWbiKeys(async () => nav(NEXT_KEYS)), NEXT_KEYS);
  old.resolve(nav());
  await rejected;
  assert.deepEqual(await getWbiKeys(() => assert.fail('fresh keys must remain cached')), NEXT_KEYS);
});

test('a pre-clear response cannot refill an empty cache before the next request', async t => {
  clock(t);
  const { getWbiKeys, clearWbiKeys } = await fresh();
  const old = deferred();
  const pending = getWbiKeys(() => old.promise);
  const rejected = assert.rejects(pending, { code: 'WBI_KEYS_STALE' });
  clearWbiKeys();
  old.resolve(nav());
  await rejected;
  let calls = 0;
  assert.deepEqual(await getWbiKeys(async () => { calls++; return nav(NEXT_KEYS); }), NEXT_KEYS);
  assert.equal(calls, 1);
});

test('repeated clears invalidate every earlier request while a later request recovers', async t => {
  clock(t);
  const { getWbiKeys, clearWbiKeys } = await fresh();
  const first = deferred(), second = deferred();
  const a = getWbiKeys(() => first.promise);
  const rejectedA = assert.rejects(a, { code: 'WBI_KEYS_STALE' });
  clearWbiKeys();
  const b = getWbiKeys(() => second.promise);
  const rejectedB = assert.rejects(b, { code: 'WBI_KEYS_STALE' });
  clearWbiKeys();
  second.resolve(nav(NEXT_KEYS));
  first.resolve(nav());
  await Promise.all([rejectedA, rejectedB]);
  assert.deepEqual(await getWbiKeys(async () => nav()), KEYS);
});
