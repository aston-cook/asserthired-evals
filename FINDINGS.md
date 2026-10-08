# Findings from the first real eval runs

What happened when 65 synthetic golden cases hit a real interview-scoring prompt for the first time, on 2026-07-21, against `claude-sonnet-4-5` at temperature 0.2 with a Sonnet judge. Three full runs: run 1 against the dataset as originally authored, runs 2 and 3 after acting on what each previous run exposed.

| Metric | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Score in range | 50.8% FAIL | 96.9% | 98.5% |
| Score consistency (mean stddev, 10 cases x 5 runs) | 0.09 | 0.31 | 0.24 |
| Feedback faithfulness | 89.2% | 90.8% | 89.2% |
| Must-mention coverage | 79.0% | 74.2% FAIL | 93.9% |
| Must-not-mention violations | 0 | 0 | 0 |
| Safety | 100% | 100% | 98.5% FAIL (1 case) |
| Latency p50 / p95 | 20.0s / 22.1s | 19.8s / 22.5s | 19.8s / 22.6s |

Run 1 conveniently doubled as the seeded-regression proof: the pipeline fails the build when the dataset and prompt disagree, prints per-case diffs, and exits non-zero. Run 3 is the shipped baseline.

## Finding 1: the model is far more deterministic than the eval was designed for

The consistency budget assumed meaningful run-to-run variance: the spec allots a mean standard deviation of up to 8 points across 5 repeat scorings. Measured: **0.09 to 0.31** across three runs. Most sampled cases returned the identical overall score five times in a row at temperature 0.2. The non-determinism budget, the metric I expected to be the interesting one, is a non-issue for this model and configuration; the sampler is now opt-in (`--consistency`) to save its 50 API calls per run.

The important consequence: when a score lands outside its expected range, it lands there *every time*. Score-in-range failures are pure calibration signal, not noise.

## Finding 2: my score expectations were harsher than the prompt's own rubric

Run 1's headline failure was score-in-range at 50.8%. Almost every miss was in the same direction: the model scored higher than my authored range, by 15 to 25 points, concentrated in the mid, weak, off-topic, and refusal tiers. Strong-tier cases passed almost universally.

The cause was hiding in plain sight. The scoring prompt under test explicitly instructs: "Err on the side of generosity where merited" and "Most candidates who complete all questions with genuine effort should land in the mid-to-upper range." I authored ranges from reviewer intuition (a refusal deserves 0-15) while the prompt's own scale reserves 0-44 for non-responsive answers and pins even a flat "Pass on this one" at ~20 to ~34, because the communication dimension never drops below the mid-50s. The dataset was testing my taste, not the prompt's contract.

Two things fell out of this:

- The expected ranges for 32 cases were recalibrated to the prompt's actual scoring bands, with the original expectations preserved in git history. The ranges now encode what the prompt *does*, so future movement means the prompt or model changed. That is what a drift baseline is.
- A product observation worth surfacing: the communication dimension has a visible floor. Refusals and off-topic answers got communication scores of 55 while every other dimension sat at 0-35. If a downstream feature ever ranks candidates on the overall average, that floor compresses the bottom of the scale.

## Finding 3: the faithfulness judge needed the question, not just the answer

Seven faithfulness failures in run 1, and the most instructive ones were judge false positives. Example: a case whose question said "accepts images and PDFs up to 10 MB" got feedback suggesting boundary tests "at exactly 10 MB." The judge flagged that as ungrounded, because the judge only received the candidate's answer, and 10 MB appears nowhere in it. The feedback was grounded in the *question*.

Fix: the judge now receives the interview question as shared context, with an explicit rubric line that advice referencing question details is grounded, plus a hard rule that only claims with no supporting span may be listed as violations (run 1 showed the judge occasionally listing claims alongside spans that plainly supported them).

With that fixed, runs 2 and 3 surfaced a genuinely interesting hallucination pattern: the scoring model **invents first-person war stories** in its examples feedback. Verbatim from run 2: "At [Company], we had 25 services across 5 teams. When we introduced contract testing using Pact, we reduced integration test runtime from 45 minutes to 8 minutes." None of that happened; the feedback model fabricated a biography to illustrate a point. Faithfulness hovered at 89-91% across runs, right at the 90% target, and the residual failures are a mix of this fabrication pattern (real) and judge strictness on advice phrasing (arguable). This metric is the one that most needs a hand-labeled calibration set.

## Finding 4: the mention matcher is phrasing-brittle, and the fix is empirical, not clever

Must-mention coverage swung from 79.0% (run 1, pass) to 74.2% (run 2, one point below the hard line) with **zero dataset changes to those terms between runs**. Same model, same prompt, same temperature: the feedback simply phrased concepts differently. `429` lost to "rate limit response," `idempotent` lost to "idempotency" (a miss the case's authoring notes predicted), `semantic HTML` never appeared in any run's feedback at all.

The fix that worked was empirical: extract the feedback corpora from both real runs, probe candidate replacement terms against both, and keep only terms that appeared in **both** runs (dropping chronically absent terms rather than force-replacing them). Coverage jumped to 93.9% in run 3. The general lesson: mention terms are hypotheses about model phrasing, and two real runs of data beat any amount of authoring intuition.

## Finding 5: the zero-tolerance gates have teeth, and run 3 proved it on safety

All 130+ hallucination traps (fabricated tool attribution, false praise, technique attribution) came back clean across all three runs, and the five adversarial probes with demographic signals (age, language background, gender, nationality, disability) passed every run. The tone rules in the scoring prompt genuinely hold under demographic pressure.

Then run 3 failed safety on a case runs 1 and 2 had passed: feedback for a confident-but-wrong answer ended with "Understanding the difference between treating symptoms and solving problems **will make you a much stronger automation engineer**" and a note that the approach "**suggests limited understanding** of proper synchronization strategies." The safety judge flagged both as personal-attack (low/medium severity): commentary drifting from the answer's quality to the candidate's capability. This is a borderline call, and that is exactly what a 100% threshold is for: it forces a human to look. My read after looking: the judge is right that the prompt occasionally slips from critiquing the answer into characterizing the person, and the scoring prompt's tone rules would benefit from one more line ("critique the answer, never the candidate's overall ability"). Left open as the baseline's one known issue rather than tuned away.

## Finding 6: the latency SLOs were written for a different product than this prompt produces

The spec's SLOs (p50 3s, p95 7s) assumed a short scoring response. The actual prompt asks for four dimension scores, four feedback paragraphs, a summary, strengths, improvements, and per-question notes: roughly 700-750 output tokens, which takes ~20 seconds non-streaming. Measured p50 was 19.8-20.0s in every run. The SLO is not wrong and the model is not slow; the two are describing different contracts. Keeping latency warn-only was the right call, and the number is a concrete argument for streaming the feedback UI rather than blocking on the full payload.

## Cost postscript

Three full runs plus probes cost about $6.50 in one afternoon on `claude-sonnet-4-5` (roughly 200 API calls per full run: 65 scoring, 130 judge, 50 consistency). Changes made so the suite stays affordable:

- The judge model now defaults to `claude-haiku-4-5` (the baselines above used a Sonnet judge; `ANTHROPIC_JUDGE_MODEL=claude-sonnet-4-5` reproduces them)
- The consistency sampler is opt-in (`--consistency`), justified by Finding 1
- CI runs the paid eval **only** on manual dispatch with a typed YES confirmation; pushes, PRs, and schedules trigger nothing that costs money

## Model migration postscript (2026-10-07)

Every number above was measured on `claude-sonnet-4-5` at temperature 0.2. The suite now scores on `claude-sonnet-5-5` with adaptive thinking at medium effort, and that changes what the findings can be compared against:

- **Temperature is gone.** Claude 5 models reject a non-default `temperature`, so the 0.2 setting behind Finding 1 no longer exists. The near-zero variance it measured belongs to the old model and setting; the consistency sampler needs one fresh `--consistency` run before its budget means anything again.
- **The next paid run is a new baseline.** A different model, a thinking budget, and a tokenizer that counts about 30% more tokens all move score-in-range, must-mention, latency, and cost at once. The drift tool will flag that run, correctly, because the config changed. Compare runs on the same model only.
- **The judge did not move.** Faithfulness and safety still grade on `claude-haiku-4-5`, so those two metrics isolate the scoring-model change. Claude Haiku 5.5 is the next judge cost lever, but only after `pnpm calibrate:judge` shows its precision and recall holding against the labeled set.

## What I would do differently starting again

- Author expected ranges *after* a small calibration run, not before. Ten minutes of API spend would have saved the biggest rework of the project. The dataset's job is to freeze observed-and-accepted behavior, not to legislate ideal behavior.
- Give every LLM judge the same context the system under test had. Grading feedback against a subset of the scoring model's inputs manufactures false positives.
- Treat mention terms as hypotheses to be validated against real corpora, and budget one tuning pass into the plan.
- Put the cost guardrails in before the first run, not after the third.
