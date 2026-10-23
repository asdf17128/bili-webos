// Isolated controller/WBI tests. Every transport is a local fixture; this file
// never contacts Bilibili, a proxy, a TV, or a real account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountRepair } from '../app/src/api/accountRepair.js';
import { clearWbiKeys, getWbiKeys } from '../app/src/api/wbi.js';

const SECRET = 'fixture-private-response-must-not-escape';
const goodNav = () => ({ code: 0, data: { isLogin: true, uname: SECRET, mid: SECRET } });
const goodStatus = () => ({ returnValue: true, supported: true, hasDeviceIdentity: true,
  hasAccount: true, busy: false, retryAfterSeconds: 0, cookies: SECRET });
const goodRepair = () => ({ returnValue: true, changed: true, accountPreserved: true, raw: SECRET });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(overrides = {}) {
  const state = { generation: 1, auth: { SESSDATA: 'fixture-session-A', DedeUserID: 'fixture-user-A',
    buvid3: 'fixture-device', bili_ticket: 'fixture-ticket' } };
  const calls = [];
  const controller = createAccountRepair({
    getAuth: () => ({ ...state.auth }),
    getGeneration: () => state.generation,
    nav: options => { calls.push('nav'); options.sessionGuard(); return (overrides.nav || goodNav)(options); },
    getServiceStatus: options => { calls.push('status'); options.sessionGuard(); return (overrides.status || goodStatus)(options); },
    repairDeviceIdentity: (payload, options) => {
      calls.push('device');
      assert.deepEqual(payload, { confirm: true });
      options.sessionGuard();
      return (overrides.device || goodRepair)(options);
    },
    clearWbiKeys: () => { calls.push('clear'); if (overrides.clear) overrides.clear(); },
    onDeviceRepaired: () => { calls.push('hook'); if (overrides.hook) overrides.hook(state); },
    onDeviceUnknown: () => { calls.push('unknown-hook'); if (overrides.unknownHook) overrides.unknownHook(state); },
    timeoutMs: overrides.timeoutMs || 1000,
  });
  return { state, calls, controller };
}

function safe(value) {
  assert.equal(JSON.stringify(value).includes(SECRET), false);
  assert.equal(value.playback, 'unchecked');
  assert.deepEqual(Object.keys(value).sort(), ['action', 'status', 'reason', 'login', 'code', 'service',
    'retryAfterSeconds', 'playback', 'cacheCleared', 'deviceOutcome'].sort());
  return value;
}

test('check reads account/service state without exposing identity or claiming playback recovery', async () => {
  const { controller, calls, state } = fixture();
  const before = JSON.stringify(state);
  assert.deepEqual(safe(await controller.check()), {
    action: 'check', status: 'checked', reason: 'account-checked', login: 'valid', code: 0,
    service: { supported: true, hasDeviceIdentity: true, hasAccount: true, busy: false, retryAfterSeconds: 0 },
    retryAfterSeconds: 0, playback: 'unchecked', cacheCleared: false, deviceOutcome: 'not-requested',
  });
  assert.deepEqual(calls, ['nav', 'status']);
  assert.equal(JSON.stringify(state), before);
});

test('refresh clears only the signing cache before two reads and leaves account/device state untouched', async () => {
  const { controller, calls, state } = fixture();
  const before = JSON.stringify(state);
  const value = safe(await controller.refresh());
  assert.equal(value.status, 'refreshed');
  assert.equal(value.cacheCleared, true);
  assert.deepEqual(calls, ['clear', 'nav', 'status']);
  assert.equal(JSON.stringify(state), before);
});

for (const response of [{ code: -101 }, { code: 0, data: { isLogin: false } }]) {
  test('only explicit anonymous nav responses report invalid login: ' + response.code, async () => {
    const { controller } = fixture({ nav: () => response });
    const value = safe(await controller.check());
    assert.equal(value.status, 'login-required');
    assert.equal(value.login, 'invalid');
  });
}

for (const code of ['-101', NaN, Infinity, 0.5, 2147483648, -2147483649]) {
  test('untrusted nav error code is not coerced: ' + String(code), async () => {
    const { controller } = fixture({ nav: () => ({ code, data: { isLogin: true }, message: SECRET }) });
    const value = safe(await controller.check());
    assert.equal(value.code, null);
    assert.equal(value.login, 'unknown');
    assert.equal(value.reason, 'invalid-response');
  });
}

for (const response of [null, {}, { code: 0, data: { isLogin: 'true' } }, { code: -351, message: SECRET }]) {
  test('malformed/risk nav cannot imply an account logout: ' + JSON.stringify(response && response.code), async () => {
    const { controller } = fixture({ nav: () => response });
    const value = safe(await controller.check());
    assert.equal(value.login, 'unknown');
    assert.equal(value.status, 'failed');
    assert.equal(value.service.hasAccount, true);
  });
}

test('nav failure retains independent service status and does not expose the thrown error', async () => {
  const { controller } = fixture({ nav: () => { throw new Error(SECRET); } });
  const value = safe(await controller.check());
  assert.equal(value.reason, 'request-failed');
  assert.equal(value.login, 'unknown');
  assert.equal(value.service.hasDeviceIdentity, true);
});

test('service failure retains independent valid login without inventing missing account/device state', async () => {
  const { controller } = fixture({ status: () => Promise.reject(new Error(SECRET)) });
  const value = safe(await controller.check());
  assert.equal(value.status, 'unavailable');
  assert.equal(value.login, 'valid');
  assert.equal(value.service, null);
});

for (const key of ['supported', 'hasDeviceIdentity', 'hasAccount', 'busy']) {
  test('service flag must be an actual boolean: ' + key, async () => {
    const { controller } = fixture({ status: () => ({ ...goodStatus(), [key]: 'false' }) });
    const value = safe(await controller.check());
    assert.equal(value.status, 'unavailable');
    assert.equal(value.service, null);
  });
}

test('unsupported transport is distinguished from false account/device flags', async () => {
  const { controller } = fixture({ status: () => ({ returnValue: true, supported: false, raw: SECRET }) });
  const value = safe(await controller.check());
  assert.equal(value.status, 'unavailable');
  assert.deepEqual(value.service, { supported: false });
});

test('only bounded integer retry intervals survive service status filtering', async () => {
  for (const retryAfterSeconds of ['600', -1, Infinity, 1.5, 86401]) {
    const { controller } = fixture({ status: () => ({ ...goodStatus(), retryAfterSeconds }) });
    const value = safe(await controller.check());
    assert.equal(value.retryAfterSeconds, 0);
    assert.equal(value.service.retryAfterSeconds, 0);
  }
});

for (const action of ['check', 'refresh', 'device']) {
  test('repeat ' + action + ' shares one promise and one underlying operation', async () => {
    const pending = deferred();
    const { controller, calls } = fixture(action === 'device' ? { device: () => pending.promise } : { nav: () => pending.promise });
    const invoke = () => action === 'device' ? controller.repairDevice({ confirm: true }) : controller[action]();
    const first = invoke(), second = invoke();
    assert.strictEqual(first, second);
    await tick();
    assert.equal(calls.filter(value => value === (action === 'device' ? 'device' : 'nav')).length, 1);
    pending.resolve(action === 'device' ? goodRepair() : goodNav());
    safe(await first);
  });
}

test('a different action is busy and cannot clear caches or start device work while a check is pending', async () => {
  const pending = deferred();
  const { controller, calls } = fixture({ nav: () => pending.promise });
  const first = controller.check();
  assert.equal(safe(await controller.refresh()).status, 'busy');
  assert.equal(safe(await controller.repairDevice({ confirm: true })).status, 'busy');
  pending.resolve(goodNav());
  await first;
  assert.deepEqual(calls, ['nav', 'status']);
});

test('device action requires exact explicit confirmation and discards unrelated payload fields', async () => {
  const { controller, calls } = fixture();
  for (const options of [undefined, {}, { confirm: false }, { confirm: 'true' }, { confirm: 1 }]) {
    assert.equal(safe(await controller.repairDevice(options)).status, 'confirmation-required');
  }
  assert.deepEqual(calls, []);
  const value = safe(await controller.repairDevice({ confirm: true, cookies: SECRET }));
  assert.equal(value.status, 'repaired');
  assert.equal(value.deviceOutcome, 'changed');
  assert.equal(value.login, 'unknown');
  assert.deepEqual(calls, ['device', 'clear', 'hook']);
});

test('successful device hook can advance generation without invalidating its own completed result', async () => {
  const { controller, state } = fixture({ hook: state => { state.generation++; } });
  const value = safe(await controller.repairDevice({ confirm: true }));
  assert.equal(value.status, 'repaired');
  assert.equal(value.cacheCleared, true);
  assert.equal(state.generation, 2);
});

const serviceFailures = {
  CONFIRM_REQUIRED: ['confirmation-required', 'confirmation-required'],
  BUSY: ['busy', 'service-busy'], COOLDOWN: ['cooldown', 'service-cooldown'],
  UNSUPPORTED: ['unavailable', 'service-unavailable'], SESSION_CHANGED: ['session-changed', 'session-changed'],
  REQUEST_FAILED: ['failed', 'request-failed'], REQUEST_TIMEOUT: ['timeout', 'request-timeout'],
  INVALID_RESPONSE: ['failed', 'invalid-response'], IDENTITY_UNCHANGED: ['failed', 'identity-unchanged'],
  PERSISTENCE_FAILED: ['failed', 'persistence-failed'],
};
for (const [errorCode, [status, reason]] of Object.entries(serviceFailures)) {
  test('confirmed service failure is filtered: ' + errorCode, async () => {
    const { controller, calls } = fixture({ device: () => ({ returnValue: false, errorCode,
      error: SECRET, raw: SECRET, retryAfterSeconds: 600 }) });
    const value = safe(await controller.repairDevice({ confirm: true }));
    assert.equal(value.status, status);
    assert.equal(value.reason, reason);
    assert.equal(value.retryAfterSeconds, 600);
    assert.equal(value.deviceOutcome, 'unchanged');
    assert.deepEqual(calls, ['device']);
  });
}

for (const response of [null, { returnValue: true }, { returnValue: true, changed: true, accountPreserved: false },
  { returnValue: true, changed: 'true', accountPreserved: true }, { returnValue: false, errorCode: SECRET },
  { returnValue: false, errorCode: '__proto__' }]) {
  test('unconfirmed device result is unknown and only runs the unknown-outcome cache cleanup', async () => {
    const { controller, calls } = fixture({ device: () => response });
    const value = safe(await controller.repairDevice({ confirm: true }));
    assert.equal(value.status, 'unknown');
    assert.equal(value.deviceOutcome, 'unknown');
    assert.deepEqual(calls, ['device', 'clear', 'unknown-hook']);
  });
}

test('device transport rejection is unknown rather than a false claim of rollback', async () => {
  const { controller, calls } = fixture({ device: () => Promise.reject(new Error(SECRET)) });
  const value = safe(await controller.repairDevice({ confirm: true }));
  assert.equal(value.status, 'unknown');
  assert.equal(value.deviceOutcome, 'unknown');
  assert.deepEqual(calls, ['device', 'clear', 'unknown-hook']);
});

test('known unsupported device transport has not started a repair', async () => {
  const { controller } = fixture({ device: () => { const error = new Error(SECRET); error.code = 'UNSUPPORTED'; throw error; } });
  const value = safe(await controller.repairDevice({ confirm: true }));
  assert.equal(value.status, 'unavailable');
  assert.equal(value.deviceOutcome, 'not-started');
});

for (const mutation of [s => { s.generation++; }, s => { s.auth.SESSDATA = 'fixture-session-B'; },
  s => { s.auth.DedeUserID = 'fixture-user-B'; }]) {
  test('a session change before dispatch prevents all account/device calls', async () => {
    const { controller, state, calls } = fixture();
    const pending = controller.repairDevice({ confirm: true });
    mutation(state);
    const value = safe(await pending);
    assert.equal(value.status, 'session-changed');
    assert.equal(value.deviceOutcome, 'not-started');
    assert.deepEqual(calls, []);
  });

  test('a session change during check discards an otherwise valid late result', async () => {
    const pending = deferred();
    const { controller, state } = fixture({ nav: () => pending.promise });
    const operation = controller.check();
    await tick(); mutation(state); pending.resolve(goodNav());
    const value = safe(await operation);
    assert.equal(value.status, 'session-changed');
    assert.equal(value.login, 'unknown');
    assert.equal(value.service, null);
  });
}

test('device completion for an old session cannot clear current caches or run its success hook', async () => {
  const pending = deferred();
  const { controller, state, calls } = fixture({ device: () => pending.promise });
  const operation = controller.repairDevice({ confirm: true });
  await tick(); state.generation++; pending.resolve(goodRepair());
  const value = safe(await operation);
  assert.equal(value.status, 'session-changed');
  assert.equal(value.deviceOutcome, 'unknown');
  assert.deepEqual(calls, ['device']);
});

test('normal device/ticket changes and fresh auth object instances do not imply an account change', async () => {
  const pending = deferred();
  const { controller, state } = fixture({ nav: () => pending.promise });
  const operation = controller.check();
  await tick(); state.auth.buvid3 = 'fixture-device-new'; state.auth.bili_ticket = 'fixture-ticket-new';
  pending.resolve(goodNav());
  assert.equal(safe(await operation).status, 'checked');
});

test('read timeout permits a new operation without a late old completion releasing the new lock', async () => {
  const old = deferred(), next = deferred();
  let count = 0;
  const { controller, calls } = fixture({ timeoutMs: 20, nav: () => ++count === 1 ? old.promise : next.promise });
  const expired = safe(await controller.refresh());
  assert.equal(expired.status, 'timeout');
  assert.equal(expired.cacheCleared, true);
  const current = controller.check();
  await tick(); old.resolve(goodNav()); await tick();
  assert.strictEqual(controller.check(), current);
  next.resolve(goodNav());
  assert.equal(safe(await current).status, 'checked');
  assert.equal(calls.filter(value => value === 'nav').length, 2);
});

test('timeout retains an already confirmed login when the service status is still pending', async () => {
  const pending = deferred();
  const { controller } = fixture({ timeoutMs: 20, status: () => pending.promise });
  const value = safe(await controller.check());
  assert.equal(value.status, 'timeout');
  assert.equal(value.login, 'valid');
  assert.equal(value.code, 0);
  assert.equal(value.service, null);
  pending.resolve(goodStatus());
  await tick();
  assert.equal(value.service, null, 'late status cannot modify the returned result');
});

test('timeout retains confirmed service flags while nav remains pending', async () => {
  const pending = deferred();
  const { controller } = fixture({ timeoutMs: 20, nav: () => pending.promise });
  const value = safe(await controller.check());
  assert.equal(value.status, 'timeout');
  assert.equal(value.login, 'unknown');
  assert.equal(value.service.hasDeviceIdentity, true);
  assert.equal(value.service.hasAccount, true);
  pending.resolve(goodNav());
  await tick();
  assert.equal(value.login, 'unknown');
});

test('timeout discards partial observations if the account changes', async () => {
  const pending = deferred();
  const { controller, state } = fixture({ timeoutMs: 20, status: () => pending.promise });
  const operation = controller.check();
  await tick(); state.auth.SESSDATA = 'fixture-session-B';
  const value = safe(await operation);
  assert.equal(value.status, 'session-changed');
  assert.equal(value.login, 'unknown');
  assert.equal(value.code, null);
  assert.equal(value.service, null);
  pending.resolve(goodStatus());
});

for (const lateOutcome of ['resolve', 'reject']) {
  test('device timeout remains locked and a late ' + lateOutcome + ' cannot claim success', async () => {
    const pending = deferred();
    let count = 0;
    const { controller, calls } = fixture({ timeoutMs: 20, device: () => ++count === 1 ? pending.promise : goodRepair() });
    const expired = safe(await controller.repairDevice({ confirm: true }));
    assert.equal(expired.status, 'unknown');
    assert.equal(expired.reason, 'request-timeout');
    assert.equal(expired.deviceOutcome, 'unknown');
    assert.equal(safe(await controller.repairDevice({ confirm: true })).status, 'busy');
    assert.equal(safe(await controller.check()).status, 'busy');
    assert.deepEqual(calls, ['device', 'clear', 'unknown-hook']);
    if (lateOutcome === 'resolve') pending.resolve(goodRepair()); else pending.reject(new Error(SECRET));
    await tick();
    assert.equal(expired.status, 'unknown', 'previously returned result remains immutable in practice');
    assert.deepEqual(calls, ['device', 'clear', 'unknown-hook'], 'no automatic retry or second cleanup');
    assert.equal(safe(await controller.repairDevice({ confirm: true })).status, 'repaired');
    assert.deepEqual(calls, ['device', 'clear', 'unknown-hook', 'device', 'clear', 'hook']);
  });
}

test('unknown outcome cleanup may advance generation once while the pending device operation stays locked', async () => {
  const pending = deferred();
  const { controller, state, calls } = fixture({ timeoutMs: 20, device: () => pending.promise,
    unknownHook: state => { state.generation++; } });
  const value = safe(await controller.repairDevice({ confirm: true }));
  assert.equal(value.status, 'unknown');
  assert.equal(value.cacheCleared, true);
  assert.equal(state.generation, 2);
  assert.equal(safe(await controller.repairDevice({ confirm: true })).status, 'busy');
  pending.resolve(goodRepair()); await tick();
  assert.deepEqual(calls, ['device', 'clear', 'unknown-hook']);
  assert.equal(state.generation, 2);
  assert.equal(value.status, 'unknown');
});

test('transport failure cleanup may advance generation without turning unknown into a session error', async () => {
  const { controller, state, calls } = fixture({ device: () => Promise.reject(new Error(SECRET)),
    unknownHook: state => { state.generation++; } });
  const value = safe(await controller.repairDevice({ confirm: true }));
  assert.equal(value.status, 'unknown');
  assert.equal(state.generation, 2);
  assert.deepEqual(calls, ['device', 'clear', 'unknown-hook']);
});

test('device timeout after an account change cannot run an unknown-outcome hook against the new account', async () => {
  const pending = deferred();
  const { controller, state, calls } = fixture({ timeoutMs: 20, device: () => pending.promise });
  const operation = controller.repairDevice({ confirm: true });
  await tick(); state.generation++;
  const value = safe(await operation);
  assert.equal(value.status, 'session-changed');
  assert.deepEqual(calls, ['device']);
  pending.resolve(goodRepair()); await tick();
  assert.deepEqual(calls, ['device']);
});

test('a delayed adapter must recheck its guard before dispatching after a timeout', async () => {
  const gate = deferred();
  let dispatches = 0;
  const { controller } = fixture({ timeoutMs: 20, device: options => gate.promise.then(() => {
    options.sessionGuard();
    dispatches++;
    return goodRepair();
  }) });
  assert.equal(safe(await controller.repairDevice({ confirm: true })).status, 'unknown');
  gate.resolve(); await tick();
  assert.equal(dispatches, 0);
});

test('failed local cache clear prevents reads and allows a subsequent user retry', async () => {
  let count = 0;
  const { controller, calls } = fixture({ clear: () => { if (++count === 1) throw new Error(SECRET); } });
  assert.equal(safe(await controller.refresh()).reason, 'local-refresh-failed');
  assert.deepEqual(calls, ['clear']);
  assert.equal(safe(await controller.refresh()).status, 'refreshed');
});

test('a completed device repair remains changed when local cleanup fails and still runs the other cleanup', async () => {
  const { controller, calls } = fixture({ clear: () => { throw new Error(SECRET); } });
  const value = safe(await controller.repairDevice({ confirm: true }));
  assert.equal(value.status, 'repaired');
  assert.equal(value.reason, 'local-refresh-failed');
  assert.equal(value.cacheCleared, false);
  assert.equal(value.deviceOutcome, 'changed');
  assert.deepEqual(calls, ['device', 'clear', 'hook']);
});

test('default signing-cache dependency clears the real module cache without any network', async () => {
  const image = key => 'https://fixture.invalid/' + key.repeat(32) + '.png';
  const keys = key => ({ data: { wbi_img: { img_url: image(key), sub_url: image(key) } } });
  clearWbiKeys();
  await getWbiKeys(async () => keys('a'));
  const controller = createAccountRepair({ getAuth: () => null, getGeneration: () => 0,
    nav: goodNav, getServiceStatus: goodStatus, repairDeviceIdentity: goodRepair });
  assert.equal(safe(await controller.refresh()).status, 'refreshed');
  const next = await getWbiKeys(async () => keys('b'));
  assert.equal(next.imgKey, 'b'.repeat(32));
  clearWbiKeys();
});
