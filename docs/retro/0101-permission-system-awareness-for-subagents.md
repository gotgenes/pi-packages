---
issue: 101
issue_title: "Native permission-system awareness for in-process subagents"
---

# Retro: #101 — Native permission-system awareness for in-process subagents

## Stage: Planning (2026-05-25T12:00:00Z)

### Session summary

Produced a cross-package plan for integrating pi-subagents with pi-permission-system's `SubagentSessionRegistry`.
All three prerequisite issues (#98, #99, #100) are implemented.
The plan 0221 `SubagentSessionRegistry` is already wired in pi-permission-system — the work is entirely on the pi-subagents side.

### Observations

- The user chose to rely on pi-permission-system's `before_agent_start` handler for tool filtering (no pre-filtering in pi-subagents) and to forward `ask`-state permissions to the parent UI.
  Both choices simplify the pi-subagents changes to a single new module (`permission-bridge.ts`) plus a few lines in `agent-runner.ts`.
- The critical ordering constraint is: register before `bindExtensions()`, unregister in `finally`.
  This ensures `isSubagentExecutionContext()` returns true on the first check during child extension initialization.
- pi-permission-system requires zero changes — the registry, detection, and forwarding mechanisms are already in place.
- The `PermissionsServiceConsumer` interface follows ISP with only 2 methods, avoiding a dependency on the full `PermissionsService` surface.
- Patch 3 (`<active_agent>` tag) remains the agent-name signaling mechanism; the registry provides child-session detection and forwarding target resolution, not name resolution.

## Stage: Implementation — TDD (2026-05-25T20:30:00Z)

### Session summary

Completed all 5 TDD steps: `permission-bridge.ts` unit tests and implementation (5 tests), `agent-runner.ts` integration tests (5 new tests), runner integration, and architecture doc update.
Test count grew from 929 to 939 (+10 new tests across 59 files vs. the baseline 58).
All checks pass: type check, lint, fallow dead-code gate.

### Observations

- The `vi.mock`/`vi.hoisted` pattern for `#src/lifecycle/permission-bridge` integrated cleanly into the existing `agent-runner.test.ts` without disturbing the 10 pre-existing tests.
- `unregisterChildSession` was placed inside the existing inner `try/finally` around `session.prompt()` rather than wrapping the entire `bindExtensions()` → `prompt()` span in a second outer `try/finally`.
  This covers the `session.prompt()` throw case (which the tests verify) and avoids nesting complexity.
  A `bindExtensions()` failure would leave an orphaned registry entry, but that is harmless per the plan's risk analysis.
- No deviations from the plan's module-level changes: `permission-bridge.ts` added, `agent-runner.ts` modified, `architecture.md` updated.
- pi-permission-system required zero changes as anticipated.

## Stage: Final Retrospective (2026-05-26T01:15:00Z)

### Session summary

Shipped issue #101 across three sessions (planning, TDD, shipping).
The feature work (planning + TDD) was clean — 10 new tests, 3 new files, zero rework.
The shipping stage consumed more time than the feature work due to inheriting ~15 pre-existing lint violations from a silently broken CI pipeline.

### Observations

#### What went well

- The `ask_user` call during planning narrowed the two key design choices (tool filtering scope and `ask`-state policy) before any code was written, eliminating an entire category of rework.
- All 5 TDD steps executed in sequence without deviation from the plan — the plan's module-level changes matched the actual changes exactly.
- The cross-package Explore subagents gathered comprehensive context from both `pi-subagents` and `pi-permission-system` in ~100s, avoiding the serial exploration anti-pattern.

#### What caused friction (agent side)

- `rabbit-hole` — Biome/ESLint non-null assertion conflict.
  The agent attempted 3 different `biome-ignore` comment syntaxes and an `as string[]` cast before discovering that Biome bans `!` while ESLint auto-fixes `as T` back to `!`, creating an unsolvable loop.
  The fix was to eliminate the assertion with an explicit `if` guard.
  Impact: 3 CI push cycles wasted (~5 min each), totaling ~15 min.
- `missing-context` — The agent did not run `pnpm run lint` from the repo root before pushing.
  Package-level `pnpm run lint` passed, but CI runs root-level lint which covers all packages.
  Impact: first CI failure was avoidable; would have been caught locally.
- `rabbit-hole` — Investigating why `7b32e6a` CI passed despite identical lint violations.
  The agent ran `git show`, `git merge-base`, `git diff` across ~8 commits and ran `biome check` against the old state before concluding it was a CI ghost pass.
  Impact: ~5 min spent on diagnosis that didn't change the fix approach.
  The user's "Why are we hitting these now?" question was the right redirect.
- `wrong-abstraction` — First attempt at `biome-ignore` used trailing inline syntax (`code; // biome-ignore ...`) which Biome does not support (comments must go on the line above).
  Impact: one wasted CI cycle.

#### What caused friction (user side)

- The user redirected doc scope ("Did we update all our docs?") after the TDD stage — the `subagent-integration.md`, `README.md` updates, and the stale third-party extension table were missed.
  Earlier mention of doc scope expectations during the `/tdd-plan` stage would have avoided the extra round-trip.

### Diagnostic details

- **Escalation-delay tracking** — The Biome/ESLint assertion conflict consumed 7 consecutive tool calls (3 edit attempts + 4 CI verifications) before the agent identified the root cause (linter conflict) and switched to the elimination approach.
  At call 4 the agent should have paused to investigate the `eslint.config.js` rules instead of trying another suppression variant.
- **Feedback-loop gap analysis** — Root-level `pnpm run lint` was never run before the first push.
  The TDD stage ran `pnpm run lint` only in `packages/pi-subagents/`, which missed violations in sibling packages.
  Adding a root-level lint pre-check to the `/ship-issue` prompt prevents this class of failure.

### Changes made

1. `AGENTS.md` — Added "Biome / ESLint linter conflicts" subsection under Code Style: when both linters conflict on assertions, restructure to eliminate the assertion.
2. `.pi/prompts/ship-issue.md` — Added step 2 "Pre-push lint check": run `pnpm run lint` from the repo root before pushing.
   Renumbered subsequent steps (3→4, 4→5, 5→6, 6→7).
3. `packages/pi-permission-system/src/handlers/` — Replaced `const { session } = this` destructuring with direct `this.session` access in `before-agent-start.ts`, `lifecycle.ts`, and `permission-gate-handler.ts`.
   Removed all 3 `biome-ignore` comments that suppressed the resulting false positive.
