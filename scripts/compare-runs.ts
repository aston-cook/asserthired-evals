// Trend view over past eval runs (Section 10.2). Reads the *-summary.json files
// the summarizer leaves in reports/ and renders a markdown trend table.

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTrendTable } from '../lib/report.js';
import { loadSummaries } from '../lib/run-summaries.js';

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

  const summaries = loadSummaries(outDir).slice(-lastN);
  const table = renderTrendTable(summaries);
  console.log(table);

  const trendPath = join(outDir, 'trend.md');
  writeFileSync(trendPath, table, 'utf8');
  console.log(`\nTrend written to ${trendPath}`);
}

main();
