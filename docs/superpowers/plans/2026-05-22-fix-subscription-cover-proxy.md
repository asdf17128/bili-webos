# Fix Subscription Cover Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken "我的订阅" cover images on webOS TV by aligning the webOS local proxy host allowlist with the browser dev proxy behavior, and document the platform-specific dev differences in agent rules.

**Architecture:** Keep the fix at the proxy boundary instead of patching UI components. The web client already routes subscription cover images through `/proxy`; the failure happens only on the webOS local HTTP proxy because its host allowlist is stricter than the Vite dev proxy. Update the webOS service allowlist, then document the web-vs-webOS proxy split in `AGENTS.md`.

**Tech Stack:** Bun, React, Vite, webOS Node.js service tests

---

### Task 1: Lock the webOS proxy bug with a failing test

**Files:**
- Modify: `webos/service/com.biliwebos.app.service/test/service-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it('isAllowedHost permits subscription cover CDN hosts used by the web proxy', () => {
    expect(isAllowedHost('archive.biliimg.com')).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test webos/service/com.biliwebos.app.service/test/service-helpers.test.ts`
Expected: FAIL because `archive.biliimg.com` is currently rejected.

### Task 2: Fix the webOS service allowlist

**Files:**
- Modify: `webos/service/com.biliwebos.app.service/src/service.ts`
- Test: `webos/service/com.biliwebos.app.service/test/service-helpers.test.ts`

- [ ] **Step 1: Write minimal implementation**

```ts
  const allowed = [
    'api.bilibili.com',
    'passport.bilibili.com',
    'api.live.bilibili.com',
    'archive.biliimg.com',
    's1.hdslb.com',
    'i0.hdslb.com',
    'i1.hdslb.com',
    'i2.hdslb.com',
    'comment.bilibili.com',
  ];
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test webos/service/com.biliwebos.app.service/test/service-helpers.test.ts`
Expected: PASS

### Task 3: Document web-vs-webOS dev behavior in agent rules

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add concise platform notes**

```md
## Dev Environment Differences
- Browser/web development uses the Vite dev server and its `/proxy` endpoint on the current localhost origin.
- webOS TV runtime uses the local service proxy at `http://127.0.0.1:7654/proxy/...`; if an asset or API works on web but fails on TV, compare the webOS service allowlist and request headers with `src/dev/biliProxy.ts`.
```

- [ ] **Step 2: Re-run targeted verification**

Run: `bun test webos/service/com.biliwebos.app.service/test/service-helpers.test.ts`
Expected: PASS
