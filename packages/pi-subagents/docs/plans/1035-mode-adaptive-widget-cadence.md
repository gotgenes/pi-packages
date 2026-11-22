---
issue: 1035
issue_title: "pi-subagents: measure the agents widget's render cost to settle its spinner cadence"
---

# Mode-adaptive agents-widget cadence

## Release Recommendation

**Release:** ship independently

No roadmap step in `packages/pi-subagents/docs/architecture/architecture.md` references this issue, so it carries no `Release: batch` tag.

## Problem Statement

The agents widget animates its braille spinner at 250 ms per frame, which reads as choppier than Pi's own 80 ms `Loader` drawing the same frames.
ReStranger's PR [#1024] proposes restoring 80 ms on the premise that Pi 1.0.0's default fullscreen mode removed the reason for the slowdown.

The slowdown (2eb62924) was a render-cost decision, not the [#864] repaint fix.
Every widget tick asks Pi to re-render its whole component tree, and while the parent idles the widget is the only thing asking.
The issue asks for that cost to be measured on a real, long transcript in both TUI modes before the cadence is chosen.

## Goals

- Measure the per-frame render cost of a real long transcript in fullscreen and regular mode (done at planning time; see Design Overview).
- Animate the widget at 80 ms in fullscreen mode, where the measurement shows the cost is negligible.
- Keep 250 ms in regular mode, where the measurement shows the cost still scales with transcript length.
- Follow a mid-session `/fullscreen` mode switch without a restart.
- Record the measured reasoning beside the constants, so the next cadence question starts from numbers.

The change is **not breaking**: it alters spinner pacing only, with no config key, default, output shape, or API change.

## Non-Goals

- A user-facing cadence setting — the measurement gives each mode a clear answer, and mechanism is forever while a constant is reversible.
- Reducing Pi's own regular-mode frame cost (`TuiMainScreen.doRender` scales with document length); that is upstream's, and Pi's own `Loader` pays it at 80 ms while the parent works.
- Change-gating `requestRender()` on a content snapshot — the #864 spike showed the spinner and elapsed readout change every tick while an agent runs, so it saves nothing.
- Landing PR [#1024]'s commit as-is: its flat 80 ms would cost regular-mode users roughly 11% of a core on a long transcript (measured below).
  The PR's doc-comment premise ("Fullscreen mode, Pi's default, has no such path") is right about the #864 repaint and silent about render cost.
- Revisiting the widget height bound (`DOCK_LINES_BELOW_WIDGET`, `widgetLineBudget`) — unchanged; it is what keeps regular mode free of the #864 destructive repaint at any cadence.

## Background

- `src/ui/agent-widget.ts` owns the animation timer.
  `WIDGET_UPDATE_INTERVAL_MS = 250` (line 76) is its single use, in `setTimerRunning(true)` (`setInterval(() => this.update(), …)`, line 164).
  `update()` calls `setTimerRunning(state.runningCount > 0)` on every pass (the #864 "timer runs iff a subagent is running" rule), then registers the widget factory or calls `this.tui?.requestRender()`.
- `TuiSurface` (line 54) is the slice of the TUI the factory touches: `terminal.{columns,rows}` and `requestRender()`.
- Pi invokes a widget factory synchronously inside `setWidget` with `this.ui` (`interactive-mode.js` `content(this.ui, theme)`), and `this.ui` is `createInteractiveTuiReference(() => this.renderer)` — a proxy that follows the active renderer across `switchTuiMode`.
  So `tui.mode` read at tick time reflects the current mode, including after `/fullscreen` toggles.
- `TUI.mode` is a public `abstract readonly mode: TuiMode` in `@earendil-works/pi-tui` 1.0.0; `TuiAltScreen.mode = "fullscreen"`, `TuiMainScreen.mode = "regular"`.
  Pi's default is fullscreen (`SettingsManager.getTuiMode()` returns `"regular"` only when set).
- Precedent: `src/ui/session-navigator.ts` already reads `tui.mode` (`probeTuiMode`) and maps anything not `"fullscreen"` to `"regular"`.
- AGENTS.md "Stale in-process extension code" does not bite here: the change does not touch a tool `/ship` calls.

## Design Overview

### How the measurement was produced

A throwaway Vitest probe (`packages/pi-subagents/test/probe-1035.test.ts`, deleted before this plan's commit) drove Pi's **real** renderers with the **real** `AgentWidget`:

- **Input (real):** session JSONLs from `~/.pi/agent/sessions/`, parsed with Pi's `parseSessionEntries`; either the `buildSessionContext` messages (what a resume renders) or every `message` entry (a live session's uncompacted history, the upper bound).
- **Transcript tree:** messages mapped onto Pi's per-entry components exactly as `InteractiveMode.renderSessionItems`/`addMessageToChat` do — `AssistantMessageComponent`, `ToolExecutionComponent` with the real `create*ToolDefinition` built-ins and `setExpanded(false)` (Pi's default), results applied via `updateResult`, `UserMessageComponent` with spacers, `BashExecutionComponent`, `CompactionSummaryMessageComponent`.
- **Fullscreen:** `TuiAltScreen` started on a fake 120×40 `Terminal`, with the layout root Pi's `createChatViewport` builds (`ScrollView(document)` over a `VStack` dock).
  **Regular:** `TuiMainScreen` with the same children in Pi's mount order.
- **Frame:** `widget.update()` then `tui.renderNow()`, one running background agent; 20 warm-up frames, then 200 timed frames per condition, timed with `performance.now()`; n = 5 independent runs per condition, medians agreeing within ~5%.
- **Not represented:** `custom`-role messages (need the extension's message renderer), extension tools (fall back to the generic tool renderer), images, and the real editor/footer (static stubs of 3 and 2 lines).
- **Control:** the same harness with an empty transcript isolates the widget's own cost from the transcript walk.

Measured per-frame medians (one representative run of five; machine: the operator's development Mac):

| Transcript                | Lines  | Fullscreen ms/frame | Regular ms/frame |
| ------------------------- | ------ | ------------------- | ---------------- |
| empty (control)           | 0      | 0.06                | 0.02             |
| 61 msgs (context)         | 768    | 0.10                | 0.38             |
| 260 msgs (context)        | 9,046  | 0.25                | 3.8              |
| 565 msgs (full history)   | 16,686 | 0.47                | 7.4              |
| 1,450 msgs (full history) | 17,998 | 0.80                | 8.7              |

Derived duty cycle on the 17,998-line transcript (median ÷ interval), for one running agent while the parent idles:

| Mode       | 80 ms           | 250 ms |
| ---------- | --------------- | ------ |
| fullscreen | ~1.0% of a core | ~0.3%  |
| regular    | ~11% of a core  | ~3.5%  |

The whole-tree walk the issue's synthetic probe counted does persist in fullscreen, but Pi's components cache their own lines and the alt-screen diff touches only visible rows, so it costs under a millisecond.
Regular mode's frame cost scales with document length, so 2eb62924's reason still holds there.

### Decision

Mode-adaptive cadence, chosen by the operator at the planning gate: 80 ms when `tui.mode === "fullscreen"`, 250 ms otherwise.
"Otherwise" covers regular mode and the not-yet-captured `tui` (a UI that never runs the factory, such as print/RPC mode or the composition-root test stubs) — the conservative cadence when the cost is unknown, matching `probeTuiMode`'s non-fullscreen-is-regular mapping.

```typescript
import type { TuiMode } from "@earendil-works/pi-tui";

/** Fullscreen frames cost under 1 ms even on an 18k-line transcript; this is Pi's own `Loader` value. */
const FULLSCREEN_ANIMATION_MS = 80;
/** Regular-mode frames scale with transcript length (~9 ms at 18k lines), so tick slower there. */
const REGULAR_ANIMATION_MS = 250;

function animationIntervalMs(mode: TuiMode | undefined): number {
  return mode === "fullscreen" ? FULLSCREEN_ANIMATION_MS : REGULAR_ANIMATION_MS;
}

export interface TuiSurface {
  readonly terminal: { readonly columns: number; readonly rows: number };
  readonly mode: TuiMode;
  requestRender(): void;
}
```

### Timer lifecycle (one field, whole lifecycle)

`widgetInterval` becomes `widgetTimer: ReturnType<typeof setTimeout> | undefined`, a self-rescheduling one-shot:

- **Set:** `setTimerRunning(true)` arms `this.widgetTimer ??= setTimeout(tick, animationIntervalMs(this.tui?.mode))`, so the interval is re-read on every arm.
- **Cleared by firing:** `tick` sets `this.widgetTimer = undefined`, then calls `this.update()`.
  `update()` calls `setTimerRunning(runningCount > 0)`, which re-arms while an agent runs and leaves it cleared otherwise.
- **Cleared by stopping:** `setTimerRunning(false)` calls `clearTimeout` and clears the field (`clearWidget`, `dispose`).
- **Read:** only `setTimerRunning`'s `??=` and its stop branch.
  After `dispose()` drops `uiCtx`, `update()` returns at its first line and the chain ends without re-arming.

In `update()`, the register-or-`requestRender` block moves **ahead** of `setTimerRunning(...)`, so the first arm already sees the `tui` the factory captured synchronously.
A theme `invalidate()` drops `tui`; the next `update()` re-registers before arming, so the cadence survives a theme change.

Edge cases stated as behavior, each tested:

- Fullscreen first tick fires at 80 ms (step 3, `"fullscreen"` stub; also real `TuiAltScreen` in `widget-viewport.test.ts`).
- Regular ticks at 250 ms (step 3; real `TuiMainScreen`).
- A mid-run mode switch changes the next interval (step 3).
- A factory never invoked → 250 ms (step 3).
- Ticking continues past the first tick (step 1).
- The chain stops when nothing runs and on `dispose()` (existing timer-lifetime and `dispose` tests, unchanged).

No new import edge crosses a directory: `TuiMode` is a type from the external `@earendil-works/pi-tui`, already imported by `src/ui/session-navigator.ts`.

## Module-Level Changes

- `packages/pi-subagents/src/ui/agent-widget.ts`
  - Step 1: `setInterval` → self-rescheduling `setTimeout`; rename `widgetInterval` → `widgetTimer`; move the registration block ahead of `setTimerRunning` in `update()`.
  - Step 3: replace `WIDGET_UPDATE_INTERVAL_MS` with `FULLSCREEN_ANIMATION_MS`/`REGULAR_ANIMATION_MS` and `animationIntervalMs`; add `readonly mode: TuiMode` to `TuiSurface`; rewrite the doc comment to carry the measured reasoning.
- `packages/pi-subagents/test/ui/agent-widget.test.ts`
  - Step 1: continued-ticking test in `"AgentWidget — animation cadence"`.
  - Step 2: `stubTui()` (line 25; used at lines 248, 277, 300, 412) gains `mode`/`requestRender` overrides, defaulting `mode` to `"regular"`, and the inline tui literal at line 531 routes through it.
  - Step 3: the `"asks Pi for one render per 250 ms"` test becomes per-mode tests.
- `packages/pi-subagents/test/ui/widget-viewport.test.ts` — step 3: a cadence block mounting the widget on real `TuiAltScreen`/`TuiMainScreen` instances (reuses the file's local `fakeTerminal`, no extraction).
- `.pi/skills/package-pi-subagents/SKILL.md` `## Upstream assumptions` — step 3 adds a row: the widget factory receives Pi's renderer-following TUI proxy, and `TuiAltScreen.mode`/`TuiMainScreen.mode` are `"fullscreen"`/`"regular"` (upstream files `packages/coding-agent/src/modes/interactive/tui-renderer.ts`, `packages/tui/src/tui-alt-screen.ts`, `packages/tui/src/tui-main-screen.ts`; breaks as behavioral-silent: the widget ticks at the wrong cadence).
- `packages/pi-subagents/docs/architecture/architecture.md` line 440 — "every 250 ms" becomes the mode-adaptive statement (step 4).
- `packages/pi-subagents/docs/architecture/client-server-opportunities.md` lines 24 and 99 — "250 ms" poll mentions updated (step 4).

Predicted unchanged, with the claim each rests on:

- `test/composition-root.test.ts` — its `setWidget: vi.fn()` never invokes the factory, so the cadence is 250 ms; `advanceTimersByTimeAsync(300)` still covers one tick, and `getTimerCount()` counts a pending `setTimeout` as 1 like an interval.
- `test/handlers/widget-events.test.ts`, `test/print-mode.test.ts` — never invoke the factory and never read the timer field.
- `test/helpers/transcript-fixtures.ts` `mockTui` — a full `TUI` for the session navigator, already carrying `mode`; not a `TuiSurface` fixture.
- `src/ui/widget-renderer.ts` — the renderer is pure and cadence-agnostic; `spinnerFrame` advances per `update()` regardless of interval.
- `README.md` — grepped along with the package skill for `250 ms`, `80 ms`, `WIDGET_UPDATE_INTERVAL`; no hits.

## Test Impact Analysis

1. New tests enabled: per-mode cadence and mid-run switching, previously impossible because the interval was a module constant fixed at arm time.
   The real-renderer cadence test pins Pi's actual `mode` values, which a string stub cannot — a Pi rename of `"fullscreen"` would turn it red.
2. Redundant tests: the single `"asks Pi for one render per 250 ms"` test is subsumed by the per-mode tests and is replaced, not kept beside them.
3. Kept as-is: the timer-lifetime block (`vi.getTimerCount()` assertions at lines 352–502) and `AgentWidget.dispose` (lines 550–564) — they pin the #864 "runs iff a subagent is running" rule, which this change must not regress.

## Invariants at risk

- **#864: the timer runs iff a subagent is running** (constituency: every user, idle cost).
  Pinned by the timer-lifetime tests in `test/ui/agent-widget.test.ts` (opened: they drive the real `AgentWidget` with fake timers and assert `vi.getTimerCount()`).
  The `setTimeout` chain keeps this because `update()`'s `setTimerRunning(runningCount > 0)` is the only re-arm path.
- **#864: no destructive full redraw in regular mode** (constituency: regular-mode users in short panes).
  Pinned by `test/ui/widget-viewport.test.ts` against the real `TuiMainScreen` `fullRedraws` counter; cadence does not enter it (it renders per tick synchronously).
- **Regular-mode idle cost stays at the 2eb62924 level** (constituency: `tuiMode: "regular"` users with long transcripts).
  Quantitative: ~3.5% of a core at 250 ms on the 17,998-line transcript (measured above), unchanged by design; pinned by the regular-mode cadence tests (stub and real `TuiMainScreen`).
- **`dispose()` is final (#849)** — pinned by the existing `dispose` tests; the chain ends because `update()` returns early once `uiCtx` is dropped.

## TDD Order

1. **refactor(pi-subagents): drive the agents widget animation with a one-shot timer chain**
   - Prepares the friction that `setInterval` fixes its period at arm time, so a mode-dependent interval cannot change without re-arming.
   - Red: add `"keeps asking for renders while an agent runs"` to `"AgentWidget — animation cadence"` — advance 750 ms, expect 3 `requestRender` calls.
     It passes against `setInterval` too (characterization), so write it first and confirm green, then switch the mechanism.
   - Change: `widgetInterval` → `widgetTimer` with the `setTimeout` lifecycle in Design Overview, `clearTimeout` in the stop branch, and the registration block moved ahead of `setTimerRunning` in `update()`; still 250 ms.
   - Verify: full `agent-widget.test.ts`, `composition-root.test.ts`, `widget-viewport.test.ts`, `pnpm run check`.
   - Killing mutation: in the tick callback, delete `this.widgetTimer = undefined;` — the `??=` keeps the spent handle, nothing re-arms, and the new test sees 1 render instead of 3.
2. **test(pi-subagents): build the widget tests' tui stub with a render mode**
   - Prepares the friction that `TuiSurface` gains a required `mode`, which every tui literal handed to the factory must carry (exactly two: `stubTui()` and the inline literal at line 531).
   - Change: `stubTui(overrides: { columns?; rows?; mode?; requestRender? })` returning `mode: overrides.mode ?? "regular"`; the line-531 literal becomes `stubTui({ requestRender })`.
     The mode-switch test in step 3 needs a mutable mode, so the stub returns a plain object whose `mode` the test can reassign (no copy).
   - Verify: suite green, no assertion changed.
   - No killing mutation: test-only refactor with no new assertion.
3. **perf(pi-subagents): animate the agents widget at 80 ms in fullscreen mode**
   - Change: the constants, `animationIntervalMs`, `TuiSurface.mode`, and the doc comment (measured per-frame costs for both modes, why regular stays at 250 ms, that `tui` is Pi's renderer-following proxy).

   - Tests in `agent-widget.test.ts`, replacing the 250 ms test:
     - `"asks Pi for a render every 80 ms in fullscreen mode"` — stub `mode: "fullscreen"`; nothing at 79 ms, one at 80, two at 160.
     - `"asks Pi for a render every 250 ms in regular mode"` — nothing at 249, one at 250.
     - `"follows a switch to fullscreen on the next tick"` — start regular, advance 250 (one render), set `tui.mode = "fullscreen"`, advance 80 (two renders).
     - `"ticks at the regular cadence before Pi hands the widget a TUI"` — `setWidget` never invokes the factory; count `manager.listAgents` calls: none extra at 80 ms, one tick at 250 ms.

   - Tests in `widget-viewport.test.ts`, new `describe("AgentWidget cadence under Pi's real renderers")` with fake timers: mount on `new TuiAltScreen(fakeTerminal(100, 40), false, …)` and on `new TuiMainScreen(…)`, spy `requestRender`, assert the first tick at 80 ms and 250 ms respectively.

   - Killing mutations, one per equivalence class:
     - Fullscreen: make `animationIntervalMs` return `REGULAR_ANIMATION_MS` unconditionally — kills both fullscreen tests and the switch test.
     - Regular/unknown: change the predicate to `mode !== "regular" ? FULLSCREEN_ANIMATION_MS : REGULAR_ANIMATION_MS` — kills the never-invoked-factory test only (an `undefined` mode now ticks at 80).
     - Real mode values: change the predicate's literal to `"alt-screen"` — kills the stub fullscreen tests and the real `TuiAltScreen` test.
     - First-arm ordering: move `this.setTimerRunning(...)` back above the registration block in `update()` — the fullscreen stub test's first render arrives at 250, not 80.
     - Per-tick re-read: hoist the interval into a field computed once on first arm — kills the switch test.

   - Commit body records the measurement table's two duty-cycle rows and that regular mode keeps 250 ms by design, then the trailer:

     ```text
     Co-authored-by: ReStranger <restranger@disroot.org>
     ```

     ReStranger's PR [#1024] proposed the 80 ms restoration this step adopts for fullscreen; the email is the one on its commit `ed038e99`.
4. **docs(pi-subagents): describe the widget's mode-adaptive cadence**
   - `architecture.md` line 440: "every 250 ms" → "every 80 ms in fullscreen mode and every 250 ms in regular mode".
   - `client-server-opportunities.md` lines 24 and 99: "250 ms" → "80/250 ms".
   - Verify: `pnpm exec rumdl check` on both files; grep the package (excluding `docs/plans`, `docs/retro`, `docs/architecture/history`) for `250 ms` and `WIDGET_UPDATE_INTERVAL` — expect only the new constant's doc comment.

## Risks and Mitigations

- **Probe fidelity.**
  The probe omits custom messages, extension-tool renderers, and images, so a real transcript may render somewhat slower.
  Mitigation: the fullscreen margin is wide (0.8 ms against an 80 ms budget); the alt-screen diff cost is bounded by visible rows, and the walk itself is component-cached.
- **Timing measured on one machine.**
  A slower machine scales both columns; the fullscreen/regular ratio (~10×) is what drives the decision, and it is structural (visible-row diff versus whole-document diff).
- **`setTimeout` drift.**
  A one-shot chain adds each tick's render time to the period (sub-millisecond in fullscreen); invisible at spinner cadence.
- **Upstream renames `TuiMode` values.**
  The real-renderer cadence test in `widget-viewport.test.ts` turns red; add the mode-value assumption to the package skill's Upstream assumptions table in step 3.
- **Mode switch via a non-proxy `tui`.**
  If Pi ever passed the concrete renderer instead of its proxy, a switch would leave the widget reading the old mode until re-registration; the cadence would then be stale.
  The cost of that failure is bounded: the widget keeps the mode it was mounted under until the next re-registration (a theme change or a new session).
  The upstream-assumption row covers this too.

## Open Questions

- PR [#1024] is the close target at ship time: close it with a pointer to the measurement and the `Co-authored-by` commit, rather than merging it.

[#864]: https://github.com/gotgenes/pi-packages/issues/864
[#1024]: https://github.com/gotgenes/pi-packages/pull/1024
