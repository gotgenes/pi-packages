---
issue: 373
issue_title: "Extract SubagentState; make Subagent execution deps mandatory"
---

# Retro: #373 — Extract SubagentState; make Subagent execution deps mandatory

## Stage: Planning (2026-06-14T03:34:51Z)

### Session summary

Produced the implementation plan at `packages/pi-subagents/docs/plans/0373-extract-subagent-state.md`.
The architecture doc (Phase 17 Step 2 + "First-principles refinement") already specified the design precisely and the issue body matched it, so planning was confirmation-and-detailing rather than discovery.
Issue is first-party (`gotgenes`) and unambiguous — skipped the `ask_user` gate.

### Observations

- **Not breaking** for the published surface: `src/service/service.ts` exposes `SubagentRecord`/`SubagentStatus`/spawn-config, never `SubagentInit` or the `Subagent` constructor.
  Only the internal constructor signature changes.
- **Single production construction site** confirmed: `SubagentManager.spawn` (~line 139) is the only `new Subagent(...)` outside tests — this is what makes mandatory execution deps viable.
- **Observer retarget is required**, not optional: making execution mandatory would otherwise force `record-observer.test.ts` to stub execution.
  Pointing `subscribeSubagentObserver` at `SubagentState` (and dropping the record from `onCompact`, closing over `this` in `subagent.ts`) is the move that lets observer tests target `SubagentState` directly.
- **`resume()`'s missing-session throw stays** — it guards a genuine runtime state, not a construction concern.
  Only the two `run()` "not configured for execution" throws are deleted.
- **`SubagentStatus` home**: moved to `subagent-state.ts` but re-exported from `subagent.ts` to keep `service.ts`'s import path (and the public type bundle path) unchanged, and to avoid a circular import.
- **Lift-and-shift for the large test file**: `test/lifecycle/subagent.test.ts` (~700 LOC).
  Step 1 funnels constructions through a local helper and moves the state-machine `describe` blocks to the new `subagent-state.test.ts`, so Step 3's mandatory-execution flip is bounded to the helper + two run/resume factories.
  Step 3 is unavoidably one atomic commit (removing optional fields breaks every construction at the type level at once).
- **Doc updates identified**: `architecture.md` (lifecycle file listing, `Subagent` class diagram, mark Step 2 ✅ Complete, Phase 17 prose ~line 879, type-complexity table ~line 649) and `SKILL.md` (Lifecycle 10→11 modules, total 56→57 files).
- Deferred per scope boundary: metrics-as-projection and result-delivery domain extraction (the other two of the four conflated domains).

## Stage: Implementation — TDD (2026-06-14T09:23:00Z)

### Session summary

Executed all four planned steps as separate commits: (1) extract `SubagentState` value object + new `subagent-state.test.ts`, (2) retarget `subscribeSubagentObserver` at `SubagentState`, (3) the atomic flip making `SubagentExecution` a mandatory collaborator and deleting the two `run()` throws, (4) docs.
Test count moved 966 → 967 (net): +26 new `SubagentState` tests, minus the migrated state-machine duplicates and the obsolete missing-factory test.
Pre-completion reviewer returned **PASS**; `check`/`lint`/`test`/`fallow` all clean.

### Observations

- The plan held exactly — every file in Module-Level Changes was touched and nothing else.
  The `createTestSubagent` consumers (`conversation-viewer`, `notification`, `get-result-tool`, `make-subagent.test`) stayed untouched as predicted; the helper absorbed the construction change via a `TestSubagentOptions` shape that splits passive-state shorthands from identity/execution.
- **Explicit-`undefined` preservation** (testing-skill warning) mattered: `createTestSubagent` and the local `makeSubagent` build their `SubagentState` via spread of the rest-captured state overrides (`{ defaults, ...stateOverrides }`) so callers passing `completedAt: undefined` (running-status records in `get-result-tool.test`) still get `undefined`, not the `2000` default.
- The lift-and-shift prep in Step 1 (local `makeSubagent` helper + perl-routing the single-line constructions) paid off: Step 3's breaking flip only had to edit the helper, `createRunnableAgent`, `createResumableAgent`, `createCompletionAgent`, and the constructor describe — not the whole file.
- Removed the obsolete "throws when the session factory is missing" test (the guard is gone by construction); the construct-complete invariant is now type-level, not runtime-testable.
  An initial replacement comment was dropped per reviewer/operator feedback as unhelpful.
- `SubagentExecution` carries 12 fields (4 mandatory).
  Reviewer flagged it as wide but accepted per the plan's recorded decision to keep it concrete rather than split further.
- Pre-completion reviewer: **PASS** (no WARN findings).

## Stage: Final Retrospective (2026-06-14T17:20:00Z)

### Session summary

Shipped #373 end-to-end across one conversation spanning Planning → TDD → Ship → Retro: four implementation commits, CI green, issue closed, no release-please PR (a `refactor:`-only change does not trigger a release).
The plan held exactly — zero rework, and the pre-completion reviewer returned PASS with nothing to fix.
The single user intervention was a one-line comment removal during TDD Step 3.

### Observations

#### What went well

- **Plan-to-ship with zero rework.**
  Every file in the plan's Module-Level Changes was touched and nothing else; the `createTestSubagent` consumers stayed untouched exactly as predicted.
  The lift-and-shift prep (Step 1 funneling constructions through a local `makeSubagent` helper) bounded the breaking Step 3 flip to the helper plus three factories — the atomic-construction-change concern from the plan never materialized as churn.
- **Clean model allocation across stages.**
  Planning ran on `claude-opus-4-8`, TDD on `claude-sonnet-4-6`, Ship on `opencode-go/deepseek-v4-flash` (mechanical git/CI/close work), the pre-completion reviewer subagent on `claude-sonnet-4-6`, and Retro on `claude-opus-4-8`.
  Judgment-heavy work landed on reasoning-strong models; the cheap model handled only the mechanical ship sequence.
- **Incremental verification.**
  `pnpm run check` ran after every TDD step (not just at the end), catching the shared-type breakage at the right boundary; the affected test files were run per-step before the full suite.

#### What caused friction (agent side)

- `other` (tombstone comment) — after removing the obsolete "throws when the session factory is missing" test in TDD Step 3, left a comment narrating the *absence* of the guard (`// No "missing session factory" guard: execution is a mandatory constructor collaborator …`).
  The user flagged it as unhelpful and asked for removal.
  Impact: one extra `Edit` + a blank-line cleanup + a `--amend` of the Step 3 commit.
  No behavioral rework; user-caught.

#### What caused friction (user side)

- None of consequence.
  The single intervention (comment removal) was light mechanical oversight on an otherwise self-driving session; no earlier context would have changed the outcome.

### Diagnostic details

- **Model-performance correlation** — no mismatch.
  The only subagent dispatch (pre-completion-reviewer) ran on `claude-sonnet-4-6`, appropriate for judgment-heavy review; it returned PASS.
  The Ship stage on `deepseek-v4-flash` was purely mechanical (git push, `ci_find`/`ci_watch`, `issue_close`, `release_pr_find`) and the one judgment point (the batch-vs-release `ask_user`) was handled correctly.
- **Escalation-delay / unused-tool / feedback-loop** — nothing notable: no rabbit-holes, no error-chasing sequences, and verification ran incrementally throughout.
  Lenses skipped.

### Changes made

1. `.pi/skills/code-design/SKILL.md` (§ Names over comments) — added a line forbidding tombstone comments that narrate removed code or the absence of a guard/test/branch, prompted by the user-caught over-comment in TDD Step 3.
