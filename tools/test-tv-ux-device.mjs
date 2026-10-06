// Focus/scroll/playback checks on the installed development TV. No account writes
// beyond ordinary playback history; all timing-sensitive assertions share one CDP session.
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { tvPassphrase } from './_tvpass.mjs';

const output = process.env.UX_OUTPUT || '/tmp/bili-tv-ux';
const navigationOnly = process.argv.includes('--navigation-only');
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

  await call('Page.reload');
  let current = await wait(s => s.modern && s.cards > 5);
  if (current.focus?.startsWith('sidebar-')) await key('ArrowRight');
  await wait(s => s.focus?.startsWith('content-0-'));
  await sleep(1200); await shot('tv-home');
  current = await state(); check('new TV build renders with visible focus', current.modern && current.visible, current.focus);
  check('gallery rail renders vector icons and collapses while browsing', current.redesigned && current.expanded === 'false');
  for (let i = 0; i < 3; i++) await key('ArrowDown');
  await key('ArrowRight');
  const before = await state();
  await key('GoBack');
  current = await state(); check('Back to sidebar preserves exact scroll offset', current.scroll === before.scroll && current.focus?.startsWith('sidebar-'), `${before.scroll} -> ${current.scroll}`);
  check('expanded drawer does not move the content surface', current.expanded === 'true' && current.mainX === before.mainX);
  await shot('tv-drawer');
  await key('ArrowRight'); current = await state();
  check('Right restores the exact card', current.focus === before.focus && current.scroll === before.scroll, current.focus);
  await key('GoBack'); await key('Enter');
  current = await wait(s => s.focus === 'content-0-0' && s.scroll === 'translateY(0px)' && s.cards > 5);
  check('OK explicitly refreshes and resets to row zero', true, current.focus);
  for (let i = 0; i < 10; i++) await key('ArrowDown');
  await sleep(600); current = await state();
  check('deep grid card stays fully inside its real viewport', current.visible, current.focus);
  await shot('tv-deep-grid');
  if (!navigationOnly) {
    const playbackOrigin = await state();
    await key('Enter');
    current = await wait(s => s.video && s.video.t > 0.5 && s.video.ready >= 2, 35000);
    check('real video starts', true, `t=${current.video.t.toFixed(1)}s ready=${current.video.ready}`);
    await key('Enter');
    check('OK pauses actual playback', (await state()).video?.paused);
    await key('Enter');
    await wait(s => s.video && !s.video.paused);
    check('OK resumes actual playback', true);
    const seekOrigin = (await state()).video.t;
    const seekKey = seekOrigin > 20 ? 'ArrowLeft' : 'ArrowRight';
    await key(seekKey);
    check('scrub keeps playback near the original position before confirmation', Math.abs((await state()).video.t - seekOrigin) < 3);
    await key('GoBack');
    check('Back cancels pending scrub without leaving playback', Math.abs((await state()).video.t - seekOrigin) < 4);
    const commitOrigin = (await state()).video.t;
    await key(seekKey); await key('Enter'); await sleep(1000);
    const committed = (await state()).video.t;
    check('OK commits scrub to its new position', seekKey === 'ArrowLeft' ? committed < commitOrigin - 5 : committed > commitOrigin + 5, `${commitOrigin.toFixed(1)} -> ${committed.toFixed(1)}`);
    // Screenshot encoding on the TV can exceed scrub's 1s commit window.
    // Capture a separate preview after timing-sensitive cancel/OK assertions.
    await key(seekKey); await shot('tv-scrub');
    await key('ArrowUp'); await shot('tv-player');
    check('player uses the shared icon control shelf', await evaluate('document.querySelectorAll(".player-control .tv-icon").length > 3'));
    const popup = async (name, pattern) => {
      for (let i = 0; i < 14; i++) {
        const label = await evaluate('document.querySelector(".player-btn.focused")?.textContent || ""');
        if (pattern.test(label)) break;
        await key('ArrowRight');
      }
      const origin = await evaluate('document.querySelector(".player-btn.focused")?.textContent');
      assert.ok(pattern.test(origin || ''), `${name} control reachable`);
      await key('Enter');
      check(`${name} popup opens on the selected option`, await evaluate('!!document.querySelector(".ctrl-popup .quality-option.focused.active")'));
      await shot(`tv-${name}`);
      await key('GoBack');
      check(`${name} Back closes only its popup and restores the control`, await evaluate(`!document.querySelector('.ctrl-popup') && !!document.querySelector('.player-controls:not(.hidden)') && document.querySelector('.player-btn.focused')?.textContent === ${JSON.stringify(origin)}`));
    };
    await popup('speed', /倍速|Speed|Velocidad/);
    await popup('quality', /\d+P|HDR|杜比|Dolby|8K/);
    for (let i = 0; i < 6 && (await state()).video; i++) await key('GoBack');
    current = await state();
    check('leaving playback restores card and scroll', !current.video && current.focus === playbackOrigin.focus && current.scroll === playbackOrigin.scroll, current.focus);
    await shot('tv-return');
  }
  // Leave a clean home screen ready for the owner to inspect.
  await key('GoBack'); await key('Enter');
  await wait(s => s.focus === 'content-0-0' && s.cards > 5);
  await sleep(1200); await shot('tv-home');
  const hasResume = await evaluate('document.querySelectorAll(".resume-card").length > 0');
  if (hasResume) {
    await key('ArrowUp'); current = await state();
    check('resume shelf is reachable directly above the first feed row', current.focus === 'content--1-0');
    await shot('tv-resume');
    if (!navigationOnly) {
      const position = await evaluate('Number(document.querySelector(".resume-card.focused").dataset.resumeAt)');
      await key('Enter');
      current = await wait(s => s.video && s.video.ready >= 2 && s.video.t >= position - 1, 35000);
      check('continue watching starts at the displayed saved position', current.video.t < position + 20, `saved=${position}s actual=${current.video.t.toFixed(1)}s`);
      for (let i = 0; i < 6 && (await state()).video; i++) await key('GoBack');
      current = await state();
      check('leaving a resumed video restores the resume card', !current.video && current.focus === 'content--1-0', current.focus);
    }
    await key('ArrowDown');
  }
  if (!navigationOnly) {
    await evaluate("window.__openVideo({bvid:'BV1xx411c7Xg',resumeMode:'none'})");
    await wait(s => s.video && s.video.t > 0.5 && s.video.ready >= 2, 35000);
    await evaluate('document.querySelector("video").currentTime = document.querySelector("video").duration - 0.25');
    await wait(s => s.video && s.video.paused, 15000);
    await sleep(500);
    check('ended video exposes replay and the navigable related panel', await evaluate('!!document.querySelector(".panel-tab-row") && !!document.querySelector(".related-card") && /重播|Replay|Repetir/.test(document.querySelector(".player-btn")?.textContent || "")'));
    await key('ArrowUp'); // cancels up-next, then goes to the tabs
    await shot('tv-ended');
    await key('ArrowUp'); await key('Enter');
    current = await wait(s => s.video && !s.video.paused && s.video.t < 8 && s.video.ready >= 2, 15000);
    check('replay remains reachable with the remote after playback ends', true, `t=${current.video.t.toFixed(1)}`);
    for (let i = 0; i < 6 && (await state()).video; i++) await key('GoBack');
  }
  await key('GoBack'); await key('ArrowUp'); await key('ArrowRight');
  await sleep(1000);
  check('search presents its native input and two discovery columns', await evaluate('!!document.querySelector(".search-input") && document.querySelectorAll(".search-discovery .search-recs").length === 2'));
  await shot('tv-search');
  await key('GoBack'); await key('ArrowUp'); await key('ArrowRight');
  await sleep(400);
  check('preferences use the two-column layout', await evaluate('!!document.querySelector(".config-intro") && !!document.querySelector(".config-options")'));
  await shot('tv-settings');
  const settingLabel = () => evaluate('document.querySelector(".config-options .settings-row.focused > span")?.textContent');
  const settingOrder = ['弹幕', '看完移出稍后再看', '播完自动播放下一个', '每行视频', '弹幕字号', '字幕字号', '界面字号', 'CDN 线路'];
  // Use the current UI's DOM order so this also works in English/Spanish.
  const visibleOrder = await evaluate('Array.from(document.querySelectorAll(".config-options > .settings-row")).slice(0,8).map(e=>e.firstElementChild.textContent)');
  const downward = [await settingLabel()];
  for (let i = 1; i < settingOrder.length; i++) { await key('ArrowDown'); downward.push(await settingLabel()); }
  const upward = [await settingLabel()];
  for (let i = 1; i < settingOrder.length; i++) { await key('ArrowUp'); upward.push(await settingLabel()); }
  check('settings move in the same order as the screen in both directions',
    JSON.stringify(downward) === JSON.stringify(visibleOrder) && JSON.stringify(upward) === JSON.stringify(visibleOrder.slice().reverse()), downward.join(' -> '));
  const previousSettings = await evaluate('localStorage.getItem("bili_settings")');
  for (let i = 0; i < 4; i++) await key('ArrowDown');
  const pickerResults = [];
  for (let i = 4; i <= 6; i++) {
    const origin = await settingLabel();
    await key('Enter');
    const title = await evaluate('document.querySelector(".settings-picker > div")?.textContent');
    await key('ArrowDown'); await key('GoBack');
    pickerResults.push(title === visibleOrder[i] && origin === await settingLabel());
    await key('ArrowDown');
  }
  check('all font pickers open for the selected row and cancel without changing settings',
    pickerResults.every(Boolean) && previousSettings === await evaluate('localStorage.getItem("bili_settings")'));

  await key('GoBack');
  check('bottom navigation focus remains visible when the drawer opens', await evaluate(`(() => {
    const e = document.querySelector('.sidebar-item.focused'), n = e.closest('nav');
    return e.getBoundingClientRect().bottom <= n.getBoundingClientRect().bottom + 1;
  })()`));
  await key('ArrowDown'); await key('ArrowDown'); await key('ArrowRight');
  await wait(s => s.focus?.startsWith('content-') && s.cards > 5);
  await sleep(500); await shot('tv-home');
} catch (error) { console.error(error.message); results.push({ name: 'completion', pass: false, detail: error.message }); process.exitCode = 1; }
finally {
  writeFileSync(`${output}/device.json`, JSON.stringify(results, null, 2));
  clearTimeout(overall); ws?.close(); server?.close(); conn.end();
}
