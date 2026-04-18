import { describe, it, expect } from 'vitest';
import scoreInRange from './score-in-range.js';
import { baseCase, makeScoringOutput } from '../tests/fixtures.js';

describe('score-in-range', () => {
  it('passes when score is within range', async () => {
    const result = await scoreInRange({
      output: makeScoringOutput({ score: 50 }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('passes at range boundaries (inclusive)', async () => {
    const lo = await scoreInRange({ output: makeScoringOutput({ score: 40 }), test: { vars: baseCase } });
    const hi = await scoreInRange({ output: makeScoringOutput({ score: 60 }), test: { vars: baseCase } });
    expect(lo.pass).toBe(true);
    expect(hi.pass).toBe(true);
  });

  it('fails when score is outside range', async () => {
    const result = await scoreInRange({
      output: makeScoringOutput({ score: 90 }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain('outside');
  });

  it('fails cleanly on malformed JSON', async () => {
    const result = await scoreInRange({ output: 'not json', test: { vars: baseCase } });
    expect(result.pass).toBe(false);
    expect(result.reason.toLowerCase()).toContain('malformed');
  });

  it('fails cleanly when score field is missing or wrong type', async () => {
    const result = await scoreInRange({
      output: JSON.stringify({ feedback: 'x', strengths: [], improvements: [] }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(false);
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const fenced = '```json\n' + makeScoringOutput({ score: 50 }) + '\n```';
    const result = await scoreInRange({ output: fenced, test: { vars: baseCase } });
    expect(result.pass).toBe(true);
  });

  it('accepts JSON with leading prose', async () => {
    const withProse = 'Here is my scoring: ' + makeScoringOutput({ score: 50 });
    const result = await scoreInRange({ output: withProse, test: { vars: baseCase } });
    expect(result.pass).toBe(true);
  });
});
