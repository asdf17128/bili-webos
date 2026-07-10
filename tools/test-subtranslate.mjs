// C-SUB-03: subtitle MT pipeline (app/src/player/subTranslate.js).
// Batching must respect line/char limits, misalignment must THROW (a shifted
// translation puts the wrong sentence under the whole video), cache must make
// replays free, LRU must bound localStorage.
// Run: node tools/test-subtranslate.mjs   (exit 0 = pass)
import { strict as assert } from 'assert';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { batchRanges, translateCues, MT_BATCH_LINES, MT_BATCH_CHARS } =
  await import('file://' + join(ROOT, 'app/src/player/subTranslate.js'));

let n = 0;
const ok = (name) => { n++; console.log('  ✓ ' + name); };

const mkStore = () => ({
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
});
const mkCues = (texts) => texts.map((t, i) => ({ from: i, to: i + 0.9, text: t }));

// --- batchRanges ---
{
  const texts = Array.from({ length: 250 }, (_, i) => '第' + i + '行');
  const r = batchRanges(texts);
  assert.deepEqual(r, [[0, 100], [100, 200], [200, 250]]);
  ok('batch: line limit splits 250 → 100/100/50');
}
{
  const texts = ['a'.repeat(MT_BATCH_CHARS - 10), 'b'.repeat(50), 'c'];
  assert.deepEqual(batchRanges(texts), [[0, 1], [1, 3]]);
  ok('batch: char limit forces a split (one giant line alone in its batch)');
  assert.deepEqual(batchRanges([]), []);
  ok('batch: empty input → no ranges');
}

// --- translateCues happy path + call accounting ---
{
  const cues = mkCues(Array.from({ length: 250 }, (_, i) => '你好' + i));
  const calls = [];
  const engine = async (texts, tl) => { calls.push(texts.length); return texts.map(t => 'EN:' + t + ':' + tl); };
  const store = mkStore();
  const out = await translateCues(cues, 'en', engine, 'k1', store);
  assert.equal(out.length, 250);
  assert.equal(out[0].text, 'EN:你好0:en');
  assert.equal(out[249].text, 'EN:你好249:en');
  assert.equal(out[42].from, cues[42].from); // timings preserved
  assert.deepEqual(calls, [100, 100, 50]);
  ok('translate: batches sequentially, preserves order+timings');

  // second run: served from cache, engine untouched
  calls.length = 0;
  const out2 = await translateCues(cues, 'en', engine, 'k1', store);
  assert.deepEqual(calls, []);
  assert.equal(out2[7].text, 'EN:你好7:en');
  ok('translate: cache hit → zero engine calls');

  // cue-count mismatch invalidates the cache instead of misaligning
  const fewer = mkCues(['只有一行']);
  calls.length = 0;
  const out3 = await translateCues(fewer, 'en', engine, 'k1', store);
  assert.equal(out3[0].text, 'EN:只有一行:en');
  assert.deepEqual(calls, [1]);
  ok('translate: stale cache (wrong length) ignored, re-fetched');
}

// --- misalignment / failure must throw ---
{
  const cues = mkCues(['一', '二', '三']);
  let threw = 0;
  try { await translateCues(cues, 'en', async ts => ts.slice(0, 2), 'k2', mkStore()); } catch (e) { threw++; }
  try { await translateCues(cues, 'en', async () => { throw new Error('net'); }, 'k3', mkStore()); } catch (e) { threw++; }
  try { await translateCues(cues, 'en', async () => 'not-an-array', 'k4', mkStore()); } catch (e) { threw++; }
  assert.equal(threw, 3);
  ok('translate: short/failed/garbage engine response throws (caller falls back)');
}

// --- LRU bound ---
{
  const store = mkStore();
  const engine = async ts => ts.map(t => 'E' + t);
  for (let i = 0; i < 12; i++) {
    await translateCues(mkCues(['行' + i]), 'en', engine, 'vid' + i, store);
  }
  const kept = Array.from(store._m.keys()).filter(k => k.startsWith('vid'));
  assert.equal(kept.length, 8);
  assert.ok(!kept.includes('vid0') && !kept.includes('vid3') && kept.includes('vid11'));
  ok('cache: LRU evicts beyond 8 entries (oldest first)');
}

// --- no store (private/broken localStorage) still works ---
{
  const out = await translateCues(mkCues(['好']), 'en', async ts => ts.map(t => 'E' + t), 'k', null);
  assert.equal(out[0].text, 'E好');
  ok('translate: null store tolerated');
}

console.log(`PASS test-subtranslate (${n} groups)`);
