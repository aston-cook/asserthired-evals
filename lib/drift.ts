// Drift detection over past run summaries (roadmap item from v1). Instead of
// judging a run only against the fixed thresholds in lib/thresholds.ts, this
// compares the latest run to a rolling baseline built from the runs before it
// and flags metrics that moved more than the baseline's own noise explains.
// Deviations are flagged in both directions: a sudden improvement usually
// means the population or config changed, not that the model got smarter.

import { mean, stddev } from './report.js';
import type { RunSummary } from './report.js';

export interface DriftMetricConfig {
  key: string;
  label: string;
  // Minimum absolute change that counts as drift even on a dead-flat baseline.
  floor: number;
  // Direction that counts as a regression for this metric.
  regressionWhen: 'down' | 'up';
  extract: (s: RunSummary) => number | undefined;
  format: (v: number) => string;
}

const asPct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const asNum = (v: number): string => v.toFixed(2);
const asMs = (v: number): string => `${Math.round(v)}ms`;

export const DRIFT_METRICS: DriftMetricConfig[] = [
  {
    key: 'scoreInRange',
    label: 'Score in range',
    floor: 0.03,
    regressionWhen: 'down',
    extract: (s) => (s.scoreInRange.ran ? s.scoreInRange.passRate : undefined),
    format: asPct,
  },
  {
    key: 'faithfulness',
    label: 'Feedback faithfulness',
    floor: 0.03,
    regressionWhen: 'down',
    extract: (s) => (s.faithfulness.ran ? s.faithfulness.passRate : undefined),
    format: asPct,
  },
  {
    key: 'safety',
    label: 'Safety',
    floor: 0.02,
    regressionWhen: 'down',
    extract: (s) => (s.safety.ran ? s.safety.passRate : undefined),
    format: asPct,
  },
  {
    key: 'mustMention',
    label: 'Must-mention term hit rate',
    floor: 0.04,
    regressionWhen: 'down',
    extract: (s) => (s.mustMention.ran ? s.mustMention.termHitRate : undefined),
    format: asPct,
  },
  {
    key: 'violations',
    label: 'Must-not-mention violations',
    floor: 0,
    regressionWhen: 'up',
    extract: (s) => (s.mustNotMention.ran ? s.mustNotMention.violations : undefined),
    format: (v) => String(Math.round(v)),
  },
  {
    key: 'consistency',
    label: 'Consistency mean stddev',
    floor: 2,
    regressionWhen: 'up',
    extract: (s) => (s.consistency.ran ? s.consistency.meanStddev : undefined),
    format: asNum,
  },
  {
    key: 'latencyP50',
    label: 'Latency p50',
    floor: 3000,
    regressionWhen: 'up',
    extract: (s) => (s.latency.ran ? s.latency.p50Ms : undefined),
    format: asMs,
  },
];

export type DriftDirection = 'regression' | 'improvement' | 'stable';

export interface DriftMetricResult {
  key: string;
  label: string;
  baselineRuns: number;
  baselineMean: number;
  baselineStddev: number;
  current: number;
  delta: number;
  threshold: number;
  drifted: boolean;
  direction: DriftDirection;
  format: (v: number) => string;
}

export interface DriftReport {
  ok: true;
  baselineTimestamps: string[];
  currentTimestamp: string;
  metrics: DriftMetricResult[];
  skipped: string[];
  regressions: string[];
  improvements: string[];
}

export interface DriftInsufficient {
  ok: false;
  reason: string;
}

export type DriftOutcome = DriftReport | DriftInsufficient;

export interface DriftOptions {
  // How many prior runs feed the rolling baseline.
  window?: number;
  // How many baseline stddevs a delta may span before it counts as drift.
  stddevMultiplier?: number;
}

export function detectDrift(
  summaries: RunSummary[],
  options: DriftOptions = {},
): DriftOutcome {
  const window = options.window ?? 5;
  const k = options.stddevMultiplier ?? 2;

  const ordered = [...summaries].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  if (ordered.length < 3) {
    return {
      ok: false,
      reason: `Need at least 3 run summaries (2 baseline + 1 current); found ${ordered.length}`,
    };
  }

  const current = ordered[ordered.length - 1] as RunSummary;
  const baseline = ordered.slice(0, -1).slice(-window);

  const metrics: DriftMetricResult[] = [];
  const skipped: string[] = [];

  for (const config of DRIFT_METRICS) {
    const currentValue = config.extract(current);
    const baselineValues = baseline
      .map(config.extract)
      .filter((v): v is number => typeof v === 'number');

    if (currentValue === undefined || baselineValues.length < 2) {
      skipped.push(config.label);
      continue;
    }

    const baselineMean = mean(baselineValues);
    const baselineStddev = stddev(baselineValues);
    const delta = currentValue - baselineMean;
    const threshold = Math.max(k * baselineStddev, config.floor);
    const drifted = Math.abs(delta) > threshold;

    let direction: DriftDirection = 'stable';
    if (drifted) {
      const regressed = config.regressionWhen === 'down' ? delta < 0 : delta > 0;
      direction = regressed ? 'regression' : 'improvement';
    }

    metrics.push({
      key: config.key,
      label: config.label,
      baselineRuns: baselineValues.length,
      baselineMean,
      baselineStddev,
      current: currentValue,
      delta,
      threshold,
      drifted,
      direction,
      format: config.format,
    });
  }

  return {
    ok: true,
    baselineTimestamps: baseline.map((s) => s.timestamp),
    currentTimestamp: current.timestamp,
    metrics,
    skipped,
    regressions: metrics.filter((m) => m.direction === 'regression').map((m) => m.label),
    improvements: metrics
      .filter((m) => m.direction === 'improvement')
      .map((m) => m.label),
  };
}

export function renderDriftReport(outcome: DriftOutcome): string {
  const lines: string[] = [];
  lines.push('# Drift report');
  lines.push('');

  if (!outcome.ok) {
    lines.push(outcome.reason);
    return lines.join('\n');
  }

  lines.push(
    `Current run \`${outcome.currentTimestamp}\` vs a rolling baseline of ${outcome.baselineTimestamps.length} prior run(s).`,
  );
  lines.push('');

  if (outcome.regressions.length === 0 && outcome.improvements.length === 0) {
    lines.push('**No drift detected.** Every metric is within baseline noise.');
  } else {
    if (outcome.regressions.length > 0) {
      lines.push(`**Regressions: ${outcome.regressions.join(', ')}**`);
    }
    if (outcome.improvements.length > 0) {
      lines.push(
        `Improvements (verify these are real, not a population or config change): ${outcome.improvements.join(', ')}`,
      );
    }
  }
  lines.push('');

  lines.push('| Metric | Baseline mean | Baseline stddev | Current | Delta | Allowed | Status |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const m of outcome.metrics) {
    const sign = m.delta >= 0 ? '+' : '-';
    const status =
      m.direction === 'stable' ? 'stable' : m.direction.toUpperCase();
    lines.push(
      `| ${m.label} | ${m.format(m.baselineMean)} | ${m.format(m.baselineStddev)} | ${m.format(m.current)} | ${sign}${m.format(Math.abs(m.delta))} | ${m.format(m.threshold)} | ${status} |`,
    );
  }

  if (outcome.skipped.length > 0) {
    lines.push('');
    lines.push(
      `Skipped (not present in enough runs): ${outcome.skipped.join(', ')}`,
    );
  }

  return lines.join('\n');
}
