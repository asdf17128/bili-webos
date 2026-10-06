#!/bin/bash
# Run the real service on Node 0.12.2 (webOS 4.x) and Node 8 (webOS 5/6).
# Exercise fetch + diagnostics + loading the appropriate danmaku WebSocket
# module, with only the Luna bus stubbed. See issues #10/#13/#34.
set -e
cd "$(dirname "$0")"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp -R ../../service/com.biliwebos.app.service/*.js ../../service/com.biliwebos.app.service/cast "$WORK/"
mkdir -p "$WORK/node_modules"
cp -R stub/webos-service "$WORK/node_modules/"
cp -R ../../service/com.biliwebos.app.service/node_modules/. "$WORK/node_modules/"
cp ../../service/com.biliwebos.app.service/cacert.pem "$WORK/"
cp run8.js "$WORK/"
# Docker Hub's historic node:0.12 manifest is no longer reliably pullable.
# Run the official, SHA256-verified 0.12.2 binary inside the same x86 Node 8
# image (matches webOS 4.x exactly, rather than its later 0.12.18 patch).
NODE012_DIR="${BILI_NODE012_DIR:-${TMPDIR:-/tmp}/bili-node-0.12.2}"
if [ ! -x "$NODE012_DIR/bin/node" ]; then
  mkdir -p "$NODE012_DIR"
  curl -fsSL --max-time 60 https://nodejs.org/dist/v0.12.2/node-v0.12.2-linux-x64.tar.gz -o "$WORK/node-v0.12.2-linux-x64.tar.gz"
  curl -fsSL --max-time 30 https://nodejs.org/dist/v0.12.2/SHASUMS256.txt -o "$WORK/SHASUMS256.txt"
  (cd "$WORK" && grep ' node-v0.12.2-linux-x64.tar.gz$' SHASUMS256.txt | shasum -a 256 -c -)
  tar -xzf "$WORK/node-v0.12.2-linux-x64.tar.gz" --strip-components=1 -C "$NODE012_DIR"
fi
echo "Testing Node 0.12.2"
# Explicit ELF loader avoids Rosetta corrupting the old Node CLI arguments.
docker run --rm --platform linux/amd64 --entrypoint /lib64/ld-linux-x86-64.so.2 -v "$WORK":/svc -v "$NODE012_DIR":/node012:ro -w /svc node:8 /node012/bin/node run8.js
echo "Testing Node 8"
docker run --rm --platform linux/amd64 -v "$WORK":/svc -w /svc node:8 node run8.js
