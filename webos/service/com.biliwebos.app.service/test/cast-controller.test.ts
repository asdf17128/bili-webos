import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { CastController } from '../src/cast/castController.ts';

test('parse play command into video intent', () => {
  const controller = new CastController();
  const intent = controller.handleCommand(
    'session-1',
    'Play',
    JSON.stringify({
      aid: 123,
      bvid: 'BV1xx411c7mD',
      cid: 456,
      title: 'test video',
      seekTs: 123.4,
    }),
  );
  assert.equal(intent.type, 'play');
  assert.equal(intent.contentType, 'video');
  assert.equal(intent.aid, 123);
  assert.equal(intent.bvid, 'BV1xx411c7mD');
  assert.equal(intent.cid, 456);
  assert.equal(intent.title, 'test video');
  assert.equal(intent.seekTs, 123.4);
});

test('parse play command into live intent', () => {
  const controller = new CastController();
  const intent = controller.handleCommand(
    'session-1',
    'Play',
    JSON.stringify({ roomId: 987654, title: 'live room' }),
  );
  assert.equal(intent.type, 'play');
  assert.equal(intent.contentType, 'live');
  assert.equal(intent.roomId, 987654);
});
