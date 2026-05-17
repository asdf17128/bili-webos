# webOS Platform Layout Design

## Summary

This change groups the TV-platform-specific artifacts under a dedicated `webos/` directory while keeping the React and Vite frontend rooted at the repository top level. The current root frontend layout remains the source of truth for browser development, testing, and frontend builds. The TV service and app metadata move into a clearer platform boundary.

## Goals

- Keep the root-level React and Vite frontend layout unchanged.
- Move the TV background service under `webos/service/`.
- Move the webOS application metadata under `webos/meta/`.
- Update packaging, deployment, tests, and docs so they use the new `webos/` paths.
- Preserve current TV packaging behavior.

## Non-Goals

- No reintroduction of a nested frontend package.
- No refactor of service runtime behavior.
- No relocation of general-purpose repo tooling unless required for path correctness.
- No redesign of browser-dev proxy behavior.

## Proposed Layout

- `src/`
- `public/`
- `index.html`
- `vite.config.js`
- `webos/meta/`
- `webos/service/com.biliwebos.app.service/`
- `tools/`

This preserves a standard frontend root while making webOS-specific artifacts explicit.

## File Moves

- `service/com.biliwebos.app.service/` -> `webos/service/com.biliwebos.app.service/`
- `webos-meta/` -> `webos/meta/`

## Required Path Updates

- `build.sh`
- `tools/deploy.mjs`
- `tools/verify.sh`
- `package.json` scripts if any package step references metadata paths
- tests and imports that reference service helper modules
- docs such as `README.md`, `AGENTS.md`, and `DESIGN.md`
- any manifest or packaging metadata that points at `webos-meta`

## Risks

- `ares-package` path mistakes can break `.ipk` generation.
- service test paths can silently drift if only build scripts are updated.
- dev proxy code currently imports the HLS rewrite helper from the service tree, so that path must be updated carefully.
- `webos/meta/appinfo.json` must still package with `main: "index.html"` and the build output root.

## Verification

- `bun run build`
- `bun test`
- `bun test --preload ./tools/coverage-preload.mjs --coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage`
- verify `build.sh` path logic against the new `webos/` layout

## Acceptance Criteria

- TV platform files live under `webos/`.
- Frontend remains root-based and continues to build and test normally.
- Service-related tests, imports, and packaging paths all work with the new layout.
