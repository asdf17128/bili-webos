// 模拟器版性能观测:和 tools/perf.mjs 跑同一套场景,但在 Playwright 里跑,
// 并用 CDP 把 CPU 降速(默认 6×)逼近电视。
//
// 为什么需要它:电视经常被人用着(owner 在看片时不能抢屏幕),而性能改动
// 需要"改前 vs 改后"的对照。降速模拟器给的**绝对值不等于真机**,但同一台
// 机器上前后对比的**相对改善**是可信的 —— 真机数据仍以 tools/perf.mjs 为准。
//
// Usage: THROTTLE=6 node tools/perf-sim.mjs <label>
import { chromium } from 'playwright';
import { appendFileSync } from 'fs';

const LABEL = process.argv[2] || 'sim';
const THROTTLE = Number(process.env.THROTTLE || 6);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10; };
const fmt = (a) => a.length ? `p50 ${q(a, .5)}ms · p95 ${q(a, .95)}ms · n=${a.length}` : '(无样本)';

const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const cdp = await p.context().newCDPSession(p);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
const key = (k) => p.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: kk, bubbles: true }));
  if (kk === 'Enter') window.dispatchEvent(new KeyboardEvent('keyup', { key: kk, bubbles: true }));
}, k);
const clickSidebar = (label) => p.evaluate((l) => {
  const it = [...document.querySelectorAll('.sidebar-item')].find(x => x.textContent.includes(l));
  if (it) it.click();
}, label);

await p.goto('http://localhost:5173');
// PERF_OFF=1 关掉全部优化(同一构建、同一套打点),用于 A/B 对照
if (process.env.PERF_OFF) {
  await p.evaluate(() => localStorage.setItem('bili_perfopt', JSON.stringify({
    prefetchPage: false, prefetchThumbs: false, thumbRightsize: false, warmPlayer: false })));
} else {
  await p.evaluate(() => localStorage.removeItem('bili_perfopt'));
}
const jar = JSON.parse(await (await fetch('http://127.0.0.1:9528/luna/getCookies', { method: 'POST', body: '{}' })).text());
await p.evaluate(c => localStorage.setItem('bili_auth', JSON.stringify(c)), jar.cookies);
await p.reload();
await sleep(7000);
await p.evaluate(() => window.__perf.clear());

// 场景 1:首页下翻 24 行(跟手 + 翻页 + 图片)
await key('ArrowRight'); await sleep(600);
for (let i = 0; i < 24; i++) { await key('ArrowDown'); await sleep(280); }
await sleep(2000);

// 场景 2:页面切换 热门 → 游戏 → 推荐
for (const label of ['热门', '游戏', '推荐']) { await clickSidebar(label); await sleep(2800); }

// 场景 3:播放器打开 → 首帧 → 评论竖栏
// **开 3 次取中位数** —— 首帧受网络抖动影响很大,n=1 的结论没有意义
// (2026-08-30 就被一次重试带偏成 12.7s)。
const FIXTURES = ['BV1xx411c7Xg', 'BV1GJ411x7h7', 'BV1xx411c7Xg'];
for (let i = 0; i < FIXTURES.length; i++) {
  await p.evaluate((bv) => window.__openVideo({ bvid: bv }), FIXTURES[i]);
  await sleep(12000);
  if (i < FIXTURES.length - 1) {
    for (let k = 0; k < 4; k++) { await key('Backspace'); await sleep(700); }
    await sleep(1500);
  }
}
for (let i = 0; i < 3; i++) { await key('ArrowUp'); await sleep(700); }
for (let i = 0; i < 8; i++) {
  const f = await p.evaluate(() => (document.querySelector('.player-btn.focused') || {}).textContent || '');
  if (f.includes('评论')) break;
  await key('ArrowRight'); await sleep(250);
}
await key('Enter'); await sleep(5000);

const r = await p.evaluate(() => {
  const d = window.__perf.dump();
  const by = (k) => d.filter(e => e.k === k).map(e => e.ms);
  return {
    focus: by('focus-move'), page: by('grid-page'), pagePre: by('grid-page-prefetched'),
    img: by('img'), sw: by('page-switch'), first: by('player-first-frame'), cmt: by('comments-open'),
    poImport: by('po-shaka-import'), poInfo: by('po-info'), poPlayurl: by('po-playurl'),
    poMpd: by('po-mpd'), poShaka: by('po-shaka'),
    mem: window.__perf.memory(),
    lt: window.__perf.longTasks ? window.__perf.longTasks() : null,
  };
});
await b.close();

console.log(`\n=== 模拟器观测 [${LABEL}] · CPU ${THROTTLE}× 降速 ===`);
console.log(`跟手(按键→焦点画出):   ${fmt(r.focus)}`);
console.log(`翻页 · 命中预取:        ${fmt(r.pagePre)}`);
console.log(`翻页 · 现取(未命中):    ${fmt(r.page)}`);
console.log(`图片(挂载→缩略图可见): ${fmt(r.img)}`);
console.log(`页面切换(按下→内容画出):${fmt(r.sw)}`);
console.log(`播放器首帧(打开→出画面):${fmt(r.first)}`);
console.log(`评论竖栏(打开→列表画出):${fmt(r.cmt)}`);
console.log(`  ↳ 首帧拆解: 引擎import ${fmt(r.poImport)} | 视频信息 ${fmt(r.poInfo)} | 取流 ${fmt(r.poPlayurl)} | 建MPD ${fmt(r.poMpd)} | shaka加载 ${fmt(r.poShaka)}`);
console.log(`长任务: ${r.lt ? `${r.lt.length} 次 · 合计 ${r.lt.reduce((a, x) => a + x, 0)}ms · 最长 ${Math.max(0, ...r.lt)}ms` : '(不可观测)'}`);
console.log(`内存: ${r.mem ? r.mem.used + 'MB / 堆 ' + r.mem.total + 'MB' : '?'}`);

appendFileSync('tools/.perf-runs.jsonl', JSON.stringify({
  ts: new Date().toISOString(), label: LABEL, env: `sim-${THROTTLE}x`,
  focus: { p50: q(r.focus, .5), p95: q(r.focus, .95), n: r.focus.length },
  pagePrefetched: { p50: q(r.pagePre, .5), p95: q(r.pagePre, .95), n: r.pagePre.length },
  pageCold: { p50: q(r.page, .5), p95: q(r.page, .95), n: r.page.length },
  img: { p50: q(r.img, .5), p95: q(r.img, .95), n: r.img.length },
  pageSwitch: { p50: q(r.sw, .5), p95: q(r.sw, .95), n: r.sw.length },
  firstFrame: { p50: q(r.first, .5), p95: q(r.first, .95), n: r.first.length },
  comments: { p50: q(r.cmt, .5), p95: q(r.cmt, .95), n: r.cmt.length },
  longTasks: r.lt ? { count: r.lt.length, total: r.lt.reduce((a, x) => a + x, 0), max: Math.max(0, ...r.lt) } : null,
  mem: r.mem,
}) + '\n');
