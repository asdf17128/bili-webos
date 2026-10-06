// REAL Node 8 — URL global genuinely absent. Evaluate the real service.js and
// drive the exact code path that broke on webOS 5.
require('./service.js');
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
          process.exit(ranking.returnValue !== false && data && data.code === 0 && count > 0 ? 0 : 1);
        }
      });
    }});
  }
});
setTimeout(function () { console.log('TIMEOUT'); process.exit(1); }, 20000);
