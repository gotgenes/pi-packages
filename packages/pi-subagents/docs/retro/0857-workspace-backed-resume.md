---
issue: 857
issue_title: "pi-subagents: a resumed child re-enters a session whose workspace completeRun() already disposed"
---

# Retro: #857 — pi-subagents: a resumed child re-enters a session whose workspace `completeRun()` already disposed

## Stage: Planning (2026-09-02T04:31:54Z)

### Session summary

Verified the issue's diagnosis from source, established that the issue's own "re-prepare" option is not implementable, and gated the direction with the operator.
Committed `packages/pi-subagents/docs/plans/0857-workspace-backed-resume.md` (8 TDD steps), filed [#870] for the residual the design accepts, and recorded it as Phase 22 Step 12 by operator decision.

### Observations

The issue offered "re-prepare or refuse"; three independent facts kill re-prepare, and all three live in `packages/pi-subagents-worktrees/`, not in the core.
The session cwd is frozen at `createSubagentSession` time, `createWorktree` randomizes the path with a `randomUUID()` suffix, and `cleanupWorktree` commits the child's work to `pi-agent-<id>` before a fresh `git worktree add … HEAD` would check out the parent's HEAD.
A second cleanup would also collide on the branch name and fall back to `pi-agent-<id>-<timestamp>`.
Reading the one real provider before the gate is what turned a two-option issue into a three-option decision.

The operator chose Option 2 over the plain refusal: refuse as the safety net, plus hold the workspace when the child ends `completed` with a declared question.
Two follow-up forks were settled in a bundled gate — hold on `completed` only (so an aborted child still gets its rescue branch immediately), and a refusal message that names the mechanism rather than the actor.

`WorkspaceBracket.hasProvider()` is not the predicate the refusal needs: `WorktreeWorkspaceProvider.prepare()` returns `undefined` for any agent type outside `worktreeAgents`, so `hasProvider()` is true for every child in a session with the extension installed.
The new `wasDisposed()` keys on an actually-prepared workspace instead.

The Tidy-First assessor's `completeRun` reorder was accepted with one qualification.
It reported the reorder as behavior-preserving; it is behavior-preserving *for the existing suite*, but not byte-identical when a question block ends the output **and** an addendum exists, because `spliceOut` strips the addendum's leading blank line today.
That intersection cannot arise for a `completed` outcome under the new rule, and no existing test covers it — recorded in the plan as a scoped claim rather than the universal one.

Marker spelling: the protocol tag is `<question-for-parent>` (hyphens), not the underscored form the issue body and the roadmap step both use.

The addendum drop is real and was filed rather than hand-waved: a question-ending child that is never resumed disposes at `releaseSession()`, where `resultAddendum` has no reader, so the worktrees provider's `Changes saved to branch …` line is lost.
The preserved-worktree scan does not cover it — that scan reports *failed* cleanups, and this one succeeds.
The operator adopted [#870] as a new Phase 22 Step 12 rather than deferring it.

Baseline measured at planning time: 1447 tests across 74 files.

#### Deferred tidyings

- `packages/pi-subagents/src/tools/agent-tool.ts` — the assessor considered extracting the whole resume branch out of `execute()` before a third refusal guard lands in it, and declined: the new check is one more early return, structurally identical to the two already there.
  Recorded in case the branch grows a fourth.
- `packages/pi-subagents/src/lifecycle/subagent.ts` — a shared `holdForResume` predicate between `completeRun` and `completeResume` was left inlined as a one-line boolean at both sites; worth revisiting only if a third site appears.

[#870]: https://github.com/gotgenes/pi-packages/issues/870

## Stage: Implementation — TDD (2026-09-02T05:01:50Z)

### Session summary

Executed all eight plan steps — three Tidy-First preparatory commits, two `fix:` commits, two `docs:` commits — with no step reordered or dropped.
Test count went 1447 → 1476 across 74 → 75 files.
Pre-completion reviewer: PASS.

### Observations

The plan's step-4 mutation prediction was wrong in a way worth recording: it claimed a constant-`false` `wasDisposed()` would kill "the four bracket-state tests and the `Subagent` getter test".
A constant can only kill the assertions that disagree with it, so `return false` killed the 3 positive assertions and `return true` killed the 6 negative ones.
Running both directions is what made the 9-test set fully mutation-verified; running only the one the plan named would have left 6 tests unproven.
A boolean accessor needs both mutation directions, not one.

Six of the eleven new tests in step 5 passed during Red.
Each was a genuine regression pin rather than a broken probe, but only because they were checked: "disposes when the retention sweep releases the session" was green pre-fix for the *wrong reason* — `completeRun` had already disposed — and became meaningful only once the hold rule stopped it from doing so.
Deleting the `releaseSession` call turned it red, which is the evidence; the Red run was not.

The `!this.isActive()` guard went into its own private `disposeHeldWorkspace()` rather than being spelled inline at both catch-all call sites as the plan sketched.
One home for the guard, and the two callers read as one line each.

The reorder's accepted whitespace edge was independently re-derived by the reviewer and confirmed unreachable for a `completed` outcome, which is the only outcome that holds.
It survives only for an aborted or steered run that declared a question under a workspace returning an addendum, and it is whitespace-only — `pendingQuestion` is byte-identical either way.

`makeFailingWorkspaceProvider` was drafted into the shared test helper and removed before commit: the one failing-provider test builds its provider inline, so the export would have been speculative and `fallow dead-code` would have flagged it.

The reviewer's own enumeration of disposal edges found no leak path, including the two the plan did not name: abort-while-queued (`guardedRun`'s guard means `run()` never prepares a workspace) and `abort()` on a running agent (the turn loop resolves `aborted: true`, which takes the unconditional-dispose branch).
