// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';

const coverageDir = process.argv[2] ?? 'coverage';
const lcovPath = path.join(coverageDir, 'lcov.info');
const summaryPath = path.join(coverageDir, 'coverage-summary.json');

const text = fs.readFileSync(lcovPath, 'utf8');

const total = {
  lines: { total: 0, covered: 0, skipped: 0 },
  statements: { total: 0, covered: 0, skipped: 0 },
  functions: { total: 0, covered: 0, skipped: 0 },
  branches: { total: 0, covered: 0, skipped: 0 },
};
const files = [];

for (const record of text.split('end_of_record\n')) {
  if (!record.trim()) continue;

  const file = {
    lines: { total: 0, covered: 0, skipped: 0 },
    statements: { total: 0, covered: 0, skipped: 0 },
    functions: { total: 0, covered: 0, skipped: 0 },
    branches: { total: 0, covered: 0, skipped: 0 },
  };

  for (const line of record.split('\n')) {
    if (line.startsWith('LF:')) {
      const value = Number(line.slice(3)) || 0;
      file.lines.total += value;
      total.lines.total += value;
    } else if (line.startsWith('LH:')) {
      const value = Number(line.slice(3)) || 0;
      file.lines.covered += value;
      total.lines.covered += value;
    } else if (line.startsWith('FNF:')) {
      const value = Number(line.slice(4)) || 0;
      file.functions.total += value;
      total.functions.total += value;
    } else if (line.startsWith('FNH:')) {
      const value = Number(line.slice(4)) || 0;
      file.functions.covered += value;
      total.functions.covered += value;
    } else if (line.startsWith('BRF:')) {
      const value = Number(line.slice(4)) || 0;
      file.branches.total += value;
      total.branches.total += value;
    } else if (line.startsWith('BRH:')) {
      const value = Number(line.slice(4)) || 0;
      file.branches.covered += value;
      total.branches.covered += value;
    }
  }

  file.statements.total = file.lines.total;
  file.statements.covered = file.lines.covered;
  for (const metric of Object.values(file)) {
    metric.pct =
      metric.total === 0
        ? 100
        : Number(((metric.covered / metric.total) * 100).toFixed(2));
  }
  files.push(file);
}

total.statements.total = total.lines.total;
total.statements.covered = total.lines.covered;

for (const metric of Object.values(total)) {
  metric.pct =
    metric.total === 0
      ? 100
      : Number(((metric.covered / metric.total) * 100).toFixed(2));
}

function averagePct(metricName) {
  if (files.length === 0) return 100;
  const value =
    files.reduce((sum, file) => sum + file[metricName].pct, 0) / files.length;
  return Number(value.toFixed(2));
}

const average = {
  lines: {
    total: files.length,
    covered: files.length,
    skipped: 0,
    pct: averagePct('lines'),
  },
  statements: {
    total: files.length,
    covered: files.length,
    skipped: 0,
    pct: averagePct('statements'),
  },
  functions: {
    total: files.length,
    covered: files.length,
    skipped: 0,
    pct: averagePct('functions'),
  },
  branches: {
    total: files.length,
    covered: files.length,
    skipped: 0,
    pct: averagePct('branches'),
  },
};

const summary = { average, total };
fs.mkdirSync(coverageDir, { recursive: true });
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Wrote ${summaryPath}`);
