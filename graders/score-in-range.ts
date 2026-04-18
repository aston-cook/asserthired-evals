import { extractJson } from '../lib/json.js';
import type { GraderInput, GraderResult } from '../lib/types.js';

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

  const maybe = parsed as { score?: unknown };
  if (typeof maybe.score !== 'number') {
    return {
      pass: false,
      score: 0,
      reason: 'Malformed output: missing numeric "score" field',
    };
  }

  const [min, max] = test.vars.expectedScoreRange;
  const pass = maybe.score >= min && maybe.score <= max;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `Score ${maybe.score} in range [${min}, ${max}]`
      : `Score ${maybe.score} outside [${min}, ${max}]`,
  };
}
