# Bilibili webOS TV App

## Quick Commands
```bash
# Build + deploy (one command)
bash build.sh

# Dev mode (browser preview, Vite dev server includes /proxy)
bun run dev

# Remote debug TV app
bun --env-file=.env tools/debug.mjs

# Take screenshot from TV
bun --env-file=.env tools/screenshot.mjs

# Run API tests (Vite dev server must be running)
bun tools/test-e2e.mjs

# Run unit tests
bun test

# Run tests with coverage report
bun test:coverage
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
├── src/                          # Frontend source (React + Vite)
│   ├── api/client.js             # B站 API (Luna service on TV, proxy fallback)
│   ├── api/wbi.js                # WBI signature algorithm
│   ├── hooks/useFocus.js         # Zero-render focus (direct DOM classList)
│   ├── components/               # VideoCard, VideoGrid, SidebarItem, OSKey
│   ├── pages/                    # HomePage, SearchPage, SettingsPage, LoginPage
│   ├── player/                   # PlayerPage (DASH), LivePlayerPage (HLS), DanmakuLayer
│   └── utils/                    # storage.js, format.js
├── public/webOSTVjs-1.2.13/      # webOS Luna bus library
├── vite.config.js                # target: chrome108, dev /proxy handler
├── webos/
│   ├── meta/                     # appinfo.json, icons
│   └── service/                  # TV Background Service (Node.js v16)
│       └── com.biliwebos.app.service/
│       ├── service.js            # Luna methods + local HTTP proxy (:7654)
│       ├── services.json
│       └── package.json
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
└── package.json                  # Single project manifest (frontend + tools)
```

## Architecture

```
On TV:  Web App ──Luna bus──▶ JS Service (Node.js) ──HTTPS──▶ B站 API
                  ◀─────────
        Video/Img ──HTTP────▶ Local Proxy (:7654) ──HTTPS──▶ B站 CDN

In Dev: Web App ──HTTP──────▶ Vite Dev Server (/proxy) ──HTTPS──▶ B站 API/CDN
```
