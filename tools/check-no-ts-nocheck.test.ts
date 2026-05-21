import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findForbiddenTsNoCheckFiles } from './check-no-ts-nocheck.ts';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bili-webos-ts-nocheck-'));
}

describe('check-no-ts-nocheck', () => {
  it('finds ts and tsx files that still contain @ts-nocheck', () => {
    const dir = makeTempDir();
    const srcDir = path.join(dir, 'src');
    const nestedDir = path.join(srcDir, 'nested');
    fs.mkdirSync(nestedDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'clean.ts'), 'export const ok = true;\n');
    fs.writeFileSync(
      path.join(srcDir, 'flagged.tsx'),
      '// @ts-nocheck\nexport const flagged = true;\n',
    );
    fs.writeFileSync(
      path.join(nestedDir, 'also-flagged.ts'),
      '// @ts-nocheck\nexport const nested = true;\n',
    );
    fs.writeFileSync(
      path.join(srcDir, 'ignored.js'),
      '// @ts-nocheck\nconsole.log("ignored");\n',
    );

    expect(findForbiddenTsNoCheckFiles([srcDir])).toEqual([
      path.join(srcDir, 'flagged.tsx'),
      path.join(nestedDir, 'also-flagged.ts'),
    ]);
  });

  it('returns an empty list when no ts sources contain the directive', () => {
    const dir = makeTempDir();
    const srcDir = path.join(dir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'clean.ts'), 'export const ok = true;\n');
    fs.writeFileSync(path.join(srcDir, 'clean.tsx'), 'export const view = null;\n');

    expect(findForbiddenTsNoCheckFiles([srcDir])).toEqual([]);
  });
});
