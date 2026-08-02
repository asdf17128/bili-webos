#!/bin/bash
# One-line DAU digest for the SessionStart hook. macOS notifications from
# launchd turned out unverifiable (the Notification Center DB is SIP-protected
# and the owner wasn't seeing them), so the number is surfaced in the Claude
# session instead — a channel that provably reaches them.
# Prints nothing if there's no data, so a fresh clone stays quiet.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
# A --require preload inherited via NODE_OPTIONS breaks node here
# (MODULE_NOT_FOUND from internal/preload) — these scripts must not
# inherit the caller's node instrumentation.
unset NODE_OPTIONS
cd "$(dirname "$0")/.." || exit 0
[ -f tools/.dau-snapshots.jsonl ] || exit 0

node - <<'EOF'
const fs = require('fs');
let rows;
try { rows = fs.readFileSync('tools/.dau-snapshots.jsonl', 'utf8').trim().split('\n').map(JSON.parse); }
catch (e) { process.exit(0); }
const byDay = {};
for (const r of rows) byDay[new Date(r.ts).toLocaleDateString('sv', { timeZone: 'Asia/Shanghai' })] = r.version_json_total;
const days = Object.keys(byDay).sort();
const todayKey = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Shanghai' });
const done = days.filter(d => d !== todayKey);
if (done.length < 2) process.exit(0);
const d1 = done[done.length - 1], d0 = done[done.length - 2];
const delta = byDay[d1] - byDay[d0];
const week = done.slice(-7).map((d, i, a) => (i ? byDay[d] - byDay[a[i - 1]] : null)).filter(x => x != null);
const avg = week.length ? Math.round(week.reduce((s, x) => s + x, 0) / week.length) : null;
const soFar = byDay[todayKey] != null ? byDay[todayKey] - byDay[d1] : null;
let line = `[BiliTV] ${d1} 日活 ${delta} 台`;
if (avg != null) line += ` · 近${week.length}日均 ${avg}`;
if (soFar != null) line += ` · 今日已 ${soFar}`;
line += ` · 累计 ${byDay[todayKey] != null ? byDay[todayKey] : byDay[d1]}`;
console.log(line);
EOF
