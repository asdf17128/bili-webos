import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_ROOTS = [
  'src',
  'tools',
  'webos/service/com.biliwebos.app.service/src',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const TS_NOCHECK_DIRECTIVE = /^\/\/ @ts-nocheck$/m;

function walk(dir: string, matches: string[]): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      walk(fullPath, matches);
      continue;
    }

    const dotIndex = fullPath.lastIndexOf('.');
    const extension = dotIndex >= 0 ? fullPath.slice(dotIndex) : '';

    if (!SOURCE_EXTENSIONS.has(extension)) {
      continue;
    }

    const text = readFileSync(fullPath, 'utf8');
    if (TS_NOCHECK_DIRECTIVE.test(text)) {
      matches.push(fullPath);
    }
  }
}

export function findForbiddenTsNoCheckFiles(
  roots: string[] = DEFAULT_ROOTS,
): string[] {
  const matches: string[] = [];

  for (const root of roots) {
    walk(root, matches);
  }

  return matches.sort();
}

function main(): void {
  const matches = findForbiddenTsNoCheckFiles();

  if (matches.length > 0) {
    console.error('Found forbidden @ts-nocheck directives:');
    for (const match of matches) {
      console.error(`- ${match}`);
    }
    process.exit(1);
  }

  console.log('No @ts-nocheck directives found.');
}

if (import.meta.main) {
  main();
}
