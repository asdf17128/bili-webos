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
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import http from 'http';
import net from 'net';
import { WebSocket } from 'ws';
import { tvPassphrase } from './_tvpass.mjs';

const TV = { host: '192.168.50.94', port: 9922 };
const PASS = tvPassphrase(process.argv[2]);
const PER_KEY_MS = 320;

const KEYMAP = {
  up: { key: 'ArrowUp', vk: 38 }, down: { key: 'ArrowDown', vk: 40 },
  left: { key: 'ArrowLeft', vk: 37 }, right: { key: 'ArrowRight', vk: 39 },
  ok: { key: 'Enter', vk: 13 }, back: { key: 'Backspace', vk: 8 },
};
// Sidebar targets are located AT RUNTIME by their label (suite forces zh) —
// a hardcoded index table silently drifted when 收藏 was inserted (2026-07-10:
// 'settings:6' landed on 搜索, four "flaky" failures + one false-positive pass
// all traced to this one stale map).
const NAV_ICON = { search: '搜索', recommend: '推荐', hot: '热门', live: '直播', follow: '关注', favorites: '收藏', game: '游戏', settings: '我的', config: '设置' };

// One probe reads every field the tests assert on, in a single round-trip.
const PROBE = `JSON.stringify({
  focus: document.querySelector('[data-focus-id].focused')?.getAttribute('data-focus-id') || null,
  v: (function(){var v=document.querySelector('video');return v?{t:+v.currentTime.toFixed(1),ready:v.readyState,paused:v.paused}:null})(),
  cards: document.querySelectorAll('.video-card').length,
  relatedCards: document.querySelectorAll('.related-card').length,
  commentCards: document.querySelectorAll('.comment-card').length,
  tabRow: !!document.querySelector('.panel-tab-row'),
  panelText: (document.querySelector('.panel-tab-row')?.innerText || ''),
  activePanelTab: Array.from(document.querySelectorAll('.panel-tab-row > div')).find(e => e.style.background === 'rgb(59, 61, 70)')?.textContent || '',
  upApi: window.__smokeUpResponse || null,
  danmakuBox: !!document.querySelector('.danmaku-container'),
  danmakuItems: document.querySelectorAll('.danmaku-item').length,
  liveRelay: window.__tvLiveRelay || null,
  checkUpdate: (function(){var r=Array.from(document.querySelectorAll('.settings-row')).find(function(x){return x.innerText.indexOf('检查更新')>=0});return r?(r.querySelector('.settings-row-value')?.innerText||'').trim():null})(),
  liveBadge: Array.from(document.querySelectorAll('.video-card-duration')).some(function(e){return e.innerText.indexOf('直播')>=0}),
  recentLive: (function(){try{return JSON.parse(localStorage.getItem('bili_recentLive')||'[]').length}catch(e){return -1}})(),
  imgs: document.querySelectorAll('img').length,
  broken: Array.from(document.querySelectorAll('img')).filter(function(i){return i.complete&&i.naturalWidth===0}).length,
  recItems: document.querySelectorAll('.search-rec-item').length,
  sidebar: Array.from(document.querySelectorAll('.sidebar-item')).map(function(e){return e.textContent}),
  btns: Array.from(document.querySelectorAll('.player-btn')).map(function(e){return e.textContent.trim()}),
  focusedBtn: (document.querySelector('.player-btn.focused')||{}).textContent||'',
  chips: Array.from(document.querySelectorAll('.fav-chip')).map(function(e){return e.textContent.trim()}),
  cardTexts: Array.from(document.querySelectorAll('.video-card')).map(function(e){return (e.innerText||'').split(String.fromCharCode(10)).join(' ')}),
  holding: !!document.querySelector('.video-card.holding'),
  focusedCard: ((document.querySelector('.video-card.focused')||{}).innerText||'').split(String.fromCharCode(10)).join(' '),
  menu: Array.from(document.querySelectorAll('.cardmenu-item')).map(function(e){return e.textContent.trim()}),
  chipActive: (document.querySelector('.fav-chip-active')||{}).textContent||'',
  chipFocused: (document.querySelector('.fav-chip.focused')||{}).textContent||''
})`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0, warned = 0;
const output = process.env.TV_OUTPUT || '/tmp/bili-tv-smoke';
mkdirSync(output, { recursive: true });
const results = [];
const ok = (n, d) => { results.push({ name: n, status: 'pass', detail: d }); passed++; console.log(`  ✅ ${n}${d ? ': ' + d : ''}`); };
const fail = (n, d) => { results.push({ name: n, status: 'fail', detail: d }); failed++; console.log(`  ❌ ${n}${d ? ': ' + d : ''}`); };
const warn = (n, d) => { results.push({ name: n, status: 'skip', detail: d }); warned++; console.log(`  ⚠️  ${n}${d ? ': ' + d : ''}`); };
const check = (n, cond, d) => (cond ? ok(n, d) : fail(n, d));

async function main(call, relaunchApp) {
  await call('Runtime.enable');
  await call('Page.enable');

  const evalJSON = async (expr) => {
    const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'TV evaluation failed');
    try { return JSON.parse(r?.result?.value); } catch { return {}; }
  };
  const probe = () => evalJSON(PROBE);
  const originalSettings = await evalJSON('JSON.stringify(localStorage.getItem("bili_settings"))');
  console.log('[Environment] ' + await evalJSON('JSON.stringify(navigator.userAgent)'));

  // Fetch a B站 API URL through the app's own JS service (injects login
  // cookies) and return the parsed JSON. Used by the bangumi API checks.
  const serviceFetch = async (url) => {
    const expr = `new Promise(function(r){window.webOS.service.request('luna://com.biliwebos.app.service/',{method:'fetch',parameters:{url:${JSON.stringify(url)},method:'GET'},onSuccess:function(res){try{var b=typeof res.body==='string'?JSON.parse(res.body):(res.body||res.data||res);r(JSON.stringify(b));}catch(e){r('{}');}},onFailure:function(){r('{}');}});})`;
    const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    try { return JSON.parse(r?.result?.value); } catch { return {}; }
  };

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
  // to the target (index resolved from the LIVE sidebar by icon), then OK to
  // enter the content.
  const goto = async (pageKey) => {
    let s = await probe();
    // 套件里的 Back 链有时会把 app 整个退出(播放器/直播间连按几下就退到桌面),
    // 之后每个 goto 都报 "icon not in sidebar []" 连锁失败——看着像一堆功能回归,
    // 其实只是没 app 了。侧栏空就先自愈一次:重新载入页面再看。
    if (!(s.sidebar || []).length) {
      await reload();
      s = await probe();
    }
    // 页面重载救不回来 = app 进程真的退了(CDP 页面只剩个死壳)。
    // 这时必须通过 luna 重新拉起,否则后面每个 goto 都连锁报
    // "icon not in sidebar []"(2026-08-16 一轮 10 条全红,全是这个)。
    if (!(s.sidebar || []).length && relaunchApp) {
      console.log('  (app 已退出,重新拉起…)');
      await relaunchApp();
      for (let i = 0; i < 10 && !(s.sidebar || []).length; i++) {
        await sleep(1500);
        s = await probe();
      }
    }
    const idx = (s.sidebar || []).findIndex(t => t.indexOf(NAV_ICON[pageKey]) >= 0);
    if (idx < 0) throw new Error(`goto(${pageKey}): icon ${NAV_ICON[pageKey]} not in sidebar [${(s.sidebar || []).join(',')}]`);
    if (s.focus && s.focus.startsWith('content-')) await key('back'); // content → sidebar
    // Step to the target by READING the focus each press. The old trick was
    // "press up N times, it clamps at the top, then press down idx times" —
    // that broke the moment the sidebar gained up/down WRAPPING (2026-07-30):
    // overshooting now loops around instead of stopping, so 4 assertions
    // silently landed on the wrong page. Never rely on edge clamping.
    const row = async () => {
      const st = await probe();
      const m = /^sidebar-(\d+)-/.exec(st.focus || '');
      return m ? parseInt(m[1]) : null;
    };
    let cur = await row();
    for (let guard = 0; cur !== idx && guard < (s.sidebar || []).length + 4; guard++) {
      if (cur == null) {
        // 焦点是 null(上一个页面卸载时焦点元素随之消失)。方向键在没有焦点时
        // 会被按键处理器直接 return —— 按左键救不回来,得先重新锚定:
        // Back 会让 App 把焦点送回侧栏;还不行就直接点一下第一个侧栏项。
        await key('back');
        cur = await row();
        if (cur == null) {
          await evalJSON(`(function(){var it=document.querySelector('.sidebar-item'); if(it) it.click(); return '""'})()`);
          await sleep(500);
          cur = await row();
        }
        continue;
      }
      await key(cur > idx ? 'up' : 'down');
      cur = await row();
    }
    if (cur !== idx) throw new Error(`goto(${pageKey}): stuck at sidebar row ${cur}, want ${idx}`);
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

  // The suite's text asserts are CHINESE ('相关推荐', '直播', '检查更新'…) —
  // force zh for the run and restore the user's language after (2026-07-11:
  // the owner's TV on Español turned 4 asserts into locale false-negatives).
  const langWas = await evalJSON(`JSON.stringify(JSON.parse(localStorage.getItem('bili_settings')||'{}').language)`);
  const setLang = async (l) => {
    await evalJSON(`(function(){var s=JSON.parse(localStorage.getItem('bili_settings')||'{}');${l === undefined ? 'delete s.language' : `s.language=${JSON.stringify(l)}`};localStorage.setItem('bili_settings',JSON.stringify(s));return '""'})()`);
  };
  if (langWas !== 'zh') {
    console.log(`[i18n] forcing zh for the suite (was ${JSON.stringify(langWas)}) — restored at the end`);
    await setLang('zh');
    await reload();
  }

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
    await evalJSON(`JSON.stringify((() => {
      const original = window.webOS.service.request;
      window.__smokeUpResponse = null;
      window.webOS.service.request = function(uri, options) {
        if (options?.parameters?.url?.includes('/x/space/wbi/arc/search')) {
          const success = options.onSuccess;
          options = { ...options, onSuccess(response) {
            try {
              const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
              window.__smokeUpResponse = { code: body?.code, count: body?.data?.list?.vlist?.length };
            } catch { window.__smokeUpResponse = { error: 'invalid response' }; }
            success(response);
          }};
        }
        return original.call(this, uri, options);
      };
      return true;
    })())`);
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
    // Multi-part videos initially select 合集, so one fixed Right press is not
    // proof of visiting UP主投稿. Assert the selected label and its own response.
    for (let i = 0; i < 3 && !(await probe()).activePanelTab.startsWith('相关推荐'); i++) await key('right');
    s = await waitFor(x => x.activePanelTab.startsWith('相关推荐') && x.relatedCards > 0, { timeout: 12000 });
    check('相关推荐 has cards (recommended w/ upload time)', s.activePanelTab.startsWith('相关推荐') && s.relatedCards > 0, `${s.relatedCards} cards`);
    // Switch to UP主投稿 tab → uploader's own videos load.
    await key('right');
    s = await waitFor(x => x.activePanelTab.startsWith('UP主投稿') && x.upApi != null && (x.upApi.code !== 0 || x.relatedCards > 0), { timeout: 21000 });
    const api = await evalJSON('JSON.stringify(window.__smokeUpResponse)');
    check('UP主投稿 tab loads videos', s.activePanelTab.startsWith('UP主投稿') && api?.code === 0 && s.relatedCards > 0, `${s.relatedCards} cards; API=${JSON.stringify(api)}`);
    await exitPlayer();
  }

  async function testCommentRail() {
    console.log('\n[Comment rail rendering and control layout]');
    await exitPlayer();
    await evalJSON('JSON.stringify(window.__openVideo({bvid:"BV1xx411c7Xg",progress:10,resumeMode:"at"}))');
    await waitFor(x => x.v && x.v.t > 1, { timeout: 25000 });
    await key('up');
    for (let i = 0; i < 15; i++) {
      if (((await probe()).focusedBtn || '').includes('评论')) break;
      await key('right');
    }
    await key('ok');
    const s = await waitFor(x => x.commentCards > 0, { timeout: 12000 });
    check('Comment rail loads real comments', s.commentCards > 0, `${s.commentCards} cards`);
    const layout = await evalJSON(`JSON.stringify((() => {
      const body = document.querySelector('.comment-rail-body');
      const text = body?.innerText || '';
      return { present: !!body, sourceLeak: text.includes('comments.length'), empty: text.includes('暂无评论'),
        controlsRight: document.querySelector('.player-controls')?.getBoundingClientRect().right,
        railLeft: body?.getBoundingClientRect().left, duplicate: !!document.querySelector('.player-comment-metadata') };
    })())`);
    check('Comment rail shows content without JSX or empty-state leakage', layout.present && !layout.sourceLeak && !layout.empty);
    check('Comment controls fit without overlapping metadata', !layout.duplicate && layout.controlsRight <= layout.railLeft,
      JSON.stringify(layout));
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${output}/tv-comments.png`, Buffer.from(shot.data, 'base64'));
    await exitPlayer();
  }

  async function testLiveAndDanmaku() {
    console.log('\n[Live playback + danmaku + history]');
    // The danmaku layer honors the persisted 设置 → 弹幕 toggle: force it on for
    // this test (and restore after), or a user's "off" reads as a bogus failure.
    const dmWas = await evalJSON(`JSON.stringify(JSON.parse(localStorage.getItem('bili_settings')||'{}').danmaku)`);
    await evalJSON(`(function(){var s=JSON.parse(localStorage.getItem('bili_settings')||'{}');s.danmaku=true;localStorage.setItem('bili_settings',JSON.stringify(s));return '""'})()`);
    await reload();
    let s = await goto('live');
    check('Live list loads', s.cards > 0, `${s.cards} rooms`);
    // 进第一个直播间;起不来就换下一个,最多试 3 个 —— 列表里混着轮播/刚下播/
    // 付费房间,单个房间打不开是**内容问题**不是功能回归(2026-08-16 因此误报一次)。
    let played = false, tried = 0;
    for (; tried < 3 && !played; tried++) {
      if (tried > 0) {                    // 退回列表,右移一个房间
        for (let b = 0; b < 3; b++) { const st = await probe(); if (!st.v) break; await key('back'); await sleep(600); }
        await key('right'); await sleep(400);
      }
      await key('ok');
      s = await waitFor(x => x.v && x.v.t > 0, { timeout: 22000, interval: 600 });
      played = !!(s.v && s.v.t > 0);
    }
    check('Live stream plays', played, played ? `t=${s.v.t}s ready=${s.v.ready} (第${tried}个房间)`
      : `连试 ${tried} 个房间都没起播`);
    check('Danmaku layer mounted', s.danmakuBox);
    // Danmaku depends on a live, populated chat — give it a few seconds.
    s = await waitFor(x => x.danmakuItems > 0, { timeout: 9000, interval: 700 });
    if (s.danmakuItems > 0) ok('Danmaku rendering', `${s.danmakuItems} on screen`);
    else warn('Danmaku rendering', 'no items yet (quiet room?) — layer present');
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${output}/tv-live.png`, Buffer.from(shot.data, 'base64'));
    await exitPlayer();
    // Live-in-history: the room we just watched is recorded locally.
    s = await probe();
    check('Live room recorded to recentLive', s.recentLive > 0, `${s.recentLive} stored`);
    s = await goto('settings');
    // 我的 loads server history + local recentLive — wait on the badge itself.
    s = await waitFor(x => x.liveBadge, { timeout: 20000, interval: 700 });
    check('Live shows in 我的 → 最近观看 with 直播 badge', s.liveBadge, `cards=${s.cards}`);
    // Restore the user's danmaku preference (dmWas: true/false, or {} if unset).
    const dmRestore = (dmWas === true || dmWas === false) ? `s.danmaku=${dmWas}` : 'delete s.danmaku';
    await evalJSON(`(function(){var s=JSON.parse(localStorage.getItem('bili_settings')||'{}');${dmRestore};localStorage.setItem('bili_settings',JSON.stringify(s));return '""'})()`);
  }

  async function testSearch() {
    console.log('\n[Search]');
    await reload();
    await goto('search'); // focus on the search box (content-0-0)
    // The box is a native <input> → system keyboard (mic), not CDP-drivable; the
    // idle page shows a 搜索历史 + 热门搜索 recommendation list. Pick the first
    // row and search it — exercises the suggest/history/hot data path + results.
    let s = await waitFor(x => x.recItems > 0, { timeout: 8000, interval: 400 });
    check('Search recommendations render (热门/历史)', s.recItems > 0, `${s.recItems} rows`);
    await key('down'); // box → first recommendation row
    await key('ok');   // search that keyword
    s = await waitFor(x => x.cards > 0, { timeout: 12000, interval: 500 });
    check('Search returns a results grid', s.cards > 0, `${s.cards} results`);
  }

  async function testLiveRelay() {
    console.log('\n[Real-time live danmaku on a current recommended room]');
    await exitPlayer();
    const rec = await serviceFetch('https://api.live.bilibili.com/xlive/web-interface/v1/webMain/getMoreRecList?platform=web&page=1&page_size=12');
    const rooms = (rec.data?.recommend_room_list || rec.data?.list || []).slice().sort((a,b) => (b.online || 0) - (a.online || 0));
    let roomid;
    for (const room of rooms.slice(0, 3)) {
      const init = await serviceFetch('https://api.live.bilibili.com/room/v1/Room/room_init?id=' + (room.roomid || room.room_id));
      if (init.code === 0 && init.data?.live_status === 1) { roomid = init.data.room_id; break; }
    }
    if (!roomid) { warn('Live relay fixture skipped', 'no current live room found'); return; }
    await evalJSON(`JSON.stringify((() => {const s=JSON.parse(localStorage.getItem('bili_settings')||'{}');s.danmaku=true;localStorage.setItem('bili_settings',JSON.stringify(s));return true;})())`);
    await reload();
    await evalJSON(`JSON.stringify((() => {
      const original = window.webOS.service.request;
      window.__tvLiveRelay = { tokenCode: null, frames: 0, events: 0, subscribed: false };
      window.webOS.service.request = function(uri, options) {
        const token = options?.parameters?.url?.includes('/getDanmuInfo');
        const subscription = options?.method === 'danmakuSubscribe';
        if (subscription) window.__tvLiveRelay.subscribed = true;
        if (token || subscription) {
          const success = options.onSuccess;
          options = { ...options, onSuccess(res) {
            if (token) { try { window.__tvLiveRelay.tokenCode = JSON.parse(res.body).code; } catch {} }
            if (res.danmaku) window.__tvLiveRelay.frames++;
            if (res.event) window.__tvLiveRelay.events++;
            success?.(res);
          }};
        }
        return original.call(this, uri, options);
      };
      return true;
    })())`);
    await evalJSON(`JSON.stringify(window.__openLive({roomid:${Number(roomid)},title:'直播弹幕实测'}))`);
    let s = await waitFor(x => x.v && x.v.t > 2, { timeout: 25000, interval: 500 });
    check('Recommended live room advances playback', s.v && s.v.t > 2);
    s = await waitFor(x => x.danmakuItems > 0 || (x.liveRelay?.tokenCode != null && x.liveRelay.tokenCode !== 0), { timeout: 25000, interval: 500 });
    check('Live danmaku token API succeeds', s.liveRelay?.tokenCode === 0, `code=${s.liveRelay?.tokenCode}`);
    check('TV starts the live danmaku subscription', s.liveRelay?.subscribed === true);
    if (s.liveRelay?.frames > 0) {
      check('Real-time danmaku reaches the TV overlay', s.danmakuItems > 0, `${s.liveRelay.frames} frames, ${s.danmakuItems} DOM items`);
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${output}/tv-live-realtime.png`, Buffer.from(shot.data, 'base64'));
    } else warn('Real-time danmaku receipt', `${s.liveRelay?.events || 0} relay events but no chat frames in observation window`);
    await exitPlayer();
    // Remove instrumentation and re-read the suite's restored settings later.
    await reload();
  }

  async function testLiveQuality() {
    console.log('\n[Live quality switch and original-quality restore]');
    await exitPlayer();
    const rec = await serviceFetch('https://api.live.bilibili.com/xlive/web-interface/v1/webMain/getMoreRecList?platform=web&page=1&page_size=12');
    const room = (rec.data?.recommend_room_list || rec.data?.list || [])[0];
    if (!room) { warn('Live quality fixture', 'no current recommended room'); return; }
    await evalJSON('JSON.stringify(window.__liveDiag=[])');
    const roomid = Number(process.env.TV_LIVE_ROOM || room.roomid || room.room_id);
    await evalJSON(`JSON.stringify(window.__openLive({roomid:${roomid},title:'直播画质测试'}))`);
    await waitFor(x => x.v && x.v.t > 0, { timeout: 18000 });
    const playingQn = () => evalJSON('JSON.stringify((window.__liveDiag||[]).filter(x=>x.why==="playing").slice(-1)[0]?.qn)');
    let originalQn;
    for(let i=0;i<40;i++){originalQn=await playingQn();if(originalQn)break;await sleep(500);}
    await key('up');
    // The quality control displays its current label (e.g. 原画), not 画质.
    // Up anchors the three-control row at 弹幕; the next control is quality.
    await key('right');
    await key('ok');
    const options = await evalJSON('JSON.stringify(Array.from(document.querySelectorAll(".quality-option")).map(x=>({label:x.textContent,focused:x.classList.contains("focused")})))');
    check('Live quality popup opens', options.length > 0, `${options.length} options: ${options.map(o=>o.label).join('/')}`);
    if (!options.length || !originalQn) throw new Error('Quality fixture unavailable');
    if (options.length < 2) { warn('Live quality switch skipped', 'room only offers one quality; choose TV_LIVE_ROOM with multiple qualities'); await exitPlayer(); return; }
    const index = options.findIndex(x => x.focused);
    const direction = index < options.length - 1 ? 'down' : 'up';
    await key(direction);await key('ok');
    let changed;
    for(let i=0;i<40;i++){changed=await playingQn();if(changed!==originalQn)break;await sleep(500);}
    check('Selected live quality starts actual playback', !!changed && changed !== originalQn, `${originalQn} → ${changed}`);
    await key('ok'); // Control focus remains on 画质, reopen the popup.
    await key(direction==='down'?'up':'down');await key('ok');
    let restored;
    for(let i=0;i<40;i++){restored=await playingQn();if(restored===originalQn)break;await sleep(500);}
    check('Original live quality starts playback again', restored === originalQn, `qn=${restored}`);
    await exitPlayer();
  }

  async function testFollowPagination() {
    console.log('\n[Follow list + pagination]');
    const nav = await serviceFetch('https://api.bilibili.com/x/web-interface/nav');
    if (nav.code !== 0 || !nav.data?.isLogin) { warn('Follow list and pagination skipped', 'API session is logged out'); return; }
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

  async function testCdnSettings() {
    console.log('\n[CDN settings remote selection and persistence]');
    await reload();
    await goto('config');
    for (let i = 0; i < 12 && (await probe()).focus !== 'content-7-0'; i++) await key('down');
    check('CDN row is reachable by remote', (await probe()).focus === 'content-7-0');
    await key('ok');
    const picker = await evalJSON('JSON.stringify(document.querySelector(".settings-picker")?.innerText || "")');
    check('CDN picker includes automatic and HWO1 routes', picker.includes('自动择优') && picker.includes('华为云 HWO1'));
    await keyN('up', 7);
    await keyN('down', 6);
    const clip = await evalJSON('JSON.stringify((() => { const r=document.querySelector(".settings-picker").getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}; })())');
    const shot = await call('Page.captureScreenshot', { format: 'png', clip });
    writeFileSync(`${output}/tv-cdn-picker.png`, Buffer.from(shot.data, 'base64'));
    await key('ok');
    const saved = () => evalJSON('JSON.stringify(JSON.parse(localStorage.getItem("bili_settings") || "{}").cdnRoute)');
    check('Remote HWO1 selection is saved', await saved() === 'hwo1');
    await reload(); await goto('config');
    const label = await evalJSON('JSON.stringify(document.querySelector("[data-focus-id=content-7-0]")?.innerText || "")');
    check('HWO1 remains selected after reload', label.includes('华为云 HWO1') && await saved() === 'hwo1');
    for (let i = 0; i < 12 && (await probe()).focus !== 'content-7-0'; i++) await key('down');
    await key('ok'); await keyN('up', 7); await key('ok');
    check('Remote can restore automatic routing', await saved() === 'auto' && (await probe()).focus === 'content-7-0');
  }

  async function testSettingsAutoCheck() {
    console.log('\n[Settings auto update-check]');
    await reload();
    await goto('config');
    // The 检查更新 row auto-runs on mount; its value should populate w/o input.
    const s = await waitFor(x => x.checkUpdate && x.checkUpdate !== '检查中…', { timeout: 15000, interval: 400 });
    check('Auto update-check populated', !!s.checkUpdate, s.checkUpdate);
    check('Update-check resolved (latest/new/version)', /已是最新|发现新版|v?\d+\.\d+\.\d+/.test(s.checkUpdate || ''), s.checkUpdate);
  }

  async function testAccountLibrary() {
    console.log('\n[Authenticated favorites, subscriptions and watch-later list]');
    const nav = await serviceFetch('https://api.bilibili.com/x/web-interface/nav');
    check('Account API confirms valid login', nav.code === 0 && nav.data?.isLogin === true);
    if (nav.code !== 0 || !nav.data?.isLogin) return;
    await reload();
    await goto('favorites');
    const own = await serviceFetch('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=' + nav.data.mid);
    const folders = own.data?.list || [];
    await waitFor(x => x.cards > 0, { timeout: 12000 });
    let library = await evalJSON('JSON.stringify({folders:document.querySelectorAll(".folder-selector .fav-chip").length,cards:document.querySelectorAll(".video-card").length})');
    check('Own favorites match the account folder response', own.code === 0 && library.folders === folders.length, `${library.folders}/${folders.length} folders`);
    if (folders[0]?.media_count > 0) check('Favorite folder renders videos', library.cards > 0, `${library.cards} cards`);
    await key('right'); await key('ok'); // 我的收藏 → 订阅
    const subscriptions = await serviceFetch('https://api.bilibili.com/x/v3/fav/folder/collected/list?up_mid=' + nav.data.mid + '&pn=1&ps=20&platform=web');
    const expected = subscriptions.data?.list || [];
    await sleep(2000);
    library = await evalJSON('JSON.stringify({tab:document.querySelector(".library-tabs [aria-selected=true]")?.textContent,folders:document.querySelectorAll(".folder-selector .fav-chip").length,cards:document.querySelectorAll(".video-card").length,empty:document.body.innerText.includes("暂无订阅")})');
    check('Subscriptions tab matches the account response', subscriptions.code === 0 && library.tab === '订阅' && library.folders === expected.length, `${library.folders}/${expected.length} folders`);
    if (!expected.length) check('Empty subscriptions end loading', library.empty);
    else if (expected[0].media_count > 0) check('Subscribed folder renders videos', library.cards > 0, `${library.cards} cards`);
    await goto('settings');
    await key('right');
    const list = await serviceFetch('https://api.bilibili.com/x/v2/history/toview');
    const count = (list.data?.list || []).length;
    const s = await waitFor(x => x.chipActive?.includes('稍后再看') && x.cards === count, { timeout: 12000 });
    check('Watch Later list matches the authenticated API', list.code === 0 && s.chipActive?.includes('稍后再看') && s.cards === count, `${s.cards}/${count} cards`);
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${output}/account-library-private.png`, Buffer.from(shot.data, 'base64'));
  }

  async function testHotAndPartition() {
    console.log('\n[热门 / 分区]');
    await reload();
    let s = await goto('hot');
    s = await waitFor(x => x.cards > 0 || x.imgs > 3, { timeout: 9000 });
    check('热门 loads content', s.cards > 0 || s.imgs > 3, `${s.cards} cards / ${s.imgs} imgs`);
    // 游戏 is one of the 6 pulled-out partitions (new pid_v2 ranking, current).
    s = await goto('game');
    s = await waitFor(x => x.cards > 0 || x.imgs > 3, { timeout: 9000 });
    check('分区(游戏) loads content', s.cards > 0 || s.imgs > 3, `${s.cards} cards / ${s.imgs} imgs`);
  }

  // Explicit opt-in for a bounded UI round trip. Snapshot the full original list,
  // permit writes only for an absent fixture aid, and restore it even on failure.
  async function testWatchLater() {
    console.log('\n[Watch Later: guarded add / long-press remove / restore]');
    const nav = await serviceFetch('https://api.bilibili.com/x/web-interface/nav');
    if (nav.code !== 0 || !nav.data?.isLogin) { warn('Watch Later skipped', 'API session is logged out'); return; }
    if (process.env.TV_ACCOUNT_WRITES !== '1') { warn('Watch Later writes skipped', 'explicit opt-in required for guarded fixture round trip'); return; }
    const getList = async () => {
      const res = await serviceFetch('https://api.bilibili.com/x/v2/history/toview');
      if (res.code !== 0) throw new Error('Watch Later list API failed: ' + res.code);
      const list = res.data?.list || [];
      if (res.data?.count != null && res.data.count !== list.length) throw new Error('Incomplete list; no writes allowed');
      return list;
    };
    const original = await getList();
    const ids = list => list.map(v => String(v.aid));
    const baseline = ids(original);
    const fixture = (await serviceFetch('https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7Xg')).data;
    if (!fixture?.aid || !fixture?.bvid) throw new Error('Fixture unavailable');
    if (baseline.includes(String(fixture.aid)) || original.length >= 100) {
      warn('Watch Later writes skipped', 'fixture already saved or queue full; original list preserved'); return;
    }
    const aid = String(fixture.aid);
    await reload();
    await evalJSON(`JSON.stringify((() => {
      const original = window.webOS.service.request;
      window.__tvSmokeOriginalRequest = original;
      window.__tvSmokeMenuAid = null;
      window.__tvSmokeWrites = { add: 0, del: 0, blocked: 0 };
      window.__tvSmokeMenuHandler = e => { window.__tvSmokeMenuAid = String(e.detail?.aid || ''); };
      window.addEventListener('card-menu', window.__tvSmokeMenuHandler);
      window.webOS.service.request = function(uri, options) {
        const p = options?.parameters;
        const path = p?.url ? new URL(p.url).pathname : '';
        const operation = path === '/x/v2/history/toview/add' ? 'add' : path === '/x/v2/history/toview/del' ? 'del' : null;
        if (operation) {
          const form = new URLSearchParams(p.body || '');
          if (form.get('aid') !== ${JSON.stringify(aid)} || form.has('viewed')) {
            window.__tvSmokeWrites.blocked++;
            options.onFailure?.({errorText:'Test guard rejected non-fixture mutation'});
            return {cancel(){}};
          }
          window.__tvSmokeWrites[operation]++;
        }
        return original.call(this, uri, options);
      };
      return true;
    })())`);
    try {
      await evalJSON(`JSON.stringify(window.__openVideo({bvid:${JSON.stringify(fixture.bvid)},resumeMode:'none'}))`);
      let s = await waitFor(x => x.v && x.v.t > 0.2, { timeout: 22000 });
      if (!s.v) throw new Error('Fixture playback did not start');
      await key('up');
      for (let i = 0; i < 15 && !(await probe()).focusedBtn.includes('稍后再看'); i++) await key('right');
      s = await probe();
      if (!s.focusedBtn.includes('稍后再看') || s.focusedBtn.includes('已稍后再看')) throw new Error('Fixture add button is not in the expected state');
      await key('ok');
      s = await waitFor(x => x.focusedBtn.includes('已稍后再看'), { timeout: 10000 });
      check('Player confirms fixture added to Watch Later', s.focusedBtn.includes('已稍后再看'));
      const afterAdd = ids(await getList());
      check('Add changes only the absent fixture', afterAdd.includes(aid) && afterAdd.length === baseline.length + 1 && baseline.every(id => afterAdd.includes(id)));
      if (!afterAdd.includes(aid)) throw new Error('Fixture was not added');
      await exitPlayer();
      await goto('settings');
      await key('right');
      s = await waitFor(x => x.chipActive?.includes('稍后再看') && x.cards === afterAdd.length, { timeout: 12000 });
      check('Watch Later UI reflects the added fixture', s.chipActive?.includes('稍后再看') && s.cards === afterAdd.length);
      await key('down');
      for (let i = 0; i < 4; i++) {
        const title = await evalJSON('JSON.stringify(document.querySelector(".video-card.focused .video-card-title")?.textContent)');
        if (title === fixture.title) break;
        await key('left');
      }
      const title = await evalJSON('JSON.stringify(document.querySelector(".video-card.focused .video-card-title")?.textContent)');
      if (title !== fixture.title) throw new Error('Fixture is not focused; refusing removal');
      const m = KEYMAP.ok;
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: m.key, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk });
      await sleep(400);
      check('Holding OK shows progress', (await probe()).holding === true);
      await sleep(700);
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: m.key, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk });
      s = await waitFor(x => x.menu.some(v => v.includes('移除')), { timeout: 7000 });
      const menuAid = await evalJSON('JSON.stringify(window.__tvSmokeMenuAid)');
      check('Long-press menu targets the fixture aid', menuAid === aid && s.menu.some(v => v.includes('移除')));
      if (menuAid !== aid || !s.menu.some(v => v.includes('移除'))) throw new Error('Menu identity mismatch; refusing removal');
      check('Opening the menu leaves the list unchanged', JSON.stringify(ids(await getList())) === JSON.stringify(afterAdd));
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${output}/watchlater-menu-private.png`, Buffer.from(shot.data, 'base64'));
      await key('ok');
      s = await waitFor(x => x.cards === baseline.length && x.menu.length === 0, { timeout: 10000 });
      check('Menu removal updates Watch Later UI', s.cards === baseline.length && s.menu.length === 0);
      check('Menu removal restores the original API list', JSON.stringify(ids(await getList())) === JSON.stringify(baseline));
      if (baseline.length) {
        await key('down'); await key('up');
        s = await probe();
        check('Returning from grid preserves Watch Later tab and focus', s.chipActive?.includes('稍后再看') && s.chipFocused?.includes('稍后再看'));
      }
      const writes = await evalJSON('JSON.stringify(window.__tvSmokeWrites)');
      check('UI writes were limited to one fixture add and remove', writes.add === 1 && writes.del === 1 && writes.blocked === 0, JSON.stringify(writes));
    } finally {
      try {
        if (ids(await getList()).includes(aid)) {
          const code = await evalJSON(`new Promise(resolve => {
            const auth=JSON.parse(localStorage.getItem('bili_auth') || '{}');
            window.webOS.service.request('luna://com.biliwebos.app.service/', {method:'fetch',parameters:{
              url:'https://api.bilibili.com/x/v2/history/toview/del',method:'POST',contentType:'application/x-www-form-urlencoded',
              body:new URLSearchParams({aid:${JSON.stringify(aid)},csrf:auth.bili_jct || ''}).toString()},
              onSuccess(res){try{resolve(JSON.stringify(JSON.parse(res.body).code));}catch{resolve('-1');}},onFailure(){resolve('-1');}});
          })`);
          if (code !== 0) throw new Error('Fixture cleanup failed: ' + code);
        }
        check('Final original Watch Later order and membership preserved', JSON.stringify(ids(await getList())) === JSON.stringify(baseline), `${baseline.length} original items`);
      } finally {
        await evalJSON(`JSON.stringify((() => {
          window.webOS.service.request = window.__tvSmokeOriginalRequest;
          window.removeEventListener('card-menu', window.__tvSmokeMenuHandler);
          delete window.__tvSmokeOriginalRequest; delete window.__tvSmokeMenuHandler;
          return true;
        })())`);
      }
    }
  }

  async function testBangumiPlayback() {
    console.log('\n[番剧 / Bangumi (PGC) + HDR]');
    const EPID = 433947; // JOJO 石之海 ep1 — issue #7 repro
    const season = await serviceFetch('https://api.bilibili.com/pgc/view/web/season?ep_id=' + EPID);
    const eps = season?.result?.episodes || season?.data?.episodes || [];
    check('Season info loads (episode list)', season?.code === 0 && eps.length > 0, `${eps.length} eps`);
    const ep = eps.find(e => String(e.id) === String(EPID)) || eps[0] || {};
    const play = await serviceFetch(`https://api.bilibili.com/pgc/player/web/playurl?ep_id=${EPID}&cid=${ep.cid || ''}&qn=127&fnval=4048&fnver=0&fourk=1`);
    const dash = (play?.result || play?.data || {}).dash;
    const vcount = dash?.video?.length || 0;
    check('PGC playurl returns DASH (bangumi playable)', play?.code === 0 && vcount > 0, `${vcount} video reps`);
    const accept = (play?.result || play?.data || {}).accept_quality || [];
    const hdrRep = (dash?.video || []).some(v => v.id === 125 || v.id === 126);
    if (accept.includes(125) || accept.includes(126) || hdrRep) ok('HDR/Dolby rep present + selectable by id', `accept=${JSON.stringify(accept)}`);
    else warn('HDR/Dolby rep present', `none for this title (needs VIP?) accept=${JSON.stringify(accept)}`);
  }

  const tests = [
    testNavAndHome, testVideoPlayback, testCommentRail, testBangumiPlayback, testLiveAndDanmaku, testLiveRelay, testLiveQuality, testSearch,
    testFollowPagination, testAccountLibrary, testSettingsAutoCheck, testCdnSettings, testHotAndPartition, testWatchLater,
  ];
  try {
    for (const t of tests) {
      if (process.env.TV_TEST_FILTER && !new RegExp(process.env.TV_TEST_FILTER).test(t.name)) continue;
      try { await t(); }
      catch (e) { fail(t.name, 'threw: ' + (e?.message || e)); }
    }
  } finally {
    try {
      await evalJSON(`JSON.stringify(${originalSettings == null ? 'localStorage.removeItem("bili_settings")' : 'localStorage.setItem("bili_settings",' + JSON.stringify(originalSettings) + ')' })`);
      await reload();
    } catch (e) {
      fail('Restore original settings', e?.message || String(e));
    } finally {
      writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
    }
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
    // Find the app's CDP page — and LAUNCH it if it isn't up. The suite itself
    // ends with Back presses that drop out of the app, so a second run used to
    // die at startup ("App not running on TV") and, worse, a mid-run exit made
    // every later goto() fail against an empty sidebar — cascading red that
    // looked like feature regressions (2026-08-02). Bring it up and retry.
    const pages = () => new Promise((resolve) => {
      http.get('http://127.0.0.1:19995/json', r2 => {
        let d2 = ''; r2.on('data', c => d2 += c);
        r2.on('end', () => { try { resolve(JSON.parse(d2)); } catch (e) { resolve([]); } });
      }).on('error', () => resolve([]));
    });
    const findApp = (list) => list.find(p => p.title?.includes('哔哩') || p.url?.includes('biliwebos'));
    const launchApp = () => new Promise((resolve) => {
      conn.exec("luna-send-pub -n 1 luna://com.webos.service.applicationmanager/launch '{\"id\":\"com.biliwebos.app\"}'",
        (e, stream) => { if (e) return resolve(); stream.on('close', () => resolve()).resume(); });
    });
    (async () => {
      let app = findApp(await pages());
      if (!app) {
        console.log('App not in foreground — launching it…');
        await launchApp();
        for (let i = 0; i < 12 && !app; i++) {
          await new Promise(r => setTimeout(r, 1500));
          app = findApp(await pages());
        }
      }
      if (!app) { console.log('App not running on TV (launch failed)'); process.exit(1); }
      await (async () => {
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
        try { failedCount = await main(call, launchApp); }
        catch (e) { console.error('Fatal:', e); }
        finally { ws.close(); server.close(); conn.end(); process.exit(failedCount > 0 ? 1 : 0); }
      })();
    })();
  });
});
conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
conn.connect({
  host: TV.host, port: TV.port, username: 'prisoner',
  privateKey: readFileSync(process.env.HOME + '/.ssh/tv_webos'),
  passphrase: PASS, algorithms: { serverHostKey: ['ssh-rsa'] },
});
// 总超时 10 分钟:直播段最多重试 3 个房间(3×22s)+ 稍后再看端到端之后,
// 原来的 5 分钟不够用了,会在跑到一半时把整轮判成失败(2026-08-21)。
setTimeout(() => { console.error('overall timeout'); process.exit(1); }, 600000);
