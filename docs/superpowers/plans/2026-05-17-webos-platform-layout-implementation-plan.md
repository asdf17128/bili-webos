# webOS Platform Layout Implementation Plan

## Objective

Move the TV-specific service and metadata into a dedicated `webos/` directory while keeping the root React and Vite frontend unchanged.

## Steps

1. Move `service/com.biliwebos.app.service/` to `webos/service/com.biliwebos.app.service/`.
2. Move `webos-meta/` to `webos/meta/`.
3. Update imports and scripts that reference the old service or metadata paths.
4. Update docs and manifests to match the new structure.
5. Run build, test, and coverage verification from the root layout.

## Key Touchpoints

- `src/dev/biliProxy.js`
- `package.json`
- `build.sh`
- `tools/deploy.mjs`
- `tools/verify.sh`
- service test globs
- `README.md`
- `AGENTS.md`
- `DESIGN.md`
- `com.biliwebos.app.manifest.json`

## Verification Commands

- `bun run build`
- `bun test`
- `bun test --preload ./tools/coverage-preload.mjs --coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage`

## Completion Criteria

- No active code or scripts reference the old `service/` or `webos-meta/` root paths.
- TV packaging paths are aligned with `webos/meta` and `webos/service`.
