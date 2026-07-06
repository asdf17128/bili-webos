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
    console.log('fetch OK on real Node 8: status=' + r.status);
    var body = null;
    try { body = JSON.parse(r.body); } catch (e) {}
    console.log('api code=' + (body && body.code) + ' (expect -101 anonymous or 0)');
    svc.methods['getDiagnostics']({ respond: function (d) {
      console.log('getDiagnostics OK: node=' + d.nodeVersion + ' buvid=' + d.buvid + ' dm=' + d.danmakuModule);
      process.exit(0);
    }});
  }
});
setTimeout(function () { console.log('TIMEOUT'); process.exit(1); }, 20000);
