// Passive TV loading capture: console history, media requests and Luna timings.
// Does not navigate, restart playback, or save cookies / signed query strings.
// Usage: node tools/inspect-tv-loading.mjs [seconds]
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { tvPassphrase } from './_tvpass.mjs';

const output = process.env.LOADING_OUTPUT || '/tmp/bili-loading-inspection.json';
const duration = Math.min(180, Math.max(10, Number(process.argv[2]) || 45));
const report = { startedAt: new Date().toISOString(), console: [], network: [], states: [] };
const requests = new Map();
const safe = value => String(value).replace(/https?:\/\/[^\s"'<>]+/g, url => url.split('?')[0]).slice(0, 350);
const conn = new Client();

let server, ws;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const overall = setTimeout(() => { console.error('Inspection timed out'); process.exit(1); }, (duration + 30) * 1000);
try {
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve).on('error', reject);
    conn.connect({ host: '192.168.50.94', port: 9922, username: 'prisoner',
      privateKey: readFileSync(process.env.HOME + '/.ssh/tv_webos'), passphrase: tvPassphrase(),
      algorithms: { serverHostKey: ['ssh-rsa'] }, readyTimeout: 10000 });
  });
  server = net.createServer(socket => conn.forwardOut('127.0.0.1', 0, '127.0.0.1', 9998, (error, remote) => {
    if (error) { socket.end(); return; } socket.pipe(remote).pipe(socket);
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const pages = await new Promise((resolve, reject) => http.get(`http://127.0.0.1:${port}/json`, response => {
    let body = ''; response.on('data', part => body += part); response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
  }).on('error', reject));
  const app = pages.find(p => p.url?.includes('biliwebos'));
  assert.ok(app, 'BiliTV must be running');
  ws = new WebSocket(app.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${port}`));
  await new Promise(resolve => ws.on('open', resolve));
  let seq = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { ws.off('message', handler); reject(new Error(`CDP timeout: ${method}`)); }, 12000);
    const handler = raw => { const message = JSON.parse(raw); if (message.id !== id) return;
      ws.off('message', handler); clearTimeout(timer);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    };
    ws.on('message', handler); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  };

  ws.on('message', raw => {
    const m = JSON.parse(raw), p = m.params;
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = p.args.map(a => a.value == null ? (a.description?.startsWith('Error') ? a.description : '') : String(a.value)).filter(Boolean).join(' ');
      if (text) report.console.push({ at: new Date(p.timestamp).toISOString(), level: p.type, text: safe(text) });
    }
    if (m.method === 'Runtime.exceptionThrown') report.console.push({ at: new Date(p.timestamp).toISOString(), level: 'exception', text: safe(p.exceptionDetails.exception?.description || p.exceptionDetails.text) });
    if (m.method === 'Network.requestWillBeSent') {
      const url = p.request.url;
      if (url.startsWith('http')) requests.set(p.requestId, { endpoint: safe(url), start: p.timestamp, at: new Date(p.wallTime * 1000).toISOString(), type: p.type });
    }
    if (m.method === 'Network.responseReceived' && requests.has(p.requestId)) requests.get(p.requestId).status = p.response.status;
    if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') {
      const request = requests.get(p.requestId);
      if (request) {
        report.network.push({ ...request, ms: Math.round((p.timestamp - request.start) * 1000), bytes: p.encodedDataLength, error: p.errorText });
        requests.delete(p.requestId);
      }
    }
  });
  await call('Runtime.enable'); await call('Network.enable');
  await evaluate(`(() => {
    if (window.__loadingInspect) window.__loadingInspect.stop();
    const svc = window.webOS.service, original = svc.request, entries = [];
    const wrapper = function(uri, options) {
      if (options.method !== 'fetch') return original.apply(this, arguments);
      const row = { at: Date.now(), endpoint: String(options.parameters?.url || '').split('?')[0], pending: true };
      entries.push(row); if (entries.length > 150) entries.shift();
      const finish = (result, failed) => { row.ms = Date.now() - row.at; row.pending = false; row.status = result?.status; row.failed = !!failed || result?.returnValue === false; };
      const copy = Object.assign({}, options, {
        onSuccess: function(r) { finish(r, false); return options.onSuccess?.apply(this, arguments); },
        onFailure: function(r) { finish(r, true); return options.onFailure?.apply(this, arguments); }
      });
      return original.call(this, uri, copy);
    };
    svc.request = wrapper;
    const stop = () => { if (svc.request === wrapper) svc.request = original; clearTimeout(timer); delete window.__loadingInspect; return entries; };
    const timer = setTimeout(stop, ${duration * 1000 + 15000});
    window.__loadingInspect = { entries, stop };
  })()`);
  const diagnostics = () => evaluate(`new Promise(resolve => webOS.service.request('luna://com.biliwebos.app.service/', { method: 'getDiagnostics', parameters: {}, onSuccess: r => resolve({ uptimeSec:r.uptimeSec, recentErrors:r.recentErrors }), onFailure:r=>resolve({error:r.errorText}) }))`);
  report.serviceBefore = await diagnostics();
  console.log('Passive capture started; existing playback stays untouched.');
  for (let n = 0; n < duration; n++) {
    report.states.push(await evaluate(`(() => { const v = document.querySelector('video'); const p = window.__shakaPlayer; return { at:Date.now(), loading:!!document.querySelector('.player-container .loading,.player-placeholder'), video:v ? {time:v.currentTime,ready:v.readyState,paused:v.paused,bufferEnd:v.buffered.length?v.buffered.end(v.buffered.length-1):0} : null, heapMB:Math.round((performance.memory?.usedJSHeapSize || 0)/1048576) }; })()`));
    await sleep(1000);
  }
  report.luna = await evaluate('window.__loadingInspect?.stop() || []');
  report.serviceAfter = await diagnostics();
  report.pendingNetwork = Array.from(requests.values());
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, console: report.console, mediaRequests: report.network.length, slowRequests: report.network.filter(r=>r.ms>2000||r.error), luna:report.luna, loadingSamples:report.states.filter(s=>s.loading).length, heapMB:report.states.map(s=>s.heapMB) },null,2));
} finally {
  clearTimeout(overall);
  if (ws) ws.close(); if (server) server.close(); conn.end();
}
