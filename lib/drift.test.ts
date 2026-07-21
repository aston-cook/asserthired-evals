import { describe, expect, it } from 'vitest';
import { detectDrift, renderDriftReport } from './drift.js';
import type { DriftReport } from './drift.js';
import { makeRunSummary } from '../tests/fixtures.js';

function metric(report: DriftReport, key: string) {
  const found = report.metrics.find((m) => m.key === key);
  if (!found) throw new Error(`metric ${key} missing from report`);
  return found;
}

describe('detectDrift', () => {
  it('needs at least two baseline runs plus a current run', () => {
    const outcome = detectDrift([
      makeRunSummary({ timestamp: '2026-07-01' }),
      makeRunSummary({ timestamp: '2026-07-08' }),
    ]);
    expect(outcome.ok).toBe(false);
  });

  it('reports stable when the latest run sits inside baseline noise', () => {
    const outcome = detectDrift([
      makeRunSummary({ timestamp: '2026-07-01' }),
      makeRunSummary({ timestamp: '2026-07-08' }),
      makeRunSummary({ timestamp: '2026-07-15' }),
    ]);
    expect(outcome.ok).toBe(true);
    const report = outcome as DriftReport;
    expect(report.regressions).toEqual([]);
    expect(report.improvements).toEqual([]);
    expect(report.metrics.every((m) => m.direction === 'stable')).toBe(true);
  });

  it('flags a pass-rate drop beyond the floor as a regression', () => {
    const outcome = detectDrift([
      makeRunSummary({ timestamp: '2026-07-01' }),
      makeRunSummary({ timestamp: '2026-07-08' }),
      makeRunSummary({
        timestamp: '2026-07-15',
        scoreInRange: { ran: true, passed: 58, total: 65, passRate: 0.892, failures: [] },
      }),
    ]);
    const report = outcome as DriftReport;
    expect(report.regressions).toContain('Score in range');
    expect(metric(report, 'scoreInRange').direction).toBe('regression');
  });

  it('labels an upward move on a down-is-bad metric as an improvement', () => {
    const outcome = detectDrift([
      makeRunSummary({ timestamp: '2026-07-01' }),
      makeRunSummary({ timestamp: '2026-07-08' }),
      makeRunSummary({
        timestamp: '2026-07-15',
        mustMention: { ran: true, termsHit: 115, termsTotal: 115, termHitRate: 1.0, missed: [] },
      }),
    ]);
    const report = outcome as DriftReport;
    expect(report.improvements).toContain('Must-mention term hit rate');
    expect(report.regressions).toEqual([]);
  });

  it('treats any new must-not-mention violation as drift on a clean baseline', () => {
    const outcome = detectDrift([
      makeRunSummary({ timestamp: '2026-07-01' }),
      makeRunSummary({ timestamp: '2026-07-08' }),
      makeRunSummary({
        timestamp: '2026-07-15',
        mustNotMention: { ran: true, violations: 1, cases: [{ id: 'x', reason: 'trap' }] },
      }),
    ]);
    const report = outcome as DriftReport;
    expect(metric(report, 'violations').direction).toBe('regression');
  });

  it('tolerates larger swings when the baseline itself is noisy', () => {
    const outcome = detectDrift([
      makeRunSummary({
        timestamp: '2026-07-01',
        scoreInRange: { ran: true, passed: 59, total: 65, passRate: 0.9, failures: [] },
      }),
      makeRunSummary({
        timestamp: '2026-07-08',
        scoreInRange: { ran: true, passed: 64, total: 65, passRate: 0.98, failures: [] },
      }),
      makeRunSummary({
        timestamp: '2026-07-15',
        scoreInRange: { ran: true, passed: 57, total: 65, passRate: 0.87, failures: [] },
      }),
    ]);
    // Baseline mean 0.94, stddev 0.04, allowed 2 x 0.04 = 0.08; delta -0.07.
    expect(metric(outcome as DriftReport, 'scoreInRange').direction).toBe('stable');
  });

  it('skips metrics missing from the baseline instead of guessing', () => {
    const noConsistency = { consistency: { ran: false as const } };
    const outcome = detectDrift([
      makeRunSummary({ timestamp: '2026-07-01', ...noConsistency }),
      makeRunSummary({ timestamp: '2026-07-08', ...noConsistency }),
      makeRunSummary({ timestamp: '2026-07-15' }),
    ]);
    const report = outcome as DriftReport;
    expect(report.skipped).toContain('Consistency mean stddev');
    expect(report.metrics.find((m) => m.key === 'consistency')).toBeUndefined();
  });

  it('honors the rolling window when older runs disagree', () => {
    const outcome = detectDrift(
      [
        makeRunSummary({
          timestamp: '2026-06-01',
          scoreInRange: { ran: true, passed: 33, total: 65, passRate: 0.508, failures: [] },
        }),
        makeRunSummary({ timestamp: '2026-07-01' }),
        makeRunSummary({ timestamp: '2026-07-08' }),
        makeRunSummary({ timestamp: '2026-07-15' }),
      ],
      { window: 2 },
    );
    const report = outcome as DriftReport;
    expect(report.baselineTimestamps).toEqual(['2026-07-01', '2026-07-08']);
    expect(metric(report, 'scoreInRange').direction).toBe('stable');
  });
});

describe('renderDriftReport', () => {
  it('renders the insufficient-data reason', () => {
    const text = renderDriftReport({ ok: false, reason: 'not enough runs' });
    expect(text).toContain('not enough runs');
  });

  it('renders a table with per-metric status', () => {
    const outcome = detectDrift([
      makeRunSummary({ timestamp: '2026-07-01' }),
      makeRunSummary({ timestamp: '2026-07-08' }),
      makeRunSummary({
        timestamp: '2026-07-15',
        scoreInRange: { ran: true, passed: 58, total: 65, passRate: 0.892, failures: [] },
      }),
    ]);
    const text = renderDriftReport(outcome);
    expect(text).toContain('| Metric | Baseline mean |');
    expect(text).toContain('REGRESSION');
    expect(text).toContain('Regressions: Score in range');
  });
});
