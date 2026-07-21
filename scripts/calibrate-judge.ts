// Judge calibration CLI (lib/calibration.ts). Runs the faithfulness judge
// over the hand-labeled set and reports the judge's own precision and recall.
//
// PAID: this makes one judge call per labeled case (currently 10) against the
// Anthropic API. With the default Haiku judge that is a few cents per run.
// It refuses to run without both ANTHROPIC_API_KEY and an explicit --yes.
//
//   pnpm calibrate:judge            print what would run, then stop
//   pnpm calibrate:judge -- --yes   actually call the API

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFaithfulnessJudge } from '../graders/feedback-faithfulness.js';
import {
  loadLabeledCases,
  renderCalibrationReport,
  scoreJudgeVerdicts,
} from '../lib/calibration.js';
import type { JudgedCase } from '../lib/calibration.js';
import { defaultModel } from '../lib/claude-client.js';
import { findRepoRoot } from '../lib/repo-root.js';

const DATASET_PATH = 'datasets/calibration/faithfulness-labeled.jsonl';

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

async function main(): Promise<void> {
  const root = findRepoRoot();
  process.chdir(root);
  loadDotEnv(root);

  const confirmed = process.argv.slice(2).includes('--yes');
  const cases = loadLabeledCases(DATASET_PATH);
  const planted = cases.reduce((n, c) => n + c.expectedViolations.length, 0);

  console.log(
    `Labeled set: ${cases.length} case(s), ${planted} planted violation(s), judge model ${defaultModel()}.`,
  );

  if (!confirmed) {
    console.log(
      `\nThis run would make ${cases.length} paid judge calls. Re-run with --yes to proceed:\n  pnpm calibrate:judge -- --yes`,
    );
    return;
  }
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error('ANTHROPIC_API_KEY is not set. Set it in .env or the environment.');
    process.exit(2);
  }

  const judged: JudgedCase[] = [];
  for (const c of cases) {
    process.stdout.write(`Judging ${c.id}... `);
    try {
      const { verdict, raw } = await runFaithfulnessJudge({
        question: c.question,
        candidateAnswer: c.candidateAnswer,
        scoringOutput: c.feedback as unknown as Record<string, unknown>,
      });
      if (!verdict) {
        console.log(`malformed judge output: ${raw.slice(0, 120)}`);
        continue;
      }
      judged.push({
        id: c.id,
        flaggedClaims: verdict.violations.map((v) => v.claim ?? v.reason),
      });
      console.log(`${verdict.violations.length} claim(s) flagged`);
    } catch (err) {
      console.log(`error: ${(err as Error).message}`);
    }
  }

  const result = scoreJudgeVerdicts(cases, judged);
  const report = renderCalibrationReport(result, {
    model: defaultModel(),
    datasetPath: DATASET_PATH,
  });

  mkdirSync('reports', { recursive: true });
  const outPath = join('reports', 'judge-calibration.md');
  writeFileSync(outPath, report, 'utf8');

  console.log(`\n${report}`);
  console.log(`\nCalibration report written to ${outPath}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
