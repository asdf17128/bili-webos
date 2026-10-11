// Playback recovery and creator-follow checks on the installed development TV.
// Relationship writes are intercepted; ordinary playback history still updates.
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { tvPassphrase } from './_tvpass.mjs';

const output = process.env.UX_OUTPUT || '/tmp/bili-recovery-follow-tv';

mkdirSync(output, { recursive: true });
const conn = new Client();
const results = [];
let originalSettings = null;
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
  };

  originalSettings = await evaluate('localStorage.getItem("bili_settings")');
  try {
    await call('Page.reload');await wait('!!window.__openVideo');
    await evaluate(`(() => {
      const request=window.webOS.service.request;
      window.__followTest={blockedWrites:0,readCode:null,attribute:null,failPlayback:true,playFailures:0};
      window.__restoreFollowTest=()=>{window.webOS.service.request=request;};
      window.webOS.service.request=function(uri,opt){
        const u=String(opt?.parameters?.url||'');
        if(u.includes('/relation/modify')) {
          window.__followTest.blockedWrites++;
          const timer=setTimeout(()=>opt.onSuccess({returnValue:true,body:JSON.stringify({code:-352})}),50);
          return {cancel(){clearTimeout(timer)}};
        }
        if(u.includes('/playurl?') && window.__followTest.failPlayback) {
          window.__followTest.playFailures++;
          const timer=setTimeout(()=>opt.onFailure({errorText:'getaddrinfo EAI_AGAIN api.bilibili.com'}),50);
          return {cancel(){clearTimeout(timer)}};
        }
        if(u.includes('/x/relation?')){
          const success=opt.onSuccess;
          opt={...opt,onSuccess:r=>{try{const b=JSON.parse(r.body);window.__followTest.readCode=b.code;window.__followTest.attribute=b.data?.attribute;}catch{};success?.(r)}};
        }
        return request.call(this,uri,opt);
      };
      window.__openVideo({bvid:'BV1xx411c7Xg',resumeMode:'at',progress:47});
    })()`);
    await wait(`Array.from(document.querySelectorAll('.player-btn')).some(x=>x.textContent==='重试播放')`,30000);
    check('TV surfaces injected resolver failure with a retry action',await evaluate('window.__followTest.playFailures>=2'));
    await capture('tv-retry');
    await evaluate('window.__followTest.failPlayback=false');
    await wait(`document.querySelector('video')?.currentTime>47.5 && document.querySelector('video')?.readyState>=2`,45000);
    check('TV automatic recovery decodes real media at the saved position',true);
    const before=await evaluate(`document.querySelector('video').currentTime`);
    await sleep(1800);
    check('TV recovered playback time continues moving',await evaluate(`document.querySelector('video').currentTime>${before+0.5}`));
    await key('ArrowUp');
    await wait(`Array.from(document.querySelectorAll('.player-control')).some(x=>x.textContent.includes('关注 UP 主'))`);
    await wait('window.__followTest.readCode!==null');
    const relation=await evaluate('({code:window.__followTest.readCode,attribute:window.__followTest.attribute})');
    check('TV reads real authenticated relationship API',relation.code===0&&typeof relation.attribute==='number',JSON.stringify(relation));
    await evaluate(`document.querySelector('video').pause()`);
    for(let i=0;i<15 && !(await evaluate(`document.querySelector('.player-control.focused')?.textContent.includes('关注 UP 主')`));i++) await key('ArrowRight');
    check('TV remote focuses the creator follow action',await evaluate(`document.querySelector('.player-control.focused')?.textContent.includes('关注 UP 主')`));
    await capture('tv-follow-control');
    await key('Enter');
    await wait('window.__followTest.blockedWrites===1');
    await wait(`document.querySelector('.player-page')?.innerText.includes('关注操作失败，请重试')`);
    check('TV follow failure is visible and real account writes are blocked',true);
    check('TV follow state stays unchanged after rejection',await evaluate(`Array.from(document.querySelectorAll('.player-control')).find(x=>x.textContent.includes('关注 UP 主')).textContent.includes('取消')===${(relation.attribute&2)!==0}`));
    await capture('tv-follow-rejected');
  } finally {
    await evaluate(`window.__restoreFollowTest?.();delete window.__restoreFollowTest;delete window.__followTest;`);
    await evaluate(originalSettings == null ? 'localStorage.removeItem("bili_settings")' : `localStorage.setItem('bili_settings',${JSON.stringify(originalSettings)})`);
    await call('Page.reload');
  }
} catch (error) { console.error(error.message); results.push({ name: 'completion', pass: false, detail: error.message }); process.exitCode = 1; }
finally {
  writeFileSync(`${output}/device.json`, JSON.stringify(results, null, 2));
  clearTimeout(overall); ws?.close(); server?.close(); conn.end();
}
