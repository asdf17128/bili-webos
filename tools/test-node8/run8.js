// REAL Node 8 — URL global genuinely absent. Evaluate the real service.js and
// drive the exact code path that broke on webOS 5.
require('./service.js');
// Exercise the absolute deadline on an actual Agent queue on both runtimes.
var deadlineHttp = require('http');
var deadlineServer = deadlineHttp.createServer(function () {});
deadlineServer.listen(0, '127.0.0.1', function () {
  var agent = new deadlineHttp.Agent({ keepAlive: true, maxSockets: 1 });
  var opts = { hostname: '127.0.0.1', port: deadlineServer.address().port, agent: agent };
  var first = deadlineHttp.get(opts);
  first.on('error', function () {});
  var second = deadlineHttp.get(opts), failures = 0;
  require('./requestDeadline')(second, function (err) {
    if (err.code === 'ETIMEDOUT') failures++;
  }, 30);
  setTimeout(function () {
    first.destroy(); second.destroy(); agent.destroy(); deadlineServer.close();
    if (failures !== 1) { console.log('FAIL queued request deadline'); process.exit(1); }
    console.log('queued request deadline OK on ' + process.version);
  }, 150);
});
// Real peer reset: only the second fresh GET may succeed on old runtimes.
var retryCount = 0, retryPassed = false;
var retryServer = deadlineHttp.createServer(function (req, res) {
  retryCount++;
  if (retryCount === 1) req.socket.destroy();
  else res.end('recovered');
});
retryServer.listen(0, '127.0.0.1', function () {
  require('./upstreamRequest')(deadlineHttp.request, {
    hostname: '127.0.0.1', port: retryServer.address().port, method: 'GET'
  }, null, function (err, res) {
    if (err) { console.log('FAIL fresh GET retry: ' + err.message); process.exit(1); }
    var data = '';
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function () {
      retryServer.close();
      retryPassed = retryCount === 2 && data === 'recovered';
      if (!retryPassed) { console.log('FAIL fresh GET retry body'); process.exit(1); }
      console.log('fresh GET retry OK on ' + process.version);
    });
  }, 1000);
});
// Exercise the Node 0.12 parser guard on both real runtimes, not just modern
// Node's unit tests. Keep small valid messages working after every final frame.
var LegacyReceiver = require('ws-legacy').Receiver;
require('./wsLegacyLimits')(LegacyReceiver);
var receiver = new LegacyReceiver({}, 4 * 1024 * 1024);
var limited = false;
receiver.onerror = function (error, code) { limited = code === 1009; };
var frames = new Buffer(8200); frames.fill(0); frames[0] = 2;
receiver.add(frames);
if (!limited) { console.log('FAIL legacy fragment guard'); process.exit(1); }
console.log('legacy fragment guard OK on ' + process.version);
var svc = require('webos-service').last;
svc.methods['fetch']({
  payload: { url: 'https://api.bilibili.com/x/web-interface/nav' },
  respond: function (r) {
    if (r.returnValue === false) {
      console.log('FETCH FAILED:', r.error);
      process.exit(/Invalid URL/.test(r.error || '') ? 1 : 2);
    }
    console.log('fetch OK on real Node ' + process.version + ': status=' + r.status);
    var body = null;
    try { body = JSON.parse(r.body); } catch (e) {}
    console.log('api code=' + (body && body.code) + ' (expect -101 anonymous or 0)');
    if (r.status !== 200 || !body || (body.code !== -101 && body.code !== 0)) process.exit(2);
    svc.methods['getDiagnostics']({ respond: function (d) {
      console.log('getDiagnostics OK: node=' + d.nodeVersion + ' buvid=' + d.buvid + ' dm=' + d.danmakuModule);
      if (!d.danmakuModule) process.exit(1);
      // Exercise the production request headers, not just a header helper.
      svc.methods['fetch']({
        payload: { url: 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=1008&type=all' },
        respond: function (ranking) {
          var data = null;
          try { data = JSON.parse(ranking.body); } catch (e) {}
          var count = data && data.data && data.data.list && data.data.list.length || 0;
          console.log('ranking on real Node ' + process.version + ': code=' + (data && data.code) + ' count=' + count);
          process.exit(retryPassed && ranking.returnValue !== false && data && data.code === 0 && count > 0 ? 0 : 1);
        }
      });
    }});
  }
});
setTimeout(function () { console.log('TIMEOUT'); process.exit(1); }, 20000);
