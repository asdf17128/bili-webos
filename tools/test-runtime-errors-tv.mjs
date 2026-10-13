// Real TV decoding after controlled fatal/nonfatal playback error notifications.
// Only the explicitly named decoder-error notification is injected.
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { tvPassphrase } from './_tvpass.mjs';

const output = process.env.UX_OUTPUT || '/tmp/bili-runtime-errors-tv';
mkdirSync(output, { recursive: true });
const conn = new Client(), results = [];
let server, ws, originalSettings, evaluateState;
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
  evaluateState = evaluate;
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
  await wait("typeof window.__openVideo==='function' && document.visibilityState==='visible'");
  originalSettings=await evaluate("localStorage.getItem('bili_settings')");
  const back=async()=>{for(let i=0;i<5&&await evaluate("!!document.querySelector('video')");i++)await key('GoBack')};
  const state=()=>evaluate(`(()=>{const v=document.querySelector('video'),t=window.__shakaPlayer?.getVariantTracks()?.find(t=>t.active);return {time:v?.currentTime,duration:v?.duration,paused:v?.paused,width:v?.videoWidth,height:v?.videoHeight,ready:v?.readyState,error:v?.error?.code,codec:t?.videoCodec,audio:t?.audioCodec,frameRate:t?.frameRate,runtime:window.__dolbyRuntime?.(),qn:Number(new DOMParser().parseFromString(window.__lastMpd||'','application/xml').querySelector('AdaptationSet[contentType="video"] Representation')?.getAttribute('id'))}})()`);
  const open=async sample=>{
    await back();
    await evaluate(`localStorage.setItem('bili_settings',JSON.stringify({...JSON.parse(${JSON.stringify(originalSettings)}||'{}'),quality:${sample.qn},playbackMode:'stop'}));window.__openVideo(${JSON.stringify({...sample,resumeMode:'none'})})`);
    await wait("document.querySelector('video')?.currentTime>2 && document.querySelector('video')?.videoWidth>0",50000);
  };
  for (const kind of ['media','network']) {
    await open({bvid:'BV1kX4y197P4',cid:1127214165,qn:120});
    await evaluate("document.querySelector('video').currentTime=24");
    await wait("document.querySelector('video').currentTime>25 && !document.querySelector('video').seeking",25000);
    await evaluate("document.querySelector('video').pause();window.__originalPlayer=window.__shakaPlayer;void 0");
    const before=await state();
    await evaluate(`window.__shakaPlayer.dispatchEvent({type:'error',detail:{category:${kind==='media'?3:1},code:${kind==='media'?3016:1001},severity:2}})`);
    await sleep(700);
    const observed={...await state(),errorVisible:await evaluate("document.body.innerText.includes('重试播放')")};
    await shot(kind+'-controlled-error-private');
    if (process.env.EXPECT_BEFORE) {
      check('before: '+kind+' error leaves paused media without retry UI',!observed.errorVisible&&observed.paused,observed);
      continue;
    }
    check(kind+' critical error displays retry while media is paused',observed.errorVisible&&observed.paused,observed);
    await wait("window.__shakaPlayer!==window.__originalPlayer && document.querySelector('video')?.readyState>=2 && !document.body.innerText.includes('重试播放')",45000);
    await wait(`document.querySelector('video')?.currentTime>${before.time+1}`,20000);
    const recovered=await state();
    check(kind+' recovery reloads and actually decodes near the interrupted position',recovered.time>before.time&&recovered.time<before.time+15&&recovered.width>0&&!recovered.error,recovered);
    await shot(kind+'-recovered-private');
  }
  if (!process.env.EXPECT_BEFORE) {
    const before=await state();
    await evaluate("window.__originalPlayer=window.__shakaPlayer;window.__shakaPlayer.dispatchEvent({type:'error',detail:{category:1,code:1001,severity:1}})");
    await wait(`document.querySelector('video')?.currentTime>${before.time+2}`,15000);
    check('recoverable network notification keeps the current decoder and playback',await evaluate("window.__shakaPlayer===window.__originalPlayer && !document.body.innerText.includes('重试播放')"),await state());
  }
  if (!process.env.EXPECT_BEFORE) {
    await open({bvid:'BV1xx411c7Xg',qn:80});
    await key('ArrowUp');
    for(let i=0;i<16&&!await evaluate("document.querySelector('.player-btn.focused')?.innerText==='倍速'");i++)await key('ArrowRight');
    assert.ok(await evaluate("document.querySelector('.player-btn.focused')?.innerText==='倍速'"),'focus speed control');
    await key('Enter');
    for(let i=0;i<8&&!await evaluate("document.querySelector('.quality-option.focused')?.innerText==='2x'");i++)await key('ArrowDown');
    assert.ok(await evaluate("document.querySelector('.quality-option.focused')?.innerText==='2x'"),'focus 2x');
    await key('Enter');
    await wait("document.querySelector('video')?.currentSrc.startsWith('http') && document.querySelector('video')?.currentTime>5 && document.querySelector('video')?.videoWidth>0",35000);
    await evaluate("document.querySelector('video').pause()");
    const before=await state();
    await evaluate("const v=document.querySelector('video');Object.defineProperty(v,'error',{configurable:true,get:()=>({code:3})});v.dispatchEvent(new Event('error'));void 0");
    await wait("document.body.innerText.includes('重试播放')");
    check('native speed decoder error has a reachable retry control',true,before);
    await shot('native-speed-error-private');
    await wait(`document.querySelector('video')?.currentSrc.startsWith('blob:') && document.querySelector('video')?.currentTime>${before.time+1} && document.querySelector('video')?.videoWidth>0`,45000);
    const recovered=await state();
    check('native speed failure resumes real DASH decoding at interrupted position',recovered.time<before.time+15&&!recovered.error,recovered);
  }

  await back();
} catch(error){results.push({name:'completion',pass:false,detail:error.message});console.error(error.message);process.exitCode=1}
finally{
  if(evaluateState&&originalSettings!==undefined){
    try{await evaluateState(`${originalSettings==null?"localStorage.removeItem('bili_settings')":"localStorage.setItem('bili_settings',"+JSON.stringify(originalSettings)+")"};delete window.__originalPlayer;for(let i=0;i<4;i++)window.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true}))`)}catch{}
  }
  writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));ws?.close();server?.close();conn.end();
}
