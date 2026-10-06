// Focus/scroll/playback checks on the installed development TV. No account writes
// beyond ordinary playback history; all timing-sensitive assertions share one CDP session.
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { tvPassphrase } from './_tvpass.mjs';

const output = process.env.END_OUTPUT || '/tmp/bili-playback-end-tv';

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
    const shot = await call('Page.captureScreenshot', { format: 'png', clip: {x:650,y:50,width:1220,height:730,scale:1} });
    const bytes = Buffer.from(shot.data, 'base64');
    writeFileSync(`${output}/${name}.png`, bytes);

  };
  originalSettings = await evaluate('localStorage.getItem("bili_settings")');
  const setMode = async mode => evaluate(`(() => {
    const s=JSON.parse(localStorage.getItem('bili_settings')||'{}');
    s.language='zh';s.toviewAutoRemove=false;
    if(${JSON.stringify(mode)}==='legacy-stop'){delete s.playbackMode;s.autoplayNext=false;}
    else s.playbackMode=${JSON.stringify(mode)};
    localStorage.setItem('bili_settings',JSON.stringify(s));
  })()`);
  const exit = async () => {
    for(let i=0;i<6 && await evaluate('!!document.querySelector(".player-page")');i++)await key('GoBack');
    assert.equal(await evaluate('!!document.querySelector(".player-page")'),false);
  };
  const open = async () => {
    await exit();
    await evaluate(`(() => {
      window.__endEvents=0;
      const a={bvid:'BV1xx411c7Xg'},b={bvid:'BV1GJ411x7h7'};
      window.__openVideo({...a,playlist:[a,b],playlistIndex:0,resumeMode:'none'});
    })()`);
    await wait('document.querySelector("video")?.currentTime > 0.5 && document.querySelector("video")?.readyState >= 3',45000);
    await evaluate(`(() => {
      window.__endVideo=document.querySelector('video');
      window.__endVideo.addEventListener('ended',()=>window.__endEvents++);
    })()`);
  };
  const finish = async () => {
    const count=await evaluate('window.__endEvents');
    await evaluate('window.__endVideo.currentTime=window.__endVideo.duration-0.7');
    await wait(`window.__endEvents > ${count}`,25000);
  };
  try {
    await setMode('legacy-stop');await call('Page.reload');await wait('!!window.__openVideo');
    await open();await finish();await sleep(1800);
    check('legacy off stops real favorite playlist at native EOS',await evaluate(`document.querySelector('video')===window.__endVideo && window.__endVideo.ended && window.__endVideo.paused && !/秒后自动播放/.test(document.body.textContent)`));
    if(!process.argv.includes('--baseline')) {
      await key('ArrowUp');await key('ArrowUp');await key('Enter');
      await wait('document.querySelector("video")?.currentTime > 0.2 && document.querySelector("video")?.currentTime < 8 && !document.querySelector("video")?.paused');
      check('remote replay is reachable after stop',true);
      await exit();await setMode('repeat');await open();
      for(let i=0;i<2;i++) {
        await finish();
        await wait('window.__endVideo.currentTime > 0.4 && window.__endVideo.currentTime < 8 && !window.__endVideo.paused && window.__endVideo.readyState >= 3',25000);
        check('repeat retains actual stream and plays again, cycle '+(i+1),await evaluate('document.querySelector("video")===window.__endVideo && !/秒后自动播放/.test(document.body.textContent)'),JSON.stringify(await evaluate('({time:window.__endVideo.currentTime,width:window.__endVideo.videoWidth,height:window.__endVideo.videoHeight})')));
      }
      await key('Enter');await sleep(300);
      check('remote can pause repeat mode',await evaluate('window.__endVideo.paused'));
      await key('Enter');await wait('!window.__endVideo.paused');
      check('remote can resume repeat mode',true);
      await exit();check('Back exits repeat playback',true);
      await setMode('next');await open();await finish();
      await wait('document.querySelector("video")!==window.__endVideo && document.querySelector("video")?.currentTime > 0.5 && document.querySelector("video")?.readyState >= 3',45000);
      check('next mode advances real playlist and decodes next video',true);
      await exit();await setMode('stop');await call('Page.reload');await wait('!!window.__openVideo');
      await evaluate(`Array.from(document.querySelectorAll('.sidebar-item')).find(e=>e.textContent.includes('设置')).click()`);
      await wait('!!document.querySelector(".config-page")');
      await key('ArrowRight');await wait('document.querySelector(".settings-row.focused")?.getAttribute("data-focus-id")==="content-0-0"');
      await key('ArrowDown');await key('ArrowDown');await key('Enter');
      await wait('!!document.querySelector(".settings-picker")');
      check('playback picker restores stop selection',await evaluate('Array.from(document.querySelectorAll(".settings-picker > div")).find(e=>getComputedStyle(e).backgroundColor==="rgb(244, 244, 246)")?.textContent.includes("播完停止")'));
      await key('ArrowDown');await key('GoBack');
      check('Back cancels mode change',await evaluate('JSON.parse(localStorage.getItem("bili_settings")).playbackMode==="stop"'));
      await key('Enter');await key('ArrowDown');await key('Enter');
      check('remote selects repeat and retains row focus',await evaluate('JSON.parse(localStorage.getItem("bili_settings")).playbackMode==="repeat" && document.querySelector(".settings-row.focused")?.getAttribute("data-focus-id")==="content-2-0"'));
      await call('Page.reload');await wait('!!window.__openVideo');
      await evaluate(`Array.from(document.querySelectorAll('.sidebar-item')).find(e=>e.textContent.includes('设置')).click()`);
      await wait('!!document.querySelector(".config-page")');
      check('repeat setting persists after app reload',await evaluate('document.querySelector("[data-focus-id=content-2-0] .settings-row-value")?.textContent==="单集循环"'));
      await key('ArrowRight');await key('ArrowDown');await key('ArrowDown');await key('Enter');await wait('!!document.querySelector(".settings-picker")');
      await capture('tv-playback-picker');
    }
  } finally {
    await evaluate(originalSettings == null ? 'localStorage.removeItem("bili_settings")' : `localStorage.setItem('bili_settings',${JSON.stringify(originalSettings)})`);
    await call('Page.reload');await wait('!!window.__openVideo');
    check('original user settings restored',await evaluate('localStorage.getItem("bili_settings")')===originalSettings);
  }
} catch(error) {console.error(error.message);results.push({name:'completion',pass:false,detail:error.message});process.exitCode=1;}
finally {
  writeFileSync(`${output}/device.json`,JSON.stringify(results,null,2));
  clearTimeout(overall);ws?.close();server?.close();conn.end();
}
