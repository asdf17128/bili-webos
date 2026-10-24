#!/bin/bash
# Run the standard runtime assertions with official, preverified Darwin Node
# binaries when Docker is unavailable. No install/download in this runner.
set -euo pipefail
cd "$(dirname "$0")"
: "${BILI_NODE012_BINARY:?Path to SHA256-verified official Node 0.12.2 binary}"
: "${BILI_NODE8_BINARY:?Path to SHA256-verified official Node 8.17.0 binary}"
if [ "$(arch -x86_64 "$BILI_NODE012_BINARY" --version)" != 'v0.12.2' ] ||
   [ "$(arch -x86_64 "$BILI_NODE8_BINARY" --version)" != 'v8.17.0' ]; then
  echo 'BLOCKED: expected exact Node v0.12.2 and v8.17.0 runtimes'; exit 2
fi
if lsof -nP -iTCP:7654 -sTCP:LISTEN >/dev/null 2>&1; then
  echo 'BLOCKED: the standard runtime proxy port 7654 is already in use'; exit 2
fi
WORK=$(mktemp -d)
WORK=$(cd "$WORK" && pwd -P)
trap 'rm -rf "$WORK"' EXIT
cp ../../service/com.biliwebos.app.service/*.js "$WORK/"
cp -R ../../service/com.biliwebos.app.service/cast "$WORK/"
mkdir -p "$WORK/node_modules"
cp -R stub/webos-service "$WORK/node_modules/"
cp -R ../../service/com.biliwebos.app.service/node_modules/. "$WORK/node_modules/"
cp ../../service/com.biliwebos.app.service/cacert.pem "$WORK/"
cp run8.js native-preload.js "$WORK/"
cd "$WORK"
for runtime in "$BILI_NODE012_BINARY" "$BILI_NODE8_BINARY"; do
  # Reset only disposable fixture state between runtimes.
  rm -rf "$WORK/media"
  BILI_RUNTIME_SANDBOX="$WORK" arch -x86_64 "$runtime" -e "require('./native-preload.js'); require('./run8.js');"
done
