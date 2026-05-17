# Single Package Root Frontend Design

## Summary

This change flattens the repository into a single-package frontend layout rooted at the repository top level. The current `app/` directory stops being a nested package and stops being the frontend root. Instead, the repository root becomes the only frontend package, the only dependency installation target, and the only Vite application root.

The `service/` and `tools/` directories remain in place at the repository root. They are not being folded into the frontend source tree, but they must consume the same root-level dependency and script environment.

## Goals

- Keep only one `package.json`, located at the repository root.
- Remove `app/package.json` and the nested lockfiles under `app/`.
- Move the frontend project contents from `app/` into the repository root in a standard Vite-style layout.
- Eliminate the need for CI or local development to install dependencies in both the root and `app/`.
- Update scripts, tests, docs, and workflows so they reference the new root-based frontend paths.

## Non-Goals

- No refactor of `service/` architecture or runtime behavior.
- No redesign of the Vite proxy behavior beyond path relocation needed by the new layout.
- No unrelated cleanup of the TV tooling, deployment flow, or generated artifacts beyond what is necessary to keep the repo coherent after the move.
- No monorepo restructuring or package splitting.

## Current State

- The repository currently behaves like a split package:
  - The root `package.json` owns top-level scripts, Bun test entrypoints, and TV tooling dependencies.
  - `app/package.json` owns the actual frontend runtime and build dependencies such as Vite, `@vitejs/plugin-react`, `http-proxy`, `mpegts.js`, `qrcode`, and `shaka-player`.
- Frontend entrypoints and assets currently live under `app/`, including:
  - `app/src/`
  - `app/index.html`
  - `app/vite.config.js`
  - `app/public/`
  - `app/webos-meta/`
- CI had to be patched to install both the root and `app/` dependencies because the frontend no longer fit entirely inside one package boundary.

## Proposed Architecture

### Single Root Package

- The repository root becomes the only package boundary.
- Merge the frontend dependencies and scripts from `app/package.json` into the root `package.json`.
- Preserve the root package as `type: "module"` if needed by the frontend and existing root scripts.
- Keep one root lockfile as the source of truth for installs.
- Remove nested package metadata from `app/`, including:
  - `app/package.json`
  - `app/bun.lock`
  - `app/package-lock.json`

### Root Frontend Layout

Move the frontend application files into the standard root locations:

- `app/src` -> `src`
- `app/index.html` -> `index.html`
- `app/vite.config.js` -> `vite.config.js`
- `app/public` -> `public`
- `app/webos-meta` -> `webos-meta`

This keeps the Vite application shape conventional while still allowing `service/` and `tools/` to remain sibling directories at the repository root.

### Script and Path Realignment

- Root scripts such as `dev` and `build` should invoke Vite directly from the repository root instead of using `bun --cwd app ...`.
- Test scripts must point at the new frontend test locations under `src/` instead of `app/src/`.
- Any packaging or deployment scripts that copy or read `webos-meta`, `dist`, or frontend entry files must be updated to the new root-relative paths.
- Any references inside code, configs, or docs that assume the frontend root is `app/` must be updated.

### Dependency Consolidation

The root `package.json` must contain everything required to:

- run the Vite app locally
- build the frontend
- run the frontend and service tests
- run coverage
- support the TV dev tools

That means the root package must absorb the frontend dependencies currently declared only in `app/package.json`, including both runtime and dev dependencies.

### CI Simplification

- GitHub Actions should return to a single install flow rooted at the repository top level.
- Remove the extra `cd app && bun install --frozen-lockfile` step introduced to compensate for the split-package layout.
- Ensure all CI jobs use the same root install and then run root scripts.

## File Movement Expectations

### Files To Move

- `app/src/**`
- `app/index.html`
- `app/vite.config.js`
- `app/public/**`
- `app/webos-meta/**`

### Files To Remove

- `app/package.json`
- `app/bun.lock`
- `app/package-lock.json`

### Directories To Re-evaluate

- `app/dist/`
- `app/node_modules/`

These should not survive as meaningful tracked project structure after the migration. If present in the working tree, clean them up as generated or local-install artifacts rather than preserving them as part of the new design.

## Implementation Notes

### Preserve Existing Behavior While Relocating

- The Vite proxy implementation added for browser development should move with the config, not be redesigned unless the relocation exposes a path bug.
- Frontend imports should remain mostly stable because moving `src/` to the root does not change intra-`src` relative imports.
- Public asset resolution must be checked carefully after moving `public/` and `index.html`.

### Build and Packaging Impact

- Any packaging command that currently assumes `dist/` is emitted under `app/` must be updated to the root `dist/`.
- `webos-meta` copy paths must be updated accordingly.
- Any shell or Node scripts that read frontend output paths must be audited for `app/` prefixes.

### Test Impact

- Frontend tests currently referenced via `app/src/**/*.test.mjs` must move to `src/**/*.test.mjs`.
- Any test helper imports or snapshots that rely on root-relative paths should be verified after the move.
- Coverage generation should continue to aggregate both service and frontend tests from the root package.

## Risks

- Missing a single `app/` path reference in CI, docs, scripts, or packaging can leave the repo in a half-migrated state.
- Root package changes may affect Bun module resolution for test or tool scripts if `type` or dependency declarations change carelessly.
- Build output assumptions may break deployment or packaging if `dist` paths are not updated everywhere.
- Public assets or `webos-meta` may be omitted from packaging if the copy steps are not adjusted to the new layout.
- Local generated directories under `app/` can create confusion during the migration if they are mistaken for source-of-truth files.

## Testing Strategy

Required verification after the move:

- `bun install --frozen-lockfile`
- `bun run dev` sanity check for the root-based Vite app
- `bun run build`
- `bun test`
- `bun test:coverage`

If TV packaging is still expected to work from this branch, also verify the packaging command path after the migration.

## Implementation Order

1. Merge the frontend package dependencies and scripts into the root `package.json`.
2. Move the frontend source, config, and static assets from `app/` into the repository root.
3. Update root scripts, test globs, build scripts, and any tool references to the new paths.
4. Remove nested package files and any now-invalid CI dual-install behavior.
5. Audit docs and project instructions for stale `app/` references.
6. Run the full verification pass from the root-only setup.

## Acceptance Criteria

- The repository has exactly one active `package.json`, at the root.
- Local development no longer depends on `app/package.json` or `bun --cwd app`.
- The frontend app runs and builds from the repository root.
- Tests and coverage pass from the root-only dependency installation.
- CI no longer performs a second install inside `app/`.
