// Real browser client/WBI modules, with transport boundaries replaced by fixtures.
// No TV, account, Bilibili endpoint or media URL is contacted.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.WBI_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.WBI_TEST_OUTPUT || '/tmp/bili-wbi-recovery';
const override = process.env.WBI_SOURCE ? await readFile(process.env.WBI_SOURCE, 'utf8') : null;
const now = 1702204169000;
const imgKey = '7cd084941338484aae1ad9425b84077c';
const subKey = '4932caff0ff746eab6f01bf08b70ac45';
// Independent fixed fixture oracle (not imported from the production signer).
const mixin = 'ea1db124af3c7062474693fa704f4ff8';
const validNav = { code: -101, data: { wbi_img: {
  img_url: 'https://fixture.invalid/' + imgKey + '.png',
  sub_url: 'https://fixture.invalid/' + subKey + '.png',
} } };
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const transport of ['proxy', 'bridge', 'luna']) {
    for (const mode of ['missing', 'html', 'network', 'risk', ...(transport === 'luna' ? ['session'] : [])]) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.routeWebSocket('**/*', socket => socket.close());
      const page = await context.newPage();
      const state = { nav: 0, playurl: 0, signatures: [], unexpected: [] };
      let releaseOldNav, markNavStarted;
      const navStarted = new Promise(resolve => { markNavStarted = resolve; });
      function reply(url) {
        const u = new URL(url);
        if (u.pathname.endsWith('/nav')) {
          state.nav++;
          if (state.nav === 1 && mode === 'session') {
            markNavStarted();
            return new Promise(resolve => { releaseOldNav = () => resolve({ json: validNav }); });
          }
          if (state.nav === 1 && mode !== 'risk') {
            if (mode === 'network') return { abort: true };
            if (mode === 'html') return { status: 503, html: '<html>fixture unavailable</html>' };
            return { json: { code: -352, data: {} } };
          }
          return { json: validNav };
        }
        if (u.pathname.endsWith('/playurl')) {
          state.playurl++;
          const query = u.search.slice(1).replace(/&w_rid=[^&]+$/, '');
          const expected = createHash('md5').update(query + mixin).digest('hex');
          const signed = u.searchParams.get('w_rid') === expected && u.searchParams.get('wts') === String(now / 1000);
          state.signatures.push(signed);
          return { json: { code: !signed ? -403 : mode === 'risk' ? -351 : 0,
            data: { fixtureAccepted: signed } } };
        }
        state.unexpected.push(u.pathname);
        return { abort: true };
      }
      function lunaResult(response) {
        return { returnValue: true, status: response.status || 200,
          body: response.html || JSON.stringify(response.json) };
      }
      await context.exposeBinding('__wbiFixture', (_source, method, url) => {
        if (method !== 'fetch') { state.unexpected.push('luna:' + method); return { abort: true }; }
        return reply(url);
      });
      await context.addInitScript(({ transport, now }) => {
        Date.now = () => now;
        localStorage.setItem('bili_proxyUrl', JSON.stringify('http://127.0.0.1:9527'));
        delete window.webOS;
        delete window.PalmServiceBridge;
        if (transport === 'luna') {
          window.PalmServiceBridge = function () {};
          window.webOS = { service: { request(_uri, options) {
            window.__wbiFixture(options.method, options.parameters.url).then(response => {
              if (response.abort) options.onFailure({ errorText: 'fixture network failure' });
              else options.onSuccess({ returnValue: true, status: response.status || 200,
                body: response.html || JSON.stringify(response.json) });
            });
            return { cancel() {} };
          } } };
        }
      }, { transport, now });
      await page.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.origin === base) {
          if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>WBI isolated fixture</title>' });
          if (override && u.pathname === '/src/api/wbi.js') return route.fulfill({ contentType: 'application/javascript', body: override });
          return route.continue();
        }
        if (transport !== 'luna' && u.hostname === '127.0.0.1' && u.port === '9528') {
          if (transport !== 'bridge') return route.abort();
          if (u.pathname === '/ping') return route.fulfill({ json: { ok: true } });
          if (u.pathname === '/luna/fetch') {
            const response = reply(route.request().postDataJSON().url);
            return response.abort ? route.abort() : route.fulfill({ json: lunaResult(response) });
          }
        }
        if (transport === 'proxy' && u.hostname === '127.0.0.1' && u.port === '9527') {
          const response = reply(u);
          if (response.abort) return route.abort();
          if (response.html) return route.fulfill({ status: response.status, contentType: 'text/html', body: response.html });
          return route.fulfill({ json: response.json });
        }
        state.unexpected.push(u.hostname + u.pathname);
        return route.abort();
      });
      try {
        await page.goto(base);
        const call = () => page.evaluate(async () => {
          const { getPlayUrl } = await import('/src/api/client.js');
          try { return { value: await getPlayUrl('BV1Synthetic', 2, 80) }; }
          catch (error) { return { error: error.message }; }
        });
        if (mode === 'session') {
          const oldRequest = call();
          await navStarted;
          await page.evaluate(async () => {
            const { storage } = await import('/src/utils/storage.js');
            storage.invalidateAuthRequests();
          });
          // Start the new generation while the old transport is still pending.
          // This exercises the same generation barrier used by logout without
          // touching any real account or making a clearCookies request.
          await page.evaluate(async () => {
            const { getPlayUrl } = await import('/src/api/client.js');
            window.__newGenerationResult = getPlayUrl('BV1Synthetic', 2, 80).then(
              value => ({ value }), error => ({ error: error.message }));
          });
          releaseOldNav();
          assert.equal((await oldRequest).error, 'Account session changed');
          assert.equal((await page.evaluate(() => window.__newGenerationResult)).value?.code, 0,
            'a pending old-generation nav must not fail the new-generation request');
          assert.equal(state.nav, 2);
          assert.equal(state.playurl, 1);
          assert.deepEqual(state.signatures, [true]);
        } else if (mode === 'risk') {
          const first = await call();
          assert.equal(first.value?.code, -351, 'real risk response is preserved');
          assert.equal(state.nav, 1);
          assert.equal(state.playurl, 1, 'no automatic playurl retry or identity reset');
          assert.deepEqual(state.signatures, [true]);
        } else {
          const first = await call();
          assert.ok(first.error, 'invalid nav must reject the request before signing');
          assert.equal(state.playurl, 0, 'invalid keys must not reach playurl');
          const second = await call();
          assert.equal(second.value?.code, 0, 'next independent attempt recovers with a valid signature');
          assert.equal(second.value?.data?.fixtureAccepted, true);
          assert.equal(state.nav, 2, 'invalid/nav failure was not cached');
          assert.equal((await call()).value?.code, 0);
          assert.equal(state.nav, 2, 'complete keys from anonymous code -101 remain cacheable');
          assert.equal(state.playurl, 2);
          assert.deepEqual(state.signatures, [true, true]);
        }
        assert.deepEqual(state.unexpected, [], 'all non-app requests stay within fixture boundaries');
        assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), {
          bili_proxyUrl: JSON.stringify('http://127.0.0.1:9527'),
        }, 'no auth, fingerprint or other local state changes');
        results.push({ transport, mode, pass: true, ...state });
        console.log('PASS', transport, mode);
      } catch (error) {
        results.push({ transport, mode, pass: false, error: error.message, ...state });
        console.log('FAIL', transport, mode, error.message);
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); }
await writeFile(output + '/results.json', JSON.stringify({ sourceOverride: !!override, results }, null, 2) + '\n');
if (results.some(result => !result.pass)) process.exitCode = 1;
