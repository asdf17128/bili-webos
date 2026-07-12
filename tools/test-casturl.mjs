// C-CAST-03: DLNA URL rewrite (app/src/utils/casturl.js). A wrong rewrite
// breaks EVERY Huya cast; an over-eager one breaks non-Huya senders.
// Run: node tools/test-casturl.mjs   (exit 0 = pass)
import { strict as assert } from 'assert';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { rewriteCastUrl } = await import('file://' + join(ROOT, 'app/src/utils/casturl.js'));

// Huya FLV → HLS (host + extension, query untouched — the signature must survive)
assert.equal(
  rewriteCastUrl('http://tx.flv.huya.com/src/123-imgplus.flv?wsSecret=abc&wsTime=1&codec=264'),
  'http://tx.hls.huya.com/src/123-imgplus.m3u8?wsSecret=abc&wsTime=1&codec=264');
// other CDN prefixes (al/hw/tx…) share the pattern
assert.equal(
  rewriteCastUrl('http://al.flv.huya.com/src/x.flv?a=1'),
  'http://al.hls.huya.com/src/x.m3u8?a=1');
// non-Huya URLs untouched
for (const u of [
  'http://example.com/stream.flv?x=1',            // flv elsewhere — leave alone
  'https://cdn.site.com/live/master.m3u8?sig=1',  // already HLS
  'http://tx.flv.huya.com/src/clip.mp4?x=1',      // huya host but not .flv
  '', null, undefined,
]) {
  assert.equal(rewriteCastUrl(u), u);
}
console.log('PASS test-casturl (7 asserts)');
