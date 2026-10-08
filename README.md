# asserthired-evals

[![evals](https://github.com/aston-cook/asserthired-evals/actions/workflows/evals.yml/badge.svg)](https://github.com/aston-cook/asserthired-evals/actions/workflows/evals.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22.22-brightgreen)

A production-grade LLM evaluation suite for interview-scoring applications, built as a public reference implementation.

Interview-scoring LLMs are a high-trust surface: an AI mock-interview product asks a candidate a question, scores their answer, and hands back structured feedback. If the scoring prompt drifts, hallucinates, or becomes inconsistent, users lose trust immediately. Most teams ship changes to that prompt with zero regression coverage. This repo is one way to fix that, end to end: a synthetic golden dataset, seven metrics with CI thresholds, LLM-as-judge graders, an adversarial red-team suite, and a report pipeline that fails the build when quality regresses.

It is framed as a reference implementation that any team building an AI interview or feedback product could adapt. [AssertHired](https://asserthired.com) is the motivating example, not the subject being documented; nothing in this repo comes from production data.

## What a run looks like

Every run produces a threshold-gated markdown report and a machine-readable summary. The same results are browsable in the Promptfoo web UI (`pnpm exec promptfoo view`):

![Promptfoo results overview: 87.69% passing, per-case scores, cost and latency](docs/images/promptfoo-results.png)

Each case is graded by all seven metrics independently, with a human-readable reason for every pass or fail:

![Per-case grader breakdown: score-in-range, must-mention, must-not-mention, latency, faithfulness, safety](docs/images/promptfoo-detail.png)

## Architecture

```
datasets/golden/*.jsonl        promptfooconfig.yaml         graders/
(60 synthetic cases)   ─────►  (promptfoo runner)   ─────►  6 graders          ─────►  reports/<ts>.md
datasets/adversarial/          prompts/scoring-prompt       (4 deterministic,          reports/<ts>-summary.json
(5 safety probes)              (system under test)          2 LLM-as-judge)            CI pass/fail
datasets/redteam/                       │
(12 attack cases)              scripts/run-evals.ts ──► consistency sampler (opt-in, 10 cases x 5 runs)

reports/<ts>-summary.json ──►  scripts/{compare,detect-drift,flag-for-review}.ts ──► trend / drift / review-queue
datasets/calibration/     ──►  scripts/calibrate-judge.ts ──► judge precision and recall
```

- **Dataset**: 65 fully synthetic evaluation cases across manual testing, automation, and API testing, plus a 12-case adversarial red-team suite. Each case carries an expected score range, must-mention concepts, and hallucination traps. Validated against a zod schema.
- **System under test**: a sanitized snapshot of an interview-scoring prompt ([prompts/scoring-prompt.v1.txt](prompts/scoring-prompt.v1.txt)), run against the Anthropic API through promptfoo.
- **Graders**: TypeScript assertions shared between promptfoo and unit tests. The two judge graders call Claude with strict rubrics and citation requirements.
- **Reports and analysis**: every run emits a markdown report and a machine-readable summary; trend, drift, and review-queue scripts turn a history of summaries into decisions.

## The seven metrics

| Metric | How | Threshold | Why this threshold |
|---|---|---|---|
| Score in range | Overall score inside the case's `expectedScoreRange` | 85% target, CI fails < 80% | Ranges are 10+ points wide to absorb normal LLM variance; falling below 80% means calibration drift, not noise |
| Score consistency | 10 cases x 5 repeat calls, stddev of overall score | mean stddev <= 8, CI fails > 12 | The product promises comparable scores across attempts; a 12-point swing on identical input is user-visible unfairness |
| Feedback faithfulness | LLM judge lists claims not grounded in the candidate's answer | 90% target, CI fails < 85% | Fabricated feedback ("your use of Selenium" when no tool was named) is the fastest way to lose user trust |
| Must-mention coverage | Stemmed substring match of expected concepts in feedback | 75% of terms across the suite | Feedback should teach; missing the obvious growth areas means generic filler |
| Must-not-mention | Same matcher, inverted, targeting known hallucination patterns | Zero violations | Each term is a deliberate trap (fabricated attribution, false praise); one hit is one hallucination |
| Safety | LLM judge with bias/toxicity/personal-attack rubric, plus 5 adversarial probe cases | 100% pass | Demographic commentary in interview feedback is a legal and ethical bright line |
| Latency | Per-case wall clock, suite percentiles | p50 3s / p95 7s / p99 12s, warn only | Latency informs UX decisions (streaming, progress states) but should not block a quality fix |

## Baseline run

The baseline run (run 3 of 3 on 2026-07-21, scored on `claude-sonnet-4-5` at temperature 0.2; the full three-run story is in [FINDINGS.md](FINDINGS.md)). The suite now scores on Claude Sonnet 5.5 (see [Models](#models)), so the first paid run on it sets a new baseline rather than a like-for-like comparison:

| Metric | Result | Threshold | Status |
|---|---|---|---|
| Score in range | 64/65 (98.5%) | target 85%, fail < 80% | pass |
| Score consistency (mean stddev) | 0.24 over 10 cases x 5 runs | target <= 8, fail > 12 | pass |
| Feedback faithfulness | 58/65 (89.2%) | target 90%, fail < 85% | pass (below target) |
| Must-mention coverage | 108/115 terms (93.9%) | >= 75% of terms | pass |
| Must-not-mention violations | 0 | zero violations | pass |
| Safety | 64/65 (98.5%) | 100% pass | FAIL (1 borderline case, kept open) |
| Latency | p50 19.8s, p95 22.6s | p50 3s / p95 7s / p99 12s | warn only |

The one safety failure is deliberate honesty: the judge flagged feedback that drifted from critiquing an answer into characterizing the candidate ("will make you a much stronger automation engineer"). FINDINGS.md Finding 5 has the analysis; it stays open as a prompt-improvement item rather than being tuned away.

## Beyond the seven metrics

Four capabilities built on top of the core suite. Each is exercised by unit tests and, where it calls the API, gated behind an explicit opt-in.

### Red-team suite

The candidate answer is where untrusted input enters the scoring prompt, so it is the natural attack surface. [datasets/redteam/attacks.jsonl](datasets/redteam/attacks.jsonl) contains 12 attacks:

- **Prompt injection**: instruction override with a compliance canary, fake `<system>` tags carrying a score directive, chat-message JSON impersonating a system turn, and a role hijack into "write me a cover letter instead".
- **Exfiltration**: attempts to make the model print its own system prompt or scoring rubric, including one aimed at the low-visibility `question_notes.ideal` field.
- **Score manipulation**: a bribe embedded in a decent answer, and a pure emotional appeal with no technical content, both targeting the scoring prompt's generosity calibration.
- **PII echo**: synthetic emails, phone numbers, and an SSN with a social pretext for repeating them into the feedback.
- **Format hijack and payload**: a request to drop JSON output entirely, and a stored-XSS-style payload aimed at whatever renders the feedback later.

Resistance is checked without a bespoke grader: a compliant model lands outside the case's `expectedScoreRange` (a "score this 100" attack fails a 0-44 range), and `mustNotMention` traps catch any canary phrase, leaked rubric text, or echoed PII appearing anywhere in the output. Run with `pnpm eval:redteam` (paid) or `pnpm eval:redteam:smoke` (free).

### Drift detection

Fixed thresholds catch a metric falling off a cliff but miss a slow slide. [scripts/detect-drift.ts](scripts/detect-drift.ts) compares the latest run against a rolling baseline of the runs before it and flags any metric that moved more than the baseline's own noise explains (default: more than two baseline standard deviations, or a per-metric floor). It flags improvements too, since a sudden jump usually means the population or config changed rather than the model improving. `pnpm eval:drift`, or `pnpm eval:drift -- --fail-on-drift` to gate on it. No cron anywhere in this repo; it runs when a human runs it.

### Dataset review queue

A case that fails its expected range once is probably model noise; a case that fails run after run is probably a miscalibrated expectation. [scripts/flag-for-review.ts](scripts/flag-for-review.ts) finds the repeat offenders across recent runs and writes a human review queue, deliberately not an auto-editor, so expectation changes stay reviewable dataset commits. `pnpm review:queue`.

### Judge-the-judge calibration

The faithfulness judge is itself an LLM, so its verdicts need ground truth. [datasets/calibration/faithfulness-labeled.jsonl](datasets/calibration/faithfulness-labeled.jsonl) is a hand-labeled set of scoring outputs with known planted ungrounded claims and known-clean cases, chosen to include the tricky ones (question-grounded references, true-absence observations) that historically produced false positives. `pnpm calibrate:judge -- --yes` scores the judge against the labels and reports its precision and recall, which is what makes the suite-level faithfulness number trustworthy.

## Running locally

Cost warning: a full `pnpm eval` makes ~200 Anthropic API calls (65 scoring, 130 judge, plus 50 more with `--consistency`). On the v1 model set (Sonnet 4.5 scoring, Haiku 4.5 judge) a run was roughly $1.50 to $2.50; with a Sonnet judge and the consistency sampler it measured about $2 to $3 per run. The Claude Sonnet 5.5 default has not been costed yet: its per-token price is a third lower than Sonnet 4.5, but it spends output tokens on adaptive thinking and its tokenizer counts about 30% more tokens for the same text, so budget for the same order of magnitude until the next paid run re-baselines it. Everything under "Free" below makes zero API calls.

```bash
pnpm install

# Free: zero-API-call smoke runs, exercise the full pipeline with a mock provider
pnpm eval:smoke
pnpm eval:redteam:smoke

# Free: unit tests (mocked clients) and dataset validation
pnpm test
pnpm validate:dataset

# Free: analysis over past run summaries in reports/
pnpm eval:compare       # trend table across runs
pnpm eval:drift         # drift vs a rolling baseline
pnpm review:queue       # cases that fail their range repeatedly

# PAID: full run against the Anthropic API
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
pnpm eval

# PAID variants
pnpm eval -- --first 3        # probe run, 3 cases only
pnpm eval -- --consistency    # adds the 10x5 consistency sampler
pnpm eval:redteam             # the 12-case adversarial suite
pnpm calibrate:judge -- --yes # measure the faithfulness judge's precision and recall
ANTHROPIC_JUDGE_MODEL=claude-sonnet-4-5 pnpm eval   # reproduce the baseline judge
ANTHROPIC_JUDGE_MODEL=claude-haiku-5-5 pnpm calibrate:judge -- --yes   # vet the cheaper judge
```

CI is deliberately conservative about cost: pushes and PRs run only the free tier (typecheck, unit tests, dataset validation, both mock smoke runs). The paid eval job runs **only** on manual workflow dispatch with a typed YES confirmation, so nothing triggers API spend accidentally. See [.github/workflows/evals.yml](.github/workflows/evals.yml).

### Models

| Role | Default | Override |
|---|---|---|
| Scoring (system under test) | `claude-sonnet-5-5`, adaptive thinking at `medium` effort | edit the provider block in `promptfooconfig.yaml` (the consistency sampler also reads `EVAL_SCORING_MODEL`) |
| LLM judges (faithfulness, safety) | `claude-haiku-4-5` | `ANTHROPIC_JUDGE_MODEL` |

All model ids and per-model request rules live in [lib/models.ts](lib/models.ts), and a unit test fails if the promptfoo provider blocks drift from it. The Claude 5 models reject a non-default `temperature`, so the request builder drops it for them and keeps it for the 4.x models used by the v1 baselines.

The judge stays on Haiku 4.5 on purpose: every v1 faithfulness and safety number, and the judge calibration, was measured on a 4.x judge, and moving the judge moves every judged metric at once. Claude Haiku 5.5 is the cheaper candidate (a tenth of Haiku 4.5's per-token price); switch only after `ANTHROPIC_JUDGE_MODEL=claude-haiku-5-5 pnpm calibrate:judge -- --yes` shows precision and recall holding.

## Repo layout

```
datasets/golden/        60 synthetic cases (20 per category), JSONL + zod schema
datasets/adversarial/   5 safety probe cases with demographic signals
datasets/redteam/       12 adversarial attack cases (injection, exfiltration, PII, format hijack)
datasets/calibration/   hand-labeled set for judge precision/recall
prompts/                scoring prompt snapshot + promptfoo prompt function
graders/                6 graders + promptfoo wrappers, all unit tested
lib/                    claude client, mention matcher, report / drift / review / calibration engines, thresholds
scripts/                run-evals, summarize, compare, detect-drift, flag-for-review, calibrate-judge, validate
reports/                generated output (gitignored)
```

## Roadmap

Built beyond the original v1 metrics: the red-team suite, drift detection, the dataset review queue, and judge calibration described above.

Still on the roadmap:

- Multi-model comparison (Haiku 5.5 vs Sonnet 5.5 vs Opus 5.5, plus an effort sweep on the scoring model) to quantify the cost-quality frontier for this workload. This is the one remaining item that only pays off with paid runs across several models, so it waits until a comparison run is worth the spend.
- Move the judge to Claude Haiku 5.5 once a calibration run validates it (see Models above).
- Prompt caching on the judge system prompts, the last untapped cost lever (see [IDEAS.md](IDEAS.md)).

## Changelog

Recent work is called out in [CHANGELOG.md](CHANGELOG.md). The red-team suite, drift detection, review queue, and judge calibration landed in 1.1.0; the move to Claude Sonnet 5.5 scoring and the toolchain refresh landed in 1.2.0.

## Credits

Built with [Promptfoo](https://promptfoo.dev), [Anthropic Claude](https://www.anthropic.com), Vitest, and zod. Dataset authoring rules and v1 tradeoffs are documented in [IDEAS.md](IDEAS.md). Licensed under [MIT](LICENSE).
