// List-title machine translation for non-zh UIs (matches the official
// international app: feed/search/related card titles are translated too).
//
// Design: a render-time lookup + a debounced batch queue. titleMT(t) returns
// the cached translation or the original (and enqueues it); when a batch
// lands, subscribers re-render and the lookup hits. Chinese UI = straight
// pass-through, zero work, zero subscriptions.
import { useEffect, useReducer } from 'react';
import { getLocale } from '../i18n';
import { gtxTranslate } from '../api/client';

const cache = new Map(); // zh title → translated
const CACHE_MAX = 800;   // ~a session of browsing; drop oldest beyond this
const queue = new Set();
const subs = new Set();
let timer = null;
let inFlight = false;

function flushLater() {
  if (!timer && !inFlight) timer = setTimeout(flush, 200); // coalesce a page of cards into one request
}

async function flush() {
  timer = null;
  if (queue.size === 0) return;
  const batch = Array.from(queue).slice(0, 100);
  batch.forEach(t => queue.delete(t));
  inFlight = true;
  try {
    // 5s cap: a hung engine must not leave titles blank forever — fall
    // through to the originals instead.
    const out = await Promise.race([
      gtxTranslate(batch, getLocale()),
      new Promise((_, rej) => setTimeout(() => rej(new Error('mt-timeout')), 5000)),
    ]);
    batch.forEach((t, i) => {
      cache.set(t, (out && out[i]) || t);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    });
  } catch (e) {
    // Engine unreachable — cache originals so we don't hammer it per render.
    batch.forEach(t => cache.set(t, t));
  }
  subs.forEach(fn => fn());
  inFlight = false;
  if (queue.size > 0) flushLater();
}

// Pending translations render as EMPTY (title pops in translated ~one round
// trip later) — showing the Chinese first and swapping read as a bug on
// non-zh UIs (owner report). Engine failure caches the originals, so text
// always appears within the 5s cap.
export function titleMT(title) {
  if (!title || getLocale() === 'zh') return title;
  const hit = cache.get(title);
  if (hit) return hit;
  if (!queue.has(title)) { queue.add(title); flushLater(); }
  return '';
}

// Subscribe a component to batch arrivals. No-op on zh UIs (memo()'d cards
// keep their zero-overhead render path).
export function useTitlesMT() {
  const [v, bump] = useReducer(x => x + 1, 0);
  useEffect(() => {
    if (getLocale() === 'zh') return undefined;
    subs.add(bump);
    return () => subs.delete(bump);
  }, []);
  return v;
}
