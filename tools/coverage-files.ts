const EXCLUDE_PATTERNS = [
  /\.test\.ts$/,
  /\/test\//,
  /\/node_modules\//,
  /^node_modules\//,
  /^src\/main\.tsx$/,
];

export function shouldIncludeCoverageFile(file) {
  return !EXCLUDE_PATTERNS.some((pattern) => pattern.test(file));
}
