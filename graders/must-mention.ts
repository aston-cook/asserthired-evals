import { extractJson } from '../lib/json.js';
import { mentions } from '../lib/mention.js';
import { buildLabeledCorpus, flatCorpus } from '../lib/scoring-text.js';
import type { GraderInput, GraderResult } from '../lib/types.js';

export default async function mustMention({
  output,
  test,
}: GraderInput): Promise<GraderResult> {
  const terms = test.vars.mustMention;
  if (terms.length === 0) {
    return { pass: true, score: 1, reason: 'No must-mention terms for this case' };
  }

  const parsed = extractJson(output);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { pass: true, score: 0, reason: 'Malformed output: not valid JSON' };
  }

  const haystack = flatCorpus(buildLabeledCorpus(parsed as Record<string, unknown>));
  const hits = terms.filter((t) => mentions(haystack, t));
  const missed = terms.filter((t) => !mentions(haystack, t));
  const score = hits.length / terms.length;

  return {
    pass: true,
    score,
    reason:
      missed.length === 0
        ? `All ${terms.length} must-mention terms present`
        : `${hits.length}/${terms.length} must-mention terms hit (missed: ${missed.join(', ')})`,
  };
}
