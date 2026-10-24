// Public author statistics only. Nothing is persisted: the bounded cache holds
// author IDs, counts and expiry times, never profile data or account credentials.
export function normalizeAuthorMid(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
}

export function authorFollowerCount(response) {
  const count = response?.data?.follower;
  return response?.code === 0 && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function createAuthorFollowersStore(request, {
  now = Date.now, ttlMs = 5 * 60 * 1000, errorTtlMs = 30 * 1000,
  maxEntries = 64, timeoutMs = 12 * 1000,
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  const cache = new Map(), pending = new Map();

  function read(mid) {
    const item = cache.get(mid);
    if (!item) return null;
    if (item.expiresAt <= now()) { cache.delete(mid); return null; }
    // Map insertion order is the LRU order, with a hard cap even during zapping.
    cache.delete(mid);
    cache.set(mid, item);
    return item;
  }

  function load(value) {
    const mid = normalizeAuthorMid(value);
    if (!mid) return Promise.resolve(null);
    const active = pending.get(mid);
    if (active) return active.promise;
    const cached = read(mid);
    if (cached) return Promise.resolve(cached.count);
    if (pending.size >= maxEntries) return Promise.resolve(null);

    let resolve, timer;
    const entry = { promise: new Promise(done => { resolve = done; }) };
    pending.set(mid, entry);
    const finish = count => {
      // A deadline releases this entry. Its late response must not overwrite a
      // retry's count or remove that retry from the in-flight deduplication map.
      if (pending.get(mid) !== entry) return;
      clearTimer(timer);
      pending.delete(mid);
      cache.delete(mid);
      cache.set(mid, { count, expiresAt: now() + (count == null ? errorTtlMs : ttlMs) });
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      resolve(count);
    };
    timer = setTimer(() => finish(null), timeoutMs);
    Promise.resolve().then(() => request(mid)).then(
      response => finish(authorFollowerCount(response)),
      () => finish(null),
    );
    return entry.promise;
  }

  return { load };
}
