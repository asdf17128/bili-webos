// 外部量法:测量代码**不在 app 里**,而是从 CDP 注入。
// 为什么需要它:我们把观测代码从发布构建里剥掉了(PERF=0),自家的
// window.__perf 就没了 —— 要证明"剥离之后手感没变差/变好",只能用一把
// 两种构建都适用的外部尺子。
//
// 量的是"跟手":dispatch keydown 的时刻 → .focused 类真正落到新卡片上的时刻
// (MutationObserver 观察 class 属性变化)。和 app 内打点口径接近,但完全独立。
//
// Usage: node tools/perf-external.mjs <label>
import { readFileSync, appendFileSync } from 'fs';
import { Client } from 'ssh2';
import http from 'http';
import net from 'net';
import { WebSocket } from 'ws';
import { tvPassphrase } from './_tvpass.mjs';

const LABEL = process.argv[2] || 'ext';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10; };

const conn = new Client();
conn.on('ready', () => {
  net.createServer(s => conn.forwardOut('127.0.0.1', 0, '127.0.0.1', 9998, (e, rs) => e ? s.end() : s.pipe(rs).pipe(s)))
    .listen(19995, '127.0.0.1', async () => {
      const list = await new Promise(res => http.get('http://127.0.0.1:19995/json/list', r => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res([]); } });
      }).on('error', () => res([])));
      const app = list.find(p => p.url && p.url.includes('com.biliwebos.app'));
      if (!app) { console.error('app 不在前台,先 node tools/launch.mjs'); process.exit(1); }
      const ws = new WebSocket(app.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, '127.0.0.1:19995'), { perMessageDeflate: false });
      let id = 1;
      const call = (method, params) => new Promise((resolve, reject) => {
        const myId = id++;
        ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
        const h = (raw) => { const m = JSON.parse(raw); if (m.id === myId) { ws.off('message', h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
        ws.on('message', h);
      });
      const evalJS = async (e) => (await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;
      await new Promise(r => ws.on('open', r));
      await call('Runtime.enable');

      // 注入外部尺子:记录每次 keydown 到 .focused 落位之间的间隔
      await evalJS(`(function(){
        window.__ext = { samples: [], t0: 0 };
        window.addEventListener('keydown', function(){ window.__ext.t0 = performance.now(); }, true);
        new MutationObserver(function(muts){
          if (!window.__ext.t0) return;
          for (var i=0;i<muts.length;i++){
            var el = muts[i].target;
            if (el.classList && el.classList.contains('focused')) {
              window.__ext.samples.push(performance.now() - window.__ext.t0);
              window.__ext.t0 = 0; return;
            }
          }
        }).observe(document.body, { subtree:true, attributes:true, attributeFilter:['class'] });
        return 1;
      })()`);

      const key = async (k) => {
        const m = { down: ['ArrowDown', 40], up: ['ArrowUp', 38], right: ['ArrowRight', 39], left: ['ArrowLeft', 37] }[k];
        await call('Input.dispatchKeyEvent', { type: 'keyDown', key: m[0], windowsVirtualKeyCode: m[1], nativeVirtualKeyCode: m[1] });
        await call('Input.dispatchKeyEvent', { type: 'keyUp', key: m[0], windowsVirtualKeyCode: m[1], nativeVirtualKeyCode: m[1] });
      };
      await key('right'); await sleep(800);
      await evalJS('window.__ext.samples.length = 0');
      for (let i = 0; i < 40; i++) { await key(i % 4 === 3 ? 'down' : (i % 2 ? 'left' : 'right')); await sleep(230); }
      await sleep(1200);
      const s = JSON.parse(await evalJS('JSON.stringify(window.__ext.samples)') || '[]');
      const mem = JSON.parse(await evalJS('JSON.stringify(performance.memory?{used:Math.round(performance.memory.usedJSHeapSize/1048576),total:Math.round(performance.memory.totalJSHeapSize/1048576)}:null)') || 'null');
      console.log(`[${LABEL}] 跟手(外部尺): p50 ${q(s, .5)}ms · p95 ${q(s, .95)}ms · n=${s.length} | 内存 ${mem ? mem.used + 'MB/堆' + mem.total + 'MB' : '?'}`);
      appendFileSync('tools/.perf-runs.jsonl', JSON.stringify({ ts: new Date().toISOString(), label: LABEL, env: 'tv-external',
        focusExternal: { p50: q(s, .5), p95: q(s, .95), n: s.length }, mem }) + '\n');
      ws.close(); conn.end(); process.exit(0);
    });
}).on('error', e => { console.error('ssh:', e.message); process.exit(1); })
  .connect({ host: '192.168.50.94', port: 9922, username: 'prisoner',
    privateKey: readFileSync(process.env.HOME + '/.ssh/tv_webos'), passphrase: tvPassphrase(),
    algorithms: { serverHostKey: ['ssh-rsa'] } });
