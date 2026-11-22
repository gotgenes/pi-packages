---
issue: 57
issue_title: "feat: structured debug logging for silenced catch blocks"
---

# Retro: #57 — structured debug logging for silenced catch blocks

## Final Retrospective (2026-05-19T10:30:00Z)

### Session summary

Added `src/debug.ts` with `debugLog` and `isDebug()`, then threaded `debugLog` into ~20 silent `catch` blocks across 9 files.
All 7 TDD cycles went green on the first pass with no rework.
Shipped as `pi-subagents-v5.1.0`, then followed up with a `refactor:` commit converting `DEBUG` (module-level constant) to `isDebug()` (function getter) during the retro.

### Observations

#### What went well

- The plan's "Non-Goals" section correctly excluded `usage.ts` and `settings.ts` before implementation started, and a post-TDD `grep -rn 'catch\s*{'` confirmed only those two in-scope-excluded files remained.
  Closing the loop with a verification query is worth repeating.
- The scope of the change was so well-defined (the issue listed exact file names) that no `ask_user` call was needed during planning.

#### What caused friction (agent side)

- `missing-context` — When loading the `ask-user` skill I guessed `.pi/skills/ask-user/SKILL.md` before reading the actual `<location>` tag in `AGENTS.md`, triggering an ENOENT error and a follow-up `find` call.
  Impact: 2 extra tool calls, no rework. (self-identified)

- `other` — The plan's TDD Order step 1 stated *"the test skill documents this pattern"* for `vi.resetModules()` + dynamic import when testing module-level env constants — but the testing skill does not have that entry.
  The aspiration was recorded rather than verified.
  During the retro, the user's question ("should that be a function getter instead?") led to a better outcome: replace the module-level constant with `isDebug()` so `vi.stubEnv()` alone works, consistent with how every other `process.env` read in this codebase is structured.
  Impact: one retro-phase `refactor:` commit; the approach shipped in `v5.1.0` was technically correct but unnecessarily complex to test.

#### What caused friction (user side)

- The initial issue proposal chose the module-level-constant pattern (common in Node.js tooling like the `debug` package).
  A note in the issue or plan about preferring function-based env reads for testability would have caught this at design time rather than post-ship.
  That said, the retro question was efficient — a single targeted redirect resolved it cleanly.

### Changes made

1. `packages/pi-subagents/src/debug.ts` — replaced `export const DEBUG` with `export function isDebug()`.
2. `packages/pi-subagents/test/debug.test.ts` — simplified to static import + `vi.stubEnv()` only; removed all `vi.resetModules()` + dynamic `import()` calls.
3. `.pi/skills/testing/SKILL.md` — added bullet: prefer reading `process.env` inside functions; `vi.stubEnv()` alone is insufficient for module-level constants.

## Follow-up Retrospective (2026-05-19T11:15:00Z)

### Session summary

The user asked how many `process.*` reads exist in `pi-subagents`.
Audit found 9 sites: 4 acceptable (wiring layer, detection functions, injectable defaults), 2 genuine injection gaps, and 1 mild case.
Filed #76 (`AgentManager.dispose()` reads `process.cwd()` without a stored `cwd`) and #77 (`createAgentsMenuHandler` hardcodes `process.cwd()` when `AgentMenuDeps` already injects the personal-side equivalent).

### Observations

#### What went well

- The `isDebug()` refactor naturally led the user to ask a broader design question about `process.*` access patterns, producing two well-scoped follow-up issues without manual triage.
- The audit categorization (genuinely problematic vs. acceptable) was clean — presenting a table with verdicts per site let the user decide scope without re-reading source.

#### What caused friction (agent side)

- `premature-convergence` — The original plan accepted the module-level `DEBUG` constant without checking how the rest of the codebase reads `process.env`.
  The code-style skill said "keep IO at the edges" but didn't name `process.*` specifically, so the rule wasn't applied.
  Impact: one post-ship `refactor:` commit to replace `DEBUG` with `isDebug()`; the pattern was technically correct but inconsistent with codebase conventions. (user-caught)

#### What caused friction (user side)

- Nothing notable.
  The user's two redirecting questions ("should that be a function?" and "how many places access `process.*`?") were well-timed interventions that broadened scope productively.

### Changes made

1. `.pi/skills/code-style/SKILL.md` — added bullet: do not read `process.env`, `process.cwd()`, or `process.platform` inside library/utility functions; accept the value as a parameter.
2. Filed #76 — inject `cwd` into `AgentManager` constructor.
3. Filed #77 — add `projectAgentsDir` to `AgentMenuDeps`.
