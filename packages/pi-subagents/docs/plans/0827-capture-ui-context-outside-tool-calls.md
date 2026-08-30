---
issue: 827
issue_title: "pi-subagents: widget never renders in a session with no model tool call (UICtx captured only on tool_execution_start)"
---

# Capture the widget's UI context outside the tool-call path

## Release Recommendation

**Release:** ship independently

Phase 22 Step 6 carries `Release: independent`, and the step is not a member of the phase's one release batch (`front-door-majors`, Steps 3 and 4, both landed).
The change lands as a single `fix:` commit, which is an unhidden changelog type and cuts a release on its own.

## Problem Statement

`AgentWidget.update()` opens with `if (!this.uiCtx) return;`, and the only site that ever supplies a `UICtx` is `ToolStartHandler.handleToolExecutionStart`.
A session in which the model never calls a tool therefore runs with the widget dark for its whole life — no widget, no status line — even for background agents that pass the widget's roster filter.

This is reachable today from a command-driven dispatch: a slash-command handler that calls `getSubagentsService().spawn(...)` runs agents with no model tool call anywhere in the parent loop.
[#724] and PR #748 report one recorded run of 35 transcript entries over 31 minutes with the widget never rendering.

The widget's ability to draw is keyed to an event that has nothing to do with drawing — temporal coupling, the same smell class the phase's spine addresses at the front door.

## Goals

- The widget renders in a session where the parent model never calls a tool.
- The linger clock that ages finished agents out of the widget advances on a signal that exists in such a session.
- The change is non-breaking: no public export, service field, or settings key changes.

## Non-Goals

- **Wall-clock linger.**
  Replacing the turn-counted linger with a time-based one was offered at the design gate and declined.
  `finishedTurnAge`, `seedFinishedAgents`, `shouldShowFinished`, and `ERROR_LINGER_TURNS` keep their present shape and semantics.
- **Widget teardown at `session_shutdown`.**
  `AgentWidget.dispose()` has no call site; that gap is [#849], adopted as Phase 22 Step 9 (Track C, after this step).
  This plan does not wire it.
- **A lazy `getUICtx` supplier.**
  The issue's candidate approach 2 needs a capture site regardless — `ExtensionAPI` exposes no ambient `ui`, only the per-event `ctx.ui` — so it relocates the same wiring behind an extra indirection.
  Rejected before the gate for that reason.
- **`SubagentRecord` widening.**
  PR #748's second commit is a separate concern and already landed as Phase 22 Step 2 ([#830]).
- **Any change to `SubagentRuntime`.**
  The capture stays out of the runtime, preserving [#422]'s outcome.

## Background

### The current wiring

`src/index.ts` registers three widget-relevant subscriptions:

```typescript
pi.on("session_start", (event, ctx) => lifecycle.handleSessionStart(event, ctx));
// …
const widget = new AgentWidget(manager, registry);
observer.add(widget);

const toolStart = new ToolStartHandler(widget);
pi.on("tool_execution_start", (event, ctx) => toolStart.handleToolExecutionStart(event, ctx));

const interrupt = new InterruptHandler(manager, () => settings.abortAllOnInterrupt);
pi.on("turn_start", (_event, ctx) => interrupt.handleTurnStart(ctx));
```

`ToolStartHandler` (31 lines, `src/handlers/tool-start.ts`) does exactly two things in one method:

```typescript
handleToolExecutionStart(_event: unknown, ctx: ToolStartCtx): void {
  this.widget.setUICtx(ctx.ui);
  this.widget.onTurnStart();
}
```

Both duties are misplaced, and for different reasons.
`setUICtx` needs an event that fires in every session; `tool_execution_start` does not.
`onTurnStart` ages the finished-agent linger counter and is named for a turn, but `tool_execution_start` fires once per **tool call**, so a row seeded during a multi-tool turn can age out on the second call of the turn it finished in.

### What the tool-call gate was protecting

Nothing specific.
`docs/architecture/history/phase-18-reconsider-ui.md` Step 4 records [#423]'s invariant as "the widget is a reactive consumer; no inbound calls from core **spawn tools**" — a statement about `foreground-runner.ts` and `background-spawner.ts`, not about `tool_execution_start` as a capture site.
Step 5 ([#424]) notes only that "UICtx capture stays in `ToolStartHandler`", with no rationale.
`ToolStartHandler` predates both, introduced by `c293e41e` during the `index.ts` decomposition — it is simply where a `ctx` was already in hand.
A capture wired from the composition root at `session_start` adds no inbound call from a spawn tool, so [ADR-0004]'s invariant holds.

### SDK facts, re-verified against the pinned `@earendil-works/pi-coding-agent@0.84.4`

The issue verified these against 0.79.1; the package pins `0.84.4` as a devDependency with a `>=0.81.0` peer range, so each was re-checked in the installed bundle.

| Fact                                                  | Evidence                                                                                                                                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The TUI is up before extension init                   | `dist/modes/interactive/interactive-mode.js:697` — `this.ui.start()` under the comment "Start the UI before initializing extensions so `session_start` handlers can use interactive dialogs"                                            |
| `ctx.ui` is live at `session_start`                   | `dist/core/agent-session.js:1918` — `bindExtensions()` calls `_applyExtensionBindings()` (which calls `runner.setUIContext(...)`) and only then emits `session_start`                                                                   |
| `ctx.ui` is a per-session singleton                   | `dist/core/extensions/runner.js:508` — `get ui()` returns `runner.uiContext`; identity changes only when a new `ExtensionRunner` is built on reload (`agent-session.js:2195`)                                                           |
| Headless is safe                                      | `runner.js:88` defines `noOpUIContext` with empty `setWidget`/`setStatus`; `runner.js:155` binds it when no UI context is supplied                                                                                                      |
| One extension may register several handlers per event | `runner.js:63` — "A single extension may register multiple handlers for the same event"; `runner.js:627` iterates the per-event array                                                                                                   |
| `turn_start` fires on tool-less turns                 | `agent-session.js:478` emits it from the agent loop independently of tool calls; `src/handlers/interrupt.ts`'s own doc comment already relies on this ("keeps the handler tracking the current signal across runs and tool-less turns") |

### A pre-existing leak this closes incidentally

`AgentWidget.ensureTimer()` starts an 80 ms interval from the manager's lifecycle notifications, regardless of whether a `UICtx` was ever captured.
The interval is cleared only in `clearWidget()`, which `update()` never reaches while `uiCtx` is undefined, and in `dispose()`, which has no caller ([#849]).
So today a background spawn in headless mode — or in interactive mode before the first tool call — starts an interval that runs until process exit.
Capturing at `session_start` gives `update()` a `uiCtx` in both modes, so `clearWidget()` becomes reachable and stops the timer once nothing is active or lingering.
This is a consequence of the fix, not a goal of it.

## Design Overview

Two host events replace one.

- `session_start` supplies the `UICtx`.
  It fires exactly once per session bind, before any turn, in both interactive and headless mode.
- `turn_start` advances the linger clock.
  It fires once per parent turn, including tool-less turns, which is what `onTurnStart` has always meant.

`tool_execution_start` is dropped entirely — the extension stops subscribing to its highest-frequency event.

### The handler

`src/handlers/tool-start.ts` becomes `src/handlers/widget-events.ts`, and its single method splits along the two events:

```typescript
/** Narrow widget interface — only the methods this handler calls. */
export interface EventDrivenWidget {
  setUICtx(ctx: unknown): void;
  onTurnStart(): void;
}

/** Minimal context shape for session_start — only the field the handler reads. */
interface SessionStartCtx {
  ui: unknown;
}

export class WidgetEventsHandler {
  constructor(private readonly widget: EventDrivenWidget) {}

  handleSessionStart(_event: unknown, ctx: SessionStartCtx): void {
    this.widget.setUICtx(ctx.ui);
  }

  handleTurnStart(): void {
    this.widget.onTurnStart();
  }
}
```

The class keeps the package's established handler shape: a narrow structural interface for its one collaborator, one method per host event, and no knowledge of anything else.
`EventDrivenWidget` renames `ToolStartWidget` with the same two members — the mechanical `<Handler><Role>` analogue (`WidgetEventsWidget`) does not read, so the interface is named for the role it describes.

### Composition-root wiring

`src/index.ts` construction order changes: `const widget = new AgentWidget(...)` and `observer.add(widget)` move above the `pi.on("session_start", ...)` block so the widget exists when its registration is written.
The capture then takes its own registration rather than being folded into the lifecycle lambda:

```typescript
const widget = new AgentWidget(manager, registry);
observer.add(widget);
const widgetEvents = new WidgetEventsHandler(widget);

pi.on("session_start", (event, ctx) => lifecycle.handleSessionStart(event, ctx));
pi.on("session_start", (event, ctx) => widgetEvents.handleSessionStart(event, ctx));
pi.on("session_before_switch", () => lifecycle.handleSessionBeforeSwitch());
pi.on("session_shutdown", () => lifecycle.handleSessionShutdown());

pi.on("turn_start", (_event, ctx) => interrupt.handleTurnStart(ctx));
pi.on("turn_start", () => widgetEvents.handleTurnStart());
```

Two registrations, not one fused lambda: the session-lifecycle concern and the widget concern are unrelated, and Pi runs both.
Registration order is immaterial — `lifecycle.handleSessionStart` stores the session context and clears completed agents; the widget capture reads nothing it writes.

### Headless

The capture is unconditional.
`ctx.hasUI` is available and was considered; guarding on it would preserve the interval leak described above and buys nothing, because `noOpUIContext`'s `setWidget` and `setStatus` are empty functions.
The cost is that `update()` runs its `listAgents()` projection every 80 ms in headless while agents are active — bounded by the same `clearWidget()` path that now terminates it.

### Reload and session switch

`setUICtx`'s existing `ctx !== this.uiCtx` guard is unchanged and still carries the identity case.
On reload Pi builds a new `ExtensionRunner` and a new wrapped UI context, and emits `session_start` again; the guard sees a different object, forces re-registration, and the widget re-attaches.
Within a session the object is stable, so a repeat call is a no-op.

### What does not change

`AgentWidget` gets no behavior change.
`finishedTurnAge`, `seedFinishedAgents()`, `shouldShowFinished()`, `ERROR_LINGER_TURNS`, `clearWidget()`, `assembleWidgetState()`, and the 80 ms timer are untouched.
Two doc comments that name `tool_execution_start` become wrong and are corrected.

## Module-Level Changes

| File                                  | Change                                                                                                                                                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/handlers/tool-start.ts`          | Deleted.                                                                                                                                                                                                                                                             |
| `src/handlers/widget-events.ts`       | New. `WidgetEventsHandler` with `handleSessionStart` / `handleTurnStart`; `EventDrivenWidget` replaces `ToolStartWidget`; `SessionStartCtx` replaces `ToolStartCtx`.                                                                                                 |
| `src/handlers/index.ts`               | Barrel: `ToolStartHandler` export replaced by `WidgetEventsHandler`.                                                                                                                                                                                                 |
| `src/index.ts`                        | Import swap; widget construction and `observer.add(widget)` hoisted above the `session_start` registrations; `WidgetEventsHandler` constructed; second `session_start` and second `turn_start` registrations added; the `tool_execution_start` registration removed. |
| `src/ui/agent-widget.ts`              | Doc comments only: `setUICtx`'s "(grabbed from first tool execution)" and `onTurnStart`'s "(tool_execution_start)" corrected to name `session_start` and `turn_start`.                                                                                               |
| `test/handlers/tool-start.test.ts`    | Deleted.                                                                                                                                                                                                                                                             |
| `test/handlers/widget-events.test.ts` | New. Covers the two methods separately.                                                                                                                                                                                                                              |
| `test/composition-root.test.ts`       | `makePi()`'s handler `Map` becomes multi-handler; new regression test for a service spawn with no tool call.                                                                                                                                                         |
| `docs/architecture/architecture.md`   | Module-tree entry for `handlers/tool-start.ts` renamed and re-described (in the fix commit); Step 6 marked ✅ with a `Landed:` note, and its Mermaid node marked ✅ (in the docs commit).                                                                            |

### Symbol sweep

`ToolStartHandler` and `ToolStartWidget` are referenced outside their own file and test only by `src/handlers/index.ts` (barrel) and `src/index.ts` (one import, one construction).
`docs/architecture/architecture.md:409` names `tool-start.ts` in the module-layout tree.
`README.md`, `docs/configuration.md`, and `.pi/skills/package-pi-subagents/SKILL.md` name neither the class nor the file.
Remaining `tool_execution_start` matches in `src/` belong to `record-observer.ts` (child-session activity tracking) and `subagent-state.ts`, which this change does not touch.

### The composition-root fixture is load-bearing

`test/composition-root.test.ts`'s `makePi()` records handlers in a `Map`:

```typescript
on: vi.fn((event: string, handler: any) => handlers.set(event, handler)),
```

A second registration for the same event silently replaces the first, which is not how Pi behaves (`runner.js:63`).
With the fix in place and the fixture unchanged, the widget's `session_start` handler would evict the lifecycle one, `runtime.setSessionContext` would never run, and both existing tests in that file would fail for a reason unrelated to the change.
The fixture must record an array per event and fire all of them.
This was not in the Tidy-First assessor's field list and is folded in below as the plan's one preparatory step.

## Test Impact Analysis

### New tests the change enables

- `test/handlers/widget-events.test.ts` — `handleSessionStart` passes `ctx.ui` to `setUICtx`; `handleTurnStart` calls `onTurnStart`.
  Each method is now independently exercisable, which the fused `handleToolExecutionStart` was not.
- `test/composition-root.test.ts` — the wiring regression: run `subagentsExtension(pi)`, fire `session_start` with a recording `ui`, spawn a background agent through the published `SubagentsService`, and assert `ui.setWidget` was called **without any `tool_execution_start` handler ever being invoked**.
  This is the only test that fails if the `session_start` registration is deleted, which is exactly the contract the file's own docstring says it exists to hold.
  It uses `vi.useFakeTimers()` so the widget's 80 ms interval does not leak into the rest of the run.

### Tests that become redundant

- `test/handlers/tool-start.test.ts`'s third case, "calls setUICtx before onTurnStart", loses its subject: the two calls now belong to different events, so there is no ordering to assert.
  It is dropped rather than rewritten.

### Tests that must stay as-is

- `test/ui/agent-widget.test.ts`'s `describe("AgentWidget.update self-seeds finished agents")` block calls `widget.onTurnStart()` directly and asserts the 1-turn / 2-turn linger.
  `AgentWidget`'s behavior is unchanged, so these stay verbatim.
  The Tidy-First assessor read the block and declined a comment refresh: its comments say "turn" generically and name no tool event, so there is nothing stale to correct.
- `test/ui/agent-widget.test.ts`'s background-only filtering block pins Step 1's ([#724]) widget-filter outcome and is untouched.
- `test/observation/record-observer.test.ts`'s `tool_execution_start` cases concern the **child** session's activity tracking, a different subscription entirely.

### Baseline

`pnpm --filter @gotgenes/pi-subagents run test` at the plan commit: 72 files, 1349 tests, all passing.
Expected after the change: 72 files (one renamed), 1349 − 1 (dropped ordering test) + 1 (composition-root regression) = 1349, plus or minus however the two handler cases split.

## Invariants at risk

| Invariant                                                                             | Source                   | Pinned by                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The widget is a reactive consumer with no inbound calls from core spawn tools         | [#423], [ADR-0004]       | `test/ui/agent-widget.test.ts` → `describe("AgentWidget — self-drives from lifecycle notifications")`, which constructs a real `AgentWidget` over a manager stub and asserts the timer starts from `onSubagentStarted`/`onSubagentCreated`. The spawners' freedom from a widget dependency is held by the type checker plus `test/helpers/make-deps.ts`, which carries no widget field. This change adds no spawn-tool call, so the invariant is preserved by construction. |
| The runtime holds zero UI state                                                       | [#422]                   | `runtime.ts` is not in this plan's file list, and `SessionContext` in `src/types.ts` has no `ui` member. The capture terminates at the widget.                                                                                                                                                                                                                                                                                                                              |
| The widget filter reads `Subagent.isBackground`, so SDK-spawned agents are eligible   | [#724] Step 1 `Outcome:` | `test/ui/agent-widget.test.ts` → `describe("AgentWidget — background-only filtering")`, which constructs the widget over a manager stub whose records carry `isBackground` and asserts foreground-only rosters register nothing. `listBackgroundAgents()` is untouched.                                                                                                                                                                                                     |
| The composition root replays the parent's runtime-registered providers onto the child | [#812]                   | `test/composition-root.test.ts`'s two existing tests, both of which route through `captureSessionFactoryIO`'s `session_start` fire. The fixture change in Step 1 below is what keeps them passing once a second `session_start` handler exists.                                                                                                                                                                                                                             |

No quantitative invariant is at risk: the change touches no prompt text, no token budget, and no cached prefix.

## TDD Order

### 1. `test:` teach the composition-root fixture to hold multiple handlers per event

Surface: `test/composition-root.test.ts`.
Change `makePi()` to record `handlers: Map<string, Handler[]>` (push, do not set) and add a `fire(event, ...args)` helper that awaits every registered handler in order; route `captureSessionFactoryIO`'s `session_start` call through it.
Prepares: the fix adds a second `session_start` registration and a second `turn_start` registration, which the current `Map.set` fixture would silently drop — evicting the lifecycle handler and breaking both existing tests for the wrong reason.
Green today, since every event currently has exactly one handler.
Verify: `pnpm --filter @gotgenes/pi-subagents run test` — 1349 passing, unchanged.
Killing mutation: none — this is a fixture, and its fan-out is what Step 2's regression test exercises.
Commit: `test(pi-subagents): record every handler per event in the composition-root fixture`.

### 2. `fix:` capture the widget's UI context at session_start and age it on turn_start

Red: write `test/handlers/widget-events.test.ts` against `#src/handlers/widget-events` — `handleSessionStart({}, { ui })` calls `setUICtx(ui)`; `handleTurnStart()` calls `onTurnStart()`.
Fails: the module does not exist.
Then add the composition-root regression test described above; it fails because nothing supplies a `UICtx` without a tool call.

Green: create `src/handlers/widget-events.ts`, delete `src/handlers/tool-start.ts` and `test/handlers/tool-start.test.ts`, update `src/handlers/index.ts`, and rewire `src/index.ts` (hoist the widget construction, add the two registrations, drop the `tool_execution_start` one).
Correct the two stale doc comments in `src/ui/agent-widget.ts` and the module-tree entry in `docs/architecture/architecture.md`.

All of this is one commit: removing the `ToolStartHandler` export breaks the barrel and the composition root at the type level, so the extraction and both consumers must land together.

Verify: `pnpm run check`, `pnpm run lint`, `pnpm --filter @gotgenes/pi-subagents run test`, `pnpm fallow dead-code --workspace @gotgenes/pi-subagents`.

Killing mutations, one per equivalence class:

- Delete the `this.widget.setUICtx(ctx.ui)` line from `handleSessionStart` → the `handleSessionStart` unit test and the composition-root regression both go red; the `handleTurnStart` test stays green.
- Delete the `this.widget.onTurnStart()` line from `handleTurnStart` → the `handleTurnStart` unit test goes red; the other two stay green.
- Delete the `pi.on("session_start", (event, ctx) => widgetEvents.handleSessionStart(event, ctx))` registration from `src/index.ts` → **only** the composition-root regression goes red.
  This is the mutation that matters: it is the actual defect, and both handler unit tests survive it.

Commit: `fix(pi-subagents): render the agent widget in sessions with no model tool call`.

### 3. `docs:` mark Phase 22 Step 6 landed

Surface: `packages/pi-subagents/docs/architecture/architecture.md`.
Mark the Step 6 heading ✅, add a `Landed:` note recording the two-event split, the dropped `tool_execution_start` subscription, and how the `finishedTurnAge` loose end was settled (aging retargeted to `turn_start`, which also corrects the per-tool-call miscount), and mark the `S6` Mermaid node ✅.
Verify: `pnpm exec rumdl check packages/pi-subagents/docs/architecture/architecture.md`.
Commit: `docs(pi-subagents): mark Phase 22 Step 6 landed`.

## Risks and Mitigations

| Risk                                                                        | Mitigation                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A second `pi.on` for the same event is dropped or overwrites the first      | Verified in the installed SDK: `runner.js:63` documents multi-handler registration and `runner.js:627` iterates the per-event array. Step 1 makes the test fixture model the same behavior, so the assumption is exercised rather than assumed.                                            |
| Capturing a no-op UI context in headless makes the widget do useless work   | `noOpUIContext`'s `setWidget`/`setStatus` are empty, and `update()`'s work is bounded by `clearWidget()`, which the capture now makes reachable — net less work than today's never-cleared interval.                                                                                       |
| Retargeting the linger clock changes when a finished row disappears         | It lengthens visibility slightly and never shortens it: `tool_execution_start` fires at least once per tool-calling turn, so a row aged out at the second tool call of a turn now survives to the turn's end. The existing linger tests drive `onTurnStart()` directly and are unaffected. |
| The composition-root regression test leaks an 80 ms interval into the suite | The test runs under `vi.useFakeTimers()`, matching the pattern already used by `test/ui/agent-widget.test.ts`'s self-drive block.                                                                                                                                                          |
| `AgentWidget` still has no teardown at `session_shutdown`                   | Out of scope by decision; tracked as [#849] and adopted as Phase 22 Step 9, which depends on this step's wiring.                                                                                                                                                                           |

## Open Questions

- Whether Step 9 ([#849]) should put the widget in `SessionLifecycleHandler`'s dependency set or give `WidgetEventsHandler` a third method wired to `session_shutdown`.
  Deferred to that step's plan; this plan's shape supports either.

[#422]: https://github.com/gotgenes/pi-packages/issues/422
[#423]: https://github.com/gotgenes/pi-packages/issues/423
[#424]: https://github.com/gotgenes/pi-packages/issues/424
[#724]: https://github.com/gotgenes/pi-packages/issues/724
[#812]: https://github.com/gotgenes/pi-packages/issues/812
[#830]: https://github.com/gotgenes/pi-packages/issues/830
[#849]: https://github.com/gotgenes/pi-packages/issues/849
[ADR-0004]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0004-reconsider-ui-direction.md
