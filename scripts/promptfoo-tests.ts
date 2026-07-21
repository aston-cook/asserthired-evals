import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GoldenCaseSchema } from '../datasets/golden/_schema.js';
import type { GoldenCase } from '../lib/types.js';
import { findRepoRoot } from '../lib/repo-root.js';

const DATASET_DIRS = ['datasets/golden', 'datasets/adversarial'];

export function loadGoldenCases(
  root: string = findRepoRoot(),
  dirs: readonly string[] = DATASET_DIRS,
): GoldenCase[] {
  const cases: GoldenCase[] = [];
  for (const dir of dirs) {
    const fullDir = join(root, dir);
    if (!existsSync(fullDir)) continue;
    const files = readdirSync(fullDir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort();
    for (const file of files) {
      const contents = readFileSync(join(fullDir, file), 'utf8');
      for (const raw of contents.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.length === 0) continue;
        const parsed = GoldenCaseSchema.safeParse(JSON.parse(line));
        if (!parsed.success) {
          throw new Error(
            `Invalid golden case in ${dir}/${file}: ${parsed.error.message}`,
          );
        }
        cases.push(parsed.data);
      }
    }
  }
  if (cases.length === 0) {
    throw new Error('No golden cases found. Expected .jsonl files in datasets/.');
  }
  return cases;
}

// Array-valued vars would be cartesian-expanded by promptfoo into one test
// per element, so the full case rides along as a JSON string. Scalar fields
// are also exposed directly for the prompt function and result reporting.
export function caseToTest(c: GoldenCase) {
  return {
    description: `${c.id} [${c.category}/${c.difficulty}/${c.expectedTier}]`,
    vars: {
      id: c.id,
      category: c.category,
      difficulty: c.difficulty,
      expectedTier: c.expectedTier,
      question: c.question,
      candidateAnswer: c.candidateAnswer,
      caseJson: JSON.stringify(c),
    },
  };
}

export default async function generateTests() {
  return loadGoldenCases().map(caseToTest);
}
