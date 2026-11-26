---
issue: 1111
issue_title: "pi-subagents: `/reload` silently aborts running background subagents"
---

# Retro: #1111 — pi-subagents: `/reload` silently aborts running background subagents

## Stage: Planning (2026-11-26T19:00:49Z)

### Session summary

Planned a transcript notice, posted by `SessionLifecycleHandler.handleSessionShutdown`, that lists the subagents a session shutdown stopped, for every shutdown reason.
The issue is third-party (@azavjalov), so the direction went through a gate: the operator chose the notice alone with Pi's default rendering, declined a guarded `/subagents:reload` command, and asked how the work fits with #1135 / PR #1136.
That discussion produced #1152 (filed this session) as a prerequisite of #1135, and a comment on #1135 linking it.

### Observations

- The issue says Pi "declined" queued reloads; earendil-works/pi#11462 and #10731 were both auto-closed `NOT_PLANNED` by Pi's new-contributor bot, not by a maintainer.
- The delivery mechanism was measured, not assumed: a disposable probe extension in RPC mode on Pi 1.6.1 showed a `pi.sendMessage({ display: true }, { triggerTurn: false })` from `session_shutdown(reason: "reload")` landing in `get_messages`, ordered before the reloaded instance's `session_start`, with no turn started.
  The same probe showed `globalThis` survives a reload (the module re-runs, the global does not reset); not used, but relevant to any future in-memory handoff design.
- The defect itself was confirmed in source, not reproduced with a live child.
- Seam placement: I first framed "a running child's `subagents:record` entry lands before `invalidate()`" as a #1111 follow-up; the operator asked why, and it does nothing for #1111 (the notice reads `abortAll()`'s return synchronously).
  Its consumers are #1135's restore and `/subagents:sessions`, so it became #1152, ahead of #1135.
  Whether a running child's entry already lands in time is unmeasured; #1152 opens with that test.
- The resume pointer (`subagent(resume: <id>)`) in the notice belongs to #1135, since only #1135 makes it true; recorded on #1135.
- The tidy-first assessor caught two things the design missed: `test/print-mode.test.ts` stubs `sendMessage` to throw `"stale extension context"`, so the send needs a `try`/`catch` or a throw would skip `manager.dispose()` (#709 child teardown); and `lifecycle.test.ts`'s default `mockAbortAll = vi.fn()` returns `undefined`, which would throw on `.length`.
  It also noted that `fallow --symbol-impact` on `SubagentManager.abortAll` misses the structural consumers in `index.ts`.
- The formatter lives in `src/handlers/` because fallow's `pi-subagents/handlers` zone may import only `core` and itself.
- No improvement phase is open for pi-subagents, so roadmap-fit exited at step 1 for #1152.
- `Co-authored-by: Alexei Zavjalov <25473191+azavjalov@users.noreply.github.com>` is recorded in the plan's step 2: the notice is the reporter's first proposed fix.

#### Deferred tidyings

- `src/handlers/lifecycle.ts`: `SessionLifecycleHandler`'s positional constructor reaches five deps with two adjacent `() => void` parameters (`disposeNotifications`, `unpublishService`), a swap risk; a deps object is improvement-phase work.
