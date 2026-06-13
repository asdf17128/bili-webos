// Live danmaku relay (runs in the Node service, not the browser).
// Connects to B站's chat WS — auth must use the real uid (the DedeUserID cookie);
// uid:0 with a logged-in token is rejected with a 1006 — parses DANMU_MSG
// packets and hands the text back to the app.
var WebSocket = require('ws');
var zlib = require('zlib');

var OP_HEARTBEAT = 2;
var OP_MESSAGE = 5;
var OP_AUTH = 7;

function buildPacket(op, bodyStr) {
  var body = Buffer.from(bodyStr || '', 'utf-8');
  var buf = Buffer.alloc(16 + body.length);
  buf.writeUInt32BE(16 + body.length, 0);
  buf.writeUInt16BE(16, 4);
  buf.writeUInt16BE(1, 6);
  buf.writeUInt32BE(op, 8);
  buf.writeUInt32BE(1, 12);
  body.copy(buf, 16);
  return buf;
}

function handleCmd(msg, onDanmaku) {
  if (!msg || msg.cmd !== 'DANMU_MSG') return;
  var text = msg.info && msg.info[1];
  var user = msg.info && msg.info[2] && msg.info[2][1];
  if (text) onDanmaku(text, user);
}

function parse(buf, onDanmaku) {
  var offset = 0;
  while (offset + 16 <= buf.length) {
    var packLen = buf.readUInt32BE(offset);
    if (packLen <= 0) break;
    var headerLen = buf.readUInt16BE(offset + 4);
    var protover = buf.readUInt16BE(offset + 6);
    var op = buf.readUInt32BE(offset + 8);
    var body = buf.slice(offset + headerLen, offset + packLen);
    if (op === OP_MESSAGE) {
      try {
        if (protover === 2) parse(zlib.inflateSync(body), onDanmaku);
        else if (protover === 3) parse(zlib.brotliDecompressSync(body), onDanmaku);
        else if (protover === 0) handleCmd(JSON.parse(body.toString('utf-8')), onDanmaku);
      } catch (e) { /* skip bad packet */ }
    }
    offset += packLen;
  }
}

// connectDanmaku(opts, onDanmaku) -> stop(). Gives up after a few failed
// auth attempts so it doesn't reconnect forever against a rejecting server.
function connectDanmaku(opts, onDanmaku) {
  var closed = false;
  var ws = null;
  var hb = null;
  var attempts = 0;
  var gotData = false;

  function connect() {
    if (closed || attempts >= 4) return;
    attempts++;
    var host = opts.host || 'broadcastlv.chat.bilibili.com';
    var port = opts.port || 443;
    var url = 'wss://' + host + (port !== 443 ? ':' + port : '') + '/sub';
    ws = new WebSocket(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://live.bilibili.com',
        'Cookie': opts.cookie || '',
      },
      rejectUnauthorized: false,
    });
    ws.on('open', function () {
      ws.send(buildPacket(OP_AUTH, JSON.stringify({
        uid: opts.uid || 0, roomid: opts.roomid, protover: 3,
        buvid: opts.buvid || '', platform: 'web', type: 2, key: opts.token,
      })));
      hb = setInterval(function () {
        try { ws.send(buildPacket(OP_HEARTBEAT, '[object Object]')); } catch (e) {}
      }, 30000);
    });
    ws.on('message', function (data) {
      if (!gotData) { gotData = true; attempts = 0; }
      try { parse(Buffer.isBuffer(data) ? data : Buffer.from(data), onDanmaku); } catch (e) {}
    });
    ws.on('error', function () { try { ws.close(); } catch (e) {} });
    ws.on('close', function () {
      if (hb) { clearInterval(hb); hb = null; }
      if (!closed) setTimeout(connect, 3000);
    });
  }
  connect();

  return function stop() {
    closed = true;
    if (hb) clearInterval(hb);
    try { ws && ws.close(); } catch (e) {}
  };
}

module.exports = { connectDanmaku: connectDanmaku };
