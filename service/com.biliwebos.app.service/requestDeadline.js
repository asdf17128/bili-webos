'use strict';

// ClientRequest.setTimeout only covers an assigned socket. DNS lookup and
// Agent queueing also need a deadline, or abandoned requests accumulate.
module.exports = function requestDeadline(req, onError, timeoutMs, socketTimeoutMs) {
  var settled = false;
  var timer = setTimeout(function () { fail('Upstream timeout before response headers'); }, timeoutMs);
  function finish(err) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    onError(err);
  }
  function fail(message) {
    var err = new Error(message);
    err.code = 'ETIMEDOUT';
    // Old Node versions do not reliably emit the supplied destroy(error).
    // Settle explicitly, then release the pending request/socket.
    finish(err);
    req.destroy(err);
  }
  req.on('error', finish);
  req.setTimeout(socketTimeoutMs || timeoutMs, function () { fail('Upstream socket timeout'); });
  return {
    headers: function () {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      return true;
    },
    cancel: function () {
      // After headers, the caller owns the response stream. In particular,
      // normal completion must not destroy a socket returned to the pool.
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
    }
  };
};
