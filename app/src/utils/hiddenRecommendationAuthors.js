import { recommendationKey } from './hiddenRecommendations.js';

// Local recommendation rules contain only account scopes and author IDs.
// Credentials, author names and recommendation context never enter this store.
const STORAGE_KEY = 'bili_hiddenRecommendationAuthors';
const MAX_KEYS = 500;
const MAX_SCOPES = 8;
const MAX_STORED_LENGTH = 131072;
let scopes = null;
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
  return typeof value === 'string' && /^up:[1-9]\d{0,15}$/.test(value) && positiveId(value.slice(3)) === value.slice(3);
}

function validScope(scope) {
  return scope === 'guest' || (typeof scope === 'string' && /^user:[1-9]\d{0,15}$/.test(scope) && positiveId(scope.slice(5)) === scope.slice(5));
}

export function recommendationAuthorKey(video) {
  if (!recommendationKey(video) || !video.owner || typeof video.owner !== 'object' || Array.isArray(video.owner)) return null;
  const mid = positiveId(video.owner.mid);
  return mid ? 'up:' + mid : null;
}

export function recommendationAccountScope(auth) {
  if (!auth?.SESSDATA) return 'guest';
  const uid = positiveId(auth.DedeUserID);
  return uid ? 'user:' + uid : null;
}

function serialized() {
  return JSON.stringify(Array.from(scopes, ([scope, keys]) => [scope, Array.from(keys)]));
}

function ensureLoaded() {
  if (scopes) return;
  scopes = new Map();
  let raw;
  try {
    if (typeof localStorage === 'undefined') return;
    const backend = localStorage;
    if (!backend) return;
    raw = backend.getItem(STORAGE_KEY);
    // An unreadable store might hold preferences we cannot inspect. Keep this
    // document in memory mode instead of overwriting them after a later retry.
    storageBackend = backend;
  } catch (error) { return; }
  if (raw == null) { persistent = true; return; }
  if (typeof raw !== 'string' || raw.length > MAX_STORED_LENGTH) return;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2 || !validScope(entry[0]) || !Array.isArray(entry[1])) continue;
      const keys = new Set([...(scopes.get(entry[0]) || []), ...entry[1].filter(validKey)]);
      if (!keys.size) continue;
      scopes.set(entry[0], keys);
    }
    scopes = new Map(Array.from(scopes).slice(-MAX_SCOPES).map(([scope, keys]) => [scope, new Set(Array.from(keys).slice(-MAX_KEYS))]));
    persistent = serialized() === raw;
  } catch (error) { /* Invalid content is not a preference. */ }
}

function persist() {
  if (persistent) return true;
  if (!storageBackend) return false;
  try {
    storageBackend.setItem(STORAGE_KEY, serialized());
    persistent = true;
  } catch (error) { persistent = false; }
  return persistent;
}

function notify() {
  for (const listener of Array.from(listeners)) {
    if (!listeners.has(listener)) continue;
    try { listener(); } catch (error) { /* Isolate consumer callbacks. */ }
  }
}

export function getHiddenRecommendationAuthorKeys(scope) {
  if (!validScope(scope)) return new Set();
  ensureLoaded();
  return new Set(scopes.get(scope));
}

export function hideRecommendationAuthor(video, scope) {
  const key = recommendationAuthorKey(video);
  if (!key || !validScope(scope)) return { key: null, persistent: false, changed: false, supported: false };
  ensureLoaded();
  const keys = scopes.get(scope) || new Set();
  const changed = !keys.has(key);
  if (changed) {
    keys.add(key);
    if (keys.size > MAX_KEYS) keys.delete(keys.values().next().value);
    scopes.set(scope, keys);
    if (scopes.size > MAX_SCOPES) scopes.delete(scopes.keys().next().value);
    persistent = false;
  }
  const saved = persist();
  if (changed) notify();
  return { key, persistent: saved, changed, supported: true };
}

export function restoreRecommendationAuthor(key, scope) {
  if (!validKey(key) || !validScope(scope)) return { persistent: false, changed: false, supported: false };
  ensureLoaded();
  const keys = scopes.get(scope);
  const changed = keys ? keys.delete(key) : false;
  if (changed) {
    if (!keys.size) scopes.delete(scope);
    persistent = false;
  }
  const saved = persist();
  if (changed) notify();
  return { persistent: saved, changed, supported: true };
}

export function lastHiddenRecommendationAuthor(scope) {
  const keys = Array.from(getHiddenRecommendationAuthorKeys(scope));
  return keys.length ? keys[keys.length - 1] : null;
}

export function subscribeHiddenRecommendationAuthors(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
