// Live danmaku relay (runs in the Node service, not the browser).
// Connects to B站's chat WS — auth must use the real uid (the DedeUserID cookie);
// uid:0 with a logged-in token is rejected with a 1006 — parses DANMU_MSG
// packets and hands the text back to the app.
// ws@7 needs Node 8 (it is written with const/class); webOS 4.x services run
// Node v0.12, where it throws a SyntaxError at require(). Fall back to the
// vendored ws@1 (supports Node 0.10+), same on/send/close API we use here.
var WebSocket;
try { WebSocket = require('ws'); } catch (e) {
  WebSocket = require('ws-legacy');
  require('./wsLegacyLimits')(WebSocket.Receiver);
}
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

// A WebSocket message may contain several protocol packets, including nested
// compressed packets. Control replies must be parsed independently of chat.
function parse(buf, onDanmaku, onPacket, depth) {
  if ((depth || 0) > 8) throw new Error('packet-depth');
  var offset = 0;
  while (offset < buf.length) {
    if (offset + 16 > buf.length) throw new Error('packet-header');
    var packLen = buf.readUInt32BE(offset);
    var headerLen = buf.readUInt16BE(offset + 4);
    if (headerLen < 16 || packLen < headerLen || offset + packLen > buf.length) throw new Error('packet-length');
    var protover = buf.readUInt16BE(offset + 6);
    var op = buf.readUInt32BE(offset + 8);
    var body = buf.slice(offset + headerLen, offset + packLen);
    if (op === 8) onPacket('auth', JSON.parse(body.toString('utf-8')));
    else if (op === 3 && body.length >= 4) onPacket('heartbeat');
    else if (op === OP_MESSAGE) {
      if (protover === 2) parse(zlib.inflateSync(body), onDanmaku, onPacket, (depth || 0) + 1);
      else if (protover === 3 && zlib.brotliDecompressSync) parse(zlib.brotliDecompressSync(body), onDanmaku, onPacket, (depth || 0) + 1);
      else if (protover === 0) {
        var message = JSON.parse(body.toString('utf-8'));
        onPacket('message');
        handleCmd(message, onDanmaku);
      }
    }
    offset += packLen;
  }
}

// A single owned connection and retry timer. Consecutive failures back off;
// authenticated connections with a valid reply after 30s restore the budget.
// Persistent failures remain visible and probe once per minute, rather than
// exhausting a lifetime retry count and silently stopping until the next room.
function connectDanmaku(opts, onDanmaku) {
  var https = require('https');
  var closed = false, current = null, retryTimer = null;
  var state = {
    phase: 'connecting', connected: false, connections: 0, consecutiveFailures: 0,
    packetsReceived: 0, messagesReceived: 0, eventsDelivered: 0, parseErrors: 0,
    heartbeatsSent: 0, heartbeatsReceived: 0,
    lastPacketAt: null, lastMessageAt: null, lastEventAt: null,
    lastHeartbeatAt: null, lastHeartbeatReplyAt: null,
    lastCloseCode: null, lastAuthCode: null, lastError: null, retryAt: null
  };
  function alive(c) { return !closed && current === c && !c.ended; }
  function clearTimers(c) {
    clearTimeout(c.connectTimer); clearTimeout(c.authTimer); clearTimeout(c.replyTimer); clearInterval(c.heartbeatTimer);
    c.connectTimer = c.authTimer = c.replyTimer = c.heartbeatTimer = null;
  }
  function dispose(c) {
    clearTimers(c);
    // ws@1 terminate() does not abort its CONNECTING HTTP request and may
    // wait 30s for an OPEN socket. Own both resources through a private Agent.
    try { if (c.ws) c.ws.terminate(); } catch (e) {}
    try { if (c.request) c.request.abort(); } catch (e) {}
    try { if (c.transportSocket) c.transportSocket.destroy(); } catch (e) {}
    try { if (c.agent) c.agent.destroy(); } catch (e) {}
  }
  function fail(c, reason, code) {
    if (!alive(c)) return;
    c.ended = true; current = null;
    state.connected = false; state.phase = 'backoff'; state.lastError = reason;
    if (typeof code === 'number') state.lastCloseCode = code;
    state.consecutiveFailures++;
    var delays = [3000, 6000, 12000, 30000, 60000];
    var delay = delays[Math.min(state.consecutiveFailures - 1, delays.length - 1)];
    if (reason === 'auth-rejected') delay = 60000;
    state.retryAt = Date.now() + delay;
    dispose(c);
    retryTimer = setTimeout(function () { retryTimer = null; connect(); }, delay);
  }
  function send(c, op, body) {
    if (!alive(c)) return;
    try {
      c.ws.send(buildPacket(op, body), function (err) { if (err) fail(c, 'send-error'); });
    } catch (e) { fail(c, 'send-error'); }
  }
  function heartbeat(c) {
    if (!alive(c) || !c.authenticated) return;
    // A reply deadline belongs to this connection, never to a newer socket.
    if (c.replyTimer) return;
    state.lastHeartbeatAt = Date.now(); state.heartbeatsSent++;
    c.replyTimer = setTimeout(function () { fail(c, 'heartbeat-timeout'); }, 20000);
    send(c, OP_HEARTBEAT, '[object Object]');
  }
  function healthy(c) {
    if (c.authenticated && Date.now() - c.openedAt >= 30000) state.consecutiveFailures = 0;
  }
  function onPacket(c, type, data) {
    if (!alive(c)) return;
    if (type === 'auth') {
      if (!data || typeof data.code !== 'number' || c.authenticated) return;
      state.lastAuthCode = data.code;
      if (data.code !== 0) { fail(c, 'auth-rejected'); return; }
      c.authenticated = true; clearTimeout(c.authTimer); c.authTimer = null;
      state.phase = 'connected'; state.connected = true;
      heartbeat(c);
      if (alive(c)) c.heartbeatTimer = setInterval(function () { heartbeat(c); }, 30000);
    } else if (c.authenticated && type === 'heartbeat') {
      clearTimeout(c.replyTimer); c.replyTimer = null;
      state.lastHeartbeatReplyAt = Date.now(); state.heartbeatsReceived++; healthy(c);
    } else if (c.authenticated && type === 'message') {
      state.lastMessageAt = Date.now(); state.messagesReceived++; healthy(c);
    }
  }
  function connect() {
    if (closed) return;
    state.phase = 'connecting'; state.connected = false; state.retryAt = null; state.connections++;
    var c = { ended: false, authenticated: false, openedAt: null, ws: null, request: null, transportSocket: null };
    current = c;
    c.connectTimer = setTimeout(function () { fail(c, 'connect-timeout'); }, 10000);
    try {
      c.agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
      var addRequest = c.agent.addRequest;
      c.agent.addRequest = function (request) {
        c.request = request;
        request.on('socket', function (socket) {
          c.transportSocket = socket;
          if (!alive(c)) socket.destroy();
        });
        if (!alive(c)) { request.abort(); return; }
        return addRequest.apply(this, arguments);
      };
      var host = opts.host || 'broadcastlv.chat.bilibili.com';
      var port = opts.port || 443;
      c.ws = new WebSocket('wss://' + host + (port !== 443 ? ':' + port : '') + '/sub', {
        agent: c.agent, maxPayload: 4 * 1024 * 1024, maxFragments: 4096, perMessageDeflate: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': 'https://live.bilibili.com', 'Cookie': opts.cookie || ''
        },
        rejectUnauthorized: false
      });
      c.ws.on('open', function () {
        if (!alive(c)) return;
        clearTimeout(c.connectTimer); c.connectTimer = null; c.openedAt = Date.now(); state.phase = 'authenticating';
        c.authTimer = setTimeout(function () { fail(c, 'auth-timeout'); }, 10000);
        send(c, OP_AUTH, JSON.stringify({
          uid: opts.uid || 0, roomid: opts.roomid, protover: zlib.brotliDecompressSync ? 3 : 2,
          buvid: opts.buvid || '', platform: 'web', type: 2, key: opts.token
        }));
      });
      c.ws.on('message', function (data) {
        if (!alive(c)) return;
        state.lastPacketAt = Date.now(); state.packetsReceived++;
        try {
          parse(Buffer.isBuffer(data) ? data : Buffer.from(data), function (text, evt) {
            if (!alive(c) || !c.authenticated) return;
            state.lastEventAt = Date.now(); state.eventsDelivered++;
            onDanmaku(text, evt);
          }, function (type, payload) { onPacket(c, type, payload); });
        } catch (e) { if (alive(c)) state.parseErrors++; }
      });
      c.ws.on('error', function () { fail(c, 'socket-error'); });
      c.ws.on('close', function (code) { fail(c, 'socket-close', code); });
    } catch (e) { fail(c, 'connect-error'); }
  }
  function stop() {
    if (closed) return;
    closed = true; clearTimeout(retryTimer); retryTimer = null;
    if (current) { current.ended = true; dispose(current); current = null; }
    state.phase = 'stopped'; state.connected = false; state.retryAt = null;
  }
  stop.getState = function () {
    var snapshot = {};
    Object.keys(state).forEach(function (key) { snapshot[key] = state[key]; });
    return snapshot;
  };
  connect();
  return stop;
}

module.exports = { connectDanmaku: connectDanmaku };
