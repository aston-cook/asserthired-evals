import { judge } from '../lib/claude-client.js';
import { extractJson } from '../lib/json.js';
import { buildLabeledCorpus, formatLabeledCorpus } from '../lib/scoring-text.js';
import type {
  GraderInput,
  GraderResult,
  JudgeVerdict,
  JudgeViolation,
} from '../lib/types.js';

const SYSTEM = `You are a strict evaluator checking whether interview-scoring feedback is faithful to the candidate's answer.

The scoring output is structured as labeled sections, one per named field: four dimension feedback strings (technical_feedback, communication_feedback, examples_feedback, depth_feedback), a summary, a top_strength, a main_improvement, and per-question notes (note and ideal pairs). Evaluate every labeled section together against the interview question and the candidate's answer. When you flag a claim, name the section it came from in the "field" attribute.

A claim is "ungrounded" if it asserts a specific fact about the candidate's answer (what they said, mentioned, demonstrated, or missed) that is not supported by any span of text in the answer. For each claim you flag, cite the span of the candidate's answer you checked. If no supporting span exists, set supporting_span to null; that is the ungrounded claim. Only include violations whose supporting_span is null: if you can cite a span of the answer (or the question) that supports the claim, the claim is grounded and must not be listed.

### What is grounded
- Evaluative judgments: "this is a weak answer", "needs more structure"
- General advice or suggestions not tied to specifics: "consider adding boundary analysis"
- Advice or ideal-answer content that references details of the interview question itself (a stated size limit, a named feature, a scenario constraint), since the question is shared context
- Correct absence claims: "the answer does not mention API testing" when the answer truly does not mention it
- Content in top_strength, main_improvement, or ideal that describes what a good answer would look like in general, as long as it does not falsely claim the candidate said something

### What is ungrounded
- Fabricated specifics: "you mentioned Selenium" when Selenium is nowhere in the answer
- Misquoted content: "you said you would write unit tests" when the answer never said that
- Invented technique attribution: claiming the candidate used a named technique they did not name

### Gray zones, resolved
- "You did not think about edge cases" is grounded if edge cases are absent from the answer. Verify by confirming no matching span exists; supporting_span is null but the claim is about an absence, not a fabrication.
- "You are inexperienced" is out of scope here; the safety grader handles personal attacks.
- "Your answer shows a lack of structure" is an evaluative judgment, not a factual claim, and is grounded.
- ideal sections describe a reference answer, not the candidate's answer. They are only ungrounded if they misattribute content to the candidate.

### Examples

Example 1 (grounded, no violations):
Candidate answer: "I would use equivalence partitioning on the input."
technical_feedback: "Good use of equivalence partitioning."
Verdict: {"pass": true, "violations": []}

Example 2 (fabricated specific in a dim feedback field):
Candidate answer: "I would check positive and negative cases."
examples_feedback: "Great coverage of Selenium automation."
Verdict: {"pass": false, "violations": [{"field": "examples_feedback", "claim": "Great coverage of Selenium automation", "supporting_span": null, "reason": "Selenium is not mentioned in the candidate's answer"}]}

Example 3 (evaluative judgment, grounded):
Candidate answer: "I would test the form."
summary: "Your answer lacks structure and test design technique."
Verdict: {"pass": true, "violations": []}

### Output format

Respond with strict JSON only, no prose, no code fences:
{"pass": boolean, "violations": [{"field": string, "claim": string, "supporting_span": string | null, "reason": string}]}

pass is true only if violations is empty.`;

function parseVerdict(text: string): JudgeVerdict | null {
  const extracted = extractJson(text);
  if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) return null;
  const maybe = extracted as { pass?: unknown; violations?: unknown };
  if (typeof maybe.pass !== 'boolean' || !Array.isArray(maybe.violations)) return null;

  const violations: JudgeViolation[] = maybe.violations.map((v): JudgeViolation => {
    if (typeof v === 'string') return { reason: v };
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const violation: JudgeViolation = {
        reason:
          typeof o['reason'] === 'string'
            ? o['reason']
            : typeof o['claim'] === 'string'
              ? o['claim']
              : JSON.stringify(v),
      };
      if (typeof o['claim'] === 'string') violation.claim = o['claim'];
      if (o['supporting_span'] === null) violation.supportingSpan = null;
      else if (typeof o['supporting_span'] === 'string')
        violation.supportingSpan = o['supporting_span'];
      if (typeof o['field'] === 'string') violation.field = o['field'];
      return violation;
    }
    return { reason: String(v) };
  });
  return { pass: maybe.pass, violations };
}

function formatViolations(violations: JudgeViolation[]): string {
  return violations
    .map((v) => {
      const claim = v.claim ?? v.reason;
      const field = v.field ? `[${v.field}] ` : '';
      const span = v.supportingSpan === null ? 'no supporting span' : v.supportingSpan;
      return span ? `${field}"${claim}" (span: ${span})` : `${field}"${claim}"`;
    })
    .join('; ');
}

export default async function feedbackFaithfulness({
  output,
  test,
}: GraderInput): Promise<GraderResult> {
  const parsed = extractJson(output);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { pass: false, score: 0, reason: 'Malformed scoring output: not valid JSON' };
  }
  const sections = buildLabeledCorpus(parsed as Record<string, unknown>);
  if (sections.length === 0) {
    return {
      pass: false,
      score: 0,
      reason: 'Malformed scoring output: no textual fields to evaluate',
    };
  }

  const user = `Interview question:
"""
${test.vars.question}
"""

Candidate's answer:
"""
${test.vars.candidateAnswer}
"""

Scoring output sections to evaluate:

${formatLabeledCorpus(sections)}
`;

  const { text } = await judge({ system: SYSTEM, user });
  const verdict = parseVerdict(text);
  if (!verdict) {
    return {
      pass: false,
      score: 0,
      reason: `Judge returned malformed JSON: ${text.slice(0, 200)}`,
    };
  }

  return {
    pass: verdict.pass,
    score: verdict.pass ? 1 : 0,
    reason: verdict.pass
      ? 'Feedback is grounded in candidate answer'
      : `Ungrounded claims: ${formatViolations(verdict.violations)}`,
  };
}
