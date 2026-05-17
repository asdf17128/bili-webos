const { test } = require('bun:test');
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

test('decode ping frame and command without action/body', () => {
  const ping = Buffer.from([0xe4, 0x00, 0x00, 0x00, 0x00, 0x09]);
  const decodedPing = decodeFrame(ping);
  assert.equal(decodedPing.type, 'ping');
  assert.equal(decodedPing.version, 9);

  const cmd = Buffer.concat([
    Buffer.from([0xe0, 0x01, 0x00, 0x00, 0x00, 0x01, 0x01, 0x07]),
    Buffer.from('Command'),
  ]);
  const decodedCmd = decodeFrame(cmd);
  assert.equal(decodedCmd.command, 'Command');
  assert.equal(decodedCmd.action, '');
});

test('NvaSession parses chunked frames and sends replies/commands/pings', () => {
  const { EventEmitter } = require('node:events');
  const { NvaSession } = require('../cast/nvaSession');

  class FakeSocket extends EventEmitter {
    constructor() { super(); this.written = []; this.destroyed = false; }
    write(buf) { this.written.push(buf); }
    destroy() { this.destroyed = true; }
  }

  const socket = new FakeSocket();
  const frames = [];
  let closed = 0;
  const session = new NvaSession('s1', socket, (s, frame) => frames.push({ s, frame }), () => { closed += 1; });

  const frame = Buffer.concat([
    Buffer.from([0xe0, 0x03, 0x00, 0x00, 0x00, 0x02, 0x01, 0x07]),
    Buffer.from('Command'),
    Buffer.from([0x05]),
    Buffer.from('Pause'),
    Buffer.from([0x00, 0x00, 0x00, 0x02]),
    Buffer.from('{}'),
  ]);

  socket.emit('data', frame.subarray(0, 5));
  socket.emit('data', frame.subarray(5));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].frame.action, 'Pause');

  session.sendEmpty();
  session.sendReply({ ok: true });
  session.sendCommand('OnPlayState', { playState: 4 });
  session.sendPing();
  assert.equal(socket.written.length, 4);

  session.close();
  session.close();
  assert.equal(socket.destroyed, true);
  assert.equal(closed, 1);
});

test('NvaSession handles reply frames, ping timer, and socket lifecycle events', () => {
  const { EventEmitter } = require('node:events');
  const { NvaSession } = require('../cast/nvaSession');

  class FakeSocket extends EventEmitter {
    constructor() { super(); this.written = []; this.destroyed = false; }
    write(buf) { this.written.push(buf); }
    destroy() { this.destroyed = true; }
  }

  const socket = new FakeSocket();
  const seen = [];
  let closed = 0;
  const session = new NvaSession('s2', socket, (s, frame) => seen.push({ s, frame }), () => { closed += 1; });

  const body = Buffer.from('{"ok":1}');
  const reply = Buffer.concat([
    Buffer.from([0xc0, 0x01, 0x00, 0x00, 0x00, 0x03]),
    Buffer.from([0x00, 0x00, 0x00, body.length]),
    body,
  ]);
  socket.emit('data', reply);
  assert.equal(seen[0].frame.type, 'reply');
  assert.equal(seen[0].frame.version, 3);

  const unknownReply = Buffer.from([0xc0, 0x02, 0x00, 0x00, 0x00, 0x04]);
  socket.emit('data', unknownReply);
  assert.equal(seen.length, 2);

  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let timerFn;
  global.setInterval = (fn) => {
    timerFn = fn;
    return { id: 'timer' };
  };
  global.clearInterval = () => {};

  session.startPing();
  timerFn();
  assert.equal(socket.written.at(-1)[0], 0xe4);

  socket.emit('end');
  socket.emit('close');
  socket.emit('error', new Error('x'));
  assert.equal(closed, 1);

  global.setInterval = originalSetInterval;
  global.clearInterval = originalClearInterval;
});


test('sendBuffer is a no-op after session is closed', () => {
  const { EventEmitter } = require('node:events');
  const { NvaSession } = require('../cast/nvaSession');

  class FakeSocket extends EventEmitter {
    constructor() { super(); this.written = []; this.destroyed = false; }
    write(buf) { this.written.push(buf); }
    destroy() { this.destroyed = true; }
  }

  const socket = new FakeSocket();
  const session = new NvaSession('s3', socket);
  session.close();
  session.sendBuffer(Buffer.from([0x01]));

  assert.equal(socket.written.length, 0);
});

test('session tolerates missing callbacks and socket destroy errors', () => {
  const { EventEmitter } = require('node:events');
  const { NvaSession } = require('../cast/nvaSession');

  class FakeSocket extends EventEmitter {
    constructor() { super(); this.written = []; }
    write(buf) { this.written.push(buf); }
    destroy() { throw new Error('destroy failed'); }
  }

  const socket = new FakeSocket();
  const session = new NvaSession('s4', socket, null, null);

  const ping = Buffer.from([0xe4, 0x00, 0x00, 0x00, 0x00, 0x09]);
  socket.emit('data', ping);
  assert.equal(session.currentVersion, 9);

  assert.doesNotThrow(() => session.close());
});
