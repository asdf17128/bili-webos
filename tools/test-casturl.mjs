// C-CAST-03: DLNA URL rewrite ladder (app/src/utils/casturl.js). A wrong
// rewrite breaks EVERY Huya cast; a wrong ladder never reaches 蓝光 or never
// falls back. Ratio 8000 unlock verified live against real signed URLs
// (segment bitrate 3× vs the sender's ratio=2000 cap).
// Run: node tools/test-casturl.mjs   (exit 0 = pass)
import { strict as assert } from 'assert';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { rewriteCastUrl } = await import('file://' + join(ROOT, 'app/src/utils/casturl.js'));

const HUYA = 'http://tx.flv.huya.com/src/123-imgplus.flv?wsSecret=abc&wsTime=1&codec=264&ratio=2000&seqid=9';

// attempt 0: HLS + 蓝光 ratio (signature params untouched)
assert.equal(rewriteCastUrl(HUYA, 0),
  'http://tx.hls.huya.com/src/123-imgplus.m3u8?wsSecret=abc&wsTime=1&codec=264&ratio=8000&seqid=9');
// attempt 0 with NO ratio param → appended
assert.equal(rewriteCastUrl('http://al.flv.huya.com/src/x.flv?a=1', 0),
  'http://al.hls.huya.com/src/x.m3u8?a=1&ratio=8000');
// attempt 1: HLS, sender's original ratio kept
assert.equal(rewriteCastUrl(HUYA, 1),
  'http://tx.hls.huya.com/src/123-imgplus.m3u8?wsSecret=abc&wsTime=1&codec=264&ratio=2000&seqid=9');
// attempt 2+: untouched original (FLV fallback)
assert.equal(rewriteCastUrl(HUYA, 2), HUYA);
assert.equal(rewriteCastUrl(HUYA, 5), HUYA);
// non-Huya URLs untouched at every attempt
for (const u of [
  'http://example.com/stream.flv?x=1',
  'https://cdn.site.com/live/master.m3u8?sig=1',
  'http://tx.flv.huya.com/src/clip.mp4?x=1',
  '', null, undefined,
]) {
  assert.equal(rewriteCastUrl(u, 0), u);
  assert.equal(rewriteCastUrl(u, 1), u);
}
console.log('PASS test-casturl (17 asserts)');
