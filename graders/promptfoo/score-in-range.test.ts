import { describe, it, expect } from 'vitest';
import adapter from './score-in-range.js';
import { decodeCaseVars } from '../../lib/promptfoo-adapter.js';
import {
  baseCase,
  makeScoringOutput,
  promptfooVars,
  uniformDimScores,
} from '../../tests/fixtures.js';

describe('promptfoo adapter: score-in-range', () => {
  it('unwraps Promptfoo context and delegates to the grader (pass path)', async () => {
    const result = await adapter(makeScoringOutput(uniformDimScores(50)), {
      test: { vars: promptfooVars(baseCase) },
      providerResponse: { latencyMs: 1234 },
    });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('delegates fail path', async () => {
    const result = await adapter(makeScoringOutput(uniformDimScores(90)), {
      test: { vars: promptfooVars(baseCase) },
      providerResponse: { latencyMs: 1234 },
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('outside');
  });

  it('tolerates missing providerResponse', async () => {
    const result = await adapter(makeScoringOutput(uniformDimScores(50)), {
      test: { vars: promptfooVars(baseCase) },
    });
    expect(result.pass).toBe(true);
  });
});

describe('decodeCaseVars', () => {
  it('round-trips a golden case through the caseJson var', () => {
    expect(decodeCaseVars(promptfooVars(baseCase))).toEqual(baseCase);
  });

  it('throws a clear error when caseJson is missing', () => {
    expect(() => decodeCaseVars({ id: 'x' })).toThrow(/caseJson/);
  });

  it('throws when caseJson does not match the schema', () => {
    expect(() => decodeCaseVars({ caseJson: '{"id":"only"}' })).toThrow();
  });
});
