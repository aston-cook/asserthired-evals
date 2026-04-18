import { extractJson } from '../lib/json.js';
import { mentions } from '../lib/mention.js';
import { buildLabeledCorpus, flatCorpus } from '../lib/scoring-text.js';
import type { GraderInput, GraderResult } from '../lib/types.js';

export default async function mustNotMention({
  output,
  test,
}: GraderInput): Promise<GraderResult> {
  const terms = test.vars.mustNotMention;
  if (terms.length === 0) {
    return { pass: true, score: 1, reason: 'No must-not-mention terms for this case' };
  }

  const parsed = extractJson(output);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { pass: false, score: 0, reason: 'Malformed output: not valid JSON' };
  }

  const haystack = flatCorpus(buildLabeledCorpus(parsed as Record<string, unknown>));
  const violations = terms.filter((t) => mentions(haystack, t));
  const pass = violations.length === 0;

  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'No must-not-mention terms found'
      : `Violations found: ${violations.join(', ')}`,
  };
}
