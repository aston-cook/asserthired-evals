import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  isAdaptiveModel,
  requestShape,
  SCORING_ANSWER_TOKENS,
  SCORING_EFFORT,
  SCORING_MODEL,
} from './models.js';
import { findRepoRoot } from './repo-root.js';

describe('isAdaptiveModel', () => {
  it.each([
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-opus-5-5',
    'claude-sonnet-5',
    'claude-opus-5',
    'claude-fable-5-1',
    'claude-opus-4-8',
    'claude-opus-4-7',
  ])('treats %s as adaptive', (model) => {
    expect(isAdaptiveModel(model)).toBe(true);
  });

  it.each([
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-6',
    'claude-opus-4-6',
  ])('treats %s as legacy', (model) => {
    expect(isAdaptiveModel(model)).toBe(false);
  });
});

describe('requestShape', () => {
  it('adds thinking headroom on top of the answer budget for adaptive models', () => {
    expect(requestShape('claude-sonnet-5-5', { answerTokens: 2000, effort: 'medium' })).toEqual({
      max_tokens: 6000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
    });
    expect(requestShape('claude-haiku-5-5', { answerTokens: 1024, effort: 'low' })).toMatchObject({
      max_tokens: 3024,
    });
  });

  it('drops temperature on adaptive models, which reject non-default values', () => {
    const shape = requestShape('claude-haiku-5-5', {
      answerTokens: 1024,
      effort: 'low',
      temperature: 0.2,
    });
    expect(shape).not.toHaveProperty('temperature');
  });

  it('keeps the plain v1 shape for legacy models', () => {
    expect(
      requestShape('claude-sonnet-4-5', { answerTokens: 2000, effort: 'medium', temperature: 0.2 }),
    ).toEqual({ max_tokens: 2000, temperature: 0.2 });
    expect(requestShape('claude-haiku-4-5', { answerTokens: 1024, effort: 'low' })).toEqual({
      max_tokens: 1024,
    });
  });
});

// The promptfoo configs cannot import lib/models.ts, so this keeps their
// provider blocks and the consistency sampler on the same request shape.
describe.each(['promptfooconfig.yaml', 'promptfooconfig.redteam.yaml'])(
  '%s provider block',
  (file) => {
    const yaml = readFileSync(join(findRepoRoot(), file), 'utf8');
    const expected = requestShape(SCORING_MODEL, {
      answerTokens: SCORING_ANSWER_TOKENS,
      effort: SCORING_EFFORT,
    });

    it('targets the scoring model', () => {
      expect(yaml).toContain(`id: anthropic:messages:${SCORING_MODEL}`);
    });

    it('matches the scoring effort and max_tokens', () => {
      expect(yaml).toMatch(/thinking:\s*\r?\n\s+type: adaptive/);
      expect(yaml).toContain(`effort: ${SCORING_EFFORT}`);
      expect(yaml).toContain(`max_tokens: ${expected.max_tokens}`);
    });

    it('sends no sampling parameters', () => {
      expect(yaml).not.toMatch(/^\s*(temperature|top_p|top_k):/m);
    });
  },
);
