# Single Package Root Frontend Implementation Plan

## Objective

Flatten the repository so the root becomes the only frontend package and the only dependency installation target, while preserving the existing `service/` and `tools/` directories as root-level siblings.

## Success Criteria

- Only the root `package.json` remains active.
- The frontend runs from the repository root with `bun run dev`.
- The frontend builds from the repository root with `bun run build`.
- Root test and coverage commands pass without any nested install under `app/`.
- CI installs dependencies only once at the repository root.
- No production or dev workflow still depends on `app/package.json` or `bun --cwd app`.

## Execution Strategy

Use a staged migration so package-boundary changes, file moves, and CI cleanup stay easy to reason about:

1. Consolidate dependencies and root scripts first.
2. Move the frontend tree into root-standard locations.
3. Update all references to the old `app/` paths.
4. Remove the nested package artifacts and simplify CI.
5. Run the full verification pass from the new root-only layout.

## Detailed Steps

### 1. Consolidate Root Package Metadata

- Merge the runtime and dev dependencies from `app/package.json` into the root `package.json`.
- Merge useful frontend scripts from `app/package.json` into the root package:
  - `dev`
  - `build`
  - `preview`
  - `package` if it is still valid after path updates
- Remove root script indirection through `bun --cwd app`.
- Update root test globs so frontend tests target `src/**/*.test.mjs`.
- Decide the final root package metadata needed for Bun and Vite, including `type: "module"` if required.

Checkpoint:

- Root `package.json` expresses the full app, build, test, and tooling dependency graph by itself.

### 2. Move Frontend Files Into Root Layout

- Move `app/src` to `src`.
- Move `app/index.html` to `index.html`.
- Move `app/vite.config.js` to `vite.config.js`.
- Move `app/public` to `public`.
- Move `app/webos-meta` to `webos-meta`.

Implementation note:

- Use direct file moves so history remains understandable where possible.
- After the move, audit any root-relative paths inside `vite.config.js`, HTML, and packaging commands.

Checkpoint:

- The repository root now looks like a standard Vite frontend root with sibling `src/`, `public/`, `index.html`, and `vite.config.js`.

### 3. Update Code, Scripts, and Docs For New Paths

- Update any code or config still referencing `app/` paths.
- Audit and update:
  - `build.sh`
  - root `package.json` scripts
  - `tools/` scripts that reference frontend paths
  - test commands and coverage assumptions
  - README and AGENTS instructions
  - any design or workflow docs that would mislead future work
- Verify that packaging steps now use root `dist/` and root `webos-meta/`.

Checkpoint:

- A text search for `app/` only returns intentional historical references or docs that explicitly discuss the old layout.

### 4. Remove Nested Package Artifacts

- Delete:
  - `app/package.json`
  - `app/bun.lock`
  - `app/package-lock.json`
- Clean up any stale generated directories that should not remain as part of the source layout:
  - `app/node_modules/`
  - `app/dist/`
- If the repository should standardize on Bun only, evaluate whether the root `package-lock.json` should also be removed as part of this cleanup. Only do this if it matches the current project convention and does not conflict with existing workflow expectations.

Checkpoint:

- Nothing in the repo needs a second package install under `app/`.

### 5. Simplify CI

- Update GitHub Actions workflows so they install only at the repository root.
- Remove the extra `cd app && bun install --frozen-lockfile` steps added to support the split-package state.
- Ensure workflow commands reference the new root scripts and paths.

Checkpoint:

- CI configuration mirrors the new single-package local workflow exactly.

### 6. Verification

Run the verification sequence from the repository root:

- `bun install --frozen-lockfile`
- `bun run build`
- `bun test`
- `bun test:coverage`

Optional but recommended:

- `bun run dev` smoke-check that the app serves correctly from the root-based Vite setup.
- Run the packaging flow if this branch still needs to preserve TV package generation.

Final audit:

- Search for stale `bun --cwd app`
- Search for stale `/app/` path references in scripts and workflows
- Confirm no nested lockfile or package metadata remains in active use

## Risk Management

### Primary Risks

- Partial migration where scripts are updated but CI or packaging still points at `app/`.
- Dependency resolution regressions if root package metadata does not fully absorb the frontend package requirements.
- Broken asset or output paths due to relocating `index.html`, `public/`, or `webos-meta/`.
- Tooling drift if docs and AGENTS instructions keep describing the old split-package workflow.

### Mitigations

- Do the package merge before deleting nested package files.
- Do a repo-wide search for `app/` and `bun --cwd app` before verification.
- Keep CI cleanup as an explicit step, not an afterthought.
- Validate build and coverage from a root-only install before claiming the migration complete.

## Expected File Touches

- `/Users/dotennin-mac14/projects/bili-webos/package.json`
- `/Users/dotennin-mac14/projects/bili-webos/bun.lock`
- `/Users/dotennin-mac14/projects/bili-webos/index.html`
- `/Users/dotennin-mac14/projects/bili-webos/vite.config.js`
- `/Users/dotennin-mac14/projects/bili-webos/src/**`
- `/Users/dotennin-mac14/projects/bili-webos/public/**`
- `/Users/dotennin-mac14/projects/bili-webos/webos-meta/**`
- `/Users/dotennin-mac14/projects/bili-webos/build.sh`
- `/Users/dotennin-mac14/projects/bili-webos/tools/**`
- `/Users/dotennin-mac14/projects/bili-webos/.github/workflows/**`
- `/Users/dotennin-mac14/projects/bili-webos/README.md`
- `/Users/dotennin-mac14/projects/bili-webos/AGENTS.md`

## Ready-To-Execute Outcome

After this plan is executed, the repo should behave like a conventional single-package Vite/React project at the root, with `service/` and `tools/` simply living alongside it rather than behind a second package boundary.
