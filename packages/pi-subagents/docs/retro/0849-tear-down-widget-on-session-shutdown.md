---
issue: 849
issue_title: "pi-subagents: AgentWidget.dispose() is never called, so the widget is not torn down on session_shutdown"
---

# Retro: #849 — pi-subagents: AgentWidget.dispose() is never called, so the widget is not torn down on session_shutdown

## Stage: Planning (2026-09-01T22:59:29Z)

### Session summary

Planned Phase 22 Step 9: wire `AgentWidget.dispose()` to `session_shutdown` and make disposal final.
Ran the design gate (both recommendations accepted), measured the ordering hazard with a disposable spike, dispatched the Tidy-First assessor, and committed `packages/pi-subagents/docs/plans/0849-tear-down-widget-on-session-shutdown.md`.
The plan is six steps: one preparatory `test:` fixture widening, two `fix:` behavior steps, two `test:` pins, and a `docs:` roadmap mark.

### Observations

- **The ordering hazard is measured, not argued.**
  `abortAll()` drives `AgentWidget.update()` synchronously — `Subagent.stopQueued()` calls `observer.onRunFinished(this)` inline (`subagent.ts:479`) and `abort()` reaches the same path through `markStopped()`.
  A disposable spike (`test/ui/spike-dispose-order.test.ts`, written, run green, deleted) showed that `dispose()` **before** a terminal transition leaves the timer cleared but **re-registers** the widget — the last `setWidget` argument is a render function again.
  `dispose()` after the transition leaves timer count 0 and content `undefined`.
  That measurement is what ruled out placing the teardown early in the shutdown sequence, and it is the specific defect in [PR #850].

- **The defect is masked today by an accidental three-fact chain.**
  `manager.dispose()` empties the registry → the next 80 ms tick finds no agents → `update()`'s idle path calls `clearWidget()`.
  So the resources *are* released, by emergent behavior rather than by design.
  The plan states this honestly instead of overselling a leak: on the interactive-quit path it is moot (`InteractiveMode.shutdown()` stops the TUI before emitting `session_shutdown`, then `process.exit(0)`), and on the session-replacement paths (`/new`, `/resume`, `/fork`) the residual is a ≤ 80 ms race against a **process-global** widget key (`setExtensionWidget` looks the key up in one map on the persistent `InteractiveMode` instance).
  Framing it as a resource acquired with no explicit release, rather than as a user-visible leak, is what kept the plan's claims defensible.

- **Two gate decisions, both recommendations accepted.**
  Wiring → `WidgetEventsHandler.handleSessionShutdown()` with its own `pi.on` registration (over a `disposeWidget` dep on `SessionLifecycleHandler`), following [#827]'s landed precedent that the widget's concerns do not share a lambda with the session-lifecycle one.
  `dispose()` → also clear `uiCtx`, since `update()`'s first line is `if (!this.uiCtx) return;`, which makes the measured re-registration impossible by construction and demotes registration order from a correctness dependency to documented intent.

- **[PR #850] reaches the same diagnosis and is a ship-time close target.**
  Single commit `3d6715cc` by `mikemikimike`.
  Adopted: the fix's shape and its widget-test assertion set (`vi.getTimerCount()` → 0, both registrations cleared).
  Diverged on six points, recorded in the plan's Background — most materially that it calls `disposeWidget()` at position 2 (before `abortAll()`), which the spike measures as undone; that it defaults the dep to a silent no-op (`= () => {}`), reintroducing the very defect class the issue is about; and that it is written against pre-[#827] `index.ts`.
  `Co-authored-by: mikemikimike <13286568797@163.com>` is specified in TDD step 4, resolved from the PR's commit author rather than guessed.

- **The Tidy-First assessor found one real preparatory step and refuted nothing.**
  Recommended: widen `test/ui/agent-widget.test.ts`'s `makeWidget()` to record `setStatus` calls, which it currently discards (`setStatus: () => {}`) — without it the "both registrations cleared" assertion cannot be written through the shared helper, which is exactly why [PR #850] hand-rolled a one-off UI recorder.
  It verified rather than assumed the four things I asked it to check: the `EventDrivenWidget` interface and `handlers/index.ts` barrel extend cleanly, and both `composition-root.test.ts` and `print-mode.test.ts` already fan out per event post-[#827].

- **Step 5's mutation is predicted to possibly leave the suite green, and the plan says so.**
  Swapping the two `session_shutdown` registrations may not turn the ordering test red, precisely because Decision 2's `uiCtx` clear makes the widget inert.
  The plan instructs the implementing session to record that as a finding, keep the test as an outcome pin, and move the ordering claim into the `index.ts` comment — rather than manufacture an assertion that only fails by reaching into private state.

- **`print-mode.test.ts` is in the plan's file list as a no-change entry.**
  The [#827] retro's `missing-context` finding was that this file was omitted from a file list for exactly the reason it belongs in one — it drives the composition root without the design editing it.
  Listing it explicitly as "no change, verified" closes that loop rather than relying on the next session to re-derive it.

#### Deferred tidyings

- `packages/pi-subagents/src/ui/agent-widget.ts` — the assessor considered and declined merging `dispose()` with `clearWidget()` to remove their apparent duplication.
  The behaviors genuinely differ (`clearWidget()` also prunes `finishedTurnAge` against the live agent list) and `clearWidget()`'s own doc comment states the separation is deliberate; a shared helper would need a discriminator parameter.
  Recorded only so a later sweep does not re-discover it as a candidate.

[#827]: https://github.com/gotgenes/pi-packages/issues/827
[PR #850]: https://github.com/gotgenes/pi-packages/pull/850
