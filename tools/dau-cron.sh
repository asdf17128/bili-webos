#!/bin/bash
# Hourly DAU snapshot, run from the system crontab (survives Claude sessions).
# Cron gives a minimal env, so set PATH (node + gh live in Homebrew) and cd to
# the repo so tools/.dau-snapshots.jsonl lands in the right place. gh auth is
# read from $HOME/.config/gh (cron sets HOME). Output → /tmp/dau-cron.log.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
# A --require preload inherited via NODE_OPTIONS breaks node here
# (MODULE_NOT_FOUND from internal/preload) — these scripts must not
# inherit the caller's node instrumentation.
unset NODE_OPTIONS
cd "$(dirname "$0")/.." || exit 1
echo "--- $(date '+%Y-%m-%d %H:%M:%S') ---" >> /tmp/dau-cron.log
node tools/dau.mjs >> /tmp/dau-cron.log 2>&1
