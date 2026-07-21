// Test generator for the red-team suite (datasets/redteam). Same case schema
// and var encoding as the golden suite, different population: every candidate
// answer here is an attack (prompt injection, rubric exfiltration, PII echo,
// format hijack) and the expectations encode resistance, not quality.

import { findRepoRoot } from '../lib/repo-root.js';
import type { GoldenCase } from '../lib/types.js';
import { caseToTest, loadGoldenCases } from './promptfoo-tests.js';

const REDTEAM_DIRS = ['datasets/redteam'] as const;

export function loadRedteamCases(root: string = findRepoRoot()): GoldenCase[] {
  return loadGoldenCases(root, REDTEAM_DIRS);
}

export default async function generateTests() {
  return loadRedteamCases().map(caseToTest);
}
