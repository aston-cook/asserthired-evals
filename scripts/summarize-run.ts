import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  extractCaseResults,
  evaluateThresholds,
  renderMarkdownReport,
  summarizeRun,
} from '../lib/report.js';
import type { ConsistencyData, RunSummary, ThresholdEvaluation } from '../lib/report.js';

export interface SummarizeOptions {
  rawPath: string;
  consistencyPath?: string;
  outDir?: string;
  timestamp?: string;
}

export interface SummarizeResult {
  summary: RunSummary;
  evaluation: ThresholdEvaluation;
  markdown: string;
  markdownPath: string;
  summaryJsonPath: string;
}

export function summarize(options: SummarizeOptions): SummarizeResult {
  const outDir = options.outDir ?? 'reports';
  const timestamp =
    options.timestamp ?? new Date().toISOString().replace(/[:.]/g, '-');

  const raw = JSON.parse(readFileSync(options.rawPath, 'utf8')) as unknown;
  let consistency: ConsistencyData | null = null;
  if (options.consistencyPath && existsSync(options.consistencyPath)) {
    consistency = JSON.parse(
      readFileSync(options.consistencyPath, 'utf8'),
    ) as ConsistencyData;
  }

  const cases = extractCaseResults(raw);
  const summary = summarizeRun({ timestamp, cases, consistency });
  const evaluation = evaluateThresholds(summary);
  const markdown = renderMarkdownReport(summary, evaluation);

  mkdirSync(outDir, { recursive: true });
  const markdownPath = join(outDir, `${timestamp}.md`);
  const summaryJsonPath = join(outDir, `${timestamp}-summary.json`);
  writeFileSync(markdownPath, markdown, 'utf8');
  writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2), 'utf8');

  return { summary, evaluation, markdown, markdownPath, summaryJsonPath };
}

function parseArgs(argv: string[]): SummarizeOptions {
  const options: SummarizeOptions = { rawPath: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) options.rawPath = argv[++i] as string;
    else if (arg === '--consistency' && argv[i + 1])
      options.consistencyPath = argv[++i] as string;
    else if (arg === '--out-dir' && argv[i + 1]) options.outDir = argv[++i] as string;
    else if (arg === '--timestamp' && argv[i + 1])
      options.timestamp = argv[++i] as string;
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (!options.rawPath) {
    console.error(
      'Usage: tsx scripts/summarize-run.ts --input <promptfoo-output.json> [--consistency <consistency.json>] [--out-dir reports] [--timestamp <label>]',
    );
    process.exit(2);
  }

  const result = summarize(options);
  console.log(result.markdown);
  console.log(`\nReport written to ${result.markdownPath}`);
  console.log(`Summary JSON written to ${result.summaryJsonPath}`);
  if (result.evaluation.hardFailures.length > 0) process.exit(1);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
