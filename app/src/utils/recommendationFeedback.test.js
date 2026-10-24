import test from 'node:test';
import assert from 'node:assert/strict';
import { isRecommendationFeedbackReason, recommendationFeedbackContext } from './recommendationFeedback.js';

const video = () => ({ goto: 'av', id: 123, aid: 456, owner: { mid: 789 }, track_id: 'fixture-track' });

test('accepts only the official numeric video and UP reasons', () => {
  for (const reason of [1, 4]) assert.equal(isRecommendationFeedbackReason(reason), true);
  for (const reason of [2, 3, 0, -1, 1.5, NaN, Infinity, '1', '4', null, undefined, true, {}, [1], [4]]) {
    assert.equal(isRecommendationFeedbackReason(reason), false, String(reason));
  }
});

test('keeps only recommendation context and prefers the original recommendation id', () => {
  const input = { ...video(), bvid: 'BVFixture', reason_id: 4, title: 'Private title', owner: { mid: '789', name: 'Private name' } };
  const before = JSON.stringify(input);
  assert.deepEqual(recommendationFeedbackContext(input), { goto: 'av', id: 123, mid: 789, track_id: 'fixture-track' });
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(recommendationFeedbackContext({ ...video(), id: undefined }), { goto: 'av', id: 456, mid: 789, track_id: 'fixture-track' });
  assert.equal(recommendationFeedbackContext({ ...video(), id: 0 }), null);
});

test('requires positive safe integer ids without coercing unrelated values', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '', ' ', true, {}, '1e3', '1.2', '-1', '+1', ' 1', '9007199254740992']) {
    assert.equal(recommendationFeedbackContext({ ...video(), id: value }), null, 'id: ' + String(value));
    assert.equal(recommendationFeedbackContext({ ...video(), owner: { mid: value } }), null, 'mid: ' + String(value));
  }
  assert.equal(recommendationFeedbackContext({ ...video(), id: '123' }).id, 123);
  assert.equal(recommendationFeedbackContext({ ...video(), owner: undefined }), null);
  assert.equal(recommendationFeedbackContext({ ...video(), owner: {} }), null);
  assert.equal(recommendationFeedbackContext({ ...video(), track_id: undefined }), null);
  assert.equal(recommendationFeedbackContext({ ...video(), id: undefined, aid: undefined }), null);
});

test('only av recommendations with intact bounded tracking context are eligible', () => {
  for (const value of [null, undefined, {}, { ...video(), goto: 'live' }, { ...video(), goto: undefined }]) {
    assert.equal(recommendationFeedbackContext(value), null);
  }
  for (const track_id of [undefined, null, 123, '', ' ', ' fixture', 'fixture ', 'a\nb', 'a\u0000b', 'a\u007fb', 'x'.repeat(1025)]) {
    assert.equal(recommendationFeedbackContext({ ...video(), track_id }), null);
  }
  assert.equal(recommendationFeedbackContext({ ...video(), track_id: 'x'.repeat(1024) }).track_id.length, 1024);
});

test('honors either explicit server disable flag and tolerates missing flags', () => {
  assert.ok(recommendationFeedbackContext(video()));
  assert.ok(recommendationFeedbackContext({ ...video(), dislike_switch: 1, dislike_switch_pc: 1 }));
  for (const flags of [{ dislike_switch: 0 }, { dislike_switch_pc: 0 }, { dislike_switch: 1, dislike_switch_pc: 0 }]) {
    assert.equal(recommendationFeedbackContext({ ...video(), ...flags }), null);
  }
});
