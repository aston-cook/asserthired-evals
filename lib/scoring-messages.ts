import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GoldenCase } from './types.js';
import { findRepoRoot } from './repo-root.js';

let cachedSystem: string | null = null;

export function loadScoringSystemPrompt(): string {
  if (cachedSystem !== null) return cachedSystem;
  cachedSystem = readFileSync(
    join(findRepoRoot(), 'prompts', 'scoring-prompt.v1.txt'),
    'utf8',
  );
  return cachedSystem;
}

export type ScoringCaseInput = Pick<
  GoldenCase,
  'category' | 'difficulty' | 'question' | 'candidateAnswer'
>;

export function buildScoringUserMessage(c: ScoringCaseInput): string {
  return `Interview details:
- Category: ${c.category}
- Difficulty: ${c.difficulty}

Transcript:

Question 1: ${c.question}

Candidate answer: ${c.candidateAnswer}`;
}

export interface ScoringMessages {
  system: string;
  user: string;
}

export function buildScoringMessages(c: ScoringCaseInput): ScoringMessages {
  return {
    system: loadScoringSystemPrompt(),
    user: buildScoringUserMessage(c),
  };
}

export function __resetPromptCacheForTests(): void {
  cachedSystem = null;
}
