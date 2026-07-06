#!/bin/bash
# Regression test: the JS service must run on Node 8 (webOS 5 = Node ~8.12,
# no URL global — that broke ALL requests once, #10/#13). Runs the REAL
# service.js under docker node:8 with a stubbed webos-service, drives the
# fetch handler against api.bilibili.com and calls getDiagnostics.
set -e
cd "$(dirname "$0")"
WORK=$(mktemp -d)
cp -R ../../service/com.biliwebos.app.service/*.js ../../service/com.biliwebos.app.service/cast "$WORK/"
mkdir -p "$WORK/node_modules"
cp -R stub/webos-service "$WORK/node_modules/"
cp -R ../../service/com.biliwebos.app.service/node_modules/ws "$WORK/node_modules/" 2>/dev/null || true
cp run8.js "$WORK/"
docker run --rm --platform linux/amd64 -v "$WORK":/svc -w /svc node:8 node run8.js
rc=$?
rm -rf "$WORK"
exit $rc
