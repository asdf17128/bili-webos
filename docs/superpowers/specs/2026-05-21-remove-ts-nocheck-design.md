# Remove `@ts-nocheck` Design

## Summary

Implement `WEN-49` as a single repo-wide pass that removes all `// @ts-nocheck` directives from source and test files, keeps Biome enforcement limited to rules that are verified to exist in the installed version, and adds a repo-level guard that specifically fails when `@ts-nocheck` appears again.

## Goals

- Remove every existing `// @ts-nocheck` directive from the repository.
- Prevent future `@ts-nocheck` usage from re-entering the codebase.
- Keep the implementation low-risk by avoiding runtime behavior changes.
- Preserve the existing development workflow by wiring checks into current lint or verification commands.

## Non-Goals

- Migrating the repo to `strict: true`.
- Refactoring unrelated code that happens to have weak typing.
- Introducing a new lint stack outside the current Biome-based workflow.

## Current State

- `@ts-nocheck` appears across frontend app files, tools, tests, and the webOS service.
- `biome.json` is already the repo's main formatter and linter configuration.
- The TypeScript configs for app, tools, and service are all `strict: false`.
- A temporary compile sweep with all `@ts-nocheck` headers removed succeeded for:
  - `tsconfig.app.json`
  - `tsconfig.tools.json`
  - `tsconfig.service.json`

This means the repo does not currently depend on `@ts-nocheck` to pass `tsc`, so the cleanup should be mostly mechanical.

## Approach Options

### Option 1: Repo-wide removal plus layered enforcement

Remove all `@ts-nocheck` directives in one pass, enable only Biome rules that are verified locally to support the policy, and add a dedicated repository check that fails on `@ts-nocheck`.

Pros:
- Fully satisfies the acceptance criteria.
- Keeps enforcement close to the existing lint workflow.
- Separates general suppression enforcement from the exact `@ts-nocheck` policy.

Cons:
- Requires one small custom repository check because the installed Biome version does not expose a verified native `@ts-nocheck`-specific rule.

### Option 2: Repo-wide removal plus Biome-only enforcement

Remove all directives and rely only on Biome configuration changes.

Pros:
- Minimal implementation surface.

Cons:
- Risks under-enforcing the exact acceptance criteria if Biome cannot directly block `@ts-nocheck`.

### Option 3: Staged cleanup with temporary exceptions

Remove directives gradually and keep a transition path for exceptions.

Pros:
- Useful for repos with real typecheck breakage after cleanup.

Cons:
- Adds process overhead that this repository does not currently need.
- Does not match the requested one-pass execution as cleanly.

## Chosen Design

Use Option 1.

The implementation will make one repo-wide content cleanup and then enforce the policy in two layers:

1. Biome configuration will only be changed when a relevant rule is verified to exist in the installed Biome version.
2. A lightweight repository check will explicitly fail on `@ts-nocheck` and serves as the source of truth for this policy.

This design satisfies both the functional requirement and the long-term maintenance requirement without introducing runtime changes or a new lint toolchain.

## File-Level Changes

### Source and test files

- Remove the first-line `// @ts-nocheck` directive from every affected `.ts` and `.tsx` file in:
  - `src/`
  - `tools/`
  - `webos/service/com.biliwebos.app.service/src/`

No other edits should be made unless formatting requires them.

### Biome configuration

- Update `biome.json` only if a relevant built-in rule is verified locally in the installed Biome version.
- Keep the rest of the lint configuration intact.

Do not add unverified rule names to `biome.json`. If no suitable rule is available, leave Biome unchanged and rely on the repository guard for exact `@ts-nocheck` enforcement.

### Verification script or package workflow

- Add a repository check that fails if `@ts-nocheck` appears in tracked source.
- Prefer attaching this to the existing `lint` or `verify` workflow instead of creating a parallel standalone workflow that developers might forget to run.

Possible implementation locations:
- `package.json` scripts
- `tools/verify.sh`
- a small `tools/*.ts` helper if a shell-only check would be too brittle

The preferred implementation is the smallest readable solution that works consistently in local development and CI.

## Data Flow and Behavior

There is no runtime data flow change. The only behavior change is in development and CI:

1. A developer introduces `@ts-nocheck`.
2. The lint or verification workflow fails.
3. The failure message points clearly at the forbidden directive.

## Error Handling

- If a file removal unexpectedly reveals a typecheck error during real verification, fix the local type issue instead of reintroducing `@ts-nocheck`.
- If Biome cannot express the exact directive ban, the repo-level check remains the source of truth for `@ts-nocheck`.
- The repository check should exit non-zero with a concise message when matches are found.

## Testing Strategy

Verification should cover:

- Content removal:
  - `rg '@ts-nocheck'` returns no matches in the repository after the change.
- Type safety at current project settings:
  - `bun run typecheck`
- Lint policy:
  - `bun run lint`
- Existing test baseline:
  - run targeted repo verification as needed, with at least the standard lint and typecheck gates passing

Because the change is mechanical and policy-focused, the highest-value checks are lint and typecheck rather than new unit tests unless the chosen guard lives in a testable TypeScript helper.

## Risks and Mitigations

### Risk: hidden type errors surface during real verification

Mitigation:
- The temporary full compile sweep already indicates low risk.
- Fix surfaced local typing issues directly rather than weakening policy.

### Risk: Biome cannot ban `@ts-nocheck` exactly

Mitigation:
- Keep the repo-level explicit guard as the exact acceptance gate.

### Risk: developers bypass the custom check by running only formatters

Mitigation:
- Wire the guard into the primary lint or verify path already used in CI and local workflow.

## Acceptance Mapping

### Acceptance criterion: "`@ts-nocheck` code will not appear"

Covered by:
- repo-wide directive removal
- explicit repository guard against future `@ts-nocheck`

### Acceptance criterion: "add a no-`ts-nocheck` rule to Biome rules"

Covered by:
- enabling a verified built-in Biome rule only if one actually exists in the installed version
- otherwise leaving Biome unchanged rather than adding unsupported config
- backing the exact prohibition with the repository guard

## Open Decisions Resolved

- Scope is one repo-wide pass, not staged by area.
- Enforcement should prioritize the existing lint and verification workflow rather than a separate ad hoc command.
- No fallback reintroduction of `@ts-nocheck` is allowed; real type issues must be fixed directly if any appear.
