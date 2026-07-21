// Drift detection CLI. Compares the newest run summary in reports/ against a
// rolling baseline of the runs before it (lib/drift.ts). Manual-only by design:
// there is no cron anywhere in this repo, so this runs when a human runs it.
//
//   pnpm eval:drift                     report only
//   pnpm eval:drift -- --fail-on-drift  exit 1 if any metric regressed
//   pnpm eval:drift -- --window 8       widen the rolling baseline
//   pnpm eval:drift -- --k 3            require 3 baseline stddevs to flag

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectDrift, renderDriftReport } from '../lib/drift.js';
import { loadSummaries } from '../lib/run-summaries.js';

interface CliOptions {
  dir: string;
  window: number;
  stddevMultiplier: number;
  failOnDrift: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dir: 'reports',
    window: 5,
    stddevMultiplier: 2,
    failOnDrift: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir' && argv[i + 1]) options.dir = argv[++i] as string;
    else if (arg === '--window' && argv[i + 1]) options.window = Number(argv[++i]);
    else if (arg === '--k' && argv[i + 1]) options.stddevMultiplier = Number(argv[++i]);
    else if (arg === '--fail-on-drift') options.failOnDrift = true;
  }
  if (!Number.isFinite(options.window) || options.window <= 0) options.window = 5;
  if (!Number.isFinite(options.stddevMultiplier) || options.stddevMultiplier <= 0) {
    options.stddevMultiplier = 2;
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summaries = loadSummaries(options.dir);

  const outcome = detectDrift(summaries, {
    window: options.window,
    stddevMultiplier: options.stddevMultiplier,
  });
  const report = renderDriftReport(outcome);
  console.log(report);

  if (existsSync(options.dir)) {
    const outPath = join(options.dir, 'drift.md');
    writeFileSync(outPath, report, 'utf8');
    console.log(`\nDrift report written to ${outPath}`);
  }

  if (options.failOnDrift && outcome.ok && outcome.regressions.length > 0) {
    console.error('\nDrift check FAILED: at least one metric regressed beyond baseline noise.');
    process.exit(1);
  }
}

main();
