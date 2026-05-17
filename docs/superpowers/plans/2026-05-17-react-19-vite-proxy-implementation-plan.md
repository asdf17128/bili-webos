# React 19 And Vite Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone browser-dev proxy with a Vite-hosted proxy, then upgrade the app to React 19 without losing dev proxy behavior, tests, or coverage.

**Architecture:** Keep the TV Luna + local `:7654` service flow unchanged, but switch browser development to the Vite server origin for `/proxy/:host/...` requests. Extract proxy parsing/rewrite helpers into a tested Node-side module imported by `vite.config.js`, delegate transport to `http-proxy`, preserve cookie bridging and HLS rewriting, then upgrade React and the renderer test harness in a separate phase.

**Tech Stack:** Bun, React 19.2.6, Vite 6, `@vitejs/plugin-react` 6.0.2, `http-proxy` 1.18.1, Node `zlib`, `react-test-renderer` 19.2.6

---

### Task 1: Refactor Client-Side Proxy Base Selection Under React 18

**Files:**
- Modify: `app/src/utils/proxy.js`
- Modify: `app/src/api/client.js`
- Modify: `app/src/utils/proxy.test.mjs`
- Modify: `app/src/api/client.integration.test.mjs`
- Modify: `app/src/components/components.render.test.mjs`
- Modify: `app/src/pages/pages.render.test.mjs`
- Modify: `app/src/utils/storage.js`
- Modify: `app/src/utils/storage.test.mjs`
- Modify: `app/src/pages/SettingsPage.jsx`

- [ ] **Step 1: Write failing tests for the new browser-dev proxy base**

```js
// app/src/utils/proxy.test.mjs
import { test, expect } from 'bun:test';
import { buildProxyUrl, getProxyBase, LOCAL_PROXY_BASE } from './proxy.js';

test('getProxyBase uses current origin in localhost dev', () => {
  expect(getProxyBase({
    env: { DEV: true },
    location: { origin: 'http://localhost:5173', hostname: 'localhost' },
  })).toBe('http://localhost:5173');
});

test('getProxyBase keeps TV local proxy outside localhost dev', () => {
  expect(getProxyBase({
    env: { DEV: false },
    location: { origin: 'http://192.168.1.2:8080', hostname: '192.168.1.2' },
  })).toBe(LOCAL_PROXY_BASE);
});

test('buildProxyUrl rewrites through the active proxy base', () => {
  expect(buildProxyUrl('https://i0.hdslb.com/bfs/archive/a.png?x=1', {
    env: { DEV: true },
    location: { origin: 'http://localhost:5173', hostname: 'localhost' },
  })).toBe('http://localhost:5173/proxy/i0.hdslb.com/bfs/archive/a.png?x=1');
});
```

- [ ] **Step 2: Run the proxy helper tests and verify they fail against the old `:9527` behavior**

Run:

```bash
bun test app/src/utils/proxy.test.mjs
```

Expected: FAIL because `getProxyBase()` still depends on `VITE_USE_PROXY` and returns `http://127.0.0.1:7654` or stored `:9527` values instead of the current Vite origin.

- [ ] **Step 3: Write failing client integration and UI tests for the new fallback path**

```js
// app/src/api/client.integration.test.mjs
beforeEach(() => {
  globalThis.localStorage = makeStorage();
  globalThis.window = {
    location: {
      hostname: 'localhost',
      origin: 'http://localhost:5173',
    },
  };
});

it('falls back to the Vite dev server proxy and persists cookie updates', async () => {
  const calls = [];
  globalThis.fetch = mock((url) => {
    calls.push(url);
    return Promise.resolve({
      headers: {
        get: (name) => {
          if (name === 'content-type') return 'application/json';
          if (name === 'X-Set-Cookie') return JSON.stringify({ DedeUserID: '100' });
          return null;
        },
      },
      json: async () => ({ code: 0, data: { ok: true } }),
    });
  });

  const res = await apiFetch('/x/test', { q: 'k' });
  expect(res.data.ok).toBe(true);
  expect(calls[0]).toBe('http://localhost:5173/proxy/api.bilibili.com/x/test?q=k');
});
```

```js
// app/src/pages/pages.render.test.mjs
expect(textOf(renderer.toJSON())).not.toContain('代理: http://127.0.0.1:9527');
```

```js
// app/src/components/components.render.test.mjs
expect(img.props.src).toBe('http://127.0.0.1:7654/proxy/i0.hdslb.com/test.jpg@672w_420h_1c.webp');
```

The image assertion stays the same to prove TV-mode defaults are preserved even while browser dev changes.

- [ ] **Step 4: Run the targeted client tests and verify they fail for the right reason**

Run:

```bash
bun test app/src/api/client.integration.test.mjs app/src/components/components.render.test.mjs app/src/pages/pages.render.test.mjs app/src/utils/storage.test.mjs
```

Expected:
- `client.integration.test.mjs` fails because `client.js` still builds proxy URLs from `storage.getProxyUrl()`
- `pages.render.test.mjs` fails because `SettingsPage` still renders the old `代理: ...9527` text
- `storage.test.mjs` fails once proxy URL helpers are removed or narrowed

- [ ] **Step 5: Implement the minimal runtime proxy-base refactor**

```js
// app/src/utils/proxy.js
const LOCAL_PROXY_BASE = 'http://127.0.0.1:7654';

function isLocalDevLocation(location) {
  const hostname = location?.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function getProxyBase(options = {}) {
  const {
    env = import.meta.env,
    location = typeof window !== 'undefined' ? window.location : undefined,
  } = options;

  if (env?.DEV && isLocalDevLocation(location) && location?.origin) {
    return location.origin.replace(/\/$/, '');
  }

  return LOCAL_PROXY_BASE;
}

export function buildProxyUrl(url, options = {}) {
  const parsed = new URL(url);
  return `${getProxyBase(options)}/proxy/${parsed.host}${parsed.pathname}${parsed.search}`;
}

export { LOCAL_PROXY_BASE };
```

```js
// app/src/api/client.js
import { buildProxyUrl } from '../utils/proxy';

function proxyFetchRaw(url, options) {
  var proxyUrl = buildProxyUrl(url);
  var headers = Object.assign({}, options.headers || {});
  if (options.contentType) {
    headers['Content-Type'] = options.contentType;
  } else if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(proxyUrl, {
    method: options.method || 'GET',
    headers: headers,
    body: options.body,
  }).then(function(res) {
    var setCookie = res.headers.get('X-Set-Cookie');
    if (setCookie) {
      try {
        var newCookies = JSON.parse(setCookie);
        var auth = storage.getAuth() || {};
        storage.setAuth(Object.assign({}, auth, newCookies));
      } catch (e) {}
    }
    return res;
  });
}

export async function getDanmaku(cid) {
  var url = buildProxyUrl('https://api.bilibili.com/x/v1/dm/list.so?oid=' + cid);
  var proxyRes = await fetch(url);
  var text = await proxyRes.text();
  return parseDanmakuXml(text);
}
```

```js
// app/src/pages/SettingsPage.jsx
export default function SettingsPage({ onLogout, user, onPlayVideo }) {
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState(storage.getSettings());

  React.useEffect(() => {
    if (!user) return;
    async function load() {
      try {
        const res = await getHistory(0, 0, 12);
        if (res?.data?.list) {
          setHistory(res.data.list.map(item => ({
            bvid: item.history?.bvid,
            cid: item.history?.cid,
            title: item.title,
            pic: item.cover,
            duration: item.duration,
            progress: item.progress,
            owner: { name: item.author_name },
          })));
        }
      } catch {}
    }
    load();
  }, [user]);

  return (
    <div style={{ padding: '20px 28px', height: '100%', overflow: 'auto' }}>
      <div style={{ fontSize: 26, fontWeight: 600, color: '#fff', marginBottom: 20 }}>
        {user ? `${user.uname} 的空间` : '我的'}
      </div>
    </div>
  );
}
```

```js
// app/src/utils/storage.js
const PREFIX = 'bili_';

export const storage = {
  get(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {}
  },

  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {}
  },

  getAuth() {
    return this.get('auth') || null;
  },

  setAuth(auth) {
    this.set('auth', auth);
  },

  clearAuth() {
    this.remove('auth');
  },

  getSettings() {
    return this.get('settings') || {
      danmaku: true,
      quality: 80,
    };
  },

  setSettings(settings) {
    this.set('settings', settings);
  },
};
```

- [ ] **Step 6: Run the targeted suite and confirm the refactor is green**

Run:

```bash
bun test app/src/utils/proxy.test.mjs app/src/api/client.integration.test.mjs app/src/components/components.render.test.mjs app/src/pages/pages.render.test.mjs app/src/utils/storage.test.mjs
```

Expected: PASS. Browser dev tests should now expect `http://localhost:5173`, while TV-facing image tests should still expect `http://127.0.0.1:7654`.

- [ ] **Step 7: Commit the client-side proxy-base refactor**

```bash
git add app/src/utils/proxy.js app/src/api/client.js app/src/utils/proxy.test.mjs app/src/api/client.integration.test.mjs app/src/components/components.render.test.mjs app/src/pages/pages.render.test.mjs app/src/utils/storage.js app/src/utils/storage.test.mjs app/src/pages/SettingsPage.jsx
git commit -m "refactor: route browser dev proxy through vite origin"
```

### Task 2: Implement the Vite-Hosted Dev Proxy with Cookie Bridge and HLS Rewrite

**Files:**
- Create: `app/src/dev/biliProxy.js`
- Create: `app/src/dev/biliProxy.test.mjs`
- Modify: `app/vite.config.js`
- Modify: `app/package.json`

- [ ] **Step 1: Write failing tests for the Node-side proxy helper module**

```js
// app/src/dev/biliProxy.test.mjs
import { describe, expect, test } from 'bun:test';
import {
  extractProxyTarget,
  isAllowedHost,
  isHlsPlaylistResponse,
  toCookieBridge,
} from './biliProxy.js';

test('extractProxyTarget parses host and upstream path from /proxy requests', () => {
  expect(extractProxyTarget('/proxy/api.bilibili.com/x/web-interface/nav?pn=1')).toEqual({
    host: 'api.bilibili.com',
    hostname: 'api.bilibili.com',
    port: 443,
    upstreamPath: '/x/web-interface/nav?pn=1',
  });
});

test('isAllowedHost accepts bilivideo and hdslb domains but rejects others', () => {
  expect(isAllowedHost('i0.hdslb.com')).toBe(true);
  expect(isAllowedHost('upos-sz-static.bilivideo.com')).toBe(true);
  expect(isAllowedHost('example.com')).toBe(false);
});

test('toCookieBridge serializes Set-Cookie headers into the existing JSON bridge', () => {
  expect(toCookieBridge([
    'SESSDATA=abc; Path=/; HttpOnly',
    'DedeUserID=100; Path=/',
  ])).toBe('{"SESSDATA":"abc","DedeUserID":"100"}');
});

test('isHlsPlaylistResponse matches both content type and .m3u8 paths', () => {
  expect(isHlsPlaylistResponse('application/vnd.apple.mpegurl', '/live/index.m3u8')).toBe(true);
  expect(isHlsPlaylistResponse('text/plain', '/live/index.m3u8')).toBe(true);
  expect(isHlsPlaylistResponse('video/mp2t', '/live/segment.ts')).toBe(false);
});
```

- [ ] **Step 2: Run the helper tests and verify they fail because the module does not exist**

Run:

```bash
bun test app/src/dev/biliProxy.test.mjs
```

Expected: FAIL with a module resolution error for `./biliProxy.js`.

- [ ] **Step 3: Add the transport dependency used by the Vite dev plugin**

Run:

```bash
bun --cwd app add -d http-proxy@1.18.1
```

Expected: `app/package.json` gains `http-proxy` in `devDependencies`, and `app/bun.lock` updates.

- [ ] **Step 4: Implement the tested proxy helper and Vite plugin entry points**

```js
// app/src/dev/biliProxy.js
import httpProxy from 'http-proxy';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rewriteHlsPlaylist } = require('../../../service/com.biliwebos.app.service/cast/hlsPlaylist.js');

const ALLOWED_HOSTS = [
  'api.bilibili.com',
  'passport.bilibili.com',
  'api.live.bilibili.com',
  's1.hdslb.com',
  'i0.hdslb.com',
  'i1.hdslb.com',
  'i2.hdslb.com',
  'comment.bilibili.com',
];

export function isAllowedHost(host) {
  return ALLOWED_HOSTS.some((item) => host === item || host.endsWith('.' + item))
    || host.endsWith('.bilivideo.com')
    || host.endsWith('.bilivideo.cn')
    || host.endsWith('.hdslb.com')
    || host.endsWith('.akamaized.net');
}

export function extractProxyTarget(url) {
  const reqUrl = new URL(url, 'http://localhost:5173');
  const targetPath = reqUrl.pathname.slice('/proxy/'.length);
  const slashIdx = targetPath.indexOf('/');
  const host = slashIdx >= 0 ? targetPath.slice(0, slashIdx) : targetPath;
  const pathname = slashIdx >= 0 ? targetPath.slice(slashIdx) : '/';
  const [hostname, portRaw] = host.split(':');
  return {
    host,
    hostname,
    port: portRaw ? parseInt(portRaw, 10) : 443,
    upstreamPath: pathname + reqUrl.search,
  };
}

export function toCookieBridge(setCookieHeaders = []) {
  const payload = {};
  for (const entry of setCookieHeaders) {
    const parts = String(entry).split(';')[0];
    const [key, ...rest] = parts.split('=');
    if (key) payload[key.trim()] = rest.join('=').trim();
  }
  return JSON.stringify(payload);
}

export function isHlsPlaylistResponse(contentType = '', upstreamPath = '') {
  return contentType.includes('mpegurl') || upstreamPath.endsWith('.m3u8');
}

export function createBiliDevProxyPlugin() {
  const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    secure: false,
    selfHandleResponse: false,
  });

  return {
    name: 'bili-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/proxy', (req, res, next) => {
        const target = extractProxyTarget(req.url);
        if (!isAllowedHost(target.hostname)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Host not allowed: ' + target.hostname }));
          return;
        }

        req.__biliProxyTarget = target;
        proxy.web(req, res, {
          target: `https://${target.host}`,
          ignorePath: true,
          selfHandleResponse: false,
        });
      });
    },
  };
}
```

- [ ] **Step 5: Wire the helper into Vite and preserve cookie/no-cache/HLS behavior**

```js
// app/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createBiliDevProxyPlugin } from './src/dev/biliProxy.js';

export default defineConfig({
  plugins: [
    react(),
    createBiliDevProxyPlugin(),
  ],
  base: './',
  build: {
    outDir: 'dist',
    target: 'chrome108',
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: {
          shaka: ['shaka-player'],
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
```

The implementation inside `createBiliDevProxyPlugin()` must also add:

```js
proxy.on('proxyReq', (proxyReq, req) => {
  const { hostname } = req.__biliProxyTarget;
  const isCdn = hostname.includes('bilivideo') || hostname.includes('akamaized');
  proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  proxyReq.setHeader('Referer', 'https://www.bilibili.com/');
  proxyReq.setHeader('Accept-Language', 'zh-CN,zh;q=0.9');
  proxyReq.setHeader('Accept', isCdn ? '*/*' : 'application/json, text/plain, */*');
  proxyReq.setHeader('Accept-Encoding', isCdn ? 'identity' : 'gzip, deflate, br');
  if (!isCdn) proxyReq.setHeader('Origin', 'https://www.bilibili.com');
});

proxy.on('proxyRes', async (proxyRes, req, res) => {
  const bridge = toCookieBridge(proxyRes.headers['set-cookie'] || []);
  if (bridge !== '{}') res.setHeader('X-Set-Cookie', bridge);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Access-Control-Expose-Headers', 'X-Set-Cookie, Content-Range, Content-Length');
  // if isHlsPlaylistResponse(...), decompress + rewrite body before responding
});
```

For HLS responses, reuse `rewriteHlsPlaylist()` from the service helper and keep the old gzip/deflate/brotli handling before body rewrite.

- [ ] **Step 6: Run the focused dev-proxy tests and a build smoke test**

Run:

```bash
bun test app/src/dev/biliProxy.test.mjs app/src/utils/proxy.test.mjs app/src/api/client.integration.test.mjs
bun --cwd app run build
```

Expected:
- test suite PASS
- Vite build PASS with the new dev proxy plugin imported

- [ ] **Step 7: Commit the Vite proxy implementation**

```bash
git add app/src/dev/biliProxy.js app/src/dev/biliProxy.test.mjs app/vite.config.js app/package.json app/bun.lock
git commit -m "feat: host browser proxy in vite dev server"
```

### Task 3: Retire the Standalone Proxy Workflow and Update Developer Docs

**Files:**
- Modify: `package.json`
- Delete: `proxy/server.js`
- Delete: `proxy/package.json`
- Modify: `tools/test-e2e.mjs`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Write a failing expectation for the new dev command shape**

```js
// No new JS test file needed here.
// The executable regression is the npm script contract:
// `bun run dev` must start only the app dev server.
```

Use a command-level check instead of a unit test:

```bash
node -e "const pkg=require('./package.json'); if (pkg.scripts.dev.includes('dev:proxy')) process.exit(1)"
```

Expected: exit code `1` before the change.

- [ ] **Step 2: Remove the standalone proxy scripts and files**

```json
// package.json
{
  "scripts": {
    "dev": "bun --cwd app run dev",
    "build": "bun --cwd app run build",
    "test": "bun test service/com.biliwebos.app.service/test/*.test.js app/src/**/*.test.mjs",
    "test:coverage": "bun test --preload ./tools/coverage-preload.mjs --coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage"
  }
}
```

```bash
rm proxy/server.js proxy/package.json
```

- [ ] **Step 3: Repoint the E2E helper and docs from `:9527` to the Vite server**

```js
// tools/test-e2e.mjs
const PROXY = 'http://localhost:5173';
```

```md
<!-- README.md -->
### 开发模式

```bash
# 启动浏览器开发模式（Vite dev server 内置 /proxy）
bun run dev
# 浏览器打开 http://localhost:5173
```

```md
<!-- AGENTS.md -->
# Start Mac proxy (remove this line)
# Dev mode now uses the Vite dev server proxy only
```

```md
<!-- DESIGN.md -->
In Dev: Web App ──HTTP──────▶ Vite Dev Server (/proxy) ──HTTPS──▶ B站 API/CDN
```

- [ ] **Step 4: Verify the new dev workflow and doc references**

Run:

```bash
node -e "const pkg=require('./package.json'); if (pkg.scripts.dev.includes('dev:proxy')) process.exit(1)"
rg -n "proxy/server\\.js|dev:proxy|9527|VITE_USE_PROXY" README.md AGENTS.md DESIGN.md package.json tools/test-e2e.mjs app/src
```

Expected:
- command exits `0`
- `rg` shows no stale browser-dev references to the retired `proxy/` flow

- [ ] **Step 5: Commit the proxy retirement and doc updates**

```bash
git add package.json tools/test-e2e.mjs README.md AGENTS.md DESIGN.md
git rm proxy/server.js proxy/package.json
git commit -m "chore: retire standalone dev proxy"
```

### Task 4: Upgrade React to 19.2.6 and Stabilize the Renderer Test Harness

**Files:**
- Modify: `package.json`
- Modify: `app/package.json`
- Modify: `app/src/test/reactTestUtils.mjs`
- Create: `app/src/test/reactTestUtils.test.mjs`
- Modify: `bun.lock`
- Modify: `app/bun.lock`

- [ ] **Step 1: Write a failing harness smoke test before the dependency bump**

```js
// app/src/test/reactTestUtils.test.mjs
import { test, expect } from 'bun:test';
import { React, render, update, textOf } from './reactTestUtils.mjs';

function Counter({ count }) {
  return React.createElement('div', null, 'count:' + count);
}

test('reactTestUtils render/update smoke test', async () => {
  const renderer = await render(React.createElement(Counter, { count: 1 }));
  expect(textOf(renderer.toJSON())).toBe('count:1');
  await update(renderer, React.createElement(Counter, { count: 2 }));
  expect(textOf(renderer.toJSON())).toBe('count:2');
});
```

- [ ] **Step 2: Run the harness smoke test and verify it passes before the upgrade**

Run:

```bash
bun test app/src/test/reactTestUtils.test.mjs
```

Expected: PASS on the current React 18.3.1 toolchain, establishing a clean baseline.

- [ ] **Step 3: Upgrade the React packages to the current React 19 patch line**

```json
// package.json
{
  "devDependencies": {
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "react-test-renderer": "19.2.6"
  }
}
```

```json
// app/package.json
{
  "dependencies": {
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "shaka-player": "^4.12.0",
    "mpegts.js": "^1.8.0",
    "qrcode": "^1.5.4"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^6.0.2",
    "react-test-renderer": "19.2.6",
    "vite": "^6.0.0",
    "http-proxy": "^1.18.1"
  }
}
```

Run:

```bash
bun install
cd app && bun install && cd ..
```

- [ ] **Step 4: Apply the React 19 `act` import update in the shared test harness**

```js
// app/src/test/reactTestUtils.mjs
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';

export { React, TestRenderer, act };

export async function render(element, options) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(element, options);
    await flush();
  });
  return renderer;
}
```

This is a direct React 19 compatibility cleanup based on the upgrade guide's move toward `React.act`.

- [ ] **Step 5: Run the harness smoke test and the existing render-heavy suites**

Run:

```bash
bun test app/src/test/reactTestUtils.test.mjs app/src/App.render.test.mjs app/src/components/components.render.test.mjs app/src/pages/pages.render.test.mjs app/src/player/player.render.test.mjs
```

Expected:
- PASS if `react-test-renderer` remains usable in this Bun environment
- If these suites fail with renderer-internal crashes, stop immediately, patch `app/src/test/reactTestUtils.mjs` first, and rerun this exact command before touching any feature test files

- [ ] **Step 6: Run the full suite after the React upgrade**

Run:

```bash
bun test
bun test:coverage
bun --cwd app run build
```

Expected:
- all tests PASS
- coverage report completes without dropping below the pre-task baseline
- app build PASS under React 19

- [ ] **Step 7: Commit the React 19 upgrade**

```bash
git add package.json bun.lock app/package.json app/bun.lock app/src/test/reactTestUtils.mjs app/src/test/reactTestUtils.test.mjs
git commit -m "build: upgrade app to react 19"
```

### Task 5: Remove Only Clearly Redundant Memoization and Finish Verification

**Files:**
- Modify: `app/src/components/FocusableTab.jsx`
- Modify: `app/src/components/OSKey.jsx`
- Modify: `app/src/components/SidebarItem.jsx`
- Modify: `app/src/components/components.render.test.mjs`

- [ ] **Step 1: Write a focused regression test for simple callback-wrapper components**

```js
// app/src/components/components.render.test.mjs
test('FocusableTab passes the original onSelect callback into useFocusable', async () => {
  const { default: FocusableTab } = await importComponent('./FocusableTab.jsx');
  const onSelect = () => focusCalls.push('tab');
  await render(React.createElement(FocusableTab, {
    id: 'tab-2',
    row: 0,
    col: 0,
    group: 'content',
    label: '推荐',
    active: false,
    onSelect,
  }));
  expect(focusConfigs.at(-1).onSelect).toBe(onSelect);
});

test('OSKey passes the original onPress callback into useFocusable', async () => {
  const { default: OSKey } = await importComponent('./OSKey.jsx');
  const onPress = () => focusCalls.push('key');
  await render(React.createElement(OSKey, {
    id: 'osk-1-1',
    row: 1,
    col: 1,
    group: 'content',
    label: '确定',
    isAction: false,
    onPress,
  }));
  expect(focusConfigs.at(-1).onSelect).toBe(onPress);
});

test('SidebarItem passes the original onSelect callback into useFocusable', async () => {
  const { default: SidebarItem } = await importComponent('./SidebarItem.jsx');
  const onSelect = () => focusCalls.push('sidebar');
  await render(React.createElement(SidebarItem, {
    id: 'sidebar-2-0',
    row: 2,
    icon: '📺',
    label: '直播',
    active: false,
    onSelect,
  }));
  expect(focusConfigs.at(-1).onSelect).toBe(onSelect);
});
```

- [ ] **Step 2: Run the focused component regression and verify it fails before the cleanup**

Run:

```bash
bun test app/src/components/components.render.test.mjs
```

Expected: FAIL because each component currently wraps the incoming callback in `useCallback`, so `focusConfigs.at(-1).onSelect` is a different function reference.

- [ ] **Step 3: Remove only the obvious wrapper callbacks**

```js
// app/src/components/FocusableTab.jsx
export default React.memo(function FocusableTab({ id, row, col, group, label, active, onSelect }) {
  const { props } = useFocusable({
    id,
    row,
    col,
    group,
    onSelect,
  });
  return <div {...props} className={`tab ${active ? 'active' : ''}`}>{label}</div>;
});
```

```js
// app/src/components/OSKey.jsx
export default React.memo(function OSKey({ id, row, col, group, label, isAction, onPress }) {
  const { props } = useFocusable({
    id,
    row,
    col,
    group,
    onSelect: onPress,
  });
  return <div {...props} className={`osk-key ${isAction ? 'wide' : ''}`}>{label}</div>;
});
```

```js
// app/src/components/SidebarItem.jsx
export default React.memo(function SidebarItem({ id, row, label, icon, active, onSelect }) {
  const { props } = useFocusable({
    id,
    row,
    col: 0,
    group: 'sidebar',
    onSelect,
  });
  return (
    <div {...props} className={`sidebar-item ${active ? 'active' : ''}`}>
      <span>{icon}</span>
      <span className="sidebar-label">{label}</span>
    </div>
  );
});
```

Do **not** touch `PlayerPage.jsx`, `App.jsx`, `useFocus.js`, or any callback tied to effect dependencies or identity-sensitive state in this ticket.

- [ ] **Step 4: Re-run the focused component suite and then the full verification pass**

Run:

```bash
bun test app/src/components/components.render.test.mjs
bun test
bun test:coverage
bun --cwd app run build
```

Expected: PASS across the focused suite, the full suite, coverage, and the build.

- [ ] **Step 5: Commit the memoization cleanup**

```bash
git add app/src/components/FocusableTab.jsx app/src/components/OSKey.jsx app/src/components/SidebarItem.jsx app/src/components/components.render.test.mjs
git commit -m "refactor: remove redundant callback wrappers"
```

### Task 6: Final Branch Verification

**Files:**
- Modify: none

- [ ] **Step 1: Run the final project verification commands in one clean pass**

Run:

```bash
bun test
bun test:coverage
bun --cwd app run build
rg -n "proxy/server\\.js|dev:proxy|9527|VITE_USE_PROXY" README.md AGENTS.md DESIGN.md package.json tools/test-e2e.mjs app/src --glob '!app/node_modules/**'
```

Expected:
- tests PASS
- coverage PASS and no unexpected drop
- build PASS
- no stale standalone proxy references remain in app/browser-dev paths

- [ ] **Step 2: Review the final diff before handoff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only the planned React 19, Vite dev proxy, doc, and cleanup changes remain.
