// Monthly market-share tracker: the two numbers in docs/MARKET-SIZE.md §四 that
// carry no assumptions at all — global Homebrew active installs and ours.
//
// Both come from the same mechanism: Homebrew auto-update downloads an ipk once
// per device per version, so "downloads of one version" ≈ active install base.
// The RATIO is the useful part — same yardstick month over month.
//
// Appends to tools/.market-snapshots.jsonl and prints one line.
// Usage: node tools/market-share.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools/.market-snapshots.jsonl');
const gh = async (p) => {
  const r = await fetch('https://api.github.com' + p, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'bilitv-market-share' },
  });
  if (!r.ok) throw new Error(p + ' → HTTP ' + r.status);
  return r.json();
};
const ipkSum = (rel) => (rel.assets || [])
  .filter(a => a.name.endsWith('.ipk'))
  .reduce((s, a) => s + a.download_count, 0);

const hb = await gh('/repos/webosbrew/webos-homebrew-channel/releases/latest');
const global = ipkSum(hb);

// Our own: average the last 3 releases that have had time to propagate (a
// just-published one still reads near zero and would understate us).
const ours = await gh('/repos/asdf17128/bili-webos/releases?per_page=6');
const counts = ours.map(ipkSum).filter(n => n > 50).slice(0, 3);
const mine = counts.length ? Math.round(counts.reduce((s, n) => s + n, 0) / counts.length) : 0;

const row = {
  ts: new Date().toISOString(),
  globalTag: hb.tag_name,
  globalInstalls: global,
  ourInstalls: mine,
  sharePct: +(mine / global * 100).toFixed(3),
};

let prev = null;
try {
  const lines = fs.readFileSync(OUT, 'utf8').trim().split('\n');
  prev = JSON.parse(lines[lines.length - 1]);
} catch (e) { /* first run */ }

fs.appendFileSync(OUT, JSON.stringify(row) + '\n');

let line = `[市场] 全球 Homebrew 装机 ${global} (${hb.tag_name}) · 我们 ${mine} · 占比 ${row.sharePct}%`;
if (prev) {
  const dg = global - prev.globalInstalls, dm = mine - prev.ourInstalls;
  const days = Math.max(1, Math.round((new Date(row.ts) - new Date(prev.ts)) / 864e5));
  line += `\n        较上次(${days} 天前):全球 ${dg >= 0 ? '+' : ''}${dg} · 我们 ${dm >= 0 ? '+' : ''}${dm}`
        + ` · 占比 ${(row.sharePct - prev.sharePct >= 0 ? '+' : '')}${(row.sharePct - prev.sharePct).toFixed(3)} pp`;
}
console.log(line);
