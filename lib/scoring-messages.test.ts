import { describe, expect, it } from 'vitest';
import {
  buildScoringMessages,
  buildScoringUserMessage,
  loadScoringSystemPrompt,
} from './scoring-messages.js';
import { makeCase } from '../tests/fixtures.js';

describe('buildScoringUserMessage', () => {
  it('includes category, difficulty, question, and answer', () => {
    const c = makeCase({
      category: 'api-testing',
      difficulty: 'senior',
      question: 'How would you test rate limiting?',
      candidateAnswer: 'I would check the 429 behavior.',
    });
    const user = buildScoringUserMessage(c);
    expect(user).toContain('Category: api-testing');
    expect(user).toContain('Difficulty: senior');
    expect(user).toContain('Question 1: How would you test rate limiting?');
    expect(user).toContain('Candidate answer: I would check the 429 behavior.');
  });

  it('is deterministic for the same case', () => {
    const c = makeCase();
    expect(buildScoringUserMessage(c)).toBe(buildScoringUserMessage(c));
  });
});

describe('loadScoringSystemPrompt', () => {
  it('loads the verbatim prompt snapshot', () => {
    const system = loadScoringSystemPrompt();
    expect(system).toContain('QA engineering candidate');
    expect(system).toContain('question_notes');
  });

  it('is used as the system message in buildScoringMessages', () => {
    const { system, user } = buildScoringMessages(makeCase());
    expect(system).toBe(loadScoringSystemPrompt());
    expect(user).toContain('Transcript:');
  });
});
