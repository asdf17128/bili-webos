// Real TV logout/startup regression. Requires the owner's authorization to
// temporarily sign out. Restores the original credentials/settings in finally;
// private backup and screenshots stay outside the repository, never in reports.
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { tvPassphrase } from './_tvpass.mjs';

const output = process.env.UX_OUTPUT || '/tmp/bili-session-tv';
const baseline = process.argv.includes('--baseline');
mkdirSync(output, { recursive: true });
const conn = new Client(), results = [];
let server, ws, original, observerScript;
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
  original = { cookies: (await luna('getCookies')).cookies,
    storage: await evaluate(`Object.fromEntries(['bili_auth','bili_settings','bili_followed'].map(k=>[k,localStorage.getItem(k)]))`) };
  writeFileSync(`${output}/restore-private.json`, JSON.stringify(original), { mode: 0o600 });
  const nav = JSON.parse((await luna('fetch', { url: 'https://api.bilibili.com/x/web-interface/nav' })).body);
  assert.ok(nav.data?.isLogin, 'An authenticated session is required for the logout test');
  try {
    await shot('home-private');
    const status = await luna('ping');
    const ports = await evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('.video-card img')).map(i=>new URL(i.src).port)))`);
    check('TV thumbnails use the actual service port', ports.length === 1 && ports[0] === String(status.localProxyPort), { ports, service: status.localProxyPort });
    check('TV startup has decoded covers and a visible page', true);
    await key('GoBack');
    for (let n = 0; n < 18; n++) {
      if (await evaluate(`document.querySelector('[data-focus-id="sidebar-13-0"]')?.classList.contains('focused')`)) break;
      await key('ArrowDown');
    }
    await key('Enter'); await wait("!!document.querySelector('.config-page')");
    for (let n = 0; n < 14; n++) {
      if (await evaluate(`document.querySelector('[data-focus-id="content-11-0"]')?.classList.contains('focused')`)) break;
      await key('ArrowDown');
    }
    check('remote reaches the real logout row', await evaluate(`document.querySelector('.settings-row-danger')?.classList.contains('focused')`));
    if (!baseline) {
      await evaluate(`(() => {
        var request=window.webOS.service.request;window.__restoreLogoutRequest=()=>{window.webOS.service.request=request};
        window.webOS.service.request=function(uri,opt){
          if(opt.method==='clearCookies'){var timer=setTimeout(()=>opt.onFailure({errorText:'injected failure'}),50);return{cancel:()=>clearTimeout(timer)}}
          return request.call(this,uri,opt);
        };
      })()`);
      await key('Enter'); await wait(`document.querySelector('.toast')?.textContent==='退出登录失败，请重试'`);
      await evaluate('window.__restoreLogoutRequest();delete window.__restoreLogoutRequest');
      check('TV refuses false logout success and keeps retry reachable', (await luna('getDiagnostics')).loggedIn && await evaluate(`!!document.querySelector('.settings-row-danger')`));
    }
    await key('Enter'); await wait(`document.querySelector('.toast')?.textContent==='已退出登录'`);
    const diagnostic = await luna('getDiagnostics');
    check('real logout clears the TV service account', !diagnostic.loggedIn && !diagnostic.cookieKeys.includes('DedeUserID'), { loggedIn: diagnostic.loggedIn });
    const diskState = await new Promise((resolve, reject) => {
      conn.exec(`/usr/bin/node -e 'var j=JSON.parse(require("fs").readFileSync("/media/internal/bili_cookies.json","utf8"));console.log(JSON.stringify({account:!!(j.SESSDATA||j.DedeUserID||j.bili_jct)}))'`, (err, stream) => {
        if (err) { reject(err); return; } let out=''; stream.on('data', d=>out+=d); stream.on('close', ()=>{try{resolve(JSON.parse(out))}catch(e){reject(new Error('Could not read persisted cookie state'))}});
      });
    });
    check('TV persisted cookie file has no account credentials', !diskState.account);
    check('TV frontend credentials and account UI are cleared', await evaluate(`!JSON.parse(localStorage.getItem('bili_auth')||'{}').SESSDATA && !!document.querySelector('.sidebar-user-login')`));
    const anonymous = JSON.parse((await luna('fetch', { url: 'https://api.bilibili.com/x/web-interface/nav' })).body);
    check('real Bilibili API confirms anonymous after logout', anonymous.code === -101 || anonymous.data?.isLogin === false, { code: anonymous.code });
    await reload();
    check('reload keeps the TV logged out', !(await luna('getDiagnostics')).loggedIn && await evaluate(`!!document.querySelector('.sidebar-user-login')`));
    await shot('logout-private');
    observerScript = (await call('Page.addScriptToEvaluateOnNewDocument', { source: "window.__legacyObserverProbe={ran:true,removed:delete IntersectionObserverEntry.prototype.isIntersecting};" })).identifier;
    await reload();
    const legacy = await evaluate(`({probe:window.__legacyObserverProbe,hasProperty:'isIntersecting' in IntersectionObserverEntry.prototype,firstWidth:document.querySelector('.video-card img')?.naturalWidth})`);
    check('TV renders covers with isIntersecting removed', legacy.probe?.removed && !legacy.hasProperty && legacy.firstWidth>0, legacy);
    for (let n=0;n<7;n++) await key('ArrowDown');
    await wait(`document.querySelector('.video-card.focused img')?.naturalWidth>0`);
    check('TV scrolling loads covers with legacy observer API', true);
    await shot('legacy-observer-private');
  } finally {
    if (observerScript) { await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: observerScript }); observerScript = null; }
    await evaluate('window.__restoreLogoutRequest?.();delete window.__restoreLogoutRequest');
    await luna('clearCookies'); await luna('setCookies', { cookies: original.cookies });
    await evaluate(`Object.entries(${JSON.stringify(original.storage)}).forEach(([key,value])=>{if(value==null)localStorage.removeItem(key);else localStorage.setItem(key,value)})`);
    await reload();
    const restored = JSON.parse((await luna('fetch', { url: 'https://api.bilibili.com/x/web-interface/nav' })).body);
    check('original TV account and settings restored', restored.data?.isLogin && restored.data.mid === nav.data.mid && await evaluate('localStorage.getItem("bili_settings")') === original.storage.bili_settings);
    unlinkSync(`${output}/restore-private.json`);
  }
} catch (e) {
  results.push({ name: 'completion', pass: false, detail: e.message });
  console.error(e.message); process.exitCode = 1;
} finally {
  writeFileSync(`${output}/${baseline ? 'before' : 'after'}.json`, JSON.stringify(results, null, 2));
  ws?.close(); server?.close(); conn.end();
}
