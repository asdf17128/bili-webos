#!/bin/bash
# Kill the dev processes that make noise after a test session (owner: "测试完
# 记得把模拟器跟电视上的app都关掉,不然有点吵" — twice). Wired as a Stop hook so
# it runs mechanically instead of depending on the assistant remembering.
#
# Only touches OUR dev processes: the vite dev server and the Mac proxy. Browser
# media in dev streams through the proxy, so killing it stops playback audio.
# Never touches the TV (the owner may be watching) and never touches the user's
# own apps.
killed=""
pgrep -f "bili_webos/app/node_modules/.bin/vite" > /dev/null 2>&1 && { pkill -f "bili_webos/app/node_modules/.bin/vite"; killed="$killed vite"; }
pgrep -f "bili_webos/proxy/server.js" > /dev/null 2>&1 && { pkill -f "bili_webos/proxy/server.js"; killed="$killed proxy"; }
[ -n "$killed" ] && echo "quiet-dev: stopped$killed (dev audio sources)"
exit 0
