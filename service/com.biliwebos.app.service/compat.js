// Adapted from @adin1234567's community patch in issue #34.
// CA bundle: Mozilla roots, retrieved from https://curl.se/ca/cacert.pem.
// Runtime shims for very old webOS service runtimes.
//
// webOS TV 4.x (2018-2019 sets, Chromium 53) runs JS services on Node v0.12.2,
// not Node 8. Node 0.12 parses this service fine (it is written in ES5) but is
// missing runtime APIs it relies on, which showed up on a real 65UM7300 as
// "Invalid URL: undefined is not a function" for EVERY request:
//   - require('url').URL            (Node 6.13+)  -> minimal WHATWG-ish URL
//   - Buffer.from / alloc / allocUnsafe (Node 4.5+)
//   - Buffer.prototype.subarray     (Buffer became a Uint8Array in Node 4)
//   - String.prototype.startsWith / endsWith / includes (V8 4.1+)
//   - a current CA bundle (Node 0.12's built-in roots are from 2015)
// Every shim is feature-detected; TLS roots change only below Node 8.
// Must be required before anything else in service.js.
'use strict';

var urlMod = require('url');
var querystring = require('querystring');

// ---------- URL ----------
if (typeof urlMod.URL !== 'function') {
  var MiniSearchParams = function (search) {
    this._q = querystring.parse(String(search || '').replace(/^\?/, ''));
  };
  MiniSearchParams.prototype.get = function (k) {
    var v = this._q[k];
    if (v === undefined) return null;
    return Array.isArray(v) ? v[0] : v;
  };
  MiniSearchParams.prototype.getAll = function (k) {
    var v = this._q[k];
    if (v === undefined) return [];
    return Array.isArray(v) ? v.slice() : [v];
  };
  MiniSearchParams.prototype.has = function (k) { return this._q[k] !== undefined; };
  MiniSearchParams.prototype.toString = function () { return querystring.stringify(this._q); };

  var MiniURL = function (input, base) {
    if (!(this instanceof MiniURL)) throw new TypeError("Constructor URL requires 'new'");
    var s = String(input);
    if (base !== undefined && base !== null) s = urlMod.resolve(String(base), s);
    var p = urlMod.parse(s);
    if (!p.protocol || !p.host) throw new TypeError('Invalid URL: ' + s.slice(0, 80));
    this.protocol = p.protocol;
    this.host = p.host;
    this.hostname = p.hostname;
    this.port = p.port || '';
    this.pathname = p.pathname || '/';
    this.search = p.search && p.search !== '?' ? p.search : '';
    this.hash = p.hash || '';
    var auth = (p.auth || '').split(':');
    this.username = auth[0] || '';
    this.password = auth.slice(1).join(':') || '';
    this.origin = p.protocol + '//' + p.host;
    this.href = p.protocol + '//' + (p.auth ? p.auth + '@' : '') + p.host +
      this.pathname + this.search + this.hash;
    this.searchParams = new MiniSearchParams(this.search);
  };
  MiniURL.prototype.toString = function () { return this.href; };
  MiniURL.prototype.toJSON = function () { return this.href; };
  urlMod.URL = MiniURL;
}

// ---------- Buffer ----------
var nativeFrom = Buffer.from;
if (typeof nativeFrom !== 'function' || nativeFrom === Uint8Array.from) {
  Buffer.from = function (value, encodingOrOffset, length) {
    if (typeof value === 'number') throw new TypeError('"value" argument must not be a number');
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
      var u8 = new Uint8Array(value, encodingOrOffset || 0, length);
      return new Buffer(u8);
    }
    return new Buffer(value, encodingOrOffset);
  };
}
if (typeof Buffer.alloc !== 'function') {
  Buffer.alloc = function (size, fill, encoding) {
    var b = new Buffer(size);
    if (fill !== undefined) b.fill(fill, encoding); else b.fill(0);
    return b;
  };
}
if (typeof Buffer.allocUnsafe !== 'function') {
  Buffer.allocUnsafe = function (size) { return new Buffer(size); };
}
if (typeof Buffer.prototype.subarray !== 'function') {
  Buffer.prototype.subarray = Buffer.prototype.slice;
}

// ---------- String ----------
if (!String.prototype.startsWith) {
  String.prototype.startsWith = function (s, pos) {
    pos = pos > 0 ? pos | 0 : 0;
    return this.substring(pos, pos + String(s).length) === String(s);
  };
}
if (!String.prototype.endsWith) {
  String.prototype.endsWith = function (s, len) {
    var str = String(this);
    if (len === undefined || len > str.length) len = str.length;
    s = String(s);
    return str.substring(len - s.length, len) === s;
  };
}
if (!String.prototype.includes) {
  String.prototype.includes = function (s, pos) { return this.indexOf(s, pos) !== -1; };
}

// ---------- TLS roots ----------
// Only on runtimes older than Node 8: ship a current Mozilla root bundle so
// certificates issued after 2015 still verify. Injected per request (it also
// covers the service's own keep-alive agents and the ws@1 danmaku socket).
var major = parseInt(String(process.versions.node).split('.')[0], 10);
if (major < 8) {
  try {
    var fs = require('fs');
    var path = require('path');
    var pem = fs.readFileSync(path.join(__dirname, 'cacert.pem'), 'utf8');
    if (process.env.BILI_EXTRA_CA) pem += '\n' + fs.readFileSync(process.env.BILI_EXTRA_CA, 'utf8');
    var CA = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
    if (CA.length) {
      var https = require('https');
      var wrap = function (orig) {
        return function (options) {
          if (options && typeof options === 'object' && !options.ca) options.ca = CA;
          return orig.apply(this, arguments);
        };
      };
      https.request = wrap(https.request);
      https.get = wrap(https.get);
      var tls = require('tls');
      tls.connect = wrap(tls.connect);
    }
  } catch (e) {
    console.error('[compat] CA bundle not loaded:', e && e.message);
  }
}
