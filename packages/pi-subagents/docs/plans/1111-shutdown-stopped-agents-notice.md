---
issue: 1111
issue_title: "pi-subagents: `/reload` silently aborts running background subagents"
---

# Tell the parent which subagents a session shutdown stopped

## Release Recommendation

**Release:** ship independently

Issue #1111 is not a step in any pi-subagents improvement roadmap (no `## Improvement roadmap — Phase` section is open), so it carries no batch tag.

## Problem Statement

A background subagent returns its ID at once, so the parent goes idle while the child works.
Pi's `/reload` guard checks only the parent (streaming or compacting), so a reload goes ahead while background children are running or queued.
Pi then emits `session_shutdown` with `reason: "reload"`, and `SessionLifecycleHandler.handleSessionShutdown()` disposes notifications and calls `manager.abortAll()` whatever the reason.

What the user and the parent agent see, in order:

1. The parent spawned a background child and was told it would be notified on completion.
2. The user runs `/reload`.
3. The widget is empty afterwards, no completion message ever arrives, and nothing in the transcript mentions the child.
4. A later `get_subagent_result(<id>)` answers `Agent not found … may be from a previous session`, because the reloaded extension has a fresh manager.

The same silent stop happens on every other shutdown reason (`quit`, `new`, `resume`, `fork`).
Extensions cannot intercept the built-in `/reload`, and `session_shutdown` cannot be cancelled, so the package itself has to report the loss.
The issue's reporter (@azavjalov) listed three fixes in order of effort; this plan takes the first, a visible notice listing the stopped agents.

## Goals

- When a session shutdown stops one or more subagents, the parent session receives one transcript message listing each of them: ID, agent type, description, whether it was running or queued, and its transcript path when it has one.
- The message is shown to the user (`display: true`) and reaches the parent model on its next turn, without starting a turn (`triggerTurn: false`).
- The message names the cause for every Pi shutdown reason (`reload`, `quit`, `new`, `resume`, `fork`), with a generic phrase for a reason this version does not know.
- No message when the shutdown stopped nothing.
- A `sendMessage` that throws at shutdown never prevents the child sessions from being disposed.
- Non-breaking: no existing output, default, or public type changes; the change adds a message where there was none.
  Commit type `fix(pi-subagents):`.

## Non-Goals

- **Keeping a run alive across a shutdown, or restoring it afterwards.**
  Restoring a settled child by ID after a reload or restart is #1135 (third-party PR #1136), which lists in-flight runs as its own Non-Goal.
  A child stopped by `/reload` ends as a settled `stopped` child, so #1135 is the path by which this work becomes resumable.
- **Persisting a running child's `subagents:record` entry before the old instance is invalidated.**
  Filed as #1152, a prerequisite of #1135.
  The notice does not depend on it: it is built from what `abortAll()` returns, synchronously, before anything is torn down.
- **Pointing the notice at `subagent(resume: <id>)`.**
  That is true only once #1135 lands, so the wording change belongs to #1135 (recorded on that issue).
  This plan's wording must not promise a resume.
- **A guarded `/subagents:reload` command.**
  Considered and declined by the operator: it cannot stop Pi's own `/reload`, so it protects only users who remember it.
- **A dedicated message renderer.**
  The operator chose Pi's default custom-message rendering (markdown content under the message label); the three existing renderers exist mainly to collapse long result text, and this notice is short.
- **Announcing an ESC interrupt's `abortAll()`.**
  `InterruptHandler` runs with notifications live, so each stopped child already gets its completion nudge there.
- **Converting `SessionLifecycleHandler`'s positional constructor to a deps object.**
  The tidy-first assessor flagged the swap risk between its two `() => void` deps but rated it improvement-phase work (one production and one test construction site); see the retro's `#### Deferred tidyings`.

## Background

- `src/handlers/lifecycle.ts`: `SessionLifecycleHandler.handleSessionShutdown()` runs unpublish service, clear session context, dispose notifications, `manager.abortAll()`, then returns `manager.dispose()`, which Pi awaits.
  Notifications die first on purpose (commit `d69419b1`): with no parent run active, a terminal transition's `triggerTurn` nudge is handed to Pi synchronously and cannot be recalled.
  The new notice is a separate, non-triggering message, so it does not reopen that hazard.
- `src/lifecycle/subagent-manager.ts`: `abortAll(): number` stops queued records with `stopQueued()` and running ones with `abort()` (which returns `false` for a record that is not running), then `limiter.clear()`.
  Its consumers are `handlers/lifecycle.ts` (`LifecycleManager.abortAll(): void`) and `handlers/interrupt.ts` (`InterruptManager.abortAll(): number`, return ignored), both wired in `src/index.ts`, plus direct calls in `test/lifecycle/subagent-manager.test.ts`.
  It is not on `SubagentsService`.
- `Subagent` (`src/lifecycle/subagent.ts`) exposes `id`, `type`, `description`, `stoppedWhileQueued` (set by `stopQueued()`), and `outputFile` (the live session's file, or the one captured at release).
- `src/index.ts` registers `pi.on("session_shutdown", () => lifecycle.handleSessionShutdown())`, dropping the event, and registers the widget's shutdown handler after it on purpose (#849).
- Fallow zone `pi-subagents/handlers` may import only `pi-subagents/core` (`src/*.ts`) and itself (`pnpm --silent fallow guard packages/pi-subagents/src/handlers/lifecycle.ts`), so the formatter lives in `src/handlers/`, not `src/observation/`.
  `src/debug.ts` (`debugLog`) is in `core`.
- Fallow's entry points are `src/index.ts` and friends, with `unused-files`/`unused-exports` at error, so a new module must land in the same commit as its first production consumer.

### Pi mechanism the design rests on

- Pi's `AgentSession.reload()` (pinned 1.0.0, `dist/core/agent-session.js`) awaits `emitSessionShutdownEvent(oldRunner, { reason: "reload" })` and only then calls `oldRunner.invalidate()`, so `pi.sendMessage` is still live inside our handler.
  For `new`/`resume`/`fork`/`quit`, `AgentSessionRuntime` calls `session.abort()` before emitting the shutdown, so the session is idle then too.
- `sendCustomMessage` with `triggerTurn: false` on an idle session appends the custom message to the session immediately (pinned 1.0.0 and Pi `main`).
- `SessionShutdownEvent.reason` is `"quit" | "reload" | "new" | "resume" | "fork"` in both the pinned 1.0.0 types and Pi `main`.

## Design Overview

### Evidence

- The defect is confirmed in source (this session and the 2026-11-19 triage), not reproduced in a live session with a real child.
- The delivery mechanism was **measured** with a disposable probe extension in RPC mode on the installed Pi 1.6.1 (`pi --mode rpc --no-extensions -e <probe>`): a `pi.sendMessage({ display: true }, { triggerTurn: false })` from a `session_shutdown(reason: "reload")` handler appeared in `get_messages` after the reload, ordered before the reloaded instance's `session_start` message, and started no turn.

### Flow

```text
session_shutdown(event)
  unpublishService()
  clearSessionContext()
  disposeNotifications()            // unchanged: nudges silenced first
  stopped = manager.abortAll()      // now returns the agents it stopped
  if stopped non-empty:
    try   sendMessage(buildShutdownNotice(event.reason, stopped), { triggerTurn: false })
    catch debugLog(...)             // never skip the dispose below
  return manager.dispose()          // unchanged: awaited child teardown
```

### Data shapes

```typescript
// src/handlers/shutdown-notice.ts (new)
/** What the notice reads from each stopped agent; `Subagent` satisfies it structurally. */
export interface StoppedAgent {
  readonly id: string;
  readonly type: string;
  readonly description: string;
  readonly stoppedWhileQueued: boolean;
  readonly outputFile: string | undefined;
}

export interface ShutdownNotice {
  readonly customType: "subagent-shutdown-notice";
  readonly content: string;
  readonly display: true;
}

export function buildShutdownNotice(reason: string | undefined, stopped: readonly StoppedAgent[]): ShutdownNotice;
```

`SubagentManager.abortAll()` returns `Subagent[]`.
`LifecycleManager.abortAll()` returns `readonly StoppedAgent[]`; `InterruptManager.abortAll()` returns `void`.
`SessionLifecycleHandler` gains a fifth constructor dependency, a narrow `sendMessage(message: ShutdownNotice, options: { triggerTurn: false }) => void` (no `details`, no `deliverAs`: the handler sends nothing else), and `handleSessionShutdown(event: { readonly reason?: string })` takes a lean local payload.

### Message content

`buildShutdownNotice` is pure.
Its content, for a reload that stopped a running and a queued agent:

```text
`/reload` stopped these subagents before they finished, so their results will not arrive:
- `a1b2c3` (general-purpose) "Refactor auth module": was running. Transcript: `/…/tasks/a1b2c3.jsonl`
- `d4e5f6` (Explore) "Find callers": was queued.
Spawn them again if the work is still needed.
```

- Cause phrase by reason: `reload` → `` `/reload` ``; `quit` → `Quitting Pi`; `new` → `Starting a new session`; `resume` → `Switching sessions`; `fork` → `Forking the session`; anything else, including `undefined` → `Ending the session`.
  The fallback is presentation, not a policy decision, so a newer Pi's unknown reason degrades to a generic phrase rather than failing.
- Each line states running vs queued from `stoppedWhileQueued`, and appends ``Transcript: `<outputFile>` `` only when `outputFile` is set.
  The two facts are independent: a queued **resume** has a transcript from its earlier runs, and a running agent stopped before its session existed (workspace still preparing) has none.
- Agents appear in the order `abortAll()` returns them (registry insertion order).
- The wording promises nothing about resuming (see Non-Goals).

### Edge cases (each tested)

| Case                                                                      | Behavior                                                                                                                                                           | Step                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Nothing active at shutdown                                                | No message                                                                                                                                                         | 2                                                             |
| A finished agent at shutdown                                              | Not stopped, so not returned by `abortAll()` and not listed                                                                                                        | 1                                                             |
| A foreground child at `quit`/`new`/`resume`/`fork`                        | Pi aborts the parent run first, the child's own signal stops it, so `abort()` returns `false` and it is not listed; the parent already got its aborted tool result | 1 (finished-agent case covers the `abort() === false` branch) |
| `sendMessage` throws (stale context, as `test/print-mode.test.ts` models) | Logged with `debugLog`; `manager.dispose()` still runs and the handler still resolves after it                                                                     | 2                                                             |
| Unknown or missing `reason`                                               | Generic cause phrase                                                                                                                                               | 2                                                             |
| Queued resume with a transcript                                           | "was queued." plus its transcript                                                                                                                                  | 2                                                             |
| Running agent with no session yet                                         | "was running." with no transcript                                                                                                                                  | 2                                                             |

## Module-Level Changes

| File                                       | Change                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lifecycle/subagent-manager.ts`        | `abortAll()` collects and returns the stopped `Subagent[]` instead of a count; doc comment updated                                                                                                                                                                                                                                              |
| `src/handlers/interrupt.ts`                | `InterruptManager.abortAll(): void`                                                                                                                                                                                                                                                                                                             |
| `src/handlers/shutdown-notice.ts`          | **New**: `StoppedAgent`, `ShutdownNotice`, `buildShutdownNotice`                                                                                                                                                                                                                                                                                |
| `src/handlers/lifecycle.ts`                | `LifecycleManager.abortAll(): readonly StoppedAgent[]`; fifth constructor dep `sendMessage`; `handleSessionShutdown(event)` sends the notice between `abortAll()` and `dispose()`, guarded by `try`/`catch` + `debugLog`; cleanup-order comment and class doc updated                                                                           |
| `src/index.ts`                             | Pass `(message, options) => pi.sendMessage(message, options)` to `SessionLifecycleHandler`; register `pi.on("session_shutdown", (event) => lifecycle.handleSessionShutdown(event))`                                                                                                                                                             |
| `test/lifecycle/subagent-manager.test.ts`  | `expect(manager.abortAll()).toBe(2)` becomes an identity assertion; new case for a finished agent                                                                                                                                                                                                                                               |
| `test/handlers/interrupt.test.ts`          | `mockAbortAll = vi.fn(() => 0)` → `vi.fn()`                                                                                                                                                                                                                                                                                                     |
| `test/handlers/shutdown-notice.test.ts`    | **New**: value tests for `buildShutdownNotice`                                                                                                                                                                                                                                                                                                  |
| `test/handlers/lifecycle.test.ts`          | Constructor gains the `sendMessage` stub; default `mockAbortAll` returns `[]` (a `vi.fn()` returning `undefined` would throw on `.length`); the order test's `abortAll` implementation returns `[]`, then a stopped agent, and its expected order gains `"sendMessage"`; every `handleSessionShutdown()` call passes an event; new notice tests |
| `test/composition-root.test.ts`            | New wiring test: a running background child at `session_shutdown` with `{ reason: "reload" }` produces the notice through `pi.sendMessage`                                                                                                                                                                                                      |
| `README.md`                                | New `## When the parent session ends` section before `## Child session lifecycle`                                                                                                                                                                                                                                                               |
| `docs/architecture/architecture.md`        | Module tree: add `shutdown-notice.ts` under `handlers/`; `lifecycle.ts` entry notes the shutdown notice                                                                                                                                                                                                                                         |
| `.pi/skills/package-pi-subagents/SKILL.md` | `## Upstream assumptions`: one row for the idle, pre-invalidate `session_shutdown` this notice rests on                                                                                                                                                                                                                                         |

Predicted unchanged, with the claim each rests on:

- `src/handlers/index.ts` (barrel): `shutdown-notice.ts` is used only inside `handlers/`, and `index.ts` does not import it.
- `src/observation/notification.ts`: the notice does not go through `NotificationManager`, whose `dispose()` stays terminal.
- `test/print-mode.test.ts`: its child finishes before `session_shutdown`, so nothing is stopped and its throwing `sendMessage` is never called.
- The composition-root widget tests that fire `session_shutdown` with `{}`: a still-running child now produces a notice with the fallback cause through `makePi()`'s no-op `sendMessage: vi.fn()`; none asserts `sendMessage` was not called (re-check at implementation).
- `.pi/skills/package-pi-subagents/SKILL.md` prose and domain table: they name neither `abortAll` nor the shutdown handler's steps, and the table does not enumerate `handlers/` (only the `## Upstream assumptions` table changes, in step 3).
- `src/service/*`: `abortAll` is not on the service contract.

## Test Impact Analysis

1. New tests enabled: `buildShutdownNotice` is pure, so every wording branch (cause per reason, fallback, running vs queued, with and without transcript, ordering) is a literal value test with no handler or manager.
2. Redundant tests: none; the existing order test is extended rather than duplicated.
3. Tests that stay as they are: `test/handlers/interrupt.test.ts` behavior tests (only the stub changes), `test/print-mode.test.ts`, and the composition-root widget teardown tests, which pin the #849 registration order.

## Invariants at risk

| Invariant                                                                                                 | Constituency                                                | Pinned by                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Notifications are disposed before the aborts (`d69419b1`)                                                 | The parent: no unrecallable `triggerTurn` nudge at shutdown | `lifecycle.test.ts` "calls cleanup in correct order", extended to `…disposeNotifications, abortAll, sendMessage, dispose`        |
| `manager.dispose()` is awaited, so children's extensions shut down before Pi tears the parent down (#709) | Child extensions (stdio servers, sockets)                   | `lifecycle.test.ts` "resolves only after every child session has shut down"; new throwing-send test asserts `dispose` still runs |
| Widget teardown runs after the lifecycle handler (#849)                                                   | The TUI                                                     | `composition-root.test.ts` widget teardown tests (unchanged registration order)                                                  |
| ESC still aborts every subagent by default (#664)                                                         | The operator                                                | `interrupt.test.ts` (return value was always ignored)                                                                            |

## TDD Order

1. **`refactor(pi-subagents): return the stopped agents from abortAll() (#1111)`.**
   Prepares the notice's input: today `abortAll()` returns a count, so the notice step would otherwise also have to change two manager interfaces and an unrelated test file.
   - `src/lifecycle/subagent-manager.ts`: push each stopped record into a `Subagent[]` in place of `count++`; same branches, same `limiter.clear()`.
   - `src/handlers/interrupt.ts`: `InterruptManager.abortAll(): void`; `test/handlers/interrupt.test.ts`: `vi.fn()`.
   - Leave `LifecycleManager.abortAll(): void` (an array-returning method satisfies it), so `index.ts` and `lifecycle.test.ts` do not change here.
   - `test/lifecycle/subagent-manager.test.ts`: in "abortAll() notifies onSubagentRunFinished for queued agents", replace `toBe(2)` with `expect(manager.abortAll().map((a) => a.id)).toEqual([running, queued])`; add a case where a completed background agent sits beside a running one and is absent from the result.
   - Killing mutations: make `abortAll()` return `[]` (kills the identity assertion); make it return every record in `this.agents` (kills the finished-agent case).
   - Verify: `pnpm --filter @gotgenes/pi-subagents exec vitest run test/lifecycle/subagent-manager.test.ts test/handlers/interrupt.test.ts && pnpm --filter @gotgenes/pi-subagents run check`.
2. **`fix(pi-subagents): tell the parent which subagents a session shutdown stopped (#1111)`.**
   One commit, because the new module has no consumer until the handler uses it and the handler's new constructor dependency has a single call site in `index.ts`.
   - Red, value layer (`test/handlers/shutdown-notice.test.ts`, literals throughout): one test per cause phrase (`reload`, `quit`, `new`, `resume`, `fork`); `undefined` and an unknown string give the fallback; a running agent with a transcript; a queued agent with none; a queued agent with a transcript (resume); a running agent with none; two agents keep input order; the whole message is `{ customType: "subagent-shutdown-notice", content, display: true }`.
     Killing mutations: map `reload` to the fallback phrase (kills the reload test); return the raw reason string for an unknown reason (kills the fallback tests); always write "was running." (kills the queued tests); drop the transcript suffix (kills the with-transcript tests); always append the suffix (kills the without-transcript tests, which would show `undefined`).

   - Red, handler layer (`test/handlers/lifecycle.test.ts`): update the fixture (fifth `sendMessage` stub, `mockAbortAll` default `vi.fn((): StoppedAgent[] => [])`, events passed); a stopped agent produces `sendMessage(buildShutdownNotice("reload", [agent]), { triggerTurn: false })`; an empty result sends nothing; the order test expects `sendMessage` between `abortAll` and `dispose`; a throwing `sendMessage` still calls `dispose` and the handler resolves.
     Killing mutations: delete the send (kills the delivery test); drop the `length > 0` guard (kills the empty test); pass `{ triggerTurn: true }` (kills the delivery test's exact options); send after `this.manager.dispose()` is called instead of before (kills the order test); remove the `try`/`catch` (kills the throwing-send test).

   - Red, wiring (`test/composition-root.test.ts`): spawn a background child through the service, leave it running, fire `session_shutdown` with `{ reason: "reload" }`, and assert `pi.sendMessage` received `customType: "subagent-shutdown-notice"`, `display: true`, `{ triggerTurn: false }`, and a content whose first line is exactly the `/reload` header.
     The first-line assertion is deliberate: the child's id is generated, so the full content is pinned by the value tests instead.
     Killing mutations: wire `sendMessage: () => {}` in `index.ts` (kills it); register `() => lifecycle.handleSessionShutdown({})` (the header becomes the fallback; kills it).

   - Green: `src/handlers/shutdown-notice.ts`, `src/handlers/lifecycle.ts`, `src/index.ts` as in Module-Level Changes.

   - Verify: the three test files, then the full package suite (`pnpm --filter @gotgenes/pi-subagents exec vitest run`) since the shutdown path is shared, and `pnpm --filter @gotgenes/pi-subagents run check`.

   - Commit body ends with a final paragraph:

     ```text
     Refs #1111

     Co-authored-by: Alexei Zavjalov <25473191+azavjalov@users.noreply.github.com>
     ```

     The reporter proposed this mechanism (a visible notice listing the aborted agents) in the issue; verify with `git interpret-trailers --parse`.
3. **`docs(pi-subagents): document the shutdown notice (#1111)`.**
   - `README.md`: new `## When the parent session ends` section before `## Child session lifecycle`: reloading, quitting, starting or switching sessions, and forking stop every running and queued subagent, and Pi gives extensions no way to defer them; when that stops anything, the parent session gets one message listing each stopped agent so neither you nor the parent agent waits for results that will not arrive; `/reload` proceeds whenever the parent is idle, so let background agents finish (or collect them) before reloading.
   - `docs/architecture/architecture.md`: module-tree entries for `handlers/shutdown-notice.ts` and `handlers/lifecycle.ts`.
   - `.pi/skills/package-pi-subagents/SKILL.md` `## Upstream assumptions`: add a row "`session_shutdown` is emitted while the parent session is idle, before the extension runtime is invalidated", upstream files `packages/coding-agent/src/core/agent-session.ts` (`reload`) and `packages/coding-agent/src/core/agent-session-runtime.ts` (`teardownCurrent`, `dispose`), breaks as "Behavioral-silent: the shutdown notice is deferred to a turn that never comes, or `sendMessage` throws and the notice is lost".
   - Verify: `pnpm exec rumdl check packages/pi-subagents/README.md packages/pi-subagents/docs/architecture/architecture.md .pi/skills/package-pi-subagents/SKILL.md`.

## Risks and Mitigations

| Risk                                                                                                                                          | Mitigation                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pi.sendMessage` throws at shutdown (stale context, e.g. print mode) and skips `manager.dispose()`, stranding child extensions                | `try`/`catch` + `debugLog` around the send, following `NotificationManager.onParentAgentSettled`; pinned by the throwing-send test in step 2                                                                                       |
| A future Pi starts emitting `session_shutdown` while the parent is still streaming, so the message is deferred to a turn end that never comes | Today every shutdown path is idle (reload is guarded; the others call `session.abort()` first); the cost of being wrong is the pre-change behavior (no notice), not a new failure; step 3 records it as an upstream assumption     |
| The notice reads as a promise of recovery                                                                                                     | Wording says the results will not arrive and suggests spawning again; the resume pointer waits for #1135                                                                                                                           |
| The parent model ignores the notice                                                                                                           | It is a `display: true` custom message in context, the same channel the completion nudges use                                                                                                                                      |
| Changing `abortAll()`'s return type breaks a caller                                                                                           | Callers enumerated by grep (`index.ts`, `handlers/lifecycle.ts`, `handlers/interrupt.ts`, `subagent-manager.test.ts`); `fallow --symbol-impact` misses the structural ones in `index.ts`, so rely on `pnpm run check` after step 1 |

## Open Questions

None open.
The resume pointer and the record-persistence seam are tracked as #1135 and #1152 (see Non-Goals).
