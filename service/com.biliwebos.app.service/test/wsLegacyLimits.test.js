const test = require('node:test');
const assert = require('node:assert/strict');
const Receiver = require('ws-legacy').Receiver;
const limit = require('../wsLegacyLimits');

function receiver() {
  const r = new Receiver({}, 4 * 1024 * 1024);
  r.errors = []; r.messages = [];
  r.onerror = (e, code) => r.errors.push(code);
  r.onbinary = data => r.messages.push(data);
  return r;
}
test('positive control: unbounded legacy receiver retains 4100 empty fragments', () => {
  const r = receiver();
  for (let i = 0; i < 4100; i++) r.add(Buffer.from([i ? 0 : 2, 0]));
  assert.equal(r.errors.length, 0);
  assert.ok(r.currentMessage.length >= 4100);
  r.cleanup();
  limit(Receiver);
});
test('legacy receiver rejects excessive fragments, including one socket chunk', () => {
  const r = receiver();
  const frames = Buffer.alloc(4100 * 2); frames[0] = 2;
  r.add(frames);
  assert.deepEqual(r.errors, [1009]);
});
test('legacy receiver bounds queued socket chunks', () => {
  const r = receiver(); r.expectBuffer = null;
  for (let i = 0; i < 1100; i++) r.add(Buffer.from([0]));
  assert.deepEqual(r.errors, [1009]);
});
test('normal fragmented and separate messages still work', () => {
  const r = receiver();
  for (let i = 0; i < 4500; i++) r.add(Buffer.from([0x82, 1, 65]));
  r.add(Buffer.from([2, 1, 66, 0x80, 1, 67]));
  assert.equal(r.errors.length, 0);
  assert.equal(r.messages.length, 4501);
  assert.equal(r.messages[4500].toString(), 'BC');
  r.cleanup();
});
