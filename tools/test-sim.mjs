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
const LIVE_ROOM_FALLBACK = 3683436;

// 直播断言曾经写死一个房间号,那个房间下播后整段变红(2026-08-06:live_status=0
// 连挂 4 条)。改成运行时挑一个"此刻真的在播"的房间;一个都挑不到就跳过直播段
// 并 warn —— 没有直播源可测是环境事实,不该记成代码缺陷。
async function pickLiveRoom() {
  const call = async (host, path) => {
    const r = await fetch('http://127.0.0.1:9528/luna/fetch', {
      method: 'POST',
      body: JSON.stringify({ url: `https://${host}${path}` }),
    });
    const j = JSON.parse(await r.text());
    try { return JSON.parse(j.body || '{}'); } catch (e) { return {}; }
  };
  try {
    const rec = await call('api.live.bilibili.com',
      '/xlive/web-interface/v1/webMain/getMoreRecList?platform=web&page=1&page_size=12');
    const rooms = rec?.data?.recommend_room_list || rec?.data?.list || [];
    for (const r of rooms) {
      const id = r.roomid || r.room_id;
      if (!id) continue;
      const info = await call('api.live.bilibili.com',
        `/xlive/web-room/v1/index/getRoomBaseInfo?room_ids=${id}&req_biz=web`);
      const one = Object.values(info?.data?.by_room_ids || {})[0];
      if (one && one.live_status === 1) return { id, title: one.title };
    }
  } catch (e) { /* 桥不通,下面回退 */ }
  return null;
}

let passed = 0, failed = 0, warned = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log(`  ✅ ${name}${detail ? ': ' + detail : ''}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ': ' + detail : ''}`); }
};
const warn = (name, detail) => { warned++; console.log(`  ⚠️  ${name}${detail ? ': ' + detail : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // The bridge is what makes dev meaningful. Probe with retries — a single
  // shot raced the service's startup and silently downgraded a whole run to
  // the proxy path (2026-08-02). SIM_STRICT=1 (set by verify.sh --sim) turns a
  // missing bridge into a failure instead of a warning.
  let bridgeUp = false;
  for (let i = 0; i < 10 && !bridgeUp; i++) {
    try { bridgeUp = (await fetch(BRIDGE)).ok; } catch (e) { /* not yet */ }
    if (!bridgeUp) await sleep(1000);
  }
  if (bridgeUp) check('dev-service bridge up (same code path as the TV)', true);
  else if (process.env.SIM_STRICT) check('dev-service bridge up (same code path as the TV)', false, 'not reachable on :9528');
  else warn('dev-service bridge down', 'falling back to proxy — results are less TV-like');

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
    // A fresh browser profile is logged OUT, so like/coin/fav never rendered
    // and the whole logged-in surface went untested (caught 2026-08-02: the
    // control bar came back as 暂停|弹幕|倍速|画质|评论, no 三连 buttons).
    // Seed the same cookies the service holds.
    try {
      const jar = JSON.parse(await (await fetch('http://127.0.0.1:9528/luna/getCookies', { method: 'POST', body: '{}' })).text());
      const ck = (jar && (jar.cookies || jar)) || {};
      if (ck.SESSDATA) {
        await page.evaluate((c) => localStorage.setItem('bili_auth', JSON.stringify(c)), ck);
        await page.reload();
      }
    } catch (e) { /* bridge down — covered by the check above */ }
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
    // 固定 sleep 会随网速漂移:2026-08-09 起播要 10-12s,9s 的等待连挂两轮,
    // 排查半天发现视频其实在播,只是比断言晚。改成轮询,最多等 25s。
    let vod = { playing: false, ct: null };
    for (let i = 0; i < 25 && !vod.playing; i++) {
      await sleep(1000);
      vod = await page.evaluate(() => {
        const v = document.querySelector('video');
        return { playing: !!v && !v.paused && v.currentTime > 1, ct: v ? Math.round(v.currentTime) : null };
      });
    }
    check('Video plays', vod.playing, `t=${vod.ct}s`);
    for (let a = 0; a < 4; a++) { await key('ArrowUp'); await sleep(700); if (await focusedBtn()) break; }
    const controls = await page.evaluate(() => [...document.querySelectorAll('.player-btn')].map(b => b.textContent.trim()));
    check('Control bar has the expected buttons', controls.some(c => c.includes('弹幕')) && controls.some(c => c.includes('倍速')) && controls.some(c => c.includes('评论')),
      controls.join(' | '));
    const loggedIn = await page.evaluate(() => !!(JSON.parse(localStorage.getItem('bili_auth') || '{}').SESSDATA));
    if (loggedIn) {
      check('Logged in: 赞/币/藏 present in the control bar',
        controls.some(c => c.includes('👍')) && controls.some(c => c.includes('⭐')),
        controls.filter(c => /👍|B |⭐/.test(c)).join(' '));
    } else {
      warn('Not logged in', 'like/coin/fav surface skipped — start tools/dev-service.mjs to seed cookies');
    }

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
    const liveRoom = (await pickLiveRoom()) || { id: LIVE_ROOM_FALLBACK, title: '(fallback)', stale: true };
    if (liveRoom.stale) warn('No live room is streaming right now', 'live assertions skipped (environment, not code)');
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
    await page.evaluate((r) => window.__openLive({ roomid: r, title: 'SIM', owner: { name: 'SIM' } }), liveRoom.id);
    await sleep(14000);
    const live = await page.evaluate(() => {
      const v = document.querySelector('video');
      return { playing: !!v && !v.paused && v.currentTime > 0.5, ct: v ? +v.currentTime.toFixed(1) : null,
        res: v ? v.videoWidth + 'x' + v.videoHeight : null };
    });
    check('Live stream plays', live.playing || liveRoom.stale, `${liveRoom.title.slice(0,18)} t=${live.ct}s ${live.res}`);
    for (let a = 0; a < 4; a++) { await key('ArrowUp'); await sleep(700); if (await focusedBtn()) break; }
    const liveCtrls = await page.evaluate(() => [...document.querySelectorAll('.player-btn')].map(b => b.textContent.trim()));
    check('Live control bar: danmaku / quality / chat', liveCtrls.length >= 3 && liveCtrls.some(c => c.includes('聊天')),
      liveCtrls.join(' | '));
    check('Chat rail defaults to off', liveCtrls.some(c => c.includes('聊天 关')));

    // 下键也要能呼出控制栏 —— 点播是上/下都行,直播原来只有上键,按下去像没反应
    // (owner 2026-08-22:"跟普通视频体验不一样")
    await key('Escape'); await sleep(800);          // 先收起控制栏
    await key('ArrowDown'); await sleep(1200);
    const byDown = await page.evaluate(() => [...document.querySelectorAll('.player-btn')].map(b => b.textContent.trim()));
    check('直播:按「下」也能呼出控制栏(与点播一致)', liveRoom.stale || byDown.length >= 2, byDown.join(' | '));

    // 开得对称,关也要对称:控制栏开着时上、下都该收起(owner 2026-08-22)
    await key('ArrowUp'); await sleep(1000);
    const closedByUp = await page.evaluate(() => document.querySelectorAll('.player-btn').length === 0);
    check('直播:控制栏开着时按「上」能收起', liveRoom.stale || closedByUp);
    await key('ArrowDown'); await sleep(1000);
    const reopened = await page.evaluate(() => document.querySelectorAll('.player-btn').length > 0);
    await key('ArrowDown'); await sleep(900);
    const closedByDown = await page.evaluate(() => document.querySelectorAll('.player-btn').length === 0);
    check('直播:按「下」同样能收起(开关对称)', liveRoom.stale || (reopened && closedByDown),
      `重开=${reopened} 下键关=${closedByDown}`);
    await key('ArrowUp'); await sleep(900);   // 复原:后面的断言需要控制栏是开着的

    let lf = '';
    for (let i = 0; i < 5; i++) { lf = await focusedBtn(); if (!lf.includes('弹幕') && !lf.includes('聊天')) break; await key('ArrowRight'); await sleep(250); }
    await key('Enter'); await sleep(900);
    const qual = await page.evaluate(() => [...document.querySelectorAll('.ctrl-popup .quality-option')].map(o => o.textContent.trim()));
    // 有的房间只推一档(原画),ladder 有内容就算通过 —— 断 >=2 会被房间选择左右
    check('Live quality ladder opens', liveRoom.stale || qual.length >= 1, qual.join('/'));
    await key('Escape'); await sleep(600);

    // chat rail on → layered Back
    for (let i = 0; i < 6; i++) { const b = await focusedBtn(); if (b.includes('聊天')) break; await key('ArrowRight'); await sleep(220); }
    await key('Enter'); await sleep(1500);
    const railOn = await page.evaluate(() => !![...document.querySelectorAll('div')].find(d => d.style && d.style.width === '420px'));
    check('Chat rail opens from the control bar', liveRoom.stale || railOn);
    // 进房就该有内容:只订阅实时流的话,冷清房间半天不出一条,像坏了
    // (owner 2026-08-22:"每次都是实时清屏相当于")
    const chatLines = await page.evaluate(() => {
      const rail = [...document.querySelectorAll('div')].find(d => d.style && d.style.width === '420px');
      if (!rail) return 0;
      return (rail.innerText || '').split('\n').filter(x => x.trim()).length;
    });
    // 冷清的房间本身就没几条历史 —— 那是内容事实,不是功能坏。先问接口这个房间
    // 到底有多少条,再决定该不该要求聊天栏有内容(同 C-SIM-01 的思路)。
    const histCount = await page.evaluate(async (rid) => {
      try {
        const r = await fetch('http://127.0.0.1:9528/luna/fetch', { method: 'POST',
          body: JSON.stringify({ url: `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=${rid}` }) });
        const j = JSON.parse(await r.text());
        return ((JSON.parse(j.body || '{}').data || {}).room || []).length;
      } catch (e) { return -1; }
    }, liveRoom.id);
    check('聊天栏打开即有历史消息(不是空屏等实时)',
      liveRoom.stale || histCount <= 2 || chatLines >= 5,
      `栏内 ${chatLines} 行 · 该房间历史 ${histCount} 条`);
    await key('Escape'); await sleep(700);   // controls
    await key('Escape'); await sleep(900);   // rail
    const afterRail = await page.evaluate(() => ({
      rail: !![...document.querySelectorAll('div')].find(d => d.style && d.style.width === '420px'),
      live: !!document.querySelector('.player-page'),
    }));
    check('Back closes the chat rail, stays in the room', liveRoom.stale || (!afterRail.rail && afterRail.live));
    await key('Escape'); await sleep(900);
    const leftRoom = await page.evaluate(() => !document.querySelector('.player-page'));
    check('Back again leaves the live room', leftRoom);


    console.log('\n[稍后再看 / Watch Later]');
    // 端到端:播放器里加入 → 「我的」页看到 → 长按移除。净零写入(加什么移什么),
    // 且移除前断言卡片身份 —— 绝不能把 owner 真正存的东西长按掉(写操作安全线)。
    if (!loggedIn) {
      warn('Watch Later skipped', 'needs a logged-in session');
    } else {
      await page.evaluate((bv) => window.__openVideo({ bvid: bv }), FIXTURE);
      await sleep(8000);
      for (let a = 0; a < 4; a++) { await key('ArrowUp'); await sleep(600); if (await focusedBtn()) break; }
      const laterBtns = await page.evaluate(() => [...document.querySelectorAll('.player-btn')].map(b => b.textContent.trim()));
      check('Player has a 稍后再看 button', laterBtns.some(c => c.includes('稍后再看')), laterBtns.join(' | '));
      // 走到那个按钮上按 OK
      let hops = 0, cur = await focusedBtn();
      while (hops < 10 && !cur.includes('稍后再看')) { await key('ArrowRight'); await sleep(250); cur = await focusedBtn(); hops++; }
      let added = false;
      if (cur.includes('稍后再看')) {
        await key('Enter'); await sleep(2200);
        const after = await focusedBtn();
        added = after.includes('已稍后再看');
        check('OK adds it and the button flips to 已稍后再看', added, after);
      } else {
        check('OK adds it and the button flips to 已稍后再看', false, 'button not reachable');
      }
      for (let i = 0; i < 4; i++) { await key('Escape'); await sleep(700); }

      await gotoPage('我的');
      await sleep(1500);
      const tabs = await page.evaluate(() => [...document.querySelectorAll('.fav-chip')].map(c => c.textContent.trim()));
      check('「我的」has 观看历史 / 稍后再看 tabs', tabs.length >= 2 && tabs.some(x => x.includes('稍后再看')), tabs.join(' | '));
      // 焦点移到第二个 chip = 切到稍后再看(选中即切换)
      await page.evaluate(() => {
        const c = [...document.querySelectorAll('.fav-chip')].find(x => x.textContent.includes('稍后再看'));
        if (c) c.click();   // mouseenter 派发不出去(React 用 mouseover 模拟),click 走 handleClick
      });
      await sleep(4000);
      // 卡片第一行是时长角标,标题在后面 —— 用整段 innerText 匹配
      const inList = await page.evaluate(() => [...document.querySelectorAll('.video-card')].map(c => c.innerText.replace(/\n/g, ' ')));
      check('The added video shows up in 稍后再看', inList.some(x => x.includes('弹幕')), `${inList.length} cards`);

      if (added) {
        // 长按移除 —— 只对夹具视频动手,先核对身份
        // 悬停把焦点移到目标卡上,然后**回读 .video-card.focused** 再断言身份 ——
        // 长按打在哪张卡由焦点决定,断言就必须读焦点那张。真机套件里正是因为
        // 断言读了列表第一张、长按落在第二张,误删了 owner 真存的视频(2026-08-06)。
        await page.evaluate(() => {
          const c = [...document.querySelectorAll('.video-card')].find(x => x.innerText.includes('弹幕'));
          if (c) c.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        });
        await sleep(400);
        const target = await page.evaluate(() => {
          const f = document.querySelector('.video-card.focused');
          return f ? f.innerText.replace(/\n/g, ' ') : null;
        });
        check('Remove target is the fixture video, not a real saved item', !!target && target.includes('弹幕'), target || '(none)');
        if (target && target.includes('弹幕')) {
          // 长按现在**弹菜单**,不再直接删(owner 2026-08-09:"不要删除,而是弹出菜单")
          await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
          await sleep(1100);   // 长按阈值 800ms
          await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })));
          await sleep(1800);
          const menu = await page.evaluate(() => [...document.querySelectorAll('.cardmenu-item')].map(x => x.textContent.trim()));
          check('Long-press opens the card menu (not an instant delete)',
            menu.length > 0 && menu.some(x => x.includes('移除')), menu.join(' | '));
          const stillThere = await page.evaluate(() => [...document.querySelectorAll('.video-card')].some(c => c.innerText.includes('弹幕')));
          check('Nothing is deleted just by opening the menu', stillThere);
          // 菜单里选「从稍后再看移除」
          await page.evaluate(() => {
            const it = [...document.querySelectorAll('.cardmenu-item')].find(x => x.textContent.includes('移除'));
            if (it) it.click();
          });
          await sleep(3000);
          const left = await page.evaluate(() => [...document.querySelectorAll('.video-card')].map(c => c.innerText.replace(/\n/g, ' ')));
          check('Menu → 移除 takes it out of the list', !left.some(x => x.includes('弹幕')), `${left.length} cards left`);
        }
      }

      // 回归:进「稍后再看」→ 按下进网格 → 再按上,不能跳回观看历史
      // (owner 2026-08-09 报的 bug:上来时焦点落在第 0 列 = 观看历史,tab 被顺手切走)
      await page.evaluate(() => {
        const c = [...document.querySelectorAll('.fav-chip')].find(x => x.textContent.includes('稍后再看'));
        if (c) c.click();
      });
      await sleep(2500);
      await key('ArrowDown'); await sleep(700);
      await key('ArrowUp'); await sleep(900);
      const activeTab = await page.evaluate(() => {
        const a = document.querySelector('.fav-chip-active');
        const f = document.querySelector('.fav-chip.focused');
        return { active: a ? a.textContent.trim() : null, focused: f ? f.textContent.trim() : null };
      });
      check('Back up from the grid stays on 稍后再看 (no tab reset)',
        activeTab.active && activeTab.active.includes('稍后再看'), `active=${activeTab.active} focus=${activeTab.focused}`);
      check('Returning focus lands on the active tab chip',
        activeTab.focused && activeTab.focused.includes('稍后再看'), `focus=${activeTab.focused}`);

      // 焦点态必须写进 className:焦点系统是直接改 classList 的(零重渲染),
      // 切 tab 会让 React 用新 className 重渲染 chip,把 .focused 覆盖掉 ——
      // 表现就是 owner 说的"按右两下,第二个按钮颜色不一样"(2026-08-09)。
      const chipColors = await page.evaluate(() => [...document.querySelectorAll('.fav-chip')].map(c => ({
        txt: c.textContent.trim(),
        active: c.classList.contains('fav-chip-active'),
        focused: c.classList.contains('focused'),
        bg: getComputedStyle(c).backgroundColor,
      })));
      const sel = chipColors.find(c => c.active);
      check('选中的 tab 是实心蓝,且焦点态没被重渲染擦掉',
        !!sel && sel.focused && sel.bg === 'rgb(0, 161, 214)',
        chipColors.map(c => `${c.txt}[${c.active ? 'A' : ''}${c.focused ? 'F' : ''}]${c.bg}`).join(' '));
    }

    console.log('\n[卡片长按菜单 / Card menu]');
    // 任意列表页的卡片长按都该弹菜单(不只是稍后再看列表)
    await gotoPage('推荐');
    await sleep(2500);
    await page.evaluate(() => {
      const c = document.querySelector('.video-card');
      if (c) c.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await sleep(400);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await sleep(1100);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })));
    await sleep(2500);
    const homeMenu = await page.evaluate(() => [...document.querySelectorAll('.cardmenu-item')].map(x => x.textContent.trim()));
    check('首页卡片长按也弹菜单,含「加入稍后再看」',
      homeMenu.some(x => x.includes('稍后再看')), homeMenu.join(' | '));
    const noPlay = await page.evaluate(() => !document.querySelector('.player-page'));
    check('长按不会误触发播放', noPlay);
    await key('Escape'); await sleep(900);

    // 保险:菜单是"按住 OK"弹出来的,手还按着;遥控器连发 keydown 不能把第一项
    // 确认掉(owner 2026-08-09:「不能一直长按就可以点击吧,得再按一次」)。
    // 实测过:没这道保险时,按住 2 秒就直接把视频加进了列表。
    await page.evaluate(() => {
      const c = document.querySelector('.video-card');
      if (c) c.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await sleep(400);
    await page.evaluate(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      for (let i = 0; i < 30; i++) {                       // 1.5s 连发,菜单 0.8s 时弹出
        await new Promise(r => setTimeout(r, 50));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat: true }));
      }
    });
    await sleep(500);
    const held = await page.evaluate(() => ({
      open: !!document.querySelector('.cardmenu'),
      msg: (document.querySelector('.cardmenu-msg') || {}).textContent || null,
    }));
    check('按住不放:菜单弹出但不会自己确认', held.open && !held.msg, `open=${held.open} msg=${held.msg}`);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })));
    await sleep(900);
    const afterUp = await page.evaluate(() => ({
      open: !!document.querySelector('.cardmenu'),
      msg: (document.querySelector('.cardmenu-msg') || {}).textContent || null,
    }));
    check('松手本身也不算确认', afterUp.open && !afterUp.msg, `open=${afterUp.open} msg=${afterUp.msg}`);
    await key('Escape'); await sleep(800);   // 取消掉,别真加进列表

    console.log('\n[已关注标]');
    // 判据必然为真:「关注」页里的 UP 按定义全部已关注,所以每张卡都该有标。
    // 原来只拉 5 页关注列表(250 个)就停,第 251 个之后的 UP 永远没标 ——
    // 表现就是 owner 说的"有的有 有的没有"(2026-08-31)。
    await gotoPage('关注');
    await sleep(3500);
    const fol = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.video-card')];
      const badged = cards.filter(c => c.innerText.includes('已关注')).length;
      let cached = null;
      try { cached = (JSON.parse(localStorage.getItem('bili_followed') || 'null') || {}).mids?.length ?? null; } catch (e) {}
      return { n: cards.length, badged, cached };
    });
    check('关注页每张卡都有「已关注」标', fol.n > 0 && fol.badged === fol.n,
      `${fol.badged}/${fol.n} 有标 · 本地关注缓存 ${fol.cached} 个`);

    console.log('\n[取流失败 → 直达网络诊断]');
    // issue #23:用户被风控拦住时,原来只看到一句"视频加载失败"。现在要给
    // ① 说得清的原因(按登录状态分流:已登录还被拦 = 多半是账号被风控)
    // ② 一个能按下去的出路(OK 直达网络诊断)
    await page.route('**/luna/fetch', async route => {
      const body = route.request().postData() || '';
      if (body.includes('player/playurl')) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ returnValue: true, statusCode: 200,
            body: JSON.stringify({ code: -351, message: '风控校验失败', data: null }) }) });
      }
      return route.continue();
    });
    await page.evaluate((bv) => window.__openVideo({ bvid: bv }), FIXTURE);
    await sleep(10000);
    const errScreen = await page.evaluate(() => ({
      hint: (document.body.innerText || '').split('\n').find(l => l.includes('风控')) || '',
      btn: !!([...document.querySelectorAll('.player-btn')].find(b => b.textContent.includes('诊断'))),
    }));
    check('取流被拒时给出风控提示(不是泛泛的加载失败)', !!errScreen.hint, errScreen.hint.slice(0, 46));
    check('已登录时提示指向"账号被风控"而不是"去登录"',
      errScreen.hint.includes('账号'), errScreen.hint.slice(0, 46));
    check('错误页有「去网络诊断」按钮', errScreen.btn);
    await key('Enter'); await sleep(5000);
    const landed = await page.evaluate(() => ({
      player: !!document.querySelector('.player-page'),
      diag: (document.body.innerText || '').includes('后台服务'),
    }));
    check('OK 直达网络诊断(退出播放器 + 面板自动展开)', !landed.player && landed.diag,
      `player=${landed.player} diag=${landed.diag}`);
    await page.unroute('**/luna/fetch');

    console.log('\n[界面字号 / UI text scale]');
    // issue #22。风险不在字变大,在**放大后网格滚动会不会裁切** —— 卡片变高,
    // 而滚动读的是真实 offsetTop(2026-07 修过一次),这里就是守那条修复。
    await gotoPage('设置');
    await sleep(1500);
    const rowsUi = await page.evaluate(() => [...document.querySelectorAll('.settings-row')].map(r => r.innerText.split('\n')[0].trim()));
    check('设置里有「界面字号」', rowsUi.some(r => r.includes('界面字号')), rowsUi.join(' / '));

    const scaled = await page.evaluate(() => {
      document.documentElement.style.setProperty('--ui-scale', '1.25');
      return true;
    });
    await gotoPage('推荐');
    await sleep(2600);
    const big = await page.evaluate(() => {
      const t = document.querySelector('.video-card-title');
      const s = document.querySelector('.sidebar-item');
      return { title: getComputedStyle(t).fontSize, side: getComputedStyle(s).fontSize,
               sideOverflow: s.scrollWidth > s.clientWidth + 1 };
    });
    check('特大档字号确实放大了', parseFloat(big.title) > 26, `标题 ${big.title} · 侧栏 ${big.side}`);
    check('侧栏文字没有溢出', !big.sideOverflow);

    // 放大后重跑网格滚动几何:深行可见 + 回到顶部不裁切
    for (let i = 0; i < 3; i++) { await key('ArrowLeft'); await sleep(200); }
    await key('ArrowRight'); await sleep(800);
    for (let i = 0; i < 6; i++) { await key('ArrowDown'); await sleep(200); }
    await sleep(900);
    const deepBig = await cardRect();
    check('特大档:深行卡片完整可见', !!deepBig && deepBig.top >= 0 && deepBig.bottom <= 1081,
      deepBig && `top=${deepBig.top} bottom=${deepBig.bottom}`);
    for (let i = 0; i < 6; i++) { await key('ArrowUp'); await sleep(200); }
    await sleep(900);
    const topBig = await cardRect();
    check('特大档:回到顶部不裁切', !!topBig && topBig.top >= 0 && topBig.peek === null,
      topBig && `top=${topBig.top}`);
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1'));
    await sleep(600);

    console.log('\n[设置:看完移出稍后再看]');
    await gotoPage('设置');
    await sleep(1500);
    const rows2 = await page.evaluate(() => [...document.querySelectorAll('.settings-row')].map(r => r.innerText.split('\n')[0].trim()));
    check('设置里有「看完移出稍后再看」开关', rows2.some(r => r.includes('看完移出稍后再看')), rows2.join(' / '));

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
