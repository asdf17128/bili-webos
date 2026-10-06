#!/bin/bash
# Full verification pipeline. Run before every release.
# Usage: bash tools/verify.sh [--no-tv] [--sim] [--full] [--ux]
#   --no-tv  skip the on-device layers (syntax/node8/build only)
#   --sim    run the SIMULATOR functional suite instead of the TV (test-sim.mjs)
#            — same coverage as the TV smoke minus what only hardware can show
#            (old-Chromium quirks, decode/perf, 倍速 via the luna bus). Boots
#            the real service via tools/dev-service.mjs so dev and TV share one
#            code path, plus vite; both are stopped again afterwards.
#   --full   also run the on-device UI smoke suite (test-ui.mjs, ~3 min)
#   --ux     run deterministic browser remote UX regressions (no real account)
#
# Layers (fail-fast top to bottom):
#   1. syntax   service files must parse as ES5 (webOS 4.x = Node 0.12.2)
#   2. static   design-spec + logic gates: no <16px text, no aspect-ratio CSS
#               (Chromium 68), play-intent policy suite (resume regression)
#   3. node8    REAL Node 0.12.2 and Node 8 via docker: evaluate service.js, drive the fetch
#               handler + getDiagnostics end-to-end (catches URL-global-type
#               regressions that took down webOS 5, #10/#13)
#   4. build    vite production build
#   5. deploy   build.sh → TV, relaunch app
#   6. device   CDP: app rendered (sidebar+cards), no broken images, screenshot
#      (+ test-ui.mjs full smoke with --full)
#
# Case registry with evidence per gate: docs/TESTCASES.md
set -eo pipefail
cd "$(dirname "$0")/.."
NO_TV=""; FULL=""; SIM=""; UX=""
for a in "$@"; do
  [ "$a" = "--no-tv" ] && NO_TV=1
  [ "$a" = "--sim" ] && SIM=1
  [ "$a" = "--full" ] && FULL=1
  [ "$a" = "--ux" ] && UX=1
done

echo "=== [1/6] Service syntax (ES5 / Node 0.12) ==="
for f in service/com.biliwebos.app.service/*.js \
         service/com.biliwebos.app.service/cast/*.js; do
  npx --yes acorn --ecma5 --silent "$f" || { echo "SYNTAX-FAIL $f (too new for Node 0.12)"; exit 1; }
done
echo "OK: all service files parse as ES5"

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
# C-UI-08: `inset` shorthand needs Chrome 87+; webOS 5/6 are 68/79 (the element
# collapses to zero size — a fixed overlay silently stops covering anything).
# 2026-08-09: 卡片菜单的遮罩就是这么写的,真机上会塌。
if grep -rn "inset: 0\|inset:0" app/src --include="*.jsx" --include="*.css" | grep -v "box-shadow" | grep -v "spec-exempt"; then
  echo "FAIL: \`inset\` shorthand found (needs Chrome 87+, webOS is 68/79)"; exit 1
fi
echo "OK: no inset shorthand"
# C-PLAY-01: play-start policy (resume shipped broken twice before this suite)
node tools/test-playintent.mjs || { echo "FAIL: play-intent policy"; exit 1; }
# C-TRI-02: 三连后的点亮状态(app/src/player/tripleState.js)。owner 2026-08-09
# 「只有收藏的数字变色」——接口回的是"这次做了什么",不是"最终什么状态"。
node tools/test-triplestate.mjs || { echo "FAIL: triple-state policy"; exit 1; }
# C-ERR-01: 接口错误码 → 用户提示(issue #20/#23:用户只看到 code=-351)
node tools/test-apihint.mjs || { echo "FAIL: api error hints"; exit 1; }
# C-LIVE-06: 直播解码失败要降档(owner 2026-08-22 黑屏:同一 qn 无限重试)
node tools/test-liveqn.mjs || { echo "FAIL: live qn ladder"; exit 1; }
node --test app/src/player/liveStream.test.js || { echo "FAIL: live stream selection"; exit 1; }
node --test app/src/player/cdnAuto.test.js || { echo "FAIL: automatic CDN routing"; exit 1; }
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
node --test app/src/player/mediaSelection.test.js || { echo "FAIL: media selection"; exit 1; }
node tools/test-library.mjs || { echo "FAIL: library playlists"; exit 1; }
node tools/test-searchhistory.mjs || { echo "FAIL: search history"; exit 1; }
npm test || { echo "FAIL: service unit tests"; exit 1; }

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

echo "=== [3/6] Service on REAL Node 0.12.2 + Node 8 (docker) ==="
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  bash tools/test-node8/test.sh | grep -vE "buvid boot|Cast server|proxy on port"
else
  echo "SKIP: docker unavailable (Node 0.12/8 regression NOT verified!)"
fi

echo ""
echo "=== [4/6] App build ==="
(cd app && npx vite build 2>&1 | tail -1)
node --input-type=commonjs <<'NODE'
const fs = require('fs'), acorn = require('./app/node_modules/acorn');
for (const name of fs.readdirSync('app/dist/assets').filter(name => name.endsWith('.js'))) {
  acorn.parse(fs.readFileSync('app/dist/assets/' + name, 'utf8'), { ecmaVersion: 2016 });
}
console.log('OK: production bundles parse as ES2016 (Chromium 53)');
NODE

# Deterministic remote UX regressions (C-UX-01 through C-UX-08).
# --no-tv --ux includes this layer without starting the real account/service.
if [ -n "$UX" ]; then
  echo "=== [UX] Browser interaction regressions ==="
  UX_VITE_PID=""
  if ! curl -s --max-time 2 http://127.0.0.1:5173 >/dev/null 2>&1; then
    (cd app && exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --strictPort > /tmp/bili-ux-vite.log 2>&1) &
    UX_VITE_PID=$!
    trap '[ -z "$UX_VITE_PID" ] || kill "$UX_VITE_PID" 2>/dev/null || true' EXIT
    for i in $(seq 1 20); do
      curl -s --max-time 2 http://127.0.0.1:5173 >/dev/null 2>&1 && break
      sleep 1
    done
  fi
  node tools/test-tv-ux.mjs
  node tools/test-player-loading.mjs
  node tools/test-live-loading.mjs
  node tools/test-playback-health.mjs
  node tools/test-cdn-auto.mjs
  if [ -n "$UX_VITE_PID" ]; then kill "$UX_VITE_PID"; trap - EXIT; fi
fi

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
echo "=== [7/7] 线上发布物体检 ==="
# 只读检查,不改任何东西:latest 的 version.json / manifest / ipk 是不是都取得到。
# 上一次发版就是漏挂资产,而本地一切正常 —— 这类问题只有从外面看才看得见。
node tools/release.mjs --check || echo "  (发版前跑到这里失败是正常的:此时 latest 还是上一版)"

echo "=== Verification complete ==="
