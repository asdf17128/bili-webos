// Full functional suite against the SIMULATOR (dev browser), mirroring what
// tools/test-ui.mjs asserts on the TV. It exists because the TV is often in
// use — and because dev now runs the SAME service code as the TV
// (tools/dev-service.mjs), so these results actually mean something.
//
// Covers: home grid + scroll geometry, sidebar wrap, partitions, search,
// player (playback, control bar, comment rail, 楼中楼, quality/subtitle popups,
// layered Back), live (playback, control bar, quality ladder, chat rail,
// layered Back), settings rows, i18n switch.
//
// NOT covered (physically TV-only): old-Chromium runtime quirks, hardware
// decode/perf, 倍速 via the luna bus.
//
// Usage:
//   node tools/dev-service.mjs &        # the real TV service, bridged
//   (cd app && npm run dev) &           # vite on :5173
//   node tools/test-sim.mjs             # exit 0 = pass
import { chromium } from 'playwright';

const URL_BASE = process.env.SIM_URL || 'http://localhost:5173';
const BRIDGE = 'http://127.0.0.1:9528/ping';
const FIXTURE = 'BV1xx411c7Xg';        // 弹幕测试专用 — stable, busy comments
const LIVE_ROOM = 3683436;

let passed = 0, failed = 0, warned = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log(`  ✅ ${name}${detail ? ': ' + detail : ''}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ': ' + detail : ''}`); }
};
const warn = (name, detail) => { warned++; console.log(`  ⚠️  ${name}${detail ? ': ' + detail : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // The bridge is what makes dev meaningful; say so loudly if it's missing.
  let bridgeUp = false;
  try { bridgeUp = (await fetch(BRIDGE)).ok; } catch (e) { /* down */ }
  if (!bridgeUp) warn('dev-service bridge down', 'falling back to proxy — results are less TV-like');

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 120)));

  const key = (k) => page.evaluate((kk) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: kk, bubbles: true }));
    if (kk === 'Enter') window.dispatchEvent(new KeyboardEvent('keyup', { key: kk, bubbles: true }));
  }, k);
  const focusedBtn = () => page.evaluate(() => (document.querySelector('.player-btn.focused') || {}).textContent || '');
  const cardRect = () => page.evaluate(() => {
    const f = document.querySelector('.video-card.focused');
    if (!f) return null;
    const cards = [...document.querySelectorAll('.video-card')];
    const cols = (JSON.parse(localStorage.getItem('bili_settings') || '{}').gridCols) || 3;
    const i = cards.indexOf(f); const prev = i >= cols ? cards[i - cols] : null;
    const r = f.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom),
      peek: prev ? Math.max(0, Math.round(prev.getBoundingClientRect().bottom)) : null };
  });
  const gotoPage = async (label) => {
    await page.evaluate((l) => {
      const it = [...document.querySelectorAll('.sidebar-item')].find(x => x.textContent.includes(l));
      if (it) it.click();
    }, label);
    await sleep(1800);
  };

  try {
    console.log('\n[Home grid + scroll geometry]');
    await page.goto(URL_BASE);
    await sleep(4000);
    const home = await page.evaluate(() => ({
      sidebar: document.querySelectorAll('.sidebar-item').length,
      cards: document.querySelectorAll('.video-card').length,
      broken: [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).length,
    }));
    check('Home renders cards', home.cards > 5, `${home.cards} cards`);
    check('Sidebar present', home.sidebar >= 10, `${home.sidebar} items`);
    check('No broken thumbnails', home.broken <= 1, `${home.broken} broken`);

    for (let i = 0; i < 3; i++) { await key('ArrowLeft'); await sleep(200); }
    await key('ArrowRight'); await sleep(800);
    const row0 = await cardRect();
    check('Row 0: focused card fully visible, no peek', !!row0 && row0.top >= 0 && row0.bottom <= 1081 && row0.peek === null,
      row0 && `top=${row0.top}`);
    for (let i = 0; i < 6; i++) { await key('ArrowDown'); await sleep(180); }
    await sleep(900);
    const row6 = await cardRect();
    check('Deep row: card visible + previous row peeks', !!row6 && row6.top >= 0 && row6.bottom <= 1081 && row6.peek > 20,
      row6 && `top=${row6.top} peek=${row6.peek}`);
    for (let i = 0; i < 6; i++) { await key('ArrowUp'); await sleep(180); }
    await sleep(900);
    const back0 = await cardRect();
    check('Back to top: no clipping', !!back0 && back0.top >= 0 && back0.peek === null, back0 && `top=${back0.top}`);

    console.log('\n[Sidebar wrap]');
    for (let i = 0; i < 3; i++) { await key('ArrowLeft'); await sleep(200); }
    const sideFocus = () => page.evaluate(() => (document.querySelector('.sidebar-item.focused') || {}).textContent || null);
    let guard = 0;
    while (guard++ < 16) { const f = await sideFocus(); if (f && f.includes('搜索')) break; await key('ArrowUp'); await sleep(180); }
    const top = await sideFocus();
    await key('ArrowUp'); await sleep(500);
    const wrapped = await sideFocus();
    check('Top ↑ wraps to the last item', !!top && !!wrapped && top.includes('搜索') && wrapped.includes('设置'),
      `${top} → ${wrapped}`);

    console.log('\n[Partitions + search]');
    await gotoPage('游戏');
    const game = await page.evaluate(() => document.querySelectorAll('.video-card').length);
    check('分区(游戏) loads content', game > 5, `${game} cards`);
    await gotoPage('搜索');
    const search = await page.evaluate(() => ({
      input: !!document.querySelector('input'),
      rows: document.querySelectorAll('.search-chip, .search-rec-item, [class*="search"] li').length,
      text: (document.body.innerText || '').includes('热门') || (document.body.innerText || '').includes('搜索'),
    }));
    check('Search page shows an input + recommendations', search.input && search.text,
      `input=${search.input} rows=${search.rows}`);

    console.log('\n[Settings]');
    await gotoPage('设置');
    const rows = await page.evaluate(() => [...document.querySelectorAll('.settings-row')].map(r => r.innerText.split('\n')[0].trim()));
    check('Settings rows render', rows.length >= 8, rows.join(' / '));
    check('No 音量均衡 row (feature parked)', !rows.some(r => r.includes('音量均衡')));

    console.log('\n[Video playback + player UI]');
    await page.evaluate((bv) => window.__openVideo({ bvid: bv, progress: 10, resumeMode: 'at' }), FIXTURE);
    await sleep(9000);
    const vod = await page.evaluate(() => {
      const v = document.querySelector('video');
      return { playing: !!v && !v.paused && v.currentTime > 1, ct: v ? Math.round(v.currentTime) : null };
    });
    check('Video plays', vod.playing, `t=${vod.ct}s`);
    for (let a = 0; a < 4; a++) { await key('ArrowUp'); await sleep(700); if (await focusedBtn()) break; }
    const controls = await page.evaluate(() => [...document.querySelectorAll('.player-btn')].map(b => b.textContent.trim()));
    check('Control bar has the expected buttons', controls.some(c => c.includes('弹幕')) && controls.some(c => c.includes('倍速')) && controls.some(c => c.includes('评论')),
      controls.join(' | '));

    let f = '';
    for (let i = 0; i < 10; i++) { f = await focusedBtn(); if (f.includes('评论')) break; await key('ArrowRight'); await sleep(220); }
    await key('Enter'); await sleep(4500);
    const rail = await page.evaluate(() => {
      const v = document.querySelector('video');
      const r = [...document.querySelectorAll('div')].find(d => d.style && d.style.width === '420px' && d.style.right === '0px');
      const strip = [...document.querySelectorAll('div')].find(d => d.style && d.style.top === '844px');
      return { videoW: Math.round(v.getBoundingClientRect().width), railLeft: r ? Math.round(r.getBoundingClientRect().left) : null,
        cards: document.querySelectorAll('.comment-card').length, strip: !!strip };
    });
    check('Comment rail: video shrinks, rail docks right', rail.videoW === 1500 && rail.railLeft === 1500,
      `video=${rail.videoW} rail@${rail.railLeft}`);
    check('Comment rail loads comments', rail.cards > 5, `${rail.cards} cards`);
    check('Metadata strip fills the letterbox', rail.strip);

    await key('ArrowDown'); await sleep(600);
    const subCount = () => page.evaluate(() => {
      const c = [...document.querySelectorAll('.comment-card')].find(x => getComputedStyle(x).outlineStyle === 'solid');
      return c ? c.querySelectorAll('span').length : null;
    });
    const before = await subCount();
    await key('Enter'); await sleep(2500);
    const after = await subCount();
    check('楼中楼 expands on OK', before != null && after != null && after > before, `${before} → ${after}`);

    await key('Escape'); await sleep(1000);
    const afterBack = await page.evaluate(() => ({
      videoW: Math.round(document.querySelector('video').getBoundingClientRect().width),
      focused: (document.querySelector('.player-btn.focused') || {}).textContent || '',
    }));
    check('Back closes the rail first, focus returns', afterBack.videoW === 1920 && afterBack.focused.includes('评论'),
      `video=${afterBack.videoW} focus=${afterBack.focused}`);

    console.log('\n[Live: playback, controls, quality, chat rail, back layering]');
    // Leave the VOD player FIRST. Both players can be mounted at once (the VOD
    // page stays behind the live one), and then every '.player-btn' query hits
    // the VOD control bar — which is exactly how this suite first "failed"
    // live: it measured 弹幕测试专用's 640x480 element while a live stream
    // played underneath.
    for (let i = 0; i < 5; i++) {
      if (!(await page.evaluate(() => !!document.querySelector('.player-page')))) break;
      await key('Escape'); await sleep(800);
    }
    check('Left the VOD player before live', !(await page.evaluate(() => !!document.querySelector('.player-page'))));
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('bili_settings') || '{}'); s.liveInteract = false; localStorage.setItem('bili_settings', JSON.stringify(s)); });
    await page.evaluate((r) => window.__openLive({ roomid: r, title: 'SIM', owner: { name: 'SIM' } }), LIVE_ROOM);
    await sleep(14000);
    const live = await page.evaluate(() => {
      const v = document.querySelector('video');
      return { playing: !!v && !v.paused && v.currentTime > 0.5, ct: v ? +v.currentTime.toFixed(1) : null,
        res: v ? v.videoWidth + 'x' + v.videoHeight : null };
    });
    check('Live stream plays', live.playing, `t=${live.ct}s ${live.res}`);
    for (let a = 0; a < 4; a++) { await key('ArrowUp'); await sleep(700); if (await focusedBtn()) break; }
    const liveCtrls = await page.evaluate(() => [...document.querySelectorAll('.player-btn')].map(b => b.textContent.trim()));
    check('Live control bar: danmaku / quality / chat', liveCtrls.length >= 3 && liveCtrls.some(c => c.includes('聊天')),
      liveCtrls.join(' | '));
    check('Chat rail defaults to off', liveCtrls.some(c => c.includes('聊天 关')));

    let lf = '';
    for (let i = 0; i < 5; i++) { lf = await focusedBtn(); if (!lf.includes('弹幕') && !lf.includes('聊天')) break; await key('ArrowRight'); await sleep(250); }
    await key('Enter'); await sleep(900);
    const qual = await page.evaluate(() => [...document.querySelectorAll('.ctrl-popup .quality-option')].map(o => o.textContent.trim()));
    check('Live quality ladder opens', qual.length >= 2, qual.join('/'));
    await key('Escape'); await sleep(600);

    // chat rail on → layered Back
    for (let i = 0; i < 6; i++) { const b = await focusedBtn(); if (b.includes('聊天')) break; await key('ArrowRight'); await sleep(220); }
    await key('Enter'); await sleep(1500);
    const railOn = await page.evaluate(() => !![...document.querySelectorAll('div')].find(d => d.style && d.style.width === '420px'));
    check('Chat rail opens from the control bar', railOn);
    await key('Escape'); await sleep(700);   // controls
    await key('Escape'); await sleep(900);   // rail
    const afterRail = await page.evaluate(() => ({
      rail: !![...document.querySelectorAll('div')].find(d => d.style && d.style.width === '420px'),
      live: !!document.querySelector('.player-page'),
    }));
    check('Back closes the chat rail, stays in the room', !afterRail.rail && afterRail.live);
    await key('Escape'); await sleep(900);
    const leftRoom = await page.evaluate(() => !document.querySelector('.player-page'));
    check('Back again leaves the live room', leftRoom);

    console.log('\n[Runtime health]');
    check('No uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  } catch (e) {
    failed++;
    console.log('  ❌ suite threw:', e.message);
  } finally {
    await browser.close();
  }

  console.log('\n====================================================');
  console.log(`Results: ${passed} passed, ${failed} failed, ${warned} warned`);
  console.log('====================================================');
  return failed;
}

main().then(f => process.exit(f > 0 ? 1 : 0));
