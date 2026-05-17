function readUInt32BE(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function writeUInt32BE(value) {
  var buf = Buffer.alloc(4);
  buf.writeUInt32BE(value >>> 0, 0);
  return buf;
}

function decodeFrame(buffer) {
  var typeByte = buffer[0];
  var paramCount = buffer[1];
  var version = readUInt32BE(buffer, 2);
  var frame = {
    rawType: typeByte,
    version: version,
    paramCount: paramCount,
    type: typeByte === 0xe0 ? 'command' : (typeByte === 0xc0 ? 'reply' : 'ping'),
    command: '',
    action: '',
    body: '',
  };

  if (paramCount === 0) return frame;

  var cursor = 6;
  if (buffer.length > cursor) cursor += 1; // marker
  var commandLength = buffer[cursor];
  cursor += 1;
  frame.command = buffer.subarray(cursor, cursor + commandLength).toString('utf8');
  cursor += commandLength;

  if (typeByte !== 0xe0 || paramCount === 1) return frame;

  var actionLength = buffer[cursor];
  cursor += 1;
  frame.action = buffer.subarray(cursor, cursor + actionLength).toString('utf8');
  cursor += actionLength;

  if (paramCount === 3) {
    var bodyLength = readUInt32BE(buffer, cursor);
    cursor += 4;
    frame.body = buffer.subarray(cursor, cursor + bodyLength).toString('utf8');
  }

  return frame;
}

function encodeEmptyReply(version) {
  return Buffer.concat([
    Buffer.from([0xc0, 0x00]),
    writeUInt32BE(version)
  ]);
}

function encodeJsonReply(version, content) {
  var body = Buffer.from(JSON.stringify(content || {}));
  return Buffer.concat([
    Buffer.from([0xc0, 0x01]),
    writeUInt32BE(version),
    writeUInt32BE(body.length),
    body
  ]);
}

function encodeCommand(version, action, content) {
  var command = Buffer.from('Command');
  var actionBuf = Buffer.from(action || '');
  var body = Buffer.from(JSON.stringify(content || {}));
  return Buffer.concat([
    Buffer.from([0xe0, 0x03]),
    writeUInt32BE(version),
    Buffer.from([0x01, command.length]),
    command,
    Buffer.from([actionBuf.length]),
    actionBuf,
    writeUInt32BE(body.length),
    body
  ]);
}

function encodePing(version) {
  return Buffer.concat([
    Buffer.from([0xe4, 0x00]),
    writeUInt32BE(version)
  ]);
}

function NvaSession(id, socket, onFrame, onClose) {
  this.id = id;
  this.socket = socket;
  this.currentVersion = 1;
  this.buffer = Buffer.alloc(0);
  this.onFrame = onFrame;
  this.onClose = onClose;
  this.closed = false;
  this.pingTimer = null;

  var self = this;
  socket.on('data', function (chunk) {
    self.handleData(chunk);
  });
  socket.on('close', function () {
    self.close();
  });
  socket.on('end', function () {
    self.close();
  });
  socket.on('error', function () {
    self.close();
  });
}

NvaSession.prototype.startPing = function () {
  var self = this;
  if (self.pingTimer) clearInterval(self.pingTimer);
  self.pingTimer = setInterval(function () {
    if (!self.closed) self.sendPing();
  }, 10000);
};

NvaSession.prototype.handleData = function (chunk) {
  this.buffer = Buffer.concat([this.buffer, chunk]);
  while (this.buffer.length >= 6) {
    var typeByte = this.buffer[0];
    var paramCount = this.buffer[1];
    var total = 6;

    if (paramCount === 0) {
      total = 6;
    } else if (typeByte === 0xc0) {
      if (paramCount === 1) {
        if (this.buffer.length < 10) return;
        total = 10 + this.buffer.readUInt32BE(6);
      } else {
        total = 6;
      }
    } else {
      if (this.buffer.length < 9) return;
      var commandLength = this.buffer[7];
      total = 8 + commandLength;
      if (paramCount >= 2) {
        if (this.buffer.length < total + 1) return;
        var actionLength = this.buffer[total];
        total += 1 + actionLength;
      }
      if (paramCount === 3) {
        if (this.buffer.length < total + 4) return;
        total += 4 + this.buffer.readUInt32BE(total);
      }
    }

    if (this.buffer.length < total) return;
    var frameBuffer = this.buffer.subarray(0, total);
    this.buffer = this.buffer.subarray(total);
    var frame = decodeFrame(frameBuffer);
    this.currentVersion = Math.max(this.currentVersion, frame.version);
    if (this.onFrame) this.onFrame(this, frame);
  }
};

NvaSession.prototype.sendBuffer = function (buf) {
  if (!this.closed) this.socket.write(buf);
};

NvaSession.prototype.sendEmpty = function () {
  this.currentVersion += 1;
  this.sendBuffer(encodeEmptyReply(this.currentVersion));
};

NvaSession.prototype.sendReply = function (content) {
  this.currentVersion += 1;
  this.sendBuffer(encodeJsonReply(this.currentVersion, content));
};

NvaSession.prototype.sendCommand = function (action, content) {
  this.currentVersion += 1;
  this.sendBuffer(encodeCommand(this.currentVersion, action, content));
};

NvaSession.prototype.sendPing = function () {
  this.currentVersion += 1;
  this.sendBuffer(encodePing(this.currentVersion));
};

NvaSession.prototype.close = function () {
  if (this.closed) return;
  this.closed = true;
  if (this.pingTimer) clearInterval(this.pingTimer);
  try { this.socket.destroy(); } catch (e) {}
  if (this.onClose) this.onClose(this);
};

module.exports = {
  decodeFrame: decodeFrame,
  encodeEmptyReply: encodeEmptyReply,
  encodeJsonReply: encodeJsonReply,
  encodeCommand: encodeCommand,
  NvaSession: NvaSession,
};
