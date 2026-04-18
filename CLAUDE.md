This repo implements the LLM evaluation suite described in PROJECT_SPEC.md.
Always read PROJECT_SPEC.md before making structural decisions.

Non-negotiable rules:
- This repo will be public. AssertHired is private. See PROJECT_SPEC.md Section 13.
- The golden dataset is fully synthetic. Never import, derive, or fabricate from real AssertHired data.
- Work in small, reviewable chunks. Present a plan and wait for confirmation before scaffolding folders, generating dataset content, or adding dependencies.
- No em dashes in any docs or comments.

Tech stack: Node 20+, pnpm, TypeScript, Promptfoo, Vitest, GitHub Actions.
