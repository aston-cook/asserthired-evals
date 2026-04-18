import type { GoldenCase } from '../lib/types.js';

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

interface ScoringOutputParts {
  score?: number;
  feedback?: string;
  strengths?: string[];
  improvements?: string[];
}

export function makeScoringOutput(parts: ScoringOutputParts = {}): string {
  return JSON.stringify({
    score: parts.score ?? 50,
    feedback: parts.feedback ?? '',
    strengths: parts.strengths ?? [],
    improvements: parts.improvements ?? [],
  });
}
