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

## Stage: Implementation — TDD (2026-11-26T19:16:05Z)

### Session summary

Completed all three TDD steps: "return the stopped agents from abortAll()" (`refactor:`), "tell the parent which subagents a session shutdown stopped" (`fix:`, with the reporter's `Co-authored-by:` trailer), and "document the shutdown notice" (`docs:`).
The pi-subagents suite ends at 2249 tests, +18: 13 in the new `shutdown-notice.test.ts` (with `it.each` expansion), 3 in `lifecycle.test.ts`, 1 in `subagent-manager.test.ts`, and 1 in `composition-root.test.ts`.

### Observations

- Every killing mutation the plan named went red on exactly the predicted tests (2 in step 1, 12 in step 2, run as one scripted battery that asserted each pattern occurred once and restored the file after each); an extra input-order mutation (`toReversed()`) killed the ordering test.
- The composition-root wiring test asserts the full message content, not just the header line the plan settled for: `vi.waitFor` on the service record's `outputFile` makes the child's transcript path known before shutdown, and the spawn returns the generated id.
- Deviation: `composition-root.test.ts`'s "registers a renderer for every custom message type the extension sends" became false once the extension sends `subagent-shutdown-notice` with no renderer; it was renamed to "every result-carrying message type" with a comment, in the `fix:` commit.
- `buildShutdownNotice` looks causes up in a `Map` rather than a `Record`, so a reason like `constructor` cannot resolve to a prototype member.
- Pre-completion reviewer: WARN.
  Reviewer warnings: the delivery evidence is one probe run on Pi 1.6.1 rather than the pinned 1.0.0 (source-checked for 1.0.0); the new `mockSendMessage` field follows the file's `ReturnType<typeof vi.fn<…>>` convention rather than `Mock<Sig>`; optional hardening to read `event.reason` inside the `try`.
  All three were left as they are: the event-less call is unreachable (the parameter is required and every Pi path emits an event), and converting one field against the file's convention would be inconsistent.

## Stage: Sync (worktree) (2026-11-26T20:36:34Z)

### Session summary

`pnpm run lint` and `pnpm fallow dead-code` passed; the branch is rebased onto local `main` for the root's ff-merge.
The plan's marker is `**Release:** ship independently`, so `/ship` dispatches a `pi-subagents` release; the follow-ups are #1152 (prerequisite of #1135) and the resume pointer recorded on #1135.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1111--/2026-11-26T18-03-06-439Z_01a21906-8146-77d7-99cc-e3114b43889c.jsonl`, read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- The operator settled the TDD stage's reviewer WARN:
  - Probe evidence: re-run on the pinned Pi 1.0.0 (`dist/bundle/cli.js` in the pnpm store), 5/5 trials with the shutdown message in `get_messages` ahead of the reloaded instance's `session_start`, and no `agent_start`/`turn_start` event, so no turn started.
  - Mock typing: converted, because tidying-as-you-go covers files the change touches; the commit "type the shutdown and interrupt handler mocks as `Mock<Sig>`" covers all eight fields in `lifecycle.test.ts` and the one in `interrupt.test.ts` (also touched by the change).
    `widget-events.test.ts`, untouched by the change, was left.
  - `event.reason` outside the `try`: judged a false positive by the operator, since the parameter is required.
