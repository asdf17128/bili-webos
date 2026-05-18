// @ts-nocheck
import { EventEmitter } from 'node:events';

export const PLAY_STATE_MAP = {
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
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizePlayPayload(payload) {
  payload = payload || {};
  const seekTs = toNumber(
    payload.seekTs ||
      payload.seek_ts ||
      payload.position ||
      payload.positionSec,
  );
  const roomId = toNumber(payload.roomId || payload.room_id);
  if (roomId > 0) {
    return {
      type: 'play',
      contentType: 'live',
      roomId,
      title: payload.title || '',
      seekTs,
    };
  }

  const aid = toNumber(payload.aid);
  const cid = toNumber(payload.cid);
  const epid = toNumber(payload.epid || payload.epId);
  const bvid = payload.bvid || '';
  if (!aid && !cid && !epid && !bvid) return null;

  return {
    type: 'play',
    contentType: 'video',
    aid: aid || undefined,
    cid: cid || undefined,
    epid: epid || undefined,
    bvid: bvid || undefined,
    title: payload.title || '',
    seekTs,
  };
}

function parsePlayUrlPayload(payload) {
  if (!payload || !payload.url) return null;
  try {
    const parsed = new URL(payload.url);
    const ext = parsed.searchParams.get('nva_ext');
    if (!ext) return null;
    const decoded = safeJsonParse(decodeURIComponent(ext));
    return normalizePlayPayload(decoded.content || decoded);
  } catch {
    return null;
  }
}

export class CastController {
  sessions;
  emitter;
  status;

  constructor() {
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

  attachSession(session) {
    this.sessions.set(session.id, session);
    this.status.sessionId = session.id;
  }

  detachSession(sessionId) {
    this.sessions.delete(sessionId);
    if (this.status.sessionId === sessionId) this.status.sessionId = null;
  }

  onIntent(listener) {
    this.emitter.on('intent', listener);
    return this;
  }

  emitIntent(intent) {
    this.emitter.emit('intent', intent);
  }

  handleCommand(sessionId, action, rawBody) {
    const payload = safeJsonParse(rawBody);
    let intent = null;

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
      intent = {
        type: 'seek',
        positionSec: toNumber(
          payload.seekTs || payload.position || payload.positionSec,
        ),
      };
    } else if (action === 'SwitchDanmaku') {
      intent = { type: 'switchDanmaku', open: !!payload.open };
    }

    if (intent) this.emitIntent(intent);
    return intent;
  }

  reportState(payload) {
    payload = payload || {};
    this.status.playState = payload.playState || this.status.playState;
    this.status.lastError = payload.error || null;

    const numericState = PLAY_STATE_MAP[this.status.playState];
    if (typeof numericState === 'number') {
      this.sessions.forEach((session) => {
        session.sendCommand('OnPlayState', { playState: numericState });
      });
    }
  }

  reportProgress(payload) {
    payload = payload || {};
    this.status.duration = toNumber(payload.duration);
    this.status.progress = toNumber(payload.position);

    this.sessions.forEach((session) => {
      session.sendCommand('OnProgress', {
        duration: payload.duration || 0,
        position: payload.position || 0,
      });
    });
  }

  ack(payload) {
    payload = payload || {};
    this.status.lastAckAt = Date.now();
    this.status.lastAck = payload;
  }

  setNetworkInfo(ip, httpPort) {
    this.status.deviceIp = ip;
    this.status.httpPort = httpPort;
  }

  getStatus() {
    return JSON.parse(JSON.stringify(this.status));
  }
}
