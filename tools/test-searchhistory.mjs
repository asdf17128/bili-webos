// C-SRCH-02: search-history storage (dedup + promote + cap). Remote-control
// typing is the worst TV interaction, so a one-tap "search again" list matters;
// a broken dedup/cap would corrupt it. Mirrors storage.js addSearchHistory.
// Run: node tools/test-searchhistory.mjs   (exit 0 = pass)
import { strict as assert } from 'assert';

function addHistory(list, term) {
  const q = (term || '').trim();
  if (!q) return list;
  list = list.filter((x) => x !== q);
  list.unshift(q);
  if (list.length > 12) list = list.slice(0, 12);
  return list;
}

let h = [];
h = addHistory(h, '原神');
h = addHistory(h, '复旦哲学');
h = addHistory(h, '原神'); // dedup + promote to front
assert.deepEqual(h, ['原神', '复旦哲学']);
h = addHistory(h, '  '); // blank ignored
assert.deepEqual(h, ['原神', '复旦哲学']);
// cap at 12, most-recent-first
h = [];
for (let i = 0; i < 20; i++) h = addHistory(h, 'term' + i);
assert.equal(h.length, 12);
assert.equal(h[0], 'term19');
assert.equal(h[11], 'term8');

console.log('PASS test-searchhistory (5 asserts)');
