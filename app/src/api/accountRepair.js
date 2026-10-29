import { clearWbiKeys as clearSigningKeys } from './wbi.js';

const SERVICE_FAILURES = {
  CONFIRM_REQUIRED: ['confirmation-required', 'confirmation-required'],
  BUSY: ['busy', 'service-busy'],
  COOLDOWN: ['cooldown', 'service-cooldown'],
  UNSUPPORTED: ['unavailable', 'service-unavailable'],
  SESSION_CHANGED: ['session-changed', 'session-changed'],
  REQUEST_FAILED: ['failed', 'request-failed'],
  REQUEST_TIMEOUT: ['timeout', 'request-timeout'],
  INVALID_RESPONSE: ['failed', 'invalid-response'],
  IDENTITY_UNCHANGED: ['failed', 'identity-unchanged'],
  PERSISTENCE_FAILED: ['failed', 'persistence-failed'],
};

function numericCode(value) {
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? value : null;
}

function retrySeconds(value) {
  return Number.isInteger(value) && value >= 0 && value <= 86400 ? value : 0;
}

function result(action, status, reason, fields = {}) {
  return {
    action, status, reason, login: 'unknown', code: null, service: null,
    retryAfterSeconds: 0, playback: 'unchecked', cacheCleared: false,
    deviceOutcome: action === 'device' ? 'not-started' : 'not-requested',
    ...fields,
  };
}

function readServiceStatus(value) {
  if (!value || value.returnValue !== true) return null;
  if (value.supported === false) return { supported: false };
  if (value.supported !== true || typeof value.hasDeviceIdentity !== 'boolean' ||
      typeof value.hasAccount !== 'boolean' || typeof value.busy !== 'boolean') return null;
  return {
    supported: true,
    hasDeviceIdentity: value.hasDeviceIdentity,
    hasAccount: value.hasAccount,
    busy: value.busy,
    retryAfterSeconds: retrySeconds(value.retryAfterSeconds),
  };
}

function loginStatus(value) {
  const code = numericCode(value && value.code);
  if (code === -101 || (code === 0 && value.data && value.data.isLogin === false)) {
    return { login: 'invalid', code };
  }
  if (code === 0 && value.data && value.data.isLogin === true) return { login: 'valid', code };
  return { login: 'unknown', code };
}

// Nothing from an upstream error message, response body or credential snapshot
// is returned. The adapter may mark an unsupported local transport explicitly.
function unavailable(error) {
  return !!error && (error.code === 'UNSUPPORTED' || error.errorCode === 'UNSUPPORTED');
}

/**
 * A shared controller for account checks and explicit device repair. Dependencies
 * receive { sessionGuard } and must invoke it again at actual dispatch/receipt.
 * getAuth/getGeneration are read-only; credentials stay in a private snapshot.
 * Device cleanup hooks are synchronous and run after the final session check,
 * so they may invalidate the caller's generation while clearing local caches.
 * An unknown outcome also discards local device caches: a service commit may
 * have completed even when its response was lost. This never implies success.
 */
export function createAccountRepair({
  getAuth, getGeneration, nav, getServiceStatus, repairDeviceIdentity,
  clearWbiKeys = clearSigningKeys, onDeviceRepaired = () => {}, onDeviceUnknown = () => {}, timeoutMs = 10000,
}) {
  const dependencies = { getAuth, getGeneration, nav, getServiceStatus, repairDeviceIdentity,
    clearWbiKeys, onDeviceRepaired, onDeviceUnknown };
  for (const name of Object.keys(dependencies)) {
    if (typeof dependencies[name] !== 'function') throw new TypeError('Missing account repair dependency: ' + name);
  }
  const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000;
  let active = null;

  function snapshot() {
    const auth = getAuth() || {};
    return { generation: getGeneration(), session: auth.SESSDATA, user: auth.DedeUserID };
  }

  function current(saved) {
    const next = snapshot();
    return saved.generation === next.generation && saved.session === next.session && saved.user === next.user;
  }

  function sessionGuard(entry) {
    if (entry.finished || !current(entry.snapshot)) {
      const error = new Error('Account repair request expired');
      error.code = 'ACCOUNT_REPAIR_EXPIRED';
      throw error;
    }
  }

  function changed(entry) {
    try { return !current(entry.snapshot); } catch { return true; }
  }

  function sessionResult(entry, action = entry.action) {
    return result(action, 'session-changed', 'session-changed', {
      cacheCleared: entry.cacheCleared,
      deviceOutcome: action === 'device' && entry.action === 'device' && entry.dispatched ? 'unknown' :
        action === 'device' ? 'not-started' : 'not-requested',
    });
  }

  function finalizeResult(entry, value) {
    if (changed(entry)) return sessionResult(entry);
    if (entry.action === 'device' && (value.status === 'repaired' || value.deviceOutcome === 'unknown')) {
      // No await or old-generation guard after these hooks: callers deliberately
      // advance their generation to prevent late reads restoring device caches.
      try { clearWbiKeys(); value.cacheCleared = true; }
      catch { value.reason = 'local-refresh-failed'; }
      try { (value.status === 'repaired' ? onDeviceRepaired : onDeviceUnknown)(); }
      catch { value.reason = 'local-refresh-failed'; }
    }
    return value;
  }

  function run(action, execute) {
    if (active) {
      // An unknown-result hook may have advanced the local generation. The
      // still-pending device operation keeps its lock until transport settlement.
      if (!active.finished && changed(active)) return Promise.resolve(sessionResult(active, action));
      if (active.action === action && !active.finished) return active.promise;
      return Promise.resolve(result(action, 'busy', 'operation-pending', {
        deviceOutcome: action === 'device' && active.action === 'device' ? 'unknown' :
          action === 'device' ? 'not-started' : 'not-requested',
      }));
    }
    let saved;
    try { saved = snapshot(); } catch { return Promise.resolve(result(action, 'failed', 'session-unavailable')); }
    const entry = { action, snapshot: saved, finished: false, dispatched: false, cacheCleared: false,
      observed: {}, promise: null };
    active = entry;
    entry.promise = new Promise(resolve => {
      const timer = setTimeout(() => {
        if (entry.finished) return;
        const value = finalizeResult(entry,
          result(action, action === 'device' ? 'unknown' : 'timeout', 'request-timeout', {
            ...entry.observed,
            cacheCleared: entry.cacheCleared,
            deviceOutcome: action === 'device' && entry.dispatched ? 'unknown' :
              action === 'device' ? 'not-started' : 'not-requested',
          }));
        entry.finished = true;
        // A timed-out read can be replaced safely. A device operation remains
        // locked until its transport settles; the service also enforces a lock
        // and cooldown because a transport timeout does not cancel service work.
        if (action !== 'device' && active === entry) active = null;
        resolve(value);
      }, deadline);

      function finish(value) {
        if (!entry.finished) {
          value = finalizeResult(entry, value);
          entry.finished = true;
          clearTimeout(timer);
          resolve(value);
        }
        if (active === entry) active = null;
      }

      Promise.resolve().then(() => {
        sessionGuard(entry);
        return execute(entry, { sessionGuard: () => sessionGuard(entry) });
      }).then(finish, error => finish(result(action,
        action === 'device' && entry.dispatched && !unavailable(error) ? 'unknown' :
          unavailable(error) ? 'unavailable' : 'failed',
        unavailable(error) ? 'service-unavailable' : 'request-failed', {
          deviceOutcome: action === 'device' && entry.dispatched && !unavailable(error) ? 'unknown' :
            action === 'device' ? 'not-started' : 'not-requested',
        })));
    });
    return entry.promise;
  }

  function inspect(action) {
    return run(action, async (entry, options) => {
      let cacheCleared = false;
      if (action === 'refresh') {
        try { clearWbiKeys(); }
        catch { return result(action, 'failed', 'local-refresh-failed'); }
        cacheCleared = entry.cacheCleared = true;
      }
      async function read(fn, kind) {
        try {
          options.sessionGuard();
          const value = await fn(options);
          options.sessionGuard();
          if (kind === 'account') Object.assign(entry.observed, loginStatus(value));
          else {
            const service = readServiceStatus(value);
            entry.observed.service = service;
            entry.observed.retryAfterSeconds = service && service.retryAfterSeconds || 0;
          }
          return { ok: true, value };
        } catch { return { ok: false }; }
      }
      // Keep the two results independent: a failed nav must not erase a valid
      // local-service status, and a missing bridge must not invent a logout.
      const [account, serviceResult] = await Promise.all([read(nav, 'account'), read(getServiceStatus, 'service')]);
      options.sessionGuard();
      const accountStatus = account.ok ? loginStatus(account.value) : { login: 'unknown', code: null };
      const service = serviceResult.ok ? readServiceStatus(serviceResult.value) : null;
      const fields = { ...accountStatus, service, cacheCleared,
        retryAfterSeconds: service && service.retryAfterSeconds || 0 };
      if (accountStatus.login === 'invalid') return result(action, 'login-required', 'login-required', fields);
      if (!account.ok) return result(action, 'failed', 'request-failed', fields);
      if (accountStatus.login === 'unknown') return result(action, 'failed',
        accountStatus.code !== null && accountStatus.code !== 0 ? 'nav-rejected' : 'invalid-response', fields);
      if (!service || !service.supported) return result(action, 'unavailable', 'service-unavailable', fields);
      return result(action, action === 'refresh' ? 'refreshed' : 'checked',
        action === 'refresh' ? 'cache-cleared' : 'account-checked', fields);
    });
  }

  function repairDevice(options) {
    if (!options || options.confirm !== true) {
      return Promise.resolve(result('device', 'confirmation-required', 'confirmation-required'));
    }
    return run('device', async (entry, guards) => {
      guards.sessionGuard();
      entry.dispatched = true;
      const value = await repairDeviceIdentity({ confirm: true }, guards);
      guards.sessionGuard();
      if (value && value.returnValue === true && value.changed === true && value.accountPreserved === true) {
        return result('device', 'repaired', 'device-updated', { deviceOutcome: 'changed' });
      }
      const failure = value && value.returnValue === false &&
        Object.prototype.hasOwnProperty.call(SERVICE_FAILURES, value.errorCode) && SERVICE_FAILURES[value.errorCode];
      if (failure) return result('device', failure[0], failure[1], {
        retryAfterSeconds: retrySeconds(value.retryAfterSeconds), deviceOutcome: 'unchanged',
      });
      // A malformed success/failure cannot prove whether a commit happened.
      return result('device', 'unknown', 'invalid-response', { deviceOutcome: 'unknown' });
    });
  }

  function status() {
    return run('status', async (entry, guards) => {
      const service = readServiceStatus(await getServiceStatus(guards));
      guards.sessionGuard();
      return result('status', service?.supported ? 'checked' : 'unavailable', 'service-status', { service });
    });
  }

  return { check: () => inspect('check'), refresh: () => inspect('refresh'), status, repairDevice };
}
