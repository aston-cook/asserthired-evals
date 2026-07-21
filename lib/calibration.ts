// Judge-the-judge calibration (roadmap item from v1). The faithfulness judge
// is itself an LLM, so its verdicts need ground truth: a small hand-labeled
// set of scoring outputs with known planted violations (and known-clean cases,
// including the tricky ones that historically drew false positives). Scoring
// the judge against the labels yields precision and recall for the judge
// itself, which is what makes its suite-level numbers trustworthy.

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ScoringOutputSchema } from './types.js';

export const LabeledFaithfulnessCaseSchema = z.object({
  id: z.string(),
  question: z.string(),
  candidateAnswer: z.string(),
  feedback: ScoringOutputSchema,
  // Each entry is one planted ungrounded claim. mustMatch is a substring the
  // judge's flagged claim text must contain (matched after normalization).
  expectedViolations: z.array(
    z.object({
      mustMatch: z.string(),
      note: z.string().optional(),
    }),
  ),
  notes: z.string().optional(),
});

export type LabeledFaithfulnessCase = z.infer<typeof LabeledFaithfulnessCaseSchema>;

export function loadLabeledCases(path: string): LabeledFaithfulnessCase[] {
  const cases: LabeledFaithfulnessCase[] = [];
  const seen = new Set<string>();
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line.length === 0) return;
    const parsed = LabeledFaithfulnessCaseSchema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      throw new Error(`Invalid labeled case at ${path}:${i + 1}: ${parsed.error.message}`);
    }
    if (seen.has(parsed.data.id)) {
      throw new Error(`Duplicate labeled case id "${parsed.data.id}" at ${path}:${i + 1}`);
    }
    seen.add(parsed.data.id);
    cases.push(parsed.data);
  });
  if (cases.length === 0) {
    throw new Error(`No labeled cases found in ${path}`);
  }
  return cases;
}

// Mirrors the normalization in lib/mention.ts so matching is insensitive to
// case, punctuation, and whitespace.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface JudgedCase {
  id: string;
  // Claim strings the judge flagged as ungrounded for this case.
  flaggedClaims: string[];
}

export interface CaseCalibration {
  id: string;
  // Claim-level: the individual claims the judge flagged, split by correctness.
  truePositives: string[];
  falsePositives: string[];
  // Violation-level: how many distinct planted violations this case's claims
  // covered. A single planted violation cited by two claims counts once here
  // but twice in truePositives, which is why precision and recall use
  // different units below.
  violationsMatched: number;
  missedViolations: string[];
}

export interface CalibrationResult {
  perCase: CaseCalibration[];
  // Labeled cases with no verdict (judge errored); excluded from the metrics.
  unjudged: string[];
  // Precision is claim-level: of the claims the judge raised, how many were
  // real violations. truePositives/falsePositives count claims.
  truePositives: number;
  falsePositives: number;
  // Recall is violation-level: of the planted violations, how many the judge
  // caught. violationsFound counts distinct violations, not claims, so a judge
  // that restates one violation twice cannot inflate its own recall.
  violationsFound: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

function claimMatches(claim: string, mustMatch: string): boolean {
  const c = normalize(claim);
  const m = normalize(mustMatch);
  if (c.length === 0 || m.length === 0) return false;
  return c.includes(m) || m.includes(c);
}

export function scoreJudgeVerdicts(
  cases: LabeledFaithfulnessCase[],
  judged: JudgedCase[],
): CalibrationResult {
  const judgedById = new Map(judged.map((j) => [j.id, j]));
  const perCase: CaseCalibration[] = [];
  const unjudged: string[] = [];

  for (const labeled of cases) {
    const verdict = judgedById.get(labeled.id);
    if (!verdict) {
      unjudged.push(labeled.id);
      continue;
    }

    const truePositives: string[] = [];
    const falsePositives: string[] = [];
    const matchedExpected = new Set<number>();

    for (const claim of verdict.flaggedClaims) {
      const expectedIndex = labeled.expectedViolations.findIndex((expected) =>
        claimMatches(claim, expected.mustMatch),
      );
      if (expectedIndex >= 0) {
        truePositives.push(claim);
        matchedExpected.add(expectedIndex);
      } else {
        falsePositives.push(claim);
      }
    }

    const missedViolations = labeled.expectedViolations
      .filter((_, i) => !matchedExpected.has(i))
      .map((expected) => expected.mustMatch);

    perCase.push({
      id: labeled.id,
      truePositives,
      falsePositives,
      violationsMatched: matchedExpected.size,
      missedViolations,
    });
  }

  const truePositives = perCase.reduce((n, c) => n + c.truePositives.length, 0);
  const falsePositives = perCase.reduce((n, c) => n + c.falsePositives.length, 0);
  const violationsFound = perCase.reduce((n, c) => n + c.violationsMatched, 0);
  const falseNegatives = perCase.reduce((n, c) => n + c.missedViolations.length, 0);

  // Precision on claims (did the judge's flags land), recall on violations
  // (did it catch each distinct planted issue). Mixing the two units would let
  // a duplicated true positive inflate recall.
  const precision =
    truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives);
  const recall =
    violationsFound + falseNegatives === 0 ? 1 : violationsFound / (violationsFound + falseNegatives);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    perCase,
    unjudged,
    truePositives,
    falsePositives,
    violationsFound,
    falseNegatives,
    precision,
    recall,
    f1,
  };
}

export function renderCalibrationReport(
  result: CalibrationResult,
  meta: { model: string; datasetPath: string },
): string {
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push('# Faithfulness judge calibration');
  lines.push('');
  lines.push(`Judge model: \`${meta.model}\``);
  lines.push(`Labeled set: \`${meta.datasetPath}\` (${result.perCase.length} judged case(s))`);
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Precision | ${pct(result.precision)} (${result.truePositives} TP, ${result.falsePositives} FP) |`);
  lines.push(`| Recall | ${pct(result.recall)} (${result.falseNegatives} missed) |`);
  lines.push(`| F1 | ${pct(result.f1)} |`);
  lines.push('');

  lines.push('| Case | Planted found | False alarms | Missed |');
  lines.push('|---|---|---|---|');
  for (const c of result.perCase) {
    lines.push(
      `| \`${c.id}\` | ${c.violationsMatched} | ${c.falsePositives.length} | ${c.missedViolations.length} |`,
    );
  }

  const detail = result.perCase.filter(
    (c) => c.falsePositives.length > 0 || c.missedViolations.length > 0,
  );
  if (detail.length > 0) {
    lines.push('');
    lines.push('## Detail');
    lines.push('');
    for (const c of detail) {
      lines.push(`### \`${c.id}\``);
      for (const fp of c.falsePositives) lines.push(`- False alarm: "${fp}"`);
      for (const miss of c.missedViolations) lines.push(`- Missed planted violation: "${miss}"`);
      lines.push('');
    }
  }

  if (result.unjudged.length > 0) {
    lines.push('');
    lines.push(`Unjudged (judge errored, excluded from metrics): ${result.unjudged.join(', ')}`);
  }

  return lines.join('\n');
}
