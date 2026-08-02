#!/bin/bash
# Full verification pipeline. Run before every release.
# Usage: bash tools/verify.sh [--no-tv] [--sim] [--full]
#   --no-tv  skip the on-device layers (syntax/node8/build only)
#   --sim    run the SIMULATOR functional suite instead of the TV (test-sim.mjs)
#            — same coverage as the TV smoke minus what only hardware can show
#            (old-Chromium quirks, decode/perf, 倍速 via the luna bus). Boots
#            the real service via tools/dev-service.mjs so dev and TV share one
#            code path, plus vite; both are stopped again afterwards.
#   --full   also run the on-device UI smoke suite (test-ui.mjs, ~3 min)
#
# Layers (fail-fast top to bottom):
#   1. syntax   service files must parse as ES2017 (webOS 5 = Node 8)
#   2. static   design-spec + logic gates: no <16px text, no aspect-ratio CSS
#               (Chromium 68), play-intent policy suite (resume regression)
#   3. node8    REAL Node 8 via docker: evaluate service.js, drive the fetch
#               handler + getDiagnostics end-to-end (catches URL-global-type
#               regressions that took down webOS 5, #10/#13)
#   4. build    vite production build
#   5. deploy   build.sh → TV, relaunch app
#   6. device   CDP: app rendered (sidebar+cards), no broken images, screenshot
#      (+ test-ui.mjs full smoke with --full)
#
# Case registry with evidence per gate: docs/TESTCASES.md
set -e
cd "$(dirname "$0")/.."
NO_TV=""; FULL=""; SIM=""
for a in "$@"; do
  [ "$a" = "--no-tv" ] && NO_TV=1
  [ "$a" = "--sim" ] && SIM=1
  [ "$a" = "--full" ] && FULL=1
done

echo "=== [1/6] Service syntax (ES2017 / Node 8) ==="
for f in service/com.biliwebos.app.service/service.js \
         service/com.biliwebos.app.service/danmaku.js \
         service/com.biliwebos.app.service/cast/*.js; do
  npx --yes acorn --ecma2017 --silent "$f" || { echo "SYNTAX-FAIL $f (too new for Node 8)"; exit 1; }
done
echo "OK: all service files parse as ES2017"

echo ""
echo "=== [2/6] Static gates (design spec + logic) ==="
# C-UI-01: no visible text below 16px (docs/DESIGN.md; regression 2026-07-08)
if grep -rn "fontSize: 1[0-5]\b" app/src --include="*.jsx" | grep -v "// spec-exempt"; then
  echo "FAIL: fontSize <16px found (10-foot spec, docs/DESIGN.md)"; exit 1
fi
echo "OK: no <16px inline text"
# C-UI-02: aspect-ratio CSS needs Chrome 88+; webOS 5/6 are 68/79 (covers collapse).
# BOTH spellings, BOTH file kinds — the CSS spelling in styles.css slipped
# through the jsx-only grep for weeks (caught 2026-07-11 pre-v1.3.0).
if grep -rn "aspectRatio" app/src --include="*.jsx" | grep -v "// spec-exempt"; then
  echo "FAIL: aspectRatio (JSX) found (unsupported on webOS 5/6)"; exit 1
fi
if grep -rnE "aspect-ratio[[:space:]]*:" app/src --include="*.css" | grep -v "/\* spec-exempt \*/"; then
  echo "FAIL: aspect-ratio (CSS) found (unsupported on webOS 5/6)"; exit 1
fi
echo "OK: no aspect-ratio CSS"
# C-PLAY-01: play-start policy (resume shipped broken twice before this suite)
node tools/test-playintent.mjs || { echo "FAIL: play-intent policy"; exit 1; }
# C-I18N-01: every t('…') key covered in every dictionary (missing = zh fallback leaks)
node tools/test-i18n-coverage.mjs || { echo "FAIL: i18n coverage"; exit 1; }
# C-I18N-04: locale-aware formatters (万/亿 vs K/M, relative time)
node tools/test-i18n-format.mjs || { echo "FAIL: i18n formatters"; exit 1; }
# C-SUB-01: subtitle cue parse/pick (wrong index paints the wrong line on screen)
node tools/test-subtitle.mjs || { echo "FAIL: subtitle helpers"; exit 1; }
# C-SUB-03: subtitle MT pipeline (batching/alignment/cache — misalignment must throw)
node tools/test-subtranslate.mjs || { echo "FAIL: subtitle MT pipeline"; exit 1; }
# C-DM-01: danmaku MT rolling window (dedup/global cache/retry/batch cap)
node tools/test-dmtranslate.mjs || { echo "FAIL: danmaku MT"; exit 1; }
# C-UI-08: arc_aigc declaration extraction (undocumented field, defensive)
node tools/test-aigc.mjs || { echo "FAIL: aigc extraction"; exit 1; }
# C-CAST-03: DLNA URL rewrite (Huya FLV→HLS; non-Huya untouched)
node tools/test-casturl.mjs || { echo "FAIL: cast url rewrite"; exit 1; }
# C-SRCH-02: search-history dedup/cap
node tools/test-searchhistory.mjs || { echo "FAIL: search history"; exit 1; }

echo ""
# Version drift gate: appinfo.json (what webOS installs) and src/version.js
# (what 设置 → 关于 shows and the update check compares) must agree. They
# drifted once — appinfo 1.5.0 vs version.js 1.4.0 — so every v1.5.0 user was
# permanently told "发现新版 v1.5.0". Only a human noticed.
V_APP=$(node -e "console.log(require('./app/webos-meta/appinfo.json').version)")
V_SRC=$(grep -oE "APP_VERSION = '[^']+'" app/src/version.js | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")
if [ "$V_APP" != "$V_SRC" ]; then
  echo "FAIL: version drift — appinfo.json=$V_APP but src/version.js=$V_SRC"; exit 1
fi
echo "OK: version $V_APP consistent (appinfo == src/version.js)"

echo "=== [3/6] Service on REAL Node 8 (docker) ==="
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  bash tools/test-node8/test.sh | grep -vE "buvid boot|Cast server|proxy on port"
else
  echo "SKIP: docker unavailable (Node 8 regression NOT verified!)"
fi

echo ""
echo "=== [4/6] App build ==="
(cd app && npx vite build 2>&1 | tail -1)

if [ -n "$SIM" ]; then
  echo ""
  echo "=== [S] Simulator functional suite (test-sim.mjs) ==="
  # Bring up the pieces the suite needs, remember what WE started so a dev
  # session already running isn't killed underneath the user.
  STARTED_SVC=""; STARTED_VITE=""
  if ! curl -s --max-time 3 http://127.0.0.1:9528/ping >/dev/null 2>&1; then
    (node tools/dev-service.mjs > /tmp/verify-dev-service.log 2>&1 &)
    STARTED_SVC=1
    for i in $(seq 1 20); do
      curl -s --max-time 2 http://127.0.0.1:9528/ping >/dev/null 2>&1 && break
      sleep 1
    done
    curl -s --max-time 2 http://127.0.0.1:9528/ping >/dev/null 2>&1 \
      && echo "  bridge ready after ${i}s" \
      || { echo "  bridge FAILED to start — see /tmp/verify-dev-service.log"; tail -3 /tmp/verify-dev-service.log; }
  fi
  if ! curl -s --max-time 2 http://127.0.0.1:5173 >/dev/null 2>&1; then
    (cd app && npm run dev > /tmp/verify-vite.log 2>&1 &)
    STARTED_VITE=1
    for i in $(seq 1 25); do
      curl -s --max-time 2 http://127.0.0.1:5173 >/dev/null 2>&1 && break
      sleep 1
    done
  fi
  set +e
  SIM_STRICT=1 node tools/test-sim.mjs
  SIM_RC=$?
  set -e
  # dev-service advertises SSDP as 我的小电视 — leaving it up would put a
  # second identical device in the phone's cast list.
  [ -n "$STARTED_SVC" ] && pkill -f "tools/dev-service.mjs" 2>/dev/null
  [ -n "$STARTED_VITE" ] && pkill -f "bili_webos/app/node_modules/.bin/vite" 2>/dev/null
  [ "$SIM_RC" != "0" ] && { echo "FAIL: simulator suite"; exit 1; }
fi

if [ -n "$NO_TV" ]; then echo ""; echo "=== --no-tv: done ==="; exit 0; fi

echo ""
echo "=== [5/6] Deploy to TV ==="
bash build.sh 2>&1 | tail -1
node tools/launch.mjs com.biliwebos.app >/dev/null 2>&1 || true
sleep 8

echo ""
echo "=== [6/6] On-device check (CDP) ==="
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
