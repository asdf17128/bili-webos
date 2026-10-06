#!/bin/bash
# Build, package (app + service), and deploy to TV
set -eo pipefail
cd "$(dirname "$0")"
# 口令不进仓库(PR #21):环境变量 → ~/.ssh/tv_webos.pass → 报错退出。
PASS="${1:-${TV_SSH_PASSPHRASE:-$(cat "$HOME/.ssh/tv_webos.pass" 2>/dev/null)}}"
if [ -z "$PASS" ]; then
  echo "缺少电视 SSH 私钥口令:export TV_SSH_PASSPHRASE=xxx 或写入 ~/.ssh/tv_webos.pass" >&2
  exit 2
fi

# Ensure the JS service's runtime deps (ws, for live danmaku) are installed —
# node_modules is gitignored, so a fresh clone needs this before packaging.
if [ ! -d service/com.biliwebos.app.service/node_modules/ws ] || [ ! -d service/com.biliwebos.app.service/node_modules/ws-legacy ]; then
  echo "=== [0/3] Installing service deps ==="
  (cd service/com.biliwebos.app.service && npm install --no-optional --no-audit --no-fund 2>&1 | tail -1)
fi

echo "=== [1/3] Build & Package ==="
cd app
npx vite build 2>&1 | tail -2
cp webos-meta/* dist/
cd dist
ares-package --no-minify . ../../service/com.biliwebos.app.service 2>&1 | grep -E "Success|ERR|Create"
cd ../..

echo ""
echo "=== [2/3] Deploy ==="
node tools/deploy.mjs "$PASS" 2>&1 | grep -E "Done|Error|Connected"

echo ""
echo "=== [3/3] Done ==="
