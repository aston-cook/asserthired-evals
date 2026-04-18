import { describe, it, expect } from 'vitest';
import scoreInRange from './score-in-range.js';
import { baseCase, makeScoringOutput, uniformDimScores } from '../tests/fixtures.js';

describe('score-in-range', () => {
  it('passes when overall score is within range', async () => {
    const result = await scoreInRange({
      output: makeScoringOutput(uniformDimScores(50)),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('passes at range boundaries (inclusive)', async () => {
    const lo = await scoreInRange({
      output: makeScoringOutput(uniformDimScores(40)),
      test: { vars: baseCase },
    });
    const hi = await scoreInRange({
      output: makeScoringOutput(uniformDimScores(60)),
      test: { vars: baseCase },
    });
    expect(lo.pass).toBe(true);
    expect(hi.pass).toBe(true);
  });

  it('fails when overall score is outside range', async () => {
    const result = await scoreInRange({
      output: makeScoringOutput(uniformDimScores(90)),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain('outside');
  });

  it('computes overall as rounded average of the four dims', async () => {
    // (80 + 40 + 50 + 30) / 4 = 50 -> inside [40, 60]
    const result = await scoreInRange({
      output: makeScoringOutput({
        technical_score: 80,
        communication_score: 40,
        examples_score: 50,
        depth_score: 30,
      }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toContain('Overall 50');
    expect(result.reason).toContain('t=80');
    expect(result.reason).toContain('d=30');
  });

  it('rounds .5 up (Math.round banker/half-up is Math.round)', async () => {
    // (50 + 50 + 51 + 50) / 4 = 50.25 -> rounds to 50
    const rounded = await scoreInRange({
      output: makeScoringOutput({
        technical_score: 50,
        communication_score: 50,
        examples_score: 51,
        depth_score: 50,
      }),
      test: { vars: baseCase },
    });
    expect(rounded.reason).toContain('Overall 50');
  });

  it('fails cleanly on malformed JSON', async () => {
    const result = await scoreInRange({ output: 'not json', test: { vars: baseCase } });
    expect(result.pass).toBe(false);
    expect(result.reason.toLowerCase()).toContain('malformed');
  });

  it('fails cleanly when any dim score is missing or wrong type', async () => {
    const result = await scoreInRange({
      output: JSON.stringify({
        technical_score: 50,
        communication_score: 50,
        examples_score: 50,
        // depth_score omitted
        summary: 'x',
      }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('depth_score');
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const fenced = '```json\n' + makeScoringOutput(uniformDimScores(50)) + '\n```';
    const result = await scoreInRange({ output: fenced, test: { vars: baseCase } });
    expect(result.pass).toBe(true);
  });

  it('accepts JSON with leading prose', async () => {
    const withProse = 'Here is my scoring: ' + makeScoringOutput(uniformDimScores(50));
    const result = await scoreInRange({ output: withProse, test: { vars: baseCase } });
    expect(result.pass).toBe(true);
  });
});
