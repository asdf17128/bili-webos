import { Inflate } from 'pako';
export const MASK_LIMITS = { segments: 2048, compressed: 512 * 1024, inflated: 2 * 1024 * 1024, frames: 600, frameBytes: 65536 };
const integer64 = (v, at) => {
  const n = v.getUint32(at) * 4294967296 + v.getUint32(at + 4);
  if (!Number.isSafeInteger(n)) throw Error('Mask integer overflow');
  return n;
};
export function maskUrl(value) {
  try {
    const u = new URL(value?.startsWith('//') ? 'https:' + value : value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && /(^|\.)bilivideo\.com$/.test(u.hostname) && /^\/cmaskboss\/[\w-]+\.webmask$/.test(u.pathname) ? u.href : null;
  } catch (_) { return null; }
}
export function maskHeader(bytes) {
  if (bytes.length < 16 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'MASK') throw Error('Invalid mask header');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = v.getUint32(12);
  if (v.getUint32(4) !== 1 || count < 1 || count > MASK_LIMITS.segments) throw Error('Unsupported mask');
  return 16 + count * 16;
}
export function maskIndex(bytes) {
  const length = maskHeader(bytes);
  if (bytes.length !== length) throw Error('Truncated mask index');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = [];
  for (let p = 16; p < length; p += 16) {
    const time = integer64(v, p), offset = integer64(v, p + 8), prior = result[result.length - 1];
    if (offset < length || offset > 128 * 1024 * 1024 || (prior && (time <= prior.time || offset <= prior.offset))) throw Error('Invalid mask index');
    result.push({ time, offset });
  }
  return result;
}
export function decodeMaskSegment(bytes, start, end) {
  if (!bytes.length || bytes.length > MASK_LIMITS.compressed) throw Error('Mask compressed limit');
  const chunks = []; let length = 0;
  const decoder = new Inflate({ chunkSize: 16384 });
  decoder.onData = chunk => {
    length += chunk.length;
    if (length > MASK_LIMITS.inflated) throw Error('Mask inflated limit');
    chunks.push(chunk);
  };
  decoder.push(bytes, true);
  if (decoder.err || !decoder.ended) throw Error('Invalid compressed mask');
  const data = new Uint8Array(length); let pos = 0;
  chunks.forEach(chunk => { data.set(chunk, pos); pos += chunk.length; });
  const view = new DataView(data.buffer), text = new TextDecoder('utf-8', { fatal: true }), frames = [];
  for (pos = 0; pos < length;) {
    if (pos + 12 > length || frames.length >= MASK_LIMITS.frames) throw Error('Mask frame limit');
    const size = view.getUint32(pos), time = integer64(view, pos + 4); pos += 12;
    if (!size || size > MASK_LIMITS.frameBytes || size > length - pos || time < start || time >= end || (frames.length && time < frames[frames.length - 1].time)) throw Error('Invalid mask frame');
    const uri = text.decode(data.subarray(pos, pos + size)).replace(/\s/g, ''); pos += size;
    if (!/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(uri)) throw Error('Invalid mask image');
    frames.push({ time, uri });
  }
  return frames;
}
// Parse untrusted SVG as inert XML, then allow only geometry and numeric style.
// No scripts, links, images, filters, CSS or external resources cross this boundary.
export function safeMaskImage(uri) {
  const svg = atob(uri.slice('data:image/svg+xml;base64,'.length));
  if (svg.length > 49152 || /<!DOCTYPE|<!ENTITY/i.test(svg)) throw Error('Invalid mask SVG');
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.documentElement.localName !== 'svg' || doc.querySelector('parsererror')) throw Error('Invalid mask SVG');
  const nodes = doc.getElementsByTagName('*');
  if (nodes.length > 512) throw Error('Mask geometry limit');
  const numeric = new Set(['x','y','width','height','viewBox','cx','cy','r','rx','ry','points','opacity','fill-opacity','stroke-width']);
  for (const node of Array.from(nodes)) {
    if (!['svg','g','path','rect','circle','ellipse','polygon','polyline'].includes(node.localName)) throw Error('Unsafe mask element');
    for (const a of Array.from(node.attributes)) {
      const k = a.name, v = a.value;
      if (k === 'xmlns' && v === 'http://www.w3.org/2000/svg' || k === 'version' && v === '1.0') continue;
      if (numeric.has(k) && /^[0-9eE+.,\s-]+(?:px)?$/.test(v)) continue;
      if (k === 'd' && /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(v)) continue;
      if (k === 'transform' && /^(?:(?:translate|scale|rotate|matrix|skewX|skewY)\([0-9eE+.,\s-]+\)\s*)+$/.test(v)) continue;
      if ((k === 'fill' || k === 'stroke') && /^(?:#[0-9a-fA-F]{3,8}|none|black|white)$/.test(v)) continue;
      if (k === 'fill-rule' && /^(nonzero|evenodd)$/.test(v)) continue;
      if (k === 'preserveAspectRatio' && /^(xMidYMid meet|none)$/.test(v)) continue;
      throw Error('Unsafe mask attribute');
    }
  }
  return 'data:image/svg+xml;base64,' + btoa(new XMLSerializer().serializeToString(doc.documentElement));
}
export function maskFrame(frames, time) {
  let lo = 0, hi = frames.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (frames[mid].time <= time) lo = mid + 1; else hi = mid; }
  const frame = frames[lo - 1];
  // Never freeze an old silhouette across a gap or a seek.
  return frame && time - frame.time <= 250 ? frame : null;
}
