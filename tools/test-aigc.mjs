// C-UI-08: pickAigcText — defensive extraction of the (undocumented) arc_aigc
// declaration. Wrong extraction = a bogus/blank AI banner on every video.
// Run: node tools/test-aigc.mjs   (exit 0 = pass)
import { strict as assert } from 'assert';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// format.js pulls in i18n → needs browser-ish globals (same trick as
// test-i18n-format.mjs): run in a child with stubs.
const CHILD = `
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
const { strict: assert } = await import('assert');
const { pickAigcText } = await import(${JSON.stringify('file://' + join(ROOT, 'app/src/utils/format.js'))});
assert.equal(pickAigcText(null), '');
assert.equal(pickAigcText(undefined), '');
assert.equal(pickAigcText('内容由AI辅助生成'), '内容由AI辅助生成');
assert.equal(pickAigcText({ desc: '本视频包含AI生成内容' }), '本视频包含AI生成内容');
assert.equal(pickAigcText({ tips: ' 声明文本 ' }), '声明文本');
assert.equal(pickAigcText({ foo: 1, bar: '虚构演绎声明' }), '虚构演绎声明'); // CJK sweep
assert.equal(pickAigcText({ type: 1 }), '内容由AI生成');                    // typed, textless → generic
assert.equal(pickAigcText({ type: 0 }), '');                                // untyped, textless → nothing
assert.equal(pickAigcText({ foo: 'ascii only' }), '');                      // no CJK, no known key
console.log('PASS test-aigc (9 asserts)');
`;

try {
  process.stdout.write(execFileSync(process.execPath, ['--input-type=module', '-e', CHILD], { encoding: 'utf8' }));
} catch (e) {
  console.log('FAIL:', (e.stderr || e.message).split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}
