#!/bin/bash
# Full verification pipeline. Run before every release.
# Usage: bash tools/verify.sh [--no-tv] [--full]
#   --no-tv  skip the on-device layers (syntax/node8/build only)
#   --full   also run the on-device UI smoke suite (test-ui.mjs, ~3 min)
#
# Layers (fail-fast top to bottom):
#   1. syntax   service files must parse as ES2017 (webOS 5 = Node 8)
#   2. node8    REAL Node 8 via docker: evaluate service.js, drive the fetch
#               handler + getDiagnostics end-to-end (catches URL-global-type
#               regressions that took down webOS 5, #10/#13)
#   3. build    vite production build
#   4. deploy   build.sh → TV, relaunch app
#   5. device   CDP: app rendered (sidebar+cards), no broken images, screenshot
#      (+ test-ui.mjs full smoke with --full)
set -e
cd "$(dirname "$0")/.."
NO_TV=""; FULL=""
for a in "$@"; do
  [ "$a" = "--no-tv" ] && NO_TV=1
  [ "$a" = "--full" ] && FULL=1
done

echo "=== [1/5] Service syntax (ES2017 / Node 8) ==="
for f in service/com.biliwebos.app.service/service.js \
         service/com.biliwebos.app.service/danmaku.js \
         service/com.biliwebos.app.service/cast/*.js; do
  npx --yes acorn --ecma2017 --silent "$f" || { echo "SYNTAX-FAIL $f (too new for Node 8)"; exit 1; }
done
echo "OK: all service files parse as ES2017"

echo ""
echo "=== [2/5] Service on REAL Node 8 (docker) ==="
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  bash tools/test-node8/test.sh | grep -vE "buvid boot|Cast server|proxy on port"
else
  echo "SKIP: docker unavailable (Node 8 regression NOT verified!)"
fi

echo ""
echo "=== [3/5] App build ==="
(cd app && npx vite build 2>&1 | tail -1)

if [ -n "$NO_TV" ]; then echo ""; echo "=== --no-tv: done ==="; exit 0; fi

echo ""
echo "=== [4/5] Deploy to TV ==="
bash build.sh 2>&1 | tail -1
node tools/launch.mjs com.biliwebos.app >/dev/null 2>&1 || true
sleep 8

echo ""
echo "=== [5/5] On-device check (CDP) ==="
node tools/eval.mjs "(function(){
  var cards = document.querySelectorAll('[data-focus-id]').length;
  var sidebar = !!document.querySelector('.sidebar');
  var broken = [].slice.call(document.querySelectorAll('img')).filter(function(i){return i.complete && i.naturalWidth === 0;}).length;
  var ok = cards > 5 && sidebar && broken === 0;
  return (ok ? 'PASS' : 'FAIL') + ' cards=' + cards + ' sidebar=' + sidebar + ' brokenImgs=' + broken;
})()" | tail -1 | tee /tmp/verify5.out
grep -q PASS /tmp/verify5.out || exit 1
node tools/screenshot.mjs >/dev/null 2>&1 && echo "screenshot.png saved"

if [ -n "$FULL" ]; then
  echo ""
  echo "=== [full] On-device UI smoke (test-ui.mjs) ==="
  node tools/test-ui.mjs
fi

echo ""
echo "=== Verification complete ==="
