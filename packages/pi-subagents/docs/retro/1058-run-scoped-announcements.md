---
issue: 1058
issue_title: "pi-subagents: withheld notifications cross resume boundaries and emit stale or contradictory run status"
---

# Retro: #1058 — pi-subagents: withheld notifications cross resume boundaries and emit stale or contradictory run status

## Stage: Planning (2026-11-27T16:39:14Z)

### Session summary

Planned threading the finished run (and the run an update joined) through the observer chain, so the completion nudge, the update announcement, the lifecycle event, and the persisted `subagents:record` entry all read the run they are about rather than the record's current run.
The plan is eight steps: a test-run fixture, two pure-helper refactors, the per-agent hook refactor, then three `fix:` steps (event and entry, withheld completion, withheld update) and a docs step.
Filed [#1155] for an aborted run's late completion disposing its resume's workspace.

### Observations

- Third-party issue (tonybro233); the operator confirmed the direction: fix it, **drop** a replaced run's withheld completion (supersede, today's rule) rather than deliver it as historical, and **thread the run** explicitly rather than pin `record.latestRun` inside the notifier.
  The operator asked what the mechanism options meant before choosing; the explanation that landed was "the notice names the agent, not the run".
- Planning found a trigger the issue omits: abort, then resume before the aborted run's turn loop unwinds.
  With the parent idle, the late `onRunFinished` sends the same contradictory nudge at once, emits `subagents:completed` with `status: "running"`, and persists `running`.
- Reproduction: a disposable vitest spike (deleted) on `main` through the real `Subagent.run`/`resume`/`abort` and `NotificationManager`; synthetic fixtures, n=1 per case (deterministic); all four cases reproduced.
- The tidy-first assessor recommended `createTestRun` (step 1) and an optional `it.each` merge folded into step 5; it rejected a `run = record.latestRun` default parameter as reintroducing the defect.
  It also flagged that `Subagent.claimed` loses its last `src/` reader at step 6 but keeps 16 test readers; the plan says to retarget rather than suppress if `fallow` flags it.
- `Co-authored-by: Tony Wong <27016195+tonybro233@users.noreply.github.com>` goes on steps 6 and 7: the design adopts the reporter's "retain the originating run with each announcement".
- Baseline: 2249 tests in 91 files; `pnpm fallow dead-code` exits 0.

#### Deferred tidyings

- `packages/pi-subagents/src/observation/notification.ts`: the three duration computations (`formatTaskNotification`, `buildNotificationDetails`, `buildEventData`) differ in fallback (`0` vs `Date.now()`); a shared helper was declined as a wrong abstraction.

## Stage: Implementation — TDD (2026-11-27T16:59:59Z)

### Session summary

All eight plan steps landed as eight commits, from the `createTestRun` fixture through the three `fix:` steps and the docs, then two follow-ups from the reviewer's WARN (a `style:` blank-line removal and a `docs:` wording fix).
The `pi-subagents` suite went from 2249 to 2268 tests; `check`, root `lint`, root `test`, and `fallow dead-code` are green, and `verify:public-types` passes unchanged.

### Observations

- Every named killing mutation reddened exactly the tests the plan predicted, including (ii) leaving the collected-then-resumed case green on consumption.
  The step 2 `toPersistedRecord` mutation (`completedAt: outcome.startedAt`) also killed three pre-existing tests, so it does not isolate the new test; the new test's discriminating signal is the record/run disagreement, which the ISP types make a compile-time property.
- The "gives way to the resumed run's completion" test stayed green during Red, as expected: the supersede-by-agent-id rule already held; mutation (iii) confirmed it pins the rule.
- `notification.test.ts` gained a `withLatestRun(record)` tuple helper so inline `createTestSubagent(...)` acts stay one call (`sendCompletion(...withLatestRun(...))`) rather than gaining a variable each.
- Step 5 also added `kind`-reading assertions through a typed `vi.fn<SubagentManagerObserver["onSubagentRunFinished"]>()`; the untyped `vi.fn()` assertions on `"initial"`/`"resume"` had escaped `tsc` and failed only at runtime.
- `Subagent.claimed` lost its last `src/` reader in step 6, as planned; `fallow dead-code` did not flag it, so its test readers were left alone.
- Deviation: the reviewer's WARN found `README.md` ("you hear it exactly once") and `docs/configuration.md` ("Either way you see it once") overstated delivery for a run resumed before collection; both now say a resume before collection supersedes that run's notice and its updates.
  The plan had predicted the README unchanged because payload shapes did not change; the wording described delivery, not shape.
- Pre-completion reviewer: round 1 WARN (README wording, a stray blank line in `subagent.ts`, retro entry pending), round 2 (delta) PASS.
  The reviewer noted that a replaced, uncollected run's updates go from "exactly once" to "at most once", which is the operator's drop decision.

## Stage: Sync (worktree) (2026-11-27T17:06:58Z)

### Session summary

Root `pnpm run lint` and `pnpm fallow dead-code` pass on the branch before the rebase onto local `main`; the TDD stage's reviewer ended at a delta PASS with no open WARN.
The plan's marker reads `**Release:** ship independently`, and the three `fix(pi-subagents):` commits mean `/ship` should expect a `pi-subagents` patch release.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1058--/2026-11-26T21-54-29-374Z_01a219da-577d-706d-8e6c-29cdaa910df5.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- Follow-up [#1155] (an aborted run's late completion disposing its resume's workspace) stays open and untouched by this change.
- The two `fix:` notification commits carry `Co-authored-by: Tony Wong`; the close comment should credit the reporter's run-identity suggestion.

[#1155]: https://github.com/gotgenes/pi-packages/issues/1155
