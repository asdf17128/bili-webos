// 25-minute real TV playback/API endurance test. Restores original settings;
// no account list writes, ordinary playback history still updates.
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { tvPassphrase } from './_tvpass.mjs';

const output = process.env.UX_OUTPUT || '/tmp/bili-network-soak-tv';

mkdirSync(output, { recursive: true });
const conn = new Client();
const results = [];
let originalSettings = null;
let server, ws;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const overall = setTimeout(() => { console.error('TV UX check timed out'); process.exit(1); }, 27 * 60 * 1000);
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
    const timer = setTimeout(() => { ws.off('message', handler); reject(new Error(`CDP timeout: ${method}`)); }, 25000);
    const handler = raw => { const message = JSON.parse(raw); if (message.id !== id) return;
      ws.off('message', handler); clearTimeout(timer);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    };
    ws.on('message', handler); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
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
  originalSettings = await evaluate('localStorage.getItem("bili_settings")');
  try {
    await evaluate(`localStorage.setItem('bili_settings',JSON.stringify({...JSON.parse(localStorage.getItem('bili_settings')||'{}'),playbackMode:'repeat'}))`);
    await call('Page.reload'); await wait('!!window.__openVideo');
    await evaluate("window.__openVideo({bvid:'BV1xx411c7Xg',resumeMode:'none'})");
    await wait("document.querySelector('video')?.currentTime>0.5 && document.querySelector('video').readyState>=2",40000);
    await evaluate(`(() => {
      const v=document.querySelector('video');
      window.__soak={lastTime:v.currentTime,lastAdvance:Date.now(),longestGap:0,ends:0};
      v.addEventListener('ended',()=>window.__soak.ends++);
      window.__soakTimer=setInterval(()=>{
        const s=window.__soak;
        if(v.currentTime!==s.lastTime){s.longestGap=Math.max(s.longestGap,Date.now()-s.lastAdvance);s.lastAdvance=Date.now();s.lastTime=v.currentTime;}
      },1000);
    })()`);
    const started=Date.now();let previousUptime=0;
    for(let n=0;n<=25;n++){
      if(n)await sleep(Math.max(0,started+n*60000-Date.now()));
      const sample=await evaluate(`(async () => {
        const request=(method,parameters)=>new Promise(resolve=>{
          const start=Date.now();let handle,done=false;
          const finish=r=>{if(done)return;done=true;clearTimeout(timer);resolve({...r,ms:Date.now()-start});};
          const timer=setTimeout(()=>{handle?.cancel?.();finish({timeout:true});},15000);
          handle=window.webOS.service.request('luna://com.biliwebos.app.service/',{method,parameters,
            onFailure:()=>finish({failed:true}),onSuccess:r=>{
              if(method==='getDiagnostics')return finish({uptime:r.uptimeSec,node:r.nodeVersion,dnsErrors:(r.recentErrors||[]).filter(e=>/EAI_AGAIN|ENOTFOUND/.test(e.d||'')).length,readRetries:(r.recentErrors||[]).filter(e=>/^retry:/.test(e.tag||'')).length,requestErrors:(r.recentErrors||[]).filter(e=>/^req:/.test(e.tag||'')).length});
              try{const b=JSON.parse(r.body == null ? atob(r.bodyBase64 || '') : r.body);finish({status:r.status,code:b.code,version:b.version})}catch{finish({failed:true})}
            }});
        });
        const apis=await Promise.all([
          request('fetch',{url:'https://api.bilibili.com/x/web-interface/nav'}),
          request('fetch',{url:'https://api.live.bilibili.com/room/v1/Area/getList'}),
          request('fetch',{url:'https://github.com/asdf17128/bili-webos/releases/latest/download/version.json'})
        ]);
        const service=await request('getDiagnostics',{}),v=document.querySelector('video'),s=window.__soak;
        return {apis,service,t:v?.currentTime,ready:v?.readyState,paused:v?.paused,width:v?.videoWidth,height:v?.videoHeight,
          ends:s.ends,longestGap:Math.max(s.longestGap,Date.now()-s.lastAdvance)};
      })()`);
      sample.elapsedMs=Date.now()-started;
      check('continuous playback and APIs minute '+n,sample.width>0 && sample.ready>=2 && !sample.paused && sample.longestGap<15000 &&
        sample.apis.every((a,i)=>a.status===200 && (i===2?!!a.version:a.code===0)) && sample.service.uptime>previousUptime,sample);
      previousUptime=sample.service.uptime;
      writeFileSync(`${output}/device.json`,JSON.stringify(results,null,2));
    }
  } finally {
    await evaluate('clearInterval(window.__soakTimer);delete window.__soak;delete window.__soakTimer');
    await evaluate(originalSettings==null?'localStorage.removeItem("bili_settings")':`localStorage.setItem('bili_settings',${JSON.stringify(originalSettings)})`);
    check('original settings restored',await evaluate('localStorage.getItem("bili_settings")')===originalSettings);
    await call('Page.reload');
  }
} catch (error) { console.error(error.message); results.push({ name: 'completion', pass: false, detail: error.message }); process.exitCode = 1; }
finally {
  writeFileSync(`${output}/device.json`, JSON.stringify(results, null, 2));
  clearTimeout(overall); ws?.close(); server?.close(); conn.end();
}
