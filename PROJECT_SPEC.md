# AssertHired LLM Evaluation Suite — Project Prompt for Claude Code

> Hand this file to Claude Code inside the AssertHired repo (or a new sibling repo). It describes the full v1 scope. Claude Code should treat it as the source of truth, ask for clarification on anything ambiguous, and produce working code.

---

## 1. Context

AssertHired (asserthired.com) is an AI-powered mock interview platform for QA engineers. The core product feature is:

- User picks a QA category (e.g. Manual Testing, Automation, API Testing, Live Coding) and difficulty (Entry, Mid, Senior, Principal)
- LLM generates an interview question
- User submits a written or voice answer
- LLM (Claude via the Anthropic API) scores the answer and returns structured feedback

The scoring and feedback call is the single most business-critical LLM surface in the app. If it drifts, hallucinates, or becomes inconsistent, users lose trust and churn spikes.

Today there is no automated evaluation of this surface. Changes to the prompt, model, or temperature ship without regression coverage. That is what this project fixes.

---

## 2. Goal

Build a production-grade LLM evaluation suite that:

1. Runs automatically on every change to the scoring prompt, model config, or eval suite itself
2. Uses a versioned golden dataset of realistic interview answers with expected score ranges and feedback criteria
3. Measures scoring consistency, rubric adherence, feedback faithfulness, safety, and latency
4. Fails CI when key metrics regress beyond defined thresholds
5. Produces a human-readable report on every run and a trend view over time
6. Is clean and well-documented enough to be a public portfolio artifact

This is v1. Keep scope tight. Stretch ideas go in Section 12.

---

## 3. Tech stack

- **Promptfoo** as the primary eval runner. TypeScript and YAML native, fits the AssertHired Next.js/TypeScript monorepo, integrates cleanly with GitHub Actions.
- **TypeScript** for custom graders and helpers
- **Claude (Anthropic API)** both as the system under test and as the judge for LLM-graded assertions
- **GitHub Actions** for CI
- **Vitest** for unit tests around custom graders
- **Node 20+**, pnpm

Do not pull in Python or DeepEval for v1. Keep the toolchain unified.

---

## 4. Repository structure

If this is a new sibling repo, create it as `asserthired-evals`. If adding to the existing monorepo, create it under `packages/evals/`.

```
asserthired-evals/
├── README.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── promptfooconfig.yaml
├── .github/
│   └── workflows/
│       └── evals.yml
├── datasets/
│   ├── golden/
│   │   ├── manual-testing.jsonl
│   │   ├── automation.jsonl
│   │   ├── api-testing.jsonl
│   │   └── _schema.ts
│   └── README.md
├── prompts/
│   └── scoring-prompt.v1.txt      # snapshot of the production scoring prompt
├── graders/
│   ├── score-in-range.ts
│   ├── feedback-faithfulness.ts
│   ├── rubric-adherence.ts
│   ├── safety.ts
│   └── latency-slo.ts
├── lib/
│   ├── claude-client.ts
│   └── types.ts
├── reports/                       # gitignored, generated output
└── scripts/
    ├── run-evals.ts
    ├── summarize-run.ts
    └── compare-runs.ts
```

---

## 5. Golden dataset

### 5.1 Schema

Each record is one JSONL line:

```ts
// datasets/golden/_schema.ts
export interface GoldenCase {
  id: string;                        // stable id, e.g. "manual-0042"
  category: "manual-testing" | "automation" | "api-testing" | "live-coding";
  difficulty: "entry" | "mid" | "senior" | "principal";
  question: string;                  // the interview question posed
  candidateAnswer: string;           // what the user submitted
  expectedTier: "strong" | "mid" | "weak" | "off-topic" | "refusal";
  expectedScoreRange: [number, number]; // inclusive, on whatever scale prod uses (e.g. 0-100)
  mustMention: string[];             // concepts feedback should reference (faithfulness signal)
  mustNotMention: string[];          // concepts feedback should NOT hallucinate
  notes?: string;                    // authoring notes, not used in eval
}
```

### 5.2 Size and coverage

- v1 target: **60 cases total**, split roughly 20 per category across Manual Testing, Automation, API Testing
- Within each category: 6 strong, 6 mid, 6 weak, 1 off-topic, 1 refusal/empty
- Spread difficulty levels across those tiers so we cover the matrix

### 5.3 Seed examples

Claude Code should generate the full 60 cases after confirming this structure. Here are 3 seeds to anchor the style:

```json
{"id":"manual-0001","category":"manual-testing","difficulty":"mid","question":"How would you test a login form that supports both email and phone number authentication?","candidateAnswer":"I'd start with equivalence partitioning on the input field to identify whether the user entered an email or a phone number. Then I'd run positive cases for both valid formats, negative cases for malformed inputs, boundary cases on length, and cross-field validation like submitting phone format into an email-only flow. I'd also cover rate limiting, lockout after failed attempts, and accessibility like tab order and screen reader labels.","expectedTier":"strong","expectedScoreRange":[80,95],"mustMention":["equivalence partitioning","boundary","negative cases"],"mustNotMention":["unit testing the backend database"],"notes":"Solid structured answer, covers multiple test design techniques"}
{"id":"manual-0002","category":"manual-testing","difficulty":"mid","question":"How would you test a login form that supports both email and phone number authentication?","candidateAnswer":"I would test the login form by entering a username and password and clicking login to make sure it works.","expectedTier":"weak","expectedScoreRange":[10,30],"mustMention":["test design","edge cases","negative"],"mustNotMention":[],"notes":"No structure, no test design technique, missing phone auth entirely"}
{"id":"manual-0003","category":"manual-testing","difficulty":"mid","question":"How would you test a login form that supports both email and phone number authentication?","candidateAnswer":"I love React and would build the form with hooks and useState to manage the input fields.","expectedTier":"off-topic","expectedScoreRange":[0,15],"mustMention":[],"mustNotMention":["good answer","strong response"],"notes":"Completely off-topic, answering a development question not a testing question"}
```

### 5.4 Authoring rules

- Real QA vocabulary. No generic corporate filler.
- Answers should feel like real candidates wrote them, including realistic grammar variance in weak answers.
- `expectedScoreRange` should have a minimum width of 10 points to allow for healthy LLM variance. If the range is narrower than 10, widen it.
- `mustMention` should only contain terms the feedback would reasonably bring up for that answer quality.
- `mustNotMention` catches known hallucination patterns.

---

## 6. Metrics

All metrics run on every CI build. Thresholds below are v1 baselines; tune after a week of real data.

### 6.1 Score in range (rubric adherence)

- **What**: Did the LLM's score fall inside `expectedScoreRange`?
- **How**: Simple numeric check in `graders/score-in-range.ts`
- **Threshold**: 85% of cases must pass. CI fails below 80%.

### 6.2 Score consistency (non-determinism budget)

- **What**: For a sampled subset (10 cases), run the scoring call 5 times each and measure standard deviation of the score
- **How**: Run in `scripts/run-evals.ts`, store per-case stddev
- **Threshold**: Mean stddev across sampled cases must be ≤ 8 points. CI fails above 12.

### 6.3 Feedback faithfulness (no hallucinations)

- **What**: Does the feedback reference things that are actually in the candidate's answer, and does it avoid claims the answer never made?
- **How**: LLM-as-judge grader in `graders/feedback-faithfulness.ts`. Use Claude with a strict rubric asking "List any claims in this feedback that are NOT grounded in the candidate's answer." Pass = zero ungrounded claims.
- **Threshold**: 90% pass rate. CI fails below 85%.

### 6.4 Must-mention coverage

- **What**: Did the feedback reference each term in `mustMention`?
- **How**: Case-insensitive substring plus stemming. Multiple phrasings okay (e.g. "edge case" matches "edge cases").
- **Threshold**: 75% of must-mention terms hit across the suite.

### 6.5 Must-not-mention violations

- **What**: Did the feedback reference any `mustNotMention` term?
- **How**: Same as above, inverted.
- **Threshold**: Zero violations. Any violation fails CI.

### 6.6 Safety

- **What**: Feedback contains no demographic bias, no toxic language, no personal attacks.
- **How**: LLM-as-judge grader in `graders/safety.ts` using a short safety rubric. Also runs on a small set of adversarial cases designed to probe bias (see stretch goals for full red-team set in v1; start with 5 basic probes).
- **Threshold**: 100% pass. Any failure fails CI.

### 6.7 Latency SLOs

- **What**: Time from request to structured response
- **How**: Measured in `lib/claude-client.ts` wrapper, logged per case
- **Thresholds**: p50 ≤ 3s, p95 ≤ 7s, p99 ≤ 12s. CI warns, does not fail, for latency regressions above these.

---

## 7. Promptfoo config

Single source-of-truth YAML at `promptfooconfig.yaml`. Structure:

```yaml
description: "AssertHired interview scoring eval suite v1"

prompts:
  - file://prompts/scoring-prompt.v1.txt

providers:
  - id: anthropic:messages:claude-sonnet-4-5
    config:
      temperature: 0.2
      max_tokens: 2000

tests:
  - description: "Manual Testing golden set"
    vars:
      dataset: manual-testing
    assert:
      - type: javascript
        value: file://graders/score-in-range.ts
      - type: javascript
        value: file://graders/must-mention.ts
      - type: javascript
        value: file://graders/must-not-mention.ts
      - type: llm-rubric
        value: file://graders/feedback-faithfulness.ts
      - type: llm-rubric
        value: file://graders/safety.ts

  # repeat for automation, api-testing
```

Claude Code should generate the full config with all three datasets wired up and all graders attached.

---

## 8. Custom graders

Each grader is a TypeScript module exporting a function matching Promptfoo's assertion contract. Patterns:

```ts
// graders/score-in-range.ts
import type { GoldenCase } from "../datasets/golden/_schema";

export default async function scoreInRange({
  output,
  test,
}: {
  output: string;
  test: { vars: GoldenCase };
}) {
  const parsed = JSON.parse(output);
  const [min, max] = test.vars.expectedScoreRange;
  const pass = parsed.score >= min && parsed.score <= max;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `Score ${parsed.score} in range [${min}, ${max}]`
      : `Score ${parsed.score} outside [${min}, ${max}]`,
  };
}
```

LLM-as-judge graders (`feedback-faithfulness.ts`, `safety.ts`) use Claude through `lib/claude-client.ts` with a structured rubric prompt that returns JSON like `{ "pass": true, "violations": [] }`.

Each grader gets a Vitest unit test covering pass, fail, and malformed output cases.

---

## 9. CI workflow

`.github/workflows/evals.yml`:

- Triggers: `push` to main, `pull_request` touching `prompts/`, `graders/`, `datasets/`, or the workflow itself. Also `workflow_dispatch`. Also weekly cron on Monday 9 AM Eastern to catch model drift.
- Steps: checkout, setup Node, pnpm install, run promptfoo eval with JSON output, run `scripts/summarize-run.ts`, upload report as artifact, post summary comment on PR, fail the build if any hard threshold is breached.
- Secret: `ANTHROPIC_API_KEY` from repo secrets.

---

## 10. Reporting

### 10.1 Per-run report

`scripts/summarize-run.ts` consumes promptfoo's JSON output and emits:

- Markdown summary: pass rates per metric, failing cases with diffs, latency percentiles
- Saved to `reports/<ISO-timestamp>.md`
- Pretty-printed to stdout for CI logs
- PR comment posts the summary inline

### 10.2 Trend view

`scripts/compare-runs.ts` reads the last N reports and outputs a trend table showing metric movement over time. Runs weekly and on demand. Keep this simple: markdown table, not a dashboard.

A static HTML trend dashboard is a stretch goal.

---

## 11. README

The repo README is the portfolio piece. It should contain:

1. **What and why**: the problem of untested LLM surfaces in production apps
2. **Architecture diagram**: one simple diagram showing dataset → promptfoo → graders → report → CI
3. **Metrics explained**: each of the seven metrics with the reasoning behind the threshold
4. **Sample run output**: real screenshot or embedded markdown of a passing and a failing run
5. **How to run locally**: `pnpm install`, set env, `pnpm eval`
6. **What I would add next**: honest stretch goals
7. **Credits**: Promptfoo, Anthropic, etc.

Keep it crisp. No fluff. Link to a blog post on asserthired.com explaining the project once that exists.

---

## 12. Stretch goals (not v1)

Document these in an `IDEAS.md` but do not build them yet:

- Red-team dataset: 30 adversarial prompts probing bias, prompt injection, refusal bypass, PII leakage
- Drift detection: compare weekly cron runs against a rolling baseline, flag meaningful shifts
- Multi-model eval: run the same suite against Claude Haiku, Sonnet, Opus and compare cost vs quality
- Retrieval eval: if AssertHired adds RAG, layer in RAGAS-style context faithfulness
- Self-healing dataset: flag cases where expected ranges consistently disagree with model output and surface them for human review
- Simple Next.js dashboard embedded in AssertHired admin showing the latest trend

---

## 13. Public vs private boundaries

This repo is public. AssertHired stays private. The boundary matters for every decision Claude Code makes in this project.

### 13.1 What stays in the private AssertHired repo (never copy into this one)

- The actual production scoring prompt with exact rubric language and internal phrasing
- Real user interview submissions, scored answers, or any data derived from them
- Real score distributions, model choices, cost data, or latency data from production
- Internal pricing or tier gating logic, and anything else competitive

### 13.2 What belongs in this public repo

- A **sanitized snapshot** of the scoring prompt in `prompts/scoring-prompt.v1.txt`. Strip proprietary rubric wording, internal references, and pricing context. What remains should look like a realistic QA interview scoring prompt that any thoughtful engineer could have written. The user will hand-sanitize this before committing. Do not scaffold it with real production content.
- A **fully synthetic** golden dataset. Every question and candidate answer is authored from scratch. Do not import, transform, or derive from real user data even if asked.
- All eval framework code, graders, CI setup, and documentation. This is the portfolio value.
- Writeups and findings from running the suite, as long as they do not reveal AssertHired-specific production metrics or competitive info.

### 13.3 Framing in the public README

Present this as a **reference implementation** for LLM evaluation in interview-scoring applications. Mention AssertHired as the inspiration or motivating example, not as the subject being documented. Wording should feel like "this is how you would build an eval suite for any interview scoring app," not "here is exactly how AssertHired works under the hood."

### 13.4 Pre-commit checklist

Before the first public push, confirm:

- [ ] Scoring prompt has been sanitized and reviewed for leaks
- [ ] No real user data anywhere in the repo or in git history
- [ ] README is framed as a reference implementation, not a product teardown
- [ ] License added (MIT is the easy choice)
- [ ] `ANTHROPIC_API_KEY` referenced only through GitHub Actions secrets, never committed in examples or fixtures

---

## 14. Ground rules for Claude Code

- Ask before making assumptions that cross more than one file
- When generating the 60 golden cases, generate 5 first, show them for review, then do the rest after approval
- Use `zod` or similar for runtime validation of dataset files
- Every grader gets a unit test
- Keep the production scoring prompt in `prompts/scoring-prompt.v1.txt` as a verbatim snapshot. Do not modify the live AssertHired prompt from this repo.
- Commit messages follow conventional commits
- No em dashes in any user-facing text or docs

---

## 15. Definition of done for v1

- [ ] Repo scaffolded with the full structure in Section 4
- [ ] 60 golden cases authored and validated against the schema
- [ ] All seven metrics implemented and unit tested
- [ ] Promptfoo config runs locally end to end against the real Claude API
- [ ] GitHub Actions workflow passes on a green baseline and fails on a seeded regression
- [ ] README completed with sample run output
- [ ] Blog-ready summary of findings from the first real eval run (what surprised you, what broke)

That last bullet is the most important one. The real portfolio value is the write-up of what you learned when real tests hit a real prompt for the first time.
