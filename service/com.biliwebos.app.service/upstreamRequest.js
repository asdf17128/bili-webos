'use strict';
var requestDeadline = require('./requestDeadline');

// A peer can close an idle pooled socket just as it is reused. Retry a read
// once on a fresh connection, within the original deadline. Never replay a
// write, an HTTP response, or a partially received response body.
module.exports = function upstreamRequest(request, options, body, callback, timeoutMs, onRetry) {
  var endAt = Date.now() + timeoutMs;
  var current, cancelled = false, finished = false, retried = false;
  var method = String(options.method || 'GET').toUpperCase();
  function start(fresh) {
    var opts = {};
    Object.keys(options).forEach(function (key) { opts[key] = options[key]; });
    if (fresh) opts.agent = false;
    var guard;
    var req = request(opts, function (res) {
      if (cancelled || finished || !guard.headers()) { res.destroy(); return; }
      finished = true;
      callback(null, res);
    });
    guard = requestDeadline(req, function (err) {
      if (cancelled || finished) return;
      if (!retried && !body && (method === 'GET' || method === 'HEAD') &&
          (err.code === 'ECONNRESET' || err.code === 'EPIPE') && Date.now() < endAt) {
        retried = true;
        if (onRetry) onRetry(err);
        start(true);
        return;
      }
      finished = true;
      callback(err);
    }, Math.max(1, endAt - Date.now()), timeoutMs);
    current = guard;
    if (body) req.write(body);
    req.end();
  }
  start(false);
  return { cancel: function () { cancelled = true; current.cancel(); } };
};
