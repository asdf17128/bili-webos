// C-SUB-01: subtitle pure helpers (app/src/player/subtitles.js).
// parseSubtitleBody must survive the informal ai_subtitle contract (garbage,
// unsorted, zero-length cues); pickCueIndex must resolve overlaps and gaps —
// a wrong index here paints the WRONG LINE on screen, worse than none.
// Run: node tools/test-subtitle.mjs   (exit 0 = pass)
import { strict as assert } from 'assert';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseSubtitleBody, pickCueIndex, isAiLan, subtitleLanName, knownLanNames, AI_LEAD } =
  await import('file://' + join(ROOT, 'app/src/player/subtitles.js'));

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

// --- parseSubtitleBody ---
ok('parse: null/garbage input → []', () => {
  assert.deepEqual(parseSubtitleBody(null), []);
  assert.deepEqual(parseSubtitleBody({}), []);
  assert.deepEqual(parseSubtitleBody({ body: 'nope' }), []);
});

ok('parse: drops empty/invalid cues, keeps valid ones', () => {
  const cues = parseSubtitleBody({ body: [
    { from: 1, to: 3, content: '好' },
    { from: 5, to: 5, content: '零长度' },        // to <= from → drop
    { from: 'x', to: 9, content: '坏时间' },       // NaN → drop
    { from: 4, to: 6 },                            // no content → drop
    { from: 7, to: 9, content: '' },               // empty → drop
    null,
  ] });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, '好');
});

ok('parse: sorts unsorted bodies by from', () => {
  const cues = parseSubtitleBody({ body: [
    { from: 10, to: 12, content: 'b' },
    { from: 1, to: 3, content: 'a' },
  ] });
  assert.deepEqual(cues.map(c => c.text), ['a', 'b']);
});

// --- pickCueIndex ---
const CUES = parseSubtitleBody({ body: [
  { from: 1, to: 3, content: 'one' },
  { from: 5, to: 8, content: 'two' },
  { from: 8, to: 11, content: 'three' },
] });

ok('pick: inside / boundary / gap / before / after', () => {
  assert.equal(pickCueIndex(CUES, 2), 0);     // inside first
  assert.equal(pickCueIndex(CUES, 1), 0);     // from is inclusive
  assert.equal(pickCueIndex(CUES, 3), -1);    // to is exclusive → gap
  assert.equal(pickCueIndex(CUES, 4), -1);    // gap between cues
  assert.equal(pickCueIndex(CUES, 8), 2);     // back-to-back handoff
  assert.equal(pickCueIndex(CUES, 0.5), -1);  // before all
  assert.equal(pickCueIndex(CUES, 99), -1);   // after all
  assert.equal(pickCueIndex([], 5), -1);
  assert.equal(pickCueIndex(null, 5), -1);
});

ok('pick: overlapping earlier cue still live is found', () => {
  const over = parseSubtitleBody({ body: [
    { from: 1, to: 10, content: 'long' },
    { from: 2, to: 3, content: 'short' },
    { from: 4, to: 5, content: 'short2' },
  ] });
  // t=6: 'short2' (latest from<=t) already ended; the walk-back must land on 'long'.
  assert.equal(over[pickCueIndex(over, 6)].text, 'long');
});

ok('pick: sweep never crashes and matches linear scan (1000 cues)', () => {
  const body = [];
  for (let i = 0; i < 1000; i++) body.push({ from: i * 2, to: i * 2 + 1.5, content: 'c' + i });
  const cues = parseSubtitleBody({ body });
  for (let t = 0; t < 60; t += 0.25) {
    const linear = cues.findIndex(c => c.from <= t && t < c.to);
    assert.equal(pickCueIndex(cues, t), linear, 't=' + t);
  }
});

// --- ai lead ---
ok('isAiLan / AI_LEAD', () => {
  assert.equal(isAiLan('ai-zh'), true);
  assert.equal(isAiLan('zh-CN'), false);
  assert.equal(isAiLan(null), false);
  assert.ok(AI_LEAD > 0 && AI_LEAD < 1);
});

// --- track display names ---
ok('lan name: known enum localized, unknown falls back to lan_doc/lan', () => {
  assert.equal(subtitleLanName('ai-zh', '中文(自动)'), '中文(自动生成)'); // enum wins
  assert.equal(subtitleLanName('zh-CN', null), '中文');
  assert.equal(subtitleLanName('ko', '韩语(API说的)'), '韩语(API说的)'); // unknown → lan_doc
  assert.equal(subtitleLanName('ko', null), 'ko');                      // no doc → code
  assert.equal(subtitleLanName(null, null), '');
});

// The t(subtitleLanName(...)) call site is DYNAMIC — invisible to the coverage
// gate's literal t('…') scan. Close that blind spot here: every canonical name
// must exist in every dictionary.
{
  const I18N = join(ROOT, 'app/src/i18n');
  const { readdirSync } = await import('fs');
  for (const df of readdirSync(I18N).filter(f => f.endsWith('.js') && f !== 'index.js')) {
    const dict = (await import('file://' + join(I18N, df))).default;
    const missing = knownLanNames().filter(k => !(k in dict));
    assert.deepEqual(missing, [], `${df} missing lan names: ${missing.join(', ')}`);
  }
  ok('lan names covered by every i18n dictionary', () => {});
}

console.log(`PASS test-subtitle (${n} groups)`);
