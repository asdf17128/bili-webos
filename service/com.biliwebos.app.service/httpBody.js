// Collect API bodies. A closed/truncated stream must settle the Luna request,
// just like a normal end or a connection error before headers does.
var zlib = require('zlib');
module.exports = function readBody(res, callback) {
  var chunks = [], ended = false, settled = false;
  function finish(err, data) {
    if (settled) return;
    settled = true;
    callback(err, data);
  }
  res.on('error', function (err) { finish(err); });
  res.on('aborted', function () { finish(new Error('Upstream response aborted')); });
  res.on('close', function () {
    if (!ended) finish(new Error('Upstream response closed before completion'));
  });
  res.on('data', function (chunk) { if (!settled) chunks.push(chunk); });
  res.on('end', function () {
    ended = true;
    if (settled) return;
    var body = Buffer.concat(chunks);
    chunks = [];
    var encoding = res.headers['content-encoding'];
    if (encoding === 'gzip') zlib.gunzip(body, finish);
    else if (encoding === 'deflate') {
      zlib.inflate(body, function (err, data) {
        if (!err) { finish(null, data); return; }
        zlib.inflateRaw(body, finish);
      });
    } else finish(null, body);
  });
};
