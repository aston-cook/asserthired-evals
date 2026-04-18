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

## v1 tradeoffs worth revisiting

Deliberate simplifications locked in for v1. Each one trades something real; revisit after the first live eval run.

### Faithfulness single-pass corpus

The faithfulness grader sends all four dim feedback fields plus summary, top_strength, main_improvement, and question_notes as one labeled corpus in a single judge call. Cheaper by 4x vs per-dim calls, and claims in `summary` often reference content that lives in another dim, so single-corpus avoids false positives from over-isolation. Cost: the judge may be less precise about which dim a hallucination originated in. Revisit after the first real run if we see attribution mistakes that would have been caught by dim-localized judging.

### overall_score is a plain rounded average

The grader computes `overall = round((technical + communication + examples + depth) / 4)` for the score-in-range check. If production ever moves to weighted dims (e.g., technical-heavier for senior roles), the eval formula must track that change or expectedScoreRange assertions will silently drift from reality.

### question_notes.ideal inside must-mention corpus

must-mention and must-not-mention treat `question_notes[].ideal` as part of the searchable corpus alongside `.note`. `ideal` is model-generated, so a term hit there reflects "model surfaced the concept somewhere in the feedback" rather than "model tied the concept to the candidate specifically". Acceptable noise for v1 since our must-mention terms are domain concepts the candidate should be steered toward either way. Revisit if false positives appear in real runs.
