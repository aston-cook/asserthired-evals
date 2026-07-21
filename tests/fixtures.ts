import type { GoldenCase, QuestionNote, ScoringOutput } from '../lib/types.js';
import type { RunSummary } from '../lib/report.js';

export function makeCase(overrides: Partial<GoldenCase> = {}): GoldenCase {
  return {
    id: 'test-001',
    category: 'manual-testing',
    difficulty: 'mid',
    question: 'Sample interview question',
    candidateAnswer: 'Sample candidate answer',
    expectedTier: 'mid',
    expectedScoreRange: [40, 60],
    mustMention: [],
    mustNotMention: [],
    ...overrides,
  };
}

export const baseCase: GoldenCase = makeCase();

// Mirrors the vars encoding produced by scripts/promptfoo-tests.ts: scalar
// fields plus the full case as a JSON string (promptfoo would cartesian-expand
// array-valued vars).
export function promptfooVars(c: GoldenCase): Record<string, unknown> {
  return {
    id: c.id,
    category: c.category,
    difficulty: c.difficulty,
    expectedTier: c.expectedTier,
    question: c.question,
    candidateAnswer: c.candidateAnswer,
    caseJson: JSON.stringify(c),
  };
}

export type ScoringOutputParts = Partial<ScoringOutput>;

export function uniformDimScores(n: number): Pick<
  ScoringOutput,
  'technical_score' | 'communication_score' | 'examples_score' | 'depth_score'
> {
  return {
    technical_score: n,
    communication_score: n,
    examples_score: n,
    depth_score: n,
  };
}

const DEFAULT_QUESTION_NOTES: QuestionNote[] = [
  {
    score: 50,
    note: 'Answer covered the basics but skipped edge cases.',
    ideal: 'A strong answer would walk through positive, negative, and boundary cases.',
  },
];

// A healthy live-run summary, close to the real baseline numbers. Override
// whole sub-objects to model regressions, missing metrics, or older runs.
export function makeRunSummary(
  overrides: Partial<RunSummary> & { timestamp: string },
): RunSummary {
  return {
    totalCases: 65,
    erroredCases: [],
    scoreInRange: { ran: true, passed: 64, total: 65, passRate: 0.985, failures: [] },
    faithfulness: { ran: true, passed: 58, total: 65, passRate: 0.892, failures: [] },
    safety: { ran: true, passed: 64, total: 65, passRate: 0.985, failures: [] },
    mustMention: { ran: true, termsHit: 108, termsTotal: 115, termHitRate: 0.939, missed: [] },
    mustNotMention: { ran: true, violations: 0, cases: [] },
    latency: { ran: true, count: 65, p50Ms: 20000, p95Ms: 22600, p99Ms: 24000 },
    consistency: { ran: true, model: 'test-model', runsPerCase: 5, meanStddev: 0.24, perCase: [] },
    ...overrides,
  };
}

export function makeScoringOutput(parts: ScoringOutputParts = {}): string {
  const payload: ScoringOutput = {
    technical_score: parts.technical_score ?? 50,
    communication_score: parts.communication_score ?? 50,
    examples_score: parts.examples_score ?? 50,
    depth_score: parts.depth_score ?? 50,
    technical_feedback: parts.technical_feedback ?? '',
    communication_feedback: parts.communication_feedback ?? '',
    examples_feedback: parts.examples_feedback ?? '',
    depth_feedback: parts.depth_feedback ?? '',
    summary: parts.summary ?? '',
    top_strength: parts.top_strength ?? '',
    main_improvement: parts.main_improvement ?? '',
    question_notes: parts.question_notes ?? DEFAULT_QUESTION_NOTES,
  };
  return JSON.stringify(payload);
}
