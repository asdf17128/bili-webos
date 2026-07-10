// Subtitle machine-translation pipeline — pure logic, no network/DOM of its
// own (the engine and the cache store are injected), so tools/test-subtranslate.mjs
// runs it in plain Node with mocks (release-gate C-SUB-03).
//
// Strategy: translate the WHOLE track once (a few hundred short lines), then
// cache per video+language — replays and re-opens cost zero requests.

// POST-body batching limits for the gtx endpoint (form-urlencoded).
export const MT_BATCH_LINES = 100;
export const MT_BATCH_CHARS = 8000;

const LRU_KEY = 'bili_subtr_lru';
const LRU_MAX = 8; // ~30KB/track — keep localStorage well under its quota

// Split cue texts into index ranges respecting both batch limits.
export function batchRanges(texts) {
  const ranges = [];
  let start = 0, chars = 0;
  for (let i = 0; i < texts.length; i++) {
    const len = (texts[i] || '').length;
    if (i > start && (i - start >= MT_BATCH_LINES || chars + len > MT_BATCH_CHARS)) {
      ranges.push([start, i]);
      start = i; chars = 0;
    }
    chars += len;
  }
  if (start < texts.length) ranges.push([start, texts.length]);
  return ranges;
}

function readCache(store, key, want) {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // A stale entry from a different cut of the track would misalign every
    // line — only trust a cache that matches the current cue count.
    if (!data || !Array.isArray(data.t) || data.t.length !== want) return null;
    return data.t;
  } catch (e) { return null; }
}

function writeCache(store, key, texts) {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify({ t: texts }));
    let lru = [];
    try { lru = JSON.parse(store.getItem(LRU_KEY)) || []; } catch (e) { /* reset */ }
    lru = lru.filter(k => k !== key);
    lru.push(key);
    while (lru.length > LRU_MAX) store.removeItem(lru.shift());
    store.setItem(LRU_KEY, JSON.stringify(lru));
  } catch (e) { /* quota full etc — cache is best-effort */ }
}

// cues [{from,to,text}] → new array with translated text (same timings).
// translateBatchFn(texts[], tl) → Promise<translated[]> (same length, or throw).
// Throws on engine failure/misalignment — the caller falls back to the
// original track and relabels honestly.
export async function translateCues(cues, tl, translateBatchFn, cacheKey, store) {
  const texts = cues.map(c => c.text);
  let out = readCache(store, cacheKey, texts.length);
  if (!out) {
    out = [];
    for (const [a, b] of batchRanges(texts)) {
      const part = await translateBatchFn(texts.slice(a, b), tl);
      if (!Array.isArray(part) || part.length !== b - a) {
        throw new Error('translate misaligned: got ' + (part && part.length) + ' want ' + (b - a));
      }
      out.push.apply(out, part);
    }
    writeCache(store, cacheKey, out);
  }
  return cues.map((c, i) => ({ from: c.from, to: c.to, text: out[i] }));
}
