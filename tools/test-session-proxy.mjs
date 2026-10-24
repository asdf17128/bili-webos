// Local regression: real React UI + service.js + HTTP proxy, fixture upstream.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { serviceFixture, fakeAuth } from './fixtures/service-session.mjs';

const output = process.env.SESSION_OUTPUT || '/tmp/bili-session-proxy';
const baseline = process.argv.includes('--baseline');
const url = process.env.UX_URL || 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
const eventually = async (fn, message) => {
  const until = Date.now() + 5000;
  while (Date.now() < until) { if (await fn()) return; await new Promise(r => setTimeout(r, 20)); }
  assert.fail(message);
};
async function run(name, options, fn) {
  if (process.env.SESSION_FILTER && !new RegExp(process.env.SESSION_FILTER).test(name)) return;
  const f = await serviceFixture(options);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.addInitScript(({ auth, transport }) => {
    if (!sessionStorage.getItem('fixture-seeded')) {
      if (auth) localStorage.setItem('bili_auth', JSON.stringify(auth));
      localStorage.setItem('bili_settings', JSON.stringify({ language: 'zh', gridCols: 3 }));
      localStorage.setItem('bili_perfopt', JSON.stringify({ warmPlayer: false, prefetchPage: false }));
      sessionStorage.setItem('fixture-seeded', '1');
    }
    if (transport === 'proxy') {
      localStorage.setItem('bili_proxyUrl', JSON.stringify('http://127.0.0.1:9527'));
      delete window.PalmServiceBridge; return;
    }
    if (transport === 'bridge') { delete window.PalmServiceBridge; return; }
    window.PalmServiceBridge = function () {};
    const webOS = { service: { request(uri, options) {
      let cancelled = false;
      fetch('http://127.0.0.1:19528/luna/' + options.method, { method: 'POST', body: JSON.stringify(options.parameters || {}) })
        .then(r => r.json()).then(r => { if (!cancelled) (r.returnValue === false ? options.onFailure : options.onSuccess)?.(r); })
        .catch(e => { if (!cancelled) options.onFailure?.({ errorText: e.message }); });
      return { cancel() { cancelled = true; } };
    } } };
    Object.defineProperty(window, 'webOS', { configurable: true, get: () => webOS, set() {} });
  }, { auth: options.loggedIn === false ? null : fakeAuth, transport: options.transport });
  const page = await context.newPage(); page.setDefaultTimeout(5500);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (options.transport === 'proxy' && u.port === '9528') return route.abort();
    if (options.transport === 'proxy' && u.port === '9527') {
      if (u.pathname === '/cookies/clear') {
        const r = await f.call('clearCookies');
        return route.fulfill({ contentType: 'application/json', status: r.returnValue ? 200 : 500, body: JSON.stringify({ ok: r.returnValue }) });
      }
      const r = await f.call('fetch', { url: 'https://' + u.pathname.slice(7) + u.search });
      return route.fulfill({ contentType: r.contentType || 'application/json', headers: { 'X-Set-Cookie': JSON.stringify(r.newCookies || {}) }, body: r.body || '' });
    }
    if (u.port === '9528' && options.transport === 'bridge' && u.pathname === '/ping') return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    if (u.port === '19528' || (u.port === '9528' && options.transport === 'bridge')) {
      const result = await f.call(u.pathname.split('/').pop(), JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) }).catch(() => {}); return;
    }
    if (u.origin === new URL(url).origin || (u.hostname === '127.0.0.1' && (u.port === String(f.port) || u.port === '7654'))) return route.continue();
    return route.abort();
  });
  try {
    await fn({ f, page, context });
    assert.deepEqual(errors, []);
    results.push({ name, pass: true }); console.log('PASS', name);
  } catch (e) {
    results.push({ name, pass: false, error: e.message }); console.log('FAIL', name, e.message.split('\n')[0]);
    await page.screenshot({ path: `${output}/failure-${results.length}.png` });
  } finally { f.release(); await context.close(); await f.close(); }
}
const openSettings = async page => {
  await page.goto(url); await page.locator('.video-card').first().waitFor();
  await page.locator('.sidebar-item').filter({ hasText: '设置' }).click();
  await page.getByText('退出登录', { exact: true }).waitFor();
};

await run('account repair is remote reachable and opening it preserves login', {}, async ({f,page})=>{
  await openSettings(page);
  await page.locator('[data-focus-id="content-10-0"]').hover();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
  assert.match(await page.locator('.settings-row.focused').innerText(),/账号修复/);
  await page.keyboard.press('Enter');
  await page.getByText('检查账号',{exact:true}).waitFor();
  assert.equal((await f.call('getCookies')).cookies.SESSDATA,fakeAuth.SESSDATA);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('bili_auth')).SESSDATA),fakeAuth.SESSDATA);
});

await run('logout clears service, persisted disk, UI and reload', {}, async ({ f, page }) => {
  await openSettings(page);
  await page.getByText('退出登录', { exact: true }).click();
  await page.getByText('已退出登录', { exact: true }).waitFor();
  const diag = await f.call('getDiagnostics');
  assert.equal(diag.loggedIn, false, 'service still logged in');
  assert.equal(JSON.parse(f.disk.get(f.cookieFile)).SESSDATA, undefined);
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('bili_auth') || '{}').SESSDATA);
  await page.waitForFunction(() => [...document.querySelectorAll('.video-card-title')].some(e => e.textContent.startsWith('Guest')));
  await page.reload(); await page.locator('.video-card').first().waitFor();
  assert.equal(await page.getByText('Fixture account', { exact: true }).count(), 0);
  await page.locator('.sidebar-item').filter({ hasText: '关注' }).click();
  await page.getByText('扫码登录', { exact: true }).waitFor();
  assert.equal(f.state.clears, 1);
});

await run('logout fences late service Set-Cookie and response body', {}, async ({ f }) => {
  f.state.hold = '/late-cookie';
  const pending = f.call('fetch', { url: 'https://api.bilibili.com/late-cookie' });
  await eventually(() => f.state.held.length === 1, 'upstream did not receive request');
  await f.call('clearCookies'); f.release();
  const result = await pending;
  assert.equal((await f.call('getDiagnostics')).loggedIn, false, 'late response restored service login');
  assert.equal(result.returnValue, false, 'old account response was delivered');
  assert.equal(JSON.parse(f.disk.get(f.cookieFile)).SESSDATA, undefined);
});

await run('logout disk failure is visible and retry clears credentials', {}, async ({ f, page }) => {
  await openSettings(page); f.state.failSave = true;
  await page.getByText('退出登录', { exact: true }).click();
  await page.getByText('退出登录失败，请重试', { exact: true }).waitFor();
  assert.equal(await page.getByText('已退出登录', { exact: true }).count(), 0);
  f.state.failSave = false;
  await page.getByText('退出登录', { exact: true }).click();
  await page.getByText('已退出登录', { exact: true }).waitFor();
  assert.equal((await f.call('getDiagnostics')).loggedIn, false);
  assert.equal(JSON.parse(f.disk.get(f.cookieFile)).SESSDATA, undefined);
});

await run('development bridge reports clear failure and uses the real service on retry', { transport: 'bridge' }, async ({ f, page }) => {
  await openSettings(page); f.state.failSave = true;
  await page.getByText('退出登录', { exact: true }).click();
  await page.getByText('退出登录失败，请重试', { exact: true }).waitFor();
  f.state.failSave = false;
  await page.getByText('退出登录', { exact: true }).click();
  await page.getByText('已退出登录', { exact: true }).waitFor();
  assert.equal(f.state.clears, 2);
  assert.equal((await f.call('getDiagnostics')).loggedIn, false);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bili_auth') || '{}').SESSDATA), undefined);
});

await run('browser fallback logout uses POST clear and does not accept failure', { transport: 'proxy' }, async ({ f, page }) => {
  await openSettings(page); f.state.failSave = true;
  const methods = [];
  page.on('request', r => { if (r.url().endsWith('/cookies/clear')) methods.push(r.method()); });
  await page.getByText('退出登录', { exact: true }).click();
  await page.getByText('退出登录失败，请重试', { exact: true }).waitFor();
  f.state.failSave = false;
  await page.getByText('退出登录', { exact: true }).click();
  await page.getByText('已退出登录', { exact: true }).waitFor();
  assert.deepEqual(methods, ['POST', 'POST']);
  assert.equal((await f.call('getDiagnostics')).loggedIn, false);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bili_auth') || '{}').SESSDATA), undefined);
});

await run('late Luna reply cannot restore browser credentials', {}, async ({ f, page }) => {
  await openSettings(page);
  let deliver, captured = false;
  await page.route('**/luna/fetch', async route => {
    const payload = JSON.parse(route.request().postData());
    if (!payload.url.includes('/late-cookie')) return route.fallback();
    const response = await f.call('fetch', payload);
    captured = true;
    await new Promise(resolve => { deliver = resolve; });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.evaluate(async () => {
    const api = await import(performance.getEntriesByType('resource').find(r => /\/src\/api\/client\.js(?:\?|$)/.test(r.name)).name);
    api.apiFetch('/late-cookie').then(() => window.__lateResult = 'accepted', e => window.__lateResult = e.message);
  });
  await eventually(() => captured, 'response was not captured');
  await page.getByText('退出登录', { exact: true }).click();
  await page.getByText('已退出登录', { exact: true }).waitFor();
  deliver();
  await page.waitForFunction(() => window.__lateResult);
  assert.equal(await page.evaluate(() => window.__lateResult), 'Account session changed');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bili_auth') || '{}').SESSDATA), undefined);
});

await run('logout pending blocks writes, repeated OK, and times out with retry', {}, async ({ f, page }) => {
  await openSettings(page);
  await page.evaluate(async () => {
    window.__fixtureApi = await import(performance.getEntriesByType('resource').find(r => /\/src\/api\/client\.js(?:\?|$)/.test(r.name)).name);
  });
  await page.clock.install();
  let held = 0;
  await page.route('**/luna/clearCookies', route => { held++; /* simulate missing Luna response */ });
  await page.getByText('退出登录', { exact: true }).click();
  await page.getByText('正在退出登录…', { exact: true }).waitFor();
  await page.keyboard.press('Enter');
  await eventually(() => held === 1, 'logout request missing');
  const blocked = await page.evaluate(async () => {
    const api = window.__fixtureApi;
    try { await api.apiFetch('/x/relation/modify', {}, { method: 'POST' }); return false; }
    catch { return true; }
  });
  assert.equal(blocked, true);
  assert.equal(f.state.requests.some(r => r.path.includes('/relation/modify')), false);
  await page.clock.fastForward(10001);
  await page.getByText('退出登录失败，请重试', { exact: true }).waitFor();
  assert.equal(held, 1);
  await page.unroute('**/luna/clearCookies');
  await page.getByText('退出登录', { exact: true }).click();
  await page.getByText('已退出登录', { exact: true }).waitFor();
  assert.equal((await f.call('getDiagnostics')).loggedIn, false);
});

await run('startup rejects invalid port and remote Enter retries', { loggedIn: false }, async ({ f, page }) => {
  await page.route('**/luna/ping', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ returnValue: true, localProxyPort: 0 }) }));
  await page.goto(url);
  await page.getByText('连接服务失败，请重试', { exact: true }).waitFor();
  assert.equal(await page.locator('.video-card').count(), 0);
  await page.unroute('**/luna/ping');
  await page.keyboard.press('Enter');
  await page.locator('.video-card').first().waitFor();
  assert.equal((await f.call('ping')).localProxyPort, f.port);
});

await run('occupied 7654 uses negotiated port for covers and video Range', { occupied: true, loggedIn: false }, async ({ f, page }) => {
  assert.equal(f.port, 7655);
  await page.goto(url); await page.locator('.video-card').first().waitFor();
  await page.waitForFunction(() => { const img = document.querySelector('.video-card img'); return img && img.complete && img.naturalWidth > 0; });
  const src = await page.locator('.video-card img').first().getAttribute('src');
  assert.equal(new URL(src).port, String(f.port));
  const range = await page.evaluate(async () => {
    const { mediaProxyBase, getServiceDiagnostics } = await import(performance.getEntriesByType('resource').find(r => /\/src\/api\/client\.js(?:\?|$)/.test(r.name)).name);
    const r = await fetch(mediaProxyBase() + '/proxy/upos-sz-static.bilivideo.com/fixture-video', { headers: { Range: 'bytes=0-3' } });
    return { status: r.status, range: r.headers.get('Content-Range'), bytes: (await r.arrayBuffer()).byteLength, diag: (await getServiceDiagnostics()).localProxyPort };
  });
  assert.deepEqual(range, { status: 206, range: 'bytes 0-3/4', bytes: 4, diag: 7655 });
  assert.equal(f.wrongPortHits(), 0, 'requests reached occupied stale proxy');
  await page.waitForFunction(() => {
    const img = document.querySelector('.video-card img');
    return img && img.classList.contains('image-ready') && Number(getComputedStyle(img).opacity) === 1;
  });
  await page.screenshot({ path: `${output}/negotiated-covers.png` });
});

await writeFile(`${output}/${baseline ? 'before' : 'after'}.json`, JSON.stringify(results, null, 2));
await browser.close();
console.log(`${results.filter(r => r.pass).length}/${results.length} passed; ${output}`);
process.exitCode = baseline ? 0 : results.some(r => !r.pass) ? 1 : 0;
