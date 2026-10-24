// Bundle the real client/storage/WBI/helper; intercept only transport and time.
// This suite cannot reach a real account, TV, browser session, or remote API.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(new URL('../app/package.json', import.meta.url));
const { build } = require('esbuild');
const bundles = new Map();
for (const dev of [false, true]) {
  const result = await build({
    stdin: { contents: "export { sendRecommendationFeedback } from './src/api/client.js'; export { storage } from './src/utils/storage.js';",
      resolveDir: new URL('../app/', import.meta.url).pathname },
    bundle: true, write: false, format: 'iife', globalName: 'feedbackHarness',
    platform: 'browser', target: 'es2016', define: { 'import.meta.env.DEV': String(dev) },
  });
  bundles.set(dev, result.outputFiles[0].text);
}

const now = 1702204169000;
const mixin = 'ea1db124af3c7062474693fa704f4ff8'; // Independent fixed-fixture oracle.
const nav = { code: 0, data: { wbi_img: {
  img_url: 'https://fixture.invalid/7cd084941338484aae1ad9425b84077c.png',
  sub_url: 'https://fixture.invalid/4932caff0ff746eab6f01bf08b70ac45.png',
} } };
const video = () => ({ goto: 'av', id: 123, aid: 456, owner: { mid: 789 }, track_id: 'fixture-track' });
const initialAuth = { SESSDATA: 'fixture-session', DedeUserID: '700001', bili_jct: 'fixture-csrf' };
const output = process.env.FEEDBACK_TEST_OUTPUT || '/tmp/bili-recommendation-feedback';
const results = [];
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
const serialized = value => JSON.parse(JSON.stringify(value));

function fixture(options = {}) {
  const calls = [], fetchCalls = [], transportCalls = [], timers = new Map(), delays = [], values = new Map(), unexpected = [];
  let elapsed = 0, timerId = 0;
  const auth = Object.prototype.hasOwnProperty.call(options, 'auth') ? options.auth : initialAuth;
  if (auth) values.set('bili_auth', JSON.stringify(auth));
  if (options.proxyNav || options.transport === 'proxy') values.set('bili_proxyUrl', JSON.stringify('http://127.0.0.1:9527'));
  function schedule(fn, delay) {
    const id = ++timerId;
    delays.push(delay); timers.set(id, { fn, at: elapsed + delay });
    return id;
  }
  function reply(call, response, cookies) {
    call.options.onSuccess({ returnValue: true, status: 200,
      body: JSON.stringify(response), ...(cookies ? { newCookies: cookies } : {}) });
  }
  const sandbox = {
    console: { info() {}, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
    Date: class extends Date { static now() { return now + elapsed; } },
    navigator: { userAgent: 'SmartTV isolated fixture' },
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) },
    addEventListener() {}, removeEventListener() {},
    fetch(url, init) {
      fetchCalls.push({ url, init });
      if (options.transport === 'bridge' && url === 'http://127.0.0.1:9528/ping') return Promise.resolve({ ok: true });
      if ((options.transport === 'bridge' && url === 'http://127.0.0.1:9528/luna/fetch') ||
          (options.transport === 'proxy' && url.startsWith('http://127.0.0.1:9527/proxy/api.bilibili.com/'))) {
        const bridge = options.transport === 'bridge';
        const parameters = bridge ? JSON.parse(init.body) : {
          url: url.replace('http://127.0.0.1:9527/proxy/api.bilibili.com', 'https://api.bilibili.com'),
          method: init.method, body: init.body,
        };
        const path = new URL(parameters.url).pathname;
        const isNav = path === '/x/web-interface/nav';
        const isFeedback = ['/x/web-interface/feedback/dislike', '/x/web-interface/feedback/dislike/cancel'].includes(path);
        if (!isNav && !isFeedback) {
          unexpected.push(options.transport + ':' + path);
          throw new Error('Unexpected transport request blocked by fixture');
        }
        assert.equal(parameters.method, isNav ? 'GET' : 'POST');
        return new Promise(resolve => {
          const call = { parameters, complete(response, cookies) {
            resolve(bridge ? { ok: true, json: async () => ({ returnValue: true, body: JSON.stringify(response), newCookies: cookies }) } : {
              ok: true, headers: { get(name) {
                if (name.toLowerCase() === 'content-type') return 'application/json';
                if (name.toLowerCase() === 'x-set-cookie' && cookies) return JSON.stringify(cookies);
                return null;
              } }, json: async () => response,
            });
          } };
          transportCalls.push(call);
          if (!(isNav ? options.holdNav : options.holdPost)) queueMicrotask(() => call.complete(isNav ? nav : { code: 0 }));
        });
      }
      if (options.proxyNav && url === 'http://127.0.0.1:9527/proxy/api.bilibili.com/x/web-interface/nav') {
        assert.equal(init.method, 'GET');
        if (options.proxyNavBody) return Promise.resolve({ ok: true,
          headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
          json: () => new Promise(resolve => { sandbox.releaseProxyNav = () => resolve(nav); }),
        });
        return new Promise(resolve => { sandbox.releaseProxyNav = () => resolve({ ok: true,
          headers: { get(name) {
            if (name.toLowerCase() === 'content-type') return 'application/json';
            if (name.toLowerCase() === 'x-set-cookie') return JSON.stringify({ bili_jct: 'late-proxy-csrf' });
            return null;
          } }, json: async () => nav,
        }); });
      }
      if (options.dev && url === 'http://127.0.0.1:9528/ping' && options.holdDiscovery) {
        return new Promise(resolve => { sandbox.releaseDiscovery = () => resolve({ ok: !!options.holdBridge }); });
      }
      if (options.dev && url === 'http://127.0.0.1:9528/luna/fetch' && options.holdBridge) {
        return new Promise(resolve => { sandbox.releaseBridge = () => resolve({ ok: true, json: async () => ({
          returnValue: true, body: JSON.stringify({ code: 0 }), newCookies: { bili_jct: 'late-bridge-csrf' },
        }) }); });
      }
      unexpected.push('fetch:' + new URL(url).pathname);
      throw new Error('Unexpected network access blocked by fixture');
    },
    PalmServiceBridge: function () {},
    webOS: { service: { request(uri, requestOptions) {
      assert.equal(uri, 'luna://com.biliwebos.app.service/');
      assert.equal(requestOptions.method, 'fetch');
      const url = new URL(requestOptions.parameters.url);
      assert.equal(url.host, 'api.bilibili.com');
      const call = { parameters: requestOptions.parameters, options: requestOptions, cancelled: 0 };
      calls.push(call);
      const path = url.pathname;
      if (path === '/x/web-interface/nav') {
        assert.equal(call.parameters.method, 'GET');
        if (!options.holdNav) queueMicrotask(() => reply(call, options.nav || nav, options.navCookies));
      } else if (['/x/web-interface/feedback/dislike', '/x/web-interface/feedback/dislike/cancel'].includes(path)) {
        assert.equal(call.parameters.method, 'POST');
        if (!options.holdPost) queueMicrotask(() => reply(call, options.response || { code: 0, message: 'fixture accepted' }));
      } else {
        unexpected.push('luna:' + path);
        throw new Error('Unexpected Luna request blocked by fixture');
      }
      return { cancel() { call.cancelled++; } };
    } } },
  };
  if (options.proxyNav || options.transport === 'proxy' || options.transport === 'bridge') delete sandbox.PalmServiceBridge;
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(bundles.get(!!options.dev || options.transport === 'bridge'), context);
  const harness = context.feedbackHarness;
  return {
    calls, delays, fetchCalls, unexpected,
    send: (input = video(), cancel = false, reason = 1) => harness.sendRecommendationFeedback(input, cancel, reason),
    auth: () => serialized(harness.storage.getAuth()),
    setAuth: auth => harness.storage.setAuth(auth),
    changeGeneration: () => harness.storage.invalidateAuthRequests(),
    reply,
    requests: () => options.transport === 'proxy' || options.transport === 'bridge' ? transportCalls : calls,
    replyRequest: (call, response, cookies) => call.complete ? call.complete(response, cookies) : reply(call, response, cookies),
    async advance(ms) {
      const target = elapsed + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        elapsed = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
      }
      elapsed = target; await flush();
    },
    useDevTransport() { delete sandbox.PalmServiceBridge; },
    useLunaTransport() { sandbox.PalmServiceBridge = function () {}; },
    releaseDiscovery() { sandbox.releaseDiscovery(); },
    releaseBridge() { sandbox.releaseBridge(); },
    releaseProxyNav() { sandbox.releaseProxyNav(); },
    assertContained() { assert.deepEqual(unexpected, []); },
  };
}

async function test(name, callback) {
  try { await callback(); results.push({ name, pass: true }); console.log('PASS', name); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.error('FAIL', name, error.message); }
}

for (const [name, auth] of [['guest', null], ['missing CSRF', { SESSDATA: 'fixture-session' }],
  ['empty CSRF', { ...initialAuth, bili_jct: ' ' }], ['invalid session token', { ...initialAuth, SESSDATA: true }]]) {
  await test(name + ' rejects before any request', async () => {
    const f = fixture({ auth });
    await assert.rejects(f.send(), error => error.code === 'FEEDBACK_AUTH_REQUIRED');
    assert.equal(f.calls.length, 0); assert.equal(f.fetchCalls.length, 0); f.assertContained();
  });
}
await test('invalid recommendation context rejects before key or write requests', async () => {
  const f = fixture();
  for (const reason of [1, 4]) for (const cancel of [false, true]) {
    for (const change of [{ goto: 'live' }, { track_id: '' }, { track_id: undefined }, { id: 0 },
      { owner: { mid: 0 } }, { owner: {} }, { owner: undefined }, { dislike_switch_pc: 0 }]) {
      await assert.rejects(f.send({ ...video(), ...change }, cancel, reason), error => error.code === 'FEEDBACK_CONTEXT_INVALID');
    }
  }
  assert.equal(f.calls.length, 0); assert.equal(f.fetchCalls.length, 0); f.assertContained();
});

await test('unsupported reasons reject submit and cancel before any request without coercion', async () => {
  const f = fixture();
  for (const reason of [2, 3, 0, -1, 1.5, NaN, Infinity, '1', '4', null, true, {}, [1], [4]]) {
    for (const cancel of [false, true]) {
      await assert.rejects(f.send(video(), cancel, reason), error => error.code === 'FEEDBACK_REASON_INVALID');
    }
  }
  assert.equal(f.calls.length, 0); assert.equal(f.fetchCalls.length, 0); f.assertContained();
});

await test('omitting the reason preserves video feedback and ignores embedded reason fields', async () => {
  const f = fixture();
  assert.equal((await f.send({ ...video(), reason_id: 4, reason: 4 })).code, 0);
  assert.equal(new URLSearchParams(f.calls[1].parameters.body).get('reason_id'), '1');
  assert.equal(f.calls.length, 2); f.assertContained();
});

for (const reason of [1, 4]) for (const cancel of [false, true]) await test('reason ' + reason + ' ' + (cancel ? 'cancel' : 'feedback') + ' signs only the empty query and sends the whitelisted CSRF form once', async () => {
  const response = { code: 0, message: 'fixture accepted', data: { fixture: true } };
  const f = fixture({ response });
  assert.deepEqual(serialized(await f.send({ ...video(), reason_id: reason === 1 ? 4 : 1, csrf: 'wrong', title: 'Private title' }, cancel, reason)), response);
  assert.equal(f.calls.length, 2);
  const request = f.calls[1].parameters, url = new URL(request.url);
  assert.equal(url.pathname, '/x/web-interface/feedback/dislike' + (cancel ? '/cancel' : ''));
  assert.deepEqual([...url.searchParams.keys()].sort(), ['w_rid', 'wts']);
  const unsigned = 'wts=' + now / 1000;
  assert.equal(url.searchParams.get('wts'), String(now / 1000));
  assert.equal(url.searchParams.get('w_rid'), createHash('md5').update(unsigned + mixin).digest('hex'));
  assert.equal(request.contentType, 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(request.body)), {
    app_id: '100', platform: '5', from_spmid: '', spmid: '333.1007.0.0', feedback_page: '1',
    goto: 'av', id: '123', mid: '789', track_id: 'fixture-track', reason_id: String(reason), csrf: 'fixture-csrf',
  });
  assert.deepEqual(f.auth(), initialAuth); f.assertContained();
});

await test('UP feedback cancellation preserves the saved reason and recommendation context', async () => {
  const f = fixture(), originalVideo = video(), originalReason = 4;
  assert.equal((await f.send(originalVideo, false, originalReason)).code, 0);
  assert.equal((await f.send(originalVideo, true, originalReason)).code, 0);
  assert.equal(f.calls.length, 3, 'cancel may reuse valid cached WBI keys');
  assert.equal(new URL(f.calls[2].parameters.url).pathname, '/x/web-interface/feedback/dislike/cancel');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(f.calls[2].parameters.body)),
    Object.fromEntries(new URLSearchParams(f.calls[1].parameters.body)));
  f.assertContained();
});

for (const transport of ['luna', 'proxy', 'bridge']) for (const reason of [1, 4]) for (const cancel of [false, true]) {
  await test(transport + ' deduplicates only pending reason ' + reason + ' ' + (cancel ? 'cancel' : 'submit') + ' across callers', async () => {
    const f = fixture({ transport, holdNav: true, holdPost: true });
    const first = f.send(video(), cancel, reason); await flush();
    const second = f.send({ ...video(), title: 'Different display metadata' }, cancel, reason); await flush();
    assert.equal(f.requests().length, 1, 'concurrent preparation shares one read');
    f.replyRequest(f.requests()[0], nav); await flush();
    assert.equal(f.requests().length, 2);
    const reopened = f.send(video(), cancel, reason); await flush();
    assert.equal(f.requests().length, 2, 'reopening cannot issue another pending POST');
    f.replyRequest(f.requests()[1], { code: 0 });
    for (const response of await Promise.all([first, second, reopened])) assert.equal(response.code, 0);
    const explicitRetry = f.send(video(), cancel, reason); await flush();
    assert.equal(f.requests().length, 3, 'successful outcomes are not cached');
    f.replyRequest(f.requests()[2], { code: 0 }); assert.equal((await explicitRetry).code, 0);
    f.assertContained();
  });
}

for (const transport of ['luna', 'proxy', 'bridge']) await test(transport + ' keeps different reasons, cancellation and recommendation contexts independent', async () => {
  const f = fixture({ transport, holdPost: true });
  const pending = [f.send(video(), false, 1), f.send(video(), false, 4), f.send(video(), true, 4),
    f.send({ ...video(), track_id: 'different-recommendation-track' }, false, 4)];
  await flush();
  const posts = f.requests().filter(call => call.parameters.method === 'POST');
  assert.equal(posts.length, 4);
  assert.deepEqual(posts.map(call => [new URL(call.parameters.url).pathname.endsWith('/cancel'),
    new URLSearchParams(call.parameters.body).get('reason_id'), new URLSearchParams(call.parameters.body).get('track_id')]), [
    [false, '1', 'fixture-track'], [false, '4', 'fixture-track'], [true, '4', 'fixture-track'], [false, '4', 'different-recommendation-track'],
  ]);
  posts.forEach(call => f.replyRequest(call, { code: 0 }));
  assert.equal((await Promise.all(pending)).length, 4); f.assertContained();
});

for (const transport of ['luna', 'proxy', 'bridge']) for (const mutation of ['generation', 'session', 'user']) {
  await test(transport + ' does not merge a pending operation across a ' + mutation + ' change', async () => {
    const f = fixture({ transport, holdPost: true });
    const first = f.send(video(), false, 4);
    const rejected = assert.rejects(first, error => error.code === 'RECOMMENDATION_FEEDBACK_SESSION_CHANGED');
    await flush(); assert.equal(f.requests().length, 2);
    if (mutation === 'generation') f.changeGeneration();
    else f.setAuth({ ...initialAuth, ...(mutation === 'session' ? { SESSDATA: 'replacement-session' } : { DedeUserID: '700002' }) });
    const expectedAuth = f.auth(), second = f.send(video(), false, 4); await flush();
    assert.equal(f.requests().length, 3);
    f.replyRequest(f.requests()[1], { code: 0 }, { bili_jct: 'late-old-csrf' }); await rejected;
    assert.deepEqual(f.auth(), expectedAuth);
    f.replyRequest(f.requests()[2], { code: 0 }); assert.equal((await second).code, 0);
    f.assertContained();
  });
}

for (const transport of ['luna', 'proxy', 'bridge']) await test(transport + ' shared POST timeout stays unknown for every caller and releases the pending entry', async () => {
  const f = fixture({ transport, holdPost: true });
  const first = f.send(video(), false, 4), second = f.send(video(), false, 4);
  const isUnknown = error => error.code === 'RECOMMENDATION_FEEDBACK_UNKNOWN' && error.resultUnknown === true;
  const rejected = [assert.rejects(first, isUnknown), assert.rejects(second, isUnknown)];
  await flush(); assert.equal(f.requests().length, 2);
  await f.advance(20000); await Promise.all(rejected);
  f.replyRequest(f.requests()[1], { code: 0 }, { bili_jct: 'late-old-csrf' }); await flush();
  assert.deepEqual(f.auth(), initialAuth);
  const explicitRetry = f.send(video(), false, 4); await flush();
  assert.equal(f.requests().length, 3);
  f.replyRequest(f.requests()[2], { code: 0 }); assert.equal((await explicitRetry).code, 0);
  f.assertContained();
});

await test('pending operation storage is bounded and deadlines free its capacity', async () => {
  const f = fixture({ holdNav: true, holdPost: true });
  const pending = Array.from({ length: 32 }, (_, index) => f.send({ ...video(), id: 1000 + index }, false, 4));
  const settled = Promise.allSettled(pending);
  await flush(); assert.equal(f.calls.length, 32);
  await assert.rejects(f.send({ ...video(), id: 9999 }, false, 4), error => error.code === 'FEEDBACK_BUSY');
  assert.equal(f.calls.length, 32);
  await f.advance(10000);
  for (const result of await settled) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.code, 'FEEDBACK_PREPARATION_FAILED');
  }
  const retry = f.send(video(), false, 4); await flush();
  assert.equal(f.calls.length, 33);
  f.reply(f.calls[32], nav); await flush();
  assert.equal(f.calls.length, 34);
  f.reply(f.calls[33], { code: 0 }); assert.equal((await retry).code, 0); f.assertContained();
});

for (const reason of [1, 4]) for (const code of [-351, -352, -101]) await test('reason ' + reason + ' business code ' + code + ' returns unchanged without retry', async () => {
  const response = { code, message: 'fixture rejection' }, f = fixture({ response });
  assert.deepEqual(serialized(await f.send(video(), false, reason)), response);
  assert.equal(f.calls.length, 2); f.assertContained();
});

await test('same-session nav CSRF refresh is used in the subsequent form', async () => {
  const f = fixture({ navCookies: { bili_jct: 'refreshed-fixture-csrf', buvid3: 'fixture-device' } });
  assert.equal((await f.send(video(), false, 4)).code, 0);
  assert.equal(new URLSearchParams(f.calls[1].parameters.body).get('csrf'), 'refreshed-fixture-csrf');
  assert.deepEqual(f.auth(), { ...initialAuth, bili_jct: 'refreshed-fixture-csrf', buvid3: 'fixture-device' });
  assert.equal(f.calls.length, 2); f.assertContained();
});

await test('missing initial DedeUserID stays optional when the session does not change', async () => {
  const f = fixture({ auth: { SESSDATA: initialAuth.SESSDATA, bili_jct: initialAuth.bili_jct } });
  assert.equal((await f.send(video(), false, 4)).code, 0);
  assert.equal(f.calls.length, 2); f.assertContained();
});

await test('nav cookies changing session identity stop before any feedback POST', async () => {
  for (const navCookies of [{ DedeUserID: '700002' }, { SESSDATA: 'replacement-session' }]) {
    const f = fixture({ navCookies });
    await assert.rejects(f.send(video(), false, 4), error => error.code === 'RECOMMENDATION_FEEDBACK_SESSION_CHANGED');
    assert.equal(f.calls.length, 1); f.assertContained();
  }
});

await test('nav clearing CSRF stops before any feedback POST', async () => {
  const f = fixture({ navCookies: { bili_jct: '' } });
  await assert.rejects(f.send(video(), false, 4), error => error.code === 'FEEDBACK_AUTH_REQUIRED');
  assert.equal(f.calls.length, 1); f.assertContained();
});

await test('malformed WBI keys stop before the POST', async () => {
  const f = fixture({ nav: { code: -352, data: {} } });
  await assert.rejects(f.send(), error => error.code === 'FEEDBACK_PREPARATION_FAILED' && error.resultUnknown === false);
  assert.equal(f.calls.length, 1); f.assertContained();
});
await test('WBI acquisition timeout is a preflight failure, not an unknown write result', async () => {
  const f = fixture({ holdNav: true }), request = f.send();
  const rejected = assert.rejects(request, error => error.code === 'FEEDBACK_PREPARATION_FAILED' && error.resultUnknown === false);
  await flush(); await f.advance(10000); await rejected;
  assert.equal(f.calls[0].cancelled, 1);
  f.reply(f.calls[0], nav, { bili_jct: 'late-old-csrf' }); await flush();
  assert.equal(f.calls.length, 1); assert.deepEqual(f.auth(), initialAuth); f.assertContained();
});

for (const mode of ['never responds', 'late headers', 'late JSON body']) await test('proxy nav ' + mode + ' stops at 10 seconds without cookie changes or POST', async () => {
  const f = fixture({ proxyNav: true, proxyNavBody: mode === 'late JSON body' });
  let outcome = null;
  f.send().then(value => { outcome = { value }; }, error => { outcome = { error }; });
  await flush(); assert.equal(f.fetchCalls.length, 1); assert.equal(f.calls.length, 0);
  await f.advance(9999); assert.equal(outcome, null);
  await f.advance(1);
  assert.equal(outcome?.error?.code, 'FEEDBACK_PREPARATION_FAILED');
  assert.equal(outcome.error.resultUnknown, false);
  if (mode !== 'never responds') f.releaseProxyNav();
  await flush(); await f.advance(60000);
  assert.equal(outcome.error.code, 'FEEDBACK_PREPARATION_FAILED');
  assert.equal(f.fetchCalls.length, 1, 'preparation must never automatically retry or continue to POST');
  assert.deepEqual(f.auth(), initialAuth);
  if (mode !== 'never responds') {
    // A separate, explicit retry must acquire fresh keys; late old bodies must
    // not populate the cache. Switch only the mock transport for this attempt.
    f.useLunaTransport(); assert.equal((await f.send()).code, 0);
    assert.deepEqual(f.calls.map(call => new URL(call.parameters.url).pathname), [
      '/x/web-interface/nav', '/x/web-interface/feedback/dislike',
    ]);
  }
  f.assertContained();
});

for (const reason of [1, 4]) for (const stage of ['nav', 'post']) {
  for (const mutation of ['generation', 'session', 'user', 'missing user', ...(stage === 'post' ? ['csrf'] : [])]) {
  await test('reason ' + reason + ' ' + mutation + ' changes during ' + stage + ' reject the old operation and ignore its cookies', async () => {
    const f = fixture({ holdNav: stage === 'nav', holdPost: stage === 'post' });
    const request = f.send(video(), false, reason);
    const rejected = assert.rejects(request, error => error.code === 'RECOMMENDATION_FEEDBACK_SESSION_CHANGED');
    await flush();
    const expectedCalls = stage === 'nav' ? 1 : 2;
    assert.equal(f.calls.length, expectedCalls);
    if (mutation === 'generation') f.changeGeneration();
    else if (mutation === 'session') f.setAuth({ ...initialAuth, SESSDATA: 'replacement-session' });
    else if (mutation === 'user') f.setAuth({ ...initialAuth, DedeUserID: '700002' });
    else if (mutation === 'missing user') f.setAuth({ ...initialAuth, DedeUserID: undefined });
    else f.setAuth({ ...initialAuth, bili_jct: 'replacement-csrf' });
    const expectedAuth = f.auth();
    f.reply(f.calls[expectedCalls - 1], stage === 'nav' ? nav : { code: 0 }, { bili_jct: 'late-old-csrf' });
    await rejected; await flush();
    assert.equal(f.calls.length, expectedCalls);
    assert.deepEqual(f.auth(), expectedAuth); f.assertContained();
  });
  }
}

await test('adding an initially absent DedeUserID during nav rejects the pending operation', async () => {
  const f = fixture({ auth: { SESSDATA: initialAuth.SESSDATA, bili_jct: initialAuth.bili_jct }, holdNav: true });
  const request = f.send(video(), false, 4);
  const rejected = assert.rejects(request, error => error.code === 'RECOMMENDATION_FEEDBACK_SESSION_CHANGED');
  await flush(); f.setAuth(initialAuth);
  f.reply(f.calls[0], nav, { bili_jct: 'late-old-csrf' }); await rejected;
  assert.deepEqual(f.auth(), initialAuth); assert.equal(f.calls.length, 1); f.assertContained();
});

await test('unrelated cookie updates while a POST is pending do not invalidate the operation', async () => {
  const f = fixture({ holdPost: true }), request = f.send(video(), false, 4);
  await flush(); f.setAuth({ ...initialAuth, buvid3: 'fixture-device' });
  f.reply(f.calls[1], { code: 0 });
  assert.equal((await request).code, 0);
  assert.deepEqual(f.auth(), { ...initialAuth, buvid3: 'fixture-device' }); f.assertContained();
});

for (const reason of [1, 4]) await test('reason ' + reason + ' 20 second POST timeout is unknown, cancels once and cannot become late success', async () => {
  const f = fixture({ holdPost: true });
  let successes = 0, failures = 0;
  const request = f.send(video(), false, reason).then(value => { successes++; return value; }, error => { failures++; throw error; });
  const rejected = assert.rejects(request, error => error.code === 'RECOMMENDATION_FEEDBACK_UNKNOWN' &&
    error.name === 'RecommendationFeedbackUnknownError' && error.resultUnknown === true);
  await flush(); assert.equal(f.calls.length, 2);
  await f.advance(19999); assert.equal(failures, 0);
  await f.advance(1); await rejected;
  assert.equal(f.calls[1].cancelled, 1);
  f.reply(f.calls[1], { code: 0 }, { bili_jct: 'late-old-csrf' });
  await flush(); await f.advance(60000);
  assert.equal(successes, 0); assert.equal(failures, 1); assert.equal(f.calls.length, 2);
  assert.deepEqual(f.auth(), initialAuth);
  assert.ok(f.delays.includes(10000) && f.delays.includes(20000));
  assert.ok(f.delays.every(ms => ms === 10000 || ms === 20000)); f.assertContained();
});

for (const reason of [1, 4]) for (const message of ['fixture connection reset', 'read ETIMEDOUT']) await test('reason ' + reason + ' ' + message + ' after POST remains unknown and is never retried', async () => {
  const f = fixture({ holdPost: true }), request = f.send(video(), false, reason);
  const rejected = assert.rejects(request, error => error.code === 'RECOMMENDATION_FEEDBACK_UNKNOWN' && error.resultUnknown === true);
  await flush(); f.calls[1].options.onFailure({ errorText: message }); await rejected;
  f.reply(f.calls[1], { code: 0 }); await flush();
  assert.equal(f.calls.length, 2); f.assertContained();
});

for (const reason of [1, 4]) for (const body of ['<html>fixture gateway error</html>', 'null', '{}', '{"code":"0"}']) {
  await test('reason ' + reason + ' unconfirmed POST response ' + body.slice(0, 12) + ' is unknown rather than a business success or failure', async () => {
    const f = fixture({ holdPost: true }), request = f.send(video(), false, reason);
    const rejected = assert.rejects(request, error => error.code === 'RECOMMENDATION_FEEDBACK_UNKNOWN' && error.resultUnknown === true);
    await flush();
    f.calls[1].options.onSuccess({ returnValue: true, status: 200, body });
    await rejected; assert.equal(f.calls.length, 2); f.assertContained();
  });
}

for (const mutation of ['session', 'user', 'csrf']) await test('delayed DEV discovery cannot dispatch after a ' + mutation + ' change', async () => {
  const f = fixture({ dev: true, holdNav: true, holdDiscovery: true });
  const request = f.send(video(), false, 4);
  const rejected = assert.rejects(request, error => error.code === 'RECOMMENDATION_FEEDBACK_SESSION_CHANGED');
  await flush(); assert.equal(f.calls.length, 1);
  f.useDevTransport(); f.reply(f.calls[0], nav); await flush();
  assert.equal(f.fetchCalls.length, 1);
  f.setAuth({ ...initialAuth, ...(mutation === 'session' ? { SESSDATA: 'replacement-session' } :
    mutation === 'user' ? { DedeUserID: '700002' } : { bili_jct: 'replacement-csrf' }) });
  f.releaseDiscovery(); await flush(); await rejected;
  assert.equal(f.fetchCalls.length, 1, 'only read-only bridge discovery may have been attempted');
  assert.equal(f.calls.length, 1, 'no feedback POST was dispatched'); f.assertContained();
});

for (const reason of [1, 4]) await test('reason ' + reason + ' outer deadline covers discovery plus bridge POST and rejects its late cookies and success', async () => {
  const f = fixture({ dev: true, holdNav: true, holdDiscovery: true, holdBridge: true });
  let successes = 0;
  const request = f.send(video(), false, reason).then(value => { successes++; return value; });
  const rejected = assert.rejects(request, error => error.code === 'RECOMMENDATION_FEEDBACK_UNKNOWN' && error.resultUnknown === true);
  await flush(); f.useDevTransport(); f.reply(f.calls[0], nav); await flush();
  await f.advance(9000); f.releaseDiscovery(); await flush();
  assert.equal(f.fetchCalls.length, 2);
  const bridgePost = JSON.parse(f.fetchCalls[1].init.body);
  assert.equal(bridgePost.method, 'POST');
  assert.equal(new URLSearchParams(bridgePost.body).get('reason_id'), String(reason));
  assert.equal(new URL(bridgePost.url).pathname, '/x/web-interface/feedback/dislike');
  await f.advance(10999); assert.equal(successes, 0);
  await f.advance(1); await rejected;
  f.releaseBridge(); await flush(); await f.advance(60000);
  assert.equal(successes, 0); assert.equal(f.fetchCalls.length, 2);
  assert.deepEqual(f.auth(), initialAuth); f.assertContained();
});

mkdirSync(output, { recursive: true });
writeFileSync(output + '/results.json', JSON.stringify({ results,
  limits: 'Production client bundle with mock Luna/fetch boundaries and a virtual clock. No real API write, authentication, TV, or elapsed-network-time validation.' }, null, 2) + '\n');
process.exitCode = results.some(result => !result.pass) ? 1 : 0;
