import { describe, it, expect } from 'vitest';
import mustMention from './must-mention.js';
import { makeCase, makeScoringOutput } from '../tests/fixtures.js';

const caseWithTerms = makeCase({
  mustMention: ['equivalence partitioning', 'boundary', 'negative cases'],
});

describe('must-mention', () => {
  it('returns full score when all terms are present', async () => {
    const output = makeScoringOutput({
      feedback: 'Used equivalence partitioning and boundary analysis with good negative cases.',
    });
    const result = await mustMention({ output, test: { vars: caseWithTerms } });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('returns partial score when some terms are missing (still passes)', async () => {
    const output = makeScoringOutput({ feedback: 'Used equivalence partitioning only.' });
    const result = await mustMention({ output, test: { vars: caseWithTerms } });
    expect(result.pass).toBe(true);
    expect(result.score).toBeCloseTo(1 / 3);
    expect(result.reason).toContain('missed');
  });

  it('handles plural and singular variance', async () => {
    const output = makeScoringOutput({
      feedback: 'Covered equivalence partitioning, boundaries, and the negative case.',
    });
    const result = await mustMention({ output, test: { vars: caseWithTerms } });
    expect(result.score).toBe(1);
  });

  it('is case-insensitive', async () => {
    const output = makeScoringOutput({
      feedback: 'USED EQUIVALENCE PARTITIONING and BOUNDARY and NEGATIVE CASES.',
    });
    const result = await mustMention({ output, test: { vars: caseWithTerms } });
    expect(result.score).toBe(1);
  });

  it('scans strengths and improvements arrays as well as feedback', async () => {
    const output = makeScoringOutput({
      feedback: 'Nice structure.',
      strengths: ['equivalence partitioning applied cleanly'],
      improvements: ['add boundary coverage and negative cases'],
    });
    const result = await mustMention({ output, test: { vars: caseWithTerms } });
    expect(result.score).toBe(1);
  });

  it('returns pass: true with score 1 when no must-mention terms are defined', async () => {
    const empty = makeCase({ mustMention: [] });
    const result = await mustMention({ output: makeScoringOutput({}), test: { vars: empty } });
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
      makeScoringOutput({ feedback: 'equivalence partitioning, boundary, negative cases' }) +
      '\n```';
    const result = await mustMention({ output: fenced, test: { vars: caseWithTerms } });
    expect(result.score).toBe(1);
  });
});
