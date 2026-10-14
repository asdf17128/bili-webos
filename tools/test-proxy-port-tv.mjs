// Real TV media port negotiation. A temporary loopback TCP relay receives
// actual thumbnails and Shaka media. Only Luna port metadata is injected;
// the production service, Bilibili requests and TV decoder stay real.
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { tvPassphrase } from './_tvpass.mjs';

const output = process.env.UX_OUTPUT || '/tmp/bili-proxy-port-tv';
mkdirSync(output, { recursive: true });
const conn = new Client(), results = [];
let server, ws, relay, bootScript;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    let body = ''; response.on('data', part => body += part); response.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
  }).on('error', reject));
  const app = pages.find(p => p.url?.includes('biliwebos'));
  assert.ok(app, 'TV app must be launched');
  ws = new WebSocket(app.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${port}`));
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  let seq = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { ws.off('message', handler); reject(new Error('CDP timeout: ' + method)); }, 25000);
    const handler = raw => { const message = JSON.parse(raw); if (message.id !== id) return;
      clearTimeout(timer); ws.off('message', handler);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    };
    ws.on('message', handler); ws.send(JSON.stringify({ id, method, params }));
  });
  await call('Page.enable');
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('TV evaluation failed: ' + r.exceptionDetails.text);
    return r.result?.value;
  };
  const luna = (method, parameters = {}) => evaluate(`new Promise((resolve,reject)=>{
    var timer=setTimeout(()=>reject(new Error('Luna timeout')),12000);
    window.webOS.service.request('luna://com.biliwebos.app.service/',{method:${JSON.stringify(method)},parameters:${JSON.stringify(parameters)},
      onSuccess:r=>{clearTimeout(timer);resolve(r)},onFailure:()=>{clearTimeout(timer);reject(new Error('Luna failed'))}});
  })`);
  const wait = async (expression, timeout = 25000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (await evaluate(expression)) return; await sleep(250); }
    throw new Error('TV condition timed out: ' + expression);
  };
  const key = async name => {
    const code = { ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, Enter: 13, GoBack: 461 }[name];
    for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await sleep(230);
  };
  const check = (name, condition, detail) => { results.push({ name, pass: !!condition, detail }); console.log(condition ? 'PASS' : 'FAIL', name, detail || ''); assert.ok(condition, name); };
  const shot = async name => { const r = await call('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${output}/${name}.png`, Buffer.from(r.data, 'base64'), { mode: 0o600 }); };
  const ready = () => wait("document.visibilityState==='visible' && document.querySelectorAll('.video-card').length>5 && Array.from(document.querySelectorAll('.video-card img')).filter(i=>i.complete&&i.naturalWidth>0&&getComputedStyle(i).opacity==='1').length>=4");
  const reload = async () => {
    const marker = String(Date.now()) + Math.random();
    await evaluate(`window.__sessionReload=${JSON.stringify(marker)}`);
    await call('Page.reload');
    // Page.reload acknowledgement can precede navigation; the old DOM is
    // still populated. Wait for a different document before reading results.
    await wait(`window.__sessionReload!==${JSON.stringify(marker)} && document.readyState==='complete'`);
    await ready();
  };
  await ready();
  const originalPort = (await luna('ping')).localProxyPort;
  const relayCode = `var net=require('net'),sockets=[];
    var server=net.createServer(function(s){var r=net.connect(${originalPort},'127.0.0.1');sockets.push(s,r);s.on('error',function(){});r.on('error',function(){s.destroy()});s.pipe(r).pipe(s)});
    server.listen(0,'127.0.0.1',function(){console.log(server.address().port)});
    process.stdin.resume();process.stdin.on('end',function(){sockets.forEach(function(s){s.destroy()});server.close(function(){process.exit(0)})});`;
  const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const relayPort = await new Promise((resolve, reject) => {
    conn.exec('/usr/bin/node -e ' + shellQuote(relayCode), (err, stream) => {
      if(err){reject(err);return} relay=stream; let text='';
      stream.on('data',chunk=>{text+=chunk;if(text.includes('\n'))resolve(Number(text.trim()))});
      stream.on('close',()=>reject(new Error('TV relay closed before startup')));
      stream.stderr.on('data',()=>reject(new Error('TV relay could not start')));
    });
  });
  check('temporary TV loopback relay binds a distinct port', relayPort>0 && relayPort!==originalPort, {originalPort,relayPort});
  try {
    const source = `(() => {var api;window.__portProbe={calls:0,port:${relayPort}};
      Object.defineProperty(window,'webOS',{configurable:true,get:()=>api,set:value=>{
        api=value;var request=api.service.request;
        api.service.request=function(uri,opt){
          if(uri.indexOf('com.biliwebos.app.service')>=0 && (opt.method==='ping'||opt.method==='getDiagnostics')){
            var success=opt.onSuccess;opt=Object.assign({},opt,{onSuccess:r=>{window.__portProbe.calls++;success(Object.assign({},r,{localProxyPort:${relayPort}}))}});
          }
          return request.call(this,uri,opt);
        };
      }});
    })();`;
    bootScript=(await call('Page.addScriptToEvaluateOnNewDocument',{source})).identifier;
    await reload();
    const state=await evaluate(`({injected:window.__portProbe,ports:Array.from(new Set(Array.from(document.querySelectorAll('.video-card img')).map(i=>Number(new URL(i.src).port))))})`);
    check('TV startup negotiates the injected service port before covers',state.injected?.calls>0 && state.ports.length===1 && state.ports[0]===relayPort,state);
    await shot('relay-home-private');
    const media=[];
    ws.on('message',raw=>{const m=JSON.parse(raw);if(m.method!=='Network.responseReceived')return;
      const r=m.params.response;try{const u=new URL(r.url);if(Number(u.port)===relayPort && /bilivideo|akamaized/.test(u.pathname))media.push({status:r.status,port:relayPort});}catch{}
    });
    await call('Network.enable');
    await evaluate("window.__openVideo({bvid:'BV1xx411c7Xg',resumeMode:'none'})");
    await wait("document.querySelector('video')?.currentTime>2 && document.querySelector('video')?.readyState>=2 && document.querySelector('video')?.videoWidth>0",45000);
    check('TV decodes actual media through the alternate port',media.some(r=>r.status===206),{responses:media.length,statuses:Array.from(new Set(media.map(r=>r.status))),port:relayPort});
    const before=await evaluate("document.querySelector('video').currentTime");await sleep(1800);
    check('playback advances after port negotiation',await evaluate(`document.querySelector('video').currentTime>${before+0.5}`));
  } finally {
    if(bootScript)await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:bootScript});
    await reload();
    relay.end();relay=null;
    const ports=await evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('.video-card img')).map(i=>Number(new URL(i.src).port))))`);
    check('original TV media port restored after removing injection',ports.length===1 && ports[0]===originalPort,{ports});
  }
} catch(e) { results.push({name:'completion',pass:false,detail:e.message});console.error(e.message);process.exitCode=1; }
finally {
  writeFileSync(`${output}/after.json`,JSON.stringify(results,null,2));
  relay?.end();ws?.close();server?.close();conn.end();
}
