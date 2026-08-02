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

// Chat messages the app cares about. Danmaku still arrives as a plain string
// (the old contract — app builds < 1.5.1 only understand that); everything
// else rides a second argument as a typed event object, which old apps ignore.
function handleCmd(msg, onDanmaku) {
  if (!msg || !msg.cmd) return;
  // DANMU_MSG carries a suffix on some rooms (DANMU_MSG:4:0:2:2:2:0)
  var cmd = msg.cmd.indexOf('DANMU_MSG') === 0 ? 'DANMU_MSG' : msg.cmd;
  var d = msg.data || {};
  if (cmd === 'DANMU_MSG') {
    var text = msg.info && msg.info[1];
    var user = msg.info && msg.info[2] && msg.info[2][1];
    if (text) onDanmaku(text, { t: 'dm', text: text, user: user });
    return;
  }
  if (cmd === 'SEND_GIFT') {
    onDanmaku(null, { t: 'gift', user: d.uname, gift: d.giftName, num: d.num || 1,
      coin: d.total_coin || 0, face: d.face || '' });
    return;
  }
  if (cmd === 'SUPER_CHAT_MESSAGE') {
    onDanmaku(null, { t: 'sc', user: d.user_info && d.user_info.uname,
      text: d.message, price: d.price || 0 });
    return;
  }
  if (cmd === 'GUARD_BUY') {
    onDanmaku(null, { t: 'guard', user: d.username, level: d.guard_level || 0,
      name: d.gift_name, num: d.num || 1 });
    return;
  }
  if (cmd === 'INTERACT_WORD' || cmd === 'INTERACT_WORD_V2') {
    // msg_type 1 = 进入直播间, 2 = 关注, 3 = 分享
    onDanmaku(null, { t: 'enter', user: d.uname, kind: d.msg_type || 1 });
    return;
  }
  if (cmd === 'WATCHED_CHANGE') {
    onDanmaku(null, { t: 'watched', num: d.num || 0, text: d.text_small || '' });
    return;
  }
  if (cmd === 'LIKE_INFO_V3_UPDATE') {
    onDanmaku(null, { t: 'likes', num: d.click_count || 0 });
    return;
  }
  if (cmd === 'ONLINE_RANK_COUNT') {
    onDanmaku(null, { t: 'online', num: d.count || d.online_count || 0 });
    return;
  }
  if (cmd === 'POPULARITY_RED_POCKET_START') {
    onDanmaku(null, { t: 'redpacket', user: d.sender_uname || '', num: d.num || 1 });
  }
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
