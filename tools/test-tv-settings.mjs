// Focus/scroll/playback checks on the installed development TV. No account writes
// beyond ordinary playback history; all timing-sensitive assertions share one CDP session.
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { tvPassphrase } from './_tvpass.mjs';

const output = process.env.UX_OUTPUT || '/tmp/bili-tv-settings';
mkdirSync(output, { recursive: true });
const conn = new Client();
const results = [];
let server, ws;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const overall = setTimeout(() => { console.error('TV UX check timed out'); process.exit(1); }, 180000);
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
  const state = () => evaluate(`(() => {
    const grid = document.querySelector('.video-grid');
    const focus = document.querySelector('[data-focus-id].focused');
    const card = document.querySelector('.video-card.focused');
    const box = card && card.getBoundingClientRect();
    const viewport = document.querySelector('.video-grid-viewport');
    const vp = viewport && viewport.getBoundingClientRect();
    const v = document.querySelector('video');
    return { focus: focus && focus.getAttribute('data-focus-id'), scroll: grid && grid.style.transform,
      cards: document.querySelectorAll('.video-card').length, modern: !!document.querySelector('.browse-header'),
      visible: !!box && !!vp && box.top >= vp.top && box.bottom <= vp.bottom + 1,
      video: v ? { t: v.currentTime, ready: v.readyState, paused: v.paused } : null,
      player: !!document.querySelector('.player-container, .player-placeholder'),
      redesigned: !!document.querySelector('.sidebar .tv-icon'),
      expanded: document.querySelector('.sidebar')?.dataset.expanded,
      mainX: document.querySelector('.main-content')?.getBoundingClientRect().x,
      broken: Array.from(document.querySelectorAll('.video-card-thumb img')).filter(i => i.complete && !i.naturalWidth).length };
  })()`);
  const wait = async (predicate, timeout = 20000) => {
    const end = Date.now() + timeout; let current;
    do { current = await state(); if (predicate(current)) return current; await sleep(400); } while (Date.now() < end);
    throw new Error('State timeout: ' + JSON.stringify(current));
  };
  const shot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${output}/${name}.png`, Buffer.from(image.data, 'base64')); };
  const check = (name, condition, detail) => { results.push({ name, pass: !!condition, detail }); console.log(condition ? 'PASS' : 'FAIL', name, detail || ''); assert.ok(condition, name); };


  const original = await evaluate('localStorage.getItem("bili_settings")');
  const goto = async row => {
    let s = await state();
    if (!s.focus?.startsWith('sidebar-')) await key('GoBack');
    for (let i = 0; i < 18; i++) {
      s = await state();
      if (s.focus === `sidebar-${row}-0`) break;
      await key('ArrowDown');
    }
    await key('Enter');
    await wait(s=>s.focus?.startsWith('content-'));
  };
  const pick = async index => {
    await key('Enter');
    for(let i=0;i<4;i++) await key('ArrowUp');
    for(let i=0;i<index;i++) await key('ArrowDown');
    await key('Enter');
  };
  try {
    await call('Page.reload'); await wait(s=>s.cards>5);
    for(const cols of [2,3,4]) {
      await goto(13);
      let row = Number((await state()).focus.split('-')[1]);
      while(row>3){await key('ArrowUp');row--;}
      while(row<3){await key('ArrowDown');row++;}
      await pick(cols-2);
      for(let n=0;n<3;n++)await key('ArrowDown');
      await pick(2); // largest UI size
      await goto(1); await wait(s=>s.cards>5); await sleep(700);
      const metrics=await evaluate(`(() => {const g=document.querySelector('.video-grid'),c=g.querySelector('.video-card');return {columns:getComputedStyle(g).gridTemplateColumns.split(' ').length,title:parseFloat(getComputedStyle(c.querySelector('.video-card-title')).fontSize),meta:parseFloat(getComputedStyle(c.querySelector('.video-card-meta')).fontSize),settings:JSON.parse(localStorage.getItem('bili_settings'))};})()`);
      check(`${cols} columns and largest text applied through settings`,metrics.columns===cols&&metrics.meta===22.5&&Math.abs(metrics.title-(cols===4?22:23)*1.25)<.1,JSON.stringify({columns:metrics.columns,title:metrics.title,meta:metrics.meta}));
      await shot(`tv-${cols}-largest`);
      for(let n=0;n<7;n++)await key('ArrowDown');
      check(`${cols} columns large-text deep card visible`,(await state()).visible);
      await call('Page.reload');await wait(s=>s.cards>5);await sleep(400);
      const persisted=await evaluate(`({cols:getComputedStyle(document.querySelector('.video-grid')).gridTemplateColumns.split(' ').length,scale:document.documentElement.style.getPropertyValue('--ui-scale')})`);
      check(`${cols} columns and text size persist after reload`,persisted.cols===cols&&persisted.scale==='1.25',JSON.stringify(persisted));
      await goto(12); await wait(s=>s.cards>5);
      for(let n=0;n<7;n++)await key('ArrowDown');
      await sleep(350);
      check(`${cols} columns library native scroll keeps the enlarged card visible`, await evaluate(`(() => {const e=document.querySelector('.library-page .video-card.focused');if(!e)return false;const b=e.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight;})()`));
      await shot(`tv-library-${cols}-largest`);
    }
  } finally {
    await evaluate(`localStorage.setItem('bili_settings',${JSON.stringify(original)})`);
    await call('Page.reload');await wait(s=>s.cards>5);
    writeFileSync(`${output}/device-settings.json`,JSON.stringify(results,null,2));
  }
} finally {
  clearTimeout(overall);
  ws?.close();server?.close();conn.end();
}
