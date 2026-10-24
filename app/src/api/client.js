// Bilibili API client
// On webOS TV: uses Luna JS Service (no external proxy needed)
// Fallback: uses HTTP proxy on Mac
import { storage } from '../utils/storage';
import { getWbiKeys, signWbi } from './wbi';
import { logErr } from '../utils/errlog';
import { mapLibraryPage } from '../utils/library';
import { selectLivePlayback } from '../player/liveStream';
import { isRecommendationFeedbackReason, recommendationFeedbackContext } from '../utils/recommendationFeedback';
import { createAccountRepair } from './accountRepair';

const API_HOST = 'api.bilibili.com';
const PASSPORT_HOST = 'passport.bilibili.com';
const SERVICE_URI = 'luna://com.biliwebos.app.service/';
let serviceProxyPort = 7654;
let logoutPending = null;
let loggingOut = false;

function checkSession(generation) {
  if (loggingOut || generation !== storage.getAuthGeneration()) throw new Error('Account session changed');
}

// Also bounds development bridge/proxy discovery on older browsers without
// AbortController. A late response cannot settle the operation twice.
function withDeadline(promise, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timeout')), timeout);
    promise.then(r => { clearTimeout(timer); resolve(r); }, e => { clearTimeout(timer); reject(e); });
  });
}
function fetchWithDeadline(url, options) { return withDeadline(fetch(url, options)); }
function fetchJsonWithDeadline(url, options, timeout = 10000) {
  return withDeadline(fetch(url, options).then(response => {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }), timeout);
}

export async function initializeMediaProxy() {
  if (!hasLunaService() && !await devLunaAvailable()) return;
  const status = await lunaRequest('ping', {}, false, {});
  const port = status && status.localProxyPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local proxy port');
  serviceProxyPort = port;
}

export function logout() {
  if (logoutPending) return logoutPending;
  loggingOut = true;
  storage.invalidateAuthRequests();
  logoutPending = (async () => {
    try {
      if (hasLunaService() || await devLunaAvailable()) {
        await lunaRequest('clearCookies', {}, false, {});
      } else {
        const response = await fetchJsonWithDeadline(storage.getProxyUrl() + '/cookies/clear', { method: 'POST' });
        if (!response.ok) throw new Error('Could not clear proxy cookies');
      }
      storage.clearAuth();
      buvidEnsured = false; _buvid3 = '';
    } finally {
      storage.invalidateAuthRequests();
      loggingOut = false; logoutPending = null;
    }
  })();
  return logoutPending;
}

// Detect if running on webOS with Luna service available. webOSTV.js defines
// window.webOS.service in ANY browser — only the real TV has the underlying
// PalmServiceBridge, so check that too or dev-mode calls die on the Luna path
// instead of falling back to the Mac proxy.
function hasLunaService() {
  return typeof window !== 'undefined' && typeof window.webOS !== 'undefined' && window.webOS.service &&
    typeof window.PalmServiceBridge !== 'undefined';
}

// ── DEV: the same service the TV runs, bridged from the Mac ──────────────
// tools/dev-service.mjs loads service/com.biliwebos.app.service/service.js with
// the Node-8 test stub and exposes its Luna methods over HTTP/WS. Routing dev
// through it means the simulator exercises the TV's *actual* fetch, cookie,
// WBI, risk-control, danmaku and cast code instead of proxy/server.js's
// parallel implementation (owner 2026-08-02: 模拟器和真机一个效果).
// Falls back to the plain proxy when the bridge isn't running.
const DEV_LUNA = 'http://127.0.0.1:9528';
let devLunaUp = null;                       // null = unknown, then true/false
export function devBridgeState() { return devLunaUp; }

async function devLunaAvailable() {
  if (!import.meta.env.DEV) return false;
  if (devLunaUp !== null) return devLunaUp;
  try {
    const r = await fetchWithDeadline(DEV_LUNA + '/ping', { cache: 'no-store' });
    devLunaUp = r.ok;
  } catch (e) { devLunaUp = false; }
  if (devLunaUp) console.info('[dev] using the real TV service via bridge :9528');
  return devLunaUp;
}

async function devLunaCall(method, params, deadlineMs) {
  return fetchJsonWithDeadline(DEV_LUNA + '/luna/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  }, deadlineMs || 20000);
}

function devLunaSubscribe(method, params, onFrame) {
  const qs = new URLSearchParams(params || {}).toString();
  const ws = new WebSocket(DEV_LUNA.replace(/^http/, 'ws') + '/luna-sub/' + method + (qs ? '?' + qs : ''));
  ws.onmessage = (m) => { try { onFrame(JSON.parse(m.data)); } catch (e) { /* ignore */ } };
  return function () { try { ws.close(); } catch (e) { /* ignore */ } };
}

// Media (images / video / sprites) always go through the SERVICE's local proxy
// on the TV — it adds the Referer B站's CDN requires. In dev the bridge runs
// that same proxy on the Mac, so point there too and the media path matches
// the TV byte for byte; without the bridge fall back to the standalone proxy.
export function mediaProxyBase() {
  if (typeof window !== 'undefined' && window.PalmServiceBridge) return 'http://127.0.0.1:' + serviceProxyPort;
  if (import.meta.env.DEV && devLunaUp === true) return 'http://127.0.0.1:' + serviceProxyPort;
  return storage.getProxyUrl();
}

// Luna service fetch (on TV)
function lunaFetch(url, options) {
  const generation = storage.getAuthGeneration();
  return new Promise(function(resolve, reject) {
    if (!hasLunaService()) {
      reject(new Error('Luna not available'));
      return;
    }

    try {
      checkSession(generation);
      if (options.sessionGuard) options.sessionGuard();
    } catch (e) { reject(e); return; }
    var params = { url: url, method: options.method || 'GET', diagnostic: options.diagnostic === true };
    if (options.body) params.body = options.body;
    if (options.contentType) params.contentType = options.contentType;
    if (options.range) params.range = options.range;

    var settled = false, request;
    const deadlineMs = options.deadlineMs || 20000;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      try { if (request && request.cancel) request.cancel(); } catch (e) { /* already closed */ }
      logErr('luna-timeout', url.split('?')[0]);
      reject(new Error('Request timeout (' + (deadlineMs / 1000) + 's)'));
    }, deadlineMs);
    function fail(err) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      var message = String(err.errorText || err.error || err.message || 'Luna fetch failed');
      logErr('luna', message.slice(0, 120));
      reject(new Error(message));
    }
    try {
      if (options.sessionGuard) options.sessionGuard('dispatch');
      request = window.webOS.service.request(SERVICE_URI, {
        method: 'fetch',
        parameters: params,
        onSuccess: function(res) {
          if (settled) return;
          try {
            checkSession(generation);
            if (options.sessionGuard) options.sessionGuard();
          } catch (e) { fail(e); return; }
          settled = true; clearTimeout(timer);
          if (res.newCookies) {
            var auth = storage.getAuth() || {};
            storage.setAuth(Object.assign({}, auth, res.newCookies));
          }
          resolve(res);
        },
        onFailure: fail
      });
    } catch (err) { fail(err); }
  });
}

// Proxy fetch (fallback for browser dev)
function proxyFetchRaw(url, options) {
  const generation = storage.getAuthGeneration();
  checkSession(generation);
  if (options.sessionGuard) options.sessionGuard();
  var base = storage.getProxyUrl();
  var parsed = new URL(url);
  var proxyUrl = base + '/proxy/' + parsed.host + parsed.pathname + parsed.search;

  if (options.sessionGuard) options.sessionGuard('dispatch');
  return fetch(proxyUrl, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': options.contentType || 'application/json',
    },
    body: options.body,
  }).then(function(res) {
    checkSession(generation);
    if (options.sessionGuard) options.sessionGuard();
    var setCookie = res.headers.get('X-Set-Cookie');
    if (setCookie) {
      try {
        var newCookies = JSON.parse(setCookie);
        var auth = storage.getAuth() || {};
        storage.setAuth(Object.assign({}, auth, newCookies));
      } catch(e) {}
    }
    return res;
  });
}

// Smart fetch: try Luna first, fallback to proxy
async function smartFetch(host, path, options) {
  const generation = storage.getAuthGeneration();
  checkSession(generation);
  var url = 'https://' + host + path;
  var opts = options || {};
  if (/^\/(x\/player\/(wbi\/)?playurl|pgc\/player\/web\/playurl)\?/.test(path)) opts = { ...opts, deadlineMs: opts.deadlineMs || 35000 };
  if (opts.sessionGuard) opts.sessionGuard();

  if (hasLunaService()) {
    var res = await lunaFetch(url, opts);
    checkSession(generation);
    if (!res.returnValue) {
      logErr('svc', host + path.split('?')[0] + ' :: ' + res.error);
      throw new Error(res.error);
    }
    // Parse JSON body if applicable
    if (res.body) {
      try { return JSON.parse(res.body); } catch(e) { return res; }
    }
    return res;
  }

  // DEV with the bridge up: same path the TV takes (service.fetch)
  const bridge = await devLunaAvailable();
  checkSession(generation);
  if (opts.sessionGuard) opts.sessionGuard();
  if (bridge) {
    if (opts.sessionGuard) opts.sessionGuard('dispatch');
    var br = await devLunaCall('fetch', {
      url: url, method: opts.method || 'GET', body: opts.body,
      contentType: opts.contentType, range: opts.range, diagnostic: opts.diagnostic === true,
    }, opts.deadlineMs);
    checkSession(generation);
    if (opts.sessionGuard) opts.sessionGuard();
    if (br && br.newCookies) {
      var a2 = storage.getAuth() || {};
      storage.setAuth(Object.assign({}, a2, br.newCookies));
    }
    if (!br || !br.returnValue) throw new Error((br && br.error) || 'bridge fetch failed');
    if (br.body) { try { return JSON.parse(br.body); } catch (e) { return br; } }
    return br;
  }

  // Fallback to proxy
  var proxyRes = await proxyFetchRaw(url, opts);
  var ct = proxyRes.headers.get('content-type') || '';
  if (ct.indexOf('json') >= 0 || ct.indexOf('text/plain') >= 0) {
    const data = await proxyRes.json();
    checkSession(generation);
    return data;
  }
  return proxyRes;
}

// API fetch
export async function apiFetch(path, params, options) {
  params = params || {};
  options = options || {};
  var host = options.host || API_HOST;
  var query = new URLSearchParams(params).toString();
  var fullPath = query ? path + '?' + query : path;
  return smartFetch(host, fullPath, options);
}

// API fetch with WBI signature. options.host targets a non-default host (the
// WBI signature is host-agnostic, so it works for api.live.bilibili.com too).
export async function wbiFetch(path, params, options) {
  const generation = storage.getAuthGeneration();
  var keys = await getWbiKeys(apiFetch);
  checkSession(generation);
  var signedQuery = signWbi(params || {}, keys.imgKey, keys.subKey);
  return smartFetch((options && options.host) || API_HOST, path + '?' + signedQuery, options);
}

// Raw fetch for special cases (returns Response or Luna result)
export async function rawFetch(url, options) {
  options = options || {};
  if (hasLunaService()) {
    return lunaFetch(url, options);
  }
  return proxyFetchRaw(url, options);
}

function lunaRequest(method, parameters, subscribe, handlers) {
  handlers = handlers || {};
  return new Promise(function(resolve, reject) {
    var settled = false, request;
    var timer = setTimeout(function () {
      fail(new Error(method + ' timeout'));
      try { if (request && request.cancel) request.cancel(); } catch (e) { /* closed */ }
    }, 10000);
    function fail(err) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (handlers.onFailure) handlers.onFailure(err);
      const failure = new Error(err.errorText || err.error || err.message || (method + ' failed'));
      if (handlers.acceptFailureResponse && err.code === 'UNSUPPORTED') failure.code = 'UNSUPPORTED';
      reject(failure);
    }
    function success(res) {
      if (settled) return;
      try { if (handlers.sessionGuard) handlers.sessionGuard(); }
      catch (error) { fail(error); return; }
      if (res && res.returnValue === false && !handlers.acceptFailureResponse) { fail(res); return; }
      settled = true; clearTimeout(timer);
      if (handlers.onSuccess) handlers.onSuccess(res);
      resolve(res);
    }
    function failureResponse(error) {
      // webOSTV.js routes a structured returnValue:false service response to
      // onFailure. Preserve its fixed business code for the repair controller;
      // transport failures still reject and retain an unknown write outcome.
      if (handlers.acceptFailureResponse && error?.returnValue === false && typeof error.errorCode === 'string') {
        success(error); return;
      }
      fail(error);
    }
    if (!hasLunaService()) {
      devLunaAvailable().then(function (up) {
        if (settled) return;
        if (!up) {
          if (handlers.allowMissing) { success(null); return; }
          const unavailable = new Error('Luna not available');
          if (handlers.acceptFailureResponse) unavailable.code = 'UNSUPPORTED';
          fail(unavailable); return;
        }
        try { if (handlers.sessionGuard) handlers.sessionGuard(); }
        catch (error) { fail(error); return; }
        devLunaCall(method, parameters || {}).then(success, fail);
      }, fail);
      return;
    }
    try {
      if (handlers.sessionGuard) handlers.sessionGuard();
      request = window.webOS.service.request(SERVICE_URI, {
        method: method, subscribe: !!subscribe, parameters: parameters || {},
        onSuccess: success, onFailure: failureResponse,
      });
    } catch (e) { fail(e); }
  });
}

export function castSubscribe(onEvent, onFailure) {
  if (!hasLunaService()) {
    // DEV: the bridge runs the real cast controller (SSDP + DLNA receiver on
    // the Mac), so a phone can cast straight to the dev browser.
    if (!import.meta.env.DEV) return function () {};
    var devStop = null, devCancelled = false;
    devLunaAvailable().then(function (up) {
      if (!up || devCancelled) return;
      devStop = devLunaSubscribe('castSubscribe', { subscribe: true }, function (res) {
        if (res && res.event && onEvent) onEvent(res.event, res.status);
      });
    });
    return function () { devCancelled = true; if (devStop) devStop(); };
  }

  let cancelled = false;
  const request = window.webOS.service.request(SERVICE_URI, {
    method: 'castSubscribe',
    subscribe: true,
    parameters: { subscribe: true },
    onSuccess: function(res) {
      if (!cancelled && res?.event && onEvent) onEvent(res.event, res.status);
    },
    onFailure: function(err) {
      if (!cancelled && onFailure) onFailure(err);
    }
  });

  return function () {
    if (cancelled) return;
    cancelled = true;
    // Suppressing callbacks alone leaves the SDK's subscription/bridge alive.
    try { request?.cancel?.(); } catch (e) { /* already closed */ }
  };
}

export async function castAck(payload) {
  return lunaRequest('castAck', payload || {}, false, { allowMissing: true });
}

export async function castReportState(payload) {
  return lunaRequest('castReportState', payload || {}, false, { allowMissing: true });
}

export async function castReportProgress(payload) {
  return lunaRequest('castReportProgress', payload || {}, false, { allowMissing: true });
}

export async function castGetStatus() {
  return lunaRequest('castGetStatus', {}, false, { allowMissing: true });
}

// Persist extra cookies into the TV service (e.g. buvid3 for risk control).
function setServiceCookies(cookies, sessionGuard) {
  return lunaRequest('setCookies', { cookies: cookies || {}, onlyIfDeviceMissing: true }, false,
    { allowMissing: true, sessionGuard, acceptFailureResponse: true });
}

// Ensure a buvid3/buvid4 fingerprint cookie exists — many endpoints (live
// getDanmuInfo, etc.) return -352 without it. Fetched once per session.
let buvidEnsured = false;
let _buvid3 = '';
export function getBuvid3() { return _buvid3; }
export async function ensureBuvid() {
  const generation = storage.getAuthGeneration();
  const account = storage.getAuth() || {};
  const session = account.SESSDATA, user = account.DedeUserID;
  if (buvidEnsured) return;
  const sessionGuard = () => {
    checkSession(generation);
    const current = storage.getAuth() || {};
    if (current.SESSDATA !== session || current.DedeUserID !== user) throw new Error('Account session changed');
  };
  try {
    if (hasLunaService() || await devLunaAvailable()) {
      sessionGuard();
      const existing = await lunaRequest('getCookies', {}, false, { sessionGuard });
      sessionGuard();
      if (typeof existing?.cookies?.buvid3 === 'string' && existing.cookies.buvid3) {
        _buvid3 = existing.cookies.buvid3; buvidEnsured = true; return;
      }
      const r = await lunaRequest('ensureDeviceIdentity', {}, false, { sessionGuard });
      sessionGuard();
      _buvid3 = r.cookies?.buvid3 || '';
      buvidEnsured = !!_buvid3;
      return;
    }
    const r = await apiFetch('/x/frontend/finger/spi', {}, { sessionGuard });
    const b3 = r?.data?.b_3;
    const b4 = r?.data?.b_4;
    if (b3) {
      sessionGuard();
      const saved = await setServiceCookies({ buvid3: b3, buvid4: b4 || '' }, sessionGuard);
      sessionGuard();
      if (saved?.returnValue === false) {
        // Startup or another caller may have filled the identity after our
        // initial read. Reuse that winner once, without another SPI or write.
        if (saved.errorCode !== 'IDENTITY_EXISTS') return;
        const current = await lunaRequest('getCookies', {}, false, { sessionGuard });
        sessionGuard();
        if (typeof current?.cookies?.buvid3 === 'string' && current.cookies.buvid3) {
          _buvid3 = current.cookies.buvid3; buvidEnsured = true;
        }
        return;
      }
      // Dev browser: the service isn't there to hold the fingerprint, so hand
      // it to the Mac proxy's cookie jar instead. Without it the live chat
      // token request answers -352 (risk control) and danmaku/interaction
      // could not be tested off-device at all.
      if (!hasLunaService()) {
        try {
          sessionGuard();
          await fetch(storage.getProxyUrl() + '/cookies', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ buvid3: b3, buvid4: b4 || '' }),
          });
        } catch (e) { /* best effort */ }
      }
      sessionGuard();
      _buvid3 = b3;
      buvidEnsured = true;
    }
  } catch (e) { /* best effort */ }
}

export async function resetDeviceIdentity() {
  const generation = storage.getAuthGeneration();
  checkSession(generation);
  const r = await lunaRequest('resetDeviceIdentity', {}, false, {});
  checkSession(generation);
  const auth = { ...storage.getAuth() };
  for (const key of ['buvid3', 'buvid4', 'b_nut']) {
    delete auth[key];
    if (r.cookies?.[key]) auth[key] = r.cookies[key];
  }
  storage.setAuth(auth);
  _buvid3 = r.cookies?.buvid3 || '';
  buvidEnsured = !!_buvid3;
}
// Account repair is explicitly user-driven. Service responses are reduced to
// a fixed, non-identifying result schema by the controller before reaching UI.
function invalidateLocalDeviceCache() {
  storage.invalidateAuthRequests();
  buvidEnsured = false; _buvid3 = '';
  const auth = storage.getAuth();
  if (auth) {
    const next = { ...auth };
    delete next.buvid3; delete next.buvid4; delete next.b_nut;
    storage.setAuth(next);
  }
}
export const accountRepair = createAccountRepair({
  getAuth: () => storage.getAuth(),
  getGeneration: () => storage.getAuthGeneration(),
  nav: options => apiFetch('/x/web-interface/nav', {}, options),
  getServiceStatus: options => lunaRequest('getAccountRepairStatus', {}, false, {
    ...options, acceptFailureResponse: true,
  }),
  repairDeviceIdentity: (payload, options) => lunaRequest('repairDeviceIdentity', payload, false, {
    ...options, acceptFailureResponse: true,
  }),
  // A lost response might follow a committed service update. Re-read its
  // identity next time without claiming success or reverting its stored values.
  onDeviceRepaired: invalidateLocalDeviceCache,
  onDeviceUnknown: invalidateLocalDeviceCache,
});

// Rename the cast receiver as shown in the phone's 投屏 list (applies live).
export async function castSetConfig(payload) {
  return lunaRequest('castSetConfig', payload || {}, false, { allowMissing: true });
}

// Service health snapshot for the 网络诊断 page. Falls back to 'ping' when the
// installed service predates getDiagnostics.
export async function getServiceDiagnostics() {
  try {
    return await lunaRequest('getDiagnostics', {}, false, {});
  } catch (e) {
    try {
      var p = await lunaRequest('ping', {}, false, {});
      return { returnValue: true, nodeVersion: p.nodeVersion, legacyPing: true, cookieKeys: p.cookieKeys };
    } catch (e2) {
      throw e; // report the original getDiagnostics error
    }
  }
}

// Subscribe to live danmaku relayed by the service. onDanmaku(text) per message.
// Returns an unsubscribe function. Pair with danmakuStop() to close the relay.
export function danmakuSubscribe(params, onDanmaku, onEvent) {
  if (!hasLunaService()) {
    // Dev browser: the service doesn't exist here, so the Mac proxy runs the
    // same relay module and bridges it over a WebSocket (see proxy/server.js).
    // Without this, live danmaku and the gift/SC feed could only be tested on
    // the TV (owner 2026-08-02: "直播为什么测不了,解决一下").
    if (!import.meta.env.DEV) return function () {};
    // Prefer the dev-service bridge: that's literally the TV's relay, reached
    // through the TV's own danmakuSubscribe method. The proxy bridge below
    // stays as a fallback for when only proxy/server.js is running.
    var cancelledBridge = false, stopBridge = null;
    devLunaAvailable().then(function (up) {
      if (cancelledBridge) return;
      if (up) {
        stopBridge = devLunaSubscribe('danmakuSubscribe', params || {}, function (res) {
          if (cancelledBridge || !res) return;
          if (res.danmaku && onDanmaku) onDanmaku(res.danmaku);
          if (res.event && onEvent) onEvent(res.event);
        });
        return;
      }
      // Pick a single transport after discovery. Opening the fallback early
      // lets a late bridge response create a second, unowned subscription.
      try {
        var base = storage.getProxyUrl().replace(/^http/, 'ws');
        var p = params || {};
        var ws = new WebSocket(base + '/danmaku?roomid=' + encodeURIComponent(p.roomid)
          + '&token=' + encodeURIComponent(p.token || '')
          + '&host=' + encodeURIComponent(p.host || ''));
        ws.onmessage = function (m) {
          if (cancelledBridge) return;
          try {
            var d = JSON.parse(m.data);
            if (d.danmaku && onDanmaku) onDanmaku(d.danmaku);
            if (d.event && onEvent) onEvent(d.event);
          } catch (e) { /* ignore */ }
        };
        stopBridge = function () { try { ws.close(); } catch (e) { /* ignore */ } };
      } catch (e) { /* unavailable fallback */ }
    });
    return function () {
      if (cancelledBridge) return;
      cancelledBridge = true;
      if (stopBridge) stopBridge();
    };
  }
  let cancelled = false;
  const request = window.webOS.service.request(SERVICE_URI, {
    method: 'danmakuSubscribe',
    subscribe: true,
    parameters: params || {},
    onSuccess: function (res) {
      if (cancelled || !res) return;
      if (res.danmaku && onDanmaku) onDanmaku(res.danmaku);
      // Gifts / SC / 上舰 / 进场 / 人气 — service ≥1.5.1 only.
      if (res.event && onEvent) onEvent(res.event);
    },
    onFailure: function () {},
  });
  return function () {
    if (cancelled) return;
    cancelled = true;
    // danmakuStop closes the service relay; cancel releases the SDK request.
    try { request?.cancel?.(); } catch (e) { /* already closed */ }
  };
}

export async function danmakuStop() {
  return lunaRequest('danmakuStop', {}, false, { allowMissing: true });
}

// ============ Login ============

export async function qrCodeGenerate() {
  return smartFetch(PASSPORT_HOST, '/x/passport-login/web/qrcode/generate');
}

export async function qrCodePoll(qrcodeKey) {
  return smartFetch(PASSPORT_HOST, '/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(qrcodeKey));
}

// ============ User ============

export async function getNavInfo() {
  return apiFetch('/x/web-interface/nav');
}

// ============ Video ============

export async function getPopular(pn, ps) {
  return wbiFetch('/x/web-interface/popular', { pn: pn || 1, ps: ps || 20 });
}

export async function getRecommend(freshType, ps) {
  return wbiFetch('/x/web-interface/wbi/index/top/feed/rcmd', {
    fresh_idx: 1, fresh_idx_1h: 1, fresh_type: freshType || 4, ps: ps || 10,
  });
}

export async function getRanking(rid, type) {
  return wbiFetch('/x/web-interface/ranking/v2', { rid: rid || 0, type: type || 'all' });
}

export async function getVideoInfo(video) {
  var params = null;
  if (typeof video === 'string') params = { bvid: video };
  else if (video && video.bvid) params = { bvid: video.bvid };
  else if (video && video.aid) params = { aid: video.aid };
  if (!params) throw new Error('Missing video identifier');

  let info = await wbiFetch('/x/web-interface/view', params);
  // 测试钩子(同 window.__openVideo 一路):国内网络复现不了海外风控,
  // 置 localStorage.bili_test_view412 可强制走下面的兜底分支。
  if (typeof localStorage !== 'undefined' && localStorage.getItem('bili_test_view412')) {
    info = { code: -412 };
  }
  // 2026-09-02(issue #25):B站 对海外匿名请求拦掉了 view(HTTP 412 / code=-412),
  // 但 pagelist 和 playurl **都还是通的** —— VPS 实测 pagelist 拿 cid 再取流
  // code=0 有流。view 只是我们取 cid 的路径,不该让它挡死一个能播的视频:
  // 被拦时用 pagelist 补出 cid + 分P,标题/UP 主用卡片带来的数据顶上。
  if (info && (info.code === -412 || info.status === 412)) {
    try {
      const pl = await apiFetch('/x/player/pagelist', params);
      if (pl && pl.code === 0 && pl.data && pl.data.length) {
        return { code: 0, viewBlocked: true, data: {
          cid: pl.data[0].cid, pages: pl.data, bvid: params.bvid,
        } };
      }
    } catch (e) { /* 兜底也挂了就报原始错误 */ }
  }
  return info;
}

// Player meta incl. resume position: last_play_cid (which part) + last_play_time
// (ms into it). Used to 续播 a multi-part video where the user left off.
// Seek-preview sprite sheets (YouTube-style scrub thumbnails). Returns
// data.image[] sprite jpgs (10x10 grid of 160x90 frames by default) plus
// per-frame timestamps in data.index[].
export async function getVideoshot(bvid, cid) {
  return apiFetch('/x/player/videoshot', { bvid, cid, index: 1 });
}

export async function getPlayerV2(aid, cid) {
  return wbiFetch('/x/player/wbi/v2', { aid, cid });
}

// Fetch a subtitle body JSON (player/v2 gives protocol-relative CDN urls on
// aisubtitle.hdslb.com). Routed through Luna/proxy like every other request —
// the CDN has no CORS headers, so a direct browser fetch would fail.
export async function getSubtitleBody(url) {
  var abs = url.indexOf('//') === 0 ? 'https:' + url : url;
  var parsed = new URL(abs);
  var res = await smartFetch(parsed.host, parsed.pathname + parsed.search);
  // Proxy path hands back a raw Response when the CDN mislabels the JSON
  // (octet-stream); Luna path already parsed it.
  if (res && typeof res.json === 'function') {
    try { return await res.json(); } catch (e) { return null; }
  }
  return res;
}

// Free keyless Google translate endpoint (translate_a/t): POST form body with
// one q per line → JSON array of translations in the same order. Blocked in
// mainland China, but subtitle translation only activates on non-zh UI locales
// — i.e. overseas users, where it's reachable. Routed via Luna/proxy like
// everything else.
export async function gtxTranslate(texts, tl) {
  var body = texts.map(function (s) { return 'q=' + encodeURIComponent(s); }).join('&');
  var res = await smartFetch(
    'translate.googleapis.com',
    '/translate_a/t?client=gtx&format=text&sl=zh-CN&tl=' + encodeURIComponent(tl),
    { method: 'POST', body: body, contentType: 'application/x-www-form-urlencoded' }
  );
  if (res && typeof res.json === 'function') {
    try { res = await res.json(); } catch (e) { res = null; }
  }
  // Single-q requests come back as a bare JSON string, multi-q as an array.
  if (typeof res === 'string') res = [res];
  if (!Array.isArray(res)) throw new Error('bad translate response');
  // sl fixed → plain strings; sl=auto variants wrap as [text, detectedLang].
  return res.map(function (it) { return Array.isArray(it) ? String(it[0]) : String(it); });
}

export async function getPlayUrl(videoOrBvid, cid, qn) {
  var payload = {
    cid: cid, qn: qn || 80, fnval: 4048, fnver: 0, fourk: 1, platform: 'pc',
  };
  if (typeof videoOrBvid === 'string') payload.bvid = videoOrBvid;
  else if (videoOrBvid?.bvid) payload.bvid = videoOrBvid.bvid;
  else if (videoOrBvid?.aid) payload.avid = videoOrBvid.aid;
  return wbiFetch('/x/player/playurl', payload);
}

// ============ Bangumi / 番剧 (PGC) ============
// PGC uses a different endpoint family than UGC videos, and wraps its payload
// in `result` (not `data`). An episode is identified by ep_id; cid pins the
// exact part. fnval=4048 requests DASH + HDR + 4K + Dolby + AV1.
export async function getBangumiPlayUrl(opts, qn) {
  var o = opts || {};
  var payload = { qn: qn || 80, fnval: 4048, fnver: 0, fourk: 1 };
  if (o.epid) payload.ep_id = o.epid;
  if (o.cid) payload.cid = o.cid;
  return wbiFetch('/pgc/player/web/playurl', payload);
}

// Season metadata (episode list with per-episode cid/cover/title). Accepts
// either an episode id or a season id.
export async function getBangumiInfo(opts) {
  var o = opts || {};
  var params = {};
  if (o.epid) params.ep_id = o.epid;
  else if (o.seasonId) params.season_id = o.seasonId;
  return wbiFetch('/pgc/view/web/season', params);
}

// Partition/region
export async function getRegionDynamic(rid, pn, ps) {
  // dynamic/region was sunset by B站 (-404 as of 2026-07); newlist returns the
  // same archives shape for the main region ids.
  return apiFetch('/x/web-interface/newlist', { rid: rid || 1, pn: pn || 1, ps: ps || 6, type: 0 });
}

// Follow feed — paginates by the `offset` cursor returned in data.offset,
// NOT by page number (page alone re-returns the first page).
export async function getFollowFeed(page, offset) {
  var url = '/x/polymer/web-dynamic/v1/feed/all?timezone_offset=-480&type=video&page=' + (page || 1);
  if (offset) url += '&offset=' + encodeURIComponent(offset);
  return smartFetch(API_HOST, url);
}

// Logged-in user's followings (Cookie auth). Used to badge "已关注" on cards.
export async function getFollowings(vmid, pn, ps) {
  return apiFetch('/x/relation/followings', { vmid: vmid, pn: pn || 1, ps: ps || 50, order: 'desc' });
}

export function getUpRelation(mid) {
  return apiFetch('/x/relation', { fid: mid });
}

export function setUpFollow(mid, follow) {
  return biliWrite('/x/relation/modify', { fid: mid, act: follow ? 1 : 2, re_src: 11 });
}

// Manual/settings update check: release asset first, independent release API
// once if it fails. The daily asset ping below retains its original semantics.
export async function getLatestVersion() {
  const normalize = value => {
    const version = typeof value === 'string' ? value.replace(/^v/i, '') : '';
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid release version');
    return version;
  };
  const releaseApi = 'https://api.github.com/repos/asdf17128/bili-webos/releases/latest';
  if (hasLunaService()) {
    const sources = [
      ['https://github.com/asdf17128/bili-webos/releases/latest/download/version.json', 'version'],
      [releaseApi, 'tag_name'],
    ];
    for (let i = 0; i < sources.length; i++) {
      let status = null, category = 'transport';
      try {
        const response = await lunaFetch(sources[i][0], { deadlineMs: 7000 });
        status = response?.status ?? null; category = 'http';
        if (!response?.returnValue || status !== 200) throw new Error('Update HTTP failure');
        category = 'encoding';
        const text = response.body || (response.bodyBase64 ? atob(response.bodyBase64) : '');
        category = 'json';
        const body = JSON.parse(text);
        category = 'version';
        return normalize(body?.[sources[i][1]]);
      } catch {
        // Fixed diagnostics only: no upstream body, signed redirect or account.
        logErr('update-check', (i === 0 ? 'asset' : 'release-api') + ' status=' + String(status) + ' category=' + category);
      }
    }
    throw new Error('Update sources unavailable');
  }
  const data = await fetchJsonWithDeadline(releaseApi, { headers: { Accept: 'application/vnd.github+json' } }, 7000);
  return normalize(data?.tag_name);
}

// Daily countable version check ("日活 via update requests", owner-approved):
// fetches the version.json RELEASE ASSET via the Luna service — each fetch
// bumps the asset's public download_count, which the maintainer reads as a
// daily-active proxy. No identifier of any kind is sent; manual checks also
// use this asset first, so its count is an approximate activity measure. TV-only (the asset
// redirect has no CORS for browsers; dev just skips).
export async function pingVersionAsset() {
  if (!hasLunaService()) return null;
  var url = 'https://github.com/asdf17128/bili-webos/releases/latest/download/version.json';
  var parsed = new URL(url);
  var res = await smartFetch(parsed.host, parsed.pathname + parsed.search);
  return res && res.version ? String(res.version) : null;
}

// ============ Live ============

export async function getLiveList(page, pageSize) {
  // Try followed streamers first
  var followed = await smartFetch('api.live.bilibili.com',
    '/xlive/web-ucenter/v1/xfetter/GetWebList?page=' + (page || 1) + '&page_size=' + (pageSize || 12));
  var rooms = followed && followed.data && (followed.data.rooms || followed.data.list);
  if (rooms && rooms.length > 0) {
    return { data: { list: rooms } };
  }
  // Fallback to general recommendations
  var rec = await smartFetch('api.live.bilibili.com',
    '/xlive/web-interface/v1/webMain/getMoreRecList?platform=web&page=' + (page || 1) + '&page_size=' + (pageSize || 12));
  var items = rec && rec.data && (rec.data.list || rec.data.recommend_room_list);
  return { data: { list: items || [] } };
}

// Resolve a (possibly short) room id to the real room_id.
export async function getRoomInit(roomId) {
  return apiFetch('/room/v1/Room/room_init', { id: roomId }, { host: 'api.live.bilibili.com' });
}

// Current room info in one shot: live_status (0 未开播 / 1 直播 / 2 轮播),
// title and a fresh cover — used to label/refresh "最近观看" live entries.
export async function getLiveRoomInfo(roomId) {
  return smartFetch('api.live.bilibili.com',
    '/xlive/web-room/v1/index/getInfoByRoom?room_id=' + roomId);
}

// Live danmaku server token + host list (for the WebSocket connection).
// Needs WBI signing (returns -352 otherwise).
export async function getDanmuInfo(realRoomId) {
  await ensureBuvid();
  return wbiFetch('/xlive/web-room/v1/index/getDanmuInfo', { id: realRoomId, type: 0, web_location: 444.8 }, { host: 'api.live.bilibili.com' });
}

// Live stream ladder: accept_qn + the names B站 uses (原画/蓝光/超清…).
// Returns { qn, accept: [{qn,label}] } — accept is ordered best-first.
// 直播间最近的聊天记录(约 10 条)。进房时先铺上,不然聊天栏永远从空白开始 ——
// 冷清的房间里等半天一条都没有,用户以为坏了(owner 2026-08-22:"每次都是实时清屏")。
export async function getLiveHistory(roomId) {
  return apiFetch('/xlive/web-room/v1/dM/gethistory', { roomid: roomId },
    { host: 'api.live.bilibili.com' });
}

export async function getLivePlayback(roomId, qn, preferredFormat, avoidedHosts) {
  const res = await smartFetch('api.live.bilibili.com',
    '/xlive/web-room/v2/index/getRoomPlayInfo?room_id=' + roomId + '&protocol=0,1&format=0,1,2&codec=0,1,2&platform=web&ptype=8'
      + (qn ? '&qn=' + qn : ''));
  return selectLivePlayback(res, preferredFormat, avoidedHosts);
}

// ============ Search ============

export async function searchVideo(keyword, page, pageSize) {
  return wbiFetch('/x/web-interface/search/type', {
    search_type: 'video', keyword: keyword, page: page || 1, page_size: pageSize || 20,
    order: '', duration: 0, tids: 0,
  });
}

// Keyword autocomplete (s.search.bilibili.com/main/suggest). Returns an array of
// plain-text suggestions — the single biggest relief for remote-control typing
// (D-pad on a soft keyboard). No WBI signing needed for this endpoint.
export async function searchSuggest(term) {
  var q = (term || '').trim();
  if (!q) return [];
  try {
    var res = await apiFetch('/main/suggest', {
      func: 'suggest', suggest_type: 'accurate', sub_type: 'tag',
      main_ver: 'v1', term: q,
    }, { host: 's.search.bilibili.com' });
    var tag = res && res.result && res.result.tag;
    if (!Array.isArray(tag)) return [];
    var out = [];
    for (var i = 0; i < tag.length; i++) {
      var v = tag[i] && (tag[i].value || tag[i].term);
      if (v && out.indexOf(v) < 0) out.push(v);
    }
    return out.slice(0, 10);
  } catch (e) {
    return []; // suggestions are best-effort — never block typing on a failure
  }
}

// Trending / hot searches (搜索发现) for the idle search page. On the
// allowlisted api.bilibili.com host, no WBI needed. Returns plain keywords.
export async function getHotSearches(limit) {
  try {
    var res = await apiFetch('/x/web-interface/search/square', { limit: limit || 10, platform: 'web' });
    var list = (res && res.data && res.data.trending && res.data.trending.list) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var k = list[i] && list[i].keyword;
      if (k && out.indexOf(k) < 0) out.push(k);
    }
    return out;
  } catch (e) {
    return [];
  }
}

// ============ Interactions (点赞 / 投币 / 收藏 / 三连) ============
// B站 write endpoints need the CSRF token = the bili_jct cookie, sent as a
// `csrf` form field. The service returns its whole cookie jar as newCookies,
// so bili_jct is synced into local auth after any authenticated request.
function getCsrf() {
  return (storage.getAuth() || {}).bili_jct || '';
}

async function biliWrite(path, params) {
  var form = Object.assign({}, params || {}, { csrf: getCsrf() });
  var body = new URLSearchParams(form).toString();
  return smartFetch(API_HOST, path, {
    method: 'POST', body: body, contentType: 'application/x-www-form-urlencoded',
  });
}

function feedbackError(code, message, unknown = false) {
  const error = new Error(message);
  error.code = code;
  if (unknown) {
    error.name = 'RecommendationFeedbackUnknownError';
    error.resultUnknown = true;
  }
  return error;
}

// Only running operations are retained; settle/timeout drops the session
// snapshot. This also covers callers recreated after a menu closes/reopens.
const pendingRecommendationFeedback = new Set();
const MAX_PENDING_RECOMMENDATION_FEEDBACK = 32;

// Official home-page web feedback uses a WBI-signed query and a separate CSRF
// form body. A business error is returned unchanged; writes are never retried.
// Cancel must receive the original reason saved by its caller (1 video, 4 UP).
export async function sendRecommendationFeedback(video, cancel = false, reason = 1) {
  if (!isRecommendationFeedbackReason(reason)) {
    throw feedbackError('FEEDBACK_REASON_INVALID', 'Invalid recommendation feedback reason');
  }
  const context = recommendationFeedbackContext(video);
  if (!context) throw feedbackError('FEEDBACK_CONTEXT_INVALID', 'Invalid recommendation feedback context');
  const generation = storage.getAuthGeneration();
  const auth = storage.getAuth() || {};
  const hasToken = token => typeof token === 'string' && token.trim().length > 0;
  if (!hasToken(auth.SESSDATA) || !hasToken(auth.bili_jct)) {
    throw feedbackError('FEEDBACK_AUTH_REQUIRED', 'Recommendation feedback requires login');
  }
  const key = JSON.stringify([context.goto, context.id, context.mid, context.track_id, reason, cancel === true]);
  for (const operation of pendingRecommendationFeedback) {
    if (operation.key === key && operation.generation === generation &&
        operation.session === auth.SESSDATA && operation.user === auth.DedeUserID) return operation.promise;
  }
  if (pendingRecommendationFeedback.size >= MAX_PENDING_RECOMMENDATION_FEEDBACK) {
    throw feedbackError('FEEDBACK_BUSY', 'Too many pending recommendation feedback operations');
  }
  const operation = { key, generation, session: auth.SESSDATA, user: auth.DedeUserID, promise: null };
  // Start in a microtask so every concurrent caller sees the populated entry.
  operation.promise = Promise.resolve().then(() => performRecommendationFeedback(context, cancel, reason, operation));
  pendingRecommendationFeedback.add(operation);
  try { return await operation.promise; }
  finally { pendingRecommendationFeedback.delete(operation); }
}

async function performRecommendationFeedback(context, cancel, reason, operation) {
  const { generation, session, user } = operation;
  const hasToken = token => typeof token === 'string' && token.trim().length > 0;
  let csrf;
  const checkFeedbackSession = () => {
    const current = storage.getAuth() || {};
    if (loggingOut || generation !== storage.getAuthGeneration() || current.SESSDATA !== session ||
        current.DedeUserID !== user || (csrf !== undefined && current.bili_jct !== csrf)) {
      throw feedbackError('RECOMMENDATION_FEEDBACK_SESSION_CHANGED', 'Account session changed');
    }
  };
  checkFeedbackSession();
  // Key acquisition precedes the write deadline: a failed nav has not sent any
  // feedback, so its errors must not be classified as an unknown write result.
  let keys, preparing = true;
  const preparationError = () => {
    const error = feedbackError('FEEDBACK_PREPARATION_FAILED', 'Recommendation feedback preparation failed; not sent');
    error.resultUnknown = false;
    return error;
  };
  const preparationGuard = () => {
    checkFeedbackSession();
    if (!preparing) throw preparationError();
  };
  try {
    keys = await withDeadline(getWbiKeys(async (path, params) => {
      const response = await apiFetch(path, params, { sessionGuard: preparationGuard, deadlineMs: 10000 });
      // Proxy headers may arrive before a stalled JSON body. Do not cache keys
      // obtained after the preparation deadline or a change of account.
      preparationGuard();
      return response;
    }), 10000);
  } catch (error) {
    checkFeedbackSession();
    throw preparationError();
  } finally { preparing = false; }
  checkFeedbackSession();
  // A read-only nav may refresh CSRF for the same session. Once the form is
  // built, pin that token through dispatch and response acceptance as well.
  csrf = (storage.getAuth() || {}).bili_jct;
  if (!hasToken(csrf)) throw feedbackError('FEEDBACK_AUTH_REQUIRED', 'Recommendation feedback requires login');
  const signedQuery = signWbi({}, keys.imgKey, keys.subKey);
  const form = { app_id: 100, platform: 5, from_spmid: '', spmid: '333.1007.0.0',
    feedback_page: 1, ...context, reason_id: reason, csrf };
  const path = '/x/web-interface/feedback/dislike' + (cancel === true ? '/cancel' : '');
  let active = true, dispatched = false;
  const sessionGuard = phase => {
    if (!active) throw feedbackError('RECOMMENDATION_FEEDBACK_UNKNOWN', 'Recommendation feedback result unknown', true);
    checkFeedbackSession();
    if (phase === 'dispatch') dispatched = true;
  };
  try {
    const result = await withDeadline(smartFetch(API_HOST, path + '?' + signedQuery, {
      method: 'POST', body: new URLSearchParams(form).toString(),
      contentType: 'application/x-www-form-urlencoded', sessionGuard,
    }), 20000);
    checkFeedbackSession();
    if (!result || typeof result.code !== 'number' || !Number.isFinite(result.code)) {
      throw feedbackError('RECOMMENDATION_FEEDBACK_UNKNOWN', 'Recommendation feedback response unavailable; result unknown', true);
    }
    return result;
  } catch (error) {
    checkFeedbackSession();
    if (error && error.resultUnknown) throw error;
    // A lost/reset connection can follow a committed server write just like a
    // timeout. Only a valid business response confirms its reported outcome.
    if (dispatched || /timeout|timed out|ETIMEDOUT/i.test(String(error && error.message))) {
      throw feedbackError('RECOMMENDATION_FEEDBACK_UNKNOWN', 'Recommendation feedback response unavailable; result unknown', true);
    }
    throw error;
  } finally {
    // Prevent delayed bridge discovery or late responses from dispatching or
    // accepting this operation after the outer deadline has already settled.
    active = false;
  }
}

// 一键三连(点赞 + 投币×2 + 收藏,一个接口全干)。返回 data:{like,coin,fav,multiply,prompt}.
export async function tripleVideo(aid) {
  return biliWrite('/x/web-interface/archive/like/triple', { aid: aid });
}

// 单独点赞(like=1 赞 / like=2 取消)。
export async function likeVideo(aid, like) {
  return biliWrite('/x/web-interface/archive/like', { aid: aid, like: like == null ? 1 : like });
}

// 当前用户对该视频的互动状态(是否已赞/投币/收藏),用于按钮回显。
export async function getVideoRelation(aid) {
  return apiFetch('/x/web-interface/archive/relation', { aid: aid });
}

// 投币(multiply 1 或 2;B站规则:UGC 每视频最多 2 枚,且不可撤销)。
export async function coinVideo(aid, multiply) {
  return biliWrite('/x/web-interface/coin/add', { aid: aid, multiply: multiply || 1 });
}

// 用户的收藏夹列表,针对某视频:带 rid(=aid)时每项含 fav_state(该视频是否
// 已在此夹)。第一项即默认收藏夹。up_mid 从登录 cookie 的 DedeUserID 来。
// (区别于下方 getFavFolders(mid):那个是收藏页用的纯列表。)
export async function getFavFoldersFor(aid) {
  var mid = (storage.getAuth() || {}).DedeUserID || '';
  return apiFetch('/x/v3/fav/folder/created/list-all', { up_mid: mid, rid: aid, type: 2 });
}

// 收藏/取消收藏(add/del 均为逗号分隔的收藏夹 id 列表)。
export async function favVideo(aid, addIds, delIds) {
  return biliWrite('/x/v3/fav/resource/deal', {
    rid: aid, type: 2,
    add_media_ids: addIds || '', del_media_ids: delIds || '',
  });
}

// ============ 稍后再看(toview) ============
// B站的「稍后再看」是一个独立于收藏夹的队列,上限 100 条。列表接口一次全返回
// (无分页),字段与收藏夹的 medias 不同:直接就是 archive 结构 + progress。

// 全量列表。data.list 为空时 B站返回 null(不是空数组),调用方要兜住。
export async function getToView() {
  return apiFetch('/x/v2/history/toview');
}

// 加入稍后再看。只吃 aid(不认 bvid),所以调用前必须拿到 aid。
export async function addToView(aid) {
  return biliWrite('/x/v2/history/toview/add', { aid: aid });
}

// 移除。viewed=true 表示"清除已观看的",与 aid 互斥;两者都不给会被服务端拒绝。
export async function delToView(aids, viewed) {
  var params = viewed ? { viewed: true } : { aid: Array.isArray(aids) ? aids.join(',') : aids };
  return biliWrite('/x/v2/history/toview/del', params);
}

// 合流 MP4 播放地址(html5 端 durl 格式,单文件带音频)。倍速模式专用:
// webOS 的原生播放管线(非 MSE)才响应 setPlayRate,而原生管线只吃单文件。
// 画质上限 720P/1080P,倍速下可接受;恢复 1x 后切回 DASH 高画质。
export async function getHtml5PlayUrl(video, cid) {
  var params = { cid: cid, platform: 'html5', high_quality: 1, qn: 80 };
  if (video.bvid) params.bvid = video.bvid; else params.avid = video.aid;
  return apiFetch('/x/player/playurl', params);
}

// Video comments (评论). oid = the video's aid, type=1 for videos.
// sort: 1 = hot (recommended), 0 = time, 2 = reply-count. The legacy endpoint
// needs no WBI signature; the service adds Referer/cookies (isBiliHost).
export async function getReplies(oid, pn, sort) {
  return apiFetch('/x/v2/reply', {
    type: 1, oid: oid, pn: pn || 1, ps: 20, sort: sort == null ? 1 : sort,
  });
}

// 楼中楼: sub-replies under one root comment. root = parent's rpid.
export async function getReplyReplies(oid, root, pn) {
  return apiFetch('/x/v2/reply/reply', {
    type: 1, oid: oid, root: root, pn: pn || 1, ps: 10,
  });
}

// ============ History & Favorites ============

export async function getHistory(max, viewAt, ps) {
  return wbiFetch('/x/web-interface/history/cursor', { ps: ps || 20, type: '', max: max || 0, view_at: viewAt || 0 });
}

export async function getFavFolders(mid) {
  return wbiFetch('/x/v3/fav/folder/created/list-all', { up_mid: mid });
}

export async function getFavList(mediaId, pn, ps) {
  return wbiFetch('/x/v3/fav/resource/list', { media_id: mediaId, pn: pn || 1, ps: ps || 20, platform: 'web' });
}

export async function getSubscribedFolders(mid, pn = 1, ps = 20) {
  return wbiFetch('/x/v3/fav/folder/collected/list', { up_mid: mid, pn, ps, platform: 'web' });
}

export async function getLibraryPage(folder, pn = 1, ps = 36) {
  const response = Number(folder.type) === 21
    ? await wbiFetch('/x/polymer/web-space/seasons_archives_list', {
      mid: folder.mid || folder.upper?.mid, season_id: folder.id,
      page_num: pn, page_size: ps, sort_reverse: false,
    })
    : await getFavList(folder.id, pn, ps);
  if (!response || response.code !== 0 || !response.data) throw new Error(response?.message || 'Library request failed');
  return mapLibraryPage(response.data, folder, pn, ps);
}

// ============ Heartbeat ============

export async function reportHeartbeat(bvid, cid, playedTime, realTime) {
  var params = 'bvid=' + bvid + '&cid=' + cid +
    '&played_time=' + Math.floor(playedTime) +
    '&real_played_time=' + Math.floor(realTime) +
    '&type=3&dt=2&play_type=0&start_ts=' + Math.floor(Date.now() / 1000);

  try {
    await smartFetch(API_HOST, '/x/click-interface/web/heartbeat', {
      method: 'POST',
      body: params,
      contentType: 'application/x-www-form-urlencoded',
    });
  } catch(e) {}
}

// ============ Danmaku ============

export async function getDanmaku(cid) {
  var url = 'https://api.bilibili.com/x/v1/dm/list.so?oid=' + cid;

  if (hasLunaService()) {
    var res = await lunaFetch(url, {});
    if (res.body) return parseDanmakuXml(res.body);
    return [];
  }

  // Proxy fallback
  var base = storage.getProxyUrl();
  var proxyRes = await fetch(base + '/proxy/api.bilibili.com/x/v1/dm/list.so?oid=' + cid);
  var text = await proxyRes.text();
  return parseDanmakuXml(text);
}

function parseDanmakuXml(xml) {
  var danmakus = [];
  var parser = new DOMParser();
  var doc = parser.parseFromString(xml, 'text/xml');
  var items = doc.querySelectorAll('d');
  items.forEach(function(d) {
    var attr = d.getAttribute('p');
    if (!attr) return;
    var parts = attr.split(',');
    danmakus.push({
      time: parseFloat(parts[0]),
      mode: parseInt(parts[1]),
      size: parseInt(parts[2]),
      color: '#' + parseInt(parts[3]).toString(16).padStart(6, '0'),
      timestamp: parseInt(parts[4]),
      text: d.textContent,
    });
  });
  danmakus.sort(function(a, b) { return a.time - b.time; });
  return danmakus;
}

// ============ Related ============

export async function getRelated(bvid) {
  return wbiFetch('/x/web-interface/archive/related', { bvid: bvid });
}

// ============ UP uploader ============

// This uploader's submitted videos, newest first (space arc search, WBI signed)
export async function getUpVideos(mid, pn, ps) {
  return wbiFetch('/x/space/wbi/arc/search', {
    mid: mid, pn: pn || 1, ps: ps || 30, order: 'pubdate', tid: 0, keyword: '',
    platform: 'web', web_location: 1550101,
  });
}
