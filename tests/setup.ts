import { vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  class GuardedAnthropic {
    constructor() {
      throw new Error(
        'Real Anthropic client instantiated during tests. Either mock lib/claude-client.js in your test file, or override the @anthropic-ai/sdk mock locally.'
      );
    }
  }
  return { default: GuardedAnthropic };
});
