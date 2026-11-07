// Continuous playback regression for the async PNG preparation bottleneck.
// Synthetic frames all have distinct geometry; their central person hole and
// background ROIs remain stable, so screenshots detect both mask disappearance
// and an entirely hidden overlay. Optional public .webmask data stays local.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

const base = process.env.MASK_BASE || 'http://127.0.0.1:5173';
const out = process.env.MASK_CONTINUITY_OUTPUT || '/tmp/bili-mask-continuity';
const realFile = process.env.MASK_CONTINUITY_REAL_FILE;
const seconds = Number(process.env.MASK_CONTINUITY_SECONDS || 8);
const start = Number(process.env.MASK_CONTINUITY_START || 1);
assert.ok(seconds >= 2 && seconds <= 30 && start >= 0 && Number.isFinite(start));
mkdirSync(out, { recursive: true });

function syntheticMask() {
  const count = Math.max(400, Math.ceil((start + seconds + 2) * 25));
  const frames = Array.from({ length: count }, (_, i) => {
    const cx = 160 + Math.sin(i * .071) * 14;
    const x = delta => (cx + delta).toFixed(4);
    const top = (20 + Math.sin(i * .037) * 2).toFixed(4);
    // The hole follows a moving head, shoulders, torso and legs. Changing the
    // geometry itself defeats URI/decode caches without inert random strings.
    const path = `M0 0H320V180H0Z M${x(0)} ${top} C${x(-14)} ${top} ${x(-16)} 38 ${x(-8)} 44 L${x(-25)} 50 Q${x(-34)} 56 ${x(-40)} 88 L${x(-30)} 92 L${x(-23)} 70 L${x(-22)} 128 L${x(-27)} 174 L${x(-9)} 174 L${x(0)} 137 L${x(9)} 174 L${x(27)} 174 L${x(22)} 128 L${x(23)} 70 L${x(30)} 92 L${x(40)} 88 Q${x(34)} 56 ${x(25)} 50 L${x(8)} 44 C${x(16)} 38 ${x(14)} ${top} ${x(0)} ${top}Z`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><path fill="black" fill-rule="evenodd" d="${path}"/></svg>`;
    return { time: i * 40, uri: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') };
  });
  const segments = [];
  for (let i = 0; i < frames.length; i += 200) {
    const items = frames.slice(i, i + 200);
    const data = gzipSync(Buffer.concat(items.map(frame => {
      const bytes = Buffer.from(frame.uri), header = Buffer.alloc(12);
      header.writeUInt32BE(bytes.length); header.writeBigUInt64BE(BigInt(frame.time), 4);
      return Buffer.concat([header, bytes]);
    })));
    segments.push({ time: items[0].time, data });
  }
  const index = Buffer.alloc(16 + segments.length * 16);
  index.write('MASK'); index.writeUInt32BE(1, 4); index.writeUInt32BE(segments.length, 12);
  let offset = index.length;
  segments.forEach((segment, i) => {
    index.writeBigUInt64BE(BigInt(segment.time), 16 + i * 16);
    index.writeBigUInt64BE(BigInt(offset), 24 + i * 16); offset += segment.data.length;
  });
  return Buffer.concat([index, ...segments.map(segment => segment.data)]);
}

const fixture = realFile ? readFileSync(realFile) : syntheticMask();
// Record how much genuinely different source data the playback window covers.
const fixtureFrames = [];
const segmentCount = fixture.readUInt32BE(12);
assert.ok(segmentCount > 0 && segmentCount <= 2048);
for (let n = 0; n < segmentCount; n++) {
  const time = Number(fixture.readBigUInt64BE(16 + n * 16));
  const nextTime = n + 1 < segmentCount ? Number(fixture.readBigUInt64BE(32 + n * 16)) : Infinity;
  if (time > (start + seconds + .2) * 1000 || nextTime < start * 1000) continue;
  const a = Number(fixture.readBigUInt64BE(24 + n * 16));
  const b = n + 1 < segmentCount ? Number(fixture.readBigUInt64BE(40 + n * 16)) : fixture.length;
  const data = gunzipSync(fixture.subarray(a, b));
  for (let offset = 0; offset < data.length;) {
    const size = data.readUInt32BE(offset), at = Number(data.readBigUInt64BE(offset + 4)); offset += 12;
    const uri = data.toString('utf8', offset, offset + size).replace(/\s/g, ''); offset += size;
    if (at >= start * 1000 && at <= (start + seconds + .2) * 1000) fixtureFrames.push({ at, uri });
  }
}
const uniqueFrames = new Set(fixtureFrames.map(frame => frame.uri)).size;
assert.ok(uniqueFrames >= Math.min(200, Math.floor(seconds * (realFile ? 12 : 25))), 'Fixture must exercise many different masks');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**/*', socket => socket.close());
// Delay only PNG Image.decode(), not module functions or the synchronous SVG
// path. A renderer that no longer prepares bitmaps should do zero delayed work.
await page.addInitScript(() => {
  const decode = HTMLImageElement.prototype.decode;
  if (typeof decode !== 'function') throw Error('The regression harness needs Image.decode');
  HTMLImageElement.prototype.decode = function (...args) {
    const stats = window.__continuityDecodeStats;
    const png = this.src.startsWith('data:image/png');
    const delay = png ? Number(window.__maskDecodeDelay || 0) : 0;
    if (stats) { stats.calls++; if (png) stats.pngCalls++; if (delay) stats.delayedCalls++; }
    return Promise.resolve(decode.apply(this, args)).then(value => delay
      ? new Promise(resolve => setTimeout(() => resolve(value), delay)) : value);
  };
});
await page.route('**/*', async route => {
  const u = new URL(route.request().url());
  // Desktop rawFetch prefixes the remote host with /proxy/<host>; intercept
  // both that transport and a direct fixture request before reaching Vite.
  if (u.pathname.endsWith('/cmaskboss/continuity.webmask')) {
    const range = route.request().headers().range;
    assert.match(range, /^bytes=\d+-\d+$/);
    const [a, b] = range.slice(6).split('-').map(Number);
    return route.fulfill({ status: 206, body: fixture.subarray(a, b + 1), contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
  }
  if (u.origin === new URL(base).origin) return route.continue();
  return route.abort();
});

try {
  await page.goto(base); await page.waitForFunction(() => !!window.__openVideo);
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { default: Layer } = await import('/src/player/DanmakuLayer.jsx');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:1920px;height:1080px;background:blue;z-index:99999'; document.body.append(host);
    const video = document.createElement('video'); video.style.cssText = 'position:absolute;inset:0;width:1920px;height:1080px'; host.append(video);
    window.__continuityVideo = video;
    Object.defineProperties(video, {
      currentTime: { get: () => window.__continuityPlaying ? window.__continuityStart + Math.floor((performance.now() - window.__continuityStarted) / 40) * .04 : window.__continuityTime },
      videoWidth: { get: () => 320 }, videoHeight: { get: () => 180 },
      seeking: { get: () => false }, paused: { get: () => false },
    });
    // Exercise the webOS rAF fallback continuously, without slow host polling.
    video.requestVideoFrameCallback = undefined; video.cancelVideoFrameCallback = undefined;
    const mount = document.createElement('div'); host.append(mount); const root = createRoot(mount);
    const props = { danmakus: [], currentTime: 0, enabled: true, videoRef: { current: video }, onMaskStatus: value => { window.__continuityStatus = value; } };
    window.__continuityDraw = enabled => root.render(React.createElement(Layer, { ...props, maskSource: { fps: 25, mask_url: 'https://a.bilivideo.com/cmaskboss/continuity.webmask' }, settings: { danmakuMask: enabled } }));
  });
  for (const decodeDelayMs of [0, 100]) {
    await page.evaluate(() => window.__continuityDraw(false)); await page.waitForFunction(() => !window.__danmakuMaskStats); await page.waitForTimeout(150);
    await page.evaluate(({ start, decodeDelayMs }) => {
      window.__continuityPlaying = false; window.__continuityTime = start; window.__continuityStart = start;
      window.__maskDecodeDelay = decodeDelayMs; window.__continuityDecodeStats = { calls: 0, pngCalls: 0, delayedCalls: 0 };
      window.__continuityDraw(true);
    }, { start, decodeDelayMs });
    await page.waitForFunction(() => ['active', 'unprotected'].includes(window.__danmakuMaskStats?.().state), null, { timeout: 10000 }).catch(async error => {
      const state = await page.evaluate(() => ({ status: window.__continuityStatus, mask: window.__danmakuMaskStats?.(), time: window.__continuityVideo.currentTime }));
      throw Error('Continuity fixture did not become active: ' + JSON.stringify({ ...state, errors }) + '\n' + error.message);
    });
    await page.waitForTimeout(400);
    const continuous = page.evaluate(async seconds => {
      const layer = [...document.querySelectorAll('.danmaku-container')].at(-1);
      const fill = document.createElement('div'); fill.style.cssText = 'position:absolute;inset:0;background:red'; layer.append(fill);
      window.__continuityStarted = performance.now(); window.__continuityPlaying = true;
      const samples = [];
      await new Promise(resolve => {
        const capture = () => {
          const at = performance.now() - window.__continuityStarted, stats = window.__danmakuMaskStats?.();
          const mask = layer.style.maskImage || layer.style.webkitMaskImage;
          samples.push({ at, time: window.__continuityVideo.currentTime, maskPresent: !!mask && mask !== 'none', ...stats });
          if (at < seconds * 1000) requestAnimationFrame(capture); else resolve();
        }; requestAnimationFrame(capture);
      });
      window.__continuityTime = window.__continuityVideo.currentTime; window.__continuityPlaying = false;
      return { samples, decoding: window.__continuityDecodeStats };
    }, seconds);
    const screenshots = [];
    for (let n = 1; n <= 4; n++) {
      await page.waitForTimeout(seconds * 1000 / 5);
      const name = `delay-${decodeDelayMs}-${n}.png`, png = PNG.sync.read(await page.screenshot({ path: out + '/' + name }));
      const color = (x, y) => Array.from(png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3));
      const center = color(960, 540), left = color(300, 540), right = color(1700, 540);
      screenshots.push({ name, center, left, right, pass: realFile ? null : center.join() === '0,0,255' && left.join() === '255,0,0' && right.join() === '255,0,0' });
    }
    const { samples, decoding } = await continuous;
    const present = samples.filter(s => s.maskPresent);
    const missing = samples.filter(s => !s.maskPresent);
    const transitions = samples.slice(1).filter((s, i) => s.maskPresent !== samples[i].maskPresent).length;
    const stale = present.filter(s => !Number.isFinite(s.frameTime) || s.time * 1000 - s.frameTime > 80 + .01);
    const appliedAdvance = samples.at(-1).applied - samples[0].applied;
    const maxTimelineLagMs = present.length ? Math.max(...present.map(s => s.time * 1000 - s.timelineTime)) : null;
    const checks = {
      continuousMask: missing.length === 0 && transitions === 0,
      noStaleSilhouette: stale.length === 0,
      changingSilhouette: appliedAdvance >= Math.floor(Math.min(seconds * 25, uniqueFrames) * .75),
      centralHoleAndBackground: screenshots.every(s => s.pass !== false),
      boundedCache: samples.every(s => s.cached <= 2 && (s.prepared === undefined || s.prepared <= 8)),
      noFailures: samples.every(s => s.failures === 0),
    };
    const summary = { decodeDelayMs, samples: samples.length, missing: missing.length, missingRatio: missing.length / samples.length, transitions, stale: stale.length, appliedAdvance, maxTimelineLagMs, decoding, screenshots, checks };
    results.push(summary); writeFileSync(`${out}/samples-${decodeDelayMs}.json`, JSON.stringify(samples, null, 2)); console.log(JSON.stringify(summary));
  }
  const report = { fixture: { kind: realFile ? 'local-public-webmask' : 'generated-moving-person', sha256: createHash('sha256').update(fixture).digest('hex'), framesInWindow: fixtureFrames.length, uniqueFramesInWindow: uniqueFrames }, durationSeconds: seconds, startSeconds: start, results, errors };
  writeFileSync(out + '/results.json', JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(results.every(result => Object.values(result.checks).every(Boolean)), 'Mask continuity regression; see ' + out + '/results.json');
  console.log('PASS continuous unique masks: normal and 100 ms PNG decode latency');
} finally { await browser.close(); }
