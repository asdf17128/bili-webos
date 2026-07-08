# Bilibili webOS TV App

## Quick Commands
```bash
# Build + deploy (one command)
bash build.sh

# Dev mode (browser preview, needs proxy)
cd app && npm run dev

# Start Mac proxy (only for browser dev, not needed on TV)
cd proxy && node server.js

# Remote debug TV app
node tools/debug.mjs "4E7082"

# Take screenshot from TV
node tools/screenshot.mjs

# Run API tests (proxy must be running)
node tools/test-e2e.mjs

# Run on-device UI smoke test (app must be running on the TV)
node tools/test-ui.mjs

# FULL verification pipeline (run before every release; --no-tv / --full)
bash tools/verify.sh
```

Testing methodology lives in the `tv-test` skill (.claude/skills/tv-test/SKILL.md).
Development loop + release gate: docs/DEVELOPMENT.md · Regression case registry: docs/TESTCASES.md

## Project Structure

```
bili_webos/
├── app/                          # Frontend (React + Vite)
│   ├── src/
│   │   ├── api/client.js         # B站 API (Luna service on TV, proxy fallback)
│   │   ├── api/wbi.js            # WBI signature algorithm
│   │   ├── hooks/useFocus.js     # Zero-render focus (direct DOM classList)
│   │   ├── components/           # VideoCard, VideoGrid, SidebarItem, OSKey
│   │   ├── pages/                # HomePage, SearchPage, SettingsPage, LoginPage
│   │   ├── player/               # PlayerPage (DASH), LivePlayerPage (HLS), DanmakuLayer
│   │   └── utils/                # storage.js, format.js
│   ├── public/webOSTVjs-1.2.13/  # webOS Luna bus library
│   ├── webos-meta/               # appinfo.json, icons
│   └── vite.config.js            # target: chrome108
│
├── service/                      # TV Background Service (Node.js v16)
│   └── com.biliwebos.app.service/
│       ├── service.js            # Luna methods + local HTTP proxy (:7654)
│       ├── services.json
│       └── package.json
│
├── proxy/                        # Mac proxy (dev only, optional)
│   └── server.js
│
├── tools/                        # Dev tools
│   ├── deploy.mjs                # SSH deploy via ssh2
│   ├── debug.mjs                 # CDP remote debugger
│   ├── screenshot.mjs            # Remote screenshot
│   ├── test-e2e.mjs              # API integration tests (via proxy)
│   ├── test-ui.mjs               # On-device UI smoke test (CDP drive + assert)
│   └── verify.sh                 # Full verification pipeline
│
├── build.sh                      # One-command build + deploy
├── CLAUDE.md                     # This file
└── package.json                  # Tool dependencies (ssh2, ws)
```

## Architecture

```
On TV:  Web App ──Luna bus──▶ JS Service (Node.js) ──HTTPS──▶ B站 API
                  ◀─────────
        Video/Img ──HTTP────▶ Local Proxy (:7654) ──HTTPS──▶ B站 CDN

In Dev: Web App ──HTTP──────▶ Mac Proxy (:9527) ──HTTPS──▶ B站 API/CDN
```

## TV Connection
- IP: 192.168.50.94, Port: 9922, User: prisoner
- SSH key: ~/.ssh/tv_webos (passphrase: from Developer Mode app)
- Debug port: 9998 (Chrome DevTools Protocol via SSH tunnel)
- App ID: com.biliwebos.app, Service: com.biliwebos.app.service

## Performance Rules (TV hardware)
- Focus: direct DOM classList, NO React setState
- Scroll: transform:translateY (GPU), NOT overflow:scroll
- Animations: ONLY transform + opacity (GPU compositing)
- Images: proxy through service, request @672w webp thumbnails
- React.memo on all list components
- content-visibility:auto, contain:content on cards
- Pages stay mounted (display:none behind player)
