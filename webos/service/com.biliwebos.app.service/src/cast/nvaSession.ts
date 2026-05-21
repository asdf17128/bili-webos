function readUInt32BE(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function writeUInt32BE(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value >>> 0, 0);
  return buf;
}

export function decodeFrame(buffer) {
  const typeByte = buffer[0];
  const paramCount = buffer[1];
  const version = readUInt32BE(buffer, 2);
  const frame = {
    rawType: typeByte,
    version,
    paramCount,
    type: typeByte === 0xe0 ? 'command' : typeByte === 0xc0 ? 'reply' : 'ping',
    command: '',
    action: '',
    body: '',
  };

  if (paramCount === 0) return frame;

  let cursor = 6;
  if (buffer.length > cursor) cursor += 1;
  const commandLength = buffer[cursor];
  cursor += 1;
  frame.command = buffer
    .subarray(cursor, cursor + commandLength)
    .toString('utf8');
  cursor += commandLength;

  if (typeByte !== 0xe0 || paramCount === 1) return frame;

  const actionLength = buffer[cursor];
  cursor += 1;
  frame.action = buffer
    .subarray(cursor, cursor + actionLength)
    .toString('utf8');
  cursor += actionLength;

  if (paramCount === 3) {
    const bodyLength = readUInt32BE(buffer, cursor);
    cursor += 4;
    frame.body = buffer.subarray(cursor, cursor + bodyLength).toString('utf8');
  }

  return frame;
}

export function encodeEmptyReply(version) {
  return Buffer.concat([Buffer.from([0xc0, 0x00]), writeUInt32BE(version)]);
}

export function encodeJsonReply(version, content) {
  const body = Buffer.from(JSON.stringify(content || {}));
  return Buffer.concat([
    Buffer.from([0xc0, 0x01]),
    writeUInt32BE(version),
    writeUInt32BE(body.length),
    body,
  ]);
}

export function encodeCommand(version, action, content) {
  const command = Buffer.from('Command');
  const actionBuf = Buffer.from(action || '');
  const body = Buffer.from(JSON.stringify(content || {}));
  return Buffer.concat([
    Buffer.from([0xe0, 0x03]),
    writeUInt32BE(version),
    Buffer.from([0x01, command.length]),
    command,
    Buffer.from([actionBuf.length]),
    actionBuf,
    writeUInt32BE(body.length),
    body,
  ]);
}

function encodePing(version) {
  return Buffer.concat([Buffer.from([0xe4, 0x00]), writeUInt32BE(version)]);
}

export class NvaSession {
  id: string;
  socket: any;
  currentVersion: number;
  buffer: Buffer;
  onFrame?: (session: NvaSession, frame: any) => void;
  onClose?: (session: NvaSession) => void;
  closed: boolean;
  pingTimer: ReturnType<typeof setInterval> | null;

  constructor(id, socket, onFrame, onClose) {
    this.id = id;
    this.socket = socket;
    this.currentVersion = 1;
    this.buffer = Buffer.alloc(0);
    this.onFrame = onFrame;
    this.onClose = onClose;
    this.closed = false;
    this.pingTimer = null;

    socket.on('data', (chunk) => {
      this.handleData(chunk);
    });
    socket.on('close', () => {
      this.close();
    });
    socket.on('end', () => {
      this.close();
    });
    socket.on('error', () => {
      this.close();
    });
  }

  startPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (!this.closed) this.sendPing();
    }, 10000);
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 6) {
      const typeByte = this.buffer[0];
      const paramCount = this.buffer[1];
      let total = 6;

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
        const commandLength = this.buffer[7];
        total = 8 + commandLength;
        if (paramCount >= 2) {
          if (this.buffer.length < total + 1) return;
          const actionLength = this.buffer[total];
          total += 1 + actionLength;
        }
        if (paramCount === 3) {
          if (this.buffer.length < total + 4) return;
          total += 4 + this.buffer.readUInt32BE(total);
        }
      }

      if (this.buffer.length < total) return;
      const frameBuffer = this.buffer.subarray(0, total);
      this.buffer = this.buffer.subarray(total);
      const frame = decodeFrame(frameBuffer);
      this.currentVersion = Math.max(this.currentVersion, frame.version);
      if (this.onFrame) this.onFrame(this, frame);
    }
  }

  sendBuffer(buf) {
    if (!this.closed) this.socket.write(buf);
  }

  sendEmpty() {
    this.currentVersion += 1;
    this.sendBuffer(encodeEmptyReply(this.currentVersion));
  }

  sendReply(content) {
    this.currentVersion += 1;
    this.sendBuffer(encodeJsonReply(this.currentVersion, content));
  }

  sendCommand(action, content) {
    this.currentVersion += 1;
    this.sendBuffer(encodeCommand(this.currentVersion, action, content));
  }

  sendPing() {
    this.currentVersion += 1;
    this.sendBuffer(encodePing(this.currentVersion));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    try {
      this.socket.destroy();
    } catch {}
    if (this.onClose) this.onClose(this);
  }
}
