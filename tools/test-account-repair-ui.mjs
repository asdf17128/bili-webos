// Real React + trusted Chromium input; all account data and service replies are
// synthetic. Every non-Vite HTTP/WebSocket request is intercepted, service
// workers are blocked, and this script never connects to a television.
// ACCOUNT_REPAIR_BASE_URL, ACCOUNT_REPAIR_TEST_OUTPUT, ACCOUNT_REPAIR_FILTER.
// --baseline defaults to the entry-presence case and retains expected failures.
// --controlled-unarmed reintroduces the old input bug in one browser module
// response per context; never changes repository source. Use a focused filter.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.ACCOUNT_REPAIR_BASE_URL || 'http://127.0.0.1:5173';
const viteOrigin = new URL(baseUrl).origin;
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname), 'Only a loopback Vite server is allowed');
const output = process.env.ACCOUNT_REPAIR_TEST_OUTPUT || '/tmp/bili-account-repair-ui';
const baseline = process.argv.includes('--baseline');
const controlledUnarmed = process.argv.includes('--controlled-unarmed');
const filter = process.env.ACCOUNT_REPAIR_FILTER ? new RegExp(process.env.ACCOUNT_REPAIR_FILTER) : baseline ? /^feature presence:/ : null;
const sentinel = 'SYNTHETIC_PRIVATE_REPAIR_SENTINEL';
const fakeAuth = { SESSDATA: sentinel + '_session', bili_jct: sentinel + '_csrf', DedeUserID: '740000001', buvid3: sentinel + '_old3', buvid4: sentinel + '_old4', b_nut: '1700000000' };
const protectedKeys = ['bili_auth', 'bili_settings', 'bili_progress', 'bili_hiddenRecommendations', 'bili_searchHistory', 'bili_recentLive'];
const labels = {
  zh: { settings: '设置', entry: '账号修复', check: '检查账号', refresh: '刷新临时缓存', device: '重建设备标识', confirm: '确认重建设备标识', cancel: '取消', qr: '重新扫码登录', close: '关闭' },
  en: { settings: 'Settings', entry: 'Account repair', check: 'Check account', refresh: 'Refresh temporary cache', device: 'Rebuild device identity', confirm: 'Confirm device identity rebuild', cancel: 'Cancel', qr: 'Sign in again by QR', close: 'Close' },
  es: { settings: 'Ajustes', entry: 'Reparación de cuenta', check: 'Comprobar cuenta', refresh: 'Actualizar caché temporal', device: 'Renovar identidad del dispositivo', confirm: 'Confirmar nueva identidad', cancel: 'Cancelar', qr: 'Volver a acceder con QR', close: 'Cerrar' },
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeName = name => name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/-$/, '');
const dialog = page => page.locator('.account-repair-dialog');
const actions = page => page.locator('.account-repair-action');
const action = (page, label) => actions(page).filter({ hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') });
const browser = await chromium.launch({ headless: true });
const reports = [];
await mkdir(output, { recursive: true });

async function poll(fn, message, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(25); }
  assert.fail(message);
}
async function paint(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function takeScreenshot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await paint(page);
  if (await dialog(page).count()) await dialog(page).screenshot({ path: `${output}/${name}.png` });
  else await page.screenshot({ path: `${output}/${name}.png` });
}
async function fitsScreen(page) {
  const metrics = await dialog(page).evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, overflow: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1, actions: [...el.querySelectorAll('.account-repair-action')].map(a => ({ text: a.innerText, clipped: a.scrollWidth > a.clientWidth + 1, rect: a.getBoundingClientRect().toJSON() })) };
  });
  assert.ok(metrics.x >= 0 && metrics.y >= 0 && metrics.right <= 1921 && metrics.bottom <= 1081, JSON.stringify(metrics));
  assert.equal(metrics.overflow, false, JSON.stringify(metrics));
  assert.ok(metrics.actions.every(a => !a.clipped && a.rect.bottom <= 1081), JSON.stringify(metrics));
}
async function snapshot(page) { return page.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), protectedKeys); }
async function preserved(f, before, dropStaleDeviceCache = false) {
  const expected = { ...before };
  if (dropStaleDeviceCache) {
    const auth = JSON.parse(expected.bili_auth);
    delete auth.buvid3; delete auth.buvid4; delete auth.b_nut;
    expected.bili_auth = JSON.stringify(auth);
  }
  assert.deepEqual(await snapshot(f.page), expected, 'account, preferences and history are preserved; only stale identity cache may be dropped after a dispatched repair');
  assert.deepEqual(f.calls.forbiddenWrites, [], 'no clearCookies, setCookies, cookie POST, finger/spi, or unrelated account write');
}
async function safePanel(page) {
  const text = await dialog(page).innerText();
  for (const value of [sentinel, ...Object.values(fakeAuth), 'fixture-voucher', 'fixture-signed-url']) assert.ok(!text.includes(value), 'repair panel must not expose raw account, identity, or upstream fields');
}
async function choose(page, label) {
  const target = action(page, label);
  await target.waitFor();
  await target.hover();
  await page.keyboard.press('Enter');
}
async function close(page) {
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'detached' });
  await poll(async () => await page.evaluate(() => window.__focusState?.().current) === 'content-13-0', 'focus returns to the real account repair entry');
  assert.equal(await page.locator('[data-focus-id].focused').count(), 1, 'one actual focus target after closing');
}
async function settings(f) {
  await f.page.locator('.browse-page .video-card').first().waitFor();
  await f.page.locator('.sidebar-item').filter({ hasText: f.labels.settings }).click();
  await f.page.locator('.config-page, .settings-page').first().waitFor();
}
async function open(f) {
  await settings(f);
  const entry = f.page.locator('[data-focus-id="content-13-0"]');
  await entry.waitFor();
  await entry.hover(); await f.page.keyboard.press('Enter');
  await dialog(f.page).waitFor();
  await safePanel(f.page);
}
async function check(f) {
  const count = f.calls.status.length;
  await choose(f.page, f.labels.check);
  await poll(() => f.calls.status.length === count + 1, 'manual check reaches service status once');
  await poll(async () => (await actions(f.page).filter({ hasText: f.labels.device }).getAttribute('aria-disabled')) !== 'true', 'manual check completes and device action becomes available');
  await paint(f.page);
}
async function confirmation(f) {
  await check(f);
  await choose(f.page, f.labels.device);
  await action(f.page, f.labels.confirm).waitFor();
}

async function fixture(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
  const calls = { methods: [], nav: 0, status: [], repair: [], completedRepairResponses: 0, forbiddenWrites: [], blockedRequests: 0, blockedSockets: 0, documents: 0, translations: 0, controlledReplacements: 0 };
  const controls = { statusMode: options.statusMode || 'success', status: { returnValue: true, supported: true, hasDeviceIdentity: true, hasAccount: true, busy: false, retryAfterSeconds: 0, ...options.status }, repairMode: options.repairMode || 'success', navMode: 'success', held: [] };
  const release = () => controls.held.splice(0).forEach(resolve => resolve());
  await context.addInitScript(({ auth, options, sentinel }) => {
    if (!/^https?:$/.test(location.protocol)) return;
    if (!sessionStorage.getItem('account-repair-fixture')) {
      sessionStorage.setItem('account-repair-fixture', '1');
      localStorage.setItem('bili_auth', JSON.stringify(auth));
      localStorage.setItem('bili_settings', JSON.stringify({ language: options.language || 'zh', uiScale: options.scale || 1, gridCols: 3, quality: 80, subtitle: true }));
      localStorage.setItem('bili_perfopt', JSON.stringify({ warmPlayer: false, prefetchPage: false }));
      localStorage.setItem('bili_proxyUrl', JSON.stringify('http://127.0.0.1:9527'));
      localStorage.setItem('bili_progress', JSON.stringify({ BV_SYNTHETIC: [120, 600, 1] }));
      localStorage.setItem('bili_hiddenRecommendations', JSON.stringify({ version: 1, items: [] }));
      localStorage.setItem('bili_searchHistory', JSON.stringify(['synthetic prior search']));
      localStorage.setItem('bili_recentLive', JSON.stringify([]));
    }
    window.__repairInput = { keydown: 0, keyup: 0, clicks: 0, repeats: 0, untrusted: 0 };
    ['keydown', 'keyup', 'click'].forEach(type => window.addEventListener(type, e => {
      if (!e.isTrusted) window.__repairInput.untrusted++;
      else if (type === 'click') window.__repairInput.clicks++;
      else { window.__repairInput[type]++; if (e.repeat) window.__repairInput.repeats++; }
    }, true));
    if (options.transport === 'bridge' || options.transport === 'proxy') { delete window.PalmServiceBridge; return; }
    // Keep the shipped webOSTV SDK, including returnValue/errorCode callback
    // dispatch and cancel behavior. Replace only its native Palm bridge.
    window.PalmServiceBridge = function () {
      let cancelled = false;
      this.call = (uri, payload) => {
        fetch('http://127.0.0.1:19529/luna/' + uri.split('/').pop(), { method: 'POST', body: payload })
          .then(r => r.json()).then(response => { if (!cancelled) this.onservicecallback?.(JSON.stringify(response)); })
          .catch(() => { if (!cancelled) this.onservicecallback?.(JSON.stringify({ returnValue: false, errorCode: -1, errorText: sentinel })); });
      };
      this.cancel = () => { cancelled = true; };
    };
  }, { auth: fakeAuth, options, sentinel });
  await context.routeWebSocket('**/*', ws => {
    if (new URL(ws.url()).host === new URL(baseUrl).host) ws.connectToServer();
    else { calls.blockedSockets++; ws.close(); }
  });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', e => errors.push(e.stack || e.message));
  const hotUpdates = [];
  page.on('console', message => { const value = message.text(); if (/\[vite\].*(hot updated|page reload|invalidate)/.test(value)) hotUpdates.push(value); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) calls.documents++; });
  const fulfill = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' } }).catch(() => {});
  function apiBody(url, method, formBody = '') {
    const parsed = new URL(url), path = parsed.pathname;
    // Multilingual home cards use this read-only translation POST. Fulfill its
    // exact known endpoint locally instead of classifying all POSTs as writes.
    if (parsed.hostname === 'translate.googleapis.com' && path === '/translate_a/t' && method === 'POST') {
      calls.translations++;
      return new URLSearchParams(formBody).getAll('q').map((value, index) => 'Synthetic translation ' + index);
    }
    if (method !== 'GET' || path.includes('/finger/spi')) calls.forbiddenWrites.push(path);
    if (path.endsWith('/nav')) {
      calls.nav++;
      if (controls.navMode === 'invalid') return { code: -101, message: sentinel };
      if (controls.navMode === 'risk') return { code: -352, message: sentinel, voucher: 'fixture-voucher', signedUrl: 'fixture-signed-url' };
      return { code: 0, data: { isLogin: true, mid: 740000001, uname: 'Synthetic account', wbi_img: { img_url: 'https://fixture.invalid/abcdefghijklmnopqrstuvwxyz123456.png', sub_url: 'https://fixture.invalid/123456abcdefghijklmnopqrstuvwxyz.png' }, secret: sentinel } };
    }
    if (path.includes('/top/feed/rcmd') || path.endsWith('/popular')) {
      const items = Array.from({ length: 6 }, (_, i) => ({ bvid: 'BV_REPAIR_' + i, aid: 830000 + i, id: 830000 + i, goto: 'av', title: 'Synthetic video ' + i, pic: 'https://fixture.invalid/repair-cover.svg', duration: 600, owner: { mid: 740000100 + i, name: 'Synthetic creator' }, stat: { view: 100 } }));
      return { code: 0, data: { item: items, list: items } };
    }
    if (path.endsWith('/version.json')) return { version: '2.4.0' };
    if (path.endsWith('/releases/latest')) return { tag_name: 'v2.4.0' };
    if (path.endsWith('/qrcode/generate')) return { code: 0, data: { url: 'https://example.invalid/synthetic-login', qrcode_key: 'synthetic-key' } };
    if (path.endsWith('/qrcode/poll')) return { code: 0, data: { code: 86101 } };
    return { code: 0, data: { list: [] } };
  }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === viteOrigin) {
      if (controlledUnarmed && url.pathname === '/src/components/AccountRepairPanel.jsx') {
        const response = await route.fetch(), source = await response.text();
        const pattern = /armed = useRef\(true\)/g;
        if ((source.match(pattern) || []).length !== 1) {
          errors.push('Controlled reintroduction requires exactly one armed = useRef(true) match');
          return route.abort();
        }
        calls.controlledReplacements++;
        return route.fulfill({ response, body: source.replace(pattern, 'armed = useRef(false)') });
      }
      return route.continue();
    }
    calls.blockedRequests++;
    if (request.method() === 'OPTIONS') return fulfill(route, {});
    if (url.pathname.endsWith('/repair-cover.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#274959"/></svg>' });
    if (url.port === '9528' && options.transport !== 'bridge') return route.abort();
    if (url.port === '9528' && url.pathname === '/ping') return fulfill(route, { ok: true });
    if ((url.port === '19529' || url.port === '9528') && url.pathname.startsWith('/luna/')) {
      const method = url.pathname.split('/').pop(), payload = JSON.parse(request.postData() || '{}');
      calls.methods.push(method);
      if (method === 'fetch') {
        const apiUrl = new URL(payload.url);
        if (apiUrl.pathname.endsWith('/nav') && controls.navMode === 'network') return route.abort('failed');
        return fulfill(route, { returnValue: true, status: 200, contentType: 'application/json', body: JSON.stringify(apiBody(payload.url, payload.method || 'GET', payload.body || '')) });
      }
      if (method === 'getAccountRepairStatus') {
        calls.status.push({ ...payload });
        if (controls.statusMode === 'pending') await new Promise(resolve => controls.held.push(resolve));
        if (controls.statusMode === 'network') return route.abort('failed');
        if (controls.statusMode === 'unsupported') return fulfill(route, { returnValue: false, errorCode: -32601, errorText: 'Unknown method ' + sentinel });
        return fulfill(route, { ...controls.status, secret: sentinel, account: fakeAuth, voucher: 'fixture-voucher' });
      }
      if (method === 'repairDeviceIdentity') {
        calls.repair.push({ ...payload });
        if (controls.repairMode === 'pending') await new Promise(resolve => controls.held.push(resolve));
        if (controls.repairMode === 'network') return route.abort('failed');
        if (controls.repairMode !== 'success' && controls.repairMode !== 'pending') return fulfill(route, { returnValue: false, errorCode: controls.repairMode, errorText: sentinel, error: sentinel, retryAfterSeconds: 600 });
        await fulfill(route, { returnValue: true, changed: true, accountPreserved: true, cookies: fakeAuth, secret: sentinel });
        calls.completedRepairResponses++;
        return;
      }
      if (['clearCookies', 'setCookies'].includes(method)) calls.forbiddenWrites.push(method);
      if (method === 'ping') return fulfill(route, { returnValue: true, localProxyPort: 7654 });
      return fulfill(route, { returnValue: true });
    }
    if (url.pathname.startsWith('/proxy/')) return fulfill(route, apiBody('https://' + url.pathname.slice(7) + url.search, request.method(), request.postData() || ''));
    if (request.method() !== 'GET' || /\/cookies(?:\/clear)?$/.test(url.pathname)) calls.forbiddenWrites.push(url.pathname);
    if (url.hostname === 'api.github.com') return fulfill(route, { tag_name: 'v2.4.0' });
    return route.abort();
  });
  await page.goto(baseUrl);
  return { page, context, calls, controls, release, errors, hotUpdates, labels: labels[options.language || 'zh'], options };
}

async function test(name, fn, options = {}) {
  if (filter && !filter.test(name)) return;
  let f; const started = Date.now();
  try {
    f = await fixture(options); await fn(f);
    assert.deepEqual(f.errors, [], 'no uncaught browser errors');
    assert.equal(f.calls.controlledReplacements, controlledUnarmed ? 1 : 0, 'controlled reintroduction must replace exactly one module response per page; normal runs do not modify source');
    assert.deepEqual(f.hotUpdates, [], 'test source must remain frozen throughout the browser scenario');
    const input = await f.page.evaluate(() => window.__repairInput);
    assert.equal(input.untrusted, 0, 'all keyboard/mouse input is trusted');
    assert.deepEqual(f.calls.forbiddenWrites, [], 'no unrelated service/account writes');
    for (const payload of f.calls.status) assert.deepEqual(payload, {}, 'status reads never carry account data');
    for (const payload of f.calls.repair) assert.deepEqual(payload, { confirm: true }, 'repair payload contains explicit consent only');
    reports.push({ name, pass: true, durationMs: Date.now() - started, audit: { navCalls: f.calls.nav, statusCalls: f.calls.status.length, repairCalls: f.calls.repair.length, forbiddenWrites: f.calls.forbiddenWrites.length, interceptedHttp: f.calls.blockedRequests, interceptedWebSockets: f.calls.blockedSockets, translations: f.calls.translations, documents: f.calls.documents, controlledReplacements: f.calls.controlledReplacements, input, hotUpdates: f.hotUpdates } });
    console.log('PASS', name);
  } catch (error) {
    const screenshot = `${baseline ? 'baseline' : 'failure'}-${safeName(name)}.png`;
    if (f) await takeScreenshot(f.page, screenshot.replace(/\.png$/, '')).catch(() => {});
    const diagnostics = f ? await f.page.evaluate(() => ({ focus: window.__focusState?.(), dialog: document.querySelector('.account-repair-dialog')?.innerText || null, input: window.__repairInput })).catch(() => null) : null;
    const audit = f ? { navCalls: f.calls.nav, statusCalls: f.calls.status.length, repairCalls: f.calls.repair.length, forbiddenWrites: f.calls.forbiddenWrites.length, interceptedHttp: f.calls.blockedRequests, interceptedWebSockets: f.calls.blockedSockets, controlledReplacements: f.calls.controlledReplacements } : null;
    reports.push({ name, pass: false, durationMs: Date.now() - started, error: error.message, screenshot, browserErrors: f?.errors, hotUpdates: f?.hotUpdates, audit, diagnostics });
    console.log('FAIL', name, error.message.split('\n')[0]);
  } finally {
    if (f) { f.release(); await f.context.close(); }
    await writeFile(`${output}/results.json`, JSON.stringify({ baseUrl, baseline, controlledReintroduction: controlledUnarmed ? 'AccountRepairPanel armed=true replaced once with armed=false in its browser module response; repository source unchanged.' : null, boundary: 'Production React/client/controller; simulated Luna or bridge responses. Every non-Vite HTTP/WebSocket request intercepted; no real account, television, or service state used.', results: reports }, null, 2));
  }
}

await test('feature presence: settings remote navigation reaches account repair', async f => {
  await settings(f);
  await f.page.locator('[data-focus-id="content-0-0"]').hover();
  for (let i = 0; i < 13; i++) await f.page.keyboard.press('ArrowDown');
  assert.equal(await f.page.evaluate(() => window.__focusState().current), 'content-13-0');
  await f.page.keyboard.press('Enter'); await dialog(f.page).waitFor();
  for (const key of ['check', 'refresh', 'device', 'qr', 'close']) await action(f.page, f.labels[key]).waitFor();
  assert.equal(f.calls.status.length, 0); assert.equal(f.calls.repair.length, 0);
  await takeScreenshot(f.page, 'account-repair-initial'); await close(f.page);
});

await test('opening is inert and Back restores a usable settings focus', async f => {
  await settings(f); const before = await snapshot(f.page), nav = f.calls.nav;
  await f.page.locator('[data-focus-id="content-13-0"]').click(); await dialog(f.page).waitFor();
  await paint(f.page); assert.equal(f.calls.nav, nav); assert.equal(f.calls.status.length, 0); assert.equal(f.calls.repair.length, 0);
  await preserved(f, before); await safePanel(f.page); await close(f.page);
  await f.page.keyboard.press('ArrowUp'); assert.notEqual(await f.page.evaluate(() => window.__focusState().current), 'content-13-0');
});

await test('mouse opening accepts the first deliberate Enter check', async f => {
  await settings(f); await f.page.locator('[data-focus-id="content-13-0"]').click(); await dialog(f.page).waitFor();
  // The opener's pointer can land over a different action when the modal mounts.
  // Select the intended action explicitly before testing the first remote press.
  await action(f.page, f.labels.check).hover();
  assert.equal(await f.page.locator('.account-repair-action.focused').innerText(), f.labels.check);
  await f.page.keyboard.press('Enter');
  await poll(() => f.calls.status.length === 1, 'first deliberate Enter after mouse opening must check the account');
  assert.equal(f.calls.repair.length, 0);
});

await test('manual check and cache refresh preserve identity and account', async f => {
  await open(f); const before = await snapshot(f.page), nav = f.calls.nav;
  await check(f); assert.equal(f.calls.nav, nav + 1); await safePanel(f.page);
  const status = f.calls.status.length;
  await choose(f.page, f.labels.refresh); await poll(() => f.calls.status.length === status + 1, 'refresh rechecks service once');
  await paint(f.page); assert.equal(f.calls.nav, nav + 2); assert.equal(f.calls.repair.length, 0);
  await safePanel(f.page); await preserved(f, before); await takeScreenshot(f.page, 'account-repair-checked');
});

await test('device rebuild requires a completed supported identity check', async f => {
  await open(f); await choose(f.page, f.labels.device); await paint(f.page);
  assert.equal(await action(f.page, f.labels.confirm).count(), 0); assert.equal(f.calls.repair.length, 0); assert.equal(f.calls.status.length, 0);
});

await test('confirmation defaults to cancel and cancel performs zero writes', async f => {
  await open(f); const before = await snapshot(f.page); await confirmation(f);
  const text = await dialog(f.page).innerText();
  for (const re of [/登录/, /偏好|设置/, /失败.*旧值/, /不保证/, /只尝试一次|不会自动重试/]) assert.match(text, re);
  assert.equal(await f.page.locator('.account-repair-action.focused').innerText(), f.labels.cancel);
  await f.page.keyboard.press('Enter'); await action(f.page, f.labels.check).waitFor();
  assert.equal(f.calls.repair.length, 0); await preserved(f, before); await close(f.page);
});

await test('held Enter cannot pass through device confirmation', async f => {
  await open(f); await check(f); await action(f.page, f.labels.device).hover();
  await f.page.keyboard.down('Enter'); await action(f.page, f.labels.confirm).waitFor();
  for (let i = 0; i < 4; i++) await f.page.keyboard.down('Enter');
  await paint(f.page); assert.equal(f.calls.repair.length, 0);
  assert.equal(await action(f.page, f.labels.confirm).count(), 1, 'repeat keydown must not dismiss or commit the confirmation');
  await f.page.keyboard.up('Enter'); assert.ok(await f.page.evaluate(() => window.__repairInput.repeats) >= 4);
  await choose(f.page, f.labels.cancel); assert.equal(f.calls.repair.length, 0);
});

for (const transport of ['luna', 'bridge']) await test(`${transport} success uses exact confirmation payload and preserves browser state`, async f => {
  await open(f); const before = await snapshot(f.page); await confirmation(f);
  if (transport === 'luna') {
    await f.page.keyboard.press('ArrowDown');
    assert.equal(await f.page.locator('.account-repair-action.focused').innerText(), f.labels.confirm);
    await f.page.keyboard.press('Enter');
  } else await choose(f.page, f.labels.confirm);
  await poll(() => f.calls.repair.length === 1, 'one confirmed repair call');
  await poll(async () => /设备标识已更新/.test(await dialog(f.page).innerText()), 'successful rebuild reported');
  assert.deepEqual(f.calls.repair, [{ confirm: true }]); await safePanel(f.page); await preserved(f, before, true);
  assert.match(await dialog(f.page).innerText(), /不保证|未验证/);
  await takeScreenshot(f.page, `account-repair-success-${transport}`); await close(f.page);
}, { transport });

for (const code of ['REQUEST_FAILED', 'PERSISTENCE_FAILED', 'SESSION_CHANGED']) await test(`failure ${code} stays safe without automatic retry`, async f => {
  await open(f); const before = await snapshot(f.page); await confirmation(f); await choose(f.page, f.labels.confirm);
  await poll(() => f.calls.repair.length === 1, 'confirmed repair dispatched');
  await poll(async () => (code === 'SESSION_CHANGED' ? /账号状态已变化/ : /本次未更新设备标识，旧值已保留/).test(await dialog(f.page).innerText()), 'explicit service failure retains its fixed meaning through the native SDK');
  await paint(f.page); await safePanel(f.page); assert.equal(f.calls.repair.length, 1); await preserved(f, before);
  assert.doesNotMatch(await dialog(f.page).innerText(), /设备标识已更新|修复结果未知/);
}, { repairMode: code });

await test('lost repair transport reports unknown and drops only stale local identity', async f => {
  await open(f); const before = await snapshot(f.page); await confirmation(f); await choose(f.page, f.labels.confirm);
  await poll(async () => /修复结果未知/.test(await dialog(f.page).innerText()), 'lost response must not be reported as a confirmed failure');
  assert.equal(f.calls.repair.length, 1); assert.match(await dialog(f.page).innerText(), /不会自动重试/);
  assert.doesNotMatch(await dialog(f.page).innerText(), /旧值已保留|设备标识已更新/);
  await safePanel(f.page); await preserved(f, before, true);
}, { repairMode: 'network' });

await test('old service has no device confirmation or repair write', async f => {
  await open(f); await choose(f.page, f.labels.check); await poll(() => f.calls.status.length === 1, 'old status method called');
  await poll(async () => /不支持|升级|更新/.test(await dialog(f.page).innerText()), 'old service explanation visible');
  await choose(f.page, f.labels.device); assert.equal(await action(f.page, f.labels.confirm).count(), 0); assert.equal(f.calls.repair.length, 0); await safePanel(f.page);
}, { statusMode: 'unsupported' });

await test('missing identity can be repaired only after explicit confirmation', async f => {
  await open(f); const before = await snapshot(f.page); await confirmation(f);
  assert.equal(f.calls.repair.length, 0); await choose(f.page, f.labels.cancel); await preserved(f, before);
}, { status: { hasDeviceIdentity: false } });

await test('busy service and cooldown block duplicate rebuild requests', async f => {
  await open(f); await choose(f.page, f.labels.check); await poll(() => f.calls.status.length === 1, 'busy status received'); await paint(f.page);
  await action(f.page, f.labels.device).hover(); for (let i = 0; i < 4; i++) await f.page.keyboard.press('Enter');
  assert.equal(await action(f.page, f.labels.confirm).count(), 0); assert.equal(f.calls.repair.length, 0);
}, { status: { busy: true, retryAfterSeconds: 600 } });

await test('pending repair blocks repeated keys and timeout cannot claim success', async f => {
  await open(f); const before = await snapshot(f.page); await confirmation(f); await f.page.clock.install();
  await action(f.page, f.labels.confirm).hover(); await f.page.keyboard.down('Enter');
  await poll(() => f.calls.repair.length === 1, 'held repair dispatched');
  for (let i = 0; i < 5; i++) await f.page.keyboard.down('Enter');
  await f.page.keyboard.up('Enter'); assert.equal(f.calls.repair.length, 1);
  await f.page.clock.fastForward(20001);
  await poll(async () => /未知|超时/.test(await dialog(f.page).innerText()), 'timeout explains unknown outcome');
  await safePanel(f.page); assert.equal(f.calls.repair.length, 1); await preserved(f, before, true);
  assert.doesNotMatch(await dialog(f.page).innerText(), /设备标识已更新/);
  // Native SDK cancel may suppress delivery entirely. This checks the UI and
  // transport boundary; controller late-promise behavior has separate unit tests.
  f.release(); await poll(() => f.calls.completedRepairResponses === 1, 'late mock response was fulfilled');
  await f.page.clock.resume(); await paint(f.page);
  assert.doesNotMatch(await dialog(f.page).innerText(), /设备标识已更新/, 'late response must not replace timeout');
}, { repairMode: 'pending' });

await test('session generation change rejects a late successful repair reply', async f => {
  await open(f); const before = await snapshot(f.page); await confirmation(f); await choose(f.page, f.labels.confirm);
  await poll(() => f.calls.repair.length === 1, 'held repair dispatched');
  await f.page.evaluate(() => window.__appStorage.invalidateAuthRequests()); f.release();
  await poll(async () => /变化|改变|重新检查/.test(await dialog(f.page).innerText()), 'session change visible');
  assert.equal(f.calls.repair.length, 1); await safePanel(f.page); await preserved(f, before);
  assert.doesNotMatch(await dialog(f.page).innerText(), /设备标识已更新/);
}, { repairMode: 'pending' });

await test('nav network failure is visible without claiming account invalid', async f => {
  await open(f); f.controls.navMode = 'network'; await choose(f.page, f.labels.check);
  await poll(() => f.calls.status.length === 1, 'status still checked despite nav failure');
  await poll(async () => /未知|失败|无法|未完成|未确认/.test(await dialog(f.page).innerText()), 'nav read failure is explained');
  assert.doesNotMatch(await dialog(f.page).innerText(), /账号已封|账号被封|登录已失效/);
  assert.equal(f.calls.repair.length, 0); await safePanel(f.page);
});

await test('QR re-login first explains the choice and cancel does not log out', async f => {
  await open(f); const before = await snapshot(f.page); await choose(f.page, f.labels.qr);
  await action(f.page, f.labels.cancel).waitFor(); await safePanel(f.page);
  assert.match(await dialog(f.page).innerText(), /扫码|登录/); await choose(f.page, f.labels.cancel);
  await action(f.page, f.labels.check).waitFor(); await preserved(f, before); assert.equal(f.calls.repair.length, 0);
});

await test('confirmed QR guidance opens existing login then cancellation preserves the account', async f => {
  await open(f); const before = await snapshot(f.page); await choose(f.page, f.labels.qr);
  await action(f.page, '打开登录二维码').waitFor();
  assert.equal(await f.page.locator('.account-repair-action.focused').innerText(), f.labels.cancel);
  await choose(f.page, '打开登录二维码'); await f.page.locator('.login-page').waitFor();
  await f.page.getByText('请使用哔哩哔哩手机客户端扫描二维码', { exact: true }).waitFor();
  assert.equal(await dialog(f.page).count(), 0); await preserved(f, before);
  await f.page.keyboard.press('Escape'); await f.page.locator('.login-page').waitFor({ state: 'detached' });
  await preserved(f, before); assert.equal(f.calls.repair.length, 0);
});

for (const language of ['en', 'es']) await test(`large text ${language} main and confirmation fit screen`, async f => {
  await open(f); await fitsScreen(f.page); await takeScreenshot(f.page, `account-repair-${language}-large`);
  await confirmation(f);
  await takeScreenshot(f.page, `account-repair-${language}-confirmation-large`);
  assert.equal(await f.page.locator('.account-repair-action.focused').innerText(), f.labels.cancel, 'painted confirmation defaults to cancel even if the stationary pointer overlaps another new button');
  const text = await dialog(f.page).innerText(); assert.ok(!/[\u4e00-\u9fff]/.test(text), 'repair copy is translated');
  await fitsScreen(f.page);
  assert.equal(f.calls.repair.length, 0); await safePanel(f.page);
  await f.page.keyboard.press('Enter');
  await action(f.page, f.labels.check).waitFor();
  assert.equal(f.calls.repair.length, 0, 'the first fresh Enter cancels the confirmation without a device write');
}, { language, scale: 1.25 });

await browser.close();
const failed = reports.filter(r => !r.pass).length;
console.log(`${reports.length - failed}/${reports.length} passed; ${baseline ? 'positive control' : 'evidence'}: ${output}`);
process.exitCode = !reports.length ? 1 : baseline ? 0 : failed ? 1 : 0;
