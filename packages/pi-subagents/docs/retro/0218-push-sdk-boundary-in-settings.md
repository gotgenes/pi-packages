---
issue: 218
issue_title: "Push SDK boundary in settings.ts (Phase 13, Step 5)"
---

# Retro: #218 — Push SDK boundary in settings.ts

## Stage: Planning (2026-05-26T17:01:55Z)

### Session summary

Produced a 3-step TDD plan to inject `agentDir: string` into `SettingsManager` and `loadSettings`, removing the only Pi SDK import from `settings.ts`.
The change is straightforward — a single parameter addition threading through constructor, free function, and boundary wiring.

### Observations

- The change is entirely mechanical: no design ambiguity, no new abstractions, no breaking public API.
- The main implementation effort is in test updates (~35 `new SettingsManager(...)` call sites plus ~15 `loadSettings(...)` calls), all requiring an `agentDir` argument.
- All test `describe` blocks that manipulate `PI_CODING_AGENT_DIR` env var can drop that scaffolding entirely, simplifying setup/teardown.
- `saveSettings` has no SDK dependency and needs no signature change — only `loadSettings` calls `globalPath()`.

## Stage: Implementation — TDD (2026-05-26T17:13:26Z)

### Session summary

Completed all 3 plan steps across 2 commits plus 1 doc commit.
All 970 tests pass; `settings.ts` now has 0 Pi SDK imports and all `PI_CODING_AGENT_DIR` env var manipulation is gone from `settings.test.ts`.

### Observations

- **Steps 1+2 combined:** Changing `loadSettings(cwd)` to `loadSettings(agentDir, cwd)` forced updating `SettingsManager.load()` in the same commit — they were inseparable (esbuild skips type checks, so the old call compiled but produced wrong runtime behavior).
  The two production changes landed in one commit with a note in the body.
- **Test simplification was significant:** Removed `originalAgentDirEnv` save/restore scaffolding from 5 `describe` blocks; the test code shrank by 32 lines net.
- **`/nonexistent` sentinel:** Tests that construct `SettingsManager` but never call `load()` pass `agentDir: "/nonexistent"` — a clear signal the field is unused in that scope.
- Architecture doc Step 5 heading marked `✓` and folded into the last `feat:` commit by `pi-autoformat`.

## Stage: Final Retrospective (2026-05-26T17:22:11Z)

### Session summary

Issue #218 went from plan to shipped release (`pi-subagents-v7.8.0`) in a single continuous session.
Planning, TDD (2 feat commits + 1 doc commit), shipping, CI verification, issue close, and release-please merge all completed without user intervention beyond stage transitions.

### Observations

#### What went well

- **Clean mechanical execution:** The entire change was 2 production files (`settings.ts`, `index.ts`) and 1 test file, with zero unexpected test breakage and zero rework commits.
- **Test simplification payoff:** Removing `PI_CODING_AGENT_DIR` env var scaffolding from 5 `describe` blocks shrank the test file by 32 lines net — a tangible improvement in test readability.
- **Ship stage model efficiency:** The `/ship-issue` stage ran on `deepseek-v4-flash`, which was appropriate for the purely mechanical push/CI/close/merge workflow.

#### What caused friction (agent side)

1. `wrong-abstraction` — The plan split steps 1 and 2 into separate commits, but changing `loadSettings(cwd)` to `loadSettings(agentDir, cwd)` immediately broke `SettingsManager.load()` which calls it.
   The agent recognized this during the red phase and combined them into one commit.
   The existing testing skill rule ("When a TDD plan lists separate steps that share a type definition… fold them into one step") already covers this — the plan just didn't apply it.
   Impact: added friction but no rework; recognized on first test run.
2. `missing-context` — Attempted to add `| ✓ #218 |` as an extra column to one row of the architecture doc's findings table, creating a column-count mismatch.
   The autoformatter reverted the broken table.
   The agent then spent ~5 tool calls (`git show --stat`, `git status`, `grep` ×2, `read`) investigating what happened before switching to the Step 5 heading approach.
   Impact: ~2 minutes of investigation; no rework beyond the heading edit.

#### What caused friction (user side)

- The user asked "Are we ready for shipping?" which surfaced that the TDD retro stage notes were still uncommitted.
  This was a useful checkpoint — the ship stage committed them before pushing.
  Opportunity: the `/tdd-plan` prompt could commit retro notes as part of its final step, but the current flow (write notes, then commit in ship) is lightweight enough that enforcing it would add complexity for marginal gain.

### Changes made

1. Retro file updated at `packages/pi-subagents/docs/retro/0218-push-sdk-boundary-in-settings.md` — no other files changed.
