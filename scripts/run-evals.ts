// Eval runner. Orchestrates:
//   1. A promptfoo eval over the golden dataset (scoring calls + graders)
//   2. The score-consistency sampler (Section 6.2): N cases x M repeat calls
//   3. Report generation with threshold gates (scripts/summarize-run.ts)
//
// Modes:
//   pnpm eval             full run against the real Anthropic API (costs money)
//   pnpm eval:smoke       zero-API-call smoke run with the mock provider
//   pnpm eval -- --first 3      real run limited to the first 3 cases
//   pnpm eval -- --consistency  also run the consistency sampler (adds 50 calls)

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { judge, ModelRefusalError } from '../lib/claude-client.js';
import {
  BASELINE_SCORING_TEMPERATURE,
  SCORING_ANSWER_TOKENS,
  SCORING_EFFORT,
  SCORING_MODEL,
} from '../lib/models.js';
import { computeOverallScore, ScoringOutputSchema } from '../lib/types.js';
import { extractJson } from '../lib/json.js';
import { buildScoringMessages } from '../lib/scoring-messages.js';
import { findRepoRoot } from '../lib/repo-root.js';
import { mean, stddev } from '../lib/report.js';
import type { ConsistencyData } from '../lib/report.js';
import { loadGoldenCases } from './promptfoo-tests.js';
import type { GoldenCase } from '../lib/types.js';
import { summarize } from './summarize-run.js';

const CONSISTENCY_SAMPLE_SIZE = 10;
const CONSISTENCY_RUNS_PER_CASE = 5;
const CONSISTENCY_CONCURRENCY = 4;

interface CliOptions {
  smoke: boolean;
  consistency: boolean;
  first?: number;
  config?: string;
  outDir?: string;
}

function parseArgs(argv: string[]): CliOptions {
  // The consistency sampler is opt-in: it adds 50 scoring calls per run, and
  // measured variance has been near zero (stddev 0.09 to 0.31 across baselines).
  const options: CliOptions = { smoke: false, consistency: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--smoke') options.smoke = true;
    else if (arg === '--consistency') options.consistency = true;
    else if (arg === '--first' && argv[i + 1]) options.first = Number(argv[++i]);
    else if (arg === '--config' && argv[i + 1]) options.config = argv[++i] as string;
    else if (arg === '--out-dir' && argv[i + 1]) options.outDir = argv[++i] as string;
  }
  return options;
}

function loadDotEnv(root: string): void {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Overrides the consistency sampler only. The promptfoo pass takes its model
// from the provider block in the promptfoo config.
function scoringModel(): string {
  return process.env['EVAL_SCORING_MODEL'] ?? SCORING_MODEL;
}

async function runPool<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    async () => {
      for (;;) {
        const index = next++;
        if (index >= tasks.length) break;
        const task = tasks[index] as () => Promise<T>;
        results[index] = await task();
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function sampleConsistencyCases(cases: GoldenCase[]): GoldenCase[] {
  const golden = cases
    .filter((c) => !c.id.startsWith('probe-'))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (golden.length <= CONSISTENCY_SAMPLE_SIZE) return golden;
  const stride = Math.floor(golden.length / CONSISTENCY_SAMPLE_SIZE);
  const sampled: GoldenCase[] = [];
  for (let i = 0; i < CONSISTENCY_SAMPLE_SIZE; i++) {
    sampled.push(golden[i * stride] as GoldenCase);
  }
  return sampled;
}

// Same request shape as the promptfoo provider block. The temperature only
// reaches legacy models (EVAL_SCORING_MODEL=claude-sonnet-4-5 reproduces the
// v1 baselines); adaptive models reject it, so requestShape drops it.
async function scoreOnce(c: GoldenCase): Promise<number | 'refused' | null> {
  const { system, user } = buildScoringMessages(c);
  let text: string;
  try {
    ({ text } = await judge({
      system,
      user,
      model: scoringModel(),
      maxTokens: SCORING_ANSWER_TOKENS,
      effort: SCORING_EFFORT,
      temperature: BASELINE_SCORING_TEMPERATURE,
    }));
  } catch (err) {
    if (err instanceof ModelRefusalError) return 'refused';
    throw err;
  }
  const parsed = ScoringOutputSchema.safeParse(extractJson(text));
  if (!parsed.success) return null;
  return computeOverallScore(parsed.data);
}

async function runConsistency(): Promise<ConsistencyData> {
  const sampled = sampleConsistencyCases(loadGoldenCases());
  console.log(
    `\nConsistency sampler: ${sampled.length} cases x ${CONSISTENCY_RUNS_PER_CASE} runs on ${scoringModel()}`,
  );

  const tasks: Array<() => Promise<{ id: string; score: number | 'refused' | null }>> = [];
  for (const c of sampled) {
    for (let run = 0; run < CONSISTENCY_RUNS_PER_CASE; run++) {
      tasks.push(async () => ({ id: c.id, score: await scoreOnce(c) }));
    }
  }

  const outcomes = await runPool(tasks, CONSISTENCY_CONCURRENCY);
  const byCase = new Map<string, number[]>();
  let parseFailures = 0;
  let refusals = 0;
  for (const { id, score } of outcomes) {
    if (score === null) {
      parseFailures += 1;
      continue;
    }
    if (score === 'refused') {
      refusals += 1;
      continue;
    }
    const list = byCase.get(id) ?? [];
    list.push(score);
    byCase.set(id, list);
  }
  if (parseFailures > 0) {
    console.warn(
      `Consistency sampler: ${parseFailures} response(s) failed schema parsing and were excluded`,
    );
  }
  if (refusals > 0) {
    console.warn(
      `Consistency sampler: ${refusals} request(s) were declined by the model's safety classifiers and were excluded`,
    );
  }

  return {
    model: scoringModel(),
    runsPerCase: CONSISTENCY_RUNS_PER_CASE,
    cases: sampled.map((c) => {
      const scores = byCase.get(c.id) ?? [];
      return { id: c.id, scores, mean: mean(scores), stddev: stddev(scores) };
    }),
  };
}

function runPromptfoo(configPath: string, rawPath: string, first?: number): void {
  const args = [
    'exec',
    'promptfoo',
    'eval',
    '-c',
    configPath,
    '-o',
    rawPath,
    '--no-cache',
    '--max-concurrency',
    '4',
  ];
  if (first !== undefined && Number.isFinite(first) && first > 0) {
    args.push('--filter-first-n', String(first));
  }
  console.log(`Running: pnpm ${args.join(' ')}\n`);
  const spawnOptions = {
    stdio: 'inherit' as const,
    env: {
      ...process.env,
      PROMPTFOO_DISABLE_TELEMETRY: '1',
      PROMPTFOO_DISABLE_UPDATE: '1',
    },
  };
  // pnpm is a .cmd shim on Windows, which Node only spawns through a shell.
  // Passing an args array alongside shell: true is deprecated (DEP0190), so the
  // Windows path builds one command string. The command name stays unquoted:
  // quoting it breaks the shim's %~dp0 lookup of its own directory.
  const quote = (a: string): string => (/[\s"&|<>^]/.test(a) ? `"${a}"` : a);
  const result =
    process.platform === 'win32'
      ? spawnSync(['pnpm', ...args.map(quote)].join(' '), { ...spawnOptions, shell: true })
      : spawnSync('pnpm', args, spawnOptions);
  // promptfoo exits 100 when assertions fail; thresholds are enforced by the
  // summarizer. Its logger can also crash the process on Windows after the
  // output file is already written, so any exit code is tolerated as long as
  // the output file exists and parses.
  if (!existsSync(rawPath)) {
    throw new Error(
      `promptfoo eval exited with status ${result.status} and produced no output at ${rawPath}`,
    );
  }
  if (result.status !== 0 && result.status !== 100) {
    console.warn(
      `promptfoo exited with unexpected status ${result.status}, but output exists; continuing with the report.`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const root = findRepoRoot();
  process.chdir(root);
  loadDotEnv(root);

  if (!options.smoke && !process.env['ANTHROPIC_API_KEY']) {
    console.error(
      'ANTHROPIC_API_KEY is not set. Real eval runs call the Anthropic API.\n' +
        'Set the key in .env or the environment, or use `pnpm eval:smoke` for a zero-API smoke run.',
    );
    process.exit(2);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Smoke runs land in their own directory so the trend, drift, and review
  // tooling over reports/ only ever sees live-run summaries.
  const outDir = options.outDir ?? (options.smoke ? 'reports/smoke' : 'reports');
  mkdirSync(outDir, { recursive: true });

  const configPath =
    options.config ?? (options.smoke ? 'promptfooconfig.mock.yaml' : 'promptfooconfig.yaml');
  const rawPath = join(outDir, `${timestamp}-raw.json`);

  runPromptfoo(configPath, rawPath, options.first);

  let consistencyPath: string | undefined;
  if (!options.smoke && options.consistency) {
    const consistency = await runConsistency();
    consistencyPath = join(outDir, `${timestamp}-consistency.json`);
    writeFileSync(consistencyPath, JSON.stringify(consistency, null, 2), 'utf8');
  }

  const summarizeOptions: Parameters<typeof summarize>[0] = {
    rawPath,
    outDir,
    timestamp,
  };
  if (consistencyPath !== undefined) summarizeOptions.consistencyPath = consistencyPath;
  const result = summarize(summarizeOptions);

  console.log(`\n${result.markdown}`);
  console.log(`\nReport written to ${result.markdownPath}`);
  console.log(`Summary JSON written to ${result.summaryJsonPath}`);

  if (result.evaluation.hardFailures.length > 0) {
    console.error('\nEval run FAILED hard thresholds.');
    process.exit(1);
  }
  console.log('\nEval run passed all hard thresholds.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
