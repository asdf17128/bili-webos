// Bilibili API proxy service for webOS TV
// Runs as background Node.js service, communicates via Luna bus
// Also starts a local HTTP proxy for video segments and images
// Node.js v16.19.1 on webOS TV 24

var Service = require('webos-service');
var https = require('https');
var http = require('http');
var zlib = require('zlib');
var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');
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

// Reuse TLS connections to CDN hosts. The TV's CPU makes a fresh TLS handshake
// per segment expensive; keep-alive cuts initial-load and seek latency a lot.
var keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 8, keepAliveMsecs: 15000 });

// Cookie storage
var COOKIE_FILE = path.join('/media/internal', 'bili_cookies.json');
var storedCookies = {};
try {
  if (fs.existsSync(COOKIE_FILE)) {
    storedCookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
  }
} catch (e) { }

function saveCookies() {
  try { fs.writeFileSync(COOKIE_FILE, JSON.stringify(storedCookies)); } catch (e) { }
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

// Bootstrap the buvid3/buvid4 browser-fingerprint cookies for ANONYMOUS use.
// B站's risk control rejects fingerprint-less API calls with -352 (and serves
// an HTML block page on some feed endpoints) — mainly hitting overseas IPs,
// where it made the whole app look like "nothing loads" (#10). Fetch them once
// from finger/spi and persist alongside the login cookies. Verified via an
// overseas (HK) exit: /x/web-interface/popular flips -352 → 0 with these set.
function ensureBuvid(attempt) {
  if (storedCookies['buvid3']) return;
  var req = https.request({
    hostname: 'api.bilibili.com', port: 443, path: '/x/frontend/finger/spi', method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/'
    },
    rejectUnauthorized: false
  }, function (res) {
    var chunks = [];
    res.on('data', function (c) { chunks.push(c); });
    res.on('end', function () {
      try {
        var j = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        if (j.code === 0 && j.data && j.data.b_3) {
          storedCookies['buvid3'] = j.data.b_3;
          if (j.data.b_4) storedCookies['buvid4'] = j.data.b_4;
          if (!storedCookies['b_nut']) storedCookies['b_nut'] = String(Math.floor(Date.now() / 1000));
          saveCookies();
          console.log('[service] buvid bootstrapped');
        }
      } catch (e) { console.error('[service] buvid parse failed:', e.message); }
    });
  });
  req.on('error', function (e) {
    console.error('[service] buvid fetch failed:', e.message);
    logSvcErr('buvid', e.message);
    // Retry a few times with backoff — the TV's network may come up after us.
    if ((attempt || 0) < 5) setTimeout(function () { ensureBuvid((attempt || 0) + 1); }, 15000);
  });
  req.end();
}
ensureBuvid(0);

function isAllowedHost(host) {
  var allowed = [
    'api.bilibili.com', 'passport.bilibili.com', 'api.live.bilibili.com',
    's1.hdslb.com', 'i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com',
    'comment.bilibili.com'
  ];
  for (var i = 0; i < allowed.length; i++) {
    if (host === allowed[i]) return true;
  }
  return host.indexOf('.bilivideo.') >= 0 || host.indexOf('.hdslb.com') >= 0 ||
    host.indexOf('.akamaized.net') >= 0;
}

// Make HTTPS request helper
// forceIdentity: never request gzip/deflate. Required for the binary proxy
// path (segments/images) which pipes bytes raw without forwarding
// Content-Encoding — compressed bytes there corrupt the Range/Content-Length
// and trigger Shaka's "Payload length does not match range requested bytes".
function makeRequest(parsedUrl, method, body, contentType, range, forceIdentity, callback) {
  var hostname = parsedUrl.hostname;
  var port = parsedUrl.port ? parseInt(parsedUrl.port) : 443;
  var isCDN = hostname.indexOf('bilivideo') >= 0 || hostname.indexOf('akamaized') >= 0;

  var headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/',
    'Accept': isCDN ? '*/*' : 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Accept-Encoding': (isCDN || forceIdentity) ? 'identity' : 'gzip, deflate',
    'Cookie': serializeCookies(storedCookies)
  };
  if (!isCDN) headers['Origin'] = 'https://www.bilibili.com';
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

  var done = false;
  var req = https.request(options, function (res) {
    if (done) return;
    done = true;
    var setCookieHeaders = res.headers['set-cookie'];
    if (setCookieHeaders) {
      setCookieHeaders.forEach(function (sc) {
        var parts = sc.split(';')[0];
        var eqIdx = parts.indexOf('=');
        if (eqIdx > 0) {
          storedCookies[parts.substring(0, eqIdx).trim()] = parts.substring(eqIdx + 1).trim();
        }
      });
      saveCookies();
    }
    callback(null, res);
  });

  // Without a timeout a stuck CDN socket hangs forever and the segment never
  // returns, freezing playback permanently. Bail out so the caller can fail
  // the request and Shaka can retry.
  req.setTimeout(10000, function () { req.destroy(new Error('Upstream timeout')); });
  req.on('error', function (err) {
    if (done) return; done = true;
    logSvcErr('req:' + hostname, err.message);
    callback(err);
  });
  if (body) req.write(body);
  req.end();
}

// Decompress response
function decompressResponse(res, callback) {
  var chunks = [];
  res.on('data', function (c) { chunks.push(c); });
  res.on('end', function () {
    var buf = Buffer.concat(chunks);
    var encoding = res.headers['content-encoding'];
    if (encoding === 'gzip') {
      zlib.gunzip(buf, function (err, r) { callback(err ? buf : r); });
    } else if (encoding === 'deflate') {
      zlib.inflate(buf, function (err, r) {
        if (!err) { callback(r); return; }
        zlib.inflateRaw(buf, function (err2, r2) { callback(err2 ? buf : r2); });
      });
    } else {
      callback(buf);
    }
  });
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

// ==================== Luna Bus Methods ====================

service.register('fetch', function (message) {
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

  makeRequest(parsed, message.payload.method, message.payload.body,
    message.payload.contentType, message.payload.range, false, function (err, res) {
      if (err) { message.respond({ returnValue: false, error: err.message }); return; }

      decompressResponse(res, function (data) {
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
      });
    });
});

service.register('getCookies', function (message) {
  message.respond({ returnValue: true, cookies: storedCookies });
});

service.register('setCookies', function (message) {
  var c = message.payload.cookies || {};
  Object.keys(c).forEach(function (k) { storedCookies[k] = c[k]; });
  saveCookies();
  message.respond({ returnValue: true });
});

service.register('clearCookies', function (message) {
  storedCookies = {};
  saveCookies();
  message.respond({ returnValue: true });
});

// ==================== Live danmaku relay ====================
var danmakuSubscribers = [];
var danmakuStop = null;
var danmakuRoom = null;

function broadcastDanmaku(text) {
  danmakuSubscribers = danmakuSubscribers.filter(function (m) {
    try { m.respond({ returnValue: true, subscribed: true, danmaku: text }); return true; }
    catch (e) { return false; }
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
      buvid: p.buvid, uid: dedeUid, cookie: serializeCookies(storedCookies),
    }, broadcastDanmaku);
  }
  message.respond({ returnValue: true, subscribed: true });
});

service.register('danmakuStop', function (message) {
  if (danmakuStop) { danmakuStop(); danmakuStop = null; }
  danmakuRoom = null;
  danmakuSubscribers = [];
  message.respond({ returnValue: true });
});

service.register('ping', function (message) {
  message.respond({
    returnValue: true, status: 'ok',
    cookieKeys: Object.keys(storedCookies),
    nodeVersion: process.version,
    localProxyPort: LOCAL_PROXY_PORT,
    castHttpPort: castProfile.httpPort,
    castFriendlyName: getCastFriendlyName(),
  });
});

// One call = everything the 网络诊断 page needs to describe this service's
// health, including the recent failure ring (invisible any other way on a
// user's TV).
service.register('getDiagnostics', function (message) {
  message.respond({
    returnValue: true,
    nodeVersion: process.version,
    uptimeSec: Math.floor(process.uptime()),
    buvid: !!storedCookies['buvid3'],
    loggedIn: !!storedCookies['SESSDATA'],
    cookieKeys: Object.keys(storedCookies),
    danmakuModule: !!danmakuRelay,
    localProxyPort: LOCAL_PROXY_PORT,
    recentErrors: recentErrors,
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

var localServer = http.createServer(function (req, res) {
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

  makeRequest(parsed, req.method, null, null, req.headers['range'], true, function (err, proxyRes) {
    if (err) {
      logSvcErr('proxy:' + hostname, err.message);
      if (!res.headersSent) { res.writeHead(502); res.end(err.message); }
      return;
    }

    var responseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
    };
    if (proxyRes.headers['content-range']) responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
    if (proxyRes.headers['content-length']) responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
    if (proxyRes.headers['accept-ranges']) responseHeaders['Accept-Ranges'] = proxyRes.headers['accept-ranges'];

    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);

    // If the upstream errors/truncates mid-stream, tear down the client
    // response (a half-delivered segment is what Shaka chokes on); if the
    // client disconnects, free the upstream socket.
    proxyRes.on('error', function () { res.destroy(); });
    res.on('close', function () { proxyRes.destroy(); });
  });
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
