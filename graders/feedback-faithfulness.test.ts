import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeCase, makeScoringOutput } from '../tests/fixtures.js';

vi.mock('../lib/claude-client.js', () => ({
  judge: vi.fn(),
}));

import { judge } from '../lib/claude-client.js';
import feedbackFaithfulness from './feedback-faithfulness.js';

const mockedJudge = vi.mocked(judge);

const baseCase = makeCase({
  question: 'How would you test login?',
  candidateAnswer: 'I would use equivalence partitioning and boundary analysis.',
});

describe('feedback-faithfulness', () => {
  beforeEach(() => {
    mockedJudge.mockReset();
  });

  it('passes when judge reports no violations', async () => {
    mockedJudge.mockResolvedValue({
      text: '{"pass":true,"violations":[]}',
      latencyMs: 100,
    });
    const result = await feedbackFaithfulness({
      output: makeScoringOutput({ score: 55, feedback: 'grounded feedback' }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('fails when judge reports ungrounded claims with citation', async () => {
    mockedJudge.mockResolvedValue({
      text: JSON.stringify({
        pass: false,
        violations: [
          {
            claim: 'Great coverage of Selenium automation',
            supporting_span: null,
            reason: 'Selenium is not mentioned in the answer',
          },
        ],
      }),
      latencyMs: 100,
    });
    const result = await feedbackFaithfulness({
      output: makeScoringOutput({ feedback: 'Your Selenium usage was great.' }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('Selenium');
    expect(result.reason).toContain('no supporting span');
  });

  it('includes supporting span in reason when provided', async () => {
    mockedJudge.mockResolvedValue({
      text: JSON.stringify({
        pass: false,
        violations: [
          {
            claim: 'you mentioned unit tests',
            supporting_span: 'equivalence partitioning and boundary analysis',
            reason: 'Candidate did not mention unit tests',
          },
        ],
      }),
      latencyMs: 100,
    });
    const result = await feedbackFaithfulness({
      output: makeScoringOutput({ feedback: 'you mentioned unit tests' }),
      test: { vars: baseCase },
    });
    expect(result.reason).toContain('equivalence partitioning and boundary analysis');
  });

  it('fails cleanly when scoring output is malformed', async () => {
    const result = await feedbackFaithfulness({
      output: 'not json',
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(false);
    expect(result.reason.toLowerCase()).toContain('malformed');
    expect(mockedJudge).not.toHaveBeenCalled();
  });

  it('fails cleanly when judge returns malformed JSON', async () => {
    mockedJudge.mockResolvedValue({ text: 'garbage response', latencyMs: 50 });
    const result = await feedbackFaithfulness({
      output: makeScoringOutput({ feedback: 'x' }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(false);
    expect(result.reason.toLowerCase()).toContain('malformed');
  });

  it('recovers when judge wraps JSON in a code fence', async () => {
    mockedJudge.mockResolvedValue({
      text: '```json\n{"pass":true,"violations":[]}\n```',
      latencyMs: 50,
    });
    const result = await feedbackFaithfulness({
      output: makeScoringOutput({ feedback: 'x' }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(true);
  });

  it('passes all four scoring fields to the judge', async () => {
    mockedJudge.mockResolvedValue({
      text: '{"pass":true,"violations":[]}',
      latencyMs: 100,
    });
    await feedbackFaithfulness({
      output: makeScoringOutput({
        feedback: 'FEEDBACK_TOKEN',
        strengths: ['STRENGTH_TOKEN'],
        improvements: ['IMPROVEMENT_TOKEN'],
      }),
      test: { vars: baseCase },
    });
    const call = mockedJudge.mock.calls[0]?.[0];
    expect(call?.user).toContain('FEEDBACK_TOKEN');
    expect(call?.user).toContain('STRENGTH_TOKEN');
    expect(call?.user).toContain('IMPROVEMENT_TOKEN');
    expect(call?.user).toContain(baseCase.candidateAnswer);
  });
});
