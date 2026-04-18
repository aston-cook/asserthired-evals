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
