'use strict';

// ws 1.x is the last branch that loads on Node 0.12. Bound the parser's
// object queues as well as its byte count (CVE-2026-48779). Compression is
// disabled by the caller; Bilibili's own zlib packets are a separate layer.
module.exports = function limitLegacyReceiver(Receiver) {
  var proto = Receiver.prototype;
  if (proto._biliBounded) return;
  proto._biliBounded = true;
  var add = proto.add;
  var processPacket = proto.processPacket;
  proto.add = function (data) {
    if (this.dead) return;
    if (this.overflow.length >= 1024 || this.messageHandlers.length >= 1024) {
      this.error('WebSocket receive queue limit exceeded', 1009);
      return;
    }
    return add.call(this, data);
  };
  proto.processPacket = function (data) {
    var opcode = data[0] & 15;
    if (opcode < 3) {
      if (opcode !== 0) this._biliFragments = 0;
      this._biliFragments = (this._biliFragments || 0) + 1;
      if (this._biliFragments > 4096 || this.messageHandlers.length >= 1024) {
        this.error('WebSocket fragment limit exceeded', 1009);
        return;
      }
    }
    return processPacket.call(this, data);
  };
};
