# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-07-21

Second pass, building on the core suite. Every addition is exercised by unit
tests and, where it calls the API, gated behind an explicit opt-in. No new API
spend was needed to ship any of it.

### Added

- **Red-team suite** ([datasets/redteam/attacks.jsonl](datasets/redteam/attacks.jsonl)): 12 attack cases where the candidate answer is the attack surface, covering prompt injection, rubric and system-prompt exfiltration, score bribery, synthetic PII echo, and output-format hijack. Resistance is checked with the existing deterministic graders rather than a bespoke one. Run with `pnpm eval:redteam` (paid) or `pnpm eval:redteam:smoke` (free).
- **Drift detection** ([scripts/detect-drift.ts](scripts/detect-drift.ts)): compares the latest run to a rolling baseline and flags any metric that moved more than the baseline's own noise explains, in both directions. `pnpm eval:drift`.
- **Dataset review queue** ([scripts/flag-for-review.ts](scripts/flag-for-review.ts)): flags cases that fail their expected range repeatedly across recent runs and writes a human review queue. `pnpm review:queue`.
- **Judge-the-judge calibration** ([datasets/calibration/faithfulness-labeled.jsonl](datasets/calibration/faithfulness-labeled.jsonl)): a hand-labeled set that measures the faithfulness judge's own precision and recall. `pnpm calibrate:judge -- --yes` (paid).
- **MIT license** and two Promptfoo web-UI screenshots in the README.

### Changed

- Smoke runs now write to `reports/smoke` so the trend, drift, and review-queue tooling over `reports/` never sees mock data.
- Run-summary loading is consolidated into a shared `lib/run-summaries.ts` used by the trend, drift, and review-queue scripts.

### Fixed

- Judge calibration recall is now computed on distinct violations rather than on flagged claims, so a judge that cites the same planted violation more than once can no longer inflate its own recall.

## [1.0.0] - 2026-07-21

Initial release.

### Added

- 65-case fully synthetic golden dataset across manual testing, automation, and API testing, plus 5 adversarial safety probes, validated against a zod schema.
- Seven metrics with CI thresholds: score-in-range, score consistency, feedback faithfulness, must-mention coverage, must-not-mention, safety, and latency.
- LLM-as-judge graders for faithfulness and safety, with strict rubrics and citation requirements.
- Promptfoo pipeline with a zero-API mock smoke mode, plus a report pipeline with threshold gates and a trend view.
- GitHub Actions CI: free checks (typecheck, unit tests, dataset validation, mock smoke) on every push and pull request; the paid eval runs only on manual dispatch with a typed confirmation.
- [FINDINGS.md](FINDINGS.md): a writeup of what three real runs surfaced, including one safety finding kept open as a prompt-improvement item.

[1.1.0]: https://github.com/aston-cook/asserthired-evals/releases/tag/v1.1.0
[1.0.0]: https://github.com/aston-cook/asserthired-evals/releases/tag/v1.0.0
