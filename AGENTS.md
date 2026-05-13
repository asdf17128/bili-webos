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
node tools/debug.mjs

# Take screenshot from TV
node tools/screenshot.mjs

# Run API tests (proxy must be running)
node tools/test-e2e.mjs
```

## Required skills when applicable:
- using-superpowers
- brainstorming
- writing-plans
- test-driven-development
- systematic-debugging
- requesting-code-review
- finishing-a-development-branch

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
│   ├── test-e2e.mjs              # API integration tests
│   └── verify.sh                 # Full verification pipeline
│
├── build.sh                      # One-command build + deploy
├── AGENTS.md                     # This file
└── package.json                  # Tool dependencies (ssh2, ws)
```

## Architecture

```
On TV:  Web App ──Luna bus──▶ JS Service (Node.js) ──HTTPS──▶ B站 API
                  ◀─────────
        Video/Img ──HTTP────▶ Local Proxy (:7654) ──HTTPS──▶ B站 CDN

In Dev: Web App ──HTTP──────▶ Mac Proxy (:9527) ──HTTPS──▶ B站 API/CDN
```
