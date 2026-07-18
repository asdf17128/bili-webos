// DAU tracker. The app pings the latest release's version.json once per day
// (see client.pingVersionAsset), and GitHub exposes that asset's *cumulative*
// download_count — so daily increment ≈ daily-active devices. GitHub gives no
// per-day breakdown, so we snapshot the running total each run and diff.
//
// Usage: node tools/dau.mjs         # snapshot + report single-day DAU
//        node tools/dau.mjs --no-record   # report only, don't append
//
// Run this every 涨星 monitoring tick so the single-day number stays exact
// (a missed day forces interpolation across the gap — still fine, just fuzzier).
import { execSync } from 'child_process';
import { readFileSync, appendFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = join(ROOT, 'tools/.dau-snapshots.jsonl');
const RECORD = !process.argv.includes('--no-record');
const H = 3600 * 1000;

function currentTotal() {
  const cmd = `gh api repos/asdf17128/bili-webos/releases --jq '[.[].assets[] | select(.name=="version.json") | .download_count] | add'`;
  return parseInt(execSync(cmd, { encoding: 'utf8' }).trim(), 10);
}

function readSnaps() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .map((s) => ({ t: Date.parse(s.ts), v: s.version_json_total, ts: s.ts }))
    .filter((s) => !isNaN(s.t) && typeof s.v === 'number')
    .sort((a, b) => a.t - b.t);
}

// Linear-interpolated total at time T (clamped to the recorded range).
function valueAt(snaps, T) {
  if (!snaps.length) return null;
  if (T <= snaps[0].t) return snaps[0].v;
  if (T >= snaps[snaps.length - 1].t) return snaps[snaps.length - 1].v;
  for (let i = 1; i < snaps.length; i++) {
    if (T <= snaps[i].t) {
      const a = snaps[i - 1], b = snaps[i];
      return a.v + ((T - a.t) / (b.t - a.t)) * (b.v - a.v);
    }
  }
  return snaps[snaps.length - 1].v;
}

const now = Date.now();
const total = currentTotal();

const existing = readSnaps();
const last = existing[existing.length - 1];
// Skip a redundant append if we snapshotted within the last 20 min (avoids
// clutter when the tick runs twice); still report.
if (RECORD && (!last || now - last.t > 20 * 60 * 1000)) {
  appendFileSync(LOG, JSON.stringify({ ts: new Date(now).toISOString().replace(/\.\d+Z$/, 'Z'), version_json_total: total }) + '\n');
}

const snaps = readSnaps(); // re-read incl. the row we may have just written
const first = snaps[0];
const prev = snaps.length >= 2 ? snaps[snaps.length - 2] : null;

function round(n) { return Math.round(n * 10) / 10; }

// Single-day DAU = pings in the trailing 24h (interpolated if no exact point).
const v24 = valueAt(snaps, now - 24 * H);
const day = v24 == null ? null : total - v24;
// Whether the 24h window is backed by a real datapoint or extrapolated past the
// earliest snapshot (flag honestly).
const spanH = first ? (now - first.t) / H : 0;
const interpolated = spanH < 24;

console.log('=== DAU ===');
console.log(`累计 ping (version.json): ${total}`);
if (prev) {
  const dh = round((now - prev.t) / H);
  console.log(`较上次快照: +${total - prev.v}  (间隔 ${dh}h, ${prev.ts})`);
}
if (day != null && !interpolated) {
  console.log(`过去 24h 单日 DAU: ~${round(day)} 台` + (Number.isInteger(day) ? '' : ' (插值)'));
} else if (first) {
  const rate = round((total - first.v) / spanH * 24);
  console.log(`单日 DAU: 追踪窗口不足 24h (${round(spanH)}h) → 按现有斜率估 ~${rate} 台/天`);
}
if (first) {
  const rate = round((total - first.v) / ((now - first.t) / H) * 24);
  console.log(`窗口日均: ~${rate} 台/天  (自 ${first.ts}, ${first.v}→${total})`);
}
