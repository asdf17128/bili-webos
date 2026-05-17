import path from "node:path";
import { pathToFileURL } from "node:url";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const INCLUDE_PATTERNS = [
  "src/**/*.js",
  "src/**/*.mjs",
  "src/**/*.jsx",
  "webos/service/com.biliwebos.app.service/**/*.js",
  "webos/service/com.biliwebos.app.service/**/*.mjs",
];
const EXCLUDE_PATTERNS = [
  /\.test\.[cm]?js$/,
  /\/test\//,
  /\/node_modules\//,
];

const coverageImports = [];
for (const pattern of INCLUDE_PATTERNS) {
  for await (const file of new Bun.Glob(pattern).scan({ cwd: PROJECT_ROOT, absolute: false })) {
    if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(file))) {
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
