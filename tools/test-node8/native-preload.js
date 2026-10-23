// Optional Darwin fallback for the existing run8.js runtime gate. Run only in
// a disposable service copy with BILI_RUNTIME_SANDBOX set to its absolute path.
// ES5: this preload itself executes on genuine Node 0.12.2 and Node 8.
// Keep production service/compat/transport/WS code unchanged. Replace only the
// TV filesystem root and LAN announcement boundary; Luna uses the usual stub.
'use strict';
var Module = require('module');
var fs = require('fs');
var path = require('path');
var root = process.env.BILI_RUNTIME_SANDBOX;
if (!root || root.charAt(0) !== '/' || path.resolve(root) !== process.cwd()) {
  throw new Error('Native runtime test requires its disposable working directory');
}
var originalLoad = Module._load;
var isolatedFs = {};
Object.keys(fs).forEach(function (key) { isolatedFs[key] = fs[key]; });
function translate(value) {
  if (typeof value === 'string' && (value === '/media' || value.indexOf('/media/') === 0)) return root + value;
  return value;
}
['existsSync', 'readFileSync', 'writeFileSync', 'openSync', 'mkdirSync', 'unlinkSync', 'statSync'].forEach(function (key) {
  isolatedFs[key] = function () {
    var args = Array.prototype.slice.call(arguments);
    args[0] = translate(args[0]);
    return fs[key].apply(fs, args);
  };
});
isolatedFs.renameSync = function (from, to) {
  return fs.renameSync(translate(from), translate(to));
};
function NoLanAnnouncement() {}
NoLanAnnouncement.prototype.start = function (callback) { if (callback) callback(); };
Module._load = function (request, parent, isMain) {
  if (request === 'fs') return isolatedFs;
  if (request === './cast/ssdpServer' && parent && parent.filename === path.join(root, 'service.js')) {
    return { CastLanServer: NoLanAnnouncement };
  }
  return originalLoad.apply(this, arguments);
};
console.log('Native runtime adapter: real ' + process.version + ', isolated /media, no SSDP; Darwin is not webOS/Linux');
