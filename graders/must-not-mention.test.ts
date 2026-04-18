import { describe, it, expect } from 'vitest';
import mustNotMention from './must-not-mention.js';
import { makeCase, makeScoringOutput } from '../tests/fixtures.js';

const caseWithForbidden = makeCase({
  mustNotMention: ['strong response', 'unit testing the backend database'],
});

describe('must-not-mention', () => {
  it('passes when no forbidden terms appear', async () => {
    const output = makeScoringOutput({ feedback: 'Reasonable coverage of test design techniques.' });
    const result = await mustNotMention({ output, test: { vars: caseWithForbidden } });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('fails when a forbidden term appears in feedback', async () => {
    const output = makeScoringOutput({ feedback: 'This is a strong response overall.' });
    const result = await mustNotMention({ output, test: { vars: caseWithForbidden } });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('strong response');
  });

  it('fails when a forbidden term appears in strengths or improvements', async () => {
    const output = makeScoringOutput({
      improvements: ['Unit testing the backend database would help.'],
    });
    const result = await mustNotMention({ output, test: { vars: caseWithForbidden } });
    expect(result.pass).toBe(false);
  });

  it('is case-insensitive', async () => {
    const output = makeScoringOutput({ feedback: 'Overall a STRONG RESPONSE.' });
    const result = await mustNotMention({ output, test: { vars: caseWithForbidden } });
    expect(result.pass).toBe(false);
  });

  it('documented substring behavior: forbidden term matches even when negated in context', async () => {
    const output = makeScoringOutput({
      feedback: 'A strong response was not demonstrated here.',
    });
    const result = await mustNotMention({ output, test: { vars: caseWithForbidden } });
    expect(result.pass).toBe(false);
  });

  it('passes when no forbidden terms are defined', async () => {
    const empty = makeCase({ mustNotMention: [] });
    const result = await mustNotMention({
      output: makeScoringOutput({ feedback: 'anything' }),
      test: { vars: empty },
    });
    expect(result.pass).toBe(true);
  });

  it('fails cleanly on malformed output', async () => {
    const result = await mustNotMention({ output: 'not json', test: { vars: caseWithForbidden } });
    expect(result.pass).toBe(false);
    expect(result.reason.toLowerCase()).toContain('malformed');
  });

  it('handles JSON wrapped in a code fence', async () => {
    const fenced = '```json\n' + makeScoringOutput({ feedback: 'clean feedback' }) + '\n```';
    const result = await mustNotMention({ output: fenced, test: { vars: caseWithForbidden } });
    expect(result.pass).toBe(true);
  });
});
