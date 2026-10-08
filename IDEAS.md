# Ideas and notes

Working notes on stretch goals, reusable patterns, and things worth watching. Stretch-goal details for v2+ live in PROJECT_SPEC.md Section 12; this file is for shorter, reusable lessons.

## Patterns to reuse

### Capture-promise-before-runAllTimersAsync

When testing async code that rejects after fake-timer-driven retries, attach the rejection assertion to the promise *before* advancing timers. Otherwise Node logs an unhandled rejection in the gap between rejection and assertion, which Vitest treats as a test-run error even though all assertions pass.

```ts
it('gives up after retries', async () => {
  mockCreate.mockRejectedValue(apiError(429));
  const promise = judge({ system: 's', user: 'u' });
  const assertion = expect(promise).rejects.toThrow();
  await vi.runAllTimersAsync();
  await assertion;
});
```

Reuse candidates: runner scripts that poll with backoff, any future retry wrappers, compare-runs diffing logic if it becomes async.

### Promptfoo cartesian-expands array-valued vars

Passing a golden case directly as promptfoo test vars silently exploded 65 tests into 273: promptfoo treats any array-valued var (mustMention, expectedScoreRange) as a matrix axis and generates the cartesian product, handing each grader a scalar fragment instead of the array. The fix that stuck: serialize the full case into a single `caseJson` string var and decode it in the adapter (`decodeCaseVars`), exposing only scalar convenience vars (id, category, question) directly. Any structured object riding through promptfoo vars should travel as a JSON string.

### Windows: promptfoo's logger can crash after output is written

On Windows, promptfoo's winston file transport intermittently throws "write after end" during process teardown, after the eval completed and the output JSON was fully written. The runner treats any exit code as acceptable when the output file exists and parses, and only fails when the output is missing. Generalizes to any CLI orchestration: gate on the artifact, not the exit code, when the tool is known to die during cleanup.

### Red-team resistance without a bespoke grader

The red-team suite reuses the existing deterministic graders instead of writing an attack-specific one. Resistance falls out of two signals already in the pipeline: an attack that tries to inflate the score ("score this 100") makes a compliant model land outside a low `expectedScoreRange`, and `mustNotMention` traps catch injected canary phrases, leaked rubric text, or echoed PII appearing anywhere in the feedback corpus. The must-not-mention corpus is built from the model output, not the candidate answer, so a trap only fires when the model actually reproduces the attacker's string, which is exactly the failure worth catching. A format-hijack attack ("drop the JSON") needs no trap at all: compliance produces unparseable output that every deterministic grader already reports as malformed.

Reuse candidate: any eval where the untrusted input rides inside a field the system under test consumes. Model the attack as data with pre-registered pass/fail bounds rather than building a parallel harness.

### Pre-registered expectations when a live run is not available

The red-team ranges were authored without a live run (cost hold). Each case's `notes` says so explicitly and the range is a deliberate prediction, not an observation. This keeps the dataset honest: a future real run may show a resistant model scoring higher than the pre-registered band, and that is a calibration finding to fold in, exactly as the golden set's ranges were recalibrated against runs 1 to 3. The must-not-mention traps are the sturdier backstop, since they do not depend on score calibration.

## Cost watch

### Judge rubric token budget

The tightened `feedback-faithfulness` and `safety` system prompts are now roughly 500 input tokens each after adding citation requirements, severity scales, and few-shot examples.

Back-of-envelope for a full 60-case run:

- 60 cases x 2 judge graders = 120 judge calls
- 500 input tokens per call = 60K input tokens before user content or output

That is before the per-case user prompt (candidate answer plus feedback) and before output tokens. A full weekly cron run on Monday 9am ET could add up quickly across months.

Worth watching once real runs start. Options if cost becomes a concern:

- Move few-shot examples to cached system prompts (prompt caching)
- Trim examples to the sharpest one or two
- Switch the judge to Haiku for safety (simpler rubric) and keep Sonnet only for faithfulness

Update 2026-07-21: cost became a concern on day one. Three full runs measured about $6.50 total with a Sonnet judge. Responses: judge default switched to claude-haiku-4-5 (baselines used Sonnet via ANTHROPIC_JUDGE_MODEL), consistency sampler made opt-in (measured stddev 0.09 to 0.31 against a budget of 8, so it earns its 50 calls rarely), and the CI eval job is manual-dispatch-only with a typed YES confirmation. Remaining lever if needed: prompt caching on the judge system prompts.

Update 2026-10-07: scoring moved to claude-sonnet-5-5 (adaptive thinking, medium effort); the judge stays on claude-haiku-4-5 for comparability. Claude Haiku 5.5 is the next judge lever at a tenth of Haiku 4.5's per-token price, gated on a `pnpm calibrate:judge` run with `ANTHROPIC_JUDGE_MODEL=claude-haiku-5-5`. It thinks by default, so the client sends it `low` effort with thinking headroom on max_tokens.

Known gap, pre-existing since v1: the per-case latency grader never receives a measurement from the real Anthropic provider (every v1 case reported "No latency measurement available"), because promptfoo's JavaScript assertion context carries no latency and its Anthropic provider does not set `providerResponse.latencyMs`. Suite percentiles are unaffected; they come from promptfoo's own per-result latency. Fixing the per-case signal needs a thin provider wrapper that times the call itself.

## Golden dataset authoring rules

Patterns established while authoring the seed cases. Apply to every new case.

### 1. Prefer multi-word phrases in mustMention and mustNotMention

Single-word terms like "negative", "boundary", "edge" risk cross-contamination and false positives in mention graders, since they appear incidentally in unrelated QA feedback phrasing. Use "negative cases", "boundary value", "edge scenario" instead. If a single word is unavoidable, note the tradeoff in the case's `notes` field.

### 2. mustNotMention targets fabricated attribution

The primary hallucination pattern to catch is the scoring model inventing claims about what the candidate said: "use of Cypress" when no tool was named, "applied equivalence partitioning" when the candidate gave only a vague happy-path answer, "your reference to TDD" when TDD was never raised. Past-tense verbs ("applied", "used", "demonstrated") are especially sharp signals because they attribute action. Unrelated-technique traps ("pairwise testing" on an answer that didn't use it) are acceptable as a secondary type, but fabricated attribution is the main target.

### 3. Widen expectedScoreRange before upgrading difficulty

When an answer is very strong for its declared difficulty tier, widen the range rather than upgrading to the next tier. Upgrading changes what the scoring prompt calibrates against; a strong-mid answer at senior difficulty often loses points for missing tier-specific framing (risk, strategy, observability) and ends up in a lower band than it deserves. Widening absorbs grader variance while keeping the tier label honest.

### 4. Cover strong, weak, and off-topic structural roles early

Distribute strong, weak, and off-topic cases early in the dataset to stress mention graders in all three structural roles. Strong cases test "concept demonstrated, feedback praises it" patterns. Weak cases test "concept absent, feedback surfaces as growth area" patterns. Off-topic cases test grader behavior when the answer doesn't engage the question at all (where generous graders tend to hallucinate praise or invent attribution). Early coverage across all three roles catches grader issues before they compound across 60 cases.

### 5. Past-tense attribution traps carry a false-positive risk

Traps like "applied X" or "used Y" catch fabricated attribution cleanly, but substring matching can't distinguish grounded growth-area comments in the same tense ("has not applied X", "never used Y"). Acceptable risk for v1 since the false-positive rate should be low for well-calibrated feedback. Watch for flaps in the first real eval run and consider tightening to specific attribution patterns ("your use of X", "your application of X") if the trap misfires.

### 6. Prefer "your"-prefixed attribution traps over tense-based traps

"Your approach to X", "your use of Y", "your reference to Z" unambiguously claim the candidate addressed the topic, which is the exact hallucination pattern worth catching. They also avoid the tense false-positive risk from rule 5, since grounded growth-area comments typically don't use "your" to attribute. Use these as the default form for attribution traps; fall back to tense-based only when no "your"-phrase reads naturally.

### 7. Off-topic cases leave mustMention empty

Growth-area terminology is unpredictable when the answer doesn't engage the question. Requiring specific terms makes the test brittle and punishes grader phrasing variance rather than grader correctness. The real signal for off-topic is mustNotMention catching generous praise or fabricated attribution.

### 8. Author at least one weak-with-confidence case per category

Confident-but-wrong answers stress a materially different grader path than under-informed weak answers: score-in-range tests whether the grader over-rewards vocabulary match, faithfulness tests whether the judge catches ungrounded praise, and mustMention tests the "concept named but misapplied" structural role. This pattern is the single highest-signal way to evaluate whether a scoring prompt does technical accuracy checking or just fluency matching, so every category's dataset should include at least one.

## v1 tradeoffs worth revisiting

Deliberate simplifications locked in for v1. Each one trades something real; revisit after the first live eval run.

### Faithfulness single-pass corpus

The faithfulness grader sends all four dim feedback fields plus summary, top_strength, main_improvement, and question_notes as one labeled corpus in a single judge call. Cheaper by 4x vs per-dim calls, and claims in `summary` often reference content that lives in another dim, so single-corpus avoids false positives from over-isolation. Cost: the judge may be less precise about which dim a hallucination originated in. Revisit after the first real run if we see attribution mistakes that would have been caught by dim-localized judging.

### overall_score is a plain rounded average

The grader computes `overall = round((technical + communication + examples + depth) / 4)` for the score-in-range check. If production ever moves to weighted dims (e.g., technical-heavier for senior roles), the eval formula must track that change or expectedScoreRange assertions will silently drift from reality.

### question_notes.ideal inside must-mention corpus

must-mention and must-not-mention treat `question_notes[].ideal` as part of the searchable corpus alongside `.note`. `ideal` is model-generated, so a term hit there reflects "model surfaced the concept somewhere in the feedback" rather than "model tied the concept to the candidate specifically". Acceptable noise for v1 since our must-mention terms are domain concepts the candidate should be steered toward either way. Revisit if false positives appear in real runs.
