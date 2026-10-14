// The production service and HTTP proxy, with isolated disk/account/upstream
// fixtures. No TV, LAN advertisements, real credentials, or external requests.
import http from 'node:http';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const source = new URL('../../service/com.biliwebos.app.service/service.js', import.meta.url);
const require = createRequire(source);
const cookieFile = '/media/internal/bili_cookies.json';
export const fakeAuth = { SESSDATA: 'fixture-session', DedeUserID: '123', bili_jct: 'fixture-csrf', buvid3: 'fixture-buvid' };

export async function serviceFixture({ occupied = false, loggedIn = true } = {}) {
  const state = { failSave: false, hold: '', held: [], requests: [], clears: 0 };
  const disk = new Map([[cookieFile, JSON.stringify(loggedIn ? fakeAuth : { buvid3: 'fixture-buvid' })]]);
  const servers = [];
  const timers = new Set();
  const listen = server => new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
  });
  let wrongPortHits = 0;
  if (occupied) {
    const blocker = http.createServer((req, res) => { wrongPortHits++; res.writeHead(503, { 'Access-Control-Allow-Origin': '*' }); res.end(); });
    await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(7654, '127.0.0.1', resolve); });
    servers.push(blocker);
  }
  const upstream = http.createServer((req, res) => {
    state.requests.push({ path: req.url, cookie: req.headers.cookie || '', range: req.headers.range || '' });
    const reply = () => {
      let body = { code: 0, data: {} };
      const member = /SESSDATA=/.test(req.headers.cookie || '');
      if (req.url.includes('/nav')) body.data = { isLogin: member, mid: member ? 123 : 0, uname: 'Fixture account', wbi_img: { img_url: 'https://example.com/abcdefghijklmnopqrstuvwxyz123456.png', sub_url: 'https://example.com/abcdefghijklmnopqrstuvwxyz123456.png' } };
      if (req.url.includes('/top/feed/rcmd') || req.url.includes('/popular')) {
        const list = Array.from({ length: 30 }, (_, i) => ({ bvid: 'BVfixture' + i, title: (member ? 'Member' : 'Guest') + ' video ' + i, pic: 'https://i0.hdslb.com/fixture-cover.jpg', duration: 300, owner: { mid: 99, name: 'Fixture UP' }, stat: { view: 123 } }));
        body.data = { item: list, list, no_more: true };
      }
      if (req.url.includes('/history/cursor')) body.data = { list: [], cursor: { max: 0 } };
      if (req.url.includes('/followings')) body.data = { list: [] };
      if (req.url.includes('/late-cookie')) res.setHeader('Set-Cookie', ['SESSDATA=late-fixture; Path=/', 'DedeUserID=123']);
      if (req.url.includes('fixture-cover')) {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="540" height="338"><rect width="540" height="338" fill="#426880"/></svg>'); return;
      }
      if (req.url.includes('fixture-video')) {
        res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-3/4', 'Content-Length': '4' });
        res.end('test'); return;
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
    };
    if (state.hold && req.url.includes(state.hold)) state.held.push(reply);
    else reply();
  });
  const upstreamPort = await listen(upstream); servers.push(upstream);
  let service;
  function Service() { this.methods = {}; this.activityManager = { create() {} }; service = this; }
  Service.prototype.register = function (name, cb) { this.methods[name] = cb; };
  const fixtureRequire = name => {
    if (name === 'webos-service') return Service;
    if (name === 'https') return { Agent: http.Agent, request: (opts, cb) => http.request({ ...opts, hostname: '127.0.0.1', port: upstreamPort }, cb) };
    if (name === 'http') return { ...http, createServer: (...args) => { const s = http.createServer(...args); servers.push(s); return s; } };
    if (name === 'fs') return {
      existsSync: p => disk.has(p), readFileSync: p => disk.get(p),
      writeFileSync: (p, value) => { if (p === cookieFile && state.failSave) throw new Error('fixture disk failure'); disk.set(p, value); },
    };
    if (name === './cast/ssdpServer') return { CastLanServer: class { start() {} } };
    if (name === './danmaku') return {};
    return require(name);
  };
  vm.runInNewContext(readFileSync(source, 'utf8'), {
    require: fixtureRequire, Buffer, console: { log() {}, error() {} },
    process: { version: process.version, uptime: () => process.uptime(), on() {} },
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); timers.add(t); return t; }, clearTimeout,
  }, { filename: source.pathname });
  const call = (method, payload = {}) => new Promise(resolve => {
    if (method === 'clearCookies') state.clears++;
    if (!service.methods[method]) { resolve({ returnValue: false, error: 'unknown method' }); return; }
    service.methods[method]({ payload, respond: r => resolve(JSON.parse(JSON.stringify(r))) });
  });
  const local = servers[servers.length - 1];
  if (!local.listening) await new Promise(resolve => local.once('listening', resolve));
  return {
    call, state, disk, cookieFile, port: local.address().port, wrongPortHits: () => wrongPortHits,
    release() { state.hold = ''; state.held.splice(0).forEach(fn => fn()); },
    async close() { for (const t of timers) clearTimeout(t); await Promise.all(servers.map(s => new Promise(resolve => { s.closeAllConnections(); s.close(resolve); }))); },
  };
}
