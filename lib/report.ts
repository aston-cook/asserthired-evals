import { THRESHOLDS } from './thresholds.js';

export type MetricKey =
  | 'scoreInRange'
  | 'mustMention'
  | 'mustNotMention'
  | 'latency'
  | 'faithfulness'
  | 'safety';

export interface ComponentResult {
  pass: boolean;
  score: number;
  reason: string;
}

export interface CaseResult {
  id: string;
  category: string;
  expectedTier: string;
  latencyMs?: number;
  mustMentionTotal: number;
  error?: string;
  components: Partial<Record<MetricKey, ComponentResult>>;
}

export interface PassRateSummary {
  ran: boolean;
  passed?: number;
  total?: number;
  passRate?: number;
  failures?: Array<{ id: string; reason: string }>;
}

export interface ConsistencyCase {
  id: string;
  scores: number[];
  mean: number;
  stddev: number;
}

export interface ConsistencyData {
  model: string;
  runsPerCase: number;
  cases: ConsistencyCase[];
}

export interface RunSummary {
  timestamp: string;
  totalCases: number;
  erroredCases: Array<{ id: string; error: string }>;
  scoreInRange: PassRateSummary;
  faithfulness: PassRateSummary;
  safety: PassRateSummary;
  mustMention: {
    ran: boolean;
    termsHit?: number;
    termsTotal?: number;
    termHitRate?: number;
    missed?: Array<{ id: string; reason: string }>;
  };
  mustNotMention: {
    ran: boolean;
    violations?: number;
    cases?: Array<{ id: string; reason: string }>;
  };
  latency: {
    ran: boolean;
    count?: number;
    p50Ms?: number;
    p95Ms?: number;
    p99Ms?: number;
  };
  consistency: {
    ran: boolean;
    model?: string;
    runsPerCase?: number;
    meanStddev?: number;
    perCase?: ConsistencyCase[];
  };
}

export interface ThresholdEvaluation {
  hardFailures: string[];
  warnings: string[];
}

const METRIC_BY_FILE: Array<{ token: string; metric: MetricKey }> = [
  // Order matters: must-not-mention before must-mention (substring overlap).
  { token: 'must-not-mention', metric: 'mustNotMention' },
  { token: 'must-mention', metric: 'mustMention' },
  { token: 'score-in-range', metric: 'scoreInRange' },
  { token: 'latency-threshold', metric: 'latency' },
  { token: 'feedback-faithfulness', metric: 'faithfulness' },
  { token: 'safety', metric: 'safety' },
];

function metricFromAssertionValue(value: unknown): MetricKey | null {
  if (typeof value !== 'string') return null;
  for (const { token, metric } of METRIC_BY_FILE) {
    if (value.includes(token)) return metric;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function getResultsArray(json: unknown): unknown[] {
  const root = asRecord(json);
  if (!root) throw new Error('Promptfoo output is not an object');
  const results = root['results'];
  const inner = asRecord(results);
  if (inner && Array.isArray(inner['results'])) return inner['results'];
  if (Array.isArray(results)) return results;
  throw new Error('Unrecognized promptfoo output shape: no results array found');
}

export function extractCaseResults(promptfooJson: unknown): CaseResult[] {
  return getResultsArray(promptfooJson).map((raw, index) => {
    const r = asRecord(raw) ?? {};
    const vars =
      asRecord(r['vars']) ??
      asRecord(asRecord(r['testCase'])?.['vars']) ??
      {};
    const id = typeof vars['id'] === 'string' ? vars['id'] : `case-${index}`;
    const category =
      typeof vars['category'] === 'string' ? vars['category'] : 'unknown';
    const expectedTier =
      typeof vars['expectedTier'] === 'string' ? vars['expectedTier'] : 'unknown';
    let mustMentionTotal = 0;
    const caseJson = vars['caseJson'];
    if (typeof caseJson === 'string') {
      try {
        const parsedCase = asRecord(JSON.parse(caseJson));
        if (parsedCase && Array.isArray(parsedCase['mustMention'])) {
          mustMentionTotal = parsedCase['mustMention'].length;
        }
      } catch {
        // leave at 0; the mention metric will simply skip this case
      }
    } else if (Array.isArray(vars['mustMention'])) {
      mustMentionTotal = vars['mustMention'].length;
    }

    const caseResult: CaseResult = {
      id,
      category,
      expectedTier,
      mustMentionTotal,
      components: {},
    };

    if (typeof r['latencyMs'] === 'number') caseResult.latencyMs = r['latencyMs'];
    if (typeof r['error'] === 'string' && r['error'].length > 0) {
      caseResult.error = r['error'];
    }

    const grading = asRecord(r['gradingResult']);
    const components = grading ? grading['componentResults'] : undefined;
    if (Array.isArray(components)) {
      for (const rawComponent of components) {
        const c = asRecord(rawComponent);
        if (!c) continue;
        const assertion = asRecord(c['assertion']);
        const metric = metricFromAssertionValue(assertion?.['value']);
        if (!metric) continue;
        caseResult.components[metric] = {
          pass: c['pass'] === true,
          score: typeof c['score'] === 'number' ? c['score'] : 0,
          reason: typeof c['reason'] === 'string' ? c['reason'] : '',
        };
      }
    }

    return caseResult;
  });
}

export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedValues.length);
  const index = Math.min(Math.max(rank - 1, 0), sortedValues.length - 1);
  return sortedValues[index] as number;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const variance =
    values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / values.length;
  return Math.sqrt(variance);
}

// A case counts as errored only when the provider or harness failed before any
// grading happened. Promptfoo also sets the error field on results whose
// assertions failed, so error-plus-components is a graded failure, not an error.
export function isErroredCase(c: CaseResult): boolean {
  return c.error !== undefined && Object.keys(c.components).length === 0;
}

function passRateSummary(
  cases: CaseResult[],
  metric: 'scoreInRange' | 'faithfulness' | 'safety',
): PassRateSummary {
  const withComponent = cases.filter(
    (c) => c.components[metric] !== undefined || isErroredCase(c),
  );
  if (withComponent.length === 0) return { ran: false };

  const failures: Array<{ id: string; reason: string }> = [];
  let passed = 0;
  for (const c of withComponent) {
    const component = c.components[metric];
    if (component === undefined) {
      failures.push({ id: c.id, reason: `Case errored: ${c.error}` });
      continue;
    }
    if (component.pass) {
      passed += 1;
    } else {
      failures.push({ id: c.id, reason: component.reason });
    }
  }
  return {
    ran: true,
    passed,
    total: withComponent.length,
    passRate: withComponent.length > 0 ? passed / withComponent.length : 0,
    failures,
  };
}

export function summarizeRun(input: {
  timestamp: string;
  cases: CaseResult[];
  consistency?: ConsistencyData | null;
}): RunSummary {
  const { timestamp, cases, consistency } = input;

  const erroredCases = cases
    .filter((c) => isErroredCase(c))
    .map((c) => ({ id: c.id, error: c.error as string }));

  // Must-mention: term-weighted across the suite (Section 6.4). Each case's
  // component score is hits/terms, so hits = score * terms.
  const mentionCases = cases.filter(
    (c) => c.components.mustMention !== undefined && c.mustMentionTotal > 0,
  );
  let termsHit = 0;
  let termsTotal = 0;
  const missed: Array<{ id: string; reason: string }> = [];
  for (const c of mentionCases) {
    const component = c.components.mustMention as ComponentResult;
    termsTotal += c.mustMentionTotal;
    termsHit += Math.round(component.score * c.mustMentionTotal);
    if (component.score < 1) missed.push({ id: c.id, reason: component.reason });
  }

  const notMentionCases = cases.filter(
    (c) => c.components.mustNotMention !== undefined,
  );
  const violationCases = notMentionCases
    .filter((c) => (c.components.mustNotMention as ComponentResult).pass === false)
    .map((c) => ({
      id: c.id,
      reason: (c.components.mustNotMention as ComponentResult).reason,
    }));

  const latencies = cases
    .map((c) => c.latencyMs)
    .filter((v): v is number => typeof v === 'number' && v > 0)
    .sort((a, b) => a - b);

  const consistencyRan =
    consistency !== undefined &&
    consistency !== null &&
    consistency.cases.length > 0;

  return {
    timestamp,
    totalCases: cases.length,
    erroredCases,
    scoreInRange: passRateSummary(cases, 'scoreInRange'),
    faithfulness: passRateSummary(cases, 'faithfulness'),
    safety: passRateSummary(cases, 'safety'),
    mustMention:
      mentionCases.length > 0
        ? {
            ran: true,
            termsHit,
            termsTotal,
            termHitRate: termsTotal > 0 ? termsHit / termsTotal : 1,
            missed,
          }
        : { ran: false },
    mustNotMention:
      notMentionCases.length > 0
        ? { ran: true, violations: violationCases.length, cases: violationCases }
        : { ran: false },
    latency:
      latencies.length > 0
        ? {
            ran: true,
            count: latencies.length,
            p50Ms: percentile(latencies, 50),
            p95Ms: percentile(latencies, 95),
            p99Ms: percentile(latencies, 99),
          }
        : { ran: false },
    consistency: consistencyRan
      ? {
          ran: true,
          model: consistency.model,
          runsPerCase: consistency.runsPerCase,
          meanStddev: mean(consistency.cases.map((c) => c.stddev)),
          perCase: consistency.cases,
        }
      : { ran: false },
  };
}

export function evaluateThresholds(summary: RunSummary): ThresholdEvaluation {
  const hardFailures: string[] = [];
  const warnings: string[] = [];
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

  if (summary.scoreInRange.ran) {
    const rate = summary.scoreInRange.passRate ?? 0;
    if (rate < THRESHOLDS.scoreInRange.fail) {
      hardFailures.push(
        `score-in-range pass rate ${pct(rate)} is below the CI fail line ${pct(THRESHOLDS.scoreInRange.fail)}`,
      );
    } else if (rate < THRESHOLDS.scoreInRange.target) {
      warnings.push(
        `score-in-range pass rate ${pct(rate)} is below target ${pct(THRESHOLDS.scoreInRange.target)}`,
      );
    }
  }

  if (summary.faithfulness.ran) {
    const rate = summary.faithfulness.passRate ?? 0;
    if (rate < THRESHOLDS.faithfulness.fail) {
      hardFailures.push(
        `feedback-faithfulness pass rate ${pct(rate)} is below the CI fail line ${pct(THRESHOLDS.faithfulness.fail)}`,
      );
    } else if (rate < THRESHOLDS.faithfulness.target) {
      warnings.push(
        `feedback-faithfulness pass rate ${pct(rate)} is below target ${pct(THRESHOLDS.faithfulness.target)}`,
      );
    }
  }

  if (summary.safety.ran) {
    const rate = summary.safety.passRate ?? 0;
    if (rate < THRESHOLDS.safety.minPassRate) {
      hardFailures.push(
        `safety pass rate ${pct(rate)} is below the required ${pct(THRESHOLDS.safety.minPassRate)}`,
      );
    }
  }

  if (summary.mustMention.ran) {
    const rate = summary.mustMention.termHitRate ?? 0;
    if (rate < THRESHOLDS.mustMention.failTermHitRate) {
      hardFailures.push(
        `must-mention term hit rate ${pct(rate)} is below the required ${pct(THRESHOLDS.mustMention.failTermHitRate)}`,
      );
    }
  }

  if (summary.mustNotMention.ran) {
    const violations = summary.mustNotMention.violations ?? 0;
    if (violations > THRESHOLDS.mustNotMention.maxViolations) {
      hardFailures.push(
        `must-not-mention has ${violations} violation(s); the threshold is zero`,
      );
    }
  }

  if (summary.consistency.ran) {
    const meanSd = summary.consistency.meanStddev ?? 0;
    if (meanSd > THRESHOLDS.consistency.failMeanStddev) {
      hardFailures.push(
        `score consistency mean stddev ${meanSd.toFixed(2)} exceeds the CI fail line ${THRESHOLDS.consistency.failMeanStddev}`,
      );
    } else if (meanSd > THRESHOLDS.consistency.targetMeanStddev) {
      warnings.push(
        `score consistency mean stddev ${meanSd.toFixed(2)} exceeds target ${THRESHOLDS.consistency.targetMeanStddev}`,
      );
    }
  }

  if (summary.latency.ran) {
    const { p50Ms, p95Ms, p99Ms } = summary.latency;
    if ((p50Ms ?? 0) > THRESHOLDS.latency.p50Ms) {
      warnings.push(
        `latency p50 ${p50Ms}ms exceeds the ${THRESHOLDS.latency.p50Ms}ms SLO (warn only)`,
      );
    }
    if ((p95Ms ?? 0) > THRESHOLDS.latency.p95Ms) {
      warnings.push(
        `latency p95 ${p95Ms}ms exceeds the ${THRESHOLDS.latency.p95Ms}ms SLO (warn only)`,
      );
    }
    if ((p99Ms ?? 0) > THRESHOLDS.latency.p99Ms) {
      warnings.push(
        `latency p99 ${p99Ms}ms exceeds the ${THRESHOLDS.latency.p99Ms}ms SLO (warn only)`,
      );
    }
  }

  if (summary.erroredCases.length > 0) {
    hardFailures.push(
      `${summary.erroredCases.length} case(s) errored before grading: ${summary.erroredCases
        .map((c) => c.id)
        .join(', ')}`,
    );
  }

  return { hardFailures, warnings };
}

function pctOrDash(rate: number | undefined): string {
  return rate === undefined ? '-' : `${(rate * 100).toFixed(1)}%`;
}

function failureList(
  failures: Array<{ id: string; reason: string }> | undefined,
  limit = 20,
): string {
  if (!failures || failures.length === 0) return '';
  const shown = failures.slice(0, limit);
  const lines = shown.map((f) => `- \`${f.id}\`: ${f.reason}`);
  if (failures.length > limit) {
    lines.push(`- ...and ${failures.length - limit} more`);
  }
  return `\n${lines.join('\n')}\n`;
}

export function renderMarkdownReport(
  summary: RunSummary,
  evaluation: ThresholdEvaluation,
): string {
  const lines: string[] = [];
  const status = evaluation.hardFailures.length === 0 ? 'PASS' : 'FAIL';

  lines.push(`# Eval run ${summary.timestamp}`);
  lines.push('');
  lines.push(`**Result: ${status}** (${summary.totalCases} cases)`);
  lines.push('');

  lines.push('| Metric | Result | Threshold | Status |');
  lines.push('|---|---|---|---|');

  const rows: Array<[string, string, string, boolean | null]> = [];

  rows.push([
    'Score in range',
    summary.scoreInRange.ran
      ? `${summary.scoreInRange.passed}/${summary.scoreInRange.total} (${pctOrDash(summary.scoreInRange.passRate)})`
      : 'not run',
    `target ${THRESHOLDS.scoreInRange.target * 100}%, fail < ${THRESHOLDS.scoreInRange.fail * 100}%`,
    summary.scoreInRange.ran
      ? (summary.scoreInRange.passRate ?? 0) >= THRESHOLDS.scoreInRange.fail
      : null,
  ]);
  rows.push([
    'Score consistency (mean stddev)',
    summary.consistency.ran
      ? `${summary.consistency.meanStddev?.toFixed(2)} over ${summary.consistency.perCase?.length} cases x ${summary.consistency.runsPerCase} runs`
      : 'not run',
    `target <= ${THRESHOLDS.consistency.targetMeanStddev}, fail > ${THRESHOLDS.consistency.failMeanStddev}`,
    summary.consistency.ran
      ? (summary.consistency.meanStddev ?? 0) <= THRESHOLDS.consistency.failMeanStddev
      : null,
  ]);
  rows.push([
    'Feedback faithfulness',
    summary.faithfulness.ran
      ? `${summary.faithfulness.passed}/${summary.faithfulness.total} (${pctOrDash(summary.faithfulness.passRate)})`
      : 'not run',
    `target ${THRESHOLDS.faithfulness.target * 100}%, fail < ${THRESHOLDS.faithfulness.fail * 100}%`,
    summary.faithfulness.ran
      ? (summary.faithfulness.passRate ?? 0) >= THRESHOLDS.faithfulness.fail
      : null,
  ]);
  rows.push([
    'Must-mention coverage',
    summary.mustMention.ran
      ? `${summary.mustMention.termsHit}/${summary.mustMention.termsTotal} terms (${pctOrDash(summary.mustMention.termHitRate)})`
      : 'not run',
    `>= ${THRESHOLDS.mustMention.failTermHitRate * 100}% of terms`,
    summary.mustMention.ran
      ? (summary.mustMention.termHitRate ?? 0) >= THRESHOLDS.mustMention.failTermHitRate
      : null,
  ]);
  rows.push([
    'Must-not-mention violations',
    summary.mustNotMention.ran
      ? `${summary.mustNotMention.violations} violation(s)`
      : 'not run',
    'zero violations',
    summary.mustNotMention.ran ? (summary.mustNotMention.violations ?? 0) === 0 : null,
  ]);
  rows.push([
    'Safety',
    summary.safety.ran
      ? `${summary.safety.passed}/${summary.safety.total} (${pctOrDash(summary.safety.passRate)})`
      : 'not run',
    '100% pass',
    summary.safety.ran
      ? (summary.safety.passRate ?? 0) >= THRESHOLDS.safety.minPassRate
      : null,
  ]);
  rows.push([
    'Latency',
    summary.latency.ran
      ? `p50 ${summary.latency.p50Ms}ms, p95 ${summary.latency.p95Ms}ms, p99 ${summary.latency.p99Ms}ms`
      : 'not run',
    `p50 <= ${THRESHOLDS.latency.p50Ms}ms, p95 <= ${THRESHOLDS.latency.p95Ms}ms, p99 <= ${THRESHOLDS.latency.p99Ms}ms (warn only)`,
    null,
  ]);

  for (const [name, result, threshold, ok] of rows) {
    const badge = ok === null ? 'info' : ok ? 'pass' : 'FAIL';
    lines.push(`| ${name} | ${result} | ${threshold} | ${badge} |`);
  }
  lines.push('');

  if (evaluation.hardFailures.length > 0) {
    lines.push('## Hard failures');
    lines.push('');
    for (const f of evaluation.hardFailures) lines.push(`- ${f}`);
    lines.push('');
  }
  if (evaluation.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const w of evaluation.warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  const sections: Array<[string, Array<{ id: string; reason: string }> | undefined]> = [
    ['Score-in-range failures', summary.scoreInRange.failures],
    ['Faithfulness failures', summary.faithfulness.failures],
    ['Safety failures', summary.safety.failures],
    ['Must-mention misses', summary.mustMention.missed],
    ['Must-not-mention violations', summary.mustNotMention.cases],
  ];
  for (const [title, items] of sections) {
    if (items && items.length > 0) {
      lines.push(`## ${title}`);
      lines.push(failureList(items));
    }
  }

  if (summary.consistency.ran && summary.consistency.perCase) {
    lines.push('## Consistency detail');
    lines.push('');
    lines.push('| Case | Scores | Mean | Stddev |');
    lines.push('|---|---|---|---|');
    for (const c of summary.consistency.perCase) {
      lines.push(
        `| \`${c.id}\` | ${c.scores.join(', ')} | ${c.mean.toFixed(1)} | ${c.stddev.toFixed(2)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function renderTrendTable(summaries: RunSummary[]): string {
  const lines: string[] = [];
  lines.push('# Eval trend');
  lines.push('');
  if (summaries.length === 0) {
    lines.push('No run summaries found in reports/.');
    return lines.join('\n');
  }
  lines.push(
    '| Run | Score in range | Faithfulness | Safety | Mention rate | Violations | Mean stddev | p50 | p95 |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const s of summaries) {
    lines.push(
      `| ${s.timestamp} | ${pctOrDash(s.scoreInRange.passRate)} | ${pctOrDash(s.faithfulness.passRate)} | ${pctOrDash(s.safety.passRate)} | ${pctOrDash(s.mustMention.termHitRate)} | ${
        s.mustNotMention.violations ?? '-'
      } | ${s.consistency.meanStddev?.toFixed(2) ?? '-'} | ${s.latency.p50Ms ?? '-'} | ${s.latency.p95Ms ?? '-'} |`,
    );
  }
  return lines.join('\n');
}
