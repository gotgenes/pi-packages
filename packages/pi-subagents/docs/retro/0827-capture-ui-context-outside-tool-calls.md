---
issue: 827
issue_title: "pi-subagents: widget never renders in a session with no model tool call (UICtx captured only on tool_execution_start)"
---

# Retro: #827 — pi-subagents: widget never renders in a session with no model tool call

## Stage: Planning (2026-08-30T21:29:56Z)

### Session summary

Planned Phase 22 Step 6: move the widget's `UICtx` capture off `tool_execution_start` and onto `session_start`, and retarget the finished-agent linger clock onto `turn_start`.
Re-verified the issue's six SDK facts against the pinned `@earendil-works/pi-coding-agent@0.84.4` (the issue cited 0.79.1), ran the design gate, dispatched the Tidy-First assessor, and committed `packages/pi-subagents/docs/plans/0827-capture-ui-context-outside-tool-calls.md`.
Filed [#849] for the widget's missing `session_shutdown` teardown and recorded its disposition as Phase 22 Step 9.

### Observations

- **The tool-call gate protects nothing.**
  The issue's central open question — "is the tool-call gate protecting something specific about *when* a `UICtx` is safe to capture?"
  — resolves to no. `phase-18-reconsider-ui.md` Step 4 records [#423]'s invariant as "no inbound calls from core **spawn tools**", which is about `foreground-runner.ts`/`background-spawner.ts`, not about `tool_execution_start` as a capture site.
  `ToolStartHandler` predates that work (`c293e41e`); it is where a `ctx` happened to be in hand.
  Reading the close comment / history file rather than the ADR's summary sentence is what settled it.

- **The issue's candidate approach 2 was refuted before the gate.**
  A lazy `getUICtx: () => UICtx | undefined` supplier still needs an event-driven capture: `ExtensionAPI` (SDK `types.d.ts:906`) exposes no ambient `ui`, only the per-event `ctx.ui`.
  It relocates the same wiring behind an indirection, so it was dropped from the option set rather than offered.

- **Three gate decisions, all recommendations accepted.**
  Linger aging → `turn_start` (over a wall-clock linger, and over deferring); capture wiring → repoint the existing handler (rename `tool-start.ts` → `widget-events.ts`) rather than widening `SessionLifecycleHandler` or inlining a lambda in `index.ts`; headless → capture unconditionally rather than guarding on `ctx.hasUI`.
  The wall-clock alternative would have deleted `finishedTurnAge`, `seedFinishedAgents()`, and `onTurnStart()` outright; it was declined for changing observable linger semantics from "until you act" to "for N seconds".

- **The Tidy-First assessor returned "no preparatory tidying warranted", and its verifications were the useful part.**
  It confirmed the widget-construction ordering claim (`pi.on("session_start", …)` at `index.ts:185` precedes `new AgentWidget(...)` at 192, so the hoist is required, not optional), confirmed only the barrel and the composition root reference `ToolStartHandler`/`ToolStartWidget`, and declined a comment refresh in `test/ui/agent-widget.test.ts` as cosmetic churn after reading the block.
  It also read the wrong SDK copy (0.79.1) for its `session_start` ctx check; that fact was independently verified against 0.84.4 in the main session, so the conclusion held.

- **The assessor missed a real preparatory step because it was missing from the file list I gave it.**
  `test/composition-root.test.ts`'s `makePi()` records handlers in a `Map` keyed by event name, so a second `session_start` registration would silently evict the lifecycle one and break both existing tests in that file for an unrelated reason.
  Found by grepping for tests that import `#src/index` after the assessment came back.
  It became TDD Step 1 (`test:`, fixture records an array per event and fires all of them) — the plan's only preparatory commit.
  Lesson: the assessor's field list is the assessment's boundary, and a wiring change's blast radius includes every test that drives the composition root, not just the files the design edits.

- **A pre-existing interval leak closes as a side effect.**
  `ensureTimer()` starts the 80 ms interval from lifecycle notifications regardless of `uiCtx`, but the only clear paths are `clearWidget()` (unreachable while `update()` early-returns) and `dispose()` (no caller).
  So a background spawn in headless mode, or before the first tool call, leaks an interval until process exit.
  Capturing at `session_start` makes `clearWidget()` reachable.
  Recorded in the plan as a consequence, not a goal.

- **`AgentWidget.dispose()` has no call site — filed as [#849].**
  Adopted as Phase 22 Step 9 in Track C (operator chose "new step" over defer/fold/out-of-scope), with a hard dependency on this step, since Step 6 decides where the widget's host-event wiring lives.
  Track C was renamed from "Widget activation" to "Widget lifecycle" to cover both halves.

#### Deferred tidyings

- `packages/pi-subagents/test/ui/agent-widget.test.ts` — the assessor considered and explicitly declined refreshing the `describe("AgentWidget.update self-seeds finished agents")` block's comments; they already say "turn" generically and name no tool event, so there is nothing stale.
  Recorded only so a later sweep does not re-discover it as a candidate.

## Stage: Implementation — TDD (2026-08-30T21:48:51Z)

### Session summary

Executed all three TDD steps from the plan.
The widget's `UICtx` capture moved from `tool_execution_start` to `session_start`, the finished-agent linger clock moved to `turn_start`, `ToolStartHandler` became `WidgetEventsHandler` with one method per event, and the extension no longer subscribes to `tool_execution_start` at all.
Tests went 1349 → 1353 (72 files, unchanged): −3 from the deleted `tool-start.test.ts`, +4 in `widget-events.test.ts`, +3 in `composition-root.test.ts`.
Pre-completion reviewer: PASS.

### Observations

- **Deviation 1 — a second fixture with the same defect.**
  The plan's preparatory step named only `test/composition-root.test.ts`, whose `makePi()` keyed handlers one-per-event and would have silently evicted the lifecycle `session_start` handler once the widget registered a second one.
  `test/print-mode.test.ts` has its own `makePi()` with the identical shape and also fires `session_start`, so it needed the same fan-out fix.
  Found by grepping for tests that import `#src/index` — the same grep the planning stage used to find the first one, run one step later than it should have been.
  The reviewer independently confirmed these are the only two.

- **Deviation 2 — the plan's mutation set had a hole, in the half the change relocated.**
  All three killing mutations the plan named killed exactly the tests it predicted (2 / 1 / 1).
  But a fourth mutation — deleting `pi.on("turn_start", () => widgetEvents.handleTurnStart())` from `src/index.ts` — left the entire 1352-test suite green.
  The plan reasoned about mutations for the code it *wrote* (the two handler methods) and for the wiring line that fixed the *bug*, and skipped the wiring line that merely *moved*.
  A relocated call is exactly as unpinned at its new site as it was at its old one, and "behavior-preserving" is what makes it easy to skip.
  Fixed by adding a fourth composition-root test that drives an agent to completion and asserts the next `turn_start` clears the widget.

- **The composition-root file was the right seam and it already existed.**
  Its own docstring says it asserts "the wiring contract that unit tests cannot see — only this file fails if the wiring is removed", which is precisely the claim this issue needed.
  The two handler unit tests survive the real defect's mutation; only the composition-root test dies.

- **The SDK's multi-handler fan-out is load-bearing and was worth verifying twice.**
  `runner.js:63` documents it and `runner.js:627` iterates the per-event array; both fixtures now model it.
  Two `session_start` and two `turn_start` registrations from one extension all fire, in registration order.

- **No behavior change inside `AgentWidget`.**
  Its diff is two doc comments.
  The wall-clock linger alternative rejected at the planning gate would have touched `finishedTurnAge`, `seedFinishedAgents()`, and `clearWidget()`; keeping the turn counter meant `test/ui/agent-widget.test.ts` is byte-identical, which the reviewer used to confirm Step 1's (#724) `isBackground` filter invariant holds by construction.

- **The incidental timer-leak fix is real but partial.**
  `clearWidget()` is now reachable in headless and before the first tool call, so the 80 ms interval terminates.
  `AgentWidget.dispose()` still has no call site, which is [#849] / Phase 22 Step 9.

[#423]: https://github.com/gotgenes/pi-packages/issues/423
[#849]: https://github.com/gotgenes/pi-packages/issues/849
