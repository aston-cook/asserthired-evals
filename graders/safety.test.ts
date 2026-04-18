import { describe, it, expect, vi, beforeEach } from 'vitest';
import { baseCase, makeScoringOutput } from '../tests/fixtures.js';

vi.mock('../lib/claude-client.js', () => ({
  judge: vi.fn(),
}));

import { judge } from '../lib/claude-client.js';
import safety from './safety.js';

const mockedJudge = vi.mocked(judge);

describe('safety', () => {
  beforeEach(() => {
    mockedJudge.mockReset();
  });

  it('passes when judge reports no safety violations', async () => {
    mockedJudge.mockResolvedValue({
      text: '{"pass":true,"violations":[]}',
      latencyMs: 100,
    });
    const result = await safety({
      output: makeScoringOutput({ feedback: 'Your answer could use more structure.' }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('fails when judge flags a personal attack with severity', async () => {
    mockedJudge.mockResolvedValue({
      text: JSON.stringify({
        pass: false,
        violations: [
          {
            category: 'personal-attack',
            severity: 'medium',
            excerpt: 'You seem inexperienced',
            reason: "Comments on candidate's general experience rather than the answer",
          },
        ],
      }),
      latencyMs: 100,
    });
    const result = await safety({
      output: makeScoringOutput({ feedback: 'You seem inexperienced.' }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('personal-attack');
    expect(result.reason).toContain('medium');
  });

  it('surfaces severity in reason for demographic-bias violations', async () => {
    mockedJudge.mockResolvedValue({
      text: JSON.stringify({
        pass: false,
        violations: [
          {
            category: 'demographic-bias',
            severity: 'high',
            excerpt: 'biased text',
            reason: 'Makes an assumption based on a protected attribute',
          },
        ],
      }),
      latencyMs: 100,
    });
    const result = await safety({
      output: makeScoringOutput({ feedback: 'biased content' }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('high');
    expect(result.reason).toContain('demographic-bias');
  });

  it('fails cleanly when scoring output is malformed', async () => {
    const result = await safety({ output: 'not json', test: { vars: baseCase } });
    expect(result.pass).toBe(false);
    expect(mockedJudge).not.toHaveBeenCalled();
  });

  it('fails cleanly when judge returns malformed JSON', async () => {
    mockedJudge.mockResolvedValue({ text: 'not parseable', latencyMs: 50 });
    const result = await safety({ output: makeScoringOutput({}), test: { vars: baseCase } });
    expect(result.pass).toBe(false);
    expect(result.reason.toLowerCase()).toContain('malformed');
  });

  it('recovers when judge wraps JSON in a code fence', async () => {
    mockedJudge.mockResolvedValue({
      text: '```json\n{"pass":true,"violations":[]}\n```',
      latencyMs: 50,
    });
    const result = await safety({ output: makeScoringOutput({}), test: { vars: baseCase } });
    expect(result.pass).toBe(true);
  });

  it('normalizes unknown categories to "other"', async () => {
    mockedJudge.mockResolvedValue({
      text: JSON.stringify({
        pass: false,
        violations: [
          {
            category: 'made-up-category',
            severity: 'low',
            excerpt: 'x',
            reason: 'y',
          },
        ],
      }),
      latencyMs: 50,
    });
    const result = await safety({ output: makeScoringOutput({}), test: { vars: baseCase } });
    expect(result.reason).toContain('other');
  });
});
