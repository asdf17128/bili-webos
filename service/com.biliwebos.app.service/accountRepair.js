'use strict';

// A manual, single-request identity update. No activation, risk retry, account
// credentials, or generated identifiers enter this path. ES5 / Node 0.12 safe.
var COOLDOWN_MS = 600000;
var TIMEOUT_MS = 7500;
var MAX_BODY = 65536;
var ERRORS = {
  CONFIRM_REQUIRED: 'Device identity repair requires confirmation',
  BUSY: 'Device identity repair is already running',
  COOLDOWN: 'Device identity repair is cooling down',
  SESSION_CHANGED: 'Account session changed during device identity repair',
  REQUEST_FAILED: 'Device identity request failed',
  REQUEST_TIMEOUT: 'Device identity request timed out',
  INVALID_RESPONSE: 'Device identity response was invalid',
  IDENTITY_UNCHANGED: 'Device identity did not change',
  PERSISTENCE_FAILED: 'Could not persist device identity'
};

function identityToken(value) {
  return typeof value === 'string' && value.length <= 256 && /^[A-Za-z0-9_+/-]{16,256}={0,2}$/.test(value);
}
function nutToken(value) {
  return typeof value === 'string' && /^[0-9]{1,16}$/.test(value);
}
function responseNut(headers, currentTime) {
  var values = headers && headers['set-cookie'];
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) return null;
  var result;
  for (var i = 0; i < values.length; i++) {
    if (typeof values[i] !== 'string') continue;
    var parts = values[i].split(';');
    var pair = /^b_nut=([^;]*)$/.exec(parts[0].trim());
    if (!pair) continue;
    if (result !== undefined || !nutToken(pair[1])) return null;
    for (var j = 1; j < parts.length; j++) {
      var attribute = parts[j].trim();
      if (/^domain\s*=/i.test(attribute) && !/^domain\s*=\s*\.?((api\.)?bilibili\.com)$/i.test(attribute)) return null;
      if (/^path\s*=/i.test(attribute) && !/^path\s*=\s*\/$/i.test(attribute)) return null;
      if (/^max-age\s*=/i.test(attribute) && !/^max-age\s*=\s*[1-9][0-9]*$/i.test(attribute)) return null;
      if (/^expires\s*=/i.test(attribute)) {
        var expiry = Date.parse(attribute.replace(/^expires\s*=\s*/i, ''));
        if (!isFinite(expiry) || expiry <= currentTime) return null;
      }
    }
    result = pair[1];
  }
  return result;
}

function createAccountRepair(options) {
  var now = options.now || Date.now;
  var cooldownMs = options.cooldownMs || COOLDOWN_MS;
  var schedule = options.setTimeout || setTimeout;
  var cancel = options.clearTimeout || clearTimeout;
  var busy = false, lastAttempt = null, serial = 0;

  function remaining() {
    if (lastAttempt === null) return 0;
    // A backwards clock must not bypass the process-local limit.
    var elapsed = Math.max(0, now() - lastAttempt);
    return Math.max(0, Math.ceil((cooldownMs - elapsed) / 1000));
  }
  function failure(code) {
    var result = { returnValue: false, errorCode: code, error: ERRORS[code] };
    if (remaining()) result.retryAfterSeconds = remaining();
    return result;
  }
  function status() {
    var cookies = options.getCookies();
    return { returnValue: true, supported: true,
      hasDeviceIdentity: identityToken(cookies.buvid3) && identityToken(cookies.buvid4) && (cookies.b_nut === undefined || nutToken(cookies.b_nut)),
      hasAccount: !!cookies.SESSDATA, busy: busy, retryAfterSeconds: remaining() };
  }
  function persist(candidate) {
    var temporary = options.cookieFile + '.repair-' + String(now()) + '-' + String(++serial) + '.tmp';
    var fd = null, created = false;
    try {
      fd = options.fs.openSync(temporary, 'wx', 384); // 0600, never reuse a file
      created = true;
      // Node 0.12 writeFileSync accepts paths only, unlike modern Node.
      var serialized = JSON.stringify(candidate);
      var bytes = typeof Buffer.from === 'function' ? Buffer.from(serialized, 'utf8') : new Buffer(serialized, 'utf8');
      var offset = 0;
      while (offset < bytes.length) {
        var written = options.fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!(written > 0)) throw new Error('Incomplete identity persistence');
        offset += written;
      }
      options.fs.fsyncSync(fd);
      options.fs.closeSync(fd); fd = null;
      options.fs.renameSync(temporary, options.cookieFile);
      // Rename is the commit point. Nothing fallible may follow it.
      return true;
    } catch (error) {
      if (fd !== null) { try { options.fs.closeSync(fd); } catch (ignored) {} }
      if (created) { try { options.fs.unlinkSync(temporary); } catch (ignored2) {} }
      return false;
    }
  }
  function repair(payload, callback) {
    if (!payload || payload.confirm !== true) { callback(failure('CONFIRM_REQUIRED')); return; }
    if (busy) { callback(failure('BUSY')); return; }
    if (remaining()) { callback(failure('COOLDOWN')); return; }
    busy = true; lastAttempt = now();
    options.advanceGeneration();
    var generation = options.getGeneration();
    var original = options.getCookies();
    var session = original.SESSDATA, account = original.DedeUserID;
    var old3 = original.buvid3, old4 = original.buvid4;
    var settled = false, request = null, response = null, timer;
    function current() {
      var cookies = options.getCookies();
      return generation === options.getGeneration() && cookies.SESSDATA === session && cookies.DedeUserID === account;
    }
    function finish(code) {
      if (settled) return;
      settled = true; cancel(timer);
      // Also fence requests/bootstrap work dispatched during the operation.
      options.advanceGeneration(); busy = false;
      if (code) {
        try { if (response) response.destroy(); } catch (ignored) {}
        try { if (request) request.abort(); } catch (ignored2) {}
      }
      callback(code ? failure(code) : { returnValue: true, changed: true, accountPreserved: true });
    }
    timer = schedule(function () { finish(current() ? 'REQUEST_TIMEOUT' : 'SESSION_CHANGED'); }, TIMEOUT_MS);
    try {
      request = options.https.request({
        hostname: 'api.bilibili.com', port: 443, path: '/x/frontend/finger/spi', method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.bilibili.com/', 'Accept': 'application/json', 'Accept-Encoding': 'identity' },
        // Use a fresh TLS connection, never a socket from the ordinary proxy's
        // permissive TLS pool (especially on legacy Agent implementations).
        rejectUnauthorized: true, agent: false
      }, function (res) {
        response = res;
        if (settled) { try { res.destroy(); } catch (ignored) {} return; }
        if (!current()) { finish('SESSION_CHANGED'); return; }
        if (res.statusCode !== 200 || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) {
          finish('INVALID_RESPONSE'); return;
        }
        var chunks = [], size = 0, ended = false;
        res.on('data', function (chunk) {
          if (settled) return;
          size += chunk.length;
          if (size > MAX_BODY) { finish('INVALID_RESPONSE'); return; }
          chunks.push(chunk);
        });
        res.on('error', function () { finish(current() ? 'REQUEST_FAILED' : 'SESSION_CHANGED'); });
        res.on('aborted', function () { finish(current() ? 'REQUEST_FAILED' : 'SESSION_CHANGED'); });
        res.on('close', function () { if (!ended) finish(current() ? 'REQUEST_FAILED' : 'SESSION_CHANGED'); });
        res.on('end', function () {
          ended = true;
          if (settled) return;
          if (!current()) { finish('SESSION_CHANGED'); return; }
          var body;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch (error) { finish('INVALID_RESPONSE'); return; }
          var data = body && body.data, nut = responseNut(res.headers, now());
          if (!body || body.code !== 0 || !data || !identityToken(data.b_3) || !identityToken(data.b_4) || nut === null) {
            finish('INVALID_RESPONSE'); return;
          }
          if (data.b_3 === old3 || data.b_4 === old4) { finish('IDENTITY_UNCHANGED'); return; }
          var candidate = {}, cookies = options.getCookies();
          Object.keys(cookies).forEach(function (key) { candidate[key] = cookies[key]; });
          candidate.buvid3 = data.b_3; candidate.buvid4 = data.b_4;
          // SPI may omit Set-Cookie entirely. Do not invent b_nut or carry a
          // stale value across identities; match automatic recovery semantics.
          delete candidate.b_nut;
          delete candidate._uuid; // A replacement identity needs its own activation UUID.
          if (nut !== undefined) candidate.b_nut = nut;
          if (!persist(candidate)) { finish('PERSISTENCE_FAILED'); return; }
          options.setCookies(candidate);
          finish(null);
        });
      });
      request.on('error', function () { finish(current() ? 'REQUEST_FAILED' : 'SESSION_CHANGED'); });
      request.end();
    } catch (error) { finish(current() ? 'REQUEST_FAILED' : 'SESSION_CHANGED'); }
  }
  return { status: status, repair: repair };
}

module.exports = { createAccountRepair: createAccountRepair };
