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

[#1155]: https://github.com/gotgenes/pi-packages/issues/1155
