// Focus/scroll/playback checks on the installed development TV. No account writes
// beyond ordinary playback history; all timing-sensitive assertions share one CDP session.
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { tvPassphrase } from './_tvpass.mjs';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const output = process.env.UX_OUTPUT || '/tmp/bili-issues-diagnostics';

mkdirSync(output, { recursive: true });
const conn = new Client();
const results = [];
let originalSettings = null, originalBadCdn = null;
let server, ws;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const overall = setTimeout(() => { console.error('TV UX check timed out'); process.exit(1); }, 240000);
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
    const result = await call('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  };
  const key = async name => {
    const vk = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, GoBack: 461 }[name];
    for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key: name, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(280);
  };
  const wait = async (expression, timeout = 25000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = await evaluate(expression);
      if (value) return value;
      await sleep(400);
    }
    throw new Error('Timed out: ' + expression);
  };
  const check = (name, condition, detail) => { results.push({ name, pass: !!condition, detail }); console.log(condition ? 'PASS' : 'FAIL', name, detail || ''); assert.ok(condition, name); };
  const capture = async name => {
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    const bytes = Buffer.from(shot.data, 'base64');
    writeFileSync(`${output}/${name}.png`, bytes);
    return PNG.sync.read(bytes);
  };
  originalSettings = await evaluate('localStorage.getItem("bili_settings")');
  originalBadCdn = await evaluate('localStorage.getItem("bili_test_badcdn")');
  try {
    await evaluate(`localStorage.setItem('bili_settings',JSON.stringify({...JSON.parse(localStorage.getItem('bili_settings')||'{}'),language:'zh'}))`);
    await call('Page.reload');
    await wait('!!window.__openVideo');
    await evaluate(`localStorage.setItem('bili_test_badcdn','1');window.__openVideo({bvid:'BV1xx411c7Xg',resumeMode:'none'})`);
    await wait('document.querySelector("video")?.currentTime > 2 && document.querySelector("video")?.readyState >= 2', 40000);
    check('unreachable primary CDN falls back and starts actual playback', true);
    const banned = await evaluate('window.__cdnBanned()');
    check('unreachable primary CDN is banned', banned.includes('upos-sz-mirrorbad.bilivideo.com'), banned.join(','));
    await evaluate('localStorage.removeItem("bili_test_badcdn")');
    for (let i=0;i<7 && await evaluate('!!document.querySelector(".player-page")');i++) await key('GoBack');
    await evaluate(`localStorage.setItem('bili_settings',JSON.stringify({...JSON.parse(localStorage.getItem('bili_settings')||'{}'),cdnRoute:'ali'}));document.querySelector('[data-focus-id="sidebar-13-0"]').click()`);
    await wait('!!document.querySelector(".config-page")');
    await evaluate(`document.querySelector('[data-focus-id="content-9-0"]').click()`);
    await wait('!!document.querySelector(".diagnostic-report svg")', 100000);
    const reportText = await evaluate('document.querySelector(".diagnostic-panel").innerText');
    check('diagnostics measure the selected Ali route', /视频 CDN.*ali /.test(reportText), reportText.match(/视频 CDN[^\n]*/)?.[0]);
    check('diagnostics report single and concurrent throughput', /CDN 测速.*1x.*4x/.test(reportText));
    await evaluate(`document.querySelector('.diagnostic-report').scrollIntoView({block:'center'})`);
    await sleep(700);
    const png = await capture('tv-diagnostics');
    const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.ok(qr, 'QR must decode from real TV pixels');
    const url = new URL(qr.data);
    const body = url.searchParams.get('body');
    check('TV QR retains selected route and last playback evidence', body.includes('route=ali') && /last: host=.+stalls=/.test(body));
    check('TV QR body is ASCII and contains no signed media URL', /^[\x00-\x7f]*$/.test(body) && !/upsig|SESSDATA|hdnts/i.test(body));
  } finally {
    if (originalSettings != null) await evaluate(`localStorage.setItem('bili_settings',${JSON.stringify(originalSettings)})`);
    await evaluate(originalBadCdn == null ? 'localStorage.removeItem("bili_test_badcdn")' : `localStorage.setItem('bili_test_badcdn',${JSON.stringify(originalBadCdn)})`);
    await call('Page.reload');
  }
} catch (error) { console.error(error.message); results.push({ name: 'completion', pass: false, detail: error.message }); process.exitCode = 1; }
finally {
  writeFileSync(`${output}/device.json`, JSON.stringify(results, null, 2));
  clearTimeout(overall); ws?.close(); server?.close(); conn.end();
}
