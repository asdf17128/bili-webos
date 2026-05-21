import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { shouldIncludeCoverageFile } from './coverage-files.ts';

const PROJECT_ROOT = path.resolve(import.meta.dir, '..');
const INCLUDE_PATTERNS = [
  'src/**/*.ts',
  'src/**/*.tsx',
  'webos/service/com.biliwebos.app.service/src/**/*.ts',
];

const coverageImports = [];
for (const pattern of INCLUDE_PATTERNS) {
  for await (const file of new Bun.Glob(pattern).scan({
    cwd: PROJECT_ROOT,
    absolute: false,
  })) {
    if (!shouldIncludeCoverageFile(file)) {
      continue;
    }
    coverageImports.push(file);
  }
}

coverageImports.sort();

for (const file of coverageImports) {
  try {
    await import(pathToFileURL(path.join(PROJECT_ROOT, file)).href);
  } catch (error) {
    console.warn(`[coverage-preload] skip ${file}: ${error.message}`);
  }
}
