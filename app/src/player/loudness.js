// PARKED — not wired into the player (owner 2026-08-02: "效果不怎么理想,
// 先拿出来再考虑"). Kept because the measurement side is correct and tested
// (tools/test-loudness.mjs; cross-checked against ffmpeg ebur128 to <1dB).
// The open question is the ACTUATOR: video.volume is the only lever webOS
// leaves us (WebAudio reads silence, luna setVolume refuses MSE pipelines),
// and cut-only leveling never lifts quiet uploads.
//
// 音量均衡 (volume leveling), YouTube-style: measure BS.1770 K-weighted gated
// loudness (LUFS) client-side and attenuate videos louder than a -14 LUFS
// reference (YouTube's target; attenuate-only, quiet videos untouched).
//
// Why client-side at all: B站 exposes no loudness metadata, and on webOS the
// hardware audio path bypasses Web Audio (MediaElementSource reads silence —
// probed on-device 2026-07-26), so a live compressor is impossible. What DOES
// work on TV silicon is decodeAudioData on real AAC segments (~1s per 768KB).
//
// Sampling: naive mid-file Range fetches decode as silence (fMP4 needs moof
// alignment — ffmpeg calibration run showed -70 LUFS garbage), so we parse the
// stream's sidx index and fetch 3 PROPERLY ALIGNED windows (~10%/40%/70%).
// Ground truth 2026-07-26 (ffmpeg ebur128 over owner's watch history):
// spread -9.2 .. -28.9 LUFS — a 20 dB gap between adjacent videos.

// -20 (not YouTube's -14): attenuate-only means the reference IS the common
// level everything lands on — a low reference pulls nearly all content (B站
// mainstream ≈ -16…-20) onto one line, and the user turns the TV up once.
// Owner: "统一给用户的大小" — this is as unified as cut-only can get; true
// boost for ultra-quiet uploads needs the AAC global_gain rewrite (planned).
export const TARGET_LUFS = -20;
export const MIN_GAIN = 0.15;         // allow up to ~ -16.5 dB cut (loud outliers)
const WINDOW_BYTES = 393216;          // ~24s of 30280 AAC per window
const HEAD_BYTES = 786432;            // fallback when no usable index

// ---- BS.1770 K-weighting (coefficients for 48 kHz; 44.1k is ~0.3 dB off,
// acceptable for leveling) ----
const PRE_B = [1.53512485958697, -2.69169618940638, 1.19839281085285];
const PRE_A = [-1.69065929318241, 0.73248077421585];
const HP_B = [1.0, -2.0, 1.0];
const HP_A = [-1.99004745483398, 0.99007225036621];

function biquad(x, b, a) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = b[0] * xi + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    y[i] = yi;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
  }
  return y;
}

// Gated loudness of one decoded AudioBuffer → array of 400ms block powers
// (channel-power-summed, K-weighted). Blocks feed the cross-window gate.
export function kWeightedBlockPowers(buf) {
  const sr = buf.sampleRate || 48000;
  const blockLen = Math.round(sr * 0.4);
  const nCh = Math.min(2, buf.numberOfChannels || 1);
  const chans = [];
  for (let c = 0; c < nCh; c++) {
    chans.push(biquad(biquad(buf.getChannelData(c), PRE_B, PRE_A), HP_B, HP_A));
  }
  const nBlocks = Math.floor(chans[0].length / blockLen);
  const powers = [];
  for (let bI = 0; bI < nBlocks; bI++) {
    let z = 0;
    for (let c = 0; c < nCh; c++) {
      const d = chans[c];
      let s = 0;
      const off = bI * blockLen;
      for (let i = 0; i < blockLen; i++) { const v = d[off + i]; s += v * v; }
      z += s / blockLen; // BS.1770 sums channel powers (stereo ≈ +3 dB vs mono)
    }
    powers.push(z);
  }
  return powers;
}

// BS.1770 gating over pooled block powers → integrated LUFS (or null).
export function gatedLufs(powers) {
  if (!powers || !powers.length) return null;
  const toL = (z) => -0.691 + 10 * Math.log10(z + 1e-15);
  const abs = powers.filter(z => toL(z) > -70);
  if (!abs.length) return null;
  const mean1 = abs.reduce((s, z) => s + z, 0) / abs.length;
  const relGate = toL(mean1) - 10;
  const rel = abs.filter(z => toL(z) > relGate);
  if (!rel.length) return null;
  return toL(rel.reduce((s, z) => s + z, 0) / rel.length);
}

// measured LUFS → element-volume gain, attenuate-only, clamped.
export function gainForLufs(lufs, target) {
  if (lufs == null || !isFinite(lufs)) return 1;
  const t = target == null ? TARGET_LUFS : target;
  if (lufs <= t) return 1;
  return Math.max(MIN_GAIN, Math.pow(10, (t - lufs) / 20));
}

// ---- fMP4 sidx parsing: byte offsets of properly decodable subsegments ----
// range strings look like "0-907". anchor = first byte AFTER the sidx box.
export function parseSidx(bytes, anchor) {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // walk boxes to find 'sidx' (usually at offset 0 of the index range)
    let p = 0;
    while (p + 8 <= bytes.byteLength) {
      const size = dv.getUint32(p);
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
      if (type === 'sidx') {
        const version = bytes[p + 8];
        let q = p + 12 + 8; // fullbox header + reference_ID + timescale
        q += version === 0 ? 8 : 16; // earliest_presentation_time + first_offset
        const firstOffset = version === 0 ? dv.getUint32(q - 4) : Number(dv.getBigUint64(q - 8));
        q += 2; // reserved
        const count = dv.getUint16(q); q += 2;
        const offsets = [];
        let cur = anchor + firstOffset;
        for (let i = 0; i < count; i++) {
          const refSize = dv.getUint32(q) & 0x7fffffff;
          offsets.push({ start: cur, size: refSize });
          cur += refSize;
          q += 12;
        }
        return offsets;
      }
      if (!size) break;
      p += size;
    }
  } catch (e) { /* fall through */ }
  return null;
}

function parseRange(s) {
  if (!s) return null;
  const m = String(s).match(/(\d+)-(\d+)/);
  return m ? { from: +m[1], to: +m[2] } : null;
}

async function fetchBytes(url, from, to) {
  const resp = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } });
  if (!resp.ok && resp.status !== 206) throw new Error('http ' + resp.status);
  return new Uint8Array(await resp.arrayBuffer());
}

let sharedCtx = null;
function getCtx() {
  if (!sharedCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    sharedCtx = new AC();
  }
  return sharedCtx;
}

async function decodeBlocks(bytes) {
  const ctx = getCtx();
  if (!ctx) return [];
  try {
    // copy — decodeAudioData detaches the buffer on some engines
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const buf = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
    return kWeightedBlockPowers(buf);
  } catch (e) {
    return [];
  }
}

// Measure a DASH audio rep: {url (proxied), initRange, indexRange} → LUFS|null.
// 3 sidx-aligned windows across the video; falls back to a head chunk when the
// index is missing/unparseable. Any failure → null (caller applies no gain).
export async function measureRepLufs(rep) {
  try {
    const init = parseRange(rep.initRange);
    const idx = parseRange(rep.indexRange);
    let windows = null, initBytes = null;
    if (init && idx) {
      const headerBytes = await fetchBytes(rep.url, init.from, idx.to);
      initBytes = headerBytes.subarray(0, init.to - init.from + 1);
      const sidxBytes = headerBytes.subarray(idx.from - init.from);
      const segs = parseSidx(sidxBytes, idx.to + 1);
      if (segs && segs.length > 3) {
        const total = segs[segs.length - 1].start + segs[segs.length - 1].size;
        windows = [0.1, 0.4, 0.7].map(f => {
          const targetByte = total * f;
          let s = segs.findIndex(g => g.start >= targetByte);
          if (s < 0) s = 0;
          // group consecutive segments up to WINDOW_BYTES
          let end = s, sz = 0;
          while (end < segs.length && sz < WINDOW_BYTES) { sz += segs[end].size; end++; }
          return { from: segs[s].start, to: segs[end - 1].start + segs[end - 1].size - 1 };
        });
      }
    }
    let powers = [];
    if (windows && initBytes) {
      const chunks = await Promise.all(windows.map(w => fetchBytes(rep.url, w.from, w.to).catch(() => null)));
      for (const c of chunks) {
        if (!c) continue;
        const joined = new Uint8Array(initBytes.length + c.length);
        joined.set(initBytes, 0); joined.set(c, initBytes.length);
        powers = powers.concat(await decodeBlocks(joined));
      }
    }
    if (!powers.length) { // fallback: head chunk (always decodable from byte 0)
      const head = await fetchBytes(rep.url, 0, HEAD_BYTES - 1);
      powers = await decodeBlocks(head);
    }
    return gatedLufs(powers);
  } catch (e) {
    return null;
  }
}
