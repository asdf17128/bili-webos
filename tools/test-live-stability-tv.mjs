// Real-TV native HLS endurance and repeated live relay cleanup. No account list writes.
// LIVE_MINUTES=15 LIVE_CYCLES=5 UX_OUTPUT=/tmp/bili-live-stability-tv node tools/test-live-stability-tv.mjs
// Only counts/codes/timings leave the TV: no stream URLs, tokens, chat or titles.
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectTv, sleep } from './_tv-stability.mjs';

if (process.argv.includes('--help')) {
  console.log('LIVE_MINUTES=15 LIVE_CYCLES=5 UX_OUTPUT=/tmp/bili-live-stability-tv node tools/test-live-stability-tv.mjs');
  console.log('Optional LIVE_ROOM=<numeric room ID>; still verifies that it is currently live. TV must be foreground and idle.');
  process.exit(0);
}
const minutes = Number(process.env.LIVE_MINUTES || 15);
const cycles = Number(process.env.LIVE_CYCLES || 5);
const requestedRoom = process.env.LIVE_ROOM ? Number(process.env.LIVE_ROOM) : null;
if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new Error('LIVE_MINUTES must be 1..120');
if (!Number.isInteger(cycles) || cycles < 1 || cycles > 30) throw new Error('LIVE_CYCLES must be 1..30');
if (requestedRoom !== null && (!Number.isSafeInteger(requestedRoom) || requestedRoom < 1)) throw new Error('LIVE_ROOM must be a positive integer');
const output = process.env.UX_OUTPUT || '/tmp/bili-live-stability-tv';
mkdirSync(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), minutes, cycles, checks: [], samples: [], sessions: [], metrics: [], needsReview: false, reviewReasons: [], limits: [
  'Native video time/dimensions/frame counters are not a photograph of the physical panel.',
  'A quiet room without received chat frames cannot validate real-time chat rendering.',
  'SDK cancellation, service acknowledgement and production diagnostic subscriber counts are measured separately.',
  'Media connect/retry/gave-up breadcrumbs are application attempts, not native HTTP socket counts.',
  'Relay connection state/counts are service diagnostics, not OS socket counts. Independent history timestamps can establish active-room delivery loss without exporting chat.',
  'Quiet rooms and failed history probes leave continuous-chat delivery unverified; they are not evidence of a broken relay.',
  'JS heap and DOM counters exclude GPU/process memory; one television and network do not establish fleet-wide stability.',
] };
let tv, originalSettings, installed = false;
const save = () => writeFileSync(`${output}/results.json`, JSON.stringify(report, null, 2) + '\n');
const check = (name, pass, detail = null) => {
  report.checks.push({ name, pass: !!pass, detail });
  console.log(pass ? 'PASS' : 'FAIL', name, detail == null ? '' : JSON.stringify(detail));
  save();
};

// Pure helpers are exercised by the offline monitor suite. Never return raw
// relay errors, chat text, account fields, or signed request addresses.
function safeRelayState(value) {
  if (!value || typeof value !== 'object') return null;
  const phases = ['connecting', 'authenticating', 'connected', 'backoff', 'stopped'];
  const result = { phase: phases.includes(value.phase) ? value.phase : 'unknown', connected: value.connected === true, hasError: !!value.lastError };
  for (const key of ['connections', 'consecutiveFailures', 'lastPacketAt', 'lastMessageAt', 'lastEventAt', 'lastHeartbeatAt', 'lastHeartbeatReplyAt', 'lastCloseCode', 'retryAt']) {
    result[key] = Number.isFinite(value[key]) ? value[key] : null;
  }
  return result;
}

function assessDelivery(media, history, previousHistory) {
  const session = media.session, now = media.observedAtMs;
  const lastFrameAt = session.lastFrameAt ?? session.openedAt;
  const frameGapMs = Math.max(0, now - lastFrameAt);
  const eventGapMs = Math.max(0, now - (session.lastEventAt ?? session.openedAt));
  if (frameGapMs < 120000) return { status: session.frames > 0 ? 'receiving' : 'warming', failed: false, verified: session.frames > 0, frameGapMs, eventGapMs };
  if (!history || history.code !== 0 || !Number.isFinite(history.latestAt)) return { status: 'unverified', failed: false, verified: false, frameGapMs, eventGapMs };
  const historyAgeMs = history.observedAtMs - history.latestAt;
  const freshSinceDelivery = history.latestAt > lastFrameAt + 5000 && historyAgeMs >= -30000 && historyAgeMs <= 90000;
  // A second independent history timestamp advancing during the same stalled
  // delivery interval also proves activity when TV/server clocks differ.
  const advancedDuringStall = previousHistory?.code === 0 && Number.isFinite(previousHistory.latestAt) &&
    previousHistory.observedAtMs - lastFrameAt >= 120000 && history.latestAt > previousHistory.latestAt;
  const failed = freshSinceDelivery || advancedDuringStall;
  return { status: failed ? 'active_room_relay_stale' : 'quiet_or_unverified', failed, verified: false,
    frameGapMs, eventGapMs, historyAgeMs, historyCount: history.count,
    evidence: freshSinceDelivery ? 'fresh_chat_after_last_delivery' : advancedDuringStall ? 'history_advanced_during_stall' : 'no_independent_new_chat' };
}

function classifyOutcome(checks, needsReview) {
  const gatesPassed = checks.length > 0 && checks.every(row => row.pass);
  return { gatesPassed, pass: gatesPassed && !needsReview, status: !gatesPassed ? 'failed' : needsReview ? 'needs_review' : 'passed' };
}

// Decode only inside the page. The returned body stays local; exported
// metadata contains status, length and a fixed format/category, never text.
function inspectServiceResponse(result) {
  const status = Number.isInteger(result?.status) ? result.status : null;
  let text;
  try {
    text = result?.body == null ? atob(result?.bodyBase64 || '') : result.body;
  } catch {
    return { meta: { failed: true, status, bodyLength: null, bodyFormat: 'invalid-base64', errorCategory: 'response_encoding' } };
  }
  if (typeof text !== 'string') return { meta: { failed: true, status, bodyLength: null, bodyFormat: 'non-text', errorCategory: 'response_type' } };
  // bodyLength counts decoded JavaScript string code units, not wire bytes.
  const meta = { status, bodyLength: text.length, bodyFormat: 'json' };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { meta: { ...meta, failed: true, errorCategory: 'json_shape' } };
    return { body, meta };
  } catch {
    return { meta: { ...meta, failed: true, bodyFormat: text.trim() ? 'non-json' : 'empty', errorCategory: 'json_parse' } };
  }
}

function safeServiceFailure(result) {
  const text = [result?.errorText, result?.error, result?.message].filter(value => typeof value === 'string').join(' ');
  const errorCategory = /EAI_AGAIN|ENOTFOUND/.test(text) ? 'dns'
    : /timeout|timed out/i.test(text) ? 'timeout'
    : /ECONNRESET|ECONNREFUSED|EPIPE|socket hang up/i.test(text) ? 'connection'
    : /certificate|CERT_|\bTLS\b|\bSSL\b/i.test(text) ? 'tls'
    : /abort|cancel/i.test(text) ? 'cancelled' : 'service_error';
  return { failed: true, status: Number.isInteger(result?.status) ? result.status : null,
    errorCode: Number.isFinite(result?.errorCode) ? result.errorCode : null, errorCategory };
}

async function sampleHistory(roomId) {
  return new Promise(resolve => {
    let handle, done = false;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); resolve({ observedAtMs: Date.now(), ...value }); };
    const timer = setTimeout(() => { try { handle?.cancel?.(); } catch {} finish({ timeout: true }); }, 12000);
    try { handle = window.webOS.service.request('luna://com.biliwebos.app.service/', {
      method: 'fetch', parameters: { url: 'https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=' + roomId },
      onFailure: () => finish({ failed: true }), onSuccess: result => {
        try {
          const body = JSON.parse(result.body == null ? atob(result.bodyBase64 || '') : result.body);
          const rows = Array.isArray(body.data?.room) ? body.data.room : [];
          // Bilibili timeline strings use Beijing time, not the TV timezone.
          const timestamps = rows.map(row => row.timeline).filter(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))
            .map(value => Date.parse(value.replace(' ', 'T') + '+08:00')).filter(Number.isFinite);
          finish({ code: Number.isFinite(body.code) ? body.code : null, count: rows.length, timestamps,
            latestAt: timestamps.length ? Math.max(...timestamps) : null });
        } catch { finish({ malformed: true }); }
      },
    }); } catch { finish({ failed: true }); }
  });
}

// Runs in the page, retaining only numeric/boolean observations. The original
// Luna callbacks are invoked unchanged and no fake chat or media events are sent.
function installMonitor() {
  if (window.__liveStability) throw new Error('Live stability monitor already present');
  const original = window.webOS.service.request;
  const state = { active: null, sessions: [], observer: null, timer: null };
  const handles = new Map();
  const diag = window.__liveDiag = window.__liveDiag || [];
  const pushDescriptor = Object.getOwnPropertyDescriptor(diag, 'push');
  const originalPush = diag.push;
  function diagPush(...rows) {
    const s = state.active;
    if (s) for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      // note('retry', { why, attempt, variant }) overwrites its why field.
      // Recognize that existing schema without exporting error text or URLs.
      const retry = Number.isInteger(row.attempt) && Number.isInteger(row.variant) && row.why !== 'connect';
      const type = retry ? 'retry' : ['connect', 'gave-up', 'playing'].includes(row.why) ? row.why : null;
      if (!type) continue;
      if (type === 'connect') {
        s.mediaConnects++; s.connectStreak++;
        s.maxConnectStreak = Math.max(s.maxConnectStreak, s.connectStreak);
      } else if (type === 'retry') {
        s.mediaRetries++;
        s.maxRetryAttempt = Math.max(s.maxRetryAttempt, row.attempt);
      } else if (type === 'gave-up') s.mediaGaveUps++;
      else s.connectStreak = 0;
      if (s.exitedAt) s.postExitMediaAttempts++;
      const record = { type, atMs: Date.now() - s.openedAt };
      if (Number.isInteger(row.attempt)) record.attempt = row.attempt;
      if (Number.isInteger(row.after)) record.after = row.after;
      s.mediaAttempts.push(record);
      if (s.mediaAttempts.length > 500) { s.mediaAttempts.shift(); s.omittedMediaAttempts++; }
    }
    return originalPush.apply(this, rows);
  }
  diag.push = diagPush;
  const read = () => {
    const s = state.active;
    if (!s) return;
    const video = document.querySelector('video');
    const count = document.querySelectorAll('.danmaku-item').length;
    s.peakDanmaku = Math.max(s.peakDanmaku, count);
    if (s.exitedAt) {
      if (video) s.postExitVideoSamples++;
      if (count || document.querySelector('.danmaku-container')) s.postExitDanmakuSamples++;
      return;
    }
    if (!video || !s.playingEvents) return;
    if (video.currentTime !== s.lastTime) {
      s.advancedSeconds += Math.max(0, video.currentTime - s.lastTime);
      s.maxGapMs = Math.max(s.maxGapMs, Date.now() - s.lastAdvance);
      s.lastTime = video.currentTime; s.lastAdvance = Date.now();
    }
  };
  const mediaEvent = event => {
    const s = state.active;
    if (!s || event.target?.tagName !== 'VIDEO' || s.exitedAt) return;
    if (event.type === 'playing') {
      s.playingEvents++;
      if (s.firstPlayingMs === null) { s.firstPlayingMs = Date.now() - s.openedAt; s.lastAdvance = Date.now(); s.lastTime = event.target.currentTime; }
    } else if (event.type === 'error') {
      s.mediaErrors.push({ atMs: Date.now() - s.openedAt, code: event.target.error?.code || 0 });
      if (s.mediaErrors.length > 50) s.mediaErrors.shift();
    } else if (event.type === 'waiting') s.waitingEvents++;
    else if (event.type === 'ended') s.endedEvents++;
  };
  for (const type of ['playing', 'waiting', 'error', 'ended']) document.addEventListener(type, mediaEvent, true);
  function wrapped(uri, options) {
    const s = state.active;
    const token = options?.method === 'fetch' && /\/getDanmuInfo(?:\?|$)/.test(options?.parameters?.url || '');
    const subscription = options?.method === 'danmakuSubscribe';
    const stop = options?.method === 'danmakuStop';
    if (!s || !(token || subscription || stop)) return original.call(this, uri, options);
    if (subscription) { s.subscribes++; if (s.exitedAt) s.postExitSubscribes++; }
    if (stop) s.stopCalls++;
    let acknowledged = false;
    const success = options.onSuccess, failure = options.onFailure;
    const next = { ...options, onSuccess(result) {
      if (token) {
        try { s.tokenCode = JSON.parse(result.body == null ? atob(result.bodyBase64 || '') : result.body).code; }
        catch { s.tokenMalformed++; }
      }
      if (subscription) {
        if (!acknowledged && result?.subscribed) { s.subscriptionAcks++; acknowledged = true; }
        if (result?.danmaku) {
          s.frames++; s.lastFrameAt = Date.now();
          if (s.exitedAt) s.lateFrames++;
          if (s.stopSuccess) s.framesAfterStop++;
        }
        if (result?.event) { s.events++; s.lastEventAt = Date.now(); }
      }
      if (stop && result?.returnValue === true) s.stopSuccess++;
      return success?.(result);
    }, onFailure(result) {
      if (subscription) s.subscriptionFailures++;
      if (stop) s.stopFailures++;
      return failure?.(result);
    } };
    const handle = original.call(this, uri, next);
    if (subscription && typeof handle?.cancel === 'function') {
      const cancel = handle.cancel;
      const wrappedCancel = function (...args) {
        s.handleCancelCalls++;
        try { const result = cancel.apply(this, args); s.handleCancelSuccess++; return result; }
        catch (error) { s.handleCancelFailures++; throw error; }
        finally { if (handle.cancel === wrappedCancel) handle.cancel = cancel; handles.delete(handle); }
      };
      handle.cancel = wrappedCancel;
      handles.set(handle, { cancel, wrappedCancel });
    }
    return handle;
  }
  window.webOS.service.request = wrapped;
  state.timer = setInterval(read, 1000);
  try {
    state.observer = new MutationObserver(read);
    state.observer.observe(document.body, { childList: true, subtree: true });
  } catch { /* the periodic check remains available */ }
  state.begin = index => {
    const s = { index, openedAt: Date.now(), exitedAt: null, tokenCode: null, tokenMalformed: 0, subscribes: 0,
      subscriptionAcks: 0, subscriptionFailures: 0, frames: 0, events: 0, lastFrameAt: null, lastEventAt: null, lateFrames: 0, framesAfterStop: 0,
      handleCancelCalls: 0, handleCancelSuccess: 0, handleCancelFailures: 0,
      stopCalls: 0, stopSuccess: 0, stopFailures: 0, postExitSubscribes: 0, postExitVideoSamples: 0,
      postExitDanmakuSamples: 0, peakDanmaku: 0, mediaErrors: [], firstPlayingMs: null, playingEvents: 0,
      mediaConnects: 0, mediaRetries: 0, mediaGaveUps: 0, maxRetryAttempt: 0, connectStreak: 0, maxConnectStreak: 0,
      postExitMediaAttempts: 0, mediaAttempts: [], omittedMediaAttempts: 0,
      waitingEvents: 0, endedEvents: 0, lastTime: 0, lastAdvance: Date.now(), maxGapMs: 0, advancedSeconds: 0 };
    state.active = s; state.sessions.push(s); return true;
  };
  state.snapshot = () => {
    read();
    const s = state.active, v = document.querySelector('video');
    const quality = v?.getVideoPlaybackQuality?.();
    let buffer = 0;
    for (let i = 0; v && i < v.buffered.length; i++) if (v.currentTime >= v.buffered.start(i) && v.currentTime <= v.buffered.end(i)) buffer = v.buffered.end(i) - v.currentTime;
    return { observedAtMs: Date.now(), session: s ? { ...s } : null, video: v ? { time: v.currentTime, ready: v.readyState, paused: v.paused,
      width: v.videoWidth, height: v.videoHeight, error: v.error?.code || null, bufferSec: buffer,
      totalFrames: quality?.totalVideoFrames ?? null, decodedFrames: v.webkitDecodedFrameCount ?? null,
      droppedFrames: quality?.droppedVideoFrames ?? v.webkitDroppedFrameCount ?? null } : null,
      danmakuItems: document.querySelectorAll('.danmaku-item').length,
      currentGapMs: s?.playingEvents && !s.exitedAt ? Date.now() - s.lastAdvance : 0 };
  };
  state.exit = () => { if (state.active) state.active.exitedAt = Date.now(); };
  state.clean = () => {
    clearInterval(state.timer); state.observer?.disconnect();
    for (const type of ['playing', 'waiting', 'error', 'ended']) document.removeEventListener(type, mediaEvent, true);
    const diagUnchanged = diag.push === diagPush;
    if (diagUnchanged) {
      if (pushDescriptor) Object.defineProperty(diag, 'push', pushDescriptor);
      else delete diag.push;
    }
    const unchanged = window.webOS.service.request === wrapped;
    if (unchanged) window.webOS.service.request = original;
    let forcedCancels = 0, cancelFailures = 0;
    for (const [handle, entry] of handles) {
      if (handle.cancel === entry.wrappedCancel) handle.cancel = entry.cancel;
      try { entry.cancel.call(handle); forcedCancels++; } catch { cancelFailures++; }
    }
    handles.clear();
    delete window.__liveStability;
    return { requestRestored: unchanged, diagPushRestored: diagUnchanged, forcedCancels, cancelFailures, injectionsRemoved: !window.__liveStability };
  };
  window.__liveStability = state;
  return true;
}

// All response bodies and URLs remain inside this invocation on the television.
async function selectRoom(requested) {
  const fetchBody = url => new Promise(resolve => {
    let handle, done = false;
    const finish = body => { if (done) return; done = true; clearTimeout(timer); resolve(body); };
    const timer = setTimeout(() => { handle?.cancel?.(); finish({ code: null, probe: { timeout: true } }); }, 12000);
    handle = window.webOS.service.request('luna://com.biliwebos.app.service/', { method: 'fetch', parameters: { url },
      onFailure: r => finish({ code: null, probe: { failed: true, errorCode: r?.errorCode, errorText: String(r?.errorText||r?.error||r?.message||'').replace(/https?:[^ ]+/g,'[URL]').slice(0,160) } }), onSuccess: r => {
        try { finish(JSON.parse(r.body == null ? atob(r.bodyBase64 || '') : r.body)); } catch { finish({ code: null, probe: { malformed: true, status: r.status, bodyType: typeof r.body } }); }
      } });
  });
  const rec = requested ? null : await fetchBody('https://api.live.bilibili.com/xlive/web-interface/v1/webMain/getMoreRecList?platform=web&page=1&page_size=12');
  // One bounded retry for an explicitly chosen fixture; keep both probe outcomes.
  const rooms = requested ? [requested, requested] : (rec?.data?.recommend_room_list || rec?.data?.list || [])
    .slice().sort((a, b) => (b.online || 0) - (a.online || 0)).map(room => Number(room.roomid || room.room_id)).filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 6);
  const candidates = [];
  for (const id of rooms) {
    // Validate through the same play-info endpoint the app uses. room_init is
    // a separate room-ID metadata endpoint and can time out while playback works.
    const init = await fetchBody('https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=' + id + '&protocol=0,1&format=0,1,2&codec=0,1,2&platform=web&ptype=8&qn=10000');
    const streams=init.data?.playurl_info?.playurl?.stream;
    candidates.push({ roomId: id, endpoint:'getRoomPlayInfo', code: init.code ?? null, liveStatus: init.data?.live_status ?? null, streams:streams?.length||0, probe: init.probe });
    if (init.code === 0 && init.data?.live_status === 1 && streams?.length) return { roomId: id, recommendationCode: rec?.code ?? null, candidates };
  }
  return { roomId: null, recommendationCode: rec?.code ?? null, candidates };
}

async function sampleServices(sanitizeRelay, inspectResponse, sanitizeFailure) {
  const request = (method, parameters) => new Promise(resolve => {
    const started = Date.now(); let handle, done = false;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); resolve({ ...value, ms: Date.now() - started }); };
    const timer = setTimeout(() => { let cancelFailed = false; try { handle?.cancel?.(); } catch { cancelFailed = true; } finish({ timeout: true, errorCategory: 'probe_timeout', cancelFailed }); }, 15000);
    try { handle = window.webOS.service.request('luna://com.biliwebos.app.service/', { method, parameters,
      onFailure: r => finish(sanitizeFailure(r)), onSuccess: r => {
        if (method === 'getDiagnostics') return finish({ uptime: r.uptimeSec, node: r.nodeVersion,
          relayAvailable: !!r.danmakuModule, requestErrors: (r.recentErrors || []).filter(e => /^req:/.test(e.tag || '')).length,
          danmakuSubscribers: r.danmakuSubscribers, danmakuActive: r.danmakuActive, castSubscribers: r.castSubscribers, danmakuState: sanitizeRelay(r.danmakuState) });
        const { body, meta } = inspectResponse(r);
        if (!body) return finish(meta);
        finish({ ...meta, code: body.code ?? null, version: body.version || null });
      } }); } catch (error) { finish(sanitizeFailure(error)); }
  });
  const [main, live, update, service] = await Promise.all([
    request('fetch', { url: 'https://api.bilibili.com/x/web-interface/nav' }),
    request('fetch', { url: 'https://api.live.bilibili.com/room/v1/Area/getList' }),
    request('fetch', { url: 'https://github.com/asdf17128/bili-webos/releases/latest/download/version.json' }),
    request('getDiagnostics', {}),
  ]);
  return { main, live, update, service };
}

async function relayState(sanitizeRelay) {
  return new Promise(resolve => {
    let handle, done = false;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { handle?.cancel?.(); finish({ timeout: true }); }, 15000);
    handle = window.webOS.service.request('luna://com.biliwebos.app.service/', { method: 'getDiagnostics', parameters: {},
      onFailure: () => finish({ failed: true }), onSuccess: result => finish({
        danmakuSubscribers: result.danmakuSubscribers, danmakuActive: result.danmakuActive, castSubscribers: result.castSubscribers, danmakuState: sanitizeRelay(result.danmakuState),
      }) });
  });
}

async function exitAndCheck(label) {
  // Mark after Back has actually unmounted the video. Its deliberate teardown
  // mutations are not counted as late UI activity.
  await tv.back();
  await tv.evaluate('window.__liveStability.exit()');
  await sleep(3500);
  const state = await tv.evaluate('window.__liveStability.snapshot()');
  const service = await tv.evaluate(`(${relayState.toString()})(${safeRelayState.toString()})`);
  const s = state.session;
  check(`${label}: SDK subscription cancelled, relay stopped, no late live DOM`, !state.video && s.stopCalls > 0 && s.stopSuccess > 0 &&
    s.handleCancelSuccess === s.subscribes && !s.handleCancelFailures &&
    !s.stopFailures && !s.postExitSubscribes && !s.postExitVideoSamples && !s.postExitDanmakuSamples && !s.postExitMediaAttempts, {
    stopCalls: s.stopCalls, stopSuccess: s.stopSuccess, stopFailures: s.stopFailures, postExitSubscribes: s.postExitSubscribes,
    subscribes: s.subscribes, handleCancelCalls: s.handleCancelCalls, handleCancelSuccess: s.handleCancelSuccess, handleCancelFailures: s.handleCancelFailures,
    postExitVideoSamples: s.postExitVideoSamples, postExitDanmakuSamples: s.postExitDanmakuSamples,
    lateFrames: s.lateFrames, framesAfterStop: s.framesAfterStop, postExitMediaAttempts: s.postExitMediaAttempts,
  });
  check(`${label}: service relay and subscription counts return to baseline`, service.danmakuSubscribers === 0 &&
    service.danmakuActive === false && service.castSubscribers === report.baseline?.castSubscribers, service);
  check(`${label}: media reconnect attempts stay bounded without giving up`, s.mediaConnects > 0 &&
    s.maxRetryAttempt <= 12 && s.maxConnectStreak <= 13 && s.mediaGaveUps === 0, {
    connects: s.mediaConnects, retries: s.mediaRetries, gaveUps: s.mediaGaveUps,
    maxRetryAttempt: s.maxRetryAttempt, maxConnectStreak: s.maxConnectStreak,
  });
  report.sessions = await tv.evaluate('window.__liveStability.sessions');
  report.metrics.push({ phase: label, ...await tv.metrics({ collect: true }) });
  save();
}

try {
  tv = await connectTv();
  await tv.back();
  originalSettings = await tv.evaluate('localStorage.getItem("bili_settings")');
  await tv.evaluate(`localStorage.setItem('bili_settings',JSON.stringify({...JSON.parse(localStorage.getItem('bili_settings')||'{}'),danmaku:true,liveInteract:true}))`);
  await tv.evaluate(`(${installMonitor.toString()})()`); installed = true;
  // A prior Page.reload can still be retiring its platform subscription.
  // Require the one active app subscription before freezing an idle baseline.
  report.baselineSamples=[];
  const baselineDeadline=Date.now()+10000;let stableBaseline=0;
  while(Date.now()<baselineDeadline&&stableBaseline<3){
    report.baseline=await tv.evaluate(`(${relayState.toString()})(${safeRelayState.toString()})`);
    report.baselineSamples.push({at:new Date().toISOString(),...report.baseline});
    const idle=report.baseline.castSubscribers===1&&report.baseline.danmakuSubscribers===0&&report.baseline.danmakuActive===false;
    stableBaseline=idle?stableBaseline+1:0;
    if(stableBaseline<3)await sleep(500);
  }
  check('service subscriber diagnostics settled at idle',stableBaseline===3,report.baselineSamples);
  if(stableBaseline!==3)throw new Error('Idle subscription baseline did not settle; endurance not started');
  report.metrics.push({ phase: 'before', ...await tv.metrics({ collect: true }) });
  // A bounded 6-room selection can take >30s on a broken network.
  const selection = await tv.call('Runtime.evaluate', { expression: `(${selectRoom.toString()})(${JSON.stringify(requestedRoom)})`, awaitPromise: true, returnByValue: true }, 100000);
  if (selection.exceptionDetails) throw new Error('Live-room selection failed');
  report.fixture = selection.result?.value;
  check('currently active production live room found', !!report.fixture?.roomId, report.fixture);
  if (!report.fixture?.roomId) throw new Error('No current live room available');
  const roomId = report.fixture.roomId;
  for (let i = 0; i < cycles; i++) {
    await tv.evaluate(`window.__liveStability.begin(${i});window.__openLive({roomid:${roomId},title:'稳定性测试'});void 0`);
    let started = false;
    try {
      await tv.wait("window.__liveStability.active.advancedSeconds>0.5 && document.querySelector('video')?.readyState>=2 && document.querySelector('video').videoWidth>0", 45000);
      started = true;
      await tv.wait('window.__liveStability.active.subscriptionAcks>0 || (window.__liveStability.active.tokenCode!==null && window.__liveStability.active.tokenCode!==0) || window.__liveStability.active.subscriptionFailures>0', 15000);
    } catch { /* keep the failed cycle and still exercise Back + cleanup */ }
    const s = await tv.evaluate('window.__liveStability.snapshot()');
    check(`live open/exit cycle ${i + 1}: native playback and subscription`, started && s.session.subscriptionAcks > 0 && s.session.tokenCode === 0 && !s.session.mediaErrors.length, {
      firstPlayingMs: s.session.firstPlayingMs, tokenCode: s.session.tokenCode, subscriptionAcks: s.session.subscriptionAcks,
      mediaErrors: s.session.mediaErrors, video: s.video,
    });
    await exitAndCheck(`cycle ${i + 1}`);
  }
  await tv.evaluate(`window.__liveStability.begin(${cycles});window.__openLive({roomid:${roomId},title:'稳定性测试'});void 0`);
  await tv.wait("window.__liveStability.active.advancedSeconds>0.5 && document.querySelector('video')?.readyState>=2 && document.querySelector('video').videoWidth>0", 45000);
  const startedAt = Date.now(); let previousUptime = null, firstNavCode = null, previousHistory = null;
  for (let minute = 0; minute <= minutes; minute++) {
    if (minute) await sleep(Math.max(0, startedAt + minute * 60000 - Date.now()));
    const services = await tv.evaluate(`(${sampleServices.toString()})(${safeRelayState.toString()}, ${inspectServiceResponse.toString()}, ${safeServiceFailure.toString()})`);
    let media = await tv.evaluate('window.__liveStability.snapshot()');
    let history = null;
    if (media.observedAtMs - (media.session.lastFrameAt ?? media.session.openedAt) >= 120000) {
      history = await tv.evaluate(`(${sampleHistory.toString()})(${roomId})`, 15000);
      // Delivery can recover while the history request is pending.
      media = await tv.evaluate('window.__liveStability.snapshot()');
    }
    const delivery = assessDelivery(media, history, previousHistory);
    if (history?.code === 0 && Number.isFinite(history.latestAt)) previousHistory = history;
    const metrics = await tv.metrics();
    const sample = { minute, elapsedMs: Date.now() - startedAt, ...media, services, metrics, history, delivery };
    if (minute === 0) firstNavCode = services.main.code;
    sample.mediaRetryHealthy = media.session.mediaGaveUps === 0 && media.session.maxRetryAttempt <= 12 && media.session.maxConnectStreak <= 13;
    sample.playbackHealthy = sample.mediaRetryHealthy && !!media.video && media.video.ready >= 2 && !media.video.paused && media.video.width > 0 && media.video.height > 0 &&
      !media.video.error && !media.session.mediaErrors.length && Math.max(media.currentGapMs, media.session.maxGapMs) < 15000;
    sample.biliHealthy = services.main.status === 200 && [0, -101].includes(services.main.code) && services.main.code === firstNavCode && services.live.status === 200 && services.live.code === 0;
    sample.updateHealthy = services.update.status === 200 && !!services.update.version;
    sample.serviceHealthy = Number.isFinite(services.service.uptime) && services.service.relayAvailable && (previousUptime === null || services.service.uptime > previousUptime);
    const relay = services.service.danmakuState;
    const connected = relay ? relay.connected && relay.phase === 'connected' : services.service.danmakuActive === true;
    const recovering = relay && !relay.connected && ['connecting', 'authenticating', 'backoff'].includes(relay.phase);
    sample.relayConnection = { status: connected ? 'connected' : recovering ? 'recovering' : 'unknown',
      lastPacketGapMs: relay?.lastPacketAt == null ? null : Math.max(0, media.observedAtMs - relay.lastPacketAt),
      lastHeartbeatReplyGapMs: relay?.lastHeartbeatReplyAt == null ? null : Math.max(0, media.observedAtMs - relay.lastHeartbeatReplyAt) };
    sample.relayHealthy = !delivery.failed && media.session.tokenCode === 0 && media.session.subscriptionAcks > 0 && !media.session.subscriptionFailures && !media.session.stopCalls &&
      services.service.danmakuSubscribers === 1 && (connected || recovering) && services.service.castSubscribers === report.baseline.castSubscribers;
    const unverifiedDelivery = !delivery.verified && delivery.status !== 'warming';
    const relayNeedsReview = !relay || !connected || relay.connections > 1 || sample.relayConnection.lastHeartbeatReplyGapMs >= 90000;
    sample.needsReview = media.session.mediaRetries > 0 || Math.max(media.currentGapMs, media.session.maxGapMs) >= 3000 || unverifiedDelivery || relayNeedsReview;
    if (sample.needsReview) {
      report.needsReview = true;
      for (const reason of [media.session.mediaRetries > 0 ? 'media_recovered_after_retry' : null,
        Math.max(media.currentGapMs, media.session.maxGapMs) >= 3000 ? 'playback_gap_at_least_3s' : null,
        unverifiedDelivery && !delivery.failed ? 'continuous_chat_delivery_unverified' : null,
        !relay ? 'relay_connection_diagnostics_unavailable' : !connected ? 'relay_temporarily_not_connected' : null,
        relay?.connections > 1 ? 'relay_reconnected' : null,
        sample.relayConnection.lastHeartbeatReplyGapMs >= 90000 ? 'relay_heartbeat_reply_stale' : null]) {
        if (reason && !report.reviewReasons.includes(reason)) report.reviewReasons.push(reason);
      }
    }
    report.samples.push(sample);
    check(`live endurance minute ${minute}`, sample.playbackHealthy && sample.biliHealthy && sample.updateHealthy && sample.serviceHealthy && sample.relayHealthy, {
      playback: sample.playbackHealthy, bili: sample.biliHealthy, update: sample.updateHealthy, service: sample.serviceHealthy,
      relay: sample.relayHealthy, relayConnection: sample.relayConnection.status, delivery: delivery.status, frameGapMs: delivery.frameGapMs, needsReview: sample.needsReview, mediaRetry: sample.mediaRetryHealthy, connects: media.session.mediaConnects, retries: media.session.mediaRetries, gaveUps: media.session.mediaGaveUps, time: media.video?.time, width: media.video?.width, height: media.video?.height,
      maxGapMs: Math.max(media.currentGapMs, media.session.maxGapMs), frames: media.session.frames, heapBytes: metrics.heapBytes,
    });
    if (Number.isFinite(services.service.uptime)) previousUptime = services.service.uptime;
  }
  const finalMedia = await tv.evaluate('window.__liveStability.snapshot()');
  if (finalMedia.session.frames > 0) {
    check('real-time relay frames reached visible bounded overlay', finalMedia.session.peakDanmaku > 0 && finalMedia.session.peakDanmaku <= 20,
      { frames: finalMedia.session.frames, events: finalMedia.session.events, peakDanmaku: finalMedia.session.peakDanmaku });
    report.chatRendering = { status: 'observed', frames: finalMedia.session.frames };
  } else {
    report.chatRendering = { status: 'unverified', frames: 0 };
    report.needsReview = true;
    if (!report.reviewReasons.includes('continuous_chat_delivery_unverified')) report.reviewReasons.push('continuous_chat_delivery_unverified');
  }
  await exitAndCheck('endurance exit');
  check('no uncaught page exceptions', tv.errors.length === 0, { count: tv.errors.length });
} catch (error) {
  check('test completed', false, error.message);
} finally {
  if (tv) {
    try {
      await tv.back();
      if (installed) report.sessions = await tv.evaluate('window.__liveStability.sessions');
    } catch { check('final player cleanup', false); }
    if (originalSettings !== undefined) {
      try {
        await tv.evaluate(originalSettings === null ? 'localStorage.removeItem("bili_settings")' : `localStorage.setItem('bili_settings',${JSON.stringify(originalSettings)})`);
        check('original settings restored', await tv.evaluate('localStorage.getItem("bili_settings")') === originalSettings);
      } catch { check('original settings restored', false); }
    }
    if (installed) {
      try {
        const cleaned = await tv.evaluate('window.__liveStability.clean()');
        check('all live monitor injection removed', cleaned.requestRestored && cleaned.diagPushRestored && cleaned.injectionsRemoved && !cleaned.cancelFailures, cleaned);
      }
      catch { check('all live monitor injection removed', false); }
    }
    tv.close();
  }
  report.completedAt = new Date().toISOString();
  Object.assign(report, classifyOutcome(report.checks, report.needsReview));
  if (report.needsReview) console.log('NEEDS_REVIEW', JSON.stringify(report.reviewReasons));
  save();
  if (!report.pass) process.exitCode = 1;
}
