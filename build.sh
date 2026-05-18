#!/usr/bin/env bash
# Build, package (app + service), and deploy to TV

set -a
source .env
set +a

echo "=== .env variables ==="
echo "TV_HOST: $TV_HOST"
echo "TV_PORT: $TV_PORT"
echo "TV_USER: $TV_USER"
echo "TV_PASS: $TV_PASS"
echo "SSH_KEY_PATH: $SSH_KEY_PATH"
echo "====================="
set -e
cd "$(dirname "$0")"

BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"
if [ ! -x "$BUN_BIN" ]; then
  echo "bun not found at $BUN_BIN"
  exit 1
fi

echo "=== [1/3] Build & Package ==="
"$BUN_BIN" run package:release 2>&1 | grep -E "vite v|built in|Success|ERR|Create" || true

echo ""
echo "=== [2/3] Deploy ==="
"$BUN_BIN" tools/deploy.ts 2>&1 | grep -E "Done|Error|Connected"

echo ""
echo "=== [3/3] Done ==="
