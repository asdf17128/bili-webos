#!/bin/bash
# Daily DAU digest — runs from a LaunchAgent so the number reaches the owner
# without anyone being in a Claude session. The hourly snapshotter
# (com.biliwebos.dau → dau-cron.sh) keeps tools/.dau-snapshots.jsonl fresh;
# this reads it, computes yesterday's device count, and posts a macOS
# notification + appends a line to tools/.dau-daily.log.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
# A --require preload inherited via NODE_OPTIONS breaks node here
# (MODULE_NOT_FOUND from internal/preload) — these scripts must not
# inherit the caller's node instrumentation.
unset NODE_OPTIONS
cd "$(dirname "$0")/.." || exit 1

LINE=$(node - <<'EOF'
const fs = require('fs');
const path = 'tools/.dau-snapshots.jsonl';
let rows = [];
try {
  rows = fs.readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
} catch (e) { console.log('DAU: 快照文件读不到'); process.exit(0); }
// last snapshot of each local day (Asia/Shanghai)
const byDay = {};
for (const r of rows) {
  const day = new Date(r.ts).toLocaleDateString('sv', { timeZone: 'Asia/Shanghai' });
  byDay[day] = r.version_json_total;
}
const days = Object.keys(byDay).sort();
if (days.length < 2) { console.log('DAU: 数据不足'); process.exit(0); }
// Report the last COMPLETE day, not today: this runs in the morning, so
// "today's" total only covers a few hours and would read as a huge drop
// (fired 2026-07-29 10:09 → "10 台 ↓40", which was pure artifact).
const todayKey = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Shanghai' });
const done = days.filter(d => d !== todayKey);   // complete days only
if (done.length < 2) { console.log('DAU: 数据不足'); process.exit(0); }
const day = done[done.length - 1];               // yesterday
const prev = done[done.length - 2];
const prev2 = done.length >= 3 ? done[done.length - 3] : null;
const delta = byDay[day] - byDay[prev];
const prevDelta = prev2 != null ? byDay[prev] - byDay[prev2] : null;
const trend = prevDelta == null ? ''
  : delta > prevDelta ? ` ↑${delta - prevDelta}`
  : delta < prevDelta ? ` ↓${prevDelta - delta}` : ' 持平';
const soFar = byDay[todayKey] != null ? ` · 今日已 ${byDay[todayKey] - byDay[day]}` : '';
console.log(`DAU ${day}: ${delta} 台${trend} · 累计 ${byDay[todayKey] != null ? byDay[todayKey] : byDay[day]}${soFar}`);
EOF
)

echo "$(date '+%Y-%m-%d %H:%M') $LINE" >> tools/.dau-daily.log
osascript -e "display notification \"$LINE\" with title \"BiliTV 日活\"" 2>/dev/null
echo "$LINE"
