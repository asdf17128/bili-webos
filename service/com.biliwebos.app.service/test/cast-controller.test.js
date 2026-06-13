const test = require('node:test');
const assert = require('node:assert/strict');

const { CastController } = require('../cast/castController');

test('parse play command into video intent', () => {
  const controller = new CastController();

  const intent = controller.handleCommand('session-1', 'Play', JSON.stringify({
    aid: 123,
    bvid: 'BV1xx411c7mD',
    cid: 456,
    title: 'test video',
    seekTs: 123.4,
  }));

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

  const intent = controller.handleCommand('session-1', 'Play', JSON.stringify({
    roomId: 987654,
    title: 'live room',
  }));

  assert.equal(intent.type, 'play');
  assert.equal(intent.contentType, 'live');
  assert.equal(intent.roomId, 987654);
});

test('parse playurl command via nva_ext payload into video intent', () => {
  const controller = new CastController();
  const ext = encodeURIComponent(JSON.stringify({
    content: {
      aid: 22,
      cid: 33,
      bvid: 'BV1ab411c7mD',
      title: 'from playurl',
    },
  }));

  const intent = controller.handleCommand('session-1', 'PlayUrl', JSON.stringify({
    url: `https://example.com/play?foo=bar&nva_ext=${ext}`,
  }));

  assert.equal(intent.type, 'play');
  assert.equal(intent.contentType, 'video');
  assert.equal(intent.aid, 22);
  assert.equal(intent.cid, 33);
  assert.equal(intent.bvid, 'BV1ab411c7mD');
});

test('unsupported playurl payload is ignored without clobbering active session', () => {
  const controller = new CastController();

  controller.handleCommand('session-1', 'Play', JSON.stringify({ aid: 1, cid: 2, bvid: 'BV1' }));
  const before = controller.getStatus();
  const result = controller.handleCommand('session-1', 'PlayUrl', JSON.stringify({
    url: 'https://example.com/play?foo=bar',
  }));
  const after = controller.getStatus();

  assert.equal(result, null);
  assert.deepEqual(after.activeContent, before.activeContent);
});

test('reporting state and progress produces outbound NVA events', () => {
  const controller = new CastController();
  const sent = [];

  controller.attachSession({
    id: 'session-1',
    sendCommand(action, content) {
      sent.push({ action, content });
    },
    sendReply() {},
    sendEmpty() {},
  });

  controller.handleCommand('session-1', 'Play', JSON.stringify({ aid: 1, cid: 2, bvid: 'BV1' }));
  controller.reportState({ playState: 'playing' });
  controller.reportProgress({ duration: 100, position: 45 });

  assert.deepEqual(sent, [
    { action: 'OnPlayState', content: { playState: 4 } },
    { action: 'OnProgress', content: { duration: 100, position: 45 } },
  ]);
});


test('parse seek command with seekTs field', () => {
  const controller = new CastController();
  const intent = controller.handleCommand('session-1', 'Seek', JSON.stringify({ seekTs: 88 }));
  assert.deepEqual(intent, { type: 'seek', positionSec: 88 });
});
