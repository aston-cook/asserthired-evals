# asserthired-evals

A reference implementation of an LLM evaluation suite for interview-scoring applications.

> Status: under construction. This repo is being built out in small, reviewable chunks. See [PROJECT_SPEC.md](PROJECT_SPEC.md) for the full v1 scope.

## What this is

Interview-scoring LLMs are a high-trust surface. When the scoring prompt, model, or temperature changes, regressions ship silently unless you have tests that exercise the surface end to end. This repo is one way to build that safety net.

It is framed as a reference implementation that any team building an AI interview or feedback product could adapt. AssertHired is the motivating example, not the subject being documented.

## Tech stack

Node 20+, pnpm, TypeScript, Promptfoo, Vitest, GitHub Actions, Claude via the Anthropic API.

## Running locally

Not yet runnable. Dependencies, graders, and the Promptfoo config land in the next chunks. Check back once the scripts in `package.json` are wired up.

## Roadmap

See [PROJECT_SPEC.md](PROJECT_SPEC.md) for the full plan. High-level sections:

1. Repository skeleton (this chunk)
2. Golden dataset schema and 60 synthetic cases
3. Seven graders and Vitest coverage
4. Promptfoo config and local end-to-end run
5. GitHub Actions CI with thresholds and PR comments
6. Reports, trend view, and the public writeup
