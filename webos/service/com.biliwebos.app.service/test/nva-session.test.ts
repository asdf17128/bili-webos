import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  decodeFrame,
  encodeCommand,
  encodeEmptyReply,
  encodeJsonReply,
  NvaSession,
} from '../src/cast/nvaSession.ts';
import { EventEmitter } from 'node:events';

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
});

test('encode json reply and command frames', () => {
  assert.equal(encodeJsonReply(3, { volume: 30 })[0], 0xc0);
  assert.equal(encodeCommand(4, 'OnPlayState', { playState: 4 })[0], 0xe0);
  assert.deepEqual(Array.from(encodeEmptyReply(7).subarray(0, 6)), [
    0xc0, 0x00, 0x00, 0x00, 0x00, 0x07,
  ]);
});

test('NvaSession parses chunked frames and sends replies', () => {
  class FakeSocket extends EventEmitter {
    written = [];
    destroyed = false;
    write(buf) {
      this.written.push(buf);
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const socket = new FakeSocket();
  const seen = [];
  const session = new NvaSession('s1', socket, (_s, frame) => seen.push(frame));
  const frame = Buffer.concat([
    Buffer.from([0xe0, 0x03, 0x00, 0x00, 0x00, 0x02, 0x01, 0x07]),
    Buffer.from('Command'),
    Buffer.from([0x05]),
    Buffer.from('Pause'),
    Buffer.from([0x00, 0x00, 0x00, 0x02]),
    Buffer.from('{}'),
  ]);
  socket.emit('data', frame);
  assert.equal(seen[0].action, 'Pause');
  session.sendReply({ ok: true });
  assert.equal(socket.written.length, 1);
});
