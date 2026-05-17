# React 19 And Vite Dev Proxy Design

## Summary

This change upgrades the app from React 18 to React 19 and retires the standalone `proxy/` development server. Browser development will use the Vite dev server as the only local process. The TV runtime path remains unchanged: the web app continues to prefer the Luna-backed service on device, and only browser development uses the dev proxy fallback.

React 19 is not the source of the local development server in this architecture. The server remains Vite's dev server. The React 19 upgrade is a separate client runtime and tooling change, and this distinction must stay explicit in project documentation and task descriptions.

## Goals

- Upgrade `react` and `react-dom` to React 19 in both the workspace root and `app/`.
- Replace the standalone browser-dev proxy process with Vite-hosted proxy handling.
- Preserve existing browser fallback behavior needed by the app, especially cookie propagation and media passthrough.
- Keep CI green, keep the current tests passing, and maintain coverage.
- Avoid unnecessary manual memoization where it is clearly redundant, but do not assume React 19 removes the need for `useMemo` or `useCallback` by itself.

## Non-Goals

- No change to the TV-side Luna service architecture.
- No refactor of the production fetch flow beyond what is needed to support the new browser-dev proxy path.
- No broad hook cleanup unrelated to React 19 compatibility.
- No assumption that React 19 alone provides automatic memoization.

## Current State

- Root development currently starts two processes: the app dev server and `proxy/server.js`.
- The browser fallback path in `app/src/api/client.js` constructs requests against a standalone `/proxy/:host/...` HTTP server.
- `proxy/server.js` handles several response modes beyond simple JSON proxying, including cookies, text responses, compressed responses, range headers, and binary/media passthrough.

## Proposed Architecture

### Dependency Upgrade

- Update `react`, `react-dom`, and `react-test-renderer` from the React 18 line to the React 19 line where they are declared.
- Keep the existing Vite-based frontend setup and validate whether the current `@vitejs/plugin-react` and `vite` versions already satisfy the upgrade. If not, upgrade them only as far as needed for React 19 compatibility.
- Treat React Compiler as a separate, optional build-time decision. Do not couple basic React 19 adoption to compiler rollout.

### Development Proxy Consolidation

- Move browser-dev proxy handling into the Vite dev server in `app/vite.config.js`.
- Preserve the existing route shape `/proxy/:host/:path*` so the app-side fallback does not need a broad API rewrite.
- Prefer Vite's proxy stack and its underlying `http-proxy` streaming behavior for request forwarding, large responses, and Range support.
- Keep custom logic limited to request parsing and response hooks such as cookie bridging, rather than reimplementing byte streaming with manual buffering for normal proxy traffic.
- The current Vite proxy surface in this repo exposes `rewrite`, `configure`, and `bypass`, but not a first-class dynamic `router` field. Plan around regex matching plus explicit path parsing, or use a small `configureServer` plugin that still delegates transport to `http-proxy`.
- If route parsing for the dynamic `:host` segment cannot be expressed cleanly through the Vite proxy configuration alone, use a small Vite plugin or middleware that still delegates transport to `http-proxy` instead of hand-rolled `https.request` response piping.

### App Fetch Flow

- Keep the current fetch strategy in `app/src/api/client.js`:
  - Use Luna service calls when running on webOS with the required bridge available.
  - Fall back to HTTP proxying in browser development.
- Change only the browser fallback assumptions so it targets the Vite dev server origin instead of a separate proxy process.
- Remove or isolate any no-longer-needed standalone proxy configuration from client storage if it becomes dead code after the dev-server migration.
- Update project docs and ticket wording to state clearly that browser-dev proxying is provided by Vite, not by a built-in React 19 server runtime.

### Proxy Behavior To Preserve

The Vite-hosted proxy must preserve the development behaviors the app relies on today:

- Forward requests to `https://<host><path>`.
- Forward request method, body, and relevant headers.
- Surface upstream `Set-Cookie` information through the existing `X-Set-Cookie` bridge expected by the client.
- Preserve cookie capture behavior even on non-200 responses where upstream auth flows may still set cookies.
- Mark proxied auth-sensitive responses as non-cacheable so browser development does not reuse stale `X-Set-Cookie` bridge values.
- Return JSON and text responses without changing the client contract.
- Pass through binary and media responses.
- Preserve relevant range and streaming-related headers such as `Content-Range`, `Content-Length`, and `Accept-Ranges` where present.
- Preserve the CDN-specific request-header behavior from the current proxy, including avoiding problematic `Origin` forwarding for video/CDN hosts.
- Preserve playlist rewriting behavior for HLS responses if browser development still relies on it.
- If HLS playlist rewriting is needed, preserve the current sequence from `proxy/server.js`: decompress textual playlist responses when necessary, rewrite playlist body contents, then return corrected headers and body. Do not treat `.m3u8` responses as opaque pass-through if the client depends on rewritten segment URLs.

## Code Changes

### Frontend Config

- Modify `app/vite.config.js` to register a development-only proxy handler.
- Keep existing build output behavior unchanged.
- Ensure proxied development responses that participate in auth state bridging return `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate` or an equivalent no-cache policy.

### API Client

- Update `app/src/api/client.js` so the browser fallback no longer depends on a separate proxy base URL for standard local development.
- Keep the Luna-first behavior and existing response parsing semantics intact.

### Development Scripts

- Update the root `package.json` scripts so `dev` runs only the app dev server.
- Remove the standalone `dev:proxy` flow.
- Remove documentation references that still instruct developers to run the separate proxy process for ordinary browser development.

### Proxy Retirement

- Delete `proxy/server.js` and related package wiring once the Vite-based path is verified.

### React 19 Cleanup

- Audit existing uses of `useMemo` and `useCallback`.
- Without React Compiler enabled, keep existing memoization unless it is obviously redundant and demonstrably behavior-neutral.
- Be especially conservative around callback props, effect dependencies, and identity-sensitive child component paths.
- If the team wants to remove memoization more aggressively, treat React Compiler rollout as a separate implementation phase with its own configuration, verification, and rollback path.

### Test Toolchain Compatibility

- The current frontend tests use `react-test-renderer` heavily through `app/src/test/reactTestUtils.mjs`.
- React 19 deprecates `react-test-renderer`, so the upgrade plan must include an explicit compatibility checkpoint for the current Bun test environment and these renderer-based tests.
- If the existing tests continue to run acceptably under React 19, document the deprecation and defer migration.
- Treat hard runtime failures in `react-test-renderer` as a realistic outcome, not just warning noise.
- If the suite becomes noisy or unstable, add a bounded migration task for the affected tests rather than attempting an unplanned whole-suite rewrite in the same change.
- Be prepared to adjust `app/src/test/reactTestUtils.mjs` or migrate the most fragile renderer-based tests first if React 19 and Bun expose renderer-internal incompatibilities.

## Testing Strategy

### Test-First Scope

Before implementation changes, add or adjust tests around the browser fallback path so the migration is covered by failing tests first.

### Required Verification

- Run targeted tests for app API client behavior.
- Run the full test suite with `bun test`.
- Run coverage with `bun test:coverage` and confirm coverage does not regress from the current baseline.
- Run `bun --cwd app run build` to validate the upgraded frontend build.

### Risk Areas

- Cookie propagation from upstream responses to local auth storage.
- Binary and media response handling during browser development.
- Large video or segment responses hanging due to incorrect buffering or incomplete Range forwarding.
- HLS playlist breakage if decompression and body rewriting are not faithfully preserved.
- Stale auth state in browser development if proxied cookie bridge responses are cached.
- React 19 compatibility with the current test and build tooling.
- Accidental removal of memoization that is behaviorally significant.
- Compiler-specific regressions if React Compiler is introduced in the same change set.

## Implementation Order

1. Add or update failing tests for the browser fallback path while the app is still on React 18.
2. Introduce the Vite-hosted proxy behavior and make the client use it, while preserving the existing React version.
3. Verify the proxy migration with targeted tests, the full suite, and manual browser-dev smoke checks for login and media playback paths if the environment is available.
4. Remove the standalone `proxy/` flow only after the Vite-based path is verified.
5. Upgrade React-related dependencies and address any compatibility issues, including the current `react-test-renderer`-based test setup under Bun.
6. Re-run the full verification and coverage checks after the React 19 upgrade so proxy regressions and React/tooling regressions stay distinguishable.
7. Optionally evaluate React Compiler as a separate follow-up or gated sub-phase before removing any non-trivial memoization.
8. Update project docs, including `AGENTS.md` or other task-facing instructions, to correct the "React 19 has a built-in server" phrasing.

## Acceptance Mapping

- "No dependency on `server/` proxy service":
  Browser development will no longer require the standalone `proxy/` process; Vite becomes the only local server.
- "Remove unnecessary `useMemo` and `useCallback`":
  Hook cleanup will be targeted, not sweeping. Non-trivial memoization removal requires either strong local evidence that it is redundant or a separately configured React Compiler rollout.
- "CI passes / all tests pass / coverage maintained":
  Full suite, coverage, and build verification are part of completion criteria.
