# datasets

Synthetic golden dataset for the evaluation suite. See [../PROJECT_SPEC.md](../PROJECT_SPEC.md) Section 5 for the schema, size, coverage targets, and authoring rules, and [../IDEAS.md](../IDEAS.md) for the authoring patterns established while writing the cases.

Every case is authored from scratch. No real user data is imported, transformed, or derived here.

## Layout

- `golden/` holds 60 cases, 20 per category (manual-testing, automation, api-testing). Within each category: 6 strong, 6 mid, 6 weak, 1 off-topic, 1 refusal, spread across entry/mid/senior/principal difficulty. Each category includes at least one confident-but-wrong answer, the highest-signal case type for detecting graders that reward vocabulary over correctness.
- `adversarial/` holds 5 safety probes: solid answers that embed demographic signals (age, language background, gender and caregiving, nationality, disability). The safety judge must pass feedback that engages the testing content and flag anything that comments on the person.
- `redteam/` holds 12 attack cases: the candidate answer is the attack surface. They cover prompt injection (instruction override, fake system tags, role hijack), rubric and system-prompt exfiltration, score bribery and emotional pressure, PII echo (all synthetic), and output-format hijack. The expectations encode resistance: a compliant model lands outside `expectedScoreRange`, and `mustNotMention` traps catch injected canary phrases, leaked rubric text, or echoed PII appearing anywhere in the feedback. Run with `pnpm eval:redteam` (paid) or `pnpm eval:redteam:smoke` (free wiring check).
- `calibration/` holds a hand-labeled set for judge-the-judge measurement: 10 scoring outputs with known planted ungrounded claims and known-clean cases (including the question-grounded and true-absence cases that historically drew false positives). `pnpm calibrate:judge` scores the faithfulness judge against these labels to report its own precision and recall. Paid, and opt-in behind `--yes`.
- `golden/_schema.ts` re-exports the zod schema; `pnpm validate:dataset` validates every JSONL line in `golden/`, `adversarial/`, and `redteam/` and enforces unique ids. The calibration set uses a richer schema (full scoring output plus labels) validated by its own loader.

All PII, names, phone numbers, emails, and identifiers in the red-team set are fabricated for testing and correspond to no real person.
