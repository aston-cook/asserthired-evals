// Review queue CLI (lib/review-queue.ts). Flags cases that failed their
// expectedScoreRange repeatedly across recent runs and writes a human review
// queue. Reads only local report summaries; makes no API calls.
//
//   pnpm review:queue                 last 5 runs, flag at 2+ misses
//   pnpm review:queue -- --window 10  widen the run window
//   pnpm review:queue -- --min 3      require 3 misses before flagging

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReviewQueue, renderReviewQueue } from '../lib/review-queue.js';
import { loadSummaries } from '../lib/run-summaries.js';

interface CliOptions {
  dir: string;
  window: number;
  minOccurrences: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dir: 'reports', window: 5, minOccurrences: 2 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir' && argv[i + 1]) options.dir = argv[++i] as string;
    else if (arg === '--window' && argv[i + 1]) options.window = Number(argv[++i]);
    else if (arg === '--min' && argv[i + 1]) options.minOccurrences = Number(argv[++i]);
  }
  if (!Number.isFinite(options.window) || options.window <= 0) options.window = 5;
  if (!Number.isFinite(options.minOccurrences) || options.minOccurrences <= 0) {
    options.minOccurrences = 2;
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summaries = loadSummaries(options.dir);

  const queue = buildReviewQueue(summaries, {
    window: options.window,
    minOccurrences: options.minOccurrences,
  });
  const report = renderReviewQueue(queue);
  console.log(report);

  if (existsSync(options.dir)) {
    const outPath = join(options.dir, 'review-queue.md');
    writeFileSync(outPath, report, 'utf8');
    console.log(`\nReview queue written to ${outPath}`);
  }
}

main();
