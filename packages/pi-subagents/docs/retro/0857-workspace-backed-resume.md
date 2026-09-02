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

## Stage: Sync (worktree) (2026-09-02T05:03:28Z)

### Session summary

Pre-push checks both passed clean on first run: `pnpm run lint` (0 findings) and `pnpm fallow dead-code` (0 issues, 322 entry points).
No fixes needed before rebase.
The plan's `**Release:** ship independently` marker stands — no batch to coordinate, and the dispatch at ship time should name both `pi-subagents` and `pi-subagents-worktrees` (the latter for its `docs:` README commit).

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-857--/2026-09-02T03-15-11-510Z_01a0601d-0c16-7b7a-b1c3-e7726dc4490f.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

Nothing further to hand off: [#870] is already filed and dispositioned as Phase 22 Step 12, and no other deferred work surfaced during TDD.

## Stage: Final Retrospective (2026-09-02T05:18:12Z)

### Session summary

Landed `issue-857-pi-subagents-a-resumed-child-re-enters-a` on `main` by fast-forward, verified CI, closed the issue, released `pi-subagents-v21.2.2`, and tore down the worktree.
Every ship step succeeded on first attempt.
The retrospective found one substantive miss: `pi-subagents-worktrees` was never released, although the peer's sync note had named it explicitly.

### Observations

#### What went well

- Gathering the release decision from the plan's `**Release:**` marker **before** the ff-merge worked as designed.
  The marker read `ship independently`, so no operator gate was needed and no irreversible work preceded the decision.
- The peer's sync note recorded its own transcript path, which made the model-performance lens a single `read_session_file` call after the worktree had already been deleted.
- Every SHA in the close comment was resolved with `git rev-parse` before drafting and re-checked in the finished draft.
  Both hashes in the posted comment are real.

#### What caused friction (agent side)

- `missing-context` — the `/ship-worktree` release derivation (`grep -oE '^(feat|fix)\([^)]+\)'`) cannot see a releasing `docs:` or `chore:` commit.
  Both are visible groups in `cliff.toml` and cut a patch on their own.
  The range's `161e652d docs(pi-subagents-worktrees): note that a question-ending child keeps its worktree` was therefore invisible to the derivation.
  Impact: `pi-subagents-worktrees-v0.3.2` went unreleased, leaving a user-facing README change on `main` unpublished.
  Recoverable by one dispatch; no code rework.
- `missing-context` — step 5 directs a retro read for **close** targets only.
  I grepped `docs/retro/0857-workspace-backed-resume.md` with `-iE 'pull request|PR #|credit'` and never read the sync note's release handoff, which stated in plain text that the ship-time dispatch should name both `pi-subagents` and `pi-subagents-worktrees`.
  The peer had already done this analysis correctly; the ship half discarded it by reading the file through too narrow a pattern.
  Impact: the second, independent chance to catch the miss was skipped.
  Self-identified, but only during this retrospective — after the release had gone out.
- `other` — the final report asserted "no sibling package release was owed", a negative the derivation was structurally incapable of establishing.
  Impact: no rework, but the report read as verified when it was merely consistent with an incomplete filter.

#### What caused friction (user side)

None.
The session took no operator input, which is correct for a ship flow whose one gate (`mid-batch — defer`) did not trigger.

### Diagnostic details

- **Model-performance correlation** — the TDD peer session ran on `anthropic/claude-opus-5`, the worktree sync on `anthropic/claude-sonnet-5`, and this ship-plus-retro session on `anthropic/claude-opus-5`.
  The sync's downgrade to sonnet matches its mechanical work well.
  The ship half is likewise mostly mechanical — merge, push, watch, dispatch, teardown — with one judgment task in the close comment, so opus is a mild cost mismatch there; the retrospective half is judgment-heavy and justifies it.
- **Unused-tool detection** — `./scripts/release/next-version.sh` was available and authoritative, and was run for the one package the grep produced.
  Running it for every package the range **touched** would have surfaced the miss in a single extra call.
- **Feedback-loop gap analysis** — no verification gap.
  The peer ran `lint` and `fallow dead-code` clean at sync time, and the root gated on the real CI run before closing or releasing.
  The gap was not a missing check but a derivation whose output was never cross-checked against `next-version.sh` for the packages it did not name.

### Changes made

1. `.pi/prompts/ship-worktree.md` — step 6.2 now derives release candidates from the paths the range touched (`git diff --name-only … | sed -n 's#^packages/\([^/]*\)/.*#\1#p'`) instead of a `^(feat|fix)\(` scope grep, with a note that `docs:` and `chore:` are visible changelog groups and that `next-version.sh` is the authority.
2. `.pi/prompts/ship-worktree.md` — Release coordination gained a third item directing a full read of the retro's `## Stage: Sync (worktree)` entry as a release-candidate source, not only a close-target source.
3. `.pi/prompts/ship-issue.md` — the identical commit-type grep on the trunk flow was replaced with the same path-based derivation; the bug was latent there too.
4. Dispatched the missed release: `pi-subagents-worktrees-v0.3.2` (run 33594451056), publishing the `docs(pi-subagents-worktrees)` README note that this issue's range had bumped.

Verification: against this issue's own range the new derivation returns both `pi-subagents` and `pi-subagents-worktrees`, where the replaced grep returned only `fix(pi-subagents)`.
