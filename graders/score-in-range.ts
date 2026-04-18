import { extractJson } from '../lib/json.js';
import { computeOverallScore } from '../lib/types.js';
import type { GraderInput, GraderResult } from '../lib/types.js';

const DIM_KEYS = [
  'technical_score',
  'communication_score',
  'examples_score',
  'depth_score',
] as const;

export default async function scoreInRange({
  output,
  test,
}: GraderInput): Promise<GraderResult> {
  const parsed = extractJson(output);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      pass: false,
      score: 0,
      reason: 'Malformed output: not valid JSON',
    };
  }

  const obj = parsed as Record<string, unknown>;
  const missing = DIM_KEYS.filter((k) => typeof obj[k] !== 'number');
  if (missing.length > 0) {
    return {
      pass: false,
      score: 0,
      reason: `Malformed output: missing or non-numeric dimension scores: ${missing.join(', ')}`,
    };
  }

  const dims = {
    technical_score: obj['technical_score'] as number,
    communication_score: obj['communication_score'] as number,
    examples_score: obj['examples_score'] as number,
    depth_score: obj['depth_score'] as number,
  };
  const overall = computeOverallScore(dims);

  const [min, max] = test.vars.expectedScoreRange;
  const pass = overall >= min && overall <= max;
  const breakdown = `t=${dims.technical_score} c=${dims.communication_score} e=${dims.examples_score} d=${dims.depth_score}`;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `Overall ${overall} in range [${min}, ${max}] (${breakdown})`
      : `Overall ${overall} outside [${min}, ${max}] (${breakdown})`,
  };
}
