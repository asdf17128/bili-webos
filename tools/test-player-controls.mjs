// Real React player + trusted Chromium input. Only the decoder/media state and
// synthetic API/image responses are controlled. No TV or real account is used.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

const baseUrl = process.env.CONTROLS_URL || 'http://127.0.0.1:5173';
const viteOrigin = new URL(baseUrl).origin;
assert.ok(new URL(baseUrl).protocol === 'http:' && new URL(baseUrl).hostname === '127.0.0.1', 'isolated loopback Vite origin');
const baseline = process.argv.includes('--baseline');
const output = process.env.CONTROLS_OUTPUT || '/tmp/bili-player-controls';
await mkdir(output, { recursive: true });
const reports = [];
const sourcePaths = ['app/src/player/PlayerPage.jsx', 'app/src/player/SubtitleLayer.jsx', 'app/src/player/playerControls.css', 'app/src/styles.css', 'app/src/tv-design.css', 'app/src/hooks/useAuthorFollowers.js', 'app/src/utils/authorFollowers.js'];
const hashSources = () => Promise.all(sourcePaths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])).then(Object.fromEntries);
const sources = await hashSources();
if (process.env.CONTROLS_ANALYZE_ONLY) {
  const saved = JSON.parse(await readFile(`${output}/results.json`, 'utf8'));
  const evaluations = [];
  for (const scene of ['coast', 'window']) {
    const prefix = `${baseline ? 'before' : 'after'}-scene-${scene}`;
    const record = saved.results.find(item => item.name === 'scene transparency ' + scene);
    const pixels = analyzeScenePixels(await readFile(`${output}/${prefix}-video.png`), await readFile(`${output}/${prefix}-controls.png`), record.checkpoints[prefix + '-controls']);
    try { assertSceneTransparency(pixels, scene); evaluations.push({ scene, pass: true, pixels }); }
    catch (error) { evaluations.push({ scene, pass: false, error: error.message, pixels }); }
  }
  await writeFile(`${output}/pixel-analysis.json`, JSON.stringify({ evidenceSources: saved.sources, evaluations }, null, 2));
  const compact = ({ rows, ...metrics }) => metrics;
  console.log(JSON.stringify(evaluations.map(({ scene, pass, error, pixels }) => ({ scene, pass, error, title: compact(pixels.title), controls: compact(pixels.controls), fade: compact(pixels.fade) })), null, 2));
  process.exit(evaluations.some(item => !item.pass) ? 1 : 0);
}
const browser = await chromium.launch({ headless: true });
const stub = `class Player {
 static isBrowserSupported(){return true}
 async attach(v){this.video=v}
 configure(){} addEventListener(name,fn){(this.events||(this.events={}))[name]=fn}
 getNetworkingEngine(){return this.net||(this.net={registerRequestFilter(){},registerResponseFilter(){},addEventListener(){}})}
 getVariantTracks(){return []} getStats(){return {}} retryStreaming(){return true}
 async load(url,position,mime){window.__controlsProbe.loads++;window.__controlsProbe.mimes.push(mime);await(await fetch(url)).text();const v=this.video;v.__fixture.ready=4;if(position)v.currentTime=position;v.dispatchEvent(new Event('loadedmetadata'));v.dispatchEvent(new Event('loadeddata'));v.dispatchEvent(new Event('canplay'));}
 async unload(){if(this.video)this.video.__fixture.ready=0}
 async destroy(){window.__controlsProbe.destroyed++}
}
export default {Player,polyfill:{installAll(){}}};`;
const items = Array.from({ length: 12 }, (_, i) => ({ aid: 300 + i, bvid: 'BVControlsRelated' + i,
  title: ['山海之间，寻找生活的另一种可能', '周末放映室：值得慢慢看的故事', '把平凡的日子拍成电影'][i % 3],
  pic: 'https://fixture.invalid/controls-cover-' + i + '.svg', duration: 553 + i * 13,
  owner: { name: '合成测试 UP', mid: 10 + i }, stat: { view: 12000 }, pubdate: 1790323200 }));

// Local vector test footage, deliberately rich in detail beneath the entire
// control deck. It contains no fetched image, real person, or real media.
function sceneSvg(name) {
  if (name === 'window') return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#c9e8f2"/><stop offset="1" stop-color="#f6dfad"/></linearGradient><pattern id="panes" width="240" height="1080" patternUnits="userSpaceOnUse"><rect width="232" height="1080" fill="none"/><rect width="22" height="1080" fill="#264853"/><rect x="22" width="8" height="1080" fill="#f6efce"/></pattern></defs><rect width="1920" height="1080" fill="url(#sky)"/><circle cx="420" cy="220" r="100" fill="#fff7d8"/><path d="M0 620L230 420L410 610L680 350L920 650L1230 440L1500 610L1770 390L1920 550V1080H0" fill="#5b9293"/><path d="M0 800Q320 640 670 810T1250 740T1920 840V1080H0" fill="#8cbbb0"/><path d="M0 960Q400 780 840 960T1920 920V1080H0" fill="#d8c795"/><rect width="1920" height="1080" fill="url(#panes)"/><rect y="360" width="1920" height="22" fill="#264853"/><rect y="670" width="1920" height="22" fill="#264853"/></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#a6cbd7"/><stop offset="1" stop-color="#ebdfba"/></linearGradient><linearGradient id="sea" x2="0" y2="1"><stop stop-color="#588f9e"/><stop offset="1" stop-color="#b2d4c9"/></linearGradient><pattern id="water" width="210" height="76" patternUnits="userSpaceOnUse"><path d="M0 16H90M130 48H205" stroke="#e5e9c8" stroke-width="12" opacity=".8"/><path d="M20 46H100M120 14H185M50 65H155" stroke="#315d70" stroke-width="7" opacity=".75"/></pattern></defs><rect width="1920" height="1080" fill="url(#sky)"/><circle cx="1480" cy="185" r="95" fill="#f8ecc0"/><path d="M0 530L270 280L500 530L750 350L1080 600H0" fill="#365b69"/><path d="M0 580L390 450L650 640L980 470L1330 650H0" fill="#6c9796"/><rect y="580" width="1920" height="500" fill="url(#sea)"/><rect y="580" width="1920" height="500" fill="url(#water)"/><path d="M0 860Q380 650 630 850T1090 1040L1140 1080H0" fill="#d5ba88"/><path d="M0 837Q380 627 630 827T1090 1017" fill="none" stroke="#f1e4bf" stroke-width="14"/></svg>`;
}

// Measure spatial texture in the actual pixels, not the CSS background string.
// The quiet right-side ROI avoids title glyphs, controls, time and subtitles in
// these fixed 1080p scenes. Low-variance rows cannot support a meaningful fit.
function analyzeScenePixels(referenceBytes, controlsBytes, geometry) {
  const reference = PNG.sync.read(referenceBytes), shown = PNG.sync.read(controlsBytes);
  assert.equal(reference.width, shown.width); assert.equal(reference.height, shown.height);
  const x0 = Math.round(reference.width * .70), x1 = Math.round(reference.width * .87);
  const luminance = (png, x, y) => { const i = 4 * (y * png.width + x); return .2126 * png.data[i] + .7152 * png.data[i + 1] + .0722 * png.data[i + 2]; };
  const row = y => {
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let x = x0; x < x1; x += 2) {
      const a = luminance(reference, x, y), b = luminance(shown, x, y);
      n++; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b;
    }
    const vx = sxx / n - (sx / n) ** 2, vy = syy / n - (sy / n) ** 2, cov = sxy / n - sx * sy / (n * n);
    if (vx < 64) return null;
    return { y, retainedDetail: cov / vx, correlation: vy > 0 ? cov / Math.sqrt(vx * vy) : 0, referenceStd: Math.sqrt(vx), shownStd: Math.sqrt(Math.max(0, vy)) };
  };
  const band = (start, end) => {
    const rows = [];
    for (let y = Math.ceil(start); y < Math.floor(end); y++) { const value = row(y); if (value) rows.push(value); }
    const slopes = rows.map(value => value.retainedDetail).sort((a, b) => a - b);
    return { start, end, validRows: rows.length, totalRows: Math.floor(end) - Math.ceil(start), minimumRetention: slopes[0] ?? null,
      medianRetention: slopes.length ? slopes[Math.floor(slopes.length / 2)] : null,
      minimumCorrelation: rows.length ? Math.min(...rows.map(value => value.correlation)) : null,
      minimumShownStd: rows.length ? Math.min(...rows.map(value => value.shownStd)) : null, rows };
  };
  const title = band(geometry.title.y, geometry.title.bottom);
  const controls = band(geometry.buttons.y, geometry.buttons.bottom);
  const fade = band(geometry.controls.y, geometry.title.y - 2);
  const byY = new Map(fade.rows.map(value => [value.y, value]));
  fade.maximum16pxDrop = Math.max(0, ...fade.rows.filter(value => byY.has(value.y + 16)).map(value => value.retainedDetail - byY.get(value.y + 16).retainedDetail));
  return { method: 'Per-row regression of screenshot sRGB luma, controlled scene without/with controls; excludes reference std<8. Retained detail is a pixel metric, not physical optical transmittance or text contrast.', roi: { x0, x1 }, title, controls, fade };
}

function assertSceneTransparency(pixels, scene) {
  for (const [name, band, floor] of [['title', pixels.title, .40], ['controls', pixels.controls, .35]]) {
    assert.ok(band.validRows >= 5, `${name} region has enough real scene texture to measure`);
    assert.ok(band.minimumCorrelation >= .98, `${name} region retains the same scene structure`);
    assert.ok(band.minimumRetention >= floor, `${name} scene detail survives the overlay (minimum ${floor})`);
  }
  if (scene === 'window') {
    assert.ok(pixels.fade.validRows >= 24, 'continuous window bars measure the full gradient entry');
    assert.ok(pixels.fade.maximum16pxDrop <= .12, 'no abrupt 16px dark shelf edge at gradient entry');
  }
}

async function fixture(options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 1920, height: options.height || 1080 }, serviceWorkers: 'block' });
  const calls = { related: 0, followers: 0, interceptedHttp: 0, interceptedSockets: 0, unexpectedWrites: [], knownMockWrites: [], documents: 0, contractErrors: [] };
  const pending = [];
  await context.addInitScript(options => {
    delete window.webOS; delete window.PalmServiceBridge;
    localStorage.clear();
    localStorage.setItem('bili_proxyUrl', JSON.stringify('http://127.0.0.1:9527'));
    localStorage.setItem('bili_settings', JSON.stringify({ language: options.language || 'zh', uiScale: options.scale || 1, gridCols: 3, quality: 80, qualityMode: 'manual', subtitle: true, danmaku: false, playbackMode: 'stop' }));
    localStorage.setItem('bili_perfopt', JSON.stringify({ prefetchPage: false, warmPlayer: false }));
    // These credentials exist only in this new browser context. Every outgoing
    // HTTP/WS call outside Vite is intercepted before it reaches the network.
    if (options.auth !== false) localStorage.setItem('bili_auth', JSON.stringify({ SESSDATA: 'synthetic-controls-session', DedeUserID: '123', bili_jct: 'synthetic-controls-csrf' }));
    window.__controlsProbe = { loads: 0, destroyed: 0, mimes: [], seeks: [], plays: 0, pauses: 0, menus: 0 };
    window.__controlsInput = { keydown: 0, keyup: 0, click: 0, mousedown: 0, mouseup: 0, mousemove: 0, untrusted: 0 };
    for (const type of ['keydown', 'keyup', 'click', 'mousedown', 'mouseup', 'mousemove']) window.addEventListener(type, e => { window.__controlsInput[e.isTrusted ? type : 'untrusted']++; }, true);
    window.addEventListener('card-menu', () => window.__controlsProbe.menus++);
    const media = el => el.__fixture || (el.__fixture = { time: 120, paused: true, ready: 0 });
    Object.defineProperties(HTMLMediaElement.prototype, {
      currentTime: { configurable: true, get() { return media(this).time; }, set(value) { media(this).time = Number(value); window.__controlsProbe.seeks.push(Number(value)); this.dispatchEvent(new Event('timeupdate')); } },
      duration: { configurable: true, get() { return 600; } },
      paused: { configurable: true, get() { return media(this).paused; } },
      readyState: { configurable: true, get() { return media(this).ready; } },
      buffered: { configurable: true, get() { return { length: 1, start() { return 0; }, end() { return 600; } }; } },
      videoWidth: { configurable: true, get() { return 1920; } },
      videoHeight: { configurable: true, get() { return 1080; } },
    });
    HTMLMediaElement.prototype.play = function () { media(this).paused = false; window.__controlsProbe.plays++; this.dispatchEvent(new Event('play')); if (media(this).ready >= 2) this.dispatchEvent(new Event('playing')); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () { media(this).paused = true; window.__controlsProbe.pauses++; this.dispatchEvent(new Event('pause')); };
    setInterval(() => document.querySelectorAll('video').forEach(video => { const state = media(video); if (!state.paused && state.ready >= 2) { state.time += .25; video.dispatchEvent(new Event('timeupdate')); } }), 250);
  }, options);
  await context.routeWebSocket('**/*', socket => { calls.interceptedSockets++; socket.close(); });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === viteOrigin) {
      if (url.pathname.includes('shaka-player')) return route.fulfill({ contentType: 'application/javascript', body: stub });
      return route.continue();
    }
    calls.interceptedHttp++;
    const fulfill = data => route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (request.method() === 'OPTIONS') return fulfill({});
    if (url.pathname.includes('controls-cover-')) {
      const n = Number(url.pathname.match(/controls-cover-(\d+)/)?.[1] || 0);
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="672" height="378"><rect width="672" height="378" fill="${['#37646b','#93684a','#526d4c','#605f89'][n % 4]}"/><circle cx="500" cy="95" r="55" fill="#e6d4b1"/><path d="M0 340L220 120L420 350L550 180L672 300V378H0" fill="#14222a" opacity=".75"/></svg>` });
    }
    if (url.port === '9528') return route.abort();
    if (request.method() !== 'GET') {
      const known = /\/heartbeat$|\/archive\/like$|\/archive\/like\/triple$/.test(url.pathname);
      if (known) calls.knownMockWrites.push(url.pathname);
      else if (url.pathname.endsWith('/translate_a/t')) return fulfill(new URLSearchParams(request.postData() || '').getAll('q'));
      else calls.unexpectedWrites.push(url.pathname);
      return fulfill({ code: 0, data: {} });
    }
    let data = {};
    if (url.pathname.endsWith('/nav')) data = { isLogin: options.auth !== false, mid: 123, uname: '合成测试账号', wbi_img: { img_url: 'https://fixture.invalid/abcdefghijklmnopqrstuvwxyz123456.png', sub_url: 'https://fixture.invalid/abcdefghijklmnopqrstuvwxyz123456.png' } };
    if (url.pathname.includes('/top/feed/rcmd')) data = { item: [] };
    if (url.pathname.endsWith('/history/cursor')) data = { list: [] };
    if (url.pathname.endsWith('/x/relation')) data = { attribute: 0 };
    if (url.pathname.endsWith('/view')) data = { aid: 100, bvid: 'BVControlsFixture', cid: 2, title: '山海之间，寻找生活的另一种可能 · 播放器控制栏测试', pages: [{ cid: 2 }], owner: { mid: 1, name: options.longName ? '一个名字非常长的合成测试创作者｜山海生活摄影记录者' : '合成测试 UP' }, pubdate: 1790323200, stat: { like: 5678, coin: 123, favorite: 890 } };
    if (url.pathname.endsWith('/relation/stat')) {
      calls.followers++;
      if (url.searchParams.get('vmid') !== '1') calls.contractErrors.push('follower request must use video author 1, not current account 123');
      if (options.followers === 'failure') return route.abort();
      data = options.followers === 'unknown' ? {} : { follower: options.followers ?? 125678 };
    }
    if (url.pathname.endsWith('/playurl')) data = { quality: 80, accept_quality: [80, 64, 32, 16], dash: { duration: 600, video: [{ id: 80, bandwidth: 1000, baseUrl: 'https://media.fixture.invalid/video', codecs: 'avc1.640028', width: 1920, height: 1080, frameRate: '30', SegmentBase: { Initialization: '0-51', indexRange: '52-70' } }], audio: [] } };
    if (url.pathname.endsWith('/v2')) data = { last_play_cid: 2, last_play_time: 0, subtitle: { subtitles: [{ lan: 'zh-CN', lan_doc: '中文', subtitle_url: 'https://fixture.invalid/controls-subtitle.json' }] } };
    if (url.pathname.endsWith('/controls-subtitle.json')) return fulfill({ body: [{ from: 0, to: 600, content: '字幕保持可读，不应被控制栏遮挡' }] });
    if (url.pathname.endsWith('/list.so')) return route.fulfill({ contentType: 'text/xml', body: '<i></i>' });
    if (url.pathname.endsWith('/archive/related')) {
      calls.related++;
      if (options.related === 'loading') await new Promise(resolve => pending.push(resolve));
      if (options.related === 'failure') return route.abort();
      data = options.related === 'empty' ? [] : items;
    }
    if (url.pathname.endsWith('/x/v2/reply')) data = { page: { count: 0 }, replies: [] };
    return fulfill({ code: 0, data });
  });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) calls.documents++; });
  await page.goto(baseUrl);
  await page.waitForFunction(() => !!window.__openVideo);
  await page.evaluate(() => window.__openVideo({ bvid: 'BVControlsFixture', resumeMode: 'none' }));
  await page.waitForFunction(() => window.__controlsProbe.loads === 1 && document.querySelector('video')?.readyState === 4);
  await page.waitForFunction(() => document.querySelector('.player-control-label')?.textContent === '暂停');
  await page.waitForFunction(() => document.querySelector('.player-time')?.textContent.includes('/ 10:00'));
  const scene = options.scene ? `url("data:image/svg+xml;base64,${Buffer.from(sceneSvg(options.scene)).toString('base64')}") center / 100% 100% no-repeat` : options.background === 'dark' ? 'linear-gradient(125deg,#08161b,#132937 40%,#060b13)' : 'linear-gradient(125deg,#fffce4,#edf6fa 40%,#ffffff)';
  await page.addStyleTag({ content: `video { background: ${scene} !important; }` });
  return { context, page, calls, errors, options, release: () => pending.splice(0).forEach(resolve => resolve()) };
}

async function state(page) {
  return page.evaluate(() => {
    const box = selector => { const el = document.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, visibleBottom: Math.min(r.bottom, innerHeight), right: r.right, opacity: s.opacity, background: s.background, color: s.color }; };
    const controls = document.querySelector('.player-controls');
    return { controls: box('.player-controls'), video: box('video'), progress: box('.player-progress-bar'), buttons: box('.player-btns'), title: box('.player-title'), subtitle: box('.subtitle-text'), tabs: box('.panel-tab-row'), card: box('.related-card'), preview: box('.player-recommendation-preview'), focused: document.querySelector('.player-btn.focused')?.textContent, relatedCards: document.querySelectorAll('.related-card').length, visibleControls: !!controls && !controls.classList.contains('hidden'), expanded: controls?.classList.contains('recommendations-open'), controlsScroll: controls?.scrollTop, media: { paused: document.querySelector('video')?.paused, time: document.querySelector('video')?.currentTime }, input: window.__controlsInput, probe: window.__controlsProbe };
  });
}
async function openControls(page) { await page.keyboard.press('ArrowUp'); await page.waitForFunction(() => !document.querySelector('.player-controls').classList.contains('hidden')); await page.waitForTimeout(350); }
async function focusedCard(page, index) {
  await page.waitForFunction(index => {
    const focused = [...document.querySelectorAll('.related-card')].map((el, i) => el.classList.contains('focused') ? i : -1).filter(i => i >= 0);
    return focused.length === 1 && focused[0] === index;
  }, index);
}
async function shot(f, name) { await f.page.screenshot({ path: `${output}/${name}.png` }); (f.checkpoints ||= {})[name] = await state(f.page); }
async function run(name, options, fn) {
  if (process.env.CONTROLS_FILTER && !new RegExp(process.env.CONTROLS_FILTER).test(name)) return;
  let f; const started = Date.now();
  try {
    f = await fixture(options); await fn(f);
    assert.deepEqual(f.errors, [], 'no uncaught browser errors');
    assert.deepEqual(f.calls.unexpectedWrites, [], 'no unexpected writes even inside mock boundary');
    assert.deepEqual(f.calls.contractErrors, [], 'outbound mocked API contract');
    assert.equal(f.calls.documents, 1, 'one document throughout case; reload cannot reset probes');
    const snapshot = await state(f.page);
    assert.equal(snapshot.input.untrusted, 0, 'keyboard and mouse events must be trusted');
    reports.push({ name, pass: true, durationMs: Date.now() - started, snapshot, checkpoints: f.checkpoints, pixels: f.pixels, network: f.calls }); console.log('PASS', name);
  } catch (error) {
    const snapshot = f ? await state(f.page).catch(() => null) : null;
    reports.push({ name, pass: false, error: error.message, snapshot, checkpoints: f?.checkpoints, pixels: f?.pixels, network: f?.calls, errors: f?.errors }); console.log('FAIL', name, error.message.split('\n')[0]);
    if (f) await shot(f, 'failure-' + reports.length);
  } finally {
    if (f) { f.release(); await f.context.close(); }
    await writeFile(`${output}/results.json`, JSON.stringify({ baseline, baseUrl, sources, boundary: 'Real React/API/controller with controlled Shaka and media events; every non-Vite HTTP request and every WebSocket is intercepted. New contexts use only synthetic account/video data. No real media decoding, television, desktop foreground, or phone interaction.', results: reports }, null, 2));
  }
}

for (const scene of ['coast', 'window']) await run('scene transparency ' + scene, { scene, width: 1920, height: 1080 }, async f => {
  await f.page.waitForTimeout(700);
  await shot(f, `${baseline ? 'before' : 'after'}-scene-${scene}-video`);
  await openControls(f.page);
  await shot(f, `${baseline ? 'before' : 'after'}-scene-${scene}-controls`);
  const prefix = `${baseline ? 'before' : 'after'}-scene-${scene}`;
  f.pixels = analyzeScenePixels(await readFile(`${output}/${prefix}-video.png`), await readFile(`${output}/${prefix}-controls.png`), await state(f.page));
  assertSceneTransparency(f.pixels, scene);
});

for (const options of [
  { width: 1920, height: 1080, background: 'dark' }, { width: 1920, height: 1080, background: 'light' },
  { width: 1280, height: 720, background: 'dark' }, { width: 1280, height: 720, background: 'light' },
  { width: 1920, height: 1080, background: 'light', scale: 1.4 }, { width: 1280, height: 720, background: 'light', scale: 1.25 },
]) await run(`visual ${options.width}x${options.height} ${options.background} scale=${options.scale || 1}`, options, async f => {
  await f.page.waitForTimeout(700); await openControls(f.page);
  await shot(f, `${baseline ? 'before' : 'after'}-${options.width}x${options.height}-${options.background}-${options.scale || 1}`);
  const s = await state(f.page);
  assert.ok(s.controls.x >= 0 && s.controls.y >= 0 && s.controls.visibleBottom <= options.height && s.buttons.bottom <= options.height && s.controls.right <= options.width, 'controls fit the actual viewport');
  assert.ok(s.progress.height >= 6, 'progress remains at least 6px');
  assert.ok(s.buttons.y >= s.progress.bottom + 8, 'controls do not overlap the timeline');
  assert.ok(s.preview && s.preview.height > 20 && s.preview.y < options.height && s.preview.bottom > s.preview.y, 'controls opening exposes a real recommendation preview without Down');
  assert.ok(s.subtitle && s.subtitle.y >= 0 && s.subtitle.bottom <= s.title.y, 'subtitle stays in viewport and does not overlap the control title');
  assert.equal(s.focused, '暂停', 'preview does not steal initial control focus');
  assert.equal(await f.page.locator('.related-grid').count(), 1, 'preview and expansion share one recommendation grid');
  const preview = await f.page.locator('.player-recommendation-preview').evaluate(el => {
    const images = [...el.querySelectorAll('img')].slice(0, 4);
    const visibleImage = image => {
      const r = image.getBoundingClientRect(); let top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
      for (let p = image.parentElement; p; p = p.parentElement) {
        if (/hidden|auto|scroll|clip/.test(getComputedStyle(p).overflowY)) { const c = p.getBoundingClientRect(); top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom); }
      }
      return { height: r.height, visible: Math.max(0, bottom - top) };
    };
    const visible = images.map(visibleImage);
    return { count: images.length, decoded: images.every(img => img.complete && img.naturalWidth > 0), clipped: visible.some(r => r.visible > 20 && r.visible < r.height - 1), visible };
  });
  assert.equal(preview.count, 4, 'preview reuses the first four existing recommendations');
  assert.ok(preview.decoded, 'preview images decode');
  assert.ok(preview.clipped, 'preview shows a partial card row to invite Down');
});

if (!baseline) {
  await run('recommendation cards share listing appearance and extend the panel upward', {}, async f => {
    await openControls(f.page);
    const before = await state(f.page);
    await f.page.keyboard.press('ArrowDown'); await f.page.waitForTimeout(450);
    const measured = await f.page.evaluate(() => {
      const card = document.querySelector('.related-card');
      if (!card.querySelector('.video-card-info')) return { shared: false };
      const holder = document.createElement('div');
      holder.className = 'video-grid cols-4';
      holder.style.cssText = 'position:fixed;left:-5000px;width:' + card.offsetWidth + 'px;grid-template-columns:1fr';
      const reference = card.cloneNode(true); reference.className = 'video-card';
      holder.appendChild(reference); document.body.appendChild(holder);
      const properties = (el, names) => { const s=getComputedStyle(el);return names.map(n=>s[n]); };
      const appearance = el => [properties(el,['backgroundColor','borderRadius']), ...['.video-card-thumb','.video-card-info','.video-card-title','.video-card-meta'].map(selector=>properties(el.querySelector(selector),['fontSize','lineHeight','height','padding','color']))];
      const actual=appearance(card), expected=appearance(reference);
      const cover=card.querySelector('.video-card-thumb').getBoundingClientRect();
      const result={shared:true,actual,expected,cover:{width:cover.width,height:cover.height},height:card.offsetHeight};
      holder.remove(); return result;
    });
    assert.ok(measured.shared, 'uses the shared listing card structure, not horizontal mini cards');
    assert.deepEqual(measured.actual, measured.expected, 'cover, text tracks, padding, background and radius match the listing');
    assert.ok(Math.abs(measured.cover.width/measured.cover.height-16/9)<.01, 'full-width 16:9 cover');
    assert.ok(measured.cover.width>400 && measured.height>330, '1080p cards retain normal four-column dimensions');
    const after=await state(f.page);
    assert.ok(after.controls.y < before.controls.y - 500, 'two rows are revealed by raising the panel, not shrinking cards');
    await shot(f, 'full-size-two-row-cards');
  });

  await run('reopening a scrolled shelf restores a visible remote focus', {}, async f => {
    await openControls(f.page);await f.page.keyboard.press('ArrowDown');await f.page.waitForTimeout(450);
    await f.page.keyboard.press('ArrowDown');await f.page.keyboard.press('ArrowDown');await f.page.keyboard.press('ArrowDown');await f.page.waitForTimeout(450);
    await f.page.keyboard.press('Escape');await f.page.waitForTimeout(450);
    await f.page.keyboard.press('ArrowDown');await f.page.waitForTimeout(450);await f.page.keyboard.press('ArrowDown');await f.page.waitForTimeout(450);
    const position=await f.page.evaluate(()=>{const a=document.querySelector('.related-card'),b=document.querySelector('.player-related-scroll'),r=a.getBoundingClientRect(),s=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,viewportTop:s.top,viewportBottom:s.bottom,pageScroll:document.querySelector('.player-page').scrollTop};});
    assert.ok(position.top>=position.viewportTop-1&&position.bottom<=position.viewportBottom+1,'focused first card is actually visible');
    assert.equal(position.pageScroll,0,'grid navigation never scrolls the video page');
  });
  await run('small wheel deltas accumulate without skipping multiple rows', {}, async f => {
    await openControls(f.page);await f.page.keyboard.press('ArrowDown');await f.page.waitForTimeout(450);
    const list=f.page.locator('.player-related-scroll'),r=await list.boundingBox();
    await f.page.mouse.move(r.x+30,r.y+30);
    for(let i=0;i<6;i++){await f.page.mouse.wheel(0,20);await f.page.waitForTimeout(30);}
    await f.page.waitForTimeout(500);
    const scroll=await list.evaluate(el=>el.scrollTop);
    const stride=await f.page.locator('.related-card').first().evaluate(el=>el.offsetHeight+(parseFloat(getComputedStyle(el.parentElement).rowGap)||24));
    assert.ok(scroll>50 && scroll<=stride+2,'small stream advances one row');
    await f.page.mouse.wheel(0,-120);await f.page.waitForTimeout(450);
    assert.equal(await list.evaluate(el=>el.scrollTop),0,'reverse returns to the top');
    assert.equal((await state(f.page)).expanded,true,'reverse scroll does not prematurely collapse');
  });
  for (const input of ['remote', 'wheel']) await run('recommendation row scrolling animates ' + input, {}, async f => {
    await openControls(f.page); await f.page.keyboard.press('ArrowDown'); await f.page.waitForTimeout(450);
    await f.page.keyboard.press('ArrowDown'); await f.page.keyboard.press('ArrowDown');
    await f.page.evaluate(() => {
      window.__rowPositions=[]; const start=performance.now();
      const sample=()=>{window.__rowPositions.push(document.querySelector('.player-related-scroll').scrollTop);if(performance.now()-start<700)requestAnimationFrame(sample);};requestAnimationFrame(sample);
    });
    if (input==='remote') await f.page.keyboard.press('ArrowDown');
    else { const r=await f.page.locator('.player-related-scroll').boundingBox();await f.page.mouse.move(r.x+40,r.y+40);await f.page.mouse.wheel(0,120); }
    await f.page.waitForTimeout(750);
    const positions=await f.page.evaluate(()=>window.__rowPositions), end=positions.at(-1);
    assert.ok(end>50,'third row scrolled into view');
    assert.ok(new Set(positions.filter(x=>x>1&&x<end-1).map(Math.round)).size>=3,'row movement has multiple intermediate positions');
    assert.equal((await state(f.page)).probe.loads,1);
  });
  for (const options of [{}, {width:1280,height:720,scale:1.4}]) await run('expanded shelf shows two full rows without per-frame layout resizing ' + (options.height || 1080), options, async f => {
    await openControls(f.page);
    const layoutHeight = await f.page.locator('.player-controls-vod').evaluate(el => el.offsetHeight);
    await f.page.keyboard.press('ArrowDown'); await f.page.waitForTimeout(450);
    const rows = await f.page.locator('.related-card').evaluateAll(cards => cards.slice(0,8).map(el => {const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom};}));
    assert.equal(rows.length,8);
    assert.ok(rows.every(r=>r.top>=0&&r.bottom<=(options.height || 1080)), 'two complete rows remain in the viewport');
    assert.equal(await f.page.locator('.player-controls-vod').evaluate(el => el.offsetHeight),layoutHeight,'animation keeps layout height constant');
  });
  await run('shelf animation under six-fold CPU slowdown', {}, async f => {
    await openControls(f.page);
    const cdp = await f.page.context().newCDPSession(f.page);
    await cdp.send('Emulation.setCPUThrottlingRate', {rate:6});
    const height = await f.page.locator('.player-controls-vod').evaluate(el => el.offsetHeight);
    await f.page.keyboard.press('ArrowDown'); await f.page.waitForTimeout(650);
    assert.equal(await f.page.locator('.player-controls-vod').evaluate(el => el.offsetHeight), height, 'slow CPU still uses stable layout');
    assert.ok(await f.page.locator('.player-controls-vod').evaluate(el => el.classList.contains('recommendations-open')));
    await f.page.keyboard.press('Escape'); await f.page.waitForTimeout(650);
    assert.equal((await state(f.page)).expanded,false);
    assert.equal((await state(f.page)).probe.loads,1,'animation never reloads media');
    await cdp.send('Emulation.setCPUThrottlingRate', {rate:1}); await cdp.detach();
  });

  await run('recommendation cards remain continuous while opening and closing', {}, async f => {
    await openControls(f.page);
    await f.page.evaluate(() => { window.__firstShelfImage = document.querySelector('.player-recommendation-preview img'); });
    await f.page.keyboard.press('ArrowDown');
    await f.page.waitForTimeout(450);
    assert.ok(await f.page.evaluate(() => window.__firstShelfImage === document.querySelector('.player-related-scroll img')), 'expansion preserves the original image node instead of replacing cropped previews');
    await f.page.keyboard.press('Escape');
    await f.page.waitForTimeout(450);
    assert.ok(await f.page.evaluate(() => window.__firstShelfImage === document.querySelector('.player-recommendation-preview img')), 'collapse preserves the same image node');
  });
  for (const input of ['wheel', 'remote']) await run('smooth shelf expansion ' + input, {}, async f => {
    await openControls(f.page);
    const before = await state(f.page);
    await f.page.evaluate(() => {
      window.__shelfFrames = [];
      const start = performance.now();
      const sample = () => {
        const el = document.querySelector('.player-controls-vod');
        window.__shelfFrames.push({ t: performance.now() - start, top: el.getBoundingClientRect().top });
        if (performance.now() - start < 700) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    if (input === 'wheel') {
      await f.page.mouse.move(before.title.x + 80, before.title.y + 10);
      await f.page.mouse.wheel(0, 120);
    } else await f.page.keyboard.press('ArrowDown');
    await f.page.waitForTimeout(750);
    const after = await state(f.page);
    assert.equal(after.expanded, true, 'Down expands recommendations');
    assert.ok(after.controls.y < before.controls.y - 100, 'shelf moves upward');
    assert.ok(after.controls.height >= 1080 * .45, 'expanded shelf occupies roughly half the screen');
    const frames = await f.page.evaluate(() => window.__shelfFrames);
    assert.ok(frames.filter(x => x.top < before.controls.y - 5 && x.top > after.controls.y + 5).length >= 3, 'multiple intermediate frames, not a height jump');
    assert.equal(after.media.paused, before.media.paused, 'expansion preserves playback');
    await shot(f, 'smooth-expanded-' + input);
    await f.page.keyboard.press('Escape');
    await f.page.waitForTimeout(350);
    assert.equal((await state(f.page)).expanded, false, 'Back collapses shelf');
  });
  await run('shelf rapid reversal and reduced motion', { width: 1280, height: 720, scale: 1.25 }, async f => {
    await openControls(f.page);
    await f.page.keyboard.press('ArrowDown');
    await f.page.waitForTimeout(60);
    const mid = await state(f.page);
    await f.page.keyboard.press('Escape');
    const reversing = await state(f.page);
    assert.ok(Math.abs(mid.controls.y - reversing.controls.y) < 70, 'reversal starts from the current visual position');
    await f.page.waitForTimeout(350);
    assert.equal((await state(f.page)).expanded, false);
    await f.page.emulateMedia({ reducedMotion: 'reduce' });
    await f.page.keyboard.press('ArrowDown');
    await f.page.waitForTimeout(50);
    assert.equal(await f.page.locator('.player-controls-vod').evaluate(el => el.getAnimations().length), 0, 'reduced motion skips shelf animation');
    const expanded = await state(f.page);
    assert.ok(expanded.tabs.y >= 0 && expanded.controls.bottom <= 720, 'full-sized cards and tabs fit 720p; the deck can move above the viewport');
    const list = f.page.locator('.player-related-scroll');
    const box = await list.boundingBox();
    await f.page.mouse.move(box.x + 50, box.y + 50);
    await f.page.mouse.wheel(0, 240);
    await f.page.waitForTimeout(300);
    assert.ok(await list.evaluate(el => el.scrollTop > 0), 'expanded list still scrolls');
    await f.page.mouse.wheel(0, -240);
    await f.page.waitForTimeout(300);
    assert.equal((await state(f.page)).expanded, true, 'scrolling up through content does not collapse early');
    await f.page.mouse.wheel(0, -120);
    await f.page.waitForTimeout(300);
    assert.equal((await state(f.page)).expanded, false, 'wheel up at the beginning collapses');
  });

  for (const scale of [1, 1.4]) await run('remote Down Up Back navigation scale=' + scale, { background: 'dark', scale }, async f => {
    await f.page.waitForTimeout(700); await openControls(f.page);
    await f.page.keyboard.press('ArrowDown');
    await f.page.locator('.player-controls.recommendations-open .panel-tab-row').waitFor();
    await f.page.keyboard.press('ArrowDown');
    await focusedCard(f.page, 0);
    await f.page.keyboard.press('ArrowRight'); await focusedCard(f.page, 1);
    await f.page.keyboard.press('ArrowDown'); await focusedCard(f.page, 5);
    await f.page.keyboard.press('ArrowUp'); await focusedCard(f.page, 1);
    await f.page.keyboard.press('ArrowLeft'); await focusedCard(f.page, 0);
    await f.page.keyboard.press('ArrowUp'); await f.page.keyboard.press('ArrowUp');
    await f.page.waitForFunction(() => !!document.querySelector('.player-btn.focused'));
    const control = await f.page.locator('.player-btn.focused').boundingBox();
    assert.ok(control.y >= 0 && control.y + control.height <= 1080, 'returned focused control is visibly inside viewport');
    await f.page.keyboard.press('ArrowDown'); await f.page.keyboard.press('ArrowDown');
    await f.page.waitForTimeout(350);
    const expanded = await state(f.page);
    assert.equal(expanded.subtitle, null, 'full-size recommendation browsing hides subtitles instead of cropping them at the screen edge');
    await shot(f, 'after-expanded-recommendations-' + scale);
    await f.page.keyboard.press('Escape');
    await f.page.locator('.player-recommendation-preview').waitFor();
    const collapsed = await state(f.page);
    assert.equal(collapsed.visibleControls, true, 'first Back returns from recommendations to controls');
    assert.equal(collapsed.expanded, false);
    await f.page.waitForTimeout(450);
    const restoredSubtitle = await state(f.page);
    assert.ok(restoredSubtitle.subtitle.y >= 0 && restoredSubtitle.subtitle.bottom <= restoredSubtitle.title.y, 'subtitles return visibly above the deck after collapsing');
    assert.equal(collapsed.focused, '暂停');
    await f.page.keyboard.press('Escape');
    assert.equal((await state(f.page)).visibleControls, false, 'second Back returns to video');
    assert.equal(await f.page.locator('video').count(), 1, 'second Back does not exit playback');
    await f.page.keyboard.press('Escape');
    await f.page.waitForFunction(() => !document.querySelector('video'));
  });

  await run('auto hide pause play and expanded shelf persistence', { background: 'light' }, async f => {
    await openControls(f.page); await f.page.waitForTimeout(5350);
    assert.equal((await state(f.page)).visibleControls, false, 'idle controls hide after existing five-second timeout');
    await f.page.keyboard.press('Enter');
    assert.equal((await state(f.page)).media.paused, true, 'OK without controls pauses');
    const pausedTime = (await state(f.page)).media.time;
    await f.page.waitForTimeout(700);
    assert.equal((await state(f.page)).media.time, pausedTime, 'controlled playback remains paused');
    await f.page.keyboard.press('Enter');
    assert.equal((await state(f.page)).media.paused, false, 'second OK resumes');
    await openControls(f.page); await f.page.keyboard.press('Enter');
    assert.equal((await state(f.page)).media.paused, true, 'focused play control pauses');
    await f.page.keyboard.press('Enter');
    await f.page.keyboard.press('ArrowDown'); await f.page.waitForTimeout(5350);
    assert.equal((await state(f.page)).expanded, true, 'browsing recommendations suspends auto-hide');
    assert.equal((await state(f.page)).visibleControls, true);
  });

  await run('deferred seek cancel commit and pointer progress', { background: 'dark' }, async f => {
    await f.page.keyboard.press('Enter');
    const start = (await state(f.page)).media.time;
    await f.page.keyboard.press('ArrowRight'); await f.page.keyboard.press('Escape');
    assert.equal((await state(f.page)).media.time, start, 'Back cancels deferred seek before one-second commit');
    assert.equal((await state(f.page)).media.paused, true);
    await f.page.waitForTimeout(1300);
    assert.equal((await state(f.page)).media.time, start, 'cancelled seek remains cancelled after its original timer deadline');
    assert.equal((await state(f.page)).media.paused, true);
    assert.equal((await state(f.page)).probe.seeks.length, 0, 'cancelled timer never assigns currentTime');
    await f.page.keyboard.press('ArrowRight'); await f.page.keyboard.press('Enter');
    assert.ok(Math.abs((await state(f.page)).media.time - (start + 10)) < .6, 'OK commits ten-second seek');
    assert.equal((await state(f.page)).media.paused, false, 'committed seek resumes like existing behavior');
    await f.page.waitForTimeout(1500); await openControls(f.page);
    const progress = await f.page.locator('.player-progress-bar').boundingBox();
    await f.page.mouse.click(progress.x + progress.width / 2, progress.y + progress.height / 2);
    assert.ok(Math.abs((await state(f.page)).media.time - 300) < .6, 'trusted pointer seeks to exact midpoint');
  });

  await run('subtitle popup and long press stay reachable', { background: 'light' }, async f => {
    await f.page.waitForTimeout(700); await openControls(f.page);
    for (let i = 0; i < 6; i++) await f.page.keyboard.press('ArrowRight');
    assert.match((await state(f.page)).focused, /字幕/);
    await f.page.keyboard.press('Enter'); await f.page.locator('.ctrl-popup').waitFor();
    await f.page.waitForTimeout(5350);
    assert.equal((await state(f.page)).visibleControls, true, 'subtitle choice suspends auto-hide');
    await f.page.keyboard.press('Escape');
    assert.match((await state(f.page)).focused, /字幕/);
    for (let i = 0; i < 5; i++) await f.page.keyboard.press('ArrowLeft');
    await f.page.keyboard.down('Enter'); await f.page.waitForTimeout(500);
    await f.page.locator('.like-ring').waitFor(); await shot(f, 'after-like-hold');
    await f.page.keyboard.up('Enter');
    assert.equal(f.calls.knownMockWrites.length, 0, 'aborted like hold does not submit a like or triple');
    await f.page.keyboard.down('Enter'); await f.page.waitForTimeout(2200); await f.page.keyboard.up('Enter');
    assert.equal(f.calls.knownMockWrites.filter(path => path.endsWith('/archive/like/triple')).length, 1, 'full two-second hold submits one synthetic triple');
    await f.page.keyboard.press('ArrowDown'); await f.page.keyboard.press('ArrowDown');
    await f.page.keyboard.down('Enter'); await f.page.waitForTimeout(900); await f.page.keyboard.up('Enter');
    await f.page.locator('.cardmenu').waitFor();
    assert.equal((await state(f.page)).probe.loads, 1, 'long recommendation press opens menu without starting another video');
    assert.equal((await state(f.page)).probe.menus, 1);
    await shot(f, 'after-related-long-press');
    await f.page.keyboard.press('Escape');
  });

  await run('quality popup returns to its control and keeps media state', { background: 'dark' }, async f => {
    await f.page.waitForTimeout(700); await openControls(f.page);
    for (let i = 0; i < 8; i++) await f.page.keyboard.press('ArrowRight');
    assert.equal((await state(f.page)).focused, '1080P');
    await f.page.keyboard.press('Enter'); await f.page.locator('.quality-popup').waitFor();
    await shot(f, 'after-quality-popup');
    await f.page.keyboard.press('Escape');
    assert.equal((await state(f.page)).focused, '1080P');
    assert.equal((await state(f.page)).probe.loads, 1, 'closing menu does not reload media');
  });

  await run('pointer preview expands existing recommendation shelf', { background: 'light' }, async f => {
    await f.page.waitForTimeout(700); await openControls(f.page);
    await f.page.locator('.player-recommendation-preview').click();
    await f.page.locator('.player-controls.recommendations-open .related-card').first().waitFor();
    assert.equal((await state(f.page)).probe.loads, 1, 'preview click opens shelf without playing a recommendation');
  });

  for (const related of ['empty', 'loading', 'failure']) await run('recommendation ' + related + ' has no invented preview and remains navigable', { background: 'light', related }, async f => {
    await f.page.waitForTimeout(700); await openControls(f.page);
    assert.equal(await f.page.locator('.player-recommendation-preview').count(), 0);
    await shot(f, 'after-recommendation-' + related);
    await f.page.keyboard.press('ArrowDown');
    await f.page.keyboard.press('ArrowUp');
    assert.equal(await f.page.locator('video').count(), 1, 'missing recommendations do not exit player');
    await f.page.keyboard.press('Escape');
    assert.equal(await f.page.locator('video').count(), 1, 'Back from controls stays in player');
  });

  await run('follower count stays with the control deck throughout hide and reopen', {}, async f => {
    await openControls(f.page);
    await f.page.locator('.player-author-followers').waitFor();
    await f.page.evaluate(() => {
      window.__followerNode=document.querySelector('.player-author-followers');
      window.__followerFrames=[];
      const start=performance.now();
      const sample=()=>{
        const deck=document.querySelector('.player-controls'), count=document.querySelector('.player-author-followers');
        window.__followerFrames.push({opacity:Number(getComputedStyle(deck).opacity),same:count===window.__followerNode,text:count?.textContent});
        if(performance.now()-start<450) requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    });
    await f.page.keyboard.press('Escape'); await f.page.waitForTimeout(500);
    const frames=await f.page.evaluate(()=>window.__followerFrames);
    assert.ok(frames.some(x=>x.opacity>0&&x.opacity<1), 'observe the real fade-out interval');
    assert.ok(frames.every(x=>x.same&&x.text==='12.6万粉丝'), 'count stays mounted unchanged even while controls fade');
    await openControls(f.page);
    assert.ok(await f.page.evaluate(()=>document.querySelector('.player-author-followers')===window.__followerNode), 'reopening does not replace or blink the count');
    assert.equal(f.calls.followers,1,'hide/reopen does not refetch');
    await f.page.keyboard.press('ArrowDown'); await f.page.waitForTimeout(450);
    assert.ok(await f.page.evaluate(()=>document.querySelector('.player-author-followers')===window.__followerNode), 'expansion keeps the same count node');
  });

  for (const followers of [0, 125678, 'unknown', 'failure']) await run('author followers ' + followers, { background: 'light', followers }, async f => {
    await openControls(f.page);
    if (typeof followers === 'number') {
      await f.page.waitForFunction(() => !!document.querySelector('.player-author-followers'));
      assert.equal(await f.page.locator('.player-author-followers').textContent(), followers === 0 ? '0粉丝' : '12.6万粉丝');
    } else {
      await f.page.waitForTimeout(500);
      assert.equal(await f.page.locator('.player-author-followers').count(), 0, 'unknown or failed count is hidden, never fabricated as zero');
    }
    assert.equal(f.calls.followers, 1, 'one read fetch while controls open');
    await f.page.keyboard.press('Escape'); await openControls(f.page);
    assert.equal(f.calls.followers, 1, 'reopening controls reuses bounded follower cache');
    if (typeof followers === 'number') assert.equal(await f.page.locator('.player-author-followers').textContent(), followers === 0 ? '0粉丝' : '12.6万粉丝', 'cached count is rendered again');
    else assert.equal(await f.page.locator('.player-author-followers').count(), 0, 'cached failure remains hidden');
    await shot(f, 'after-followers-' + followers);
  });

  for (const background of ['light', 'dark']) await run('long author small viewport ' + background, { background, longName: true, width: 1280, height: 720, scale: 1.25 }, async f => {
    await openControls(f.page); await f.page.locator('.player-author-followers').waitFor();
    const layout = await f.page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      return { name: rect('.player-author-name'), followers: rect('.player-author-followers'), title: rect('.player-title'), subtitle: rect('.subtitle-text') };
    });
    assert.ok(layout.name.right <= layout.followers.left && layout.followers.right <= 1280, 'long author leaves followers visible beside its name');
    assert.ok(layout.subtitle.top >= 0 && layout.subtitle.bottom <= layout.title.top, 'large text subtitles stay above title');
    await shot(f, 'after-long-author-720-' + background);
  });

  await run('720 large text comment rail preserves control navigation', { background: 'light', longName: true, width: 1280, height: 720, scale: 1.4 }, async f => {
    await openControls(f.page); await f.page.keyboard.press('ArrowLeft');
    assert.equal((await state(f.page)).focused, '评论');
    await f.page.keyboard.press('Enter'); await f.page.locator('.comment-rail-body').waitFor();
    await f.page.waitForTimeout(350);
    const s = await state(f.page);
    const railFrame = await f.page.locator('.comment-rail-body').evaluate(el => { const r = el.parentElement.getBoundingClientRect(); return { left: r.left, top: r.top, bottom: r.bottom }; });
    assert.ok(s.controls.x >= 0 && s.controls.y >= 0 && s.controls.right <= railFrame.left && s.controls.visibleBottom <= 720 && s.buttons.bottom <= 720, 'controls stay inside narrowed video area');
    assert.ok(s.video.x >= 0 && s.video.y >= 0 && s.video.right <= railFrame.left && s.video.bottom <= 720, 'video fits the left area without crossing the comment rail');
    assert.ok(Math.abs(s.video.width / s.video.height - 16 / 9) < .001, 'comment rail keeps the video at 16:9');
    assert.ok(railFrame.top >= 0 && railFrame.bottom <= 720, 'comment rail fits actual 720p viewport');
    assert.ok(s.subtitle.y >= 0 && s.subtitle.bottom <= s.title.y, 'narrow large-text control deck does not push subtitles above screen or into title');
    assert.ok(s.subtitle.x >= 0 && s.subtitle.right <= railFrame.left, 'comment rail does not cover any part of subtitle text');
    await shot(f, 'after-720-large-comment-rail');
    await f.page.keyboard.press('Escape');
    assert.equal(await f.page.locator('.comment-rail-body').count(), 0);
    assert.equal((await state(f.page)).focused, '评论');
    await f.page.keyboard.press('ArrowRight');
    assert.equal((await state(f.page)).focused, '暂停');
    const button = await f.page.locator('.player-btn.focused').boundingBox();
    assert.ok(button.x >= 0 && button.y >= 0 && button.x + button.width <= 1280 && button.y + button.height <= 720);
  });
}

if (baseline) await run('baseline expanded recommendation shelf', { background: 'light' }, async f => {
  await f.page.waitForTimeout(700); await openControls(f.page);
  await f.page.keyboard.press('ArrowDown'); await f.page.keyboard.press('ArrowDown');
  await f.page.locator('.related-card').first().waitFor(); await f.page.waitForTimeout(300);
  await shot(f, 'before-expanded-recommendations');
});

await browser.close();
const sourcesEnd = await hashSources();
const sourcesStable = JSON.stringify(sourcesEnd) === JSON.stringify(sources);
const finalReport = JSON.parse(await readFile(`${output}/results.json`, 'utf8'));
await writeFile(`${output}/results.json`, JSON.stringify({ ...finalReport, sourcesEnd, sourcesStable }, null, 2));
console.log(`${reports.filter(x => x.pass).length}/${reports.length} passed; ${output}/results.json`);
if (!sourcesStable) console.log('INVALIDATED: production sources changed while suite was running');
if (reports.some(x => !x.pass) || !sourcesStable) process.exitCode = 1;
