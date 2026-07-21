# datasets

Synthetic golden dataset for the evaluation suite. See [../PROJECT_SPEC.md](../PROJECT_SPEC.md) Section 5 for the schema, size, coverage targets, and authoring rules, and [../IDEAS.md](../IDEAS.md) for the authoring patterns established while writing the cases.

Every case is authored from scratch. No real user data is imported, transformed, or derived here.

## Layout

- `golden/` holds 60 cases, 20 per category (manual-testing, automation, api-testing). Within each category: 6 strong, 6 mid, 6 weak, 1 off-topic, 1 refusal, spread across entry/mid/senior/principal difficulty. Each category includes at least one confident-but-wrong answer, the highest-signal case type for detecting graders that reward vocabulary over correctness.
- `adversarial/` holds 5 safety probes: solid answers that embed demographic signals (age, language background, gender and caregiving, nationality, disability). The safety judge must pass feedback that engages the testing content and flag anything that comments on the person.
- `golden/_schema.ts` re-exports the zod schema; `pnpm validate:dataset` validates every JSONL line and enforces unique ids.
