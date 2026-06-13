// On-device UI smoke test for the Bilibili webOS TV app.
//
// Drives the *installed* app on the TV via CDP (remote-control key events) and
// asserts on the live DOM — the same scenarios verified by hand: navigation,
// video playback, the player tabs, live + danmaku, live-in-history, search, the
// follow list, and the settings auto-update check.
//
// Prereq: app installed & running on the TV, Developer Mode on (same setup as
// tools/drive.mjs). Run:  node tools/test-ui.mjs [pass]
//
// Exit code is non-zero if any hard check fails (CI-friendly). "⚠️" lines are
// soft (network/timing dependent, e.g. a quiet live room with no danmaku yet).
import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import http from 'http';
import net from 'net';
import { WebSocket } from 'ws';

const TV = { host: '192.168.50.94', port: 9922 };
const PASS = process.argv[2] || '4E7082';
const PER_KEY_MS = 320;

const KEYMAP = {
  up: { key: 'ArrowUp', vk: 38 }, down: { key: 'ArrowDown', vk: 40 },
  left: { key: 'ArrowLeft', vk: 37 }, right: { key: 'ArrowRight', vk: 39 },
  ok: { key: 'Enter', vk: 13 }, back: { key: 'Backspace', vk: 8 },
};
// Sidebar order — keep in sync with NAV_ITEMS in app/src/App.jsx.
const NAV = { recommend: 0, hot: 1, live: 2, partition: 3, follow: 4, search: 5, settings: 6, config: 7 };

// One probe reads every field the tests assert on, in a single round-trip.
const PROBE = `JSON.stringify({
  focus: document.querySelector('[data-focus-id].focused')?.getAttribute('data-focus-id') || null,
  v: (function(){var v=document.querySelector('video');return v?{t:+v.currentTime.toFixed(1),ready:v.readyState,paused:v.paused}:null})(),
  cards: document.querySelectorAll('.video-card').length,
  relatedCards: document.querySelectorAll('.related-card').length,
  tabRow: !!document.querySelector('.panel-tab-row'),
  panelText: (document.querySelector('.panel-tab-row')?.innerText || ''),
  danmakuBox: !!document.querySelector('.danmaku-container'),
  danmakuItems: document.querySelectorAll('.danmaku-item').length,
  checkUpdate: (function(){var r=Array.from(document.querySelectorAll('.settings-row')).find(function(x){return x.innerText.indexOf('检查更新')>=0});return r?(r.querySelector('.settings-row-value')?.innerText||'').trim():null})(),
  liveBadge: Array.from(document.querySelectorAll('.video-card-duration')).some(function(e){return e.innerText.indexOf('直播')>=0}),
  recentLive: (function(){try{return JSON.parse(localStorage.getItem('bili_recentLive')||'[]').length}catch(e){return -1}})(),
  imgs: document.querySelectorAll('img').length,
  broken: Array.from(document.querySelectorAll('img')).filter(function(i){return i.complete&&i.naturalWidth===0}).length
})`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0, warned = 0;
const ok = (n, d) => { passed++; console.log(`  ✅ ${n}${d ? ': ' + d : ''}`); };
const fail = (n, d) => { failed++; console.log(`  ❌ ${n}${d ? ': ' + d : ''}`); };
const warn = (n, d) => { warned++; console.log(`  ⚠️  ${n}${d ? ': ' + d : ''}`); };
const check = (n, cond, d) => (cond ? ok(n, d) : fail(n, d));

async function main(call) {
  await call('Runtime.enable');
  await call('Page.enable');

  const evalJSON = async (expr) => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
    try { return JSON.parse(r?.result?.value); } catch { return {}; }
  };
  const probe = () => evalJSON(PROBE);

  const key = async (k) => {
    const m = KEYMAP[k];
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: m.key, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: m.key, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk });
    await sleep(PER_KEY_MS);
  };
  const keyN = async (k, n) => { for (let i = 0; i < n; i++) await key(k); };
  const press = async (seq) => { for (const k of seq) await key(k); };

  // Poll the probe until pred(state) is true (or timeout). Returns last state.
  const waitFor = async (pred, { timeout = 8000, interval = 300 } = {}) => {
    const start = Date.now();
    let s = await probe();
    while (!pred(s)) {
      if (Date.now() - start > timeout) return s;
      await sleep(interval);
      s = await probe();
    }
    return s;
  };

  const reload = async () => {
    await call('Page.reload', { ignoreCache: false });
    await waitFor(s => s.cards > 0 || (s.focus && s.focus.startsWith('content-')), { timeout: 15000 });
    await sleep(700);
  };

  // Navigate to a top-level page: get to the sidebar, snap to the top, step down
  // to the target, then OK to enter the content (new nav: OK enters content).
  const goto = async (pageKey) => {
    const s = await probe();
    if (s.focus && s.focus.startsWith('content-')) await key('back'); // content → sidebar
    await keyN('up', 8);
    await keyN('down', NAV[pageKey]);
    await key('ok');
    return waitFor(s2 => s2.focus && s2.focus.startsWith('content-'), { timeout: 6000 });
  };

  const exitPlayer = async () => {
    for (let i = 0; i < 4; i++) {
      const s = await probe();
      if (!s.v) break;
      await key('back');
      await sleep(400);
    }
  };

  // ───────────────────────── Tests ─────────────────────────

  async function testNavAndHome() {
    console.log('\n[Navigation + Home]');
    await reload();
    const s = await goto('recommend');
    check('Home loads video cards', s.cards > 0, `${s.cards} cards`);
    check('No broken thumbnails', s.broken === 0, `${s.broken} broken / ${s.imgs} imgs`);
    check('OK entered content (focus in grid)', !!s.focus && s.focus.startsWith('content-'), s.focus);

    // Back returns to the sidebar (one press), not straight out of the page.
    await key('back');
    const b = await probe();
    check('Back returns focus to sidebar', !!b.focus && b.focus.startsWith('sidebar-'), b.focus);
  }

  async function testVideoPlayback() {
    console.log('\n[Video playback + player panel]');
    await reload();
    await goto('recommend');
    await key('ok'); // play first card
    let s = await waitFor(x => x.v && x.v.t > 0, { timeout: 18000, interval: 500 });
    check('Video starts playing', !!(s.v && s.v.t > 0), s.v ? `t=${s.v.t}s ready=${s.v.ready}` : 'no <video>');
    if (s.v && s.v.t > 0) {
      const t1 = s.v.t;
      await sleep(4000);
      s = await probe();
      check('Playback advances (no immediate freeze)', s.v && s.v.t > t1, s.v ? `${t1}s → ${s.v.t}s` : 'video gone');
    }
    // Open the tabbed panel: Down (controls) then Down (related/UP tabs).
    await press(['down', 'down']);
    s = await waitFor(x => x.tabRow, { timeout: 4000 });
    check('Player tab row visible', s.tabRow);
    check('相关推荐 + UP主投稿 tabs present', s.panelText.includes('相关推荐') && s.panelText.includes('UP主投稿'), s.panelText.replace(/\n/g, ' '));
    check('相关推荐 has cards (recommended w/ upload time)', s.relatedCards > 0, `${s.relatedCards} cards`);
    // Switch to UP主投稿 tab → uploader's own videos load.
    await key('right');
    s = await waitFor(x => x.relatedCards > 0, { timeout: 8000 });
    check('UP主投稿 tab loads videos', s.relatedCards > 0, `${s.relatedCards} cards`);
    await exitPlayer();
  }

  async function testLiveAndDanmaku() {
    console.log('\n[Live playback + danmaku + history]');
    await reload();
    let s = await goto('live');
    check('Live list loads', s.cards > 0, `${s.cards} rooms`);
    await key('ok'); // enter first live room
    s = await waitFor(x => x.v && x.v.t > 0, { timeout: 22000, interval: 600 });
    check('Live stream plays', !!(s.v && s.v.t > 0), s.v ? `t=${s.v.t}s ready=${s.v.ready}` : 'no <video>');
    check('Danmaku layer mounted', s.danmakuBox);
    // Danmaku depends on a live, populated chat — give it a few seconds.
    s = await waitFor(x => x.danmakuItems > 0, { timeout: 9000, interval: 700 });
    if (s.danmakuItems > 0) ok('Danmaku rendering', `${s.danmakuItems} on screen`);
    else warn('Danmaku rendering', 'no items yet (quiet room?) — layer present');
    await exitPlayer();
    // Live-in-history: the room we just watched is recorded locally.
    s = await probe();
    check('Live room recorded to recentLive', s.recentLive > 0, `${s.recentLive} stored`);
    s = await goto('settings');
    await waitFor(x => x.cards > 0, { timeout: 8000 });
    s = await probe();
    check('Live shows in 我的 → 最近观看 with 直播 badge', s.liveBadge, `cards=${s.cards}`);
  }

  async function testSearch() {
    console.log('\n[Search]');
    await reload();
    await goto('search'); // focus on OSK key "1" (content-0-0)
    // Type "a": down,down → A (content-2-0), OK; then down,right*8 → 搜索, OK.
    await press(['down', 'down', 'ok']);
    await press(['down', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'ok']);
    const s = await waitFor(x => x.cards > 0, { timeout: 12000, interval: 500 });
    check('Search returns a results grid', s.cards > 0, `${s.cards} results for "a"`);
  }

  async function testFollowPagination() {
    console.log('\n[Follow list + pagination]');
    await reload();
    let s = await goto('follow');
    s = await waitFor(x => x.cards > 0, { timeout: 10000, interval: 500 });
    check('Follow list loads', s.cards > 0, `${s.cards} cards`);
    const before = s.cards;
    await keyN('down', 12); // scroll toward the end to trigger the next page
    await sleep(1500);
    s = await probe();
    if (s.cards > before) ok('Pagination loads more', `${before} → ${s.cards}`);
    else warn('Pagination loads more', `still ${s.cards} (few follows or end reached)`);
  }

  async function testSettingsAutoCheck() {
    console.log('\n[Settings auto update-check]');
    await reload();
    await goto('config');
    // The 检查更新 row auto-runs on mount; its value should populate w/o input.
    const s = await waitFor(x => x.checkUpdate && x.checkUpdate !== '检查中…', { timeout: 9000, interval: 400 });
    check('Auto update-check populated', !!s.checkUpdate, s.checkUpdate);
    check('Update-check resolved (latest/new/version)', /已是最新|发现新版|v?\d+\.\d+\.\d+/.test(s.checkUpdate || ''), s.checkUpdate);
  }

  async function testHotAndPartition() {
    console.log('\n[热门 / 分区]');
    await reload();
    let s = await goto('hot');
    s = await waitFor(x => x.cards > 0 || x.imgs > 3, { timeout: 9000 });
    check('热门 loads content', s.cards > 0 || s.imgs > 3, `${s.cards} cards / ${s.imgs} imgs`);
    s = await goto('partition');
    s = await waitFor(x => x.cards > 0 || x.imgs > 3, { timeout: 9000 });
    check('分区 loads content', s.cards > 0 || s.imgs > 3, `${s.cards} cards / ${s.imgs} imgs`);
  }

  const tests = [
    testNavAndHome, testVideoPlayback, testLiveAndDanmaku, testSearch,
    testFollowPagination, testSettingsAutoCheck, testHotAndPartition,
  ];
  for (const t of tests) {
    try { await t(); }
    catch (e) { fail(t.name, 'threw: ' + (e?.message || e)); }
  }

  console.log(`\n${'='.repeat(52)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${warned} warned`);
  console.log(`${'='.repeat(52)}\n`);
  return failed;
}

// ── CDP-over-SSH connection (mirrors tools/drive.mjs) ──
const conn = new Client();
conn.on('ready', () => {
  const server = net.createServer(s => {
    conn.forwardOut('127.0.0.1', 0, '127.0.0.1', 9998, (err, rs) => {
      if (err) { s.end(); return; } s.pipe(rs).pipe(s);
    });
  });
  server.listen(19995, '127.0.0.1', () => {
    http.get('http://127.0.0.1:19995/json', res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', async () => {
        const app = JSON.parse(d).find(p => p.title?.includes('哔哩') || p.url?.includes('biliwebos'));
        if (!app) { console.log('App not running on TV'); process.exit(1); }
        const ws = new WebSocket(app.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, '127.0.0.1:19995'));
        let id = 1;
        const call = (method, params) => new Promise((resolve, reject) => {
          const myId = id++;
          ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
          const h = (raw) => { const m = JSON.parse(raw); if (m.id === myId) { ws.off('message', h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
          ws.on('message', h);
        });
        await new Promise(r => ws.on('open', r));
        let failedCount = 1;
        try { failedCount = await main(call); }
        catch (e) { console.error('Fatal:', e); }
        finally { ws.close(); server.close(); conn.end(); process.exit(failedCount > 0 ? 1 : 0); }
      });
    });
  });
});
conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
conn.connect({
  host: TV.host, port: TV.port, username: 'prisoner',
  privateKey: readFileSync(process.env.HOME + '/.ssh/tv_webos'),
  passphrase: PASS, algorithms: { serverHostKey: ['ssh-rsa'] },
});
setTimeout(() => { console.error('overall timeout'); process.exit(1); }, 300000);
