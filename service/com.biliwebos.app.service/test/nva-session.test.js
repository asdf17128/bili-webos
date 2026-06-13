const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decodeFrame,
  encodeEmptyReply,
  encodeJsonReply,
  encodeCommand,
} = require('../cast/nvaSession');

test('decode command frame with json body', () => {
  const frame = Buffer.concat([
    Buffer.from([0xe0, 0x03, 0x00, 0x00, 0x00, 0x02, 0x01, 0x07]),
    Buffer.from('Command'),
    Buffer.from([0x04]),
    Buffer.from('Play'),
    Buffer.from([0x00, 0x00, 0x00, 0x14]),
    Buffer.from('{"aid":1,"cid":2}'),
  ]);

  const decoded = decodeFrame(frame);

  assert.equal(decoded.type, 'command');
  assert.equal(decoded.action, 'Play');
  assert.equal(decoded.body, '{"aid":1,"cid":2}');
  assert.equal(decoded.version, 2);
});

test('encode json reply and command frames', () => {
  const reply = encodeJsonReply(3, { volume: 30 });
  const command = encodeCommand(4, 'OnPlayState', { playState: 4 });

  assert.equal(reply[0], 0xc0);
  assert.equal(reply[1], 0x01);
  assert.equal(command[0], 0xe0);
  assert.equal(command[1], 0x03);
});

test('encode empty reply frame', () => {
  const reply = encodeEmptyReply(7);

  assert.deepEqual(Array.from(reply.subarray(0, 6)), [0xc0, 0x00, 0x00, 0x00, 0x00, 0x07]);
});
