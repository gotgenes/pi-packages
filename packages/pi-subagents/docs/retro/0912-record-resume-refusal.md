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

[#1013]: https://github.com/gotgenes/pi-packages/issues/1013
