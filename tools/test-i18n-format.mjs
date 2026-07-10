// C-I18N-04: locale-aware formatters. zh uses 万/亿 and 中文相对时间; en uses
// K/M and English relative time. These run in every card render — a locale mixup
// here shows on every screen.
//
// The i18n module resolves the locale ONCE at load (by design — t() is a hot
// pure lookup; language changes reload the app). So each locale is tested in
// its own child process to get a fresh module graph.
// Run: node tools/test-i18n-format.mjs   (exit 0 = pass)
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CHILD = (lang, checks) => `
globalThis.window = globalThis;
globalThis.localStorage = {
  _s: { bili_settings: JSON.stringify({ language: '${lang}' }) },
  getItem(k) { return this._s[k] ?? null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; },
};
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
const { strict: assert } = await import('assert');
const f = await import(${JSON.stringify('file://' + join(ROOT, 'app/src/utils/format.js'))});
${checks}
console.log('PASS ${lang}');
`;

const ZH = `
assert.equal(f.formatCount(12345), '1.2万');
assert.equal(f.formatCount(130000000), '1.3亿');
assert.equal(f.formatCount(999), '999');
assert.equal(f.formatTime(Date.now() / 1000 - 30), '刚刚');
assert.equal(f.formatTime(Date.now() / 1000 - 300), '5分钟前');
assert.equal(f.formatTime(Date.now() / 1000 - 7200), '2小时前');
`;

const EN = `
assert.equal(f.formatCount(12345), '12.3K');
assert.equal(f.formatCount(130000000), '130.0M');
assert.equal(f.formatCount(999), '999');
assert.equal(f.formatTime(Date.now() / 1000 - 30), 'just now');
assert.equal(f.formatTime(Date.now() / 1000 - 300), '5 min ago');
assert.equal(f.formatTime(Date.now() / 1000 - 7200), '2h ago');
`;

const ES = `
assert.equal(f.formatCount(12345), '12.3K');
assert.equal(f.formatTime(Date.now() / 1000 - 30), 'ahora mismo');
assert.equal(f.formatTime(Date.now() / 1000 - 300), 'hace 5 min');
assert.equal(f.formatTime(Date.now() / 1000 - 7200), 'hace 2h');
`;

let fail = 0;
for (const [lang, checks] of [['zh', ZH], ['en', EN], ['es', ES]]) {
  try {
    process.stdout.write(execFileSync(process.execPath, ['--input-type=module', '-e', CHILD(lang, checks)], { encoding: 'utf8' }));
  } catch (e) {
    fail++;
    console.log(`FAIL ${lang}:`, (e.stderr || e.message).split('\n').slice(0, 6).join('\n'));
  }
}
process.exit(fail ? 1 : 0);
