import { describe, expect, it } from 'bun:test';
import {
  buildCoverageReport,
  findBelowThresholdMetrics,
  formatDeltaPct,
  renderPullRequestComment,
} from './coverage-compare.ts';

describe('coverage compare', () => {
  it('computes weighted current main and delta rows', () => {
    const report = buildCoverageReport(
      {
        total: {
          lines: { pct: 96 },
          statements: { pct: 95.5 },
          functions: { pct: 94.25 },
          branches: { pct: 100 },
        },
      },
      {
        total: {
          lines: { pct: 94.5 },
          statements: { pct: 94.5 },
          functions: { pct: 93 },
          branches: { pct: 100 },
        },
      },
      90,
    );

    expect(report.failed).toBe(false);
    expect(report.rows).toEqual([
      { metric: 'Lines', current: '96.00%', main: '94.50%', delta: '+1.50%' },
      {
        metric: 'Statements',
        current: '95.50%',
        main: '94.50%',
        delta: '+1.00%',
      },
      {
        metric: 'Functions',
        current: '94.25%',
        main: '93.00%',
        delta: '+1.25%',
      },
      {
        metric: 'Branches',
        current: '100.00%',
        main: '100.00%',
        delta: '+0.00%',
      },
    ]);
  });

  it('prefers average coverage when summaries provide both average and total sections', () => {
    const report = buildCoverageReport(
      {
        average: {
          lines: { pct: 92 },
          statements: { pct: 92 },
          functions: { pct: 91 },
          branches: { pct: 100 },
        },
        total: {
          lines: { pct: 81 },
          statements: { pct: 81 },
          functions: { pct: 80 },
          branches: { pct: 100 },
        },
      },
      {
        average: {
          lines: { pct: 90 },
          statements: { pct: 90 },
          functions: { pct: 89 },
          branches: { pct: 100 },
        },
        total: {
          lines: { pct: 70 },
          statements: { pct: 70 },
          functions: { pct: 69 },
          branches: { pct: 100 },
        },
      },
      90,
    );

    expect(report.failed).toBe(false);
    expect(report.rows[0]).toEqual({
      metric: 'Lines',
      current: '92.00%',
      main: '90.00%',
      delta: '+2.00%',
    });
    expect(report.rows[2]).toEqual({
      metric: 'Functions',
      current: '91.00%',
      main: '89.00%',
      delta: '+2.00%',
    });
  });

  it('flags below-threshold weighted metrics and renders warning text', () => {
    const report = buildCoverageReport(
      {
        total: {
          lines: { pct: 89.5 },
          statements: { pct: 91 },
          functions: { pct: 88 },
          branches: { pct: 100 },
        },
      },
      {
        total: {
          lines: { pct: 96 },
          statements: { pct: 96 },
          functions: { pct: 95 },
          branches: { pct: 100 },
        },
      },
      90,
    );

    expect(findBelowThresholdMetrics(report.currentTotal, 90)).toEqual([
      'Lines',
      'Functions',
    ]);
    expect(renderPullRequestComment(report, { baselineLabel: 'main' })).toContain(
      'Coverage gate failed',
    );
    expect(renderPullRequestComment(report, { baselineLabel: 'main' })).toContain(
      '- Lines: 89.50%',
    );
    expect(renderPullRequestComment(report, { baselineLabel: 'main' })).toContain(
      '- Functions: 88.00%',
    );
  });

  it('handles missing baseline summary without inventing deltas', () => {
    const report = buildCoverageReport(
      {
        total: {
          lines: { pct: 91 },
          statements: { pct: 91 },
          functions: { pct: 91 },
          branches: { pct: 100 },
        },
      },
      null,
      90,
    );

    expect(report.rows[0]).toEqual({
      metric: 'Lines',
      current: '91.00%',
      main: 'N/A',
      delta: 'N/A',
    });
    expect(renderPullRequestComment(report, { baselineLabel: 'main' })).toContain(
      'Baseline `main` coverage summary is unavailable.',
    );
  });

  it('formats signed deltas with two decimal places', () => {
    expect(formatDeltaPct(1.234)).toBe('+1.23%');
    expect(formatDeltaPct(-0.8)).toBe('-0.80%');
  });
});
