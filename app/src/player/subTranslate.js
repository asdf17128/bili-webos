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

// Order batch ranges so the one containing startIndex runs FIRST, then the
// ones after it (what's about to play), then the ones before (rewind case) —
// the stretch the user is watching turns translated soonest.
export function orderRanges(ranges, startIndex) {
  const at = ranges.findIndex(([a, b]) => startIndex >= a && startIndex < b);
  if (at <= 0) return ranges.slice();
  return ranges.slice(at).concat(ranges.slice(0, at));
}

// cues [{from,to,text}] → new array with translated text (same timings).
// translateBatchFn(texts[], tl) → Promise<translated[]> (same length, or throw).
//
// A 40-minute track is ~8 batches; serially that was 5s+ of Chinese before
// the swap. Now: batches run CONCURRENTLY (pool), each landed batch fires
// onPartial(mergedCues) so the screen turns translated progressively, and the
// playhead's batch goes first (~one round-trip to first translated cue).
//
// Any batch failing (after one retry) still throws — the caller reverts to
// the source track and relabels; a permanently half-translated track lying
// under an "(translated)" label is worse than falling back.
export async function translateCues(cues, tl, translateBatchFn, cacheKey, store, opts) {
  const { onPartial, startIndex = 0, concurrency = 4 } = opts || {};
  const texts = cues.map(c => c.text);
  let out = readCache(store, cacheKey, texts.length);
  if (!out) {
    const slots = new Array(texts.length).fill(null);
    const queue = orderRanges(batchRanges(texts), startIndex);
    const runOne = async ([a, b]) => {
      const part = await translateBatchFn(texts.slice(a, b), tl);
      if (!Array.isArray(part) || part.length !== b - a) {
        throw new Error('translate misaligned: got ' + (part && part.length) + ' want ' + (b - a));
      }
      for (let i = a; i < b; i++) slots[i] = part[i - a];
      if (onPartial) {
        onPartial(cues.map((c, i) => (slots[i] != null ? { from: c.from, to: c.to, text: slots[i] } : c)));
      }
    };
    const failed = [];
    const workers = [];
    let next = 0;
    for (let w = 0; w < Math.min(concurrency, queue.length); w++) {
      workers.push((async function work() {
        while (next < queue.length) {
          const range = queue[next++];
          try { await runOne(range); } catch (e) { failed.push(range); }
        }
      })());
    }
    await Promise.all(workers);
    // one sequential retry round for stragglers (transient CDN/engine hiccups)
    for (const range of failed.splice(0)) {
      try { await runOne(range); } catch (e) { failed.push(range); }
    }
    if (failed.length > 0) throw new Error('translate failed for ' + failed.length + ' batch(es)');
    out = slots;
    writeCache(store, cacheKey, out);
  }
  return cues.map((c, i) => ({ from: c.from, to: c.to, text: out[i] }));
}
