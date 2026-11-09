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
const sourcePaths = ['app/src/player/PlayerTimeline.jsx', 'app/src/player/PlayerRecommendationGrid.jsx', 'app/src/player/TimedDanmakuLayer.jsx', 'app/src/player/useMediaClock.js', 'app/src/player/PlayerPage.jsx', 'app/src/player/adjacentVideo.js', 'app/src/player/SubtitleLayer.jsx', 'app/src/player/playerControls.css', 'app/src/player/PlayerMoreControls.jsx', 'app/src/player/playerMoreControls.css', 'app/src/components/Icon.jsx', 'app/src/i18n/en.js', 'app/src/i18n/es.js', 'app/src/styles.css', 'app/src/tv-design.css', 'app/src/hooks/useAuthorFollowers.js', 'app/src/utils/authorFollowers.js'];
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
 async load(url,position,mime){window.__controlsProbe.loads++;window.__controlsProbe.mimes.push(mime);await(await fetch(url)).text();const v=this.video;void v.readyState;v.__fixture.ready=4;if(position)v.currentTime=position;v.dispatchEvent(new Event('loadedmetadata'));v.dispatchEvent(new Event('loadeddata'));v.dispatchEvent(new Event('canplay'));}
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
  if (name === 'window') return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#c9e8f2"/><stop offset="1" stop-color="#f6dfad"/></linearGradient><pattern id="panes" width="240" height="1080" patternUnits="userSpaceOnUse"><rect width="232" height="1080" fill="none"/><rect width="22" height="1080" fill="#264853"/><rect x="22" width="8" height="1080" fill="#f6efce"/></pattern></defs><rect width="1920" height="1080" fill="url(#sky)"/><circle cx="420" cy="220" r="100" fill="#fff7d8"/><path d="M0 620L230 420L410 610L680 350L920 650L1230 440L1500 610L1770 390L1920 550V1080H0" fill="#5b9293"/><path d="M0 800Q320 640 670 810T1250 740T1920 840V1080H0" fill="#8cbbb0"/><path d="M0 960Q400 780 840 960T1920 920V1080H0" fill="#d8c795"/><rect y="360" width="1920" height="22" fill="#264853"/><rect y="670" width="1920" height="22" fill="#264853"/><rect width="1920" height="1080" fill="url(#panes)"/></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#a6cbd7"/><stop offset="1" stop-color="#ebdfba"/></linearGradient><linearGradient id="sea" x2="0" y2="1"><stop stop-color="#588f9e"/><stop offset="1" stop-color="#b2d4c9"/></linearGradient><pattern id="water" width="210" height="76" patternUnits="userSpaceOnUse"><path d="M0 16H90M130 48H205" stroke="#e5e9c8" stroke-width="12" opacity=".8"/><path d="M20 46H100M120 14H185M50 65H155" stroke="#315d70" stroke-width="7" opacity=".75"/></pattern></defs><rect width="1920" height="1080" fill="url(#sky)"/><circle cx="1480" cy="185" r="95" fill="#f8ecc0"/><path d="M0 530L270 280L500 530L750 350L1080 600H0" fill="#365b69"/><path d="M0 580L390 450L650 640L980 470L1330 650H0" fill="#6c9796"/><rect y="580" width="1920" height="500" fill="url(#sea)"/><rect y="580" width="1920" height="500" fill="url(#water)"/><path d="M0 860Q380 650 630 850T1090 1040L1140 1080H0" fill="#d5ba88"/><path d="M0 837Q380 627 630 827T1090 1017" fill="none" stroke="#f1e4bf" stroke-width="14"/></svg>`;
}

// Measure spatial texture in the actual pixels, not the CSS background string.
// The quiet 70–80% ROI is between transport and the comments/settings group; it
// avoids title glyphs, controls, time and subtitles in
// these fixed 1080p scenes. Low-variance rows cannot support a meaningful fit.
function analyzeScenePixels(referenceBytes, controlsBytes, geometry) {
  const reference = PNG.sync.read(referenceBytes), shown = PNG.sync.read(controlsBytes);
  assert.equal(reference.width, shown.width); assert.equal(reference.height, shown.height);
  const x0 = Math.round(reference.width * .70), x1 = Math.round(reference.width * .80);
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
  const calls = { related: 0, followers: 0, interceptedHttp: 0, interceptedSockets: 0, unexpectedWrites: [], knownMockWrites: [], mockWriteDetails: [], documents: 0, contractErrors: [], interactions: {} };
  const pending = [];
  const heldInteractions = [];
  const serverRelation = { like: false, coin: 0, favorite: false, ...options.interactions?.initial };
  await context.addInitScript(options => {
    if (options.performance) window.__renderCounts = {};
    delete window.webOS; delete window.PalmServiceBridge;
    localStorage.clear();
    localStorage.setItem('bili_proxyUrl', JSON.stringify('http://127.0.0.1:9527'));
    localStorage.setItem('bili_settings', JSON.stringify({ language: options.language || 'zh', uiScale: options.scale || 1, gridCols: 3, quality: 80, qualityMode: 'manual', subtitle: !options.subtitleOff, danmaku: !!options.mask, danmakuMask: !!options.mask, playbackMode: 'stop' }));
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
      if (options.performance && /\/(PlayerPage|PlayerTimeline|PlayerRecommendationGrid)\.jsx$/.test(url.pathname)) {
        const response = await route.fetch();
        let body = await response.text();
        const counters = [
          ['const videoRef = useRef(null);', 'PlayerPage'],
          ['const progress = duration > 0', 'PlayerTimeline'],
          ['const thumb = thumbUrl', 'RecommendationCard'],
        ];
        for (const [needle, name] of counters) {
          if (body.includes(needle)) body = body.replace(needle, `window.__renderCounts.${name} = (window.__renderCounts.${name} || 0) + 1;\n${needle}`);
        }
        return route.fulfill({response, body});
      }
      return route.continue();
    }
    calls.interceptedHttp++;
    const fulfill = data => route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const interactionReply = async (kind, data, commit) => {
      const index = calls.interactions[kind] || 0;
      calls.interactions[kind] = index + 1;
      let reply = options.interactions?.responses?.[kind]?.[index] || {};
      if (reply.hold) {
        const override = await new Promise(resolve => {
          heldInteractions.push({ kind, resolve });
          pending.push(resolve);
        });
        if (override) reply = { ...reply, ...override };
      }
      if (reply.abort) return route.abort();
      const code = reply.code ?? 0;
      if (code === 0) commit?.();
      return fulfill({ code, data: reply.data ?? data, ...(reply.message ? { message: reply.message } : {}) });
    };
    if (request.method() === 'OPTIONS') return fulfill({});
    if (url.pathname.includes('controls-cover-')) {
      const n = Number(url.pathname.match(/controls-cover-(\d+)/)?.[1] || 0);
      if (options.relatedCovers && n === 0) return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Synthetic cover unavailable' });
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="672" height="378"><rect width="672" height="378" fill="${['#37646b','#93684a','#526d4c','#605f89'][n % 4]}"/><circle cx="500" cy="95" r="55" fill="#e6d4b1"/><path d="M0 340L220 120L420 350L550 180L672 300V378H0" fill="#14222a" opacity=".75"/></svg>` });
    }
    if (url.port === '9528') return route.abort();
    if (request.method() !== 'GET') {
      const known = /\/heartbeat$|\/archive\/like$|\/archive\/like\/triple$/.test(url.pathname)
        || ((options.moreActions || options.interactions) && /\/coin\/add$|\/fav\/resource\/deal$|\/toview\/(add|del)$/.test(url.pathname));
      if (known) { calls.knownMockWrites.push(url.pathname); calls.mockWriteDetails.push({path:url.pathname,body:request.postData()}); }
      else if (url.pathname.endsWith('/translate_a/t')) return fulfill(new URLSearchParams(request.postData() || '').getAll('q'));
      else calls.unexpectedWrites.push(url.pathname);
      if (options.interactions) {
        const form = new URLSearchParams(request.postData() || '');
        if (url.pathname.endsWith('/archive/like')) return interactionReply('like', {}, () => { serverRelation.like = form.get('like') === '1'; });
        if (url.pathname.endsWith('/coin/add')) return interactionReply('coin', {}, () => { serverRelation.coin = Math.min(2, serverRelation.coin + Number(form.get('multiply'))); });
        if (url.pathname.endsWith('/fav/resource/deal')) return interactionReply('fav', {}, () => { serverRelation.favorite = !!form.get('add_media_ids'); });
        if (url.pathname.endsWith('/archive/like/triple')) return interactionReply('triple', {
          like: !serverRelation.like, coin: serverRelation.coin < 2, fav: !serverRelation.favorite, multiply: 2 - serverRelation.coin,
        }, () => { serverRelation.like = true; serverRelation.coin = 2; serverRelation.favorite = true; });
      }
      return fulfill({ code: 0, data: {} });
    }
    let data = {};
    if (url.pathname.endsWith('/nav')) data = { isLogin: options.auth !== false, mid: 123, uname: '合成测试账号', wbi_img: { img_url: 'https://fixture.invalid/abcdefghijklmnopqrstuvwxyz123456.png', sub_url: 'https://fixture.invalid/abcdefghijklmnopqrstuvwxyz123456.png' } };
    if (url.pathname.includes('/top/feed/rcmd')) data = { item: [] };
    if (url.pathname.endsWith('/history/cursor')) data = { list: [] };
    if (url.pathname.endsWith('/x/relation')) data = { attribute: 0 };
    if (url.pathname.endsWith('/archive/relation') && options.interactions) return interactionReply('relation', { ...serverRelation });
    if (url.pathname.endsWith('/fav/folder/created/list-all') && options.interactions) return interactionReply('folders', { list: [{ id: 456, title: '合成收藏夹', fav_state: serverRelation.favorite ? 1 : 0 }] });
    if (url.pathname.endsWith('/fav/folder/created/list-all') && options.moreActions) data = { list: [{ id: 456, title: '合成收藏夹', fav_state: 0 }] };
    if (url.pathname.endsWith('/view')) data = { aid: 100, bvid: 'BVControlsFixture', cid: 2, title: '山海之间，寻找生活的另一种可能 · 播放器控制栏测试', pages: [{ cid: 2 }], owner: { mid: 1, name: options.longName ? '一个名字非常长的合成测试创作者｜山海生活摄影记录者' : '合成测试 UP' }, pubdate: 1790323200, stat: { like: 5678, coin: 123, favorite: 890, reply: options.commentCount || 0 } };
    if (url.pathname.endsWith('/relation/stat')) {
      calls.followers++;
      if (url.searchParams.get('vmid') !== '1') calls.contractErrors.push('follower request must use video author 1, not current account 123');
      if (options.followers === 'failure') return route.abort();
      data = options.followers === 'unknown' ? {} : { follower: options.followers ?? 125678 };
    }
    if (url.pathname.endsWith('/playurl')) data = { quality: 80, accept_quality: [80, 64, 32, 16], dash: { duration: 600, video: [{ id: 80, bandwidth: 1000, baseUrl: 'https://media.fixture.invalid/video', codecs: 'avc1.640028', width: 1920, height: 1080, frameRate: '30', SegmentBase: { Initialization: '0-51', indexRange: '52-70' } }], audio: [] } };
    if (url.pathname.endsWith('/v2')) data = { last_play_cid: 2, last_play_time: 0, subtitle: { subtitles: options.subtitles === false ? [] : [{ lan: 'zh-CN', lan_doc: '中文', subtitle_url: 'https://fixture.invalid/controls-subtitle.json' }] } };
    if (url.pathname.endsWith('/v2') && options.mask && options.mask !== 'missing') data.dm_mask = {cid:options.mask === 'mismatch'?999:2,mask_url:'https://a.bilivideo.com/cmaskboss/test.webmask'};
    if (url.pathname.endsWith('/test.webmask')) { (calls.maskRanges ||= []).push(request.headers().range); return route.fulfill({status:503,body:'unavailable',headers:{'access-control-allow-origin':'*'}}); }
    if (url.pathname.endsWith('/controls-subtitle.json')) return fulfill({ body: [{ from: 0, to: 600, content: '字幕保持可读，不应被控制栏遮挡' }] });
    if (url.pathname.endsWith('/list.so')) return route.fulfill({ contentType: 'text/xml', body: '<i></i>' });
    if (url.pathname.endsWith('/archive/related')) {
      calls.related++;
      if (options.related === 'loading') await new Promise(resolve => pending.push(resolve));
      if (options.related === 'failure') return route.abort();
      data = options.related === 'empty' ? [] : options.relatedCovers ? items.map((item, i) => i === 1 ? { ...item, pic: '' } : i === 2 ? { ...item, pic: '', cover: item.pic } : item) : items;
    }
    if (url.pathname.endsWith('/x/v2/reply')) data = { page: { count: options.commentCount || 0 }, replies: [] };
    if (options.pgc && url.pathname.endsWith('/playurl')) {
      if (!url.pathname.endsWith('/pgc/player/web/v2/playurl')) calls.contractErrors.push('PGC fixture must use the v2 playurl endpoint');
      calls.pgcPlayurl = (calls.pgcPlayurl || 0) + 1;
      return fulfill({ code: 0, result: { video_info: data } });
    }
    return fulfill({ code: 0, data });
  });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', error => { errors.push(error.message); if(options.performance) console.log('Browser error:', error.message); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) calls.documents++; });
  await page.goto(baseUrl);
  await page.waitForFunction(() => !!window.__openVideo).catch(error => { throw new Error(error.message + ' browser errors: ' + errors.join('; ')); });
  await page.evaluate(pgc => window.__openVideo(pgc
    ? { isBangumi: true, epid: 123, cid: 456, aid: 700, title: '合成番剧互动测试', resumeMode: 'none' }
    : { bvid: 'BVControlsFixture', resumeMode: 'none' }), !!options.pgc);
  await page.waitForFunction(() => window.__controlsProbe.loads === 1 && document.querySelector('video')?.readyState === 4);
  await page.waitForFunction(() => ['暂停','Pause','Pausa'].includes(document.querySelector('[data-control=play] .player-control-label')?.textContent));
  await page.waitForFunction(() => document.querySelector('.player-time')?.textContent.includes('/ 10:00'));
  const scene = options.scene ? `url("data:image/svg+xml;base64,${Buffer.from(sceneSvg(options.scene)).toString('base64')}") center / 100% 100% no-repeat` : options.background === 'dark' ? 'linear-gradient(125deg,#08161b,#132937 40%,#060b13)' : 'linear-gradient(125deg,#fffce4,#edf6fa 40%,#ffffff)';
  await page.addStyleTag({ content: `video { background: ${scene} !important; }` });
  return { context, page, calls, errors, options,
    takeInteraction: async kind => {
      const deadline = Date.now() + 5000;
      while (!heldInteractions.some(item => item.kind === kind) && Date.now() < deadline) await page.waitForTimeout(20);
      const index = heldInteractions.findIndex(item => item.kind === kind);
      assert.ok(index >= 0, `mock ${kind} request is held before release`);
      return heldInteractions.splice(index, 1)[0].resolve;
    },
    release: () => pending.splice(0).forEach(resolve => resolve()),
  };
}

async function state(page) {
  return page.evaluate(() => {
    const box = selector => { const el = document.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, visibleBottom: Math.min(r.bottom, innerHeight), right: r.right, opacity: s.opacity, background: s.background, color: s.color }; };
    const controls = document.querySelector('.player-controls');
    return { controls: box('.player-controls'), video: box('video'), progress: box('.player-progress-bar'), buttons: box('.player-btns'), title: box('.player-title'), subtitle: box('.subtitle-text'), tabs: box('.panel-tab-row'), card: box('.related-card'), preview: box('.player-recommendation-preview'), focused: document.querySelector('.player-btn.focused')?.textContent, relatedCards: document.querySelectorAll('.related-card').length, visibleControls: !!controls && !controls.classList.contains('hidden'), expanded: controls?.classList.contains('recommendations-open'), controlsScroll: controls?.scrollTop, media: { paused: document.querySelector('video')?.paused, time: document.querySelector('video')?.currentTime }, input: window.__controlsInput, probe: window.__controlsProbe };
  });
}
async function openControls(page) { await page.keyboard.press('ArrowUp'); await page.waitForFunction(() => !document.querySelector('.player-controls').classList.contains('hidden')); await page.waitForTimeout(350); }
async function focusPrimary(page, id) {
  for (let i=0;i<10 && await page.locator('.player-control.focused').getAttribute('data-control')!==id;i++) await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.player-control.focused').getAttribute('data-control'),id);
}
async function openSettings(page, id) {
  if (!await page.locator('.player-more-panel').count()) {
    await focusPrimary(page,'settings');
    await page.keyboard.press('Enter');await page.locator('.player-more-panel').waitFor();
  }
  if (id) {
    for (let i=0;i<8;i++)await page.keyboard.press('ArrowUp');
    for (let i=0;i<8 && await page.locator('.player-more-action.focused').getAttribute('data-control')!==id;i++)await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('.player-more-action.focused').getAttribute('data-control'),id);
  }
}
async function focusedCard(page, index) {
  await page.waitForFunction(index => {
    const focused = [...document.querySelectorAll('.related-card')].map((el, i) => el.classList.contains('focused') ? i : -1).filter(i => i >= 0);
    return focused.length === 1 && focused[0] === index;
  }, index);
}
const engagementButton = (page, id) => page.locator(`.player-control[data-control="${id}"]`);
const engagementWrites = f => f.calls.mockWriteDetails.filter(write => /\/archive\/like(?:\/triple)?$|\/coin\/add$|\/fav\/resource\/deal$/.test(write.path));
async function engagementState(page, id) {
  return engagementButton(page,id).evaluate(button => ({ pressed: button.getAttribute('aria-pressed'), count: button.querySelector('.player-control-value')?.textContent.trim() }));
}
async function activeEngagementAppearance(page, id) {
  const appearance = await engagementButton(page,id).evaluate(button => {
    const focused=button.classList.contains('focused'), root=getComputedStyle(document.documentElement);
    const tokenColor=name=>{const probe=document.createElement('span');probe.style.color=root.getPropertyValue(name).trim();document.body.appendChild(probe);const color=getComputedStyle(probe).color;probe.remove();return color;};
    const icon=getComputedStyle(button.querySelector('.player-control-icon'));
    return {lit:button.classList.contains('lit'),background:icon.backgroundColor,color:icon.color,
      expectedBackground:tokenColor(focused?'--tv-accent':'--tv-card'),expectedColor:tokenColor(focused?'--tv-rail':'--tv-accent'),
      statusCount:button.querySelectorAll('.player-control-status').length};
  });
  assert.ok(appearance.lit, 'confirmed interaction stays visibly lit');
  assert.equal(appearance.background,appearance.expectedBackground,'confirmed surface uses the existing theme colors');
  assert.equal(appearance.color,appearance.expectedColor,'confirmed icon uses the existing theme colors');
  if(id!=='coin')assert.equal(appearance.statusCount,0,'like and favorite use color without an extra success check');
}
async function engagementFeedback(page, id, feedback) {
  await page.waitForFunction(({id,feedback}) => document.querySelector(`.player-control[data-control="${id}"]`)?.dataset.feedback === feedback, {id,feedback});
  const button = engagementButton(page,id);
  assert.equal(await button.isDisabled(),false,'feedback does not disable or remove the focused action');
  assert.equal(await page.locator('.player-control.focused').getAttribute('data-control'),id,'request feedback preserves remote focus');
  assert.equal(await button.getAttribute('aria-busy')==='true',feedback==='pending');
  const caption = await page.locator('.player-control-caption').textContent();
  assert.match(caption,feedback==='pending'?/正在|处理中/:feedback==='error'?/失败|拒绝/:/成功|已点赞|已收藏|已取消|已投/,'focused caption explains the action result');
}
async function settleRelation(f, release) {
  const response = f.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/archive/relation'));
  release(); await (await response).finished();
  await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
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

await run('performance isolated playback clock and controls', {performance: true}, async f => {
  const page = f.page;
  await openControls(page);
  const cdp = await f.context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: 6});
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__renderCounts = {}; });
  const before = await page.locator('.player-time').textContent();
  await page.waitForTimeout(2100);
  const idle = await page.evaluate(() => ({...window.__renderCounts}));
  const after = await page.locator('.player-time').textContent();
  if (process.env.PERF_BASELINE) {
    assert.ok(idle.PlayerPage >= 2 && idle.RecommendationCard >= 24, 'baseline must reproduce broad media-tick rendering');
  }
  assert.notEqual(before, after, 'timeline advances during playback');
  if (!process.env.PERF_BASELINE) {
    assert.equal(idle.PlayerPage || 0, 0, 'media clock must not render the whole player');
    assert.equal(idle.RecommendationCard || 0, 0, 'clock must not render recommendations');
    assert.ok(idle.PlayerTimeline >= 2, 'small timeline consumer receives ticks');
  }
  await page.evaluate(() => { window.__renderCounts = {}; });
  const latencies = [];
  for (let i=0;i<12;i++) {
    const previous = await page.locator('.player-control.focused').getAttribute('data-control');
    const start = performance.now();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(previous => document.querySelector('.player-control.focused')?.dataset.control !== previous, previous);
    latencies.push(performance.now() - start);
  }
  const navigation = await page.evaluate(() => ({...window.__renderCounts}));
  if (!process.env.PERF_BASELINE) assert.equal(navigation.RecommendationCard || 0, 0, 'button navigation must not rebuild recommendation cards');
  const buttons = await page.locator('.player-control:not(:disabled)').evaluateAll(nodes => nodes.map(node => node.dataset.control));
  const initial = await page.locator('.player-control.focused').getAttribute('data-control');
  for (let i=0;i<20;i++) await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
  const expected = buttons[(buttons.indexOf(initial) + 20) % buttons.length];
  await page.waitForFunction(expected => document.querySelector('.player-control.focused')?.dataset.control === expected, expected);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__renderCounts = {}; });
  await page.waitForTimeout(1100);
  const hidden = await page.evaluate(() => ({...window.__renderCounts}));
  if (!process.env.PERF_BASELINE) {
    assert.equal(hidden.PlayerPage || 0, 0, 'hidden playback clock must not render player');
    assert.equal(hidden.PlayerTimeline || 0, 0, 'hidden timeline stops sampling');
  }
  await openControls(page);
  assert.notEqual(await page.locator('.player-time').textContent(), after, 'reopening shows fresh media time');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.ok(await page.evaluate(() => window.__renderCounts.RecommendationCard > 0), 'recommendation counter observes real card renders when entering shelf');
  f.checkpoints = { performance: {cpuThrottle:6, idle, navigation, hidden, latencies, before, after, repeatedKeyCount:20} };
  await cdp.send('Emulation.setCPUThrottlingRate', {rate:1});
});

for(const mask of ['failure','missing','mismatch']) await run('person mask metadata integration '+mask, {mask}, async f=>{
 await openControls(f.page);
 await openSettings(f.page,'danmakuSettings');await f.page.keyboard.press('Enter');
 const text=mask==='failure'?'人物遮罩加载失败，已使用普通弹幕':'当前视频未提供人物遮罩';
 await f.page.getByRole('status').filter({hasText:text}).waitFor();
 assert.equal((f.calls.maskRanges||[]).length,mask==='failure'?1:0);
 if(mask==='failure')assert.equal(f.calls.maskRanges[0],'bytes=0-15');
 assert.equal((await state(f.page)).probe.loads,1);
 assert.ok(await f.page.evaluate(()=>[...document.querySelectorAll('.danmaku-container')].every(e=>e.style.maskImage==='none')));
 await f.page.keyboard.press('Escape');assert.equal((await state(f.page)).focused,'弹幕设置');
});

await run('in-playback danmaku settings preserve playback and restore remote focus', {}, async f => {
 const page=f.page;await openControls(page);
 await page.route('**/list.so?**',route=>route.fulfill({contentType:'text/xml',body:'<i><d p="120,1,28,16777215,0,0,hash,99">即时样式测试</d></i>'}));
 await openSettings(page,'danmaku');await page.keyboard.press('Enter');
 const actual=page.locator('.player-page-vod > .danmaku-container .danmaku-item');
 await actual.first().waitFor();assert.equal(await actual.first().evaluate(e=>e.style.fontSize),'28px');
 const before=await state(page);
 await openSettings(page,'danmakuSettings');
 await page.keyboard.press('Enter');
 await page.getByRole('dialog',{name:'弹幕设置'}).waitFor();
 await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('bili_settings')).danmakuScale),1.3);
 await shot(f,'in-playback-danmaku-settings');
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!document.querySelector('.dm-settings'));
 assert.equal((await state(page)).focused,'弹幕设置');
 await actual.first().waitFor();assert.equal(await actual.first().evaluate(e=>e.style.fontSize),'36px');
 const after=await state(page);assert.equal(after.probe.loads,before.probe.loads);assert.ok(after.media.time>=before.media.time,'playback continues');assert.deepEqual(after.probe.seeks,before.probe.seeks,'settings never seek');assert.equal(after.media.paused,before.media.paused);
 await shot(f,'in-playback-danmaku-applied');
 await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'弹幕设置'}).waitFor();
 assert.ok((await page.locator('.dm-setting-row').first().innerText()).includes('大'));
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 assert.equal((await state(page)).focused,'设置');
 await openSettings(page,'danmaku');assert.equal(await page.locator('.player-more-action.focused').getAttribute('data-control'),'danmaku');
});

for(const options of [{}, {width:1280,height:720,scale:1.4}, {auth:false,subtitles:false}, {language:'en',width:1280,height:720,scale:1.4,subtitleOff:true}]) await run('three primary groups and nested settings '+JSON.stringify(options), options, async f => {
 const page=f.page;await page.waitForTimeout(700);await openControls(page);
 const layout=await page.evaluate(()=>{
  const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,right:r.right,centerX:(r.x+r.right)/2,centerY:(r.y+r.bottom)/2}};
  return {row:rect(document.querySelector('.player-btns')),buttons:[...document.querySelectorAll('.player-control')].map(e=>({id:e.dataset.control,...rect(e)})),groups:[...document.querySelectorAll('.player-control-group')].map(e=>[...e.querySelectorAll('button')].map(b=>b.dataset.control))};
 });
 assert.deepEqual(layout.groups,[['like','coin','fav','later'],['prev','play','next'],['comments','settings']]);
 assert.ok(layout.buttons.every(b=>Math.abs(b.centerY-layout.buttons[0].centerY)<1&&b.x>=0&&b.right<=(options.width||1920)),'nine actions stay on one row');
 assert.ok(Math.abs(layout.buttons.find(b=>b.id==='play').centerX-layout.row.centerX)<1,'play is centered in the video control area');
 assert.ok(layout.buttons[3].right+8<layout.buttons[4].x&&layout.buttons[6].right+8<layout.buttons[7].x,'visible space separates the three groups');
 for(const id of ['like','coin','fav','later'])assert.equal(await page.locator(`[data-control="${id}"]`).isDisabled(),options.auth===false);
 assert.equal(await page.locator('.player-control.focused').getAttribute('data-control'),'play');
 assert.equal(await page.locator('.player-btns .player-time').count(),0);
 assert.equal(await page.locator('.player-timeline-meta .player-time').count(),1);
 await shot(f,'after-three-groups-'+(options.language||'zh')+'-'+(options.height||1080)+'-'+(options.auth===false?'guest':'account'));
 const before=await state(page);await openSettings(page);
 const rows=await page.locator('.player-more-action').evaluateAll(nodes=>nodes.map(e=>e.dataset.control));
 assert.deepEqual(rows.slice(0,5),['quality','speed',...(options.subtitles===false?[]:['subtitle']),'danmaku','danmakuSettings',...(options.subtitles===false?['follow']:[])]);
 for(const id of ['like','coin','fav','later'])assert.ok(!rows.includes(id),'engagement remains in the primary row');
 const off=options.language==='en'?'Off':'关';
 assert.equal(await page.locator('[data-control="danmaku"] .player-more-value').textContent(),off);
 if(options.subtitleOff)assert.equal(await page.locator('[data-control="subtitle"] .player-more-value').textContent(),off);
 for(let n=0;n<rows.length;n++){
  const box=await page.locator('.player-more-action.focused').boundingBox();
  assert.ok(box.y>=0&&box.y+box.height<=(options.height||1080),'settings actions are visible through remote navigation');
  await page.keyboard.press('ArrowDown');
 }
 await shot(f,'after-settings-'+(options.language||'zh')+'-'+(options.height||1080)+'-'+(options.auth===false?'guest':'account'));
 await page.waitForTimeout(5200);assert.equal((await state(page)).visibleControls,true,'settings prevent auto-hide');
 await page.keyboard.press('Escape');assert.equal(await page.locator('.player-more-panel').count(),0);
 assert.equal(await page.locator('.player-control.focused').getAttribute('data-control'),'settings');
 const after=await state(page);assert.equal(after.probe.loads,before.probe.loads);assert.deepEqual(after.probe.seeks,before.probe.seeks);assert.equal(after.media.paused,before.media.paused);
 assert.equal(f.calls.knownMockWrites.length,0,'navigating settings performs no account writes');
});
await run('primary like tap is single and leaving focus cancels an unfinished hold',{},async f=>{
 const page=f.page;await openControls(page);await focusPrimary(page,'like');
 await page.keyboard.press('Enter');await page.waitForTimeout(200);
 assert.equal(f.calls.knownMockWrites.filter(p=>p.endsWith('/archive/like')).length,1);
 await page.keyboard.down('Enter');await page.waitForTimeout(400);await page.keyboard.press('ArrowRight');await page.keyboard.up('Enter');
 assert.equal(f.calls.knownMockWrites.length,1,'moving focus cancels the held action');
 await focusPrimary(page,'like');await page.keyboard.down('Enter');await page.waitForTimeout(400);await page.keyboard.press('Escape');await page.keyboard.up('Enter');
 assert.equal(f.calls.knownMockWrites.length,1,'Back cancels the held action');
 assert.equal((await state(page)).visibleControls,false);
 await openControls(page);await page.getByRole('button',{name:'点赞',exact:true}).click();await page.waitForTimeout(200);
 assert.equal(f.calls.knownMockWrites.filter(p=>p.endsWith('/archive/like')).length,2,'pointer click likes once');
});

await run('primary row preserves separate coin favorite and watch later actions',{moreActions:true},async f=>{
 const page=f.page;await openControls(page);await focusPrimary(page,'coin');
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('[data-control="coin"] .player-control-value')?.textContent==='124');
 await focusPrimary(page,'fav');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('[data-control="fav"]')?.getAttribute('aria-pressed')==='true');
 assert.equal(await page.locator('[data-control="fav"] .player-control-value').textContent(),'891');
 await focusPrimary(page,'later');await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'已稍后再看',exact:true}).waitFor();
 await page.keyboard.press('Enter');await page.getByRole('button',{name:'稍后再看',exact:true}).waitFor();
 const writes=f.calls.mockWriteDetails.map(w=>({path:w.path,form:new URLSearchParams(w.body)}));
 assert.deepEqual(writes.map(w=>w.path),['/proxy/api.bilibili.com/x/web-interface/coin/add','/proxy/api.bilibili.com/x/v3/fav/resource/deal','/proxy/api.bilibili.com/x/v2/history/toview/add','/proxy/api.bilibili.com/x/v2/history/toview/del']);
 assert.equal(writes[0].form.get('aid'),'100');assert.equal(writes[0].form.get('multiply'),'1');
 assert.equal(writes[1].form.get('rid'),'100');assert.equal(writes[1].form.get('add_media_ids'),'456');
 for(const write of writes.slice(2))assert.equal(write.form.get('aid'),'100');
 assert.equal((await state(page)).probe.loads,1);
});

for(const id of ['like','fav']) await run('engagement feedback successful toggle and cancellation '+id,
 {interactions:{responses:{[id]:[{hold:true},{hold:true}]}}},async f=>{
 const page=f.page;await openControls(page);await focusPrimary(page,id);
 const before=await engagementState(page,id);
 await page.keyboard.press('Enter');const release=await f.takeInteraction(id);
 await engagementFeedback(page,id,'pending');
 if(id==='like')await shot(f,'after-engagement-like-pending');
 for(let i=0;i<3;i++)await page.keyboard.press('Enter');
 assert.equal(engagementWrites(f).length,1,'repeated OK while pending submits one write');
 assert.deepEqual(await engagementState(page,id),before,'pending is not a false success');
 release();await engagementFeedback(page,id,'success');
 assert.equal((await engagementState(page,id)).pressed,'true');
 assert.notEqual((await engagementState(page,id)).count,before.count);
 await activeEngagementAppearance(page,id);
 await shot(f,'after-engagement-'+id+'-success');
 await page.waitForFunction(id=>document.querySelector(`[data-control="${id}"]`)?.dataset.feedback!=='success',id);
 assert.equal((await engagementState(page,id)).pressed,'true','active state outlasts transient success feedback');
 await activeEngagementAppearance(page,id);
 await page.keyboard.press('Enter');const cancel=await f.takeInteraction(id);
 await engagementFeedback(page,id,'pending');cancel();await engagementFeedback(page,id,'success');
 assert.deepEqual(await engagementState(page,id),before,'successful cancellation restores count and inactive state');
 assert.match(await page.locator('.player-control-caption').textContent(),/取消/,'cancelling is explicitly acknowledged');
 await shot(f,'after-engagement-'+id+'-cancelled');
 assert.equal(engagementWrites(f).length,2);
 const form=new URLSearchParams(engagementWrites(f)[1].body);
 if(id==='like')assert.equal(form.get('like'),'2');
 else {assert.equal(form.get('del_media_ids'),'456');assert.equal(form.get('add_media_ids'),'');}
});

for(const id of ['like','coin','fav']) await run('engagement feedback rejection preserves state and retry works '+id,
 {interactions:{responses:{[id]:[{hold:true,code:-400,message:'合成接口拒绝'},{hold:true}]}}},async f=>{
 const page=f.page;await openControls(page);await focusPrimary(page,id);
 const before=await engagementState(page,id);
 await page.keyboard.press('Enter');const reject=await f.takeInteraction(id);
 await engagementFeedback(page,id,'pending');reject();await engagementFeedback(page,id,'error');
 assert.deepEqual(await engagementState(page,id),before,'rejected write cannot light the button or increment counts');
 assert.equal(await engagementButton(page,id).locator('.player-control-status').textContent(),'!','failure retains its explicit error marker');
 await shot(f,'after-engagement-'+id+'-error');
 await page.keyboard.press('Enter');const retry=await f.takeInteraction(id);
 await engagementFeedback(page,id,'pending');retry();await engagementFeedback(page,id,'success');
 assert.equal((await engagementState(page,id)).pressed,'true');
 assert.notEqual((await engagementState(page,id)).count,before.count);
 assert.equal(engagementWrites(f).length,2,'retry is one explicit new request');
});

await run('engagement feedback coin count reaches two without extra writes',
 {interactions:{responses:{coin:[{hold:true},{hold:true}]}}},async f=>{
 const page=f.page;await openControls(page);await focusPrimary(page,'coin');
 for(const count of [1,2]){
  await page.keyboard.press('Enter');const release=await f.takeInteraction('coin');
  await engagementFeedback(page,'coin','pending');await page.keyboard.press('Enter');
  assert.equal(f.calls.interactions.coin,count);
  release();await engagementFeedback(page,'coin','success');
  assert.equal((await engagementState(page,'coin')).pressed,'true');
  assert.equal((await engagementState(page,'coin')).count,String(123+count));
  assert.match(await engagementButton(page,'coin').locator('.player-control-status').textContent(),new RegExp(String(count)));
 }
 for(let i=0;i<3;i++)await page.keyboard.press('Enter');
 assert.equal(f.calls.interactions.coin,2,'two-coin limit blocks all additional writes');
 assert.match(await page.locator('.player-control-caption').textContent(),/两枚|已投满/);
 assert.equal(await page.locator('.player-control.focused').getAttribute('data-control'),'coin');
});

await run('engagement feedback coin server limit synchronizes status without claiming a new coin',
 {interactions:{responses:{coin:[{hold:true,code:34005,message:'两枚硬币已投满'}]}}},async f=>{
 const page=f.page;await openControls(page);await focusPrimary(page,'coin');
 const before=await engagementState(page,'coin');
 await page.keyboard.press('Enter');const release=await f.takeInteraction('coin');
 await engagementFeedback(page,'coin','pending');release();
 await page.waitForFunction(()=>document.querySelector('[data-control="coin"]')?.getAttribute('aria-pressed')==='true');
 assert.equal((await engagementState(page,'coin')).count,before.count,'34005 does not increment the public count');
 assert.match(await engagementButton(page,'coin').locator('.player-control-status').textContent(),/2/);
 assert.notEqual(await engagementButton(page,'coin').getAttribute('data-feedback'),'success');
 assert.match(await page.locator('.player-control-caption').textContent(),/两枚|已投满/);
 await page.keyboard.press('Enter');assert.equal(f.calls.interactions.coin,1);
});

await run('engagement feedback favorite folder rejection never submits a favorite write',
 {interactions:{responses:{folders:[{hold:true,code:-500,data:{},message:'合成读取失败'},{}],fav:[{hold:true}]}}},async f=>{
 const page=f.page;await openControls(page);await focusPrimary(page,'fav');
 const before=await engagementState(page,'fav');
 await page.keyboard.press('Enter');const reject=await f.takeInteraction('folders');
 await engagementFeedback(page,'fav','pending');await page.keyboard.press('Enter');
 assert.equal(f.calls.interactions.folders,1,'repeated OK cannot duplicate the prerequisite read');
 reject();await engagementFeedback(page,'fav','error');
 assert.deepEqual(await engagementState(page,'fav'),before);assert.equal(engagementWrites(f).length,0);
 await page.keyboard.press('Enter');const release=await f.takeInteraction('fav');
 await engagementFeedback(page,'fav','pending');release();await engagementFeedback(page,'fav','success');
 assert.equal(f.calls.interactions.folders,2);assert.equal(engagementWrites(f).length,1);
});

await run('engagement feedback single and triple share one pending gate',
 {interactions:{responses:{like:[{hold:true}],triple:[{hold:true}]}}},async f=>{
 const page=f.page;await openControls(page);await focusPrimary(page,'like');
 await page.keyboard.press('Enter');const single=await f.takeInteraction('like');
 await engagementFeedback(page,'like','pending');
 await page.keyboard.down('Enter');await page.waitForTimeout(2200);await page.keyboard.up('Enter');
 for(const id of ['coin','fav']){await focusPrimary(page,id);await page.keyboard.press('Enter');}
 assert.equal(engagementWrites(f).length,1,'pending single blocks triple and other engagement writes');
 await focusPrimary(page,'like');single();await engagementFeedback(page,'like','success');
 await page.keyboard.down('Enter');await page.waitForTimeout(2200);await page.keyboard.up('Enter');
 const triple=await f.takeInteraction('triple');await engagementFeedback(page,'like','pending');
 for(const id of ['coin','fav','like']){await focusPrimary(page,id);await page.keyboard.press('Enter');}
 assert.equal(engagementWrites(f).length,2,'pending triple blocks every separate engagement write');
 triple();await engagementFeedback(page,'like','success');
 for(const id of ['like','coin','fav']){
  assert.equal((await engagementState(page,id)).pressed,'true');
  await activeEngagementAppearance(page,id);
 }
 assert.match(await engagementButton(page,'coin').locator('.player-control-status').textContent(),/2/);
});

await run('engagement feedback active color and coin count remain clear with focused narrow large text',
 {width:1280,height:720,scale:1.4,commentCount:100,interactions:{initial:{like:true,coin:2,favorite:true}}},async f=>{
 const page=f.page;
 await page.waitForFunction(()=>['like','coin','fav'].every(id=>document.querySelector(`[data-control="${id}"]`)?.getAttribute('aria-pressed')==='true'));
 await openControls(page);await focusPrimary(page,'comments');await page.keyboard.press('Enter');
 await page.locator('.comment-rail-body').waitFor();await page.keyboard.press('ArrowLeft');
 for(const id of ['like','coin','fav']){
  await focusPrimary(page,id);
  await activeEngagementAppearance(page,id);
  if(id!=='coin'){await shot(f,'after-engagement-active-'+id+'-narrow-large');continue;}
  const marker=engagementButton(page,id).locator('.player-control-status');await marker.waitFor({state:'visible'});
  const geometry=await marker.evaluate(element=>{
   const box=element.getBoundingClientRect(),style=getComputedStyle(element),deck=element.closest('.player-controls').getBoundingClientRect();
   const clips=[];
   for(let parent=element.parentElement;parent;parent=parent.parentElement){
    const rect=parent.getBoundingClientRect(),css=getComputedStyle(parent);
    if(/hidden|clip|auto|scroll/.test(css.overflowX)&&(box.left<rect.left-1||box.right>rect.right+1))clips.push('x:'+parent.className);
    if(/hidden|clip|auto|scroll/.test(css.overflowY)&&(box.top<rect.top-1||box.bottom>rect.bottom+1))clips.push('y:'+parent.className);
   }
   const overlaps=[...document.querySelectorAll('.player-control-icon')].filter(icon=>{
    if(icon.contains(element))return false;
    const rect=icon.getBoundingClientRect();
    return box.left<rect.right&&box.right>rect.left&&box.top<rect.bottom&&box.bottom>rect.top;
   }).map(icon=>icon.closest('button').dataset.control);
   return {width:box.width,height:box.height,left:box.left,right:box.right,top:box.top,bottom:box.bottom,edge:Math.min(innerWidth,deck.right),screenBottom:innerHeight,opacity:style.opacity,clips,overlaps};
  });
  assert.ok(geometry.width>=10&&geometry.height>=10&&Number(geometry.opacity)>0,'active status has a visible footprint');
  assert.ok(geometry.left>=0&&geometry.right<=geometry.edge&&geometry.top>=0&&geometry.bottom<=geometry.screenBottom,'focused active status remains in the video viewport: '+JSON.stringify(geometry));
  assert.deepEqual(geometry.clips,[],'the corner status remains visible through every clipping ancestor');
  assert.deepEqual(geometry.overlaps,[],'the active status does not overlap adjacent control icons');
  assert.equal((await engagementState(page,id)).pressed,'true');
  if(id==='coin')assert.match(await marker.textContent(),/2/);
  await shot(f,'after-engagement-active-'+id+'-narrow-large');
 }
 assert.equal(engagementWrites(f).length,0,'rendering initial active state has no account writes');
});

await run('engagement feedback late initial relation does not undo a successful like',
 {interactions:{responses:{relation:[{hold:true}],like:[{hold:true}]}}},async f=>{
 const page=f.page;const oldRelation=await f.takeInteraction('relation');
 await openControls(page);await focusPrimary(page,'like');
 await page.keyboard.press('Enter');const release=await f.takeInteraction('like');
 release();await engagementFeedback(page,'like','success');
 const accepted=await engagementState(page,'like');assert.equal(accepted.pressed,'true');
 await settleRelation(f,oldRelation);
 assert.deepEqual(await engagementState(page,'like'),accepted,'stale initial inactive relation cannot overwrite the confirmed write');
 await activeEngagementAppearance(page,'like');
});

await run('engagement feedback unknown relation must resolve before an explicit write',
 {interactions:{responses:{relation:[{hold:true},{code:-500,data:null},{}],coin:[{hold:true}]}}},async f=>{
 const page=f.page;const oldRelation=await f.takeInteraction('relation');
 await openControls(page);await focusPrimary(page,'coin');
 const before=await engagementState(page,'coin');
 await page.keyboard.press('Enter');await engagementFeedback(page,'coin','error');
 assert.deepEqual(await engagementState(page,'coin'),before);
 assert.equal(engagementWrites(f).length,0,'a failed prerequisite relation read cannot submit a write');
 await settleRelation(f,oldRelation);
 await page.keyboard.press('Enter');const release=await f.takeInteraction('coin');
 await engagementFeedback(page,'coin','pending');
 assert.equal(f.calls.interactions.relation,3,'explicit retry fetches a valid relation instead of trusting the stale initial response');
 release();await engagementFeedback(page,'coin','success');
 assert.equal(engagementWrites(f).length,1);
 assert.equal((await engagementState(page,'coin')).pressed,'true');
});

await run('engagement feedback late triple reconciliation does not undo a later cancellation',
 {interactions:{responses:{relation:[{},{hold:true}],like:[{hold:true}]}}},async f=>{
 const page=f.page;await openControls(page);await focusPrimary(page,'like');
 await page.keyboard.down('Enter');await page.waitForTimeout(2200);await page.keyboard.up('Enter');
 await engagementFeedback(page,'like','success');const oldRelation=await f.takeInteraction('relation');
 await page.keyboard.press('Enter');const cancel=await f.takeInteraction('like');
 cancel();await engagementFeedback(page,'like','success');
 const cancelled=await engagementState(page,'like');assert.equal(cancelled.pressed,'false');
 await settleRelation(f,oldRelation);
 assert.deepEqual(await engagementState(page,'like'),cancelled,'stale active relation cannot relight a cancelled like');
});

await run('engagement feedback late response after exit adds no new UI',
 {interactions:{responses:{fav:[{hold:true}]}}},async f=>{
 const page=f.page;await openControls(page);await focusPrimary(page,'fav');
 await page.keyboard.press('Enter');const release=await f.takeInteraction('fav');
 await engagementFeedback(page,'fav','pending');
 for(let i=0;i<4&&await page.locator('.player-page').count();i++)await page.keyboard.press('Escape');
 await page.locator('.player-page').waitFor({state:'detached'});
 const response=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/fav/resource/deal'));
 release();await (await response).finished();await page.waitForTimeout(200);
 assert.equal(await page.locator('.player-page,.player-toast,.player-control-status').count(),0,'late completion cannot recreate player feedback after exit');
 assert.equal(engagementWrites(f).length,1);
});

await run('engagement feedback PGC with a valid episode aid still supports liking',
 {pgc:true,interactions:{responses:{like:[{hold:true}]}}},async f=>{
 const page=f.page;await openControls(page);await focusPrimary(page,'like');
 await page.keyboard.press('Enter');const release=await f.takeInteraction('like');
 await engagementFeedback(page,'like','pending');
 assert.equal(f.calls.pgcPlayurl,1,'PGC playback reached the real v2 envelope normalizer');
 assert.equal(new URLSearchParams(engagementWrites(f)[0].body).get('aid'),'700','interaction uses the valid episode aid, not an unrelated UGC fixture');
 release();await engagementFeedback(page,'like','success');
 assert.equal((await engagementState(page,'like')).pressed,'true');
 assert.equal(engagementWrites(f).length,1);
});

for(const terminal of ['ended','error']) await run('terminal transition cancels primary account hold when playback '+terminal,{},async f=>{
 const page=f.page;await openControls(page);await focusPrimary(page,'like');
 await page.keyboard.down('Enter');await page.waitForTimeout(400);
 await page.evaluate(terminal=>{
  if(terminal==='ended')document.querySelector('video').dispatchEvent(new Event('ended'));
  else window.__shakaPlayer.events.error({detail:{category:3,code:3016,severity:2}});
 },terminal);
 await page.waitForFunction(()=>!document.querySelector('.player-more-panel'));
 await page.keyboard.up('Enter');await page.waitForTimeout(1800);
 assert.equal(f.calls.knownMockWrites.filter(path=>!path.endsWith('/heartbeat')).length,0,'terminal transition cancels the pending account action; completion may report watch progress');
 if(terminal==='error')await page.locator('.player-error').waitFor();
 else assert.equal(await page.locator('.related-card.focused').count(),1);
});

for(const terminal of ['ended','error']) await run('terminal transition closes nested playback settings '+terminal,{},async f=>{
 const page=f.page;await openControls(page);await openSettings(page,'quality');await page.keyboard.press('Enter');
 await page.locator('.quality-popup').waitFor();
 await page.evaluate(terminal=>{
  if(terminal==='ended')document.querySelector('video').dispatchEvent(new Event('ended'));
  else window.__shakaPlayer.events.error({detail:{category:3,code:3016,severity:2}});
 },terminal);
 await page.waitForFunction(()=>!document.querySelector('.player-more-panel'));
 if(terminal==='error')await page.locator('.player-error').waitFor();
 else assert.equal(await page.locator('.related-card.focused').count(),1);
 assert.equal(f.calls.knownMockWrites.filter(path=>!path.endsWith('/heartbeat')).length,0);
});

for(const language of ['zh','en']) await run('comment count remains visible before opening and within narrow rail '+language,{language,width:1280,height:720,scale:1.4,commentCount:125678},async f=>{
 const page=f.page;await openControls(page);
 assert.ok((await page.locator('.player-control[data-control="comments"]').textContent()).includes(language==='zh'?'12.6万':'125.7K'),'existing comment total remains visible before opening');
 await focusPrimary(page,'comments');await page.keyboard.press('Enter');
 await page.locator('.comment-rail-body').waitFor();await page.waitForTimeout(350);
 const geometry=await page.evaluate(()=>{
  const rail=document.querySelector('.comment-rail-body').parentElement.getBoundingClientRect();
  return [...document.querySelectorAll('.player-control')].map(e=>{const b=e.getBoundingClientRect(),value=e.querySelector('.player-control-value');return{id:e.dataset.control,left:b.left,right:b.right,edge:rail.left,center:(b.y+b.bottom)/2,valueClipped:value&&value.scrollWidth>value.clientWidth+1};});
 });
 for(const [i,b] of geometry.entries()){
  assert.ok(b.right<=b.edge&&b.left>=0,'button stays inside video area: '+b.id);
  assert.ok(!b.valueClipped,'count remains readable: '+b.id);
  assert.ok(Math.abs(b.center-geometry[0].center)<1,'one row with consistent alignment');
  if(i)assert.ok(geometry[i-1].right<=b.left,'buttons do not overlap');
 }
 await page.keyboard.press('ArrowLeft');
 assert.equal(await page.locator('.player-control.focused').getAttribute('data-control'),'comments');
 for(let i=0;i<9;i++){
  const caption=await page.evaluate(()=>{
   const button=document.querySelector('.player-control.focused'),label=button.querySelector('.player-control-label').textContent,value=button.querySelector('.player-control-value')?.textContent||'',caption=document.querySelector('.player-control-caption'),box=caption.getBoundingClientRect();
   return{expected:`${label} ${value}`.trim(),text:caption.textContent.trim(),clipped:caption.scrollWidth>caption.clientWidth+1,visible:box.height>0&&box.top>=0&&box.bottom<=innerHeight};
  });
  assert.equal(caption.text,caption.expected,'narrow view names the focused action and its complete count');
  assert.ok(caption.visible&&!caption.clipped,'focused caption fits the viewport');
  await page.keyboard.press('ArrowRight');
 }
 await focusPrimary(page,'comments');
 await shot(f,'after-comments-count-'+language+'-720-large');
 await page.keyboard.press('Escape');assert.equal(await page.locator('.player-control.focused').getAttribute('data-control'),'comments');
});

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
  await run('recommendation covers show a fallback for failed or absent sources and load cover aliases', { relatedCovers: true }, async f => {
    await openControls(f.page); await f.page.keyboard.press('ArrowDown');
    await f.page.waitForFunction(() => document.querySelector('.player-controls-vod')?.classList.contains('recommendations-open'));
    await f.page.waitForFunction(() => {
      const cards = document.querySelectorAll('.related-card');
      const failed = cards[0]?.querySelector('img'), normal = cards[3]?.querySelector('img');
      return failed?.complete && failed.naturalWidth === 0 && normal?.complete && normal.naturalWidth > 0;
    });
    await f.page.waitForTimeout(450);
    const covers = await f.page.locator('.related-card').evaluateAll(cards => cards.slice(0, 4).map(card => {
      const holder = card.querySelector('.video-card-thumb'), image = holder.querySelector('img');
      const placeholder = holder.querySelector('.video-card-placeholder'), missing = holder.querySelector('.video-card-missing');
      const rect = holder.getBoundingClientRect();
      return { width: rect.width, height: rect.height, image: image ? { loaded: image.complete && image.naturalWidth > 0, visibility: getComputedStyle(image).visibility, opacity: Number(getComputedStyle(image).opacity) } : null,
        placeholderVisible: !!placeholder && getComputedStyle(placeholder).visibility === 'visible',
        missingVisible: !!missing && getComputedStyle(missing).visibility === 'visible' };
    }));
    await shot(f, 'recommendation-cover-fallback');
    f.checkpoints.coverStates = covers;
    assert.equal(covers[0].image?.visibility, 'hidden', 'broken image is hidden instead of showing the browser broken-image icon');
    assert.equal(covers[0].placeholderVisible, true, 'failed request displays the shared unavailable-cover placeholder');
    assert.equal(covers[1].image, null, 'absent URL does not create a failing request');
    assert.equal(covers[1].missingVisible, true, 'absent URL has an explicit fallback');
    for (const index of [2, 3]) {
      assert.ok(covers[index].image?.loaded && covers[index].image.opacity === 1, 'cover alias and normal pic load and become visible');
      assert.equal(covers[index].placeholderVisible, false, 'successful cover does not expose the failure label');
    }
    assert.ok(covers.every(cover => Math.abs(cover.width / cover.height - 16 / 9) < .01), 'failed and successful cards retain the same 16:9 cover geometry');
    // Keep the same DOM node to exercise recovery after a failed source.
    await f.page.locator('.related-card img').first().evaluate(image => { image.src = image.src.replace('controls-cover-0', 'controls-cover-3'); });
    await f.page.waitForFunction(() => {
      const holder = document.querySelector('.related-card .video-card-thumb'), image = holder.querySelector('img');
      return image.complete && image.naturalWidth > 0 && getComputedStyle(image).visibility === 'visible' && getComputedStyle(image).opacity === '1' && !holder.classList.contains('image-failed');
    });
    assert.equal(await f.page.locator('.related-card .video-card-placeholder').first().evaluate(element => getComputedStyle(element).visibility), 'hidden', 'recovered cover hides the old failure placeholder');
  });

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
    await openSettings(f.page,'subtitle');
    assert.match((await state(f.page)).focused, /字幕/);
    await f.page.keyboard.press('Enter'); await f.page.locator('.ctrl-popup').waitFor();
    await f.page.waitForTimeout(5350);
    assert.equal((await state(f.page)).visibleControls, true, 'subtitle choice suspends auto-hide');
    await f.page.keyboard.press('Escape');
    assert.match((await state(f.page)).focused, /字幕/);
    await f.page.keyboard.press('Escape');
    await focusPrimary(f.page,'like');
    assert.equal(await f.page.locator('.player-btn.focused').getAttribute('aria-label'),'点赞');
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
    await openSettings(f.page,'quality');
    assert.equal(await f.page.locator('.player-more-action.focused').getAttribute('data-control'),'quality');
    await f.page.keyboard.press('Enter'); await f.page.locator('.quality-popup').waitFor();
    await shot(f, 'after-quality-popup');
    await f.page.keyboard.press('Escape');
    assert.equal(await f.page.locator('.player-more-action.focused').getAttribute('data-control'),'quality');
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
    await openControls(f.page); await focusPrimary(f.page,'comments');
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
    assert.equal((await state(f.page)).focused, '设置');
    await focusPrimary(f.page,'play');
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
