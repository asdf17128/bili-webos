// Real React playback entry points with a controlled decoder/media clock.
// Every external HTTP request/WebSocket is intercepted; all accounts are synthetic.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseURL = process.env.RESUME_URL || 'http://127.0.0.1:5173';
assert.equal(new URL(baseURL).hostname, '127.0.0.1');
const output = process.env.RESUME_OUTPUT || '/tmp/bili-player-resume';
await mkdir(output, { recursive: true });
const sourcePaths = ['app/src/player/PlayerPage.jsx', 'app/src/player/playIntent.js', 'app/src/utils/storage.js'];
const hashSources = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
  [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const sources = await hashSources();
const browser = await chromium.launch({ headless: true });
const results = [];
const bvid = 'BVResumeSynthetic';
const stub = `class Player {
 static isBrowserSupported(){return true}
 async attach(v){this.video=v;void v.currentTime}
 configure(){} addEventListener(name,fn){(this.events||(this.events={}))[name]=fn}
 getNetworkingEngine(){return this.net||(this.net={registerRequestFilter(){},registerResponseFilter(){},addEventListener(){}})}
 getVariantTracks(){return []} getStats(){return {}} retryStreaming(){return true}
 async load(url,position,mime){
   const mpd=await(await fetch(url)).text();
   const seconds=Number(mpd.match(/mediaPresentationDuration="PT([0-9.]+)S"/)?.[1]);
   const cid=Number(mpd.match(/video-([0-9]+)/)?.[1]);
   if(!(seconds>0)||!cid)throw new Error('Invalid synthetic MPD');
   const state=this.video.__resumeFixture;
   state.time=position||0;state.duration=seconds;state.ready=4;state.finished=false;
   state.load=window.__resumeProbe.loads.length;
   window.__resumeProbe.loads.push({position:position??null,duration:seconds,cid,mime,readyAt:Date.now()});
   for(const event of ['loadedmetadata','loadeddata','canplay'])this.video.dispatchEvent(new Event(event));
 }
 async unload(){this.video.__resumeFixture.ready=0}
 async destroy(){window.__resumeProbe.destroyed++}
}
export default {Player,polyfill:{installAll(){}}};`;

async function fixture(config) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
  const calls = { meta: [], streams: [], heartbeats: [], unexpectedWrites: [], intercepted: 0 };
  const errors = [];
  await context.addInitScript(() => {
    delete window.webOS; delete window.PalmServiceBridge; localStorage.clear();
    localStorage.setItem('bili_auth', JSON.stringify({ SESSDATA: 'synthetic-resume-account', DedeUserID: '7', bili_jct: 'synthetic-resume-csrf' }));
    localStorage.setItem('bili_proxyUrl', JSON.stringify('http://127.0.0.1:9527'));
    localStorage.setItem('bili_perfopt', JSON.stringify({ prefetchPage: false, warmPlayer: false }));
    localStorage.setItem('bili_settings', JSON.stringify({ language: 'zh', quality: 80, qualityMode: 'manual', subtitle: false, danmaku: false, playbackMode: 'stop' }));
    window.__resumeProbe = { loads: [], seeks: [], destroyed: 0, plays: 0, pauses: 0 };
    const media = el => el.__resumeFixture || (el.__resumeFixture = { time: 0, duration: NaN, paused: true, ready: 0, finished: false, load: -1 });
    Object.defineProperties(HTMLMediaElement.prototype, {
      currentTime: { configurable: true, get() { return media(this).time; }, set(value) {
        const state = media(this); state.time = Number(value); state.finished = false;
        window.__resumeProbe.seeks.push({ load: state.load, target: Number(value) });
        this.dispatchEvent(new Event('timeupdate'));
      } },
      duration: { configurable: true, get() { return media(this).duration; } },
      paused: { configurable: true, get() { return media(this).paused; } },
      ended: { configurable: true, get() { return media(this).finished; } },
      readyState: { configurable: true, get() { return media(this).ready; } },
      buffered: { configurable: true, get() { const state = media(this); return { length: state.ready ? 1 : 0, start() { return 0; }, end() { return state.duration; } }; } },
      videoWidth: { configurable: true, get() { return 1920; } },
      videoHeight: { configurable: true, get() { return 1080; } },
    });
    HTMLMediaElement.prototype.play = function () {
      media(this).paused = false; window.__resumeProbe.plays++;
      this.dispatchEvent(new Event('play')); if (media(this).ready) this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () { media(this).paused = true; window.__resumeProbe.pauses++; this.dispatchEvent(new Event('pause')); };
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === new URL(baseURL).origin) {
      if (url.pathname.includes('shaka-player')) return route.fulfill({ contentType: 'application/javascript', body: stub });
      return route.continue();
    }
    calls.intercepted++;
    if (url.port === '9528') return route.abort();
    const fulfill = data => route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (request.method() === 'OPTIONS') return fulfill({});
    if (request.method() !== 'GET') {
      if (url.pathname.endsWith('/heartbeat')) calls.heartbeats.push(Object.fromEntries(new URLSearchParams(request.postData() || '')));
      else calls.unexpectedWrites.push(url.pathname);
      return fulfill({ code: 0, data: {} });
    }
    let data = {};
    const pages = config.pages || [{ cid: 2, duration: config.duration || 100 }];
    if (url.pathname.endsWith('/nav')) data = { isLogin: true, mid: 7, uname: 'Synthetic resume account', wbi_img: { img_url: 'https://fixture.invalid/abcdefghijklmnopqrstuvwxyz123456.png', sub_url: 'https://fixture.invalid/abcdefghijklmnopqrstuvwxyz123456.png' } };
    if (url.pathname.endsWith('/history/cursor')) data = { list: [] };
    if (url.pathname.includes('/top/feed/rcmd')) data = { item: [] };
    if (url.pathname.endsWith('/view')) data = { aid: 1, bvid, cid: pages[0].cid, pages, duration: pages.reduce((sum, page) => sum + page.duration, 0), title: 'Synthetic resume test', owner: { mid: 10, name: 'Synthetic UP' }, stat: {} };
    if (url.pathname.endsWith('/v2')) {
      calls.meta.push({ cid: Number(url.searchParams.get('cid')), at: Date.now() });
      data = { last_play_cid: config.serverCid || pages[0].cid, last_play_time: (config.serverProgress ?? 85) * 1000, subtitle: { subtitles: [] } };
    }
    if (url.pathname.endsWith('/playurl')) {
      const cid = Number(url.searchParams.get('cid')), part = pages.find(page => page.cid === cid);
      assert.ok(part, 'stream requests must use a real synthetic part');
      calls.streams.push(cid);
      data = { quality: 80, accept_quality: [80], dash: { duration: part.duration, video: [{ id: 80, bandwidth: 1000, baseUrl: `https://media.fixture.invalid/video-${cid}`, codecs: 'avc1.640028', width: 1920, height: 1080, frameRate: '30', SegmentBase: { Initialization: '0-51', indexRange: '52-70' } }], audio: [] } };
      if (url.pathname.includes('/pgc/')) return fulfill({ code: 0, result: { video_info: data } });
    }
    if (url.pathname.endsWith('/season')) return fulfill({ code: 0, result: { season_id: 1, episodes: [{ id: 22, cid: 2, title: '1' }] } });
    if (url.pathname.endsWith('/archive/related')) data = [];
    if (url.pathname.endsWith('/list.so')) return route.fulfill({ contentType: 'text/xml', body: '<i/>' });
    if (url.pathname.endsWith('/relation/stat')) data = { follower: 10 };
    if (url.pathname.endsWith('/x/relation')) data = { attribute: 0 };
    return fulfill({ code: 0, data });
  });
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL); await page.waitForFunction(() => !!window.__openVideo);
  const open = async item => {
    const count = await page.evaluate(() => window.__resumeProbe.loads.length);
    await page.evaluate(item => window.__openVideo(item), { bvid, ...(item || {}) });
    await page.waitForFunction(count => window.__resumeProbe.loads.length === count + 1 && !document.querySelector('.player-page .loading') && !document.querySelector('video').paused, count);
    // Catch post-load and metadata-triggered seeks, not only Shaka's argument.
    await page.waitForTimeout(120);
    return count;
  };
  const close = async () => {
    for (let n = 0; n < 4 && await page.locator('.player-page').count(); n++) await page.keyboard.press('Escape');
    await page.locator('.player-page').waitFor({ state: 'detached' });
  };
  return { context, page, calls, errors, open, close };
}

async function assertPosition(f, load, position, cid = 2) {
  const snapshot = await f.page.evaluate(() => ({ ...window.__resumeProbe, currentTime: document.querySelector('video')?.currentTime }));
  const loaded = snapshot.loads[load];
  assert.equal(loaded.position ?? 0, position, 'decoder receives the normalized start');
  assert.equal(loaded.cid, cid, 'start belongs to the selected part');
  assert.equal(snapshot.currentTime, position, 'final media position keeps the normalized start');
  assert.ok(snapshot.seeks.filter(seek => seek.load === load).every(seek => seek.target === position), 'no later seek reapplies stale/unfiltered progress: ' + JSON.stringify(snapshot.seeks));
}

async function seedProgress(page, { progress = 100, duration = 100, cid = 2, kind = 'recent' } = {}) {
  await page.evaluate(async ({ bvid, progress, duration, cid, kind }) => {
    const { storage } = await import('/src/utils/storage.js');
    if (kind === 'legacy') {
      storage.set('progress', { [bvid]: [progress, duration, Date.now()] }); storage._progressCache = null; return;
    }
    const auth = storage.getAuth(), now = Date.now;
    if (kind === 'other-account') storage.set('auth', { ...auth, DedeUserID: '8', SESSDATA: 'synthetic-other-account' });
    if (kind === 'expired') Date.now = () => now() - 130000;
    try { storage.setProgress(bvid, progress, duration, cid); }
    finally { Date.now = now; storage.set('auth', auth); }
  }, { bvid, progress, duration, cid, kind });
}

async function run(name, config, fn) {
  if (process.env.RESUME_FILTER && !new RegExp(process.env.RESUME_FILTER).test(name)) return;
  let f;
  try {
    f = await fixture(config); await fn(f);
    assert.deepEqual(f.errors, [], 'no uncaught browser errors');
    assert.deepEqual(f.calls.unexpectedWrites, [], 'only synthetic playback heartbeats may be sent');
    results.push({ name, pass: true, probe: await f.page.evaluate(() => window.__resumeProbe), calls: f.calls });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, pass: false, error: error.message, probe: f ? await f.page.evaluate(() => window.__resumeProbe).catch(() => null) : null, calls: f?.calls });
    console.log('FAIL', name, error.message.split('\n')[0]);
    if (f) await f.page.screenshot({ path: `${output}/failure-${results.length}.png` });
  } finally { if (f) await f.context.close(); }
}

await run('completed history sentinel keeps its part and starts at zero', { pages: [{ cid: 2, duration: 100 }, { cid: 3, duration: 40 }], serverCid: 2, serverProgress: 85 }, async f => {
  await assertPosition(f, await f.open({ cid: 3, progress: -1, duration: 40 }), 0, 3);
  const readyAt = await f.page.evaluate(() => window.__resumeProbe.loads[0].readyAt);
  assert.ok(f.calls.meta.every(call => call.cid === 3 && call.at >= readyAt), 'metadata may load subtitles after media readiness, but cannot select a saved part/offset');
});
for (const saved of [100, 130]) await run('server completed auto position ' + saved, { serverProgress: saved }, async f => {
  await assertPosition(f, await f.open(), 0);
});
await run('unfinished final five seconds still resume', { serverProgress: 95 }, async f => {
  await assertPosition(f, await f.open(), 95);
});
await run('eight-second short video resumes at two seconds', { duration: 8, serverProgress: 2 }, async f => {
  await assertPosition(f, await f.open(), 2);
});
await run('unfinished explicit history position remains exact', {}, async f => {
  await assertPosition(f, await f.open({ cid: 2, progress: 42, duration: 100 }), 42);
});
await run('completed explicit history position restarts', {}, async f => {
  await assertPosition(f, await f.open({ cid: 2, progress: 100, duration: 100 }), 0);
});
await run('completed PGC episode starts at zero', {}, async f => {
  await assertPosition(f, await f.open({ isBangumi: true, epid: 22, cid: 2, progress: 100, duration: 100, resumeMode: 'at' }), 0);
});
for (const completed of [true, false]) await run('multi-part uses final part duration ' + (completed ? 'completed' : 'unfinished'), {
  pages: [{ cid: 2, duration: completed ? 1000 : 8 }, { cid: 3, duration: 40 }], serverCid: 3, serverProgress: completed ? 40 : 20,
}, async f => {
  await assertPosition(f, await f.open(), completed ? 0 : 20, 3);
  assert.ok(f.calls.streams.includes(3));
});
await run('fresh local completed part overrides lagging server', { pages: [{ cid: 2, duration: 100 }, { cid: 3, duration: 40 }], serverCid: 2, serverProgress: 85 }, async f => {
  await seedProgress(f.page, { cid: 3, progress: 40, duration: 40 });
  await assertPosition(f, await f.open(), 0, 3);
});
await run('fresh local unfinished position overrides lagging server', { serverProgress: 85 }, async f => {
  await seedProgress(f.page, { progress: 37 });
  await assertPosition(f, await f.open(), 37);
});
for (const kind of ['legacy', 'expired', 'other-account']) await run(kind + ' local completion cannot override server', { serverProgress: 85 }, async f => {
  await seedProgress(f.page, { kind });
  await assertPosition(f, await f.open(), 85);
});
await run('unknown local part cannot override a valid server part', { serverProgress: 85 }, async f => {
  await seedProgress(f.page, { cid: 999 });
  await assertPosition(f, await f.open(), 85);
});
await run('another part completion cannot override explicit history selection', { pages: [{ cid: 2, duration: 100 }, { cid: 3, duration: 40 }] }, async f => {
  await seedProgress(f.page, { cid: 3, progress: 40, duration: 40 });
  await assertPosition(f, await f.open({ cid: 2, progress: 30, duration: 100, resumeMode: 'at' }), 30, 2);
});
await run('explicit part selection ignores another part progress', { pages: [{ cid: 2, duration: 100 }, { cid: 3, duration: 40 }] }, async f => {
  await seedProgress(f.page, { cid: 3, progress: 20, duration: 40 });
  await assertPosition(f, await f.open({ cid: 2, progress: 0, resumeMode: 'none' }), 0, 2);
});
await run('ended then immediate reopen starts zero and later watching resumes normally', { serverProgress: 85 }, async f => {
  await assertPosition(f, await f.open(), 85);
  await f.page.evaluate(() => {
    const video = document.querySelector('video');
    video.__resumeFixture.time = 100; video.__resumeFixture.finished = true; video.__resumeFixture.paused = true;
    video.dispatchEvent(new Event('pause')); video.dispatchEvent(new Event('ended'));
  });
  await f.page.waitForFunction(async bvid => (await import('/src/utils/storage.js')).storage.getRecentProgress(bvid)?.progress === 100, bvid);
  const completed = await f.page.evaluate(async bvid => (await import('/src/utils/storage.js')).storage.getRecentProgress(bvid), bvid);
  assert.equal(completed.cid, 2); assert.equal(completed.duration, 100);
  assert.ok(f.calls.heartbeats.some(call => Number(call.played_time) >= 99), 'completion heartbeat is emitted immediately');
  await f.close(); await assertPosition(f, await f.open(), 0);
  // Advance the synthetic media clock without issuing a seek command: this is
  // new watching after the replay, and must replace the old completed record.
  await f.page.evaluate(() => { const video = document.querySelector('video'); video.__resumeFixture.time = 37; video.dispatchEvent(new Event('timeupdate')); });
  await f.close(); await assertPosition(f, await f.open(), 37);
});

await browser.close();
const sourcesEnd = await hashSources();
const sourcesStable = JSON.stringify(sources) === JSON.stringify(sourcesEnd);
await writeFile(`${output}/results.json`, JSON.stringify({ boundary: 'Real React entry points with controlled Shaka/media state. Synthetic accounts and intercepted external HTTP/WebSocket. No television, real account or media decoding.', sources, sourcesEnd, sourcesStable, results }, null, 2));
console.log(`${results.filter(result => result.pass).length}/${results.length} passed; ${output}/results.json`);
if (!sourcesStable) console.log('INVALIDATED: production sources changed during this run');
process.exitCode = results.some(result => !result.pass) || !sourcesStable ? 1 : 0;
