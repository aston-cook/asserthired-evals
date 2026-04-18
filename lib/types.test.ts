import { describe, it, expect } from 'vitest';
import { GoldenCaseSchema } from './types.js';

const validCase = {
  id: 'manual-0001',
  category: 'manual-testing' as const,
  difficulty: 'mid' as const,
  question: 'q',
  candidateAnswer: 'a',
  expectedTier: 'mid' as const,
  expectedScoreRange: [40, 60] as [number, number],
  mustMention: [],
  mustNotMention: [],
};

describe('GoldenCaseSchema', () => {
  it('accepts a valid case', () => {
    expect(() => GoldenCaseSchema.parse(validCase)).not.toThrow();
  });

  it('accepts a range of exactly 10 points wide', () => {
    const c = { ...validCase, expectedScoreRange: [50, 60] as [number, number] };
    expect(() => GoldenCaseSchema.parse(c)).not.toThrow();
  });

  it('rejects a range narrower than 10 points (Section 5.4)', () => {
    const c = { ...validCase, expectedScoreRange: [50, 55] as [number, number] };
    expect(() => GoldenCaseSchema.parse(c)).toThrow(/10 points/);
  });

  it('rejects an inverted range', () => {
    const c = { ...validCase, expectedScoreRange: [60, 40] as [number, number] };
    expect(() => GoldenCaseSchema.parse(c)).toThrow();
  });

  it('validates all three Section 5.3 seed examples', () => {
    const seeds = [
      {
        id: 'manual-0001',
        category: 'manual-testing',
        difficulty: 'mid',
        question: 'How would you test a login form?',
        candidateAnswer: 'I would use equivalence partitioning.',
        expectedTier: 'strong',
        expectedScoreRange: [80, 95],
        mustMention: ['equivalence partitioning', 'boundary', 'negative cases'],
        mustNotMention: ['unit testing the backend database'],
        notes: 'Solid answer',
      },
      {
        id: 'manual-0002',
        category: 'manual-testing',
        difficulty: 'mid',
        question: 'How would you test a login form?',
        candidateAnswer: 'I would test the login form.',
        expectedTier: 'weak',
        expectedScoreRange: [10, 30],
        mustMention: ['test design', 'edge cases', 'negative'],
        mustNotMention: [],
      },
      {
        id: 'manual-0003',
        category: 'manual-testing',
        difficulty: 'mid',
        question: 'How would you test a login form?',
        candidateAnswer: 'I love React.',
        expectedTier: 'off-topic',
        expectedScoreRange: [0, 15],
        mustMention: [],
        mustNotMention: ['good answer', 'strong response'],
      },
    ];
    for (const seed of seeds) {
      expect(() => GoldenCaseSchema.parse(seed)).not.toThrow();
    }
  });
});
