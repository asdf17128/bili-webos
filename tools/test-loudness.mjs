// C-AUD-01: 音量均衡 pure helpers (app/src/player/loudness.js) — BS.1770-style
// K-weighted gated LUFS + attenuate-only gain + sidx parsing.
// Run: node tools/test-loudness.mjs   (exit 0 = pass)
import { strict as assert } from 'assert';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { kWeightedBlockPowers, gatedLufs, gainForLufs, parseSidx, TARGET_LUFS, MIN_GAIN } =
  await import('file://' + join(ROOT, 'app/src/player/loudness.js'));

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

const sineBuf = (amp, seconds, freq, sr) => {
  const len = Math.round((sr || 48000) * (seconds || 2));
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) data[i] = amp * Math.sin((i / (sr || 48000)) * 2 * Math.PI * (freq || 997));
  return { sampleRate: sr || 48000, numberOfChannels: 1, getChannelData: () => data };
};

ok('LUFS: 997 Hz full-scale mono sine ≈ -3.0 LUFS (BS.1770 reference tone)', () => {
  // ITU spec: 0 dBFS 997 Hz sine reads -3.01 LUFS (K-weight ~unity at 1 kHz)
  const l = gatedLufs(kWeightedBlockPowers(sineBuf(1.0, 2)));
  assert.ok(Math.abs(l - (-3.0)) < 0.35, `got ${l}`);
});

ok('LUFS: -20 dB sine reads ≈ -23 LUFS; amplitude ratio maps to dB delta', () => {
  const l20 = gatedLufs(kWeightedBlockPowers(sineBuf(0.1, 2)));   // -20 dBFS
  assert.ok(Math.abs(l20 - (-23.0)) < 0.4, `got ${l20}`);
  const l26 = gatedLufs(kWeightedBlockPowers(sineBuf(0.05, 2)));  // -26 dBFS
  assert.ok(Math.abs((l20 - l26) - 6) < 0.1, `delta ${l20 - l26}`);
});

ok('LUFS: K-weighting attenuates low frequencies (60 Hz reads quieter than 1 kHz)', () => {
  // BS.1770 high-pass cuts off at ~38 Hz — at 60 Hz the attenuation is a few
  // dB (not double digits); at 30 Hz it should be much deeper.
  const l1k = gatedLufs(kWeightedBlockPowers(sineBuf(0.5, 2, 997)));
  const l60 = gatedLufs(kWeightedBlockPowers(sineBuf(0.5, 2, 60)));
  const l30 = gatedLufs(kWeightedBlockPowers(sineBuf(0.5, 2, 30)));
  assert.ok(l1k - l60 > 2.5, `1k=${l1k} 60Hz=${l60}`);
  assert.ok(l1k - l30 > 8, `1k=${l1k} 30Hz=${l30}`);
});

ok('gating: silence-padded content measures the content, not the silence', () => {
  const sr = 48000, len = sr * 4;
  const data = new Float32Array(len); // 2s sine + 2s silence
  for (let i = 0; i < sr * 2; i++) data[i] = 0.5 * Math.sin((i / sr) * 2 * Math.PI * 997);
  const buf = { sampleRate: sr, numberOfChannels: 1, getChannelData: () => data };
  const gated = gatedLufs(kWeightedBlockPowers(buf));
  const pure = gatedLufs(kWeightedBlockPowers(sineBuf(0.5, 2)));
  assert.ok(Math.abs(gated - pure) < 1.0, `gated=${gated} pure=${pure}`); // silence gated out
});

ok('gain: attenuate-only, clamped, robust to garbage', () => {
  assert.equal(gainForLufs(TARGET_LUFS), 1);
  assert.equal(gainForLufs(-30), 1);                    // quiet stays
  const g6 = gainForLufs(TARGET_LUFS + 6);              // +6 dB → ~0.5
  assert.ok(Math.abs(g6 - 0.501) < 0.01, `got ${g6}`);
  assert.equal(gainForLufs(TARGET_LUFS + 30), MIN_GAIN);
  assert.equal(gainForLufs(null), 1);
  assert.equal(gainForLufs(NaN), 1);
});

ok('gain: owner history ground truth (-9.2 loud / -28.9 quiet coffee reviews)', () => {
  // target -20: the loud review is 10.8 dB over → 0.288; quiet one untouched.
  const loud = gainForLufs(-9.2);
  assert.ok(Math.abs(loud - 0.288) < 0.01, `got ${loud}`);
  assert.equal(gainForLufs(-28.9), 1);
  // mainstream -16..-20 all land ON the -20 line (unified level)
  assert.ok(Math.abs(gainForLufs(-16) - 0.631) < 0.01);
  assert.equal(gainForLufs(-20.5), 1);
});

ok('sidx: synthetic box parses to cumulative offsets', () => {
  // build a v0 sidx with 3 refs of sizes 1000/2000/3000, first_offset 0
  const count = 3;
  const size = 12 + 8 + 8 + 4 + count * 12;
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, size);
  b.set([115, 105, 100, 120], 4); // 'sidx'
  dv.setUint32(12, 1); dv.setUint32(16, 48000); // ref_id, timescale
  dv.setUint32(20, 0); dv.setUint32(24, 0);     // ept, first_offset
  dv.setUint16(28, 0); dv.setUint16(30, count);
  const sizes = [1000, 2000, 3000];
  for (let i = 0; i < count; i++) {
    dv.setUint32(32 + i * 12, sizes[i]);
    dv.setUint32(36 + i * 12, 19200); // duration
  }
  const segs = parseSidx(b, 500); // anchor: first byte after index range
  assert.equal(segs.length, 3);
  assert.deepEqual(segs.map(s => s.start), [500, 1500, 3500]);
  assert.equal(parseSidx(new Uint8Array(8), 0), null); // garbage → null
});

console.log(`PASS test-loudness (${n} groups)`);
