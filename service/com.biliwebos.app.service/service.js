// Bilibili API proxy service for webOS TV
// Runs as background Node.js service, communicates via Luna bus
// Also starts a local HTTP proxy for video segments and images
// Node.js v16.19.1 on webOS TV 24

// Must run first: shims for webOS 4.x's Node v0.12 (URL, Buffer.from, TLS roots...).
require('./compat');

var Service = require('webos-service');
var https = require('https');
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');
var biliReferer = require('./biliReferer');
var upstreamRequest = require('./upstreamRequest');
var decompressResponse = require('./httpBody');
var playbackDiagnostics = require('./playbackDiagnostics')();
// The WHATWG URL GLOBAL only exists on Node 10+. webOS 5 runs Node 8, where
// every `new URL(...)` threw ReferenceError — caught by the surrounding
// try/catch and turned into "Invalid URL"/400 for EVERY api/proxy call. That
// was the real face of "UI renders but nothing loads / blank login QR" on
// webOS 5 (#10/#13). require('url').URL exists since Node 6.13.
var URL = require('url').URL;

// Ring buffer of recent failures, surfaced via getDiagnostics so the app's
// 网络诊断 page (and its scan-to-report QR) can show WHY things fail — the
// service's console.error is invisible on a user's TV.
var recentErrors = [];
function logSvcErr(tag, detail) {
  recentErrors.push({ t: Date.now(), tag: tag, d: String(detail).slice(0, 200) });
  if (recentErrors.length > 30) recentErrors.shift();
}

var deviceProfile = require('./cast/deviceProfile');
var CastController = require('./cast/castController').CastController;
var CastLanServer = require('./cast/ssdpServer').CastLanServer;
// Load the live-danmaku relay defensively: it's the only module that pulls in
// `ws`, and on older webOS service runtimes (webOS 5 = Node 8) a too-new `ws`
// would throw at require() and take down the ENTIRE service — killing all
// API/proxy calls, which showed as "everything stuck on 加载中 / blank QR" on
// webOS 5 (issue #10). Isolated so the core API + HTTP proxy always start even
// if danmaku can't. (`ws` is also pinned to v7 for Node 8 compatibility.)
var danmakuRelay = null;
try {
  danmakuRelay = require('./danmaku');
} catch (e) {
  console.error('[service] danmaku relay unavailable (live danmaku disabled):', e && e.message);
  logSvcErr('danmaku-require', e && e.message);
}

var service = new Service('com.biliwebos.app.service');

// 最后一道保险:这是个常驻后台进程,任何一个没人接的 socket 'error'(比如对端
// 消失后的 read ETIMEDOUT)都会让整个服务退出 —— 表现为 API/代理/投屏全挂,
// 用户只看到"什么都加载不出来"。2026-09-20 开发桥(同一份代码)就这么死过一次。
// 记进诊断环形日志然后继续活着,比死掉强。
process.on('uncaughtException', function (err) {
  try { console.error('[service] uncaught:', err && err.stack || err); logSvcErr('uncaught', err && err.message || String(err)); } catch (e) { }
});
process.on('unhandledRejection', function (reason) {
  try { logSvcErr('unhandledRejection', reason && reason.message || String(reason)); } catch (e) { }
});

// Reuse TLS connections to CDN hosts. The TV's CPU makes a fresh TLS handshake
// per segment expensive; keep-alive cuts initial-load and seek latency a lot.
var keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 8, keepAliveMsecs: 15000 });

// Cookie storage
var COOKIE_FILE = path.join('/media/internal', 'bili_cookies.json');
var storedCookies = {};
var cookieGeneration = 0;
try {
  if (fs.existsSync(COOKIE_FILE)) {
    storedCookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
  }
} catch (e) { }

function saveCookies() {
  try { fs.writeFileSync(COOKIE_FILE, JSON.stringify(storedCookies)); return true; }
  catch (e) { logSvcErr('cookies-save', 'Cookie persistence failed'); return false; }
}

var CAST_CONFIG_FILE = path.join('/media/internal', 'bili_cast_config.json');
var castConfig = {};
try {
  if (fs.existsSync(CAST_CONFIG_FILE)) {
    castConfig = JSON.parse(fs.readFileSync(CAST_CONFIG_FILE, 'utf-8'));
  }
} catch (e) { }

if (castConfig.friendlyName === 'B站 webOS') {
  castConfig.friendlyName = '我的小电视';
}

function saveCastConfig() {
  try { fs.writeFileSync(CAST_CONFIG_FILE, JSON.stringify(castConfig)); } catch (e) { }
}

function serializeCookies(cookies) {
  return Object.keys(cookies).map(function (k) { return k + '=' + cookies[k]; }).join('; ');
}

// Identity refresh is shared across startup, manual repair and playurl recovery.
// Keep the old identity until a complete replacement is available. Account
// cookies are never copied from the anonymous SPI response.
var identityEpoch = 0;
var identityFlight = null;
var IDENTITY_COOLDOWN = 5 * 60 * 1000;
var IDENTITY_STATE = path.join('/media/internal', 'bili_identity_state.json');
var identityAttempt = 0;
try { identityAttempt = Number(JSON.parse(fs.readFileSync(IDENTITY_STATE, 'utf-8')).attempt) || 0; } catch (e) {}
function isIdentityCookie(key) { return key === 'buvid3' || key === 'buvid4' || key === 'b_nut'; }
function acquireIdentity(callback) {
  if (identityFlight) { identityFlight.push(callback); return; }
  var listeners = identityFlight = [callback];
  var generation = cookieGeneration;
  var epoch = identityEpoch;
  function finish(err) {
    if (identityFlight === listeners) identityFlight = null;
    listeners.forEach(function (cb) {
      try { cb(err); } catch (e) { logSvcErr('identity-callback', 'Request no longer available'); }
    });
  }
  upstreamRequest(https.request.bind(https), {
    hostname: 'api.bilibili.com', port: 443, path: '/x/frontend/finger/spi', method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/'
    }, rejectUnauthorized: false, agent: keepAliveAgent
  }, null, function (err, res) {
    if (err) { finish(err); return; }
    decompressResponse(res, function (err, body) {
      if (err) { finish(err); return; }
      if (generation !== cookieGeneration || epoch !== identityEpoch) { finish(new Error('Account session changed')); return; }
      if (res.statusCode !== 200) { finish(new Error('Fingerprint HTTP ' + res.statusCode)); return; }
      var j;
      try { j = JSON.parse(body.toString('utf-8')); } catch (e) { finish(new Error('Invalid fingerprint response')); return; }
      if (!j || j.code !== 0 || !j.data || typeof j.data.b_3 !== 'string' || !j.data.b_3) {
        finish(new Error('Fingerprint response has no usable buvid')); return;
      }
      var next = { buvid3: j.data.b_3 };
      if (typeof j.data.b_4 === 'string' && j.data.b_4) next.buvid4 = j.data.b_4;
      (res.headers['set-cookie'] || []).forEach(function (sc) {
        var pair = sc.split(';')[0], eq = pair.indexOf('=');
        if (pair.slice(0, eq).trim() === 'b_nut') next.b_nut = pair.slice(eq + 1).trim();
      });
      var previous = storedCookies;
      storedCookies = {};
      Object.keys(previous).forEach(function (key) { if (!isIdentityCookie(key)) storedCookies[key] = previous[key]; });
      Object.keys(next).forEach(function (key) { storedCookies[key] = next[key]; });
      if (!saveCookies()) { storedCookies = previous; finish(new Error('Could not persist device identity')); return; }
      identityEpoch++;
      finish(null);
    });
  }, 8000);
}
function refreshIdentity(callback) {
  if (identityFlight) { acquireIdentity(callback); return; }
  var now = Date.now();
  if (identityAttempt && now - identityAttempt < IDENTITY_COOLDOWN) {
    callback(new Error('Device identity cooldown; retry after 5 minutes')); return;
  }
  // Persist failed attempts too: restarting the service must not evade cooldown.
  try { fs.writeFileSync(IDENTITY_STATE, JSON.stringify({ attempt: now })); }
  catch (e) { callback(new Error('Could not persist identity cooldown')); return; }
  identityAttempt = now;
  acquireIdentity(callback);
}
function ensureBuvid(attempt) {
  if (storedCookies.buvid3) return;
  acquireIdentity(function (err) {
    if (!err) return;
    console.error('[service] buvid fetch failed:', err.message);
    logSvcErr('buvid', err.message);
    if ((attempt || 0) < 5) setTimeout(function () { ensureBuvid((attempt || 0) + 1); }, 15000);
  });
}
ensureBuvid(0);

function isPlaybackRisk(parsed, method, response) {
  if (parsed.hostname !== 'api.bilibili.com' || (method && method !== 'GET')) return false;
  if (!/^\/(x\/player\/(wbi\/)?playurl|pgc\/player\/web\/playurl)$/.test(parsed.pathname)) return false;
  var j;
  try { j = JSON.parse(response.toString('utf-8')); } catch (e) { return false; }
  if (!j) return false;
  var data = j.data || j.result || {};
  var hasStream = (data.dash && data.dash.video && data.dash.video.length) || (data.durl && data.durl.length);
  return j.code === -351 || j.code === -352 || (j.code === 0 && !!data.v_voucher && !hasStream);
}

function isAllowedHost(host) {
  var allowed = [
    'api.bilibili.com', 'passport.bilibili.com', 'api.live.bilibili.com',
    's.search.bilibili.com', // search suggestions (keyword autocomplete)
    's1.hdslb.com', 'i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com',
    'comment.bilibili.com',
    // Subtitle machine translation (free gtx endpoint). NOT a bilibili host:
    // isBiliHost() below must stay false for it so no cookies leak there.
    'translate.googleapis.com',
    // Update check via the version.json release asset (its download_count is
    // the DAU proxy — owner-approved). Also not bili: no cookies.
    'github.com', 'api.github.com'
  ];
  for (var i = 0; i < allowed.length; i++) {
    if (host === allowed[i]) return true;
  }
  return host.indexOf('.bilivideo.') >= 0 || host.indexOf('.hdslb.com') >= 0 ||
    host.indexOf('.akamaized.net') >= 0 ||
    host.indexOf('.githubusercontent.com') >= 0; // release-asset redirect targets
}

// Bilibili credentials (Cookie) and disguise headers (Referer/Origin) go ONLY
// to the bilibili family — never to third-party hosts like the translator.
function isBiliHost(host) {
  return host.indexOf('bilibili.com') >= 0 || host.indexOf('.hdslb.com') >= 0 ||
    host.indexOf('.bilivideo.') >= 0 || host.indexOf('.akamaized.net') >= 0 ||
    host === 's1.hdslb.com';
}

// Make HTTPS request helper
// forceIdentity: never request gzip/deflate. Required for the binary proxy
// path (segments/images) which pipes bytes raw without forwarding
// Content-Encoding — compressed bytes there corrupt the Range/Content-Length
// and trigger Shaka's "Payload length does not match range requested bytes".
function makeRequest(parsedUrl, method, body, contentType, range, forceIdentity, callback) {
  var generation = cookieGeneration;
  var requestIdentity = identityEpoch;
  var hostname = parsedUrl.hostname;
  var port = parsedUrl.port ? parseInt(parsedUrl.port) : 443;
  var isCDN = hostname.indexOf('bilivideo') >= 0 || hostname.indexOf('akamaized') >= 0;

  var isBili = isBiliHost(hostname);
  var headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': isCDN ? '*/*' : 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Accept-Encoding': (isCDN || forceIdentity) ? 'identity' : 'gzip, deflate'
  };
  if (isBili) {
    headers['Referer'] = biliReferer(hostname, parsedUrl.pathname);
    headers['Cookie'] = serializeCookies(storedCookies);
    if (!isCDN) headers['Origin'] = 'https://www.bilibili.com';
  }
  if (contentType) headers['Content-Type'] = contentType;
  if (range) headers['Range'] = range;

  var options = {
    hostname: hostname, port: port,
    path: parsedUrl.pathname + (parsedUrl.search || ''),
    method: method || 'GET',
    headers: headers,
    rejectUnauthorized: false,
    agent: keepAliveAgent
  };

  return upstreamRequest(https.request.bind(https), options, body, function (err, res) {
    if (err) { logSvcErr('req:' + hostname, err.message); callback(err); return; }
    // Logout invalidates responses already on the wire, including redirects.
    if (generation !== cookieGeneration) {
      res.destroy(); callback(new Error('Account session changed')); return;
    }
    // 上游响应流出错(节点中途掐断)只记日志;调用方通过 pipe 的 close 处理。
    res.on('error', function (e) {
      if (!res.clientCancelled) logSvcErr('res:' + hostname, e && e.message);
    });
    var setCookieHeaders = res.headers['set-cookie'];
    if (isBili && setCookieHeaders) {
      setCookieHeaders.forEach(function (sc) {
        var parts = sc.split(';')[0];
        var eqIdx = parts.indexOf('=');
        if (eqIdx > 0) {
          var key = parts.substring(0, eqIdx).trim();
          if (!isIdentityCookie(key) || requestIdentity === identityEpoch) storedCookies[key] = parts.substring(eqIdx + 1).trim();
        }
      });
      saveCookies();
    }
    callback(null, res);
  }, 10000, function (err) { logSvcErr('retry:' + hostname, err.message); });
}

function getLanIp() {
  var nets = os.networkInterfaces();
  var names = Object.keys(nets);
  for (var i = 0; i < names.length; i++) {
    var rows = nets[names[i]] || [];
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      if (row && row.family === 'IPv4' && !row.internal) return row.address;
    }
  }
  return '127.0.0.1';
}

function getCastFriendlyName() {
  return castConfig.friendlyName || '我的小电视';
}

var castController = new CastController();
var castSubscribers = [];
var pendingCastEvent = null;
var castProfile = deviceProfile.createDeviceProfile({
  uuid: castConfig.uuid,
  friendlyName: getCastFriendlyName(),
  ip: getLanIp(),
  httpPort: 9958,
});

castConfig.uuid = castProfile.uuid;
saveCastConfig();

function notifyCastSubscribers(event) {
  pendingCastEvent = event;
  castSubscribers = castSubscribers.filter(function (message) {
    try {
      message.respond({
        returnValue: true,
        subscribed: true,
        event: event,
        status: castController.getStatus(),
      });
      pendingCastEvent = null;
      return true;
    } catch (e) {
      return false;
    }
  });
}

function launchAppForCast() {
  childProcess.execFile('luna-send-pub', [
    '-n', '1', '-f',
    'luna://com.webos.service.applicationmanager/launch',
    '{"id":"com.biliwebos.app"}'
  ], function (err, stdout, stderr) {
    if (err) {
      console.error('[Cast] launch app failed:', err.message);
      return;
    }
    if (stderr) console.log('[Cast] launch stderr:', stderr.trim());
    if (stdout) console.log('[Cast] launch:', stdout.trim());
  });
}

castController.onIntent(function (intent) {
  launchAppForCast();
  notifyCastSubscribers({ kind: 'command', command: intent });
});

var castLanServer = new CastLanServer({
  profile: castProfile,
  controller: castController,
  onFrame: function (session, frame) {
    if (frame.action === 'GetVolume') {
      session.sendReply({ volume: 30 });
      return;
    }
    if (frame.type !== 'command') return;

    var intent = castController.handleCommand(session.id, frame.action, frame.body);
    if (frame.action === 'PlayUrl' && !intent) {
      session.sendReply({ accepted: false, reason: 'unsupported-playurl' });
      return;
    }
    session.sendEmpty();
  },
});

castController.setNetworkInfo(castProfile.ip, castProfile.httpPort);

// Follow up to 3 redirects (GitHub release assets 302 to githubusercontent).
// Every hop's host must pass the same allowlist. Node 8: no arrow functions.
function requestFollow(parsedUrl, method, body, contentType, range, hops, callback) {
  makeRequest(parsedUrl, method, body, contentType, range, false, function (err, res) {
    if (err) { callback(err); return; }
    var loc = res.headers && res.headers.location;
    if (loc && res.statusCode >= 300 && res.statusCode < 400 && hops < 3) {
      if (res.resume) res.resume(); // discard the redirect body
      var NodeURL = require('url').URL;
      var next;
      try { next = new NodeURL(loc, parsedUrl.href); } catch (e) { callback(new Error('Bad redirect')); return; }
      if (!isAllowedHost(next.hostname)) { callback(new Error('Redirect host not allowed')); return; }
      requestFollow(next, 'GET', null, null, range, hops + 1, callback);
      return;
    }
    callback(null, res);
  });
}

// ==================== Luna Bus Methods ====================

service.register('fetch', function (message) {
  var generation = cookieGeneration;
  var targetUrl = message.payload.url;
  if (!targetUrl) { message.respond({ returnValue: false, error: 'No URL' }); return; }

  var parsed;
  try { parsed = new URL(targetUrl); } catch (e) {
    logSvcErr('fetch-url', (e && e.message) + ' :: ' + String(targetUrl).slice(0, 80));
    message.respond({ returnValue: false, error: 'Invalid URL: ' + (e && e.message) }); return;
  }
  if (!isAllowedHost(parsed.hostname)) {
    message.respond({ returnValue: false, error: 'Host not allowed' }); return;
  }

  var diagnostic = playbackDiagnostics.begin(parsed, message.payload.diagnostic === true);
  function request(retried) {
    var started = Date.now();
    var requestIdentity = identityEpoch;
    requestFollow(parsed, message.payload.method, message.payload.body,
      message.payload.contentType, message.payload.range, 0, function (err, res) {
        if (err) { playbackDiagnostics.response(diagnostic, null, null, err, started); message.respond({ returnValue: false, error: err.message }); return; }

        decompressResponse(res, function (bodyError, data) {
          playbackDiagnostics.response(diagnostic, res.statusCode, data, bodyError, started);
          if (generation !== cookieGeneration) {
            playbackDiagnostics.recovery(diagnostic, 'session_changed');
            message.respond({ returnValue: false, error: 'Account session changed' }); return;
          }
          if (bodyError) {
            logSvcErr('body:' + parsed.hostname, bodyError.message);
            message.respond({ returnValue: false, error: bodyError.message });
            return;
          }
          if (!retried && res.statusCode === 200 && isPlaybackRisk(parsed, message.payload.method, data)) {
            playbackDiagnostics.recovery(diagnostic, 'pending');
            function recovered(err) {
              playbackDiagnostics.recovery(diagnostic, 'retried', err);
              if (generation !== cookieGeneration) { playbackDiagnostics.recovery(diagnostic, 'session_changed'); message.respond({ returnValue: false, error: 'Account session changed' }); return; }
              if (!err) { request(true); return; }
              logSvcErr('identity-recovery', err.message);
              respond();
            }
            if (requestIdentity !== identityEpoch) recovered(null);
            else refreshIdentity(recovered);
            return;
          }
          respond();
          function respond() {
            var ct = res.headers['content-type'] || '';
            if (ct.indexOf('json') >= 0 || ct.indexOf('text') >= 0 || ct.indexOf('xml') >= 0) {
              message.respond({
                returnValue: true, status: res.statusCode, contentType: ct,
                body: data.toString('utf-8'),
                newCookies: storedCookies
              });
            } else {
              message.respond({
                returnValue: true, status: res.statusCode, contentType: ct,
                bodyBase64: data.toString('base64'), bodyLength: data.length
              });
            }
          }
        });
      });
  }
  request(false);
});

service.register('ensureDeviceIdentity', function (message) {
  if (storedCookies.buvid3) { message.respond({ returnValue: true, cookies: storedCookies }); return; }
  acquireIdentity(function (err) {
    message.respond(err ? { returnValue: false, error: err.message } : { returnValue: true, cookies: storedCookies });
  });
});

service.register('resetDeviceIdentity', function (message) {
  refreshIdentity(function (err) {
    message.respond(err ? { returnValue: false, error: err.message } : { returnValue: true, cookies: storedCookies });
  });
});

service.register('getCookies', function (message) {
  message.respond({ returnValue: true, cookies: storedCookies });
});

service.register('setCookies', function (message) {
  var c = message.payload.cookies || {};
  if (c.SESSDATA && c.SESSDATA !== storedCookies.SESSDATA) cookieGeneration++;
  if (Object.keys(c).some(function (key) { return isIdentityCookie(key) && c[key] !== storedCookies[key]; })) identityEpoch++;
  Object.keys(c).forEach(function (k) { storedCookies[k] = c[k]; });
  saveCookies();
  message.respond({ returnValue: true });
});

service.register('clearCookies', function (message) {
  cookieGeneration++;
  // Keep anonymous risk-control fingerprints; remove ALL account cookies.
  var anonymous = {};
  ['buvid3', 'buvid4', 'b_nut'].forEach(function (key) {
    if (storedCookies[key]) anonymous[key] = storedCookies[key];
  });
  storedCookies = anonymous;
  if (!saveCookies()) {
    message.respond({ returnValue: false, error: 'Could not persist logout' }); return;
  }
  message.respond({ returnValue: true });
});

// ==================== Live danmaku relay ====================
var danmakuSubscribers = [];
var danmakuStop = null;
var danmakuRoom = null;

// Luna cancellation can deliver another Message wrapper for the same request.
// Match its stable token, with identity fallback for local development bridges.
function removeSubscription(messages, cancelled) {
  return messages.filter(function (message) {
    return message !== cancelled && !(cancelled.uniqueToken != null && message.uniqueToken === cancelled.uniqueToken);
  });
}

// text = chat line (null for non-danmaku events); evt = typed event object.
// Both ride the same subscription: `danmaku` keeps the old contract, `event`
// is additive so older app builds simply ignore it.
function broadcastDanmaku(text, evt) {
  danmakuSubscribers = danmakuSubscribers.filter(function (m) {
    try {
      m.respond({ returnValue: true, subscribed: true, danmaku: text, event: evt || null });
      return true;
    } catch (e) { return false; }
  });
  if (danmakuSubscribers.length === 0 && danmakuStop) {
    danmakuStop(); danmakuStop = null; danmakuRoom = null;
  }
}

service.register('danmakuSubscribe', function (message) {
  var p = message.payload || {};
  danmakuSubscribers.push(message);
  // Reconnect if the room changed.
  if (danmakuStop && danmakuRoom !== p.roomid) { danmakuStop(); danmakuStop = null; danmakuRoom = null; }
  if (danmakuRelay && !danmakuStop && p.roomid && p.token) {
    danmakuRoom = p.roomid;
    var dedeUid = parseInt(storedCookies['DedeUserID'] || '0', 10) || 0;
    danmakuStop = danmakuRelay.connectDanmaku({
      host: p.host, port: p.port, roomid: p.roomid, token: p.token,
      buvid: storedCookies.buvid3 || p.buvid, uid: dedeUid, cookie: serializeCookies(storedCookies),
    }, broadcastDanmaku);
  }
  message.respond({ returnValue: true, subscribed: true });
}, function (message) {
  danmakuSubscribers = removeSubscription(danmakuSubscribers, message);
  if (danmakuSubscribers.length === 0 && danmakuStop) {
    danmakuStop(); danmakuStop = null; danmakuRoom = null;
  }
});

service.register('danmakuStop', function (message) {
  if (danmakuStop) { danmakuStop(); danmakuStop = null; }
  danmakuRoom = null;
  danmakuSubscribers = [];
  message.respond({ returnValue: true });
});

service.register('ping', function (message) {
  function respond() {
  message.respond({
    returnValue: true, status: 'ok',
    cookieKeys: Object.keys(storedCookies),
    nodeVersion: process.version,
    localProxyPort: LOCAL_PROXY_PORT,
    castHttpPort: castProfile.httpPort,
    castFriendlyName: getCastFriendlyName(),
  });
  }
  // Luna can arrive before the initial bind or EADDRINUSE fallback completes.
  if (localProxyReady) { respond(); return; }
  var timer = setTimeout(function () {
    localServer.removeListener('listening', ready);
    message.respond({ returnValue: false, error: 'Local proxy is not ready' });
  }, 2000);
  function ready() { clearTimeout(timer); respond(); }
  localServer.once('listening', ready);
});

// One call = everything the 网络诊断 page needs to describe this service's
// health, including the recent failure ring (invisible any other way on a
// user's TV).
service.register('getDiagnostics', function (message) {
  var danmakuState = danmakuStop && typeof danmakuStop.getState === 'function' ? danmakuStop.getState() : null;
  message.respond({
    returnValue: true,
    nodeVersion: process.version,
    uptimeSec: Math.floor(process.uptime()),
    buvid: !!storedCookies['buvid3'],
    loggedIn: !!storedCookies['SESSDATA'],
    cookieKeys: Object.keys(storedCookies),
    danmakuModule: !!danmakuRelay,
    danmakuSubscribers: danmakuSubscribers.length,
    danmakuActive: danmakuState ? danmakuState.connected : !!danmakuStop,
    danmakuState: danmakuState,
    castSubscribers: castSubscribers.length,
    localProxyPort: LOCAL_PROXY_PORT,
    recentErrors: recentErrors,
    playback: playbackDiagnostics.snapshot(),
    identity: { pending: !!identityFlight, cooldownSec: Math.max(0, Math.min(300, Math.ceil((identityAttempt + IDENTITY_COOLDOWN - Date.now()) / 1000))) },
  });
});

service.register('castSubscribe', function (message) {
  if (message.isSubscription || message.payload.subscribe) {
    castSubscribers.push(message);
    message.respond({
      returnValue: true,
      subscribed: true,
      event: pendingCastEvent || { kind: 'ready' },
      status: castController.getStatus(),
    });
    if (pendingCastEvent && pendingCastEvent.kind === 'command') pendingCastEvent = null;
    return;
  }
  message.respond({
    returnValue: true,
    subscribed: false,
    status: castController.getStatus(),
  });
}, function (message) {
  castSubscribers = removeSubscription(castSubscribers, message);
});

service.register('castAck', function (message) {
  castController.ack(message.payload || {});
  message.respond({ returnValue: true, status: castController.getStatus() });
});

service.register('castReportState', function (message) {
  castController.reportState(message.payload || {});
  notifyCastSubscribers({ kind: 'state', payload: message.payload || {} });
  message.respond({ returnValue: true });
});

service.register('castReportProgress', function (message) {
  castController.reportProgress(message.payload || {});
  message.respond({ returnValue: true });
});

service.register('castGetStatus', function (message) {
  message.respond({ returnValue: true, status: castController.getStatus() });
});

service.register('castSetConfig', function (message) {
  if (message.payload && message.payload.friendlyName) {
    castConfig.friendlyName = String(message.payload.friendlyName).slice(0, 64);
    saveCastConfig();
  }
  message.respond({ returnValue: true, config: castConfig });
});

// ==================== Local HTTP Proxy ====================
// For video segments, images, and HLS streams that browser fetches directly

var LOCAL_PROXY_PORT = 7654;
var localProxyReady = false;

var localServer = http.createServer(function (req, res) {
  // 客户端(电视浏览器)中途断开是常态(换视频、拖进度条、诊断探针主动 abort),
  // 两头的 socket 都得挂上 error 处理,否则一个 ECONNRESET 就是未处理异常。
  req.on('error', function () { });
  res.on('error', function () { });
  // URL format: /proxy/{host}/{path}
  var reqPath = req.url;
  if (!reqPath.startsWith('/proxy/')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  var targetPath = reqPath.slice(7);
  var slashIdx = targetPath.indexOf('/');
  var hostWithPort = slashIdx > 0 ? targetPath.slice(0, slashIdx) : targetPath;
  var apiPath = slashIdx > 0 ? targetPath.slice(slashIdx) : '/';

  var hostParts = hostWithPort.split(':');
  var hostname = hostParts[0];

  if (!isAllowedHost(hostname)) {
    res.writeHead(403);
    res.end('Host not allowed');
    return;
  }

  var parsed;
  try {
    parsed = new URL('https://' + hostWithPort + apiPath);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad URL');
    return;
  }

  var upstream = makeRequest(parsed, req.method, null, null, req.headers['range'], true, function (err, proxyRes) {
    if (err) {
      logSvcErr('proxy:' + hostname, err.message);
      // 带 CORS 头:没有它页面看到的是 CORS 错而不是 502,Shaka 分不清是
      // 节点挂了还是别的,CDN 失败转移的判断也就没依据(#29)。
      if (!res.headersSent) { res.writeHead(502, { 'Access-Control-Allow-Origin': '*' }); res.end(err.message); }
      return;
    }

    var responseHeaders = {
      'Access-Control-Allow-Origin': '*',
      // 允许页面读到细分计时(排队/连接/TTFB/下载)。没有这一行时
      // PerformanceResourceTiming 只给一个 duration,定位不了瓶颈在哪一段。
      'Timing-Allow-Origin': '*',
      // 让页面读得到 Content-Range(诊断里的 CDN 测速要知道文件总长才能选偏移)。
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length',
      'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
    };
    if (proxyRes.headers['content-range']) responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
    if (proxyRes.headers['content-length']) responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
    if (proxyRes.headers['accept-ranges']) responseHeaders['Accept-Ranges'] = proxyRes.headers['accept-ranges'];

    // 缓存头必须透传。之前这里把上游的 cache-control/etag/last-modified 全丢了,
    // 浏览器于是**一次都不缓存** —— 往回滚重下、预取下来的图真正要显示时再下
    // 一遍(等于预取白做)。2026-08-31 真机实测缩略图 p50 462ms,大头就在这。
    // 封面/图片是按 URL 内容寻址的(@420w_263h_1c.webp),内容不会变,可以放心
    // 长缓存;上游没给策略时兜底一天。
    var ct = proxyRes.headers['content-type'] || '';
    if (proxyRes.headers['cache-control']) responseHeaders['Cache-Control'] = proxyRes.headers['cache-control'];
    else if (ct.indexOf('image/') === 0) responseHeaders['Cache-Control'] = 'public, max-age=86400';
    if (proxyRes.headers['etag']) responseHeaders['ETag'] = proxyRes.headers['etag'];
    if (proxyRes.headers['last-modified']) responseHeaders['Last-Modified'] = proxyRes.headers['last-modified'];
    if (proxyRes.headers['expires']) responseHeaders['Expires'] = proxyRes.headers['expires'];

    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);

    // If the upstream errors/truncates mid-stream, tear down the client
    // response (a half-delivered segment is what Shaka chokes on); if the
    // client disconnects, free the upstream socket.
    proxyRes.on('error', function () { res.destroy(); });
    res.on('close', function () { proxyRes.clientCancelled = true; proxyRes.destroy(); });
  });
  // Close before upstream headers (e.g. cancelled range probe) must also free
  // its DNS/connection-pool slot, not wait for a response that may never come.
  res.on('close', function () { upstream.cancel(); });
});

localServer.on('listening', function () { localProxyReady = true; });
localServer.on('close', function () { localProxyReady = false; });
localServer.on('clientError', function (err, socket) {
  try { socket.destroy(); } catch (e) { }
});
localServer.on('error', function (err) {
  console.error('[LocalProxy] Error:', err.message);
  // Try next port
  if (err.code === 'EADDRINUSE') {
    LOCAL_PROXY_PORT++;
    localServer.listen(LOCAL_PROXY_PORT, '127.0.0.1');
  }
});

localServer.listen(LOCAL_PROXY_PORT, '127.0.0.1', function () {
  console.log('[BiliService] Local proxy on port ' + LOCAL_PROXY_PORT);
});

castLanServer.start(function () {
  castProfile.ip = getLanIp();
  castController.setNetworkInfo(castProfile.ip, castProfile.httpPort);
  console.log('[BiliService] Cast server on ' + castProfile.ip + ':' + castProfile.httpPort);
});

// Keep service alive
var keepAlive;
service.activityManager.create('keepAlive', function (activity) {
  keepAlive = activity;
});
