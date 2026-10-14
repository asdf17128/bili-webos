// Execute the saved old expression and the actual current tool's named
// predicate. This is a test-tool defect, not a reproduced player failure.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const tool = new URL('../../../../tools/test-playback-lifecycle-tv.mjs', import.meta.url);
const source = readFileSync(tool, 'utf8');
const old = readFileSync(new URL('./before-expression.txt', import.meta.url), 'utf8').trim();
const current = source.match(/function pausedPositionStable\(before, after\) \{\n[\s\S]*?\n\}/)?.[0];
assert.ok(current, 'actual tool predicate must exist');
const predicate = vm.runInNewContext('(' + current + ')');
const cases = [
  { name: 'normal paused sample', before: { time: 37, paused: true }, after: { time: 37.05, paused: true }, expected: true },
  { name: 'large backward jump while paused', before: { time: 37, paused: true }, after: { time: 0, paused: true }, expected: false },
  { name: 'small change while unexpectedly playing', before: { time: 37, paused: true }, after: { time: 37.04, paused: false }, expected: false },
  { name: 'large forward jump while paused', before: { time: 37, paused: true }, after: { time: 38, paused: true }, expected: false },
];
const rows = [];
for (const c of cases) {
  const beforeResult = await vm.runInNewContext('(async () => ' + old + ')()', {
    state: async () => ({ video: c.after }), paused: { video: c.before },
  });
  const afterResult = predicate(c.before, c.after);
  rows.push({ ...c, oldAccepted: beforeResult, oldCorrect: beforeResult === c.expected,
    newAccepted: afterResult, newCorrect: afterResult === c.expected });
}
const report = { source: 'tools/test-playback-lifecycle-tv.mjs', sha256: createHash('sha256').update(source).digest('hex'),
  scope: 'Synthetic numeric observations exercise the actual test predicate; no TV or production player is executed.',
  oldCorrect: rows.filter(r => r.oldCorrect).length, newCorrect: rows.filter(r => r.newCorrect).length, cases: rows };
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
assert.equal(report.oldCorrect, 2, 'old expression must reproduce both false positives');
assert.equal(report.newCorrect, 4, 'new predicate must keep normal pause and reject false positives');
console.log(JSON.stringify({ oldCorrect: report.oldCorrect, newCorrect: report.newCorrect, sha256: report.sha256 }));
