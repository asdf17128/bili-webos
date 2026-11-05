// Independent, bounded protobuf reader for the public danmaku segment response.
// Unknown fields are skipped; IDs stay strings to avoid int64 precision loss.
export function parseDanmakuSegment(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 4 * 1024 * 1024) throw new Error('Invalid danmaku segment size');
  const decoder = new TextDecoder('utf-8');
  function fields(start, end, visit) {
    let pos = start;
    const integer = () => {
      let value = 0, factor = 1;
      for (let n = 0; n < 10; n++) {
        if (pos >= end) throw new Error('Truncated danmaku varint');
        const byte = bytes[pos++]; value += (byte & 127) * factor;
        if (!(byte & 128)) return value;
        factor *= 128;
      }
      throw new Error('Invalid danmaku varint');
    };
    while (pos < end) {
      const tag = integer(), field = Math.floor(tag / 8), wire = tag % 8;
      if (!field) throw new Error('Invalid danmaku field');
      if (wire === 0) visit(field, wire, integer());
      else if (wire === 2) {
        const size = integer(), from = pos;
        if (!Number.isSafeInteger(size) || size < 0 || size > end - pos) throw new Error('Truncated danmaku field');
        pos += size; visit(field, wire, from, pos);
      } else if (wire === 1 || wire === 5) {
        pos += wire === 1 ? 8 : 4;
        if (pos > end) throw new Error('Truncated danmaku fixed field');
      } else throw new Error('Unsupported danmaku wire type');
    }
  }
  const items = [];
  fields(0, bytes.length, (field, wire, from, to) => {
    if (field === 2 && wire === 0 && from !== 0) throw new Error('Danmaku segment unavailable');
    if (field !== 1 || wire !== 2) return;
    if (items.length >= 50000) throw new Error('Danmaku segment item limit');
    const item = { time: 0, mode: 1, size: 28, color: '#ffffff', text: '' };
    fields(from, to, (f, w, value, end) => {
      if (w === 0 && f === 2) item.time = value / 1000;
      else if (w === 0 && f === 3) item.mode = value;
      else if (w === 0 && f === 4) item.size = value;
      else if (w === 0 && f === 5) item.color = '#' + (value % 16777216).toString(16).padStart(6, '0');
      else if (w === 2 && (f === 7 || f === 12)) {
        if (end - value > 4096) throw new Error('Danmaku text limit');
        item[f === 7 ? 'text' : 'id'] = decoder.decode(bytes.subarray(value, end));
      }
    });
    if (item.text && Number.isFinite(item.time) && item.time >= 0) items.push(item);
  });
  items.sort((a, b) => a.time - b.time);
  // Spread the retained sample over the whole segment, never truncate its tail.
  if (items.length > 20000) return Array.from({ length: 20000 }, (_, i) => items[Math.floor(i * items.length / 20000)]);
  return items;
}

// One in-flight request, current segment first, one ahead; at most three
// segments retained. Late results after seek/exit never replace current data.
export function createDanmakuSegments({ fetchSegment, fetchFallback, onItems, now = Date.now }) {
  const cache = new Map(), failed = new Map();
  let target = 1, last = Infinity, enabled = true, disposed = false, busy = false;
  let fallback = null, fallbackTried = false, published = '', revision = 0;
  const stats = { requests: 0, failures: 0, discarded: 0, fallback: false, cached: 0, items: 0, pending: 0 };
  const inside = n => n >= Math.max(1, target - 1) && n <= Math.min(last, target + 1);
  function publish() {
    if (disposed || !enabled) return;
    const key = target + ':' + (cache.has(target) ? 'segment' : fallback ? 'fallback' : 'empty') + ':' + (cache.has(target - 1) ? 'previous' : 'none');
    if (published === key) return;
    published = key;
    const all = [];
    cache.forEach((list, n) => { if (inside(n)) list.forEach(item => all.push(item)); });
    if (fallback) fallback.forEach(item => {
      const n = Math.floor(item.time / 360) + 1;
      if (inside(n) && !cache.has(n)) all.push(item);
    });
    const seen = new Set();
    const items = all.filter(item => {
      const id = item.id || [item.time, item.mode, item.color, item.text].join('|');
      if (seen.has(id)) return false; seen.add(id); return true;
    }).sort((a, b) => a.time - b.time);
    stats.cached = cache.size; stats.items = items.length;
    onItems(items);
  }
  async function pump() {
    if (disposed || !enabled || busy) return;
    const segment = [target, target + 1].find(n => n <= last && !cache.has(n) && (failed.get(n) || 0) <= now());
    if (!segment) return;
    busy = true; stats.pending = 1; stats.requests++;
    try {
      const items = await fetchSegment(segment);
      if (disposed) return;
      if (inside(segment)) { cache.set(segment, items); revision++; }
      else stats.discarded++;
    } catch (error) {
      if (disposed) return;
      stats.failures++; failed.set(segment, now() + 30000);
      if (!fallbackTried && inside(segment) && enabled) {
        fallbackTried = true;
        try { const result = await fetchFallback(); if (!disposed) { fallback = result.slice(0, 20000); stats.fallback = true; revision++; } } catch (_) { /* playback must remain usable */ }
      }
    } finally {
      busy = false; stats.pending = 0;
      if (!disposed) { publish(); pump(); }
    }
  }
  return {
    update(time, duration, active = true) {
      if (disposed) return;
      enabled = active;
      last = Number.isFinite(duration) && duration > 0 ? Math.max(1, Math.ceil(duration / 360)) : Infinity;
      target = Math.min(last, Math.max(1, Math.floor((Number.isFinite(time) ? Math.max(0, time) : 0) / 360) + 1));
      cache.forEach((_, n) => { if (!inside(n)) { cache.delete(n); revision++; } });
      failed.forEach((_, n) => { if (!inside(n)) failed.delete(n); });
      publish(); pump();
    },
    stats: () => ({ ...stats, cached: cache.size }),
    dispose() { disposed = true; cache.clear(); failed.clear(); fallback = null; stats.items = 0; },
  };
}
