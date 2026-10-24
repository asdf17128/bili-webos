// Bundle the actual client/storage/WBI/controller. Only SDK, bridge, time and
// storage boundaries are fixtures; no server, socket, account or TV is touched.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(new URL('../app/package.json', import.meta.url));
const { build } = require('esbuild');
const bundles = new Map();
for (const dev of [false, true]) {
  const result = await build({
    stdin: { contents: "export { accountRepair, apiFetch, wbiFetch, ensureBuvid, getBuvid3 } from './src/api/client.js'; export { storage } from './src/utils/storage.js';",
      resolveDir: new URL('../app/', import.meta.url).pathname },
    bundle: true, write: false, format: 'iife', globalName: 'repairHarness',
    platform: 'browser', target: 'es2016', define: { 'import.meta.env.DEV': String(dev) },
  });
  bundles.set(dev, result.outputFiles[0].text);
}
const clone = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const initialAuth = { SESSDATA: 'private-session-fixture', DedeUserID: '123', bili_jct: 'private-csrf-fixture', refresh_token: 'private-refresh-fixture',
  buvid3: 'old-device-three-fixture', buvid4: 'old-device-four-fixture', b_nut: '1600000000' };
const newDevice = { buvid3: 'new-device-three-fixture', buvid4: 'new-device-four-fixture', b_nut: '1700000000' };
const preferences = { language: 'zh', cdnRoute: 'auto', quality: 'auto' };
const validStatus = { returnValue: true, supported: true, hasDeviceIdentity: true, hasAccount: true, busy: false, retryAfterSeconds: 0 };
const nav = { code: 0, data: { isLogin: true, mid: 123, wbi_img: {
  img_url: 'https://fixture.invalid/7cd084941338484aae1ad9425b84077c.png',
  sub_url: 'https://fixture.invalid/4932caff0ff746eab6f01bf08b70ac45.png',
} } };
const success = { returnValue: true, changed: true, accountPreserved: true };
const deviceKeys = ['buvid3', 'buvid4', 'b_nut'];

function fixture({ transport = 'native', hold = () => false, repairResponse = success, serviceCookies = initialAuth } = {}) {
  const calls = [], fetches = [], unexpected = [], timers = new Map();
  const values = new Map([['bili_auth', JSON.stringify(initialAuth)], ['bili_settings', JSON.stringify(preferences)],
    ['bili_proxyUrl', JSON.stringify('http://fixture.invalid:9527')]]);
  let elapsed = 0, timerId = 0, jar = clone(serviceCookies);
  function schedule(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: elapsed + delay }); return id; }
  function respond(call, response, mode) {
    if (call.transport === 'native') {
      if (mode === 'failure' || response?.returnValue === false) call.options.onFailure(clone(response));
      else call.options.onSuccess(clone(response));
    } else call.resolve({ ok: true, json: async () => clone(response) });
  }
  function replyApi(call, body, cookies) {
    respond(call, { returnValue: true, status: 200, body: JSON.stringify(body), ...(cookies ? { newCookies: cookies } : {}) });
  }
  function deliver(call) {
    if (call.method === 'getAccountRepairStatus') return respond(call, validStatus);
    if (call.method === 'ensureDeviceIdentity') {
      if (!jar.buvid3) jar = {...jar, buvid3:'bootstrap-three-fixture', buvid4:'bootstrap-four-fixture'};
      return respond(call, {returnValue:true,cookies:jar});
    }
    if (call.method === 'getCookies') return respond(call, { returnValue: true, cookies: jar });
    if (call.method === 'repairDeviceIdentity') {
      if (repairResponse.returnValue === true) jar = { ...jar, ...newDevice };
      return respond(call, repairResponse);
    }
    if (call.method === 'setCookies') {
      // This is only the transport contract fixture. Production-side queued
      // mutation fencing is tested by test-account-repair-service.mjs.
      if (call.parameters.onlyIfDeviceMissing === true && jar.buvid3) {
        return respond(call, { returnValue: false, errorCode: 'IDENTITY_EXISTS', error: 'Device identity already exists' });
      }
      jar = { ...jar, ...call.parameters.cookies };
      return respond(call, { returnValue: true });
    }
    if (call.method === 'fetch') {
      if (call.path === '/x/frontend/finger/spi') return replyApi(call, { code: 0, data: { b_3: 'bootstrap-three-fixture', b_4: 'bootstrap-four-fixture' } });
      if (call.path === '/x/web-interface/nav') return replyApi(call, nav);
      return replyApi(call, { code: 0, data: { fixture: true } });
    }
    throw new Error('Fixture method is not allowlisted');
  }
  function dispatch(method, parameters, details) {
    assert.ok(['getAccountRepairStatus', 'getCookies', 'ensureDeviceIdentity', 'setCookies', 'repairDeviceIdentity', 'fetch'].includes(method));
    const call = { method, parameters, ...details, cancelled: 0 };
    if (method === 'fetch') {
      const url = new URL(parameters.url); assert.equal(url.hostname, 'api.bilibili.com'); call.path = url.pathname;
      assert.ok(['/x/web-interface/nav', '/x/frontend/finger/spi', '/x/web-interface/popular', '/fixture/read'].includes(call.path));
    }
    calls.push(call);
    if (!hold(call, calls)) queueMicrotask(() => deliver(call));
    return call;
  }
  const sandbox = {
    console: { info() {}, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
    Date: class extends Date { static now() { return 1702204169000 + elapsed; } },
    navigator: { userAgent: 'Isolated account repair transport fixture' },
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    addEventListener() {}, removeEventListener() {},
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) },
    fetch(url, init) {
      fetches.push({ url, init });
      const parsed = new URL(url);
      if (url === 'http://127.0.0.1:9528/ping') return Promise.resolve({ ok: transport === 'bridge' });
      if (transport === 'bridge' && parsed.origin === 'http://127.0.0.1:9528' && parsed.pathname.startsWith('/luna/')) {
        return new Promise((resolve, reject) => dispatch(parsed.pathname.slice('/luna/'.length), JSON.parse(init.body), { transport: 'bridge', resolve, reject }));
      }
      // The legacy absent-device browser path still syncs its standalone jar.
      if (transport === 'bridge' && url === 'http://fixture.invalid:9527/cookies') return Promise.resolve({ ok: true });
      unexpected.push(parsed.pathname); throw new Error('Unexpected external access blocked by fixture');
    },
  };
  if (transport === 'native') {
    sandbox.PalmServiceBridge = function () {};
    sandbox.webOS = { service: { request(uri, options) {
      assert.equal(uri, 'luna://com.biliwebos.app.service/');
      const call = dispatch(options.method, options.parameters, { transport: 'native', options });
      return { cancel() { call.cancelled++; } };
    } } };
  }
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(bundles.get(transport === 'bridge'), context);
  const api = context.repairHarness;
  return {
    api, calls, fetches, unexpected, deliver, respond, replyApi,
    commitDevice() { jar = { ...jar, ...newDevice }; },
    failTransport(call) {
      if (call.transport === 'native') call.options.onFailure({ errorText: 'private transport failure' });
      else call.reject(new Error('private transport failure'));
    },
    auth: () => clone(api.storage.getAuth()), jar: () => clone(jar),
    generation: () => api.storage.getAuthGeneration(),
    settings: () => JSON.parse(values.get('bili_settings')),
    count: method => calls.filter(call => call.method === method).length,
    pathCount: path => calls.filter(call => call.path === path).length,
    assertContained() { assert.deepEqual(unexpected, []); },
    async advance(ms) {
      const target = elapsed + ms;
      for (;;) {
        const next = [...timers].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        elapsed = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
      }
      elapsed = target; await flush();
    },
  };
}
function preservedAuth() { const expected = clone(initialAuth); deviceKeys.forEach(key => delete expected[key]); return expected; }
let passed = 0, failed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}

for (const transport of ['native', 'bridge']) {
  await test(transport + ': success clears only local device keys and advances the auth generation', async () => {
    const f = fixture({ transport });
    await f.api.ensureBuvid(); assert.equal(f.api.getBuvid3(), initialAuth.buvid3);
    const result = await f.api.accountRepair.repairDevice({ confirm: true });
    assert.equal(result.status, 'repaired'); assert.equal(result.deviceOutcome, 'changed');
    assert.deepEqual(f.auth(), preservedAuth()); assert.deepEqual(f.settings(), preferences);
    assert.ok(f.generation() > 0); assert.equal(f.api.getBuvid3(), '');
    assert.equal(f.count('repairDeviceIdentity'), 1);
    await f.api.ensureBuvid(); assert.equal(f.api.getBuvid3(), newDevice.buvid3);
    assert.equal(f.pathCount('/x/frontend/finger/spi'), 0); assert.equal(f.count('setCookies'), 0);
    assert.equal(JSON.stringify(result).includes('private-'), false); f.assertContained();
  });
  for (const [errorCode, status, reason] of [
    ['COOLDOWN', 'cooldown', 'service-cooldown'], ['PERSISTENCE_FAILED', 'failed', 'persistence-failed'],
    ['REQUEST_TIMEOUT', 'timeout', 'request-timeout'], ['INVALID_RESPONSE', 'failed', 'invalid-response'],
  ]) await test(transport + ': structured ' + errorCode + ' is retained without cleanup', async () => {
    const f = fixture({ transport, repairResponse: { returnValue: false, errorCode, error: 'private upstream details', retryAfterSeconds: 321 } });
    await f.api.ensureBuvid();
    const result = await f.api.accountRepair.repairDevice({ confirm: true });
    assert.equal(result.status, status); assert.equal(result.reason, reason); assert.equal(result.deviceOutcome, 'unchanged');
    assert.equal(result.retryAfterSeconds, 321); assert.deepEqual(f.auth(), initialAuth); assert.equal(f.generation(), 0);
    assert.equal(f.api.getBuvid3(), initialAuth.buvid3); assert.equal(JSON.stringify(result).includes('private'), false); f.assertContained();
  });
  await test(transport + ': existing service identity performs no SPI or cookie write', async () => {
    const f = fixture({ transport }); await f.api.ensureBuvid(); await f.api.ensureBuvid();
    assert.equal(f.api.getBuvid3(), initialAuth.buvid3); assert.equal(f.count('getCookies'), 1);
    assert.equal(f.pathCount('/x/frontend/finger/spi'), 0); assert.equal(f.count('setCookies'), 0); f.assertContained();
  });
  await test(transport + ': missing identity is filled by service without frontend SPI or writes', async () => {
    const f=fixture({transport,serviceCookies:{}}); await f.api.ensureBuvid();
    assert.equal(f.count('ensureDeviceIdentity'),1); assert.equal(f.count('setCookies'),0);
    assert.equal(f.pathCount('/x/frontend/finger/spi'),0); assert.equal(f.api.getBuvid3(),'bootstrap-three-fixture'); f.assertContained();
  });
  await test(transport + ': concurrent service fill returns the winning identity', async () => {
    const f=fixture({transport,serviceCookies:{},hold:c=>c.method==='ensureDeviceIdentity'});
    const pending=f.api.ensureBuvid();await flush();f.commitDevice();
    f.deliver(f.calls.find(c=>c.method==='ensureDeviceIdentity'));await pending;
    assert.equal(f.api.getBuvid3(),newDevice.buvid3);assert.equal(f.count('setCookies'),0);f.assertContained();
  });
  for (const mutation of ['generation','credentials']) await test(transport + ': session '+mutation+' fences service fill',async()=>{
    const f=fixture({transport,serviceCookies:{},hold:c=>c.method==='ensureDeviceIdentity'});
    const pending=f.api.ensureBuvid();await flush();
    if(mutation==='generation')f.api.storage.invalidateAuthRequests();
    else f.api.storage.setAuth({SESSDATA:'replacement-session',DedeUserID:'456'});
    const expected=f.auth();f.deliver(f.calls.find(c=>c.method==='ensureDeviceIdentity'));await pending;
    assert.equal(f.api.getBuvid3(),'');assert.deepEqual(f.auth(),expected);f.assertContained();
  });
  for (const failure of ['transport','busy']) await test(transport + ': failed service fill never falls back to frontend SPI '+failure,async()=>{
    const f=fixture({transport,serviceCookies:{},hold:c=>c.method==='ensureDeviceIdentity'});
    const pending=f.api.ensureBuvid();await flush();const call=f.calls.find(c=>c.method==='ensureDeviceIdentity');
    if(failure==='transport')f.failTransport(call);else f.respond(call,{returnValue:false,error:'Device identity repair in progress'});
    await pending;assert.equal(f.api.getBuvid3(),'');assert.equal(f.pathCount('/x/frontend/finger/spi'),0);assert.equal(f.count('setCookies'),0);f.assertContained();
  });
  for (const mode of ['transport-failure', 'timeout']) await test(transport + ': ' + mode + ' after a possible commit clears stale local identity once', async () => {
    const f = fixture({ transport, hold: call => call.method === 'repairDeviceIdentity' });
    await f.api.ensureBuvid(); assert.equal(f.api.getBuvid3(), initialAuth.buvid3);
    const pending = f.api.accountRepair.repairDevice({ confirm: true }); await flush();
    const call = f.calls.find(item => item.method === 'repairDeviceIdentity');
    f.commitDevice();
    if (mode === 'timeout') await f.advance(10000); else f.failTransport(call);
    const result = await pending;
    assert.equal(result.status, 'unknown'); assert.equal(result.deviceOutcome, 'unknown');
    assert.deepEqual(f.auth(), preservedAuth()); assert.equal(f.api.getBuvid3(), ''); assert.ok(f.generation() > 0);
    const generation = f.generation();
    f.respond(call, success); await flush(); assert.equal(f.generation(), generation, 'late success cannot repeat cleanup');
    await f.api.ensureBuvid(); assert.equal(f.api.getBuvid3(), newDevice.buvid3);
    assert.equal(f.pathCount('/x/frontend/finger/spi'), 0); assert.equal(f.count('setCookies'), 0);
    assert.equal(f.count('repairDeviceIdentity'), 1); assert.equal(JSON.stringify(result).includes('private'), false); f.assertContained();
  });
  await test(transport + ': unknown response for an old account cannot clean the replacement account', async () => {
    const f = fixture({ transport, hold: call => call.method === 'repairDeviceIdentity' });
    const pending = f.api.accountRepair.repairDevice({ confirm: true }); await flush();
    const replacement = { SESSDATA: 'replacement-session', DedeUserID: '456', bili_jct: 'replacement-csrf', ...newDevice };
    f.api.storage.setAuth(replacement);
    f.failTransport(f.calls.find(item => item.method === 'repairDeviceIdentity'));
    const result = await pending;
    assert.equal(result.status, 'session-changed'); assert.deepEqual(f.auth(), replacement); assert.equal(f.generation(), 0); f.assertContained();
  });
  await test(transport + ': a pre-repair ordinary fetch cannot restore old cookie fields', async () => {
    const f = fixture({ transport, hold: call => call.path === '/fixture/read' });
    const old = f.api.apiFetch('/fixture/read').then(value => ({ value }), error => ({ error })); await flush();
    const call = f.calls.find(item => item.path === '/fixture/read');
    assert.equal((await f.api.accountRepair.repairDevice({ confirm: true })).status, 'repaired');
    f.replyApi(call, { code: 0 }, initialAuth); assert.ok((await old).error);
    assert.deepEqual(f.auth(), preservedAuth()); assert.equal(f.api.getBuvid3(), ''); f.assertContained();
  });
  for (const stage of ['getCookies', 'ensureDeviceIdentity']) await test(transport + ': late ensureBuvid ' + stage + ' callback cannot undo repair cleanup', async () => {
    const f = fixture({ transport, serviceCookies: {}, hold: call => stage === 'spi' ? call.path === '/x/frontend/finger/spi' : call.method === stage });
    const old = f.api.ensureBuvid(); await flush();
    const call = f.calls.find(item => stage === 'spi' ? item.path === '/x/frontend/finger/spi' : item.method === stage);
    assert.ok(call, 'old bootstrap reached held boundary');
    assert.equal((await f.api.accountRepair.repairDevice({ confirm: true })).status, 'repaired');
    if (stage === 'getCookies') f.respond(call, { returnValue: true, cookies: initialAuth });
    else if (stage === 'spi') f.replyApi(call, { code: 0, data: { b_3: initialAuth.buvid3, b_4: initialAuth.buvid4 } }, initialAuth);
    else f.respond(call, { returnValue: true, cookies: initialAuth });
    await old; assert.deepEqual(f.auth(), preservedAuth()); assert.equal(f.api.getBuvid3(), '');
    assert.equal(f.count('setCookies'), stage === 'setCookies' ? 1 : 0); f.assertContained();
  });
  for (const stage of ['getCookies', 'ensureDeviceIdentity']) await test(transport + ': credential-only session change rejects pending ensureBuvid ' + stage, async () => {
    const f = fixture({ transport, serviceCookies: {}, hold: call => stage === 'spi' ? call.path === '/x/frontend/finger/spi' : call.method === stage });
    const old = f.api.ensureBuvid(); await flush();
    const call = f.calls.find(item => stage === 'spi' ? item.path === '/x/frontend/finger/spi' : item.method === stage);
    f.api.storage.setAuth({ SESSDATA: 'replacement-session', DedeUserID: '456', bili_jct: 'replacement-csrf' });
    if (stage === 'getCookies') f.respond(call, { returnValue: true, cookies: initialAuth });
    else f.respond(call, { returnValue: true, cookies: initialAuth });
    await old; assert.equal(f.api.getBuvid3(), ''); assert.equal(f.count('setCookies'), 0);
    assert.equal(f.auth().SESSDATA, 'replacement-session'); f.assertContained();
  });
  await test(transport + ': refresh invalidates the actual shared WBI cache', async () => {
    const f = fixture({ transport });
    await f.api.wbiFetch('/x/web-interface/popular', {}); await f.api.wbiFetch('/x/web-interface/popular', {});
    assert.equal(f.pathCount('/x/web-interface/nav'), 1);
    const result = await f.api.accountRepair.refresh(); assert.equal(result.status, 'refreshed'); assert.equal(result.cacheCleared, true);
    assert.equal(f.pathCount('/x/web-interface/nav'), 2);
    await f.api.wbiFetch('/x/web-interface/popular', {}); assert.equal(f.pathCount('/x/web-interface/nav'), 3);
    assert.deepEqual(f.auth(), initialAuth); assert.equal(f.generation(), 0); f.assertContained();
  });
  await test(transport + ': a pending pre-refresh nav cannot restore the shared WBI cache', async () => {
    const f = fixture({ transport, hold: (call, calls) => call.path === '/x/web-interface/nav' && calls.filter(item => item.path === call.path).length === 1 });
    const old = f.api.wbiFetch('/x/web-interface/popular', {}).then(value => ({ value }), error => ({ error })); await flush();
    const call = f.calls.find(item => item.path === '/x/web-interface/nav');
    assert.equal((await f.api.accountRepair.refresh()).status, 'refreshed');
    f.replyApi(call, nav); assert.equal((await old).error?.code, 'WBI_KEYS_STALE');
    await f.api.wbiFetch('/x/web-interface/popular', {}); assert.equal(f.pathCount('/x/web-interface/nav'), 3);
    assert.equal(f.pathCount('/x/web-interface/popular'), 1); f.assertContained();
  });
}
await test('no local service means unavailable with zero proxy or repair dispatch', async () => {
  const f = fixture({ transport: 'unsupported' });
  const result = await f.api.accountRepair.repairDevice({ confirm: true });
  assert.equal(result.status, 'unavailable'); assert.equal(result.deviceOutcome, 'not-started');
  assert.equal(f.calls.length, 0); assert.equal(f.fetches.length, 0); assert.deepEqual(f.auth(), initialAuth); f.assertContained();
});

console.log('Account repair transport fixture: ' + passed + ' passed, ' + failed + ' failed; no external transport used');
if (failed) process.exitCode = 1;
