// Real React + trusted Chromium input. Every non-Vite request is intercepted;
// no account, real video, television, or upstream feedback request is used.
// Start Vite, then run node tools/test-recommendation-menu.mjs.
// FEEDBACK_BASE_URL, FEEDBACK_TEST_OUTPUT, FEEDBACK_FILTER select server/evidence/cases.
// --baseline runs the feature-presence case unless a filter is explicitly supplied.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.FEEDBACK_BASE_URL || 'http://127.0.0.1:5173';
const viteOrigin = new URL(baseUrl);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(viteOrigin.hostname), 'FEEDBACK_BASE_URL must be a local Vite server');
const output = process.env.FEEDBACK_TEST_OUTPUT || '/tmp/bili-recommendation-menu';
const baseline = process.argv.includes('--baseline');
const filter = process.env.FEEDBACK_FILTER ? new RegExp(process.env.FEEDBACK_FILTER) : baseline ? /^feature presence:/ : null;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const reports = [];
const VIDEO_FEEDBACK = '不感兴趣：当前视频';
const UP_FEEDBACK = '不感兴趣：UP';
const ORIGINAL_AUTH = { SESSDATA: 'synthetic-feedback-session', DedeUserID: '700001', bili_jct: 'synthetic-feedback-csrf' };
const fixtureVideo = n => ({
  bvid: `BV1TEST${String(n).padStart(5, '0')}`, id: 800000 + n, aid: 800000 + n,
  goto: 'av', track_id: `synthetic-recommendation-track-${n}`, dislike_switch: 1,
  title: `合成推荐 ${String(n).padStart(2, '0')} · 山海之间的周末电影`,
  pic: `https://fixture.invalid/feedback-cover-${n}.svg`, duration: 650 + n,
  owner: { mid: 900000 + n, name: '合成作者' }, stat: { view: 12000 + n },
});
const fixtureItems = (count = 12, start = 1) => Array.from({ length: count }, (_, i) => fixtureVideo(start + i));
const withOwner = (n, mid = 900001) => ({ ...fixtureVideo(n), owner: { mid, name: `Synthetic creator ${mid}` } });
// Two recommendations from the selected creator, with a different creator in between.
const authorItems = () => [withOwner(1), fixtureVideo(2), withOwner(3), ...fixtureItems(9, 4)];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeName = name => name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/-$/, '');
const titles = page => page.locator('.browse-page .video-card').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
const cardByNumber = (page, n) => page.locator(`.browse-page .video-card[aria-label="${fixtureVideo(n).title}"]`);
const menu = page => page.locator('.cardmenu');
const menuItem = (page, label) => page.locator('.cardmenu-item').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
const ready = async page => { await page.locator('.browse-page .video-card').first().waitFor(); await page.waitForTimeout(250); };

async function fixture(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
  await context.addInitScript(options => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    delete window.webOS;
    localStorage.setItem('bili_proxyUrl', JSON.stringify('http://127.0.0.1:9527'));
    localStorage.setItem('bili_perfopt', JSON.stringify({ prefetchPage: false, warmPlayer: false }));
    if (!localStorage.getItem('bili_settings')) localStorage.setItem('bili_settings', JSON.stringify({ language: options.language || 'zh', uiScale: options.scale || 1, gridCols: 3 }));
    if (!sessionStorage.getItem('feedback-fixture-initialized')) {
      sessionStorage.setItem('feedback-fixture-initialized', '1');
      if (options.auth) localStorage.setItem('bili_auth', JSON.stringify({ SESSDATA: 'synthetic-feedback-session', ...(options.noUid ? {} : { DedeUserID: '700001' }), ...(options.noCsrf ? {} : { bili_jct: 'synthetic-feedback-csrf' }) }));
    }
    if (options.nativeCookieEcho) {
      // Exercise the actual native-client cookie merge path without calling a
      // service or TV. All fetches below still hit the context HTTP interceptor.
      window.__feedbackNative = { echoes: 0, feed: 0, overflow: false };
      window.PalmServiceBridge = function () {};
      const webOS = { service: { request(uri, request) {
        let cancelled = false;
        const succeed = result => { if (!cancelled) request.onSuccess?.(result); };
        const fail = error => { if (!cancelled) request.onFailure?.({ errorText: error.message }); };
        if (request.method === 'fetch') {
          const params = request.parameters || {};
          if (params.url.includes('/top/feed/rcmd') && ++window.__feedbackNative.feed > 20) {
            window.__feedbackNative.overflow = true;
            setTimeout(() => fail(new Error('Synthetic fixture stopped a runaway recommendation loop')), 0);
          } else {
            fetch(params.url, { method: params.method || 'GET', body: params.body,
              headers: params.contentType ? { 'Content-Type': params.contentType } : undefined })
              .then(response => response.text()).then(body => {
                window.__feedbackNative.echoes++;
                succeed({ returnValue: true, status: 200, body,
                  newCookies: { SESSDATA: 'synthetic-feedback-session', bili_jct: 'synthetic-feedback-csrf' } });
              }).catch(fail);
          }
        } else setTimeout(() => succeed(request.method === 'ping'
          ? { returnValue: true, localProxyPort: 7654 }
          : request.method === 'getCookies' ? { returnValue: true, cookies: { buvid3: 'synthetic-feedback-device' } }
            : { returnValue: true, subscribed: true }), 0);
        return { cancel() { cancelled = true; } };
      } } };
      // webOSTV.js normally installs a browser shim; preserve this isolated stub.
      Object.defineProperty(window, 'webOS', { configurable: true, get: () => webOS, set() {} });
    }
    window.__feedbackTrustedInput = { keydown: 0, keyup: 0, untrusted: 0, menuEvents: [] };
    ['keydown', 'keyup'].forEach(type => window.addEventListener(type, e => {
      if (e.isTrusted) window.__feedbackTrustedInput[type]++;
      else window.__feedbackTrustedInput.untrusted++;
    }, true));
    window.addEventListener('card-menu', e => window.__feedbackTrustedInput.menuEvents.push({ source: e.detail?.source || null, bvid: e.detail?.video?.bvid || e.detail?.bvid || null }));
  }, { auth: !!options.auth, noCsrf: !!options.noCsrf, noUid: !!options.noUid, nativeCookieEcho: !!options.nativeCookieEcho, language: options.language, scale: options.scale });
  const page = await context.newPage();
  page.setDefaultTimeout(4500);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const calls = { feed: 0, feedback: [], cancel: [], view: 0, blocked: 0, blockedWebSockets: [], translationRequests: 0, otherWrites: [], documentNavigations: 0, contractErrors: [] };
  // HTTP routing does not intercept WebSockets. Block every socket, including
  // Vite HMR, so no discovery, Luna, or danmaku connection can escape this fixture.
  await context.routeWebSocket('**/*', socket => { calls.blockedWebSockets.push(socket.url()); socket.close(); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) calls.documentNavigations++; });
  const controls = { dislike: options.dislike || 'success', cancel: options.cancel || 'success', delay: options.delay || 0, pending: [], feedError: !!options.feedFailAfterFirst, feedPending: false, pendingFeeds: [], feedOverride: null };
  const sourceItems = (options.items || fixtureItems(options.count || 12)).map((item, i) => i === 0 && options.mutateFirst ? options.mutateFirst(item) : item);
  const fulfill = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': '*' } });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    // Only the selected local Vite origin may reach the network.
    if (url.origin === viteOrigin.origin) return route.continue();
    calls.blocked++;
    if (request.method() === 'OPTIONS') return fulfill(route, {});
    if (url.pathname.includes('feedback-cover-')) {
      const n = Number(url.pathname.match(/feedback-cover-(\d+)/)?.[1] || 0);
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="672" height="378"><rect width="672" height="378" fill="${['#254958', '#6d4e3e', '#365148', '#454563'][n % 4]}"/><circle cx="470" cy="115" r="55" fill="#e6d4b1" opacity=".7"/><path d="M0 340L220 120L420 350L550 180L672 300V378H0" fill="#14222a" opacity=".7"/></svg>` });
    }
    if (url.port === '9528') return route.abort();
    if (request.method() === 'POST' && (url.hostname === 'translate.googleapis.com' || url.pathname.startsWith('/proxy/translate.googleapis.com/')) && url.pathname.endsWith('/translate_a/t')) {
      // Existing title translation is a read using POST. Keep it mocked and
      // separately audited; every other non-feedback POST remains forbidden.
      calls.translationRequests++;
      return fulfill(route, new URLSearchParams(request.postData() || '').getAll('q'));
    }
    if (/\/feedback\/dislike(?:\/cancel)?$/.test(url.pathname)) {
      const isCancel = url.pathname.endsWith('/cancel'), entries = isCancel ? calls.cancel : calls.feedback;
      const form = Object.fromEntries(new URLSearchParams(request.postData() || ''));
      // Assert the outbound contract before fulfilling. Only synthetic fixture values exist.
      const entry = { method: request.method(), path: url.pathname.replace(/^\/proxy\/[^/]+/, ''), form, query: Object.fromEntries(url.searchParams), contentType: request.headers()['content-type'] };
      entries.push(entry);
      try {
        assert.equal(request.method(), 'POST');
        assert.ok(['1', '4'].includes(form.reason_id), 'only the two verified feedback reasons are allowed');
        assert.match(form.csrf, /synthetic.*csrf/, 'only synthetic credentials may enter the mock');
        assert.ok(sourceItems.concat(...(options.pages || [])).some(item => String(item.id) === form.id), 'feedback must target a synthetic fixture item');
      } catch (error) {
        calls.contractErrors.push(error.message);
        return route.abort('blockedbyclient');
      }
      const mode = isCancel ? controls.cancel : controls.dislike;
      if (mode === 'pending') await new Promise(resolve => controls.pending.push(resolve));
      else if (controls.delay) await sleep(controls.delay);
      if (mode === 'network') return route.abort('failed');
      return fulfill(route, mode === 'failure' ? { code: -400, message: 'Synthetic rejected feedback' } : { code: 0, data: {} });
    }
    if (request.method() === 'POST') calls.otherWrites.push(url.pathname.replace(/^\/proxy\/[^/]+/, ''));
    let body = { code: 0, data: {} };
    if (url.pathname.endsWith('/nav')) body.data = { isLogin: !!options.auth, ...(options.noUid ? {} : { mid: 700001 }), uname: 'Synthetic Test Account', wbi_img: { img_url: 'https://fixture.invalid/abcdefghijklmnopqrstuvwxyz123456.png', sub_url: 'https://fixture.invalid/123456abcdefghijklmnopqrstuvwxyz.png' } };
    if (url.pathname.includes('/top/feed/rcmd')) {
      calls.feed++;
      if (calls.feed > 1 && controls.feedError) return route.abort('failed');
      if (controls.feedPending) await new Promise(resolve => controls.pendingFeeds.push(resolve));
      body.data = { item: controls.feedOverride || (options.pages ? options.pages[Math.min(calls.feed - 1, options.pages.length - 1)] : sourceItems) };
    }
    if (url.pathname.endsWith('/popular')) body.data = { list: sourceItems, no_more: true };
    if (url.pathname.endsWith('/view')) {
      calls.view++;
      const item = sourceItems.find(v => v.bvid === url.searchParams.get('bvid')) || sourceItems[0];
      body.data = { ...item, ...(options.recoverOwnerInView ? { owner: fixtureVideo(1).owner } : {}), cid: 600001, pages: [{ cid: 600001, page: 1, part: 'Synthetic video', duration: 650 }] };
    }
    if (url.pathname.endsWith('/playurl')) body = { code: -404, message: 'Synthetic playback intentionally unavailable' };
    if (url.pathname.endsWith('/history/cursor') || url.pathname.endsWith('/toview')) body.data = { list: [] };
    if (url.pathname.endsWith('/x/relation')) body.data = { attribute: 0 };
    if (url.pathname.endsWith('/followings')) body.data = { list: [] };
    if (url.pathname.endsWith('/folder/created/list-all')) body.data = { list: [{ id: 1, title: '合成收藏夹', media_count: sourceItems.length }] };
    if (url.pathname.endsWith('/folder/collected/list')) body.data = { list: [], has_more: false };
    if (url.pathname.endsWith('/resource/list')) body.data = { medias: sourceItems.map(item => ({ ...item, cover: item.pic, upper: item.owner })), has_more: false };
    if (url.pathname.endsWith('/search/square')) body.data = { trending: { list: [{ keyword: '合成视频' }] } };
    if (url.pathname.endsWith('/search/type')) body.data = { result: sourceItems, numResults: sourceItems.length };
    if (url.pathname.endsWith('/qrcode/generate')) body = { code: -1 };
    return fulfill(route, body);
  });
  await page.goto(baseUrl);
  return { context, page, calls, controls, errors, options, sourceItems };
}

async function screenshot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${output}/${name}.png` });
}
async function openMenu(page, n = 1, { release = true } = {}) {
  await cardByNumber(page, n).hover();
  await page.keyboard.down('Enter');
  await menu(page).waitFor();
  if (release) await page.keyboard.up('Enter');
}
async function choose(page, label) {
  const item = menuItem(page, label);
  await item.waitFor();
  const position = await page.locator('.cardmenu-item').evaluateAll((nodes, label) => ({
    target: nodes.findIndex(node => node.textContent.trim() === label),
    current: nodes.findIndex(node => node.classList.contains('focused')),
  }), label);
  assert.ok(position.target >= 0 && position.current >= 0, `menu focus available for ${label}`);
  for (let i = position.current; i < position.target; i++) await page.keyboard.press('ArrowDown');
  for (let i = position.current; i > position.target; i--) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
}
async function interest(page, author = false) { await choose(page, author ? UP_FEEDBACK : VIDEO_FEEDBACK); }
async function confirm(page, official = true, author = false) { await choose(page, author ? (official ? '确认对 UP 不感兴趣' : '在本机隐藏此 UP') : (official ? '确认不感兴趣' : '在本机隐藏')); }
async function close(page) { await page.keyboard.press('Escape'); await menu(page).waitFor({ state: 'detached' }); }
async function missing(page, n = 1) { await cardByNumber(page, n).waitFor({ state: 'detached' }); }
async function shown(page, n = 1) { await cardByNumber(page, n).waitFor(); }
async function hiddenState(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('bili_hiddenRecommendations') || 'null')); }
async function authorState(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('bili_hiddenRecommendationAuthors') || 'null')); }
async function authorKeys(page, scope = 'user:700001') {
  return page.evaluate(async scope => {
    const preferences = await import('/src/utils/hiddenRecommendationAuthors.js');
    return [...preferences.getHiddenRecommendationAuthorKeys(scope)];
  }, scope);
}
async function setAuth(page, auth) {
  await page.evaluate(auth => {
    if (auth) window.__appStorage.setAuth(auth);
    else window.__appStorage.clearAuth();
  }, auth);
}
async function assertAuthorHidden(page) { await missing(page, 1); await missing(page, 3); await shown(page, 2); }
async function assertAuthorShown(page) { await shown(page, 1); await shown(page, 3); await shown(page, 2); }
async function assertMenuFits(page) {
  const metrics = await menu(page).evaluate(el => ({ rect: { x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, right: el.getBoundingClientRect().right, bottom: el.getBoundingClientRect().bottom }, clipped: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight, items: Array.from(el.querySelectorAll('.cardmenu-item')).map(item => ({ clipped: item.scrollWidth > item.clientWidth, text: item.innerText })) }));
  assert.equal(metrics.clipped, false, JSON.stringify(metrics));
  assert.ok(metrics.rect.x >= 0 && metrics.rect.y >= 0 && metrics.rect.right <= 1920 && metrics.rect.bottom <= 1080, JSON.stringify(metrics));
  assert.ok(metrics.items.every(item => !item.clipped), JSON.stringify(metrics.items));
}
async function poll(fn, message, ms = 4500) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await fn()) return; await sleep(30); }
  assert.fail(message);
}
async function assertFocusedCard(page, n) {
  await poll(async () => await page.locator('.browse-page .video-card.focused').getAttribute('aria-label') === fixtureVideo(n).title, `expected focus on synthetic card ${n}`);
  assert.equal(await page.locator('[data-focus-id].focused').count(), 1, 'exactly one actual focus target');
  const box = await page.locator('.browse-page .video-card.focused').boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height <= 1081, 'focused card visible in viewport');
}
function assertOfficialRequest(request, n = 1, cancel = false, reason = 1, owner = fixtureVideo(n).owner.mid) {
  assert.equal(request.method, 'POST');
  assert.equal(request.path, `/x/web-interface/feedback/dislike${cancel ? '/cancel' : ''}`);
  assert.match(request.contentType, /^application\/x-www-form-urlencoded/);
  assert.deepEqual(Object.keys(request.query).sort(), ['w_rid', 'wts']);
  assert.match(request.query.w_rid, /^[a-f0-9]{32}$/);
  assert.match(request.query.wts, /^\d+$/);
  assert.deepEqual(request.form, { app_id: '100', platform: '5', from_spmid: '', spmid: '333.1007.0.0', feedback_page: '1', goto: 'av', id: String(fixtureVideo(n).id), mid: String(owner), track_id: fixtureVideo(n).track_id, reason_id: String(reason), csrf: 'synthetic-feedback-csrf' });
}
async function test(name, run, options = {}) {
  if (filter && !filter.test(name)) return;
  let fixtureState;
  const started = Date.now();
  try {
    fixtureState = await fixture(options);
    await run(fixtureState);
    assert.deepEqual(fixtureState.errors, [], 'no uncaught browser errors');
    assert.deepEqual(fixtureState.calls.contractErrors, [], 'every feedback request obeys the isolated fixture contract');
    assert.deepEqual(fixtureState.calls.otherWrites, [], 'feedback must never invoke another write API, including relation blocking');
    for (const [requests, isCancel] of [[fixtureState.calls.feedback, false], [fixtureState.calls.cancel, true]]) {
      for (const request of requests) {
        const item = fixtureState.sourceItems.concat(...(options.pages || [])).find(item => String(item.id) === request.form.id);
        assert.ok(item, 'request targets a known fixture');
        assertOfficialRequest(request, item.id - 800000, isCancel, options.reason || 1, item.owner?.mid);
      }
    }
    assert.equal(await fixtureState.page.evaluate(() => window.__feedbackTrustedInput.untrusted), 0, 'interaction must not inject synthetic key events');
    const audit = { feed: fixtureState.calls.feed, feedback: fixtureState.calls.feedback.length, cancel: fixtureState.calls.cancel.length, feedbackReasons: fixtureState.calls.feedback.map(call => call.form.reason_id), cancelReasons: fixtureState.calls.cancel.map(call => call.form.reason_id), interceptedNonViteRequests: fixtureState.calls.blocked, blockedWebSockets: fixtureState.calls.blockedWebSockets.length, mockedTitleTranslationRequests: fixtureState.calls.translationRequests, otherWritePaths: fixtureState.calls.otherWrites, documentNavigations: fixtureState.calls.documentNavigations };
    reports.push({ name, pass: true, durationMs: Date.now() - started, audit });
    console.log('PASS', name);
  } catch (error) {
    const evidence = `${baseline ? 'baseline' : 'failure'}-${safeName(name)}.png`;
    if (fixtureState) await screenshot(fixtureState.page, evidence.replace(/\.png$/, '')).catch(() => {});
    const diagnostics = fixtureState ? await fixtureState.page.evaluate(() => ({
      focus: typeof window.__focusState === 'function' ? window.__focusState() : null,
      focusedLabels: Array.from(document.querySelectorAll('.video-card.focused')).map(el => el.getAttribute('aria-label')),
      focusedTargets: Array.from(document.querySelectorAll('[data-focus-id].focused')).map(el => ({ id: el.getAttribute('data-focus-id'), text: el.innerText })),
      menuText: document.querySelector('.cardmenu')?.innerText || null,
      trustedInput: window.__feedbackTrustedInput,
      nativeFixture: window.__feedbackNative || null,
    })).catch(() => null) : null;
    reports.push({ name, pass: false, durationMs: Date.now() - started, error: error.message, screenshot: evidence,
      requestAudit: fixtureState ? { feed: fixtureState.calls.feed, feedbackReasons: fixtureState.calls.feedback.map(call => call.form.reason_id), cancelReasons: fixtureState.calls.cancel.map(call => call.form.reason_id), blockedWebSockets: fixtureState.calls.blockedWebSockets.length, otherWritePaths: fixtureState.calls.otherWrites } : null,
      documentNavigations: fixtureState?.calls.documentNavigations, diagnostics });
    console.log('FAIL', name, error.message.split('\n')[0]);
  } finally {
    if (fixtureState) {
      fixtureState.controls.pending.splice(0).forEach(resolve => resolve());
      fixtureState.controls.pendingFeeds.splice(0).forEach(resolve => resolve());
      await fixtureState.context.close();
    }
    await writeFile(`${output}/results.json`, JSON.stringify({ baseUrl, baseline, mockBoundary: 'Every HTTP request outside the selected Vite origin is intercepted; every WebSocket is blocked. All account/video data is synthetic.', results: reports }, null, 2));
  }
}

await test('feature presence: recommendation long press exposes not interested', async ({ page, calls }) => {
  await ready(page); await openMenu(page);
  await menuItem(page, VIDEO_FEEDBACK).waitFor();
  await menuItem(page, UP_FEEDBACK).waitFor();
  assert.equal(await page.locator('.cardmenu-item').filter({ hasText: /^不感兴趣/ }).count(), 2, 'exactly two negative feedback choices');
  const event = await page.evaluate(() => window.__feedbackTrustedInput.menuEvents.at(-1));
  assert.equal(event.source, 'recommendation');
  assert.equal(calls.feedback.length, 0);
  await screenshot(page, 'recommendation-menu');
});

await test('short Enter opens playback without a feedback menu or POST', async ({ page, calls }) => {
  await ready(page); await cardByNumber(page, 1).hover();
  await page.keyboard.press('Enter');
  await page.locator('.player-page').waitFor();
  assert.equal(await menu(page).count(), 0);
  assert.equal(calls.feedback.length, 0);
});

await test('held Enter requires release and a fresh press at both menu steps', async ({ page, calls }) => {
  await ready(page); await openMenu(page, 1, { release: false });
  await menuItem(page, VIDEO_FEEDBACK).hover();
  for (let i = 0; i < 8; i++) { await page.keyboard.down('Enter'); await page.waitForTimeout(35); }
  assert.equal(await menuItem(page, '确认不感兴趣').count(), 0);
  assert.equal(calls.feedback.length, 0);
  await page.keyboard.up('Enter');
  await page.keyboard.down('Enter');
  await menuItem(page, '确认不感兴趣').waitFor();
  await menuItem(page, '确认不感兴趣').hover();
  for (let i = 0; i < 8; i++) await page.keyboard.down('Enter');
  assert.equal(calls.feedback.length, 0);
  await page.keyboard.up('Enter');
  await page.keyboard.press('Enter');
  await missing(page);
  assert.equal(calls.feedback.length, 1);
}, { auth: true });

await test('official success signs query and CSRF form then repairs same-cell focus', async ({ page, calls }) => {
  await ready(page); await openMenu(page, 2); await interest(page);
  assert.equal(calls.feedback.length, 0);
  await screenshot(page, 'official-confirmation');
  await confirm(page); await missing(page, 2);
  assertOfficialRequest(calls.feedback[0], 2);
  assert.ok(await hiddenState(page), 'successful hide persists');
  await screenshot(page, 'official-success');
  await close(page); await assertFocusedCard(page, 3);
  await page.keyboard.press('ArrowRight'); await assertFocusedCard(page, 4);
}, { auth: true });

await test('pointer menu selection followed by remote dismissal retains adjacent focus', async ({ page }) => {
  await ready(page); await openMenu(page, 2);
  await menuItem(page, VIDEO_FEEDBACK).hover(); await page.keyboard.press('Enter');
  await menuItem(page, '在本机隐藏').hover(); await page.keyboard.press('Enter');
  await missing(page, 2); await close(page);
  // A stationary pointer can receive mouseenter after the overlay disappears.
  // Wait for layout/paint so an immediately correct ring cannot hide a late steal.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await assertFocusedCard(page, 3);
  await page.keyboard.press('ArrowRight'); await assertFocusedCard(page, 4);
});

for (const scenario of [
  { name: 'guest', auth: false },
  { name: 'login without CSRF', auth: true, noCsrf: true },
  { name: 'missing track', auth: true, mutateFirst: item => ({ ...item, track_id: undefined }) },
  { name: 'missing goto', auth: true, mutateFirst: item => ({ ...item, goto: undefined }) },
  { name: 'missing owner', auth: true, mutateFirst: item => ({ ...item, owner: { name: '合成作者' } }) },
  { name: 'disabled switch', auth: true, mutateFirst: item => ({ ...item, dislike_switch: 0 }) },
  { name: 'disabled PC switch', auth: true, mutateFirst: item => ({ ...item, dislike_switch_pc: 0 }) },
  { name: 'invalid primary ID', auth: true, mutateFirst: item => ({ ...item, id: -1 }) },
]) await test(`local fallback: ${scenario.name} has explicit copy and no official POST`, async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page);
  await menuItem(page, '在本机隐藏').waitFor();
  assert.equal(await menuItem(page, '确认不感兴趣').count(), 0);
  assert.match(await menu(page).innerText(), /不会.*提交|不.*官方|仅.*本机|只.*本机/);
  if (scenario.name === 'guest') await screenshot(page, 'guest-local-confirmation');
  await confirm(page, false); await missing(page);
  assert.equal(calls.feedback.length, 0);
  assert.equal(calls.cancel.length, 0);
  await choose(page, '恢复本机显示'); await shown(page);
  await close(page); await openMenu(page); await close(page);
}, scenario);

for (const target of ['bangumi', 'live']) await test(`non-UGC ${target}: recommendation menu has no feedback action`, async ({ page, calls }) => {
  await ready(page); await openMenu(page);
  assert.equal(await menuItem(page, VIDEO_FEEDBACK).count(), 0);
  assert.equal(await menuItem(page, UP_FEEDBACK).count(), 0);
  assert.equal(calls.feedback.length, 0); await close(page);
}, { auth: true, mutateFirst: item => ({ ...item, goto: target, ...(target === 'live' ? { isLive: true } : { isBangumi: true }) }) });

await test('cancel and Back close confirmation without writes or hiding', async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page);
  await choose(page, '返回');
  await choose(page, '取消'); await menu(page).waitFor({ state: 'detached' });
  await shown(page); assert.equal(calls.feedback.length, 0);
  await openMenu(page); await interest(page); await page.keyboard.press('Backspace');
  await menu(page).waitFor({ state: 'detached' }); await shown(page);
  assert.equal(calls.feedback.length, 0);
}, { auth: true });

await test('business failure retains card and supports one explicit retry', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page); await confirm(page);
  await poll(async () => /失败|拒绝|未成功/.test(await menu(page).innerText()), 'business rejection visible');
  await shown(page); assert.equal(calls.feedback.length, 1);
  await screenshot(page, 'official-rejected');
  controls.dislike = 'success'; await choose(page, '重试提交'); await missing(page);
  assert.equal(calls.feedback.length, 2);
}, { auth: true, dislike: 'failure' });

await test('network uncertainty retains card and never auto-retries', async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page); await confirm(page);
  await poll(async () => /未知/.test(await menu(page).innerText()), 'network error classified as unknown');
  await shown(page); await screenshot(page, 'network-result-unknown');
  await page.waitForTimeout(600);
  assert.equal(calls.feedback.length, 1);
  await close(page); await shown(page);
}, { auth: true, dislike: 'network' });

await test('timeout uncertainty is visible and ignores its late response', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page);
  await page.clock.install();
  await confirm(page);
  await poll(() => calls.feedback.length === 1, 'feedback request started');
  await page.clock.runFor(21000);
  await poll(async () => /未知/.test(await menu(page).innerText()), 'deadline result classified as unknown');
  await shown(page); assert.equal(calls.feedback.length, 1);
  controls.pending.splice(0).forEach(resolve => resolve());
  await page.waitForTimeout(100); await shown(page);
  assert.equal(await hiddenState(page), null);
}, { auth: true, dislike: 'pending' });

await test('double click and repeated Enter cannot duplicate pending submission', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page);
  await menuItem(page, '确认不感兴趣').dblclick({ delay: 20 });
  await poll(() => calls.feedback.length === 1, 'feedback request started');
  await page.keyboard.down('Enter');
  for (let i = 0; i < 8; i++) await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  assert.equal(calls.feedback.length, 1);
  controls.pending.splice(0).forEach(resolve => resolve());
  await missing(page); assert.equal(calls.feedback.length, 1);
}, { auth: true, dislike: 'pending' });

await test('remote cancel failure keeps hidden and success restores original context', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page); await confirm(page); await missing(page);
  await choose(page, '尝试撤销反馈');
  await poll(async () => /失败|拒绝|未成功/.test(await menu(page).innerText()), 'cancel rejection visible');
  await missing(page); assert.equal(calls.cancel.length, 1);
  await screenshot(page, 'cancel-rejected');
  controls.cancel = 'success'; await choose(page, '尝试撤销反馈'); await shown(page);
  assert.equal(calls.cancel.length, 2);
  assertOfficialRequest(calls.cancel[0], 1, true); assertOfficialRequest(calls.cancel[1], 1, true);
  await close(page);
}, { auth: true, cancel: 'failure' });

await test('local restore after official success never sends cancel', async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page); await confirm(page); await missing(page);
  await choose(page, '恢复本机显示'); await shown(page);
  assert.equal(calls.feedback.length, 1); assert.equal(calls.cancel.length, 0);
  await close(page);
}, { auth: true });

await test('closed pending menu applies confirmed same-account success without changing new menu', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page); await confirm(page);
  await poll(() => calls.feedback.length === 1, 'feedback request started');
  await close(page); await openMenu(page, 2);
  controls.pending.splice(0).forEach(resolve => resolve());
  await page.waitForTimeout(200);
  await missing(page, 1); await shown(page, 2);
  assert.match(await menu(page).innerText(), /合成推荐 02/);
  assert.ok(await hiddenState(page), 'confirmed request still hides after menu dismissal');
  await close(page);
}, { auth: true, dislike: 'pending' });

await test('account generation change rejects late feedback without hiding', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page); await confirm(page);
  await poll(() => calls.feedback.length === 1, 'feedback request started');
  await page.evaluate(async () => {
    const appStorage = window.__appStorage || (await import('/src/utils/storage.js')).storage;
    appStorage.clearAuth();
    appStorage.setAuth({ SESSDATA: 'second-synthetic-session', DedeUserID: '700002', bili_jct: 'second-synthetic-csrf' });
  });
  controls.pending.splice(0).forEach(resolve => resolve());
  await page.waitForTimeout(200); await shown(page);
  assert.equal(await hiddenState(page), null); assert.equal(calls.feedback.length, 1);
  await close(page);
}, { auth: true, dislike: 'pending' });

await test('hidden card survives cache refresh reload and duplicate pagination', async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page); await confirm(page, false); await missing(page); await close(page);
  await page.locator('.sidebar-item').filter({ hasText: '热门' }).click(); await ready(page); await shown(page);
  await openMenu(page); assert.equal(await menuItem(page, VIDEO_FEEDBACK).count(), 0); await close(page);
  await page.locator('.sidebar-item').filter({ hasText: '推荐' }).click(); await ready(page); await missing(page);
  const beforeRefresh = calls.feed;
  await page.locator('.sidebar-item').filter({ hasText: '推荐' }).click(); await ready(page); await missing(page);
  assert.ok(calls.feed > beforeRefresh, 'explicit refresh fetched feed');
  await page.reload(); await ready(page); await missing(page);
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown');
  await poll(() => calls.feed >= 4, 'pagination requested');
  await missing(page);
  const names = await titles(page); assert.equal(new Set(names).size, names.length, 'duplicate pages remain deduplicated');
  assert.equal(calls.feedback.length, 0);
});

await test('recommendation hiding does not affect search or favorites menus', async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page); await confirm(page); await missing(page); await close(page);
  await page.locator('.sidebar-item').filter({ hasText: '收藏' }).click();
  await page.locator('.video-card').first().waitFor();
  assert.ok((await page.locator('.video-card').allTextContents()).some(text => text.includes('合成推荐 01')));
  await page.locator('.video-card').first().hover(); await page.keyboard.down('Enter'); await menu(page).waitFor(); await page.keyboard.up('Enter');
  assert.equal(await menuItem(page, VIDEO_FEEDBACK).count(), 0); await close(page);
  await page.locator('.sidebar-item').filter({ hasText: '搜索' }).click();
  await page.locator('.search-input').fill('合成视频'); await page.keyboard.press('Enter');
  await page.locator('.search-results-grid .video-card').first().waitFor();
  assert.ok((await page.locator('.search-results-grid .video-card').allTextContents()).some(text => text.includes('合成推荐 01')));
  await page.locator('.search-results-grid .video-card').first().hover(); await page.keyboard.down('Enter'); await menu(page).waitFor(); await page.keyboard.up('Enter');
  assert.equal(await menuItem(page, VIDEO_FEEDBACK).count(), 0); await close(page);
  assert.equal(calls.feedback.length, 1); assert.equal(calls.cancel.length, 0);
}, { auth: true });

await test('last card removal focuses previous and local undo remains available', async ({ page, calls }) => {
  await ready(page); await openMenu(page, 3); await interest(page); await confirm(page, false); await missing(page, 3); await close(page);
  await assertFocusedCard(page, 2);
  await openMenu(page, 2); await choose(page, '恢复上次本机隐藏'); await shown(page, 3);
  assert.equal(calls.feedback.length, 0); assert.equal(calls.cancel.length, 0);
  await close(page);
}, { count: 3 });

await test('all hidden empty state offers restore and usable load more', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page); await confirm(page, false); await missing(page); await close(page);
  assert.equal(await page.locator('.browse-page .video-card').count(), 0);
  const restore = page.getByText('恢复上次本机隐藏', { exact: true });
  await restore.waitFor(); await screenshot(page, 'all-hidden-empty-state');
  await restore.hover(); await page.keyboard.press('Enter'); await shown(page);
  await openMenu(page); await interest(page); await confirm(page, false); await missing(page); await close(page);
  controls.feedError = false;
  const more = page.getByText(/加载更多/, { exact: true }).first();
  await more.hover(); await page.keyboard.press('Enter');
  await shown(page, 2); await missing(page, 1);
  assert.equal(await page.locator('.browse-page .video-card').count(), 1, 'load more filters the hidden ID and deduplicates repeated new IDs');
  assert.ok(calls.feed >= 2);
}, { count: 1, feedFailAfterFirst: true, pages: [[fixtureVideo(1)], [fixtureVideo(1), fixtureVideo(2), fixtureVideo(2)]] });

await test('late empty-state load more preserves sidebar focus after Back', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page); await confirm(page, false); await missing(page); await close(page);
  assert.equal(await page.locator('.browse-page .video-card').count(), 0);
  controls.feedError = false; controls.feedPending = true;
  const more = page.getByText('加载更多推荐', { exact: true });
  await more.hover(); await page.keyboard.press('Enter');
  await poll(() => controls.pendingFeeds.length === 1, 'empty-state load-more request started');
  await page.keyboard.press('Backspace');
  const sidebarFocus = await page.evaluate(() => window.__focusState().current);
  assert.match(sidebarFocus, /^sidebar-/);
  controls.feedPending = false; controls.pendingFeeds.splice(0).forEach(resolve => resolve());
  await shown(page, 2); await missing(page, 1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => window.__focusState().current), sidebarFocus, 'late page must not steal focus from the sidebar');
  assert.equal(await page.locator('.sidebar-item.focused').count(), 1);
  assert.equal(await page.locator('.browse-page .video-card.focused').count(), 0);
  assert.equal(calls.feedback.length, 0);
  await screenshot(page, 'late-empty-load-keeps-sidebar');
}, { count: 1, feedFailAfterFirst: true, pages: [[fixtureVideo(1)], [fixtureVideo(1), fixtureVideo(2)]] });

for (const language of ['en', 'es']) await test(`large text ${language}: translated menu and confirmation fit screen`, async ({ page, calls }) => {
  await ready(page); await openMenu(page);
  const notInterested = language === 'en' ? 'Not interested: this video' : 'No me interesa: este vídeo';
  await choose(page, notInterested);
  await screenshot(page, `large-text-${language}-confirmation`);
  const text = await menu(page).innerText();
  assert.ok(text.includes(language === 'en' ? 'all accounts on this device' : 'todas las cuentas de este dispositivo'), 'device-wide hiding scope explained');
  assert.ok(!/[\u4e00-\u9fff]/.test(text.replace(fixtureVideo(1).title, '')), 'feedback copy is translated');
  const metrics = await menu(page).evaluate(el => ({ rect: { x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, right: el.getBoundingClientRect().right, bottom: el.getBoundingClientRect().bottom }, clipped: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight, items: Array.from(el.querySelectorAll('.cardmenu-item')).map(item => ({ clipped: item.scrollWidth > item.clientWidth, text: item.innerText })) }));
  assert.equal(metrics.clipped, false, JSON.stringify(metrics));
  assert.ok(metrics.rect.x >= 0 && metrics.rect.y >= 0 && metrics.rect.right <= 1920 && metrics.rect.bottom <= 1080, JSON.stringify(metrics));
  assert.ok(metrics.items.every(item => !item.clipped), JSON.stringify(metrics.items));
  assert.equal(calls.feedback.length, 0); await close(page);
}, { auth: true, language, scale: 1.25 });

await test('two feedback choices navigate independently and default confirmations to Back', async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page);
  assert.equal(await page.locator('.cardmenu-item.focused').innerText(), '返回');
  await page.keyboard.press('Enter');
  await menuItem(page, UP_FEEDBACK).waitFor();
  await interest(page, true);
  assert.equal(await page.locator('.cardmenu-item.focused').innerText(), '返回');
  await menuItem(page, '确认对 UP 不感兴趣').waitFor();
  assert.match(await menu(page).innerText(), /不等同于拉黑/);
  assert.match(await menu(page).innerText(), /推荐/);
  assert.match(await menu(page).innerText(), /当前账号|此账号/);
  await page.keyboard.press('Enter');
  await menuItem(page, VIDEO_FEEDBACK).waitFor();
  await choose(page, '取消'); await shown(page);
  assert.equal(calls.feedback.length, 0); assert.equal(calls.cancel.length, 0);
}, { auth: true });

for (const author of [false, true]) await test(`${author ? 'UP' : 'video'} stationary pointer cannot displace safe confirmation default`, async ({ page, calls }) => {
  await ready(page); await openMenu(page);
  const label = author ? UP_FEEDBACK : VIDEO_FEEDBACK;
  await menuItem(page, label).hover(); await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.cardmenu-item.focused').innerText(), '返回', 'reflow under a stationary pointer must keep the safe default');
  await page.keyboard.press('Enter');
  await menuItem(page, label).waitFor();
  assert.equal(calls.feedback.length, 0); await shown(page); await close(page);
}, { auth: true });

await test('UP official success sends reason 4 and hides every same-author recommendation', async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page, true);
  assert.match(await menu(page).innerText(), /不等同于拉黑/);
  await screenshot(page, 'up-official-confirmation');
  await confirm(page, true, true); await assertAuthorHidden(page);
  assertOfficialRequest(calls.feedback[0], 1, false, 4);
  assert.equal(await hiddenState(page), null, 'UP hiding must not become a global single-video preference');
  assert.deepEqual(await authorKeys(page), ['up:900001']);
  assert.ok(await authorState(page), 'author preference persists');
  await screenshot(page, 'up-official-success');
  await close(page); await assertFocusedCard(page, 2);
  await page.keyboard.press('ArrowRight'); await assertFocusedCard(page, 4);
}, { auth: true, reason: 4, items: authorItems() });

for (const scenario of [
  { name: 'guest', auth: false },
  { name: 'missing CSRF', auth: true, noCsrf: true },
  { name: 'missing track', auth: true, mutateFirst: item => ({ ...item, track_id: undefined }) },
  { name: 'disabled feedback', auth: true, mutateFirst: item => ({ ...item, dislike_switch: 0 }) },
]) await test(`UP local fallback: ${scenario.name} explains author and account scope`, async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page, true);
  await menuItem(page, '在本机隐藏此 UP').waitFor();
  assert.equal(await menuItem(page, '确认对 UP 不感兴趣').count(), 0);
  const copy = await menu(page).innerText();
  assert.match(copy, /不会.*提交|不.*官方|仅.*本机|只.*本机/);
  assert.match(copy, /UP/); assert.match(copy, /推荐/);
  assert.match(copy, scenario.auth ? /当前账号|此账号/ : /未登录|游客/);
  assert.match(copy, /不会拉黑/);
  assert.doesNotMatch(copy, /适用于此设备的所有账号/);
  await confirm(page, false, true); await assertAuthorHidden(page);
  assert.deepEqual(await authorKeys(page, scenario.auth ? 'user:700001' : 'guest'), ['up:900001']);
  assert.equal(await hiddenState(page), null);
  await choose(page, '恢复此 UP 的本机显示'); await assertAuthorShown(page);
  assert.equal(calls.feedback.length, 0); assert.equal(calls.cancel.length, 0); await close(page);
}, { ...scenario, items: authorItems(), reason: 4 });

for (const scenario of [
  { name: 'missing raw owner', recoverOwnerInView: true, mutateFirst: item => ({ ...item, owner: { name: 'Same display name is not a stable identity' } }) },
  { name: 'invalid raw owner', mutateFirst: item => ({ ...item, owner: { mid: -1, name: 'Invalid synthetic owner' } }) },
  { name: 'logged in without UID', noUid: true },
]) await test(`UP unavailable: ${scenario.name} cannot fall back to one-video hiding`, async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page, true);
  assert.equal(await menuItem(page, '确认对 UP 不感兴趣').count(), 0);
  assert.equal(await menuItem(page, '在本机隐藏此 UP').count(), 0);
  assert.equal(await menuItem(page, '在本机隐藏').count(), 0);
  assert.match(await menu(page).innerText(), /无法|缺少|不能|不可|不支持/);
  assert.equal(await page.locator('.cardmenu-item.focused').innerText(), '返回');
  await page.keyboard.press('Enter'); await close(page); await assertAuthorShown(page);
  assert.equal(await hiddenState(page), null); assert.equal(await authorState(page), null);
  assert.equal(calls.feedback.length, 0); assert.equal(calls.cancel.length, 0);
}, { ...scenario, auth: true, reason: 4, items: authorItems() });

await test('UP held Enter requires release and fresh confirmation without duplicate POST', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page, 1, { release: false });
  await menuItem(page, UP_FEEDBACK).hover();
  for (let i = 0; i < 6; i++) await page.keyboard.down('Enter');
  assert.equal(await menuItem(page, '确认对 UP 不感兴趣').count(), 0);
  await page.keyboard.up('Enter'); await page.keyboard.down('Enter');
  await menuItem(page, '确认对 UP 不感兴趣').waitFor();
  await menuItem(page, '确认对 UP 不感兴趣').hover();
  for (let i = 0; i < 6; i++) await page.keyboard.down('Enter');
  assert.equal(calls.feedback.length, 0);
  await page.keyboard.up('Enter'); await page.keyboard.press('Enter');
  await poll(() => calls.feedback.length === 1, 'UP request started');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Enter');
  assert.equal(calls.feedback.length, 1);
  controls.pending.splice(0).forEach(resolve => resolve());
  await assertAuthorHidden(page); await close(page);
}, { auth: true, reason: 4, items: authorItems(), dislike: 'pending' });

await test('UP business rejection keeps all creator cards and retries reason 4 explicitly', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page, true); await confirm(page, true, true);
  await poll(async () => /失败|拒绝|未成功/.test(await menu(page).innerText()), 'UP rejection visible');
  await assertAuthorShown(page); assert.equal(await authorState(page), null);
  controls.dislike = 'success'; await choose(page, '重试提交'); await assertAuthorHidden(page);
  assert.equal(calls.feedback.length, 2); await close(page);
}, { auth: true, reason: 4, items: authorItems(), dislike: 'failure' });

await test('UP network uncertainty retains all cards and explicit local fallback remains scoped', async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page, true); await confirm(page, true, true);
  await poll(async () => /未知/.test(await menu(page).innerText()), 'UP network result is unknown');
  await assertAuthorShown(page); await page.waitForTimeout(600);
  assert.equal(calls.feedback.length, 1); assert.equal(await authorState(page), null);
  await choose(page, '仅在本机隐藏此 UP'); await assertAuthorHidden(page);
  assert.equal(calls.feedback.length, 1); assert.equal(calls.cancel.length, 0);
  assert.equal(await hiddenState(page), null); await close(page);
}, { auth: true, reason: 4, items: authorItems(), dislike: 'network' });

await test('UP timeout stays unknown after late success and never hides the creator', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page, true); await page.clock.install();
  await confirm(page, true, true); await poll(() => calls.feedback.length === 1, 'UP request started');
  await page.clock.runFor(21000);
  await poll(async () => /未知/.test(await menu(page).innerText()), 'UP deadline result is unknown');
  await assertAuthorShown(page);
  controls.pending.splice(0).forEach(resolve => resolve());
  await page.waitForTimeout(100); await assertAuthorShown(page);
  assert.equal(await authorState(page), null); assert.equal(calls.feedback.length, 1);
}, { auth: true, reason: 4, items: authorItems(), dislike: 'pending' });

await test('UP local restore after official success restores all author cards without cancel', async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page, true); await confirm(page, true, true);
  await assertAuthorHidden(page); assert.match(await menu(page).innerText(), /不会撤销/);
  await choose(page, '恢复此 UP 的本机显示'); await assertAuthorShown(page);
  assert.equal(calls.feedback.length, 1); assert.equal(calls.cancel.length, 0);
  assert.deepEqual(await authorKeys(page), []); await close(page);
}, { auth: true, reason: 4, items: authorItems() });

await test('UP remote cancel retains original reason 4 target and needs confirmed success', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page, true); await confirm(page, true, true); await assertAuthorHidden(page);
  await choose(page, '尝试撤销反馈');
  await poll(async () => /失败|拒绝|未成功/.test(await menu(page).innerText()), 'UP cancel rejected');
  await assertAuthorHidden(page); assert.equal(calls.cancel.length, 1);
  controls.cancel = 'success'; await choose(page, '尝试撤销反馈'); await assertAuthorShown(page);
  assert.equal(calls.cancel.length, 2);
  assertOfficialRequest(calls.cancel[0], 1, true, 4); assertOfficialRequest(calls.cancel[1], 1, true, 4);
  assert.deepEqual(await authorKeys(page), []); await close(page);
}, { auth: true, reason: 4, items: authorItems(), cancel: 'failure' });

await test('UP unknown cancel retains local author filter and never resends automatically', async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page, true); await confirm(page, true, true); await assertAuthorHidden(page);
  await choose(page, '尝试撤销反馈');
  await poll(async () => /未知/.test(await menu(page).innerText()), 'UP cancel uncertainty visible');
  await page.waitForTimeout(600); await assertAuthorHidden(page);
  assert.equal(calls.cancel.length, 1);
  await choose(page, '恢复此 UP 的本机显示'); await assertAuthorShown(page);
  assert.equal(calls.cancel.length, 1); await close(page);
}, { auth: true, reason: 4, items: authorItems(), cancel: 'network' });

await test('closed pending UP menu hides creator on confirmed success without replacing another menu', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page, true); await confirm(page, true, true);
  await poll(() => calls.feedback.length === 1, 'UP request started');
  await close(page); await openMenu(page, 2);
  controls.pending.splice(0).forEach(resolve => resolve());
  await assertAuthorHidden(page);
  assert.match(await menu(page).innerText(), /合成推荐 02/);
  assert.equal(await menuItem(page, VIDEO_FEEDBACK).count(), 1);
  await close(page);
}, { auth: true, reason: 4, items: authorItems(), dislike: 'pending' });

for (const change of [
  { name: 'UID only', auth: { ...ORIGINAL_AUTH, DedeUserID: '700002' } },
  { name: 'session only', auth: { ...ORIGINAL_AUTH, SESSDATA: 'changed-synthetic-session' } },
  { name: 'CSRF only', auth: { ...ORIGINAL_AUTH, bili_jct: 'changed-synthetic-csrf' } },
]) await test(`UP pending submit rejects late response after ${change.name} changes`, async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page, true); await confirm(page, true, true);
  await poll(() => calls.feedback.length === 1, 'UP request started');
  await setAuth(page, change.auth);
  controls.pending.splice(0).forEach(resolve => resolve());
  await page.waitForTimeout(200); await assertAuthorShown(page);
  assert.equal(await authorState(page), null); assert.equal(await hiddenState(page), null);
  assert.equal(calls.feedback.length, 1); await close(page);
}, { auth: true, reason: 4, items: authorItems(), dislike: 'pending' });

await test('UP pending cancel cannot restore another account or erase original account filter', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page, true); await confirm(page, true, true); await assertAuthorHidden(page);
  await choose(page, '尝试撤销反馈'); await poll(() => calls.cancel.length === 1, 'UP cancel started');
  await setAuth(page, { ...ORIGINAL_AUTH, DedeUserID: '700002' });
  await assertAuthorShown(page);
  controls.pending.splice(0).forEach(resolve => resolve());
  await page.waitForTimeout(200); await assertAuthorShown(page);
  assert.deepEqual(await authorKeys(page, 'user:700001'), ['up:900001']);
  assert.deepEqual(await authorKeys(page, 'user:700002'), []);
  await close(page); await setAuth(page, ORIGINAL_AUTH); await assertAuthorHidden(page);
  assert.equal(calls.cancel.length, 1);
}, { auth: true, reason: 4, items: authorItems(), cancel: 'pending' });

await test('UP filters isolate guest and UID scopes while surviving same-UID credential rotation', async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page, true); await confirm(page, false, true); await assertAuthorHidden(page); await close(page);
  assert.deepEqual(await authorKeys(page, 'guest'), ['up:900001']);
  await setAuth(page, { ...ORIGINAL_AUTH, bili_jct: undefined }); await assertAuthorShown(page);
  await openMenu(page, 2); await interest(page, true); await confirm(page, false, true); await missing(page, 2); await close(page);
  await shown(page, 1); await shown(page, 3);
  assert.deepEqual(await authorKeys(page), ['up:900002']);
  await setAuth(page, { ...ORIGINAL_AUTH, SESSDATA: 'rotated-synthetic-session', bili_jct: 'rotated-synthetic-csrf' });
  await missing(page, 2); await shown(page, 1); await shown(page, 3);
  await setAuth(page, { ...ORIGINAL_AUTH, DedeUserID: '700002' }); await assertAuthorShown(page);
  await setAuth(page, null); await assertAuthorHidden(page);
  await setAuth(page, ORIGINAL_AUTH); await missing(page, 2); await shown(page, 1); await shown(page, 3);
  await page.reload(); await ready(page); await missing(page, 2); await shown(page, 1); await shown(page, 3);
  assert.equal(calls.feedback.length, 0); assert.equal(calls.cancel.length, 0);
}, { items: authorItems(), reason: 4 });

await test('current-video hiding stays device-wide across UID and guest changes', async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page); await confirm(page, false); await missing(page); await close(page);
  await setAuth(page, ORIGINAL_AUTH); await missing(page); await shown(page, 3);
  await setAuth(page, { ...ORIGINAL_AUTH, DedeUserID: '700002' }); await missing(page); await shown(page, 3);
  await setAuth(page, null); await missing(page); await shown(page, 3);
  assert.equal(await authorState(page), null); assert.equal(calls.feedback.length, 0);
}, { items: authorItems() });

await test('UP restore preserves an independently hidden video from the same creator', async ({ page, calls }) => {
  await ready(page); await openMenu(page); await interest(page); await confirm(page, false); await missing(page); await close(page);
  await openMenu(page, 3); await interest(page, true); await confirm(page, false, true); await assertAuthorHidden(page);
  await choose(page, '恢复此 UP 的本机显示'); await shown(page, 3); await missing(page, 1); await shown(page, 2);
  assert.deepEqual(await authorKeys(page, 'guest'), []);
  assert.deepEqual(await hiddenState(page), ['bv:BV1TEST00001']);
  assert.equal(calls.feedback.length, 0); await close(page);
}, { items: authorItems(), reason: 4 });

await test('UP filter survives refresh cache reload and hides new same-author pagination cards', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page, true); await confirm(page, false, true); await assertAuthorHidden(page); await close(page);
  await page.locator('.sidebar-item').filter({ hasText: '热门' }).click(); await ready(page); await assertAuthorShown(page);
  await openMenu(page); assert.equal(await menuItem(page, UP_FEEDBACK).count(), 0); await close(page);
  await page.locator('.sidebar-item').filter({ hasText: '推荐' }).click(); await ready(page); await assertAuthorHidden(page);
  const before = calls.feed;
  await page.locator('.sidebar-item').filter({ hasText: '推荐' }).click(); await ready(page);
  assert.ok(calls.feed > before); await missing(page, 1); await missing(page, 3); await missing(page, 13);
  await page.reload(); await ready(page); await missing(page, 1); await missing(page, 3); await missing(page, 13);
  const beforePagination = calls.feed;
  controls.feedOverride = [withOwner(15), fixtureVideo(16), fixtureVideo(16)];
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown');
  await poll(() => calls.feed > beforePagination, 'new author-filtered page requested');
  await missing(page, 13); await missing(page, 15); await shown(page, 14); await shown(page, 16);
  const names = await titles(page); assert.equal(new Set(names).size, names.length);
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowUp');
  await openMenu(page, 2); await choose(page, '恢复上次本机隐藏的 UP');
  await shown(page, 1); await shown(page, 3); await shown(page, 13); await shown(page, 15); await close(page);
  assert.equal(calls.feedback.length, 0);
}, { items: authorItems(), pages: [authorItems(), [...authorItems(), withOwner(13), fixtureVideo(14), fixtureVideo(14)]] });

await test('all UP cards hidden offers scoped restore with one visible keyboard focus', async ({ page, calls, controls }) => {
  await ready(page); await openMenu(page); await interest(page, true); await confirm(page, false, true); await missing(page, 1); await missing(page, 3); await close(page);
  assert.equal(await page.locator('.browse-page .video-card').count(), 0);
  const restore = page.getByText('恢复上次本机隐藏的 UP', { exact: true });
  await restore.waitFor(); await screenshot(page, 'up-all-hidden-empty-state');
  await restore.hover(); await page.keyboard.press('Enter'); await shown(page, 1); await shown(page, 3);
  await assertFocusedCard(page, 3);
  await openMenu(page); await interest(page, true); await confirm(page, false, true); await missing(page, 1); await missing(page, 3); await close(page);
  controls.feedError = false;
  await page.getByText('加载更多推荐', { exact: true }).hover(); await page.keyboard.press('Enter');
  await shown(page, 2); await missing(page, 1); await missing(page, 3); await missing(page, 5);
  assert.equal(await page.locator('.browse-page .video-card').count(), 1);
  await assertFocusedCard(page, 2);
  assert.ok(calls.feed >= 2); assert.equal(calls.feedback.length, 0);
}, { items: [withOwner(1), withOwner(3)], feedFailAfterFirst: true, pages: [[withOwner(1), withOwner(3)], [withOwner(1), withOwner(3), withOwner(5), fixtureVideo(2), fixtureVideo(2)]] });

for (const language of ['en', 'es']) await test(`large text ${language}: both feedback entries and UP confirmation fit and translate`, async ({ page, calls }) => {
  await ready(page); await openMenu(page); await assertMenuFits(page);
  await screenshot(page, `large-text-${language}-two-entry-menu`);
  const authorLabel = language === 'en' ? 'Not interested: creator' : 'No me interesa: este creador';
  const videoLabel = language === 'en' ? 'Not interested: this video' : 'No me interesa: este vídeo';
  await menuItem(page, videoLabel).waitFor(); await choose(page, authorLabel);
  await screenshot(page, `large-text-${language}-up-confirmation`);
  const copy = await menu(page).innerText();
  assert.ok(!/[\u4e00-\u9fff]/.test(copy.replace(fixtureVideo(1).title, '')), 'UP copy translated');
  assert.match(copy, language === 'en' ? /account/ : /cuenta/);
  assert.match(copy, language === 'en' ? /does not block/ : /No bloquea/);
  assert.ok(!copy.includes(language === 'en' ? 'all accounts on this device' : 'todas las cuentas de este dispositivo'), 'UP scope is not device-wide');
  await assertMenuFits(page); assert.equal(calls.feedback.length, 0); await close(page);
}, { auth: true, language, scale: 1.25, items: authorItems() });

await test('native cookie echo without account UID does not refetch recommendations indefinitely', async ({ page, calls }) => {
  await page.waitForTimeout(350);
  assert.ok(calls.feed <= 2, `same-cookie native responses must not loop the feed; saw ${calls.feed} requests`);
  await ready(page);
  const before = calls.feed;
  const echoBefore = await page.evaluate(() => window.__feedbackNative.echoes);
  await page.evaluate(async () => {
    const client = await import('/src/api/client.js');
    for (let i = 0; i < 3; i++) await client.apiFetch('/x/web-interface/history/cursor');
  });
  await page.waitForTimeout(400);
  assert.equal(calls.feed, before, 'ordinary native fetch cookie echoes do not reload the unsupported-UID feed');
  assert.ok(await page.evaluate(() => window.__feedbackNative.echoes) >= echoBefore + 3);
  assert.equal(await page.evaluate(() => window.__feedbackNative.overflow), false);
  assert.equal(await page.evaluate(() => window.__appStorage.getAuth().DedeUserID), undefined);
  await shown(page); await openMenu(page); await interest(page, true);
  assert.match(await menu(page).innerText(), /缺少.*账号标识/);
  assert.equal(await menuItem(page, '确认对 UP 不感兴趣').count(), 0);
  assert.equal(await menuItem(page, '在本机隐藏此 UP').count(), 0);
  assert.equal(calls.feedback.length, 0); assert.equal(calls.cancel.length, 0); await close(page);
}, { auth: true, noUid: true, nativeCookieEcho: true });

await browser.close();
const failed = reports.filter(report => !report.pass).length;
console.log(`${reports.length - failed}/${reports.length} passed; ${baseline ? 'positive control' : 'evidence'}: ${output}`);
process.exitCode = !reports.length ? 1 : baseline ? 0 : failed ? 1 : 0;
