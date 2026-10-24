// Device-local recommendation preferences. Persist identifiers only: never
// titles, account IDs, tracking fields, or copies of recommendation objects.
const STORAGE_KEY = 'bili_hiddenRecommendations';
const MAX_KEYS = 500;
const MAX_STORED_LENGTH = 32768;
const BVID = /^BV[A-Za-z0-9]{10}$/;
let hiddenKeys = null;
let storageBackend = null;
let persistent = false;
const listeners = new Set();

function positiveId(value) {
  if (typeof value === 'string') {
    if (value.length > 32 || !/^\d+$/.test(value)) return null;
    value = Number(value);
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}

function validKey(value) {
  if (typeof value !== 'string') return false;
  if (value.startsWith('bv:')) return BVID.test(value.slice(3));
  if (!/^av:[1-9]\d{0,15}$/.test(value)) return false;
  return positiveId(value.slice(3)) === value.slice(3);
}

export function recommendationKey(video) {
  if (!video || typeof video !== 'object' || Array.isArray(video)) return null;
  if ((video.goto != null && video.goto !== 'av') || video.isLive || video.isBangumi ||
    video.isPgc || video.isPGC || video.pgc || video.business === 'pgc' || video.badge === '番剧' ||
    video.epid || video.ep_id || video.seasonId || video.season_id) return null;
  const uri = video.uri || video.url || video.redirect_url;
  if (typeof uri === 'string' && /(?:\/|\b)(?:ep|ss)\d+(?:\b|\/)/.test(uri)) return null;
  for (const bvid of [video.bvid, video.bv_id]) {
    if (typeof bvid === 'string' && BVID.test(bvid)) return 'bv:' + bvid;
  }
  const aid = positiveId(video.aid) || positiveId(video.id);
  return aid ? 'av:' + aid : null;
}

function ensureLoaded() {
  if (hiddenKeys) return;
  hiddenKeys = new Set();
  let raw;
  try {
    if (typeof localStorage === 'undefined') return;
    const backend = localStorage;
    if (!backend) return;
    raw = backend.getItem(STORAGE_KEY);
    // Keep an unreadable store untouched for this document. Otherwise a
    // later successful write could erase an unknown existing hidden list.
    storageBackend = backend;
  } catch (error) { return; }
  if (raw == null) { persistent = true; return; }
  if (typeof raw !== 'string' || raw.length > MAX_STORED_LENGTH) return;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const unique = Array.from(new Set(parsed.filter(validKey)));
    hiddenKeys = new Set(unique.slice(-MAX_KEYS));
    persistent = JSON.stringify(Array.from(hiddenKeys)) === raw;
  } catch (error) { /* Invalid stored content is not a preference. */ }
}

function persist() {
  if (persistent) return true;
  if (!storageBackend) return false;
  try {
    storageBackend.setItem(STORAGE_KEY, JSON.stringify(Array.from(hiddenKeys)));
    persistent = true;
  } catch (error) { persistent = false; }
  return persistent;
}

function notify() {
  // A listener may unsubscribe/re-subscribe while handling a change. A
  // snapshot prevents revisiting it forever, and one failure cannot stop UI.
  for (const listener of Array.from(listeners)) {
    if (!listeners.has(listener)) continue;
    try { listener(); } catch (error) { /* Isolate consumer callbacks. */ }
  }
}

export function getHiddenRecommendationKeys() {
  ensureLoaded();
  return new Set(hiddenKeys);
}

export function hideRecommendation(video) {
  const key = recommendationKey(video);
  if (!key) return { key: null, persistent: false, changed: false };
  ensureLoaded();
  const changed = !hiddenKeys.has(key);
  if (changed) {
    hiddenKeys.add(key);
    if (hiddenKeys.size > MAX_KEYS) hiddenKeys.delete(hiddenKeys.values().next().value);
    persistent = false;
  }
  const saved = persist();
  if (changed) notify();
  return { key, persistent: saved, changed };
}

export function restoreRecommendation(key) {
  if (!validKey(key)) return { persistent: false, changed: false };
  ensureLoaded();
  const changed = hiddenKeys.delete(key);
  if (changed) persistent = false;
  const saved = persist();
  if (changed) notify();
  return { persistent: saved, changed };
}

export function lastHiddenRecommendation() {
  ensureLoaded();
  const keys = Array.from(hiddenKeys);
  return keys.length ? keys[keys.length - 1] : null;
}

export function subscribeHiddenRecommendations(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
