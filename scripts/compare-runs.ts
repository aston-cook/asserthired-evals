// Trend view over past eval runs (Section 10.2). Reads the *-summary.json files
// the summarizer leaves in reports/ and renders a markdown trend table.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTrendTable } from '../lib/report.js';
import type { RunSummary } from '../lib/report.js';

const DEFAULT_LAST_N = 10;

function parseArgs(argv: string[]): { lastN: number; outDir: string } {
  let lastN = DEFAULT_LAST_N;
  let outDir = 'reports';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--last' && argv[i + 1]) lastN = Number(argv[++i]);
    else if (argv[i] === '--out-dir' && argv[i + 1]) outDir = argv[++i] as string;
  }
  if (!Number.isFinite(lastN) || lastN <= 0) lastN = DEFAULT_LAST_N;
  return { lastN, outDir };
}

function main(): void {
  const { lastN, outDir } = parseArgs(process.argv.slice(2));

  if (!existsSync(outDir)) {
    console.log(`No ${outDir}/ directory found. Run an eval first.`);
    return;
  }

  const summaryFiles = readdirSync(outDir)
    .filter((f) => f.endsWith('-summary.json'))
    .sort();

  const summaries: RunSummary[] = [];
  for (const file of summaryFiles.slice(-lastN)) {
    try {
      summaries.push(
        JSON.parse(readFileSync(join(outDir, file), 'utf8')) as RunSummary,
      );
    } catch (err) {
      console.warn(`Skipping unreadable summary ${file}: ${(err as Error).message}`);
    }
  }

  const table = renderTrendTable(summaries);
  console.log(table);

  const trendPath = join(outDir, 'trend.md');
  writeFileSync(trendPath, table, 'utf8');
  console.log(`\nTrend written to ${trendPath}`);
}

main();
