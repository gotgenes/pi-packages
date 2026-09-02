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
