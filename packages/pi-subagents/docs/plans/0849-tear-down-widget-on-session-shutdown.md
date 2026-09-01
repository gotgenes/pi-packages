---
issue: 849
issue_title: "pi-subagents: AgentWidget.dispose() is never called, so the widget is not torn down on session_shutdown"
---

# Tear the agent widget down on session shutdown

## Release Recommendation

**Release:** ship independently

Phase 22 Step 9's roadmap entry carries `Release: independent`, and no open `Release: batch "<name>"` in `packages/pi-subagents/docs/architecture/architecture.md` names it.
The roadmap's `Release batches` subsection names one batch — `front-door-majors` (Steps 4 and 3, tail Step 3, both landed) — and lists Step 9 under "Independently releasable".
Track C's Step 6 ([#827]) shipped on its own as `pi-subagents-v21.0.2`, and this is that track's second and last step.
The commit type is `fix:`, so it cuts a patch on its own.

## Problem Statement

`AgentWidget` acquires two resources and releases neither on shutdown.

The first is the 80 ms `setInterval` started by `ensureTimer()`, which drives the widget's animation and live-stat refresh.
The second is the pair of registrations the widget places on the session's `UICtx` — `setWidget("agents", …)` above the editor, and `setStatus("subagents", …)` in the status bar.

`AgentWidget.dispose()` (`src/ui/agent-widget.ts`) releases all three, but nothing calls it.
The method carries a `// fallow-ignore-next-line unused-class-member` comment, so dead-code analysis stays quiet about the gap rather than reporting it.

`SessionLifecycleHandler.handleSessionShutdown()` unpublishes the service, clears the runtime session context, disposes notifications, aborts all agents, and awaits `manager.dispose()`.
It does not touch the widget.

## Goals

- `session_shutdown` tears the widget down explicitly: the interval is cleared and both `UICtx` registrations are unregistered.
- The teardown runs **after** the lifecycle handler's `abortAll()` and awaited `manager.dispose()`, so no abort-driven `update()` can undo it.
- `AgentWidget.dispose()` leaves the widget permanently inert, so its correctness does not rest on call ordering alone.
- The `fallow-ignore-next-line unused-class-member` comment on `dispose()` is removed, and `pnpm fallow dead-code` stays at zero findings.
- Phase 22 Step 9 is marked landed in the architecture roadmap.

This change is **not breaking**.
It adds a teardown call on an event that already fires; no default, output shape, config key, or public export changes.
The suggested commit type is `fix:`.

## Non-Goals

- Moving the widget's teardown onto `SessionLifecycleHandler` as a `disposeWidget` constructor dependency.
  Declined at the design gate (see Design Overview); [PR #850] takes that shape.
- Merging `AgentWidget.dispose()` with `clearWidget()`.
  The duplication is deliberate — `clearWidget()` additionally prunes `finishedTurnAge` against the live agent list, which a full teardown has no use for, and its own doc comment states it is "Called only from `update`'s idle path — not from `dispose`".
  Rejected as scope creep by the Tidy-First assessor and recorded in the Planning stage note.
- Any change to `SessionLifecycleHandler`'s existing cleanup sequence, its constructor signature, or the numbered ordering comment that documents it.
- Namespacing Pi's extension-widget keys per session.
  The shared-key hazard described below is an SDK property; this change removes our contribution to it by releasing the resource, and nothing more.
- Touching `src/ui/session-navigator.ts`, whose own `dispose()` carries a separate `fallow-ignore` for an unrelated reason.

## Background

### What #827 already fixed, and what it left

Before [#827], the widget captured its `UICtx` only on `tool_execution_start`.
`update()` returns early when no `UICtx` was ever captured, which made `clearWidget()` unreachable — so a background spawn in headless mode, or before the first tool call, left the 80 ms interval running until process exit.

[#827] moved the capture to `session_start` and gave the widget its own handler module, `src/handlers/widget-events.ts`.
That closed the unreachable-`clearWidget()` path, and its retro records the residual precisely: "The incidental timer-leak fix is real but partial.
`AgentWidget.dispose()` still has no call site, which is #849 / Phase 22 Step 9."

The roadmap's Step 6 landed note states the wiring precedent this change follows: "the capture is a push at `session_start`, wired from the composition root as its own registration — Pi fans an event out to every handler an extension registers for it, so the widget's concern did not have to share a lambda with the session-lifecycle one." `index.ts` today has two `session_start` registrations and two `turn_start` registrations for exactly that reason.

### Why the leak is masked today, and where it still bites

The release does currently happen, by an accidental chain rather than by design.
`manager.dispose()` empties the agent registry, so the *next* 80 ms tick finds no agents, takes `update()`'s idle path, and calls `clearWidget()` — which clears the interval and unregisters both entries.

Two consequences follow, and the plan should not overstate either.

On the interactive-quit path the point is moot.
`InteractiveMode.shutdown()` stops the TUI **before** emitting `session_shutdown` and calls `process.exit(0)` immediately after, so nothing survives to leak.

On the in-process **session-replacement** paths it is not moot.
`AgentSessionRuntime.teardownCurrent()` emits `session_shutdown`, disposes the session, and builds a fresh one with a fresh extension instance in the same process — the `/new`, `/resume`, `/fork`, tree-navigation, and import flows.
The `package-pi-permission-system` skill records the same fact from the consumer side: the extension factory "is still re-invoked on every `/new` / `/resume` / `/fork` / `/import` switch (with a fresh `pi`/`ExtensionContext`) … and `session_shutdown` still fires."
The old widget's interval survives that boundary.
Pi keys extension widgets by the bare string on the persistent `InteractiveMode` instance — `setExtensionWidget(key, …)` looks the key up in one process-wide map, and the UI context closes over `this` — so the dying tick's `setWidget("agents", undefined)` reaches the **live** TUI, not a detached one.
The window is bounded by one interval period (≤ 80 ms) and the replacement session rarely has a widget up that fast, so this is a narrow race rather than a reliable defect.
It is still the same key, not a namespaced one, and the self-heal it depends on is an emergent property of three unrelated facts holding at once.

### The ordering fact

`abortAll()` drives `AgentWidget.update()` **synchronously**.
`Subagent.stopQueued()` calls `this.execution.observer?.onRunFinished?.(this)` inline, and `Subagent.abort()` reaches the same notification through `markStopped()`.
The manager fans that out to `CompositeSubagentObserver`, which reaches `AgentWidget.onSubagentCompleted()` → `update()`.

A disposable spike (written, run, and deleted during planning) measured the consequence.
With one running background agent:

- `dispose()` **before** the terminal transition: the interval is cleared (`vi.getTimerCount()` → 0), but the transition's `update()` **re-registers** the widget — the last `setWidget` argument is a render function again, not `undefined`.
- `dispose()` **after** the terminal transition: `vi.getTimerCount()` is 0 and the last `setWidget` argument is `undefined`.

So an early `dispose()` is undone by the abort it precedes, in exactly the case where the widget was registered at all.

### Prior art: PR #850

[PR #850] (`mikemikimike`, open, single commit `3d6715cc`) implements this issue and reaches the same diagnosis.
Per this repo's convention, an adopted third-party change is reimplemented through our own TDD cycle with `Co-authored-by` credit rather than merged.

Adopted from it:

- The diagnosis and the fix's shape — call `AgentWidget.dispose()` on `session_shutdown`.
- Its widget unit test's assertion set: `vi.getTimerCount()` → 0, `setWidget` last called with `("agents", undefined)`, `setStatus` last called with `("subagents", undefined)`.
  That is the right pin, and the Tidy-First assessor's recommended fixture widening (TDD step 1 below) is what makes it expressible through the shared `makeWidget()` helper instead of a one-off UI recorder.

Diverged from, with reasons:

1. **Placement.**
   It adds a sixth positional `disposeWidget: () => void` constructor parameter to `SessionLifecycleHandler`; the design gate chose the widget's own handler instead.
2. **Ordering.**
   It calls `disposeWidget()` at position 2, before `abortAll()`.
   The spike above measures that as undone whenever an agent is running or queued at shutdown.
   Its own tests cannot see this: the lifecycle test mocks `disposeWidget` as a bare `vi.fn()`, and the widget test never fires a post-`dispose()` transition.
3. **Defaulted no-op dependency.** `private readonly disposeWidget: () => void = () => {}` makes an unwired composition root silently no-op — the same defect class this issue is about, reintroduced as a default value.
4. **Stale base.**
   It is written against pre-[#827] `index.ts` (its diff context still reads "Grab UI context from first tool execution"), so it predates `WidgetEventsHandler` existing.
5. **No `uiCtx` clear**, so the re-registration hazard stays structurally open.
6. It leaves the `fallow-ignore-next-line unused-class-member` comment in place, which Step 9's stated Outcome requires removing once the method has a call site.

### AGENTS.md constraints that apply

- Commits use Conventional Commits with no `Closes #N` keyword; reference as `(#849)` in the subject or `Refs #849` in the body.
- `Co-authored-by:` goes in the **final** paragraph, below `Refs #849`, since git reads only the last paragraph as trailers.
- The architecture-doc module tree describes current behavior; a step-mark and `Landed:` note are the expected doc updates here, and no new issue ref belongs in a tree entry.

## Design Overview

Two decisions were settled at an operator gate; both recommendations were accepted.

### Decision 1 — the teardown is the widget's own event handler

`WidgetEventsHandler` gains a third method, and `index.ts` gains a second `session_shutdown` registration placed after the lifecycle one.

```typescript
/** Narrow widget interface — only the methods these handlers call. */
export interface EventDrivenWidget {
  setUICtx(ctx: unknown): void;
  onTurnStart(): void;
  dispose(): void;
}

export class WidgetEventsHandler {
  constructor(private readonly widget: EventDrivenWidget) {}

  handleSessionStart(_event: unknown, ctx: SessionStartCtx): void {
    this.widget.setUICtx(ctx.ui);
  }

  handleTurnStart(): void {
    this.widget.onTurnStart();
  }

  handleSessionShutdown(): void {
    this.widget.dispose();
  }
}
```

The composition root then reads:

```typescript
pi.on("session_shutdown", () => lifecycle.handleSessionShutdown());
pi.on("session_shutdown", () => widgetEvents.handleSessionShutdown());
```

This is symmetric with the two `session_start` and two `turn_start` registrations already there, and it keeps every host event the widget depends on in one module — the shape [#827] established and whose docstring already frames `widget-events.ts` as "the two host events it depends on" (becoming three).

The ordering is a real dependency, not a stylistic one.
Pi's `ExtensionRunner.emit` iterates each extension's per-event handler array and `await`s each handler in turn, so registering second means running after the lifecycle handler's returned `manager.dispose()` promise resolves.
That dependency is implicit in `index.ts`, which is why the composition-root test below pins it by driving a real agent to a terminal transition rather than by asserting call order on mocks.

The rejected alternative — a `disposeWidget` dep on `SessionLifecycleHandler` — would make the order explicit in that handler's numbered cleanup comment, at the cost of a sixth positional constructor argument sitting beside two other bare `() => void` deps (transposition-prone), and of re-admitting the widget concern that [#827] deliberately kept out.

### Decision 2 — `dispose()` makes the widget inert

`AgentWidget.dispose()` gains one statement:

```typescript
dispose() {
  if (this.widgetInterval) {
    clearInterval(this.widgetInterval);
    this.widgetInterval = undefined;
  }
  if (this.uiCtx) {
    this.uiCtx.setWidget("agents", undefined);
    this.uiCtx.setStatus("subagents", undefined);
  }
  this.uiCtx = undefined;
  this.widgetRegistered = false;
  this.tui = undefined;
  this.lastStatusText = undefined;
}
```

`update()`'s first line is `if (!this.uiCtx) return;`, so clearing `uiCtx` makes every later `update()` a no-op.
The re-registration the spike measured becomes impossible by construction, and the registration-order dependency stops being load-bearing for correctness — it remains the documented intent, and the composition-root test still pins it.

`setUICtx()` re-arms the widget if a `UICtx` ever arrives again, so this is a reset to the pre-`session_start` state rather than a one-way latch.
In practice no `session_start` follows a `session_shutdown` on the same instance, because Pi builds a fresh extension instance for the replacement session.

Note the ordering **inside** `dispose()`: `uiCtx` must be cleared after the two `setWidget`/`setStatus` calls that use it, not before.

### Call-site sketch

The widget is the only consumer of `EventDrivenWidget`, and the interaction is Tell-Don't-Ask throughout: the handler tells the widget to dispose and asks it nothing.
`dispose()` reads no collaborator state and returns nothing, so no Law-of-Demeter chain or output argument is introduced.
`EventDrivenWidget` remains an ISP-narrow view of `AgentWidget` — three methods out of its full surface, each one a host event's effect.

## Module-Level Changes

### `packages/pi-subagents/src/ui/agent-widget.ts`

- `dispose()`: add `this.uiCtx = undefined;` after the `setWidget`/`setStatus` block.
- `dispose()`: remove the `// fallow-ignore-next-line unused-class-member` comment on the line above it.
- Update the method's doc comment to state that disposal is final — later `update()` calls are inert until a new `setUICtx()`.

### `packages/pi-subagents/src/handlers/widget-events.ts`

- `EventDrivenWidget`: add `dispose(): void`.
- `WidgetEventsHandler`: add `handleSessionShutdown(): void`.
- Update the module doc comment and the class doc comment: they currently say "The two events" / "the two host events it depends on"; both become three, and the new sentence names what shutdown releases.

### `packages/pi-subagents/src/index.ts`

- Add `pi.on("session_shutdown", () => widgetEvents.handleSessionShutdown());` immediately after the existing lifecycle `session_shutdown` registration.
- Add a short comment stating that the registration order is load-bearing: the widget's teardown must follow the lifecycle handler's `abortAll()` and awaited `manager.dispose()`.

### `packages/pi-subagents/src/handlers/index.ts`

No change.
The barrel re-exports `WidgetEventsHandler`; adding a method to an already-exported class needs no edit.
Verified against the file rather than assumed.

### `packages/pi-subagents/test/ui/agent-widget.test.ts`

- Widen `makeWidget()` to record `setStatus` calls (currently `setStatus: () => {}`, which discards them) and expose an accessor mirroring `lastContent()`.
- Add a `describe` block for `dispose()`: clears the interval, unregisters both entries, and leaves a subsequent `update()` inert.

### `packages/pi-subagents/test/handlers/widget-events.test.ts`

- Add `dispose: vi.fn<EventDrivenWidget["dispose"]>()` to the `makeWidget()` stub.
- Add a `describe("handleSessionShutdown")` block: it disposes the widget, and neither of the other two methods does.

### `packages/pi-subagents/test/composition-root.test.ts`

- Add tests to the existing `describe("composition root: widget activation")` block covering the wiring contract (see TDD Order steps 4 and 5).
- The existing `makePi()` fixture already records handlers as a per-event array and `fire()` already invokes all of them in registration order — [#827] converted it.
  No fixture change needed; verified against the file.

### `packages/pi-subagents/test/print-mode.test.ts`

No change.
Its own `makePi()` carries the same per-event-array shape and already fires `session_shutdown` against the composition root, so the second registration extends cleanly.
Listed because it drives the rewired seam even though the design edits nothing in it — the [#827] retro's `missing-context` finding was that this file was omitted from a file list for exactly that reason.

### `packages/pi-subagents/docs/architecture/architecture.md`

- Module tree, `handlers/` block: the `widget-events.ts` line currently reads "widget's host events — `session_start` (UI context) and `turn_start` (linger aging)".
  Add the shutdown event.
- Step 9 heading: `#### Step 9:` → `#### ✅ Step 9:`, and append a `Landed:` note.
- Step-dependency Mermaid: `S9["Step 9 (#849)<br/>Widget teardown"]` → `S9["✅ Step 9 (#849)<br/>Widget teardown"]`.

### Greps run at planning time, with results

| Grep                                                | Scope                             | Result                                                                                                                           |
| --------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `widget-events`, `WidgetEvents`, `session_shutdown` | `.pi/skills/`                     | No `pi-subagents` skill names the module or the mechanism — no skill edit needed                                                 |
| `widget`                                            | `packages/pi-subagents/README.md` | Six hits, all about what the widget *shows*; none describes teardown                                                             |
| `dispose`                                           | `packages/pi-subagents/docs/`     | Architecture hits are all about `SubagentSession`/`disposeSession`/`workspace-bracket`, plus the three Step 9 lines listed above |
| `fallow-ignore`                                     | `packages/pi-subagents/src/`      | Five sites; only `agent-widget.ts:300` is in scope                                                                               |
| `#src/index`                                        | `packages/pi-subagents/test/`     | `composition-root.test.ts` and `print-mode.test.ts` — both already fan out per event                                             |

No symbol is removed or renamed, and no export changes, so the removed-export and public-surface grep families do not apply.

## Test Impact Analysis

### New tests the change enables

`AgentWidget.dispose()` has never had a test, because it has never had a caller.
Widening the `makeWidget()` fixture to record `setStatus` makes the full release assertion expressible through the shared helper: interval cleared, widget unregistered, status cleared.
The inertness assertion (`update()` after `dispose()` does nothing) is newly meaningful only because of Decision 2.

### Existing tests that become redundant

None.
The change is additive at every level — no existing assertion is subsumed.

Two existing composition-root tests already call `await fire("session_shutdown", {}, {})` as a cleanup step so the fake timers do not leak between tests.
They will now also exercise the new registration incidentally.
That is not a pin — neither asserts anything after the shutdown — which is why steps 4 and 5 add tests that do.

### Existing tests that must stay

- `test/handlers/widget-events.test.ts`'s existing four cases pin the one-method-per-event separation; the new block extends that discipline rather than replacing it.
- `test/handlers/lifecycle.test.ts`'s `calls cleanup in correct order` case pins `SessionLifecycleHandler`'s five-step sequence.
  It must stay **unchanged** — this design deliberately does not add a sixth entry to that array, and an unchanged assertion there is evidence the lifecycle handler was left alone.
- `test/composition-root.test.ts`'s `no longer subscribes to tool_execution_start` pins [#827]'s outcome.

## Invariants at risk

This change touches the surface Phase 22 Step 6 ([#827]) refactored.
Its documented outcomes and their pins:

| Step 6 invariant                                             | Pinned by                                                                                                          | Status                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| The widget renders in a session with no model tool call      | `composition-root.test.ts` — "renders the widget for an agent spawned with no model tool call"                     | Pinned; untouched                                      |
| The linger clock ages on `turn_start`, not per tool call     | `composition-root.test.ts` — "ages a finished agent out of the widget on the parent's next turn"                   | Pinned; untouched                                      |
| The extension no longer subscribes to `tool_execution_start` | `composition-root.test.ts` — "no longer subscribes to tool_execution_start"                                        | Pinned; untouched                                      |
| One handler method per host event in `WidgetEventsHandler`   | `widget-events.test.ts` — the two negative cases ("does not age the linger", "does not re-capture the UI context") | Pinned; step 3 extends the pattern to the third method |

The hazard is the first invariant: clearing `uiCtx` in `dispose()` could, if the teardown ever ran early, leave a session unable to render.
It cannot here, because `session_shutdown` is terminal for the session — but that is a claim about ordering, so step 4's test drives a real spawn through a real shutdown rather than asserting on mocks.

Step 1 ([#724])'s background-only filter invariant is untouched: this change adds no `listAgents()` call site and does not alter `listBackgroundAgents()`.

### Quantitative baselines (measured at planning time)

| Measurement                                                                    | Baseline             | Predicted after                                                                   |
| ------------------------------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------- |
| `pnpm fallow dead-code --workspace @gotgenes/pi-subagents`                     | 0 findings           | 0 findings — `dispose()` gains a real call site as its `fallow-ignore` is removed |
| `grep -c 'fallow-ignore-next-line unused-class-member' src/ui/agent-widget.ts` | 1                    | 0                                                                                 |
| Package suite                                                                  | 1440 tests, 75 files | 1440 + the new cases; no file added or removed                                    |

The dead-code prediction is the one to verify rather than assume: the ignore comment and the new call site must land in the same commit, or the gate fires in between.

## TDD Order

### Step 1 — `test:` widen the widget test fixture to record status-bar calls

Preparatory (Tidy-First, Recommended).
Friction it prepares: `makeWidget()` in `test/ui/agent-widget.test.ts` discards `setStatus` (`setStatus: () => {}`), so step 2's "both registrations cleared" assertion is unwritable through the shared helper — each new test would otherwise hand-roll its own UI recorder, as [PR #850] does.

Change `setStatus` to record its calls and expose an accessor mirroring `lastContent()`.
No existing test reads the discarded value, so this is a pure widening.

Verify: `pnpm --filter @gotgenes/pi-subagents run test` — all existing cases still pass, unchanged.

Commit: `test(pi-subagents): record status-bar calls in the widget test fixture`

### Step 2 — `fix:` make widget disposal final

Red: add a `describe("AgentWidget.dispose")` block to `test/ui/agent-widget.test.ts`:

1. Clears the update interval (`vi.getTimerCount()` → 0 after a live agent started it).
2. Unregisters both entries — `setWidget` last called with `("agents", undefined)`, `setStatus` last called with `("subagents", undefined)`.
3. A subsequent `update()` is inert: with a finished agent in the roster, no further `setWidget` call is made after disposal.

Green: add `this.uiCtx = undefined;` to `dispose()` after the `setWidget`/`setStatus` block, and update its doc comment.

Killing mutations, one per equivalence class:

- Remove `this.uiCtx = undefined;` from `dispose()` — kills case 3 only; cases 1 and 2 stay green, which is the point of separating them.
- Delete the `clearInterval` block from `dispose()` — kills case 1.
- Delete the `setStatus("subagents", undefined)` call from `dispose()` — kills case 2's status half; the `setWidget` half stays green, so both are asserted separately.

Leave the `fallow-ignore` comment in place for now — `dispose()` still has no production call site at this commit, so removing it here would fail the dead-code gate.

Commit: `fix(pi-subagents): make agent widget disposal final`

### Step 3 — `test:` pin the shutdown handler method

Red: add `dispose: vi.fn()` to `makeWidget()` in `test/handlers/widget-events.test.ts`, then a `describe("handleSessionShutdown")` block:

1. Disposes the widget (`widget.dispose` called once).
2. Does not re-capture the UI context or age the linger.

Plus one negative case in each existing block: `handleSessionStart` and `handleTurnStart` do not dispose the widget.

Green: add `dispose(): void` to `EventDrivenWidget` and `handleSessionShutdown()` to `WidgetEventsHandler`; refresh both doc comments from "two events" to three.

Killing mutations:

- Make `handleSessionShutdown()` a no-op — kills case 1.
- Make `handleSessionStart()` also call `this.widget.dispose()` — kills the new negative case in the `handleSessionStart` block.

Commit: `test(pi-subagents): pin the widget's session_shutdown handler method`

Note the commit type: at this point the method exists but nothing registers it, so nothing a user can observe has changed.

### Step 4 — `fix:` tear the widget down on session shutdown

This is the behavior-change step and the one the issue asks for.

Red: add to `describe("composition root: widget activation")` in `test/composition-root.test.ts` — spawn a background agent through `getSubagentsService()!.spawn(...)` (the same path the existing tests use), let it register, then `await fire("session_shutdown", {}, {})` and assert:

1. `vi.getTimerCount()` is 0 — no interval survives the shutdown.
2. `ui.setWidget` was last called with `("agents", undefined)` and `ui.setStatus` with `("subagents", undefined)`.

Green: add the second `pi.on("session_shutdown", …)` registration to `index.ts`, with the comment explaining why it is registered after the lifecycle one.
Remove the `fallow-ignore-next-line unused-class-member` comment from `dispose()` in the same commit — the call site now exists, and separating them would fail `pnpm fallow dead-code` at one commit or the other.

Killing mutations:

- Delete `pi.on("session_shutdown", () => widgetEvents.handleSessionShutdown());` from `index.ts` — must turn both cases red.
  This is the mutation that matters: the whole issue is a missing registration.
- Restore the `fallow-ignore` comment and delete the registration — `pnpm fallow dead-code` must report `dispose()` as an unused class member, confirming the gate was genuinely load-bearing rather than incidentally quiet.

Verify: `pnpm --filter @gotgenes/pi-subagents run check`, the full package suite, `pnpm run lint`, and `pnpm fallow dead-code --workspace @gotgenes/pi-subagents` (expect 0 findings).

Commit:

```text
fix(pi-subagents): tear the agent widget down on session shutdown

Refs #849

Co-authored-by: mikemikimike <13286568797@163.com>
```

Confirm the trailer is read as one with `git interpret-trailers --parse` before pushing — `Refs #849` is not trailer-shaped, so `Co-authored-by:` must be in the final paragraph beneath it.

### Step 5 — `test:` pin the shutdown registration order

Red: add a composition-root test that fails if the widget teardown is registered **before** the lifecycle handler.

Spawn a background agent, leave it in a non-terminal state, then fire `session_shutdown` and assert the widget is unregistered afterward.
With the correct order, `abortAll()` and `manager.dispose()` run first, so the widget's `dispose()` is last and nothing re-registers.

Killing mutation: swap the two `pi.on("session_shutdown", …)` lines in `index.ts`.
Prediction to check honestly at implementation time: because Decision 2 clears `uiCtx`, the swap may leave this test **green** — the inertness makes the order non-load-bearing for the observable outcome.
If so, that is a finding, not a failure: record it, keep the test as a pin on the teardown's outcome, and move the ordering claim into the `index.ts` comment as documented intent rather than a tested invariant.
Do not manufacture an assertion that only fails by reaching into private state.

Commit: `test(pi-subagents): pin widget teardown against the shutdown sequence`

### Step 6 — `docs:` mark Phase 22 Step 9 landed

Update `docs/architecture/architecture.md`:

1. The `widget-events.ts` module-tree line gains the shutdown event.
2. Step 9's heading gains `✅` and a `Landed:` note recording the two decisions, the measured ordering fact, and step 5's outcome.
3. The step-dependency Mermaid node gains `✅`.

Per the architecture-doc convention, the module-tree entry describes current behavior only — no issue ref belongs there, since neither decision is a lint-guarded or ADR-string boundary.

Verify: `pnpm exec rumdl check packages/pi-subagents/docs/architecture/architecture.md`, and render the Mermaid block per the `mermaid` skill.

Commit: `docs(pi-subagents): mark Phase 22 Step 9 landed`

## Risks and Mitigations

| Risk                                                                                                               | Mitigation                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clearing `uiCtx` breaks a session that legitimately renders after a shutdown event                                 | `session_shutdown` is terminal for the session, and `setUICtx()` re-arms the widget if one ever arrives again. Step 4's test drives a real spawn through a real shutdown rather than asserting on mocks.    |
| The registration-order dependency is invisible in `index.ts` and a later edit reorders it                          | Decision 2 removes the correctness dependency; the `index.ts` comment records the intent; step 5 pins the outcome.                                                                                          |
| The `fallow-ignore` removal and the new call site land in different commits, failing the dead-code gate in between | Step 4 does both in one commit, and its second killing mutation verifies the gate was genuinely load-bearing.                                                                                               |
| Step 5's ordering mutation leaves the suite green                                                                  | Anticipated in the step and written as a finding to record rather than a failure to work around.                                                                                                            |
| A doc surface naming the mechanism is missed                                                                       | Five greps run at planning time with results tabulated above; the module tree, Step 9 heading, and Mermaid node are the only three hits.                                                                    |
| [PR #850] is forgotten at ship time                                                                                | Recorded here and in the Planning stage note: close it with a comment naming the divergences, crediting the shared diagnosis, and pointing at the implementing SHA. `Co-authored-by` is in step 4's commit. |

## Open Questions

None blocking.

One item is deliberately deferred and needs no issue: whether Pi should namespace extension widget keys per extension or per session, so a stale registration cannot reach a replacement session's TUI.
That is an SDK-side concern, the hazard is a ≤ 80 ms race, and this change removes our contribution to it by releasing the resource on time.
If it ever bites in practice, it belongs upstream, not here.

No follow-up issues were identified during planning, so none were filed.

[#724]: https://github.com/gotgenes/pi-packages/issues/724
[#827]: https://github.com/gotgenes/pi-packages/issues/827
[PR #850]: https://github.com/gotgenes/pi-packages/pull/850
