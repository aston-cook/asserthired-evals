// Shared loader for the *-summary.json files the summarizer writes to
// reports/. Used by the trend, drift, and review-queue CLIs.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunSummary } from './report.js';

export function loadSummaries(dir: string): RunSummary[] {
  if (!existsSync(dir)) return [];
  const summaries: RunSummary[] = [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('-summary.json'))
    .sort();
  for (const file of files) {
    try {
      summaries.push(JSON.parse(readFileSync(join(dir, file), 'utf8')) as RunSummary);
    } catch (err) {
      console.warn(`Skipping unreadable summary ${file}: ${(err as Error).message}`);
    }
  }
  return summaries;
}
