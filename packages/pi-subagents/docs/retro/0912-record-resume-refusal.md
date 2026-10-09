---
issue: 912
issue_title: "pi-subagents: no way to ask whether an agent is resumable before calling resume"
---

# Retro: #912 — pi-subagents: no way to ask whether an agent is resumable before calling resume

## Stage: Planning (2026-10-09T05:14:29Z)

### Session summary

Planned Phase 23 Track B's second step: `SubagentRecord` gains `resumeRefusal?: ResumeRefusal`, copied in `toSubagentRecord` from the existing `Subagent.resumeRefusal` getter, with decision 0005 amended to admit it.
The plan is two commits: a `feat:` (field, copy line, adapter tests) and a `docs:` (decision 0005, README, package skill, architecture `✅`/`Landed:`).

### Observations

- The operator chose the record field (Option A) over a `resumeRefusalFor(id)` service query at the design gate.
  The deciding facts: a `listAgents()` roster gets the answer per row without N+1 calls, and the query would have needed `unknown-agent` in its return type to keep `undefined` from meaning both "resumable" and "no such agent".
- The decision 0005 argument: the value is `status` (already admitted) plus two one-way latches (`_sessionReleased`, `workspaceBracket.wasDisposed()`), so it is no staler than `status`.
  Rule 2's list never named lifecycle status even though the table admits `status` on that basis, so the amendment names it explicitly.
- Spike measured the blast radius: applying the copy line turned exactly 3 of 42 `service-adapter.test.ts` tests red, which are the predicted exact `toEqual` tests, because `createTestSubagent` defaults to completed with no session (`no-session`).
- Ride-along found while reading: `pendingQuestion` was admitted to `SubagentRecord` by `81863e41` with no decision 0005 row and no mention in the README field list; both are fixed in the docs step, since that step edits the same table and sentence.
- The Tidy-First assessor recommended no preparatory commits; it pointed out that `workspace-disposed` needs a real `run()` to reach, so the adapter tests pin the copy with `session-released` and leave per-reason composition to the eight existing getter tests in `test/lifecycle/subagent.test.ts`.
- No follow-up issues filed.
  [#1013] may widen `ResumeRefusal` with a queued-for-resume member; it would now reach the record as well as `ResumeResult.reason`, which that plan must classify.

## Stage: Implementation — TDD (2026-10-09T05:33:20Z)

### Session summary

Both plan steps landed: the `feat:` commit adds `resumeRefusal?: ResumeRefusal` to `SubagentRecord` and one copy line in `toSubagentRecord`, and the `docs:` commit amends decision 0005, the README contracts, the package skill, and the architecture roadmap.
The pi-subagents suite went from 2097 to 2100 tests (3 new; 3 exact `toEqual` tests updated).

### Observations

- Red came up 5 failing and 1 green by construction (the omission test asserts absence); killing mutation (a), deleting the copy line, turned all 5 red, and mutation (b), the unconditional copy, turned exactly the omission and roster tests red, as the plan predicted.
- One process slip: the mutation-(b) `Edit` was batched beside the `cp` restoring the green file, so the batch raced and the edit missed; re-applied sequentially.
  The prompt's rule against batching the restore with the mutating `Edit` is the one that applies.
- No deviation from the plan's Module-Level Changes; `src/persisted-record.ts` stayed untouched as predicted.
- Pre-completion reviewer: WARN, then PASS on the delta.
  The WARN was the #1051 roadmap step's constraint ("`SubagentRecord` is unchanged"), which the plan had flagged as a baseline shift but left unedited; fixed by `docs(pi-subagents): note resumeRefusal in the #1051 record constraint`.

[#1013]: https://github.com/gotgenes/pi-packages/issues/1013

## Stage: Sync (worktree) (2026-10-09T05:35:33Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) passed; the reviewer's earlier WARN was already fixed and re-reviewed to PASS, so nothing was open at sync.
The plan's marker is `**Release:** ship independently`; no follow-ups were filed.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-912--/2026-10-09T05-03-10-805Z_01a11f0b-35d4-72e8-aef9-c24994c0b2c4.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

The `feat:` commit is the only release vehicle; everything else is `docs:`.
