import test from 'node:test';
import assert from 'node:assert/strict';
import { danmakuTrackCount, normalizeDanmakuArea, normalizeDanmakuOpacity, DANMAKU_OPACITIES } from './danmakuArea.js';

test('full area keeps the historical track count', () => {
  for (const scale of [0.8, 1, 1.3, 1.6]) {
    const h = Math.round(48 * scale);
    assert.equal(danmakuTrackCount(h, 1), Math.max(6, Math.floor(1000 / h)));
    assert.equal(danmakuTrackCount(h), Math.max(6, Math.floor(1000 / h)));
  }
});

test('smaller areas scale the track count down', () => {
  assert.equal(danmakuTrackCount(48, 1), 20);
  assert.equal(danmakuTrackCount(48, 0.75), 15);
  assert.equal(danmakuTrackCount(48, 0.5), 10);
  assert.equal(danmakuTrackCount(48, 0.25), 5);
});

test('a restricted area never drops below two tracks', () => {
  assert.equal(danmakuTrackCount(77, 0.25), 3);
  assert.equal(danmakuTrackCount(2000, 0.25), 2);
});

test('unknown stored values fall back to full screen', () => {
  for (const bad of [undefined, null, 0, 0.6, 2, 'x']) assert.equal(normalizeDanmakuArea(bad), 1);
});

test('opacity accepts only the listed steps, anything else is opaque', () => {
  for (const ok of DANMAKU_OPACITIES) assert.equal(normalizeDanmakuOpacity(ok), ok);
  for (const bad of [undefined, null, 0, 0.5, 1.5, 'x']) assert.equal(normalizeDanmakuOpacity(bad), 1);
});
