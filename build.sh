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

echo "=== [1/3] Build & Package ==="
bun run build 2>&1 | tail -2
cp webos/meta/* dist/
cd dist
ares-package --no-minify . ../webos/service/com.biliwebos.app.service 2>&1 | grep -E "Success|ERR|Create"
cd ..

echo ""
echo "=== [2/3] Deploy ==="
bun tools/deploy.mjs 2>&1 | grep -E "Done|Error|Connected"

echo ""
echo "=== [3/3] Done ==="
