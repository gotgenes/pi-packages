---
issue: 13
issue_title: "Consolidate duplicate session_start handlers in index.ts"
---

# Retro: #13 — Consolidate duplicate session_start handlers in index.ts

## Final Retrospective (2026-05-02T18:45:00Z)

### Session summary

Planned, implemented, and shipped issue #13 across three prompt templates (`/plan-issue`, `/tdd-plan`, `/ship-issue`).
The fix deleted the second duplicate `session_start` handler from `src/index.ts` so startup side effects run exactly once per session start.
Released as v0.6.1 with no breaking changes.

### Observations

#### What went well

- The plan correctly identified that handler 2 is a strict subset of handler 1, making the fix a pure deletion with no merge logic needed.
- TDD step 1 caught the duplicate immediately: the test asserted `toHaveLength(1)` against a registrations array (instead of the existing `handlers[name] = handler` mock that silently overwrote), confirming the bug before fixing it.
- The `AGENTS.md` "Runtime Caveats" section added during the #6 retro was removed in the same session that fixed the underlying issue — clean lifecycle from caveat to resolution.

#### What caused friction (agent side)

1. `instruction-violation` — After running `npm run lint:fix`, I committed a `style:` commit (`67dfd60`) with Biome formatting changes to `src/index.ts` that my local Biome produced differently from CI's pinned version.
   CI failed because the local Biome reformatted `Boolean(...)` expressions with 4-space indentation while CI expected 6-space.
   Self-identified after CI failure.
   Impact: 2 extra commits (`67dfd60`, `6a946e0`), one CI failure, ~5 minutes of rework.

2. `instruction-violation` — Ran `git commit --amend` intending to amend the `test:` commit (`c4e1f53`) but it amended the `docs:` commit instead, mixing test file changes into a `docs:` commit.
   The `/tdd-plan` prompt explicitly says "The fixup must NOT land in a `docs:` commit."
   Self-identified immediately.
   Impact: had to `git reset --soft` and manually re-create 3 commits in correct order — ~4 extra tool calls.

3. `instruction-violation` — Did not run `git status` before declaring `/tdd-plan` complete.
   The Biome `lint:fix` had left unstaged changes in `src/index.ts`.
   User-caught ("Are all changes committed?").
   Impact: 1 extra user prompt, 1 extra `style:` commit cycle.

#### What caused friction (user side)

- The user had to ask "Are all changes committed?" — a mechanical verification check the agent should have performed.
  This is the same class of issue as the #6 retro's `.gitignore` miss: the agent declared completion without verifying a clean state.

### Changes made

1. `docs/retro/0013-consolidate-session-start-handlers.md` — this file.
2. GitHub issue #14 opened for pre-commit hook setup to prevent Biome version-skew issues from reaching CI.
