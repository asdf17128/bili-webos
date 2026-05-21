# Remove `@ts-nocheck` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all `@ts-nocheck` directives from the repository and prevent them from being reintroduced through the normal developer workflow.

**Architecture:** This change is intentionally mechanical. First remove the directives from all affected source files, then add a lightweight repository guard wired into the package workflow so `@ts-nocheck` fails fast in local development and CI, and finally run formatting, lint, and typecheck to confirm nothing depended on the suppressed state.

**Tech Stack:** TypeScript, React, Bun, Biome, shell-based repository checks

---

### Task 1: Remove `@ts-nocheck` from application, tools, and service files

**Files:**
- Modify: `src/**/*.ts`
- Modify: `src/**/*.tsx`
- Modify: `tools/**/*.ts`
- Modify: `webos/service/com.biliwebos.app.service/src/**/*.ts`

- [ ] **Step 1: Write the failing inventory check**

```bash
rg -n '^// @ts-nocheck$' src tools webos/service/com.biliwebos.app.service/src
```

Expected: FAIL in the sense that the command prints the current list of files containing the directive.

- [ ] **Step 2: Remove the first-line directive from every affected file**

```bash
python - <<'PY'
from pathlib import Path

roots = [
    Path("src"),
    Path("tools"),
    Path("webos/service/com.biliwebos.app.service/src"),
]

for root in roots:
    for path in root.rglob("*"):
        if path.suffix not in {".ts", ".tsx"} or not path.is_file():
            continue
        text = path.read_text()
        if text.startswith("// @ts-nocheck\n"):
            path.write_text(text.removeprefix("// @ts-nocheck\n"))
PY
```

- [ ] **Step 3: Re-run the inventory check to verify the source tree is clean**

```bash
rg -n '^// @ts-nocheck$' src tools webos/service/com.biliwebos.app.service/src
```

Expected: PASS with no matches.

- [ ] **Step 4: Commit the mechanical cleanup**

```bash
git add src tools webos/service/com.biliwebos.app.service/src
git commit -m "refactor: remove ts-nocheck directives"
```

### Task 2: Add a repository guard that blocks future `@ts-nocheck`

**Files:**
- Create: `tools/check-no-ts-nocheck.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing guard command from the shell**

```bash
rg -n '@ts-nocheck' src tools webos/service/com.biliwebos.app.service/src
```

Expected: PASS with no matches after Task 1, but this command demonstrates the exact detection logic the scripted guard must enforce.

- [ ] **Step 2: Add a dedicated guard script**

```ts
// tools/check-no-ts-nocheck.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = [
  'src',
  'tools',
  'webos/service/com.biliwebos.app.service/src',
];

const exts = new Set(['.ts', '.tsx']);
const matches: string[] = [];

function walk(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      walk(path);
      continue;
    }

    const dot = path.lastIndexOf('.');
    const ext = dot >= 0 ? path.slice(dot) : '';
    if (!exts.has(ext)) {
      continue;
    }

    const text = readFileSync(path, 'utf8');
    if (text.includes('@ts-nocheck')) {
      matches.push(path);
    }
  }
}

for (const root of roots) {
  walk(root);
}

if (matches.length > 0) {
  console.error('Found forbidden @ts-nocheck directives:');
  for (const match of matches) {
    console.error(`- ${match}`);
  }
  process.exit(1);
}

console.log('No @ts-nocheck directives found.');
```

- [ ] **Step 3: Wire the guard into the package workflow**

```json
{
  "scripts": {
    "check:no-ts-nocheck": "BUN_BIN=${BUN_BIN:-$HOME/.bun/bin/bun}; \"$BUN_BIN\" tools/check-no-ts-nocheck.ts",
    "lint": "BUN_BIN=${BUN_BIN:-$HOME/.bun/bin/bun}; \"$BUN_BIN\" run check:no-ts-nocheck && biome check ."
  }
}
```

Keep the rest of `package.json` unchanged. If you prefer not to change `lint`, adding the guard to a central verification script is acceptable only if the normal local lint path still remains easy to run and visible.

- [ ] **Step 4: Run the guard directly**

```bash
$HOME/.bun/bin/bun tools/check-no-ts-nocheck.ts
```

Expected: PASS with `No @ts-nocheck directives found.`

- [ ] **Step 5: Commit the guard**

```bash
git add tools/check-no-ts-nocheck.ts package.json
git commit -m "build: block ts-nocheck directives"
```

### Task 3: Verify formatting, lint, and typecheck after the cleanup

**Files:**
- Modify: `docs/superpowers/specs/2026-05-21-remove-ts-nocheck-design.md`
- Test: `package.json`
- Test: `tools/check-no-ts-nocheck.ts`

- [ ] **Step 1: Format the repository**

```bash
$HOME/.bun/bin/bun run format
```

Expected: PASS with Biome formatting applied where needed.

- [ ] **Step 2: Run the lint workflow including the new guard**

```bash
$HOME/.bun/bin/bun run lint
```

Expected: PASS with the `@ts-nocheck` guard and `biome check .` both succeeding.

- [ ] **Step 3: Run the full typecheck**

```bash
$HOME/.bun/bin/bun run typecheck
```

Expected: PASS across `tsconfig.app.json`, `tsconfig.tools.json`, and `tsconfig.service.json`.

- [ ] **Step 4: Update the spec if implementation details differed from the final result**

```md
If the implementation leaves `biome.json` unchanged because no verified rule exists,
ensure the design doc still states that the repository guard is the source of truth.
```

- [ ] **Step 5: Commit the verified final state**

```bash
git add docs/superpowers/specs/2026-05-21-remove-ts-nocheck-design.md package.json tools/check-no-ts-nocheck.ts
git commit -m "chore: verify ts-nocheck enforcement"
```
