// Trusted remote input timing on real TV playback; no account list writes.
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { tvPassphrase } from './_tvpass.mjs';

const output = process.env.UX_OUTPUT || '/tmp/bili-scrub-tv';

mkdirSync(output, { recursive: true });
const conn = new Client();
const results = [];
let server, ws;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const overall = setTimeout(() => { console.error('TV UX check timed out'); process.exit(1); }, 360000);
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  const key = async name => {
    const vk = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, GoBack: 461 }[name];
    for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key: name, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });

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
  await call('Page.reload'); await wait('!!window.__openVideo');
  await evaluate("window.__openVideo({bvid:'BV1xx411c7Xg',resumeMode:'none'})");
  await wait("document.querySelector('video')?.currentTime>0.5 && document.querySelector('video').readyState>=2",40000);
  await evaluate(`(() => {
    window.__scrubTrace=[];
    window.__scrubKey=e=>window.__scrubTrace.push({event:e.key,at:performance.now(),t:document.querySelector('video')?.currentTime});
    document.addEventListener('keydown',window.__scrubKey,true);
    document.querySelector('video').addEventListener('seeking',()=>window.__scrubTrace.push({event:'seeking',at:performance.now(),t:document.querySelector('video').currentTime}));
  })()`);
  for (let round=0;round<3;round++) for (const scenario of [
    {name:'cancel',key:'GoBack',delay:200},{name:'cancel',key:'GoBack',delay:600},
    {name:'commit',key:'Enter',delay:200},{name:'auto-before-late-Back',key:'GoBack',delay:1300}
  ]) {
    await sleep(1600);
    await evaluate("document.querySelector('video').currentTime=30");
    await wait("!document.querySelector('video').seeking && document.querySelector('video').readyState>=2");
    await evaluate('window.__scrubTrace=[]');
    await key('ArrowRight');await sleep(scenario.delay);await key(scenario.key);await sleep(200);
    const trace=await evaluate('window.__scrubTrace');
    const first=trace.find(x=>x.event==='ArrowRight'), last=trace.find(x=>x.event===scenario.key);
    assert.ok(first&&last,'both trusted keys reached the TV');
    const gap=last.at-first.at;
    const seeks=trace.filter(x=>x.event==='seeking');
    if(scenario.name==='cancel')check('cancel before deadline '+round+'/'+scenario.delay,gap<950 && seeks.length===0,{gap,trace});
    else if(scenario.name==='commit')check('OK commits preview '+round,gap<950 && seeks.some(x=>x.t>first.t+8 && x.at>=last.at),{gap,trace});
    else check('late Back follows automatic commit '+round,gap>=1000 && seeks.some(x=>x.at<last.at && x.t>first.t+8),{gap,trace});
    check('player remains open '+round+'/'+scenario.name+'/'+scenario.delay,await evaluate("!!document.querySelector('video')"));
  }
  await evaluate("document.removeEventListener('keydown',window.__scrubKey,true);delete window.__scrubKey;delete window.__scrubTrace");
  await call('Page.reload');
} catch (error) { console.error(error.message); results.push({ name: 'completion', pass: false, detail: error.message }); process.exitCode = 1; }
finally {
  writeFileSync(`${output}/device.json`, JSON.stringify(results, null, 2));
  clearTimeout(overall); ws?.close(); server?.close(); conn.end();
}
