import { extractJson } from '../lib/json.js';
import { mentions } from '../lib/mention.js';
import type { GraderInput, GraderResult } from '../lib/types.js';

function buildHaystack(parsed: {
  feedback?: unknown;
  strengths?: unknown;
  improvements?: unknown;
}): string {
  return [
    typeof parsed.feedback === 'string' ? parsed.feedback : '',
    Array.isArray(parsed.strengths) ? parsed.strengths.join(' ') : '',
    Array.isArray(parsed.improvements) ? parsed.improvements.join(' ') : '',
  ].join(' ');
}

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

  const haystack = buildHaystack(parsed as Record<string, unknown>);
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
