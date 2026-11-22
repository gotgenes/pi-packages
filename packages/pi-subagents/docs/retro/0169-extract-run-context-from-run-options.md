---
issue: 169
issue_title: "refactor(pi-subagents): extract RunContext from RunOptions (12 fields)"
---

# Retro: #169 — extract RunContext from RunOptions

## Stage: Planning (2026-05-24T17:07:10Z)

### Session summary

Produced a plan to extract 4 parent-context fields (`exec`, `registry`, `cwd`, `parentSession`) from `RunOptions` into a nested `RunContext` interface.
The plan is a single-step refactor (all changes in one commit) plus a comment-update commit, affecting 3 source files and 3 test files.

### Observations

- The issue body proposed flat `parentSessionFile`/`parentSessionId` fields on `RunContext`, but #166 already grouped these into `ParentSessionInfo`.
  The plan uses `parentSession?: ParentSessionInfo` instead, preserving the existing grouping.
- `RunOptions` is purely internal — not exported via `service.ts` — so the refactor is non-breaking.
- All test call sites construct `RunOptions` inline (no `Partial<RunOptions>` spread patterns), so TypeScript will catch any missing `context` field at compile time.
- The change is small enough to land in a single TDD step — no lift-and-shift needed.
- Prerequisite #164 (directory reorganization) is already implemented.

## Stage: Implementation — TDD (2026-05-24T17:14:32Z)

### Session summary

Completed both TDD steps in one session.
Step 1 defined `RunContext`, updated `RunOptions`, migrated `runAgent()` reads to `options.context.*`, restructured `AgentManager.startAgent()`, and updated all 16 test call sites across 3 test files.
Step 2 updated comment references in `runtime.ts` and `session-config.ts`.
Test count unchanged (50 files, 805 tests — pure refactor with no behavior change).

### Observations

- The `agent-manager.test.ts` update also added two new assertions (`context.exec` and `context.registry` are defined) to each existing `getRunConfig` threading test, confirming the context object is wired correctly; these were not in the plan but add useful coverage.
- All 16 `runAgent()` call sites in tests used inline option literals (no spread patterns), so TypeScript caught any missed site at compile time — the plan's risk mitigation held.
- No deviations from the plan otherwise; the comment-only step was trivial.

## Stage: Final Retrospective (2026-05-24T17:32:52Z)

### Session summary

Completed the full issue lifecycle (plan → TDD → ship → retro) in a single conversation.
The refactor extracted 4 parent-context fields from `RunOptions` into a nested `RunContext` interface, updating 3 source files and 3 test files.
Released as `pi-subagents-v6.18.6`.

### Observations

#### What went well

- The plan correctly adapted the issue's stale proposed interface (flat `parentSessionFile`/`parentSessionId`) to match the already-implemented `ParentSessionInfo` grouping from #166.
  This prevented a design conflict and kept the extraction consistent with prior work.
- All 16 test call sites used inline option literals — no spread patterns — so TypeScript caught every missed migration site at compile time.
  The plan's risk analysis predicted this correctly.
- Single-step TDD was appropriate for this scope; no lift-and-shift was needed.

#### What caused friction (agent side)

- `missing-context` — After the TDD step, checked the architecture doc for staleness by running `grep` for the exact symbols `RunOptions` and `RunContext`.
  The doc's "Dependency bag inventory" table and "Proposed bag decompositions" section used prose descriptions ("12 fields", "High") rather than code identifiers, so the grep found no matches and the agent skipped the update.
  The user then asked "Is the architecture doc up to date?" which prompted a three-fix commit (`ea49fe1`).
  Impact: one extra round-trip with the user; no rework to code, but an extra commit that could have been folded into the TDD step.

#### What caused friction (user side)

- No friction observed on the user side.
  The user's single question ("Is the architecture doc up to date?") was well-timed and caught the only gap.
