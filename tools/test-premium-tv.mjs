// Real TV premium playback, remote quality selection and decoder recovery.
// Only the explicitly named decoder-error notification is injected.
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { tvPassphrase } from './_tvpass.mjs';

const output = process.env.UX_OUTPUT || '/tmp/bili-premium-controls-tv';
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
    await evaluate(`localStorage.setItem('bili_settings',JSON.stringify({...JSON.parse(${JSON.stringify(originalSettings)}||'{}'),quality:${sample.qn},qualityMode:'manual',playbackMode:'stop'}));window.__openVideo(${JSON.stringify({...sample,resumeMode:'none'})})`);
    await wait("document.querySelector('video')?.currentTime>2 && document.querySelector('video')?.videoWidth>0",50000);
  };
  const choose=async label=>{
    if(!await evaluate("!!document.querySelector('.player-btn.focused')"))await key('ArrowUp');
    for(let i=0;i<16;i++){
      if(await evaluate("/Dolby Vision|4K|HLG|HDR|1080P/.test(document.querySelector('.player-btn.focused')?.innerText||'')"))break;
      await key('ArrowRight');
    }
    check('remote focuses the actual quality button',await evaluate("/Dolby Vision|4K|HLG|HDR|1080P/.test(document.querySelector('.player-btn.focused')?.innerText||'')"));
    await key('Enter');await wait("document.querySelectorAll('.quality-option').length>0");
    const items=await evaluate("Array.from(document.querySelectorAll('.quality-option')).map(e=>({text:e.innerText,focused:e.classList.contains('focused')}))");
    const target=items.findIndex(x=>x.text.startsWith(label));assert.ok(target>=0,'quality option must exist');
    let index=items.findIndex(x=>x.focused);assert.ok(index>=0,'quality focus must exist');
    while(index!==target){await key(index<target?'ArrowDown':'ArrowUp');index+=index<target?1:-1}
    await key('Enter');
  };
  await open({bvid:'BV1kX4y197P4',cid:1127214165,qn:126});
  await evaluate("document.querySelector('video').pause()");const before=await state();
  await choose('4K');await wait("window.__shakaPlayer?.getVariantTracks()?.some(t=>t.active && /^hvc1|^hev1/.test(t.videoCodec)) && document.querySelector('video')?.readyState>=2 && !document.querySelector('.player-page .loading')",25000);
  let current=await state();
  check('remote DV to 4K keeps premium audio, position and paused state',current.qn===120&&current.audio==='ec-3'&&current.paused&&Math.abs(current.time-before.time)<1&&current.width===3996,current);
  await choose('杜比视界');await wait("window.__shakaPlayer?.getVariantTracks()?.some(t=>t.active && /^dvh1.05/.test(t.videoCodec)) && document.querySelector('video')?.readyState>=2 && !document.querySelector('.player-page .loading')",25000);
  current=await state();check('remote 4K to Profile 5 restores actual DV at same position',current.qn===126&&current.audio==='ec-3'&&current.paused&&Math.abs(current.time-before.time)<1,current);
  await shot('profile5-controls-private');
  await evaluate("document.querySelector('video').currentTime=30;document.querySelector('video').play()");
  await wait("document.querySelector('video').currentTime>31 && document.querySelector('video').readyState>=2",25000);
  check('Profile 5 plays after an unbuffered seek',(await state()).width===3996,await state());
  await open({bvid:'BV1dCNC6hEzE',cid:39933052694,qn:126});
  current=await state();check('audited source uses transformed 60fps DV on hardware',current.runtime.phase==='playing'&&current.runtime.fragments>0&&current.frameRate===60&&/^dvh1/.test(current.codec),current);
  await evaluate("document.querySelector('video').currentTime=document.querySelector('video').duration-6");
  await wait("document.querySelector('video').currentTime>document.querySelector('video').duration-4",25000);
  current=await state();check('short final transformed fragment decodes after seek',!current.error&&current.runtime.phase==='playing'&&current.ready>=2,current);
  await shot('dolby60-final-private');
  await open({bvid:'BV1dCNC6hEzE',cid:39933052694,qn:126});
  await evaluate("document.querySelector('video').pause()");const recoveryStart=await state();
  // Controlled decoder-error notification; the resulting reload and decode are real.
  await evaluate("window.__shakaPlayer.dispatchEvent({type:'error',detail:{category:3,code:3016,severity:2}})");
  await wait("window.__dolbyRuntime?.().phase==='off' && window.__shakaPlayer?.getVariantTracks()?.some(t=>t.active && t.videoCodec==='hvc1.2.4.L156.90') && document.querySelector('video')?.readyState>=2",30000);
  current=await state();check('injected decoder error reloads same-qn HLG preserving audio, position and pause',current.qn===126&&current.audio==='ec-3'&&current.paused&&Math.abs(current.time-recoveryStart.time)<1,current);
  await evaluate("document.querySelector('video').play()");
  await wait(`document.querySelector('video').currentTime>${current.time+1}`,12000);
  check('real base-layer playback advances after controlled failure',true,await state());
  await back();
} catch(error){results.push({name:'completion',pass:false,detail:error.message});console.error(error.message);process.exitCode=1}
finally{
  if(evaluateState&&originalSettings!==undefined){
    try{await evaluateState(`${originalSettings==null?"localStorage.removeItem('bili_settings')":"localStorage.setItem('bili_settings',"+JSON.stringify(originalSettings)+")"};for(let i=0;i<4;i++)window.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true}))`)}catch{}
  }
  writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));ws?.close();server?.close();conn.end();
}
