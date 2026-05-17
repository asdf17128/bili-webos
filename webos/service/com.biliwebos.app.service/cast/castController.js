var EventEmitter = require('events');

var PLAY_STATE_MAP = {
  idle: 0,
  loading: 3,
  playing: 4,
  paused: 5,
  end: 6,
  stop: 7,
  error: 8,
};

function safeJsonParse(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function toNumber(value) {
  var n = Number(value);
  return isFinite(n) ? n : 0;
}

function normalizePlayPayload(payload) {
  payload = payload || {};
  var seekTs = toNumber(payload.seekTs || payload.seek_ts || payload.position || payload.positionSec);
  var roomId = toNumber(payload.roomId || payload.room_id);
  if (roomId > 0) {
    return {
      type: 'play',
      contentType: 'live',
      roomId: roomId,
      title: payload.title || '',
      seekTs: seekTs,
    };
  }

  var aid = toNumber(payload.aid);
  var cid = toNumber(payload.cid);
  var epid = toNumber(payload.epid || payload.epId);
  var bvid = payload.bvid || '';
  if (!aid && !cid && !epid && !bvid) return null;

  return {
    type: 'play',
    contentType: 'video',
    aid: aid || undefined,
    cid: cid || undefined,
    epid: epid || undefined,
    bvid: bvid || undefined,
    title: payload.title || '',
    seekTs: seekTs,
  };
}

function parsePlayUrlPayload(payload) {
  if (!payload || !payload.url) return null;
  try {
    var parsed = new URL(payload.url);
    var ext = parsed.searchParams.get('nva_ext');
    if (!ext) return null;
    var decoded = safeJsonParse(decodeURIComponent(ext));
    return normalizePlayPayload(decoded.content || decoded);
  } catch (e) {
    return null;
  }
}

function CastController() {
  this.sessions = new Map();
  this.emitter = new EventEmitter();
  this.status = {
    sessionId: null,
    deviceIp: null,
    httpPort: null,
    activeContent: null,
    playState: 'idle',
    progress: 0,
    duration: 0,
    lastCommandAt: 0,
    lastError: null,
  };
}

CastController.prototype.attachSession = function (session) {
  this.sessions.set(session.id, session);
  this.status.sessionId = session.id;
};

CastController.prototype.detachSession = function (sessionId) {
  this.sessions.delete(sessionId);
  if (this.status.sessionId === sessionId) this.status.sessionId = null;
};

CastController.prototype.onIntent = function (listener) {
  this.emitter.on('intent', listener);
  return this;
};

CastController.prototype.emitIntent = function (intent) {
  this.emitter.emit('intent', intent);
};

CastController.prototype.handleCommand = function (sessionId, action, rawBody) {
  var payload = safeJsonParse(rawBody);
  var intent = null;

  this.status.sessionId = sessionId;
  this.status.lastCommandAt = Date.now();

  if (action === 'Play') {
    intent = normalizePlayPayload(payload);
    if (intent) this.status.activeContent = intent;
  } else if (action === 'PlayUrl') {
    intent = parsePlayUrlPayload(payload);
    if (intent) this.status.activeContent = intent;
  } else if (action === 'Pause') {
    intent = { type: 'pause' };
  } else if (action === 'Resume') {
    intent = { type: 'resume' };
  } else if (action === 'Stop') {
    intent = { type: 'stop' };
    this.status.playState = 'stop';
  } else if (action === 'Seek') {
    intent = { type: 'seek', positionSec: toNumber(payload.seekTs || payload.position || payload.positionSec) };
  } else if (action === 'SwitchDanmaku') {
    intent = { type: 'switchDanmaku', open: !!payload.open };
  }

  if (intent) this.emitIntent(intent);
  return intent;
};

CastController.prototype.reportState = function (payload) {
  payload = payload || {};
  this.status.playState = payload.playState || this.status.playState;
  this.status.lastError = payload.error || null;

  var numericState = PLAY_STATE_MAP[this.status.playState];
  if (typeof numericState === 'number') {
    this.sessions.forEach(function (session) {
      session.sendCommand('OnPlayState', { playState: numericState });
    });
  }
};

CastController.prototype.reportProgress = function (payload) {
  payload = payload || {};
  this.status.duration = toNumber(payload.duration);
  this.status.progress = toNumber(payload.position);

  this.sessions.forEach(function (session) {
    session.sendCommand('OnProgress', {
      duration: payload.duration || 0,
      position: payload.position || 0,
    });
  });
};

CastController.prototype.ack = function (payload) {
  payload = payload || {};
  this.status.lastAckAt = Date.now();
  this.status.lastAck = payload;
};

CastController.prototype.setNetworkInfo = function (ip, httpPort) {
  this.status.deviceIp = ip;
  this.status.httpPort = httpPort;
};

CastController.prototype.getStatus = function () {
  return JSON.parse(JSON.stringify(this.status));
};

module.exports = {
  CastController: CastController,
  PLAY_STATE_MAP: PLAY_STATE_MAP,
};
