---
issue: 1085
issue_title: "pi-subagents: /subagents:sessions labels a queued resume's queue time as running"
---

# Retro: #1085 — pi-subagents: /subagents:sessions labels a queued resume's queue time as running

## Stage: Planning (2026-10-24T16:56:35Z)

### Session summary

Reproduced the defect with a disposable spike that drove a real `Subagent` through `resume()` behind a `gatedScheduler`, then `stopQueued()`, and labeled each state with the real `listNavigableAgents`.
The operator chose [#1080]'s `queued <seconds>` wording verbatim (`queued · queued 3.0s`), and the plan moves `formatRunDuration` into `src/ui/display.ts` over a narrow `RunTiming` so `get_subagent_result` and the navigator share one decision.
The plan is a `refactor:` move, a `fix:` for the label, and the roadmap landing; the persisted (post-`/reload`) row was filed as [#1086] and dispositioned as the next Phase 23 step.

### Observations

- The spike surfaced a third path the issue omits: a resume stopped while queued is persisted to `subagents:record` without `stoppedWhileQueued`, so after `/reload` its snapshot row still reads `stopped · 3.0s`.
  The operator deferred it ([#1086]) rather than widening this step to a session-entry field.
- Rejected: a label-only branch that merges the status and duration segments (`· queued 3.0s`) to avoid the repeated word; the operator preferred one shared wording across carriers.
- The persisted loop passes `{ ...run, stoppedWhileQueued: false }` to `buildLabel`, a deliberate seam [#1086] deletes.
- The Tidy-First assessor recommended the `formatRunDuration` move as the one preparatory commit (now Step 1) and found no structural contradictions: `makeNavigable` is the only literal `NavigableSubagent`, and `formatDuration` has no caller outside the package and no direct test.
- The still-running `(running)` arm of `formatDuration` has no test today; Step 1's unit tests add one.
- The spike's in-memory released row came back unlisted because the stub session has no `outputFile`, so that row is pinned by a `makeNavigable` fixture only.

## Stage: Implementation — TDD (2026-10-24T17:05:01Z)

### Session summary

All three plan steps landed: the `refactor(pi-subagents)` move of `formatRunDuration` into `src/ui/display.ts` with four unit tests, the `fix(pi-subagents)` navigator label with four tests, and the roadmap landing (the check mark on the heading and the `S1085` node, plus a `Landed:` note).
The pi-subagents suite went from 2183 to 2191 tests (+8); `check`, root lint, and `fallow dead-code` stayed green.

### Observations

- Deviation: the plan made `formatDuration` private in Step 1, but `session-navigation.ts` still imported it there.
  Switching the navigator early would have changed the queued label inside a `refactor:` commit, so Step 1 kept the export and Step 2 (the `fix:`) made it private; both commit bodies say so.
  The planning miss was a Module-Level Changes entry that listed the export removal without re-checking the step that still had a caller.
- Red came up exactly as predicted: three navigator tests failed, and the persisted-row pin passed.
- Every planned killing mutation turned the predicted tests red.
  Step 2's first mutation was applied as `formatRunDuration({ ...fields, status: "running", stoppedWhileQueued: false })` rather than re-exporting `formatDuration`; it reproduces the old rendering without reopening the export.
  The persisted-loop mutation (`stoppedWhileQueued: true`) also reddened three existing persisted-row tests in `session-navigation.test.ts` and `session-navigator.test.ts`, which is consistent: it mislabels every persisted run, not only the stopped one.
- Pre-completion reviewer: PASS.

## Stage: Sync (worktree) (2026-10-24T17:09:36Z)

### Session summary

Pre-push `pnpm run lint` and `pnpm fallow dead-code` passed from the worktree root.
The plan's marker is `**Release:** ship independently`, with one `fix(pi-subagents):` commit (a patch) beside a `refactor:` move that cuts no release of its own; [#1086] (the persisted row) is filed and recorded as the next Phase 23 step, so it is not part of this land.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1085--/2026-10-24T16-06-25-566Z_01a16ea9-d21d-77b2-a6f5-bbaffc50c58b.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- The TDD stage's pre-completion review was PASS with no open WARN, so nothing is carried to `/ship`.

## Stage: Final Retrospective (2026-10-24T17:18:22Z)

### Session summary

The root session fast-forward-merged the peer branch, re-ran root lint and `fallow dead-code` on the merged tree, pushed, and saw CI pass on the pushed commit.
It closed #1085 with a comment anchored on the `fix(pi-subagents)` commit and released `pi-subagents-v25.0.3`, the only package in range, then tore down the worktree.
Across planning, TDD, sync, and ship the issue landed with no rework commits, and no stage needed an operator decision beyond the two planning gates (wording, and the #1086 disposition).

### Observations

#### What went well

- The planning spike drove a real `Subagent` through `resume()` behind a `gatedScheduler` and labeled it with the real `listNavigableAgents`, rather than a hand-built `NavigableSubagent`.
  That surfaced the persisted post-`/reload` row the issue never mentioned, which became [#1086] and was dispositioned against Phase 23 before the plan was written.
- Every TDD step ran its planned killing mutations with a `cp` backup and a `diff -q` restore check, and each mutation turned exactly the predicted tests red.

#### What caused friction (agent side)

- `instruction-violation` — the plan's Module-Level Changes made `formatDuration` private in Step 1 while `session-navigation.ts` still imported it until Step 2.
  `.pi/prompts/plan-issue.md` already says that a step removing an export breaks every importer in that commit, so the plan should have put the removal in the step that drops the last importer.
  The implementer caught it (self-identified, at implementation): it kept the export in the `refactor:` commit and removed it in the `fix:` commit, and both commit bodies say so.
  Impact: one documented deviation from the plan, no rework.
- `instruction-violation` — the peer hit two `pi-permission-system` deny rules that `AGENTS.md` names: `cd packages/pi-subagents` in planning, and `git commit -F -` with a heredoc in TDD.
  Both were self-corrected on the next call, guided by the rule's reason string.
  Impact: one wasted call each, which is the mechanism working as designed.
- `other` — the TDD stage-note commit hit the 60-second bash timeout once; the agent checked for a stale `index.lock`, found none, and the retried commit landed.
  Impact: three extra calls, no rework.
- `other` — the ship's pre-push gate call carried a stray `[ $? ] ; tail … | head -0` fragment that printed a `head` error.
  Both gates had already reported exit 0 through their own `echo`, so the error was noise.
  Impact: none.

#### What caused friction (user side)

- None observed.
  The operator's involvement was the two planning gates, both strategic: the wording choice and the #1086 deferral.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `claude-opus-5-5` (high thinking), while sync and ship ran on `claude-sonnet-5-5`, which suits mechanical git/CI steps.
  The `tidy-first-assessor` (5 turns) and `pre-completion-reviewer` (9 turns) both ran on `claude-sonnet-5-5`, per their own transcripts.
  No mismatch.
- **Feedback-loop gap analysis** — TDD ran a baseline `check`/`lint`/`fallow`/`test` sweep before Step 1, targeted Vitest runs plus `check` after each Green, and the full suite, root lint, and `fallow dead-code` before the `fix:` commit.
  Nothing was deferred to the end.

### Changes made

1. `packages/pi-subagents/docs/retro/1085-queued-navigator-label.md` gets this entry, and nothing else changed.
   The operator declined repeating the export-removal rule in `.pi/prompts/plan-issue.md`, because the rule already exists there and the miss cost no rework.

[#1080]: https://github.com/gotgenes/pi-packages/issues/1080
[#1086]: https://github.com/gotgenes/pi-packages/issues/1086
