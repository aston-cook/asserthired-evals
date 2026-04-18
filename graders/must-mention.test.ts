import { describe, it, expect } from 'vitest';
import mustMention from './must-mention.js';
import { makeCase, makeScoringOutput } from '../tests/fixtures.js';

const caseWithTerms = makeCase({
  mustMention: ['equivalence partitioning', 'boundary', 'negative cases'],
});

describe('must-mention', () => {
  it('returns full score when all terms are present in one dim', async () => {
    const output = makeScoringOutput({
      technical_feedback:
        'Used equivalence partitioning and boundary analysis with good negative cases.',
    });
    const result = await mustMention({ output, test: { vars: caseWithTerms } });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('returns partial score when some terms are missing (still passes)', async () => {
    const output = makeScoringOutput({
      technical_feedback: 'Used equivalence partitioning only.',
      question_notes: [],
    });
    const result = await mustMention({ output, test: { vars: caseWithTerms } });
    expect(result.pass).toBe(true);
    expect(result.score).toBeCloseTo(1 / 3);
    expect(result.reason).toContain('missed');
  });

  it('handles plural and singular variance', async () => {
    const output = makeScoringOutput({
      technical_feedback:
        'Covered equivalence partitioning, boundaries, and the negative case.',
    });
    const result = await mustMention({ output, test: { vars: caseWithTerms } });
    expect(result.score).toBe(1);
  });

  it('is case-insensitive', async () => {
    const output = makeScoringOutput({
      technical_feedback:
        'USED EQUIVALENCE PARTITIONING and BOUNDARY and NEGATIVE CASES.',
    });
    const result = await mustMention({ output, test: { vars: caseWithTerms } });
    expect(result.score).toBe(1);
  });

  it('scans across all four dim feedback fields, summary, strength, improvement', async () => {
    const output = makeScoringOutput({
      technical_feedback: 'Clean structure.',
      communication_feedback: 'Covers equivalence partitioning clearly.',
      examples_feedback: 'Boundary analysis was solid.',
      depth_feedback: 'Could go deeper.',
      summary: 'Decent answer.',
      top_strength: 'Good structure.',
      main_improvement: 'Add more negative cases next time.',
    });
    const result = await mustMention({ output, test: { vars: caseWithTerms } });
    expect(result.score).toBe(1);
  });

  it('scans question_notes note and ideal fields', async () => {
    const output = makeScoringOutput({
      technical_feedback: 'brief',
      question_notes: [
        {
          score: 60,
          note: 'Used equivalence partitioning in the first example.',
          ideal: 'A complete answer would cover boundary and negative cases explicitly.',
        },
      ],
    });
    const result = await mustMention({ output, test: { vars: caseWithTerms } });
    expect(result.score).toBe(1);
  });

  it('returns pass: true with score 1 when no must-mention terms are defined', async () => {
    const empty = makeCase({ mustMention: [] });
    const result = await mustMention({ output: makeScoringOutput(), test: { vars: empty } });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('returns pass: true with score 0 on malformed output', async () => {
    const result = await mustMention({ output: 'not json', test: { vars: caseWithTerms } });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
  });

  it('handles JSON wrapped in a code fence', async () => {
    const fenced =
      '```\n' +
      makeScoringOutput({
        technical_feedback: 'equivalence partitioning, boundary, negative cases',
      }) +
      '\n```';
    const result = await mustMention({ output: fenced, test: { vars: caseWithTerms } });
    expect(result.score).toBe(1);
  });
});
