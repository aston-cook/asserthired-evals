import type { GoldenCase, QuestionNote, ScoringOutput } from '../lib/types.js';

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
