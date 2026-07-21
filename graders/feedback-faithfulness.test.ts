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
      output: makeScoringOutput({ technical_feedback: 'grounded feedback' }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('fails when judge reports ungrounded claims with citation and field attribution', async () => {
    mockedJudge.mockResolvedValue({
      text: JSON.stringify({
        pass: false,
        violations: [
          {
            field: 'examples_feedback',
            claim: 'Great coverage of Selenium automation',
            supporting_span: null,
            reason: 'Selenium is not mentioned in the answer',
          },
        ],
      }),
      latencyMs: 100,
    });
    const result = await feedbackFaithfulness({
      output: makeScoringOutput({ examples_feedback: 'Your Selenium usage was great.' }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('Selenium');
    expect(result.reason).toContain('no supporting span');
    expect(result.reason).toContain('examples_feedback');
  });

  it('includes supporting span in reason when provided', async () => {
    mockedJudge.mockResolvedValue({
      text: JSON.stringify({
        pass: false,
        violations: [
          {
            field: 'technical_feedback',
            claim: 'you mentioned unit tests',
            supporting_span: 'equivalence partitioning and boundary analysis',
            reason: 'Candidate did not mention unit tests',
          },
        ],
      }),
      latencyMs: 100,
    });
    const result = await feedbackFaithfulness({
      output: makeScoringOutput({ technical_feedback: 'you mentioned unit tests' }),
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
      output: makeScoringOutput({ technical_feedback: 'x' }),
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
      output: makeScoringOutput({ technical_feedback: 'x' }),
      test: { vars: baseCase },
    });
    expect(result.pass).toBe(true);
  });

  it('passes all labeled sections (dim feedback, summary, strength, improvement, question_notes) to the judge', async () => {
    mockedJudge.mockResolvedValue({
      text: '{"pass":true,"violations":[]}',
      latencyMs: 100,
    });
    await feedbackFaithfulness({
      output: makeScoringOutput({
        technical_feedback: 'TECH_TOKEN',
        communication_feedback: 'COMM_TOKEN',
        examples_feedback: 'EXAMPLES_TOKEN',
        depth_feedback: 'DEPTH_TOKEN',
        summary: 'SUMMARY_TOKEN',
        top_strength: 'STRENGTH_TOKEN',
        main_improvement: 'IMPROVEMENT_TOKEN',
        question_notes: [{ score: 50, note: 'NOTE_TOKEN', ideal: 'IDEAL_TOKEN' }],
      }),
      test: { vars: baseCase },
    });
    const call = mockedJudge.mock.calls[0]?.[0];
    const user = call?.user ?? '';
    expect(user).toContain('TECH_TOKEN');
    expect(user).toContain('COMM_TOKEN');
    expect(user).toContain('EXAMPLES_TOKEN');
    expect(user).toContain('DEPTH_TOKEN');
    expect(user).toContain('SUMMARY_TOKEN');
    expect(user).toContain('STRENGTH_TOKEN');
    expect(user).toContain('IMPROVEMENT_TOKEN');
    expect(user).toContain('NOTE_TOKEN');
    expect(user).toContain('IDEAL_TOKEN');
    expect(user).toContain(baseCase.candidateAnswer);
  });

  it('gives the judge the interview question as shared context', async () => {
    mockedJudge.mockResolvedValue({
      text: '{"pass":true,"violations":[]}',
      latencyMs: 100,
    });
    await feedbackFaithfulness({
      output: makeScoringOutput({ technical_feedback: 'x' }),
      test: { vars: baseCase },
    });
    const call = mockedJudge.mock.calls[0]?.[0];
    expect(call?.user ?? '').toContain(baseCase.question);
  });

  it('labels each section so the judge can attribute violations', async () => {
    mockedJudge.mockResolvedValue({
      text: '{"pass":true,"violations":[]}',
      latencyMs: 100,
    });
    await feedbackFaithfulness({
      output: makeScoringOutput({
        technical_feedback: 'tech',
        summary: 'sum',
        question_notes: [{ score: 50, note: 'note-0', ideal: 'ideal-0' }],
      }),
      test: { vars: baseCase },
    });
    const call = mockedJudge.mock.calls[0]?.[0];
    const user = call?.user ?? '';
    expect(user).toContain('[technical_feedback]');
    expect(user).toContain('[summary]');
    expect(user).toContain('[question_notes[0].note]');
    expect(user).toContain('[question_notes[0].ideal]');
  });
});
