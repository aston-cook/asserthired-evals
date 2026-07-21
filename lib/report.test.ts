import { describe, expect, it } from 'vitest';
import {
  extractCaseResults,
  evaluateThresholds,
  mean,
  percentile,
  renderMarkdownReport,
  renderTrendTable,
  stddev,
  summarizeRun,
} from './report.js';
import type { CaseResult, ConsistencyData } from './report.js';

function promptfooResult(overrides: {
  id: string;
  mustMention?: string[];
  latencyMs?: number;
  error?: string;
  components?: Array<{ file: string; pass: boolean; score: number; reason?: string }>;
}) {
  return {
    vars: {
      id: overrides.id,
      category: 'manual-testing',
      expectedTier: 'strong',
      caseJson: JSON.stringify({ mustMention: overrides.mustMention ?? [] }),
    },
    latencyMs: overrides.latencyMs ?? 1200,
    ...(overrides.error !== undefined ? { error: overrides.error } : {}),
    gradingResult: {
      componentResults: (overrides.components ?? []).map((c) => ({
        pass: c.pass,
        score: c.score,
        reason: c.reason ?? 'reason',
        assertion: { type: 'javascript', value: `file://graders/promptfoo/${c.file}.ts` },
      })),
    },
  };
}

function wrapOutput(results: unknown[]) {
  return { evalId: 'test', results: { version: 3, results } };
}

describe('extractCaseResults', () => {
  it('maps component results to metrics by grader filename', () => {
    const raw = wrapOutput([
      promptfooResult({
        id: 'manual-0001',
        mustMention: ['a', 'b'],
        components: [
          { file: 'score-in-range', pass: true, score: 1 },
          { file: 'must-mention', pass: true, score: 0.5 },
          { file: 'must-not-mention', pass: false, score: 0, reason: 'hit trap' },
          { file: 'latency-threshold', pass: true, score: 1 },
          { file: 'feedback-faithfulness', pass: true, score: 1 },
          { file: 'safety', pass: true, score: 1 },
        ],
      }),
    ]);

    const cases = extractCaseResults(raw);
    expect(cases).toHaveLength(1);
    const c = cases[0] as CaseResult;
    expect(c.id).toBe('manual-0001');
    expect(c.mustMentionTotal).toBe(2);
    expect(c.components.scoreInRange?.pass).toBe(true);
    expect(c.components.mustMention?.score).toBe(0.5);
    expect(c.components.mustNotMention?.pass).toBe(false);
    expect(c.components.mustNotMention?.reason).toBe('hit trap');
    expect(c.components.faithfulness?.pass).toBe(true);
    expect(c.components.safety?.pass).toBe(true);
    expect(c.components.latency?.pass).toBe(true);
  });

  it('does not confuse must-mention with must-not-mention', () => {
    const raw = wrapOutput([
      promptfooResult({
        id: 'x',
        mustMention: ['a'],
        components: [
          { file: 'must-mention', pass: true, score: 1 },
          { file: 'must-not-mention', pass: true, score: 1 },
        ],
      }),
    ]);
    const c = (extractCaseResults(raw) as CaseResult[])[0] as CaseResult;
    expect(c.components.mustMention).toBeDefined();
    expect(c.components.mustNotMention).toBeDefined();
  });

  it('captures provider errors', () => {
    const raw = wrapOutput([
      promptfooResult({ id: 'boom', error: 'rate limited', components: [] }),
    ]);
    const c = (extractCaseResults(raw) as CaseResult[])[0] as CaseResult;
    expect(c.error).toBe('rate limited');
  });

  it('throws on unrecognized shapes', () => {
    expect(() => extractCaseResults({ nope: true })).toThrow(/results/);
  });
});

describe('math helpers', () => {
  it('computes percentiles on sorted input', () => {
    const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(values, 50)).toBe(500);
    expect(percentile(values, 95)).toBe(1000);
    expect(percentile([42], 99)).toBe(42);
    expect(percentile([], 50)).toBe(0);
  });

  it('computes mean and population stddev', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stddev([5, 5, 5])).toBe(0);
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 5);
    expect(stddev([80])).toBe(0);
  });
});

function buildSummary(overrides: {
  scorePasses?: number;
  scoreTotal?: number;
  violations?: number;
  mentionScorePerCase?: number;
  consistencyStddevs?: number[];
}) {
  const scoreTotal = overrides.scoreTotal ?? 10;
  const scorePasses = overrides.scorePasses ?? 10;
  const cases: unknown[] = [];
  for (let i = 0; i < scoreTotal; i++) {
    cases.push(
      promptfooResult({
        id: `case-${i}`,
        mustMention: ['term one', 'term two'],
        latencyMs: 1000 + i * 100,
        components: [
          { file: 'score-in-range', pass: i < scorePasses, score: i < scorePasses ? 1 : 0 },
          { file: 'must-mention', pass: true, score: overrides.mentionScorePerCase ?? 1 },
          {
            file: 'must-not-mention',
            pass: i >= (overrides.violations ?? 0),
            score: i >= (overrides.violations ?? 0) ? 1 : 0,
          },
          { file: 'feedback-faithfulness', pass: true, score: 1 },
          { file: 'safety', pass: true, score: 1 },
        ],
      }),
    );
  }
  const consistency: ConsistencyData | null = overrides.consistencyStddevs
    ? {
        model: 'test-model',
        runsPerCase: 5,
        cases: overrides.consistencyStddevs.map((sd, i) => ({
          id: `case-${i}`,
          scores: [70, 70, 70, 70, 70],
          mean: 70,
          stddev: sd,
        })),
      }
    : null;
  return summarizeRun({
    timestamp: '2026-01-01T00-00-00Z',
    cases: extractCaseResults(wrapOutput(cases)),
    consistency,
  });
}

describe('summarizeRun and evaluateThresholds', () => {
  it('passes a clean run', () => {
    const summary = buildSummary({ consistencyStddevs: [2, 3, 4] });
    expect(summary.scoreInRange.passRate).toBe(1);
    expect(summary.mustMention.termHitRate).toBe(1);
    expect(summary.mustNotMention.violations).toBe(0);
    expect(summary.consistency.meanStddev).toBe(3);
    const evaluation = evaluateThresholds(summary);
    expect(evaluation.hardFailures).toHaveLength(0);
  });

  it('warns between target and fail line for score-in-range', () => {
    const summary = buildSummary({ scorePasses: 82, scoreTotal: 100 });
    const evaluation = evaluateThresholds(summary);
    expect(evaluation.hardFailures).toHaveLength(0);
    expect(evaluation.warnings.some((w) => w.includes('score-in-range'))).toBe(true);
  });

  it('hard-fails below the score-in-range fail line', () => {
    const summary = buildSummary({ scorePasses: 7, scoreTotal: 10 });
    const evaluation = evaluateThresholds(summary);
    expect(evaluation.hardFailures.some((f) => f.includes('score-in-range'))).toBe(true);
  });

  it('hard-fails on any must-not-mention violation', () => {
    const summary = buildSummary({ violations: 1 });
    const evaluation = evaluateThresholds(summary);
    expect(
      evaluation.hardFailures.some((f) => f.includes('must-not-mention')),
    ).toBe(true);
  });

  it('computes term-weighted must-mention rate', () => {
    const summary = buildSummary({ mentionScorePerCase: 0.5 });
    expect(summary.mustMention.termHitRate).toBe(0.5);
    const evaluation = evaluateThresholds(summary);
    expect(evaluation.hardFailures.some((f) => f.includes('must-mention'))).toBe(true);
  });

  it('warns above consistency target and fails above the fail line', () => {
    const warned = evaluateThresholds(buildSummary({ consistencyStddevs: [9, 10] }));
    expect(warned.hardFailures).toHaveLength(0);
    expect(warned.warnings.some((w) => w.includes('consistency'))).toBe(true);

    const failed = evaluateThresholds(buildSummary({ consistencyStddevs: [13, 14] }));
    expect(failed.hardFailures.some((f) => f.includes('consistency'))).toBe(true);
  });

  it('does not count assertion failures with an error field as errored cases', () => {
    // Promptfoo sets error on results whose assertions failed; only results
    // with no grading data at all are genuine errors.
    const summary = summarizeRun({
      timestamp: 't',
      cases: extractCaseResults(
        wrapOutput([
          promptfooResult({
            id: 'graded-fail',
            error: 'Assertion failed',
            components: [{ file: 'score-in-range', pass: false, score: 0 }],
          }),
        ]),
      ),
      consistency: null,
    });
    expect(summary.erroredCases).toHaveLength(0);
    expect(summary.scoreInRange.passRate).toBe(0);
    const evaluation = evaluateThresholds(summary);
    expect(evaluation.hardFailures.some((f) => f.includes('errored'))).toBe(false);
  });

  it('treats errored cases as hard failures', () => {
    const summary = summarizeRun({
      timestamp: 't',
      cases: extractCaseResults(
        wrapOutput([promptfooResult({ id: 'boom', error: 'provider exploded' })]),
      ),
      consistency: null,
    });
    const evaluation = evaluateThresholds(summary);
    expect(evaluation.hardFailures.some((f) => f.includes('boom'))).toBe(true);
  });

  it('marks judge metrics as not run when absent (smoke mode)', () => {
    const summary = summarizeRun({
      timestamp: 't',
      cases: extractCaseResults(
        wrapOutput([
          promptfooResult({
            id: 'a',
            mustMention: ['x'],
            components: [
              { file: 'score-in-range', pass: true, score: 1 },
              { file: 'must-mention', pass: true, score: 1 },
              { file: 'must-not-mention', pass: true, score: 1 },
            ],
          }),
        ]),
      ),
      consistency: null,
    });
    expect(summary.faithfulness.ran).toBe(false);
    expect(summary.safety.ran).toBe(false);
    expect(summary.consistency.ran).toBe(false);
    expect(evaluateThresholds(summary).hardFailures).toHaveLength(0);
  });
});

describe('rendering', () => {
  it('renders a report with pass status and metric table', () => {
    const summary = buildSummary({ consistencyStddevs: [2] });
    const md = renderMarkdownReport(summary, evaluateThresholds(summary));
    expect(md).toContain('**Result: PASS**');
    expect(md).toContain('| Score in range |');
    expect(md).toContain('| Safety |');
  });

  it('renders FAIL status and failure sections', () => {
    const summary = buildSummary({ violations: 2 });
    const md = renderMarkdownReport(summary, evaluateThresholds(summary));
    expect(md).toContain('**Result: FAIL**');
    expect(md).toContain('Hard failures');
    expect(md).toContain('Must-not-mention violations');
  });

  it('renders a trend table across runs', () => {
    const a = buildSummary({ consistencyStddevs: [2] });
    const b = buildSummary({ scorePasses: 8, scoreTotal: 10 });
    const table = renderTrendTable([a, b]);
    expect(table).toContain('| Run |');
    expect(table.split('\n').length).toBeGreaterThan(4);
    expect(renderTrendTable([])).toContain('No run summaries');
  });
});
