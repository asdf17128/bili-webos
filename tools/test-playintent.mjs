// Regression: play-start policy (app/src/player/playIntent.js).
// Evidence this suite matters: the resume feature shipped broken TWICE because
// the old heuristic ("no cid on the item ⇒ ok to resume") silently disabled
// resume for every feed/favorites card (user report, fixed in v1.2.1). These
// exact scenarios reproduced the bug against the old logic before the fix.
// Run: node tools/test-playintent.mjs   (exit 0 = pass)
import { playFresh, playAt, playPart, playAdvance, normalizePlay } from '../app/src/player/playIntent.js';

const card = { bvid: 'BV1x', cid: 999, title: 'feed card WITH cid' }; // the case that used to break

const tests = [
  ['feed card (cid present) → auto-resume', normalizePlay(card).resumeMode === 'auto'],
  ['history row (progress 300) → at/300', (() => { const r = normalizePlay({ bvid: 'BV1x', progress: 300 }); return r.resumeMode === 'at' && r.progress === 300; })()],
  ['选集 pick → none/0', (() => { const r = playPart(card); return r.resumeMode === 'none' && r.progress === 0; })()],
  ['连播 advance strips stale progress → none/0', (() => { const r = playAdvance({ ...card, progress: 77 }); return r.resumeMode === 'none' && r.progress === 0; })()],
  ['cast seekTs → at', (() => { const r = playAt(card, 42); return r.progress === 42 && r.resumeMode === 'at'; })()],
  ['explicit intent passes through normalize', normalizePlay(playPart(card)).resumeMode === 'none'],
  ['playFresh always auto', playFresh({ bvid: 'x', progress: 500 }).resumeMode === 'auto'],
];

let fail = 0;
for (const [name, ok] of tests) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
