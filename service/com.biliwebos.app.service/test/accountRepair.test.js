'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, run } = require('../../../tools/test-account-repair-service-es5');

test('ES5 mock acceptance cases', run);

test('status returns only safe presence and rate-limit fields', () => {
  const f = fixture();
  assert.deepEqual(f.api.status(), { returnValue: true, supported: true, hasDeviceIdentity: true, hasAccount: true, busy: false, retryAfterSeconds: 0 });
  f.state.jar = {};
  assert.equal(f.api.status().hasAccount, false);
  assert.equal(f.api.status().hasDeviceIdentity, false);
  const pending = f.start();
  assert.equal(f.api.status().busy, true);
  f.reply();
  assert.equal(pending.length, 1);
  assert.equal(f.api.status().busy, false);
  assert.ok(f.api.status().retryAfterSeconds > 0);
  assert.equal(JSON.stringify(f.api.status()).includes('buvid3'), false);
});

for (const payload of [null, {}, { confirm: false }, { confirm: 1 }, { confirm: 'true' }]) {
  test('confirmation must be boolean true: ' + JSON.stringify(payload), () => {
    const f = fixture();
    assert.equal(f.start(payload)[0].errorCode, 'CONFIRM_REQUIRED');
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.state.generation, 0);
  });
}

for (const [name, options] of [
  ['HTTP error', { status: 503 }],
  ['redirect', { status: 302, headers: { location: 'https://example.invalid/redirect' } }],
  ['invalid JSON', { body: 'secret invalid response' }],
  ['null JSON', { body: 'null' }],
  ['business error', { body: { code: -352, data: { b_3: 'new-buvid3-abcdefghijklmnop', b_4: 'new-buvid4-abcdefghijklmnop' } } }],
  ['missing b4', { body: { code: 0, data: { b_3: 'new-buvid3-abcdefghijklmnop' } } }],
  ['short b3', { body: { code: 0, data: { b_3: 'short', b_4: 'new-buvid4-abcdefghijklmnop' } } }],
  ['invalid b4 characters', { body: { code: 0, data: { b_3: 'new-buvid3-abcdefghijklmnop', b_4: 'new-buvid4;SESSDATA=injected' } } }],
  ['duplicate b_nut', { headers: { 'set-cookie': ['b_nut=1700000000; Path=/', 'b_nut=1700000001; Path=/'] } }],
  ['invalid b_nut', { headers: { 'set-cookie': ['b_nut=NaN; Path=/'] } }],
  ['untrusted domain', { headers: { 'set-cookie': ['b_nut=1700000000; Domain=evil.invalid; Path=/'] } }],
  ['wrong path', { headers: { 'set-cookie': ['b_nut=1700000000; Domain=.bilibili.com; Path=/other'] } }],
  ['deleted b_nut', { headers: { 'set-cookie': ['b_nut=1700000000; Path=/; Max-Age=0'] } }],
  ['negative lifetime', { headers: { 'set-cookie': ['b_nut=1700000000; Path=/; Max-Age=-1'] } }],
  ['expired b_nut', { headers: { 'set-cookie': ['b_nut=1700000000; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'] } }],
  ['compressed response', { headers: { 'content-encoding': 'gzip', 'set-cookie': ['b_nut=1700000000; Path=/'] } }],
]) {
  test(name + ' preserves current identity and never retries', () => {
    const f = fixture(); const result = f.start(); f.reply(options);
    assert.equal(result.length, 1);
    assert.equal(result[0].returnValue, false);
    assert.ok(['INVALID_RESPONSE', 'REQUEST_FAILED'].includes(result[0].errorCode));
    assert.deepEqual(f.state.jar, f.original);
    assert.deepEqual(JSON.parse(f.disk[f.file]), f.original);
    assert.equal(f.state.calls.length, 1);
    assert.equal(f.state.opened.length, 0);
    assert.equal(JSON.stringify(result).includes('secret invalid response'), false);
    assert.equal(f.pendingTimers(), 0);
  });
}

test('both fingerprint values must change', () => {
  for (const key of ['b_3', 'b_4']) {
    const f = fixture(); const result = f.start(); const body = f.valid(); body.data[key] = f.original[key === 'b_3' ? 'buvid3' : 'buvid4']; f.reply({ body });
    assert.equal(result[0].errorCode, 'IDENTITY_UNCHANGED');
    assert.deepEqual(f.state.jar, f.original);
    assert.equal(f.state.opened.length, 0);
  }
});

test('response account Set-Cookie is ignored and current unrelated fields survive', () => {
  const f = fixture(); const result = f.start(); f.state.jar.other = 'updated-while-pending';
  f.reply({ headers: { 'set-cookie': ['b_nut=1700000000; Domain=api.bilibili.com; Path=/', 'SESSDATA=untrusted-new-account; Path=/', 'bili_jct=untrusted-csrf; Path=/'] } });
  assert.equal(result[0].returnValue, true);
  assert.equal(f.state.jar.SESSDATA, f.original.SESSDATA);
  assert.equal(f.state.jar.bili_jct, f.original.bili_jct);
  assert.equal(f.state.jar.other, 'updated-while-pending');
});

for (const key of ['SESSDATA', 'DedeUserID']) {
  test('changed ' + key + ' prevents replacement even without a generation bump', () => {
    const f = fixture(); const result = f.start(); f.state.jar[key] = 'different-account'; const before = { ...f.state.jar }; f.reply();
    assert.equal(result[0].errorCode, 'SESSION_CHANGED');
    assert.deepEqual(f.state.jar, before);
    assert.deepEqual(JSON.parse(f.disk[f.file]), f.original);
    assert.equal(f.state.opened.length, 0);
  });
}

test('request timeout before headers destroys request and rejects late headers', () => {
  const f = fixture(); const result = f.start(); f.advance(7499); assert.equal(result.length, 0); f.advance(1);
  assert.equal(result[0].errorCode, 'REQUEST_TIMEOUT');
  assert.equal(f.state.calls[0].destroyed, true);
  const response = f.reply();
  assert.equal(response.destroyed, true);
  assert.equal(result.length, 1);
  assert.equal(f.state.calls.length, 1);
  assert.deepEqual(f.state.jar, f.original);
});

test('each accepted operation fences old requests at start and terminal result', () => {
  for (const failed of [false, true]) {
    const f = fixture(); const result = f.start(); assert.equal(f.state.generation, 1);
    if (failed) f.state.calls[0].emit('error', new Error('fixture'));
    else f.reply();
    assert.equal(result.length, 1); assert.equal(f.state.generation, 2);
    assert.equal(f.start()[0].errorCode, 'COOLDOWN');
    assert.equal(f.state.generation, 2);
  }
});

test('truncated response fails once without retry or persistence', () => {
  const f = fixture(); const result = f.start(); const response = f.headers();
  response.emit('data', Buffer.from('{"code":')); response.emit('aborted'); response.emit('error', new Error('private stream detail')); response.emit('close');
  assert.equal(result.length, 1); assert.equal(result[0].returnValue, false);
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.opened.length, 0);
  assert.deepEqual(f.state.jar, f.original);
  assert.equal(JSON.stringify(result).includes('private stream detail'), false);
});

test('oversized body fails before JSON parsing and cannot commit late data', () => {
  const f = fixture(); const result = f.start(); const response = f.headers();
  response.emit('data', Buffer.alloc(65537, 32));
  assert.equal(result[0].errorCode, 'INVALID_RESPONSE');
  f.body(response, f.valid());
  assert.equal(result.length, 1);
  assert.equal(f.state.opened.length, 0);
  assert.equal(response.destroyed, true);
  assert.deepEqual(f.state.jar, f.original);
});

test('backwards clock cannot bypass cooldown', () => {
  const f = fixture(); f.start(); f.reply(); f.state.time -= 3600000;
  assert.equal(f.api.status().retryAfterSeconds, 600);
  assert.equal(f.start()[0].errorCode, 'COOLDOWN');
  assert.equal(f.state.calls.length, 1);
});

test('pre-existing temporary file is not deleted after exclusive open fails', () => {
  const f = fixture(); const path = f.file + '.repair-' + f.state.time + '-1.tmp';
  f.disk[path] = 'owned-by-another-operation';
  const result = f.start(); f.reply();
  assert.equal(result[0].errorCode, 'PERSISTENCE_FAILED');
  assert.equal(f.disk[path], 'owned-by-another-operation');
  assert.deepEqual(f.state.jar, f.original);
  assert.deepEqual(JSON.parse(f.disk[f.file]), f.original);
});
