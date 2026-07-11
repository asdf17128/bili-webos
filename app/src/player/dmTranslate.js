// Danmaku machine translation — rolling-window, engine-injected, no DOM.
// (release-gate C-DM-01, tools/test-dmtranslate.mjs)
//
// Danmaku differ from subtitles: thousands per video, massively repetitive
// ("哈哈哈", "666", "泪目"…), and ephemeral. So: translate only a window ahead
// of the playhead, dedup within the batch, and share one GLOBAL text→translation
// cache across videos. Untranslated items simply don't render in MT mode
// (a Chinese flash reads as a bug on non-zh UIs); they retry on later ticks.

const textCache = new Map(); // zh text → translated (global, cross-video)
const CACHE_MAX = 3000;

function cacheSet(zh, tr) {
  textCache.set(zh, tr);
  if (textCache.size > CACHE_MAX) textCache.delete(textCache.keys().next().value);
}

// For tests.
export function _cacheSize() { return textCache.size; }
export function _cacheClear() { textCache.clear(); }

// danmakus: [{time, text, ...}] (the app's already-fetched list, any order ok).
// engine(texts[], tl) → Promise<translated[]>.
export function createDmTranslator(danmakus, tl, engine, opts) {
  const horizon = (opts && opts.horizon) || 40; // seconds ahead of playhead
  const back = (opts && opts.back) || 2;
  const maxBatch = (opts && opts.maxBatch) || 100;
  const out = new Map(); // danmaku index → translated text
  const pending = new Set(); // texts in flight (dedup across overlapping ticks)
  let stopped = false;

  // Translate the window around t. Returns how many unique texts were sent.
  async function tick(t) {
    if (stopped) return 0;
    const need = new Map(); // text → [indices] (dedup: one request per text)
    for (let i = 0; i < danmakus.length; i++) {
      const dm = danmakus[i];
      if (!dm || !dm.text || dm.time < t - back || dm.time > t + horizon) continue;
      if (out.has(i)) continue;
      const hit = textCache.get(dm.text);
      if (hit) { out.set(i, hit); continue; }
      if (pending.has(dm.text)) continue;
      if (!need.has(dm.text)) need.set(dm.text, []);
      need.get(dm.text).push(i);
    }
    const texts = Array.from(need.keys()).slice(0, maxBatch);
    if (texts.length === 0) return 0;
    texts.forEach(x => pending.add(x));
    try {
      const res = await engine(texts, tl);
      if (!stopped && Array.isArray(res)) {
        texts.forEach((x, k) => {
          const tr = res[k] || x;
          cacheSet(x, tr);
          (need.get(x) || []).forEach(i => out.set(i, tr));
        });
      }
    } catch (e) {
      // Engine hiccup: leave untranslated — the next tick retries the window.
    } finally {
      texts.forEach(x => pending.delete(x));
    }
    return texts.length;
  }

  return {
    tick,
    get: (i) => out.get(i) || null,
    stop: () => { stopped = true; },
  };
}
