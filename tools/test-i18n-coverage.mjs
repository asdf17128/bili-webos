// C-I18N-01: every literal t('…') key in app/src must exist in EVERY language
// dictionary. A missing key silently falls back to Chinese — visible to users,
// caught here at build time instead. Extra dict keys are allowed (some keys are
// passed dynamically, e.g. DiagPanel row names via t(r.name)).
// Run: node tools/test-i18n-coverage.mjs   (exit 0 = pass)
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'src');
const I18N_DIR = join(ROOT, 'i18n');

// collect t('...') literals
const keys = new Set();
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'node_modules' && f !== 'i18n') walk(p); continue; }
    if (!/\.(jsx?|mjs)$/.test(f)) continue;
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/\bt\('([^']+)'/g)) keys.add(m[1]);
    // double-quoted form, in case it sneaks in
    for (const m of src.matchAll(/\bt\("([^"]+)"/g)) keys.add(m[1]);
  }
})(ROOT);

const dicts = readdirSync(I18N_DIR).filter(f => f.endsWith('.js') && f !== 'index.js');
if (dicts.length === 0) { console.log('FAIL: no dictionaries in app/src/i18n'); process.exit(1); }

let fail = 0;
for (const df of dicts) {
  const dict = (await import(join(I18N_DIR, df))).default;
  const missing = [...keys].filter(k => !(k in dict));
  const extra = Object.keys(dict).filter(k => !keys.has(k));
  if (missing.length) {
    fail++;
    console.log(`FAIL ${df}: ${missing.length} missing keys:`);
    missing.forEach(k => console.log('  - ' + k));
  } else {
    console.log(`PASS ${df}: covers all ${keys.size} source keys` + (extra.length ? ` (+${extra.length} dynamic/extra)` : ''));
  }
}
process.exit(fail ? 1 : 0);
