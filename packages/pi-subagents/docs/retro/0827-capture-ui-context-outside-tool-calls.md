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

## Stage: Sync (worktree) (2026-08-31T01:51:26Z)

### Session summary

Pre-push checks passed clean: `pnpm run lint` and `pnpm fallow dead-code` both zero-finding.
No deferred work for the root to pick up; the plan's `**Release:** ship independently` marker stands — this is not part of the `front-door-majors` batch (already shipped) and no other open batch names Step 6.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-827--/2026-08-30T21-06-06-493Z_01a0547e-6c1d-7afc-9ae4-5c0362ca7b20.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Nothing further to add beyond the Planning and TDD stage entries above.
The pre-completion reviewer's PASS already covers the deterministic gates this stage re-checks; both re-ran clean here with no drift.

## Stage: Final Retrospective (2026-08-31T03:19:17Z)

### Session summary

Landed #827 through the two-session worktree convergence: the peer branch fast-forwarded onto `main`, CI passed, the issue closed, and `pi-subagents-v21.0.2` released.
Four stages across two sessions and two models ran with zero operator corrections and no rework.
The retrospective's substantive finding is a gap in mutation-planning discipline that the TDD stage caught on its own initiative, not from the plan.

### Observations

#### What went well

- **The fourth mutation was unprompted, and it is the reason this change shipped pinned.**
  The plan named three killing mutations and all three killed exactly the tests predicted (2 / 1 / 1) — a clean pass by the letter of the protocol.
  The TDD agent then ran a fourth on its own: deleting `pi.on("turn_start", () => widgetEvents.handleTurnStart())` from `src/index.ts` left all 1352 tests green.
  The plan had reasoned about mutations for the code it *wrote* (the two handler methods) and for the wiring line that *fixed the bug*, and skipped the wiring line that merely *moved*.
  A relocated registration is exactly as unpinned at its new site as it was at its old one, and "behavior-preserving" is precisely what makes it easy to skip.
  Fixed with a fourth composition-root test that drives an agent to completion and asserts the next `turn_start` clears the widget.

- **The peer-transcript breadcrumb worked end to end on its first real exercise.**
  `/sync-worktree` recorded the peer session's `.jsonl` path in the Sync stage note; this retro read all 146 peer turns in a single `read_session_file` call after the worktree had already been torn down.
  Complete model attribution across all four stages came from that one call, with no guessing and no `jq`.

- **Verification ran incrementally at every step, not just at the end.**
  All four gates (`check`, `lint`, `test`, `fallow dead-code`) established a green baseline before TDD step 1; `check` plus the package suite ran after each step; the mutation loop ran before each commit; all four gates re-ran at the end and again at `/sync-worktree`.
  No feedback-loop gap to report.

- **The ship stage was 22 turns with zero retries.**
  Release coordination read the plan's `**Release:** ship independently` marker off the peer branch before any irreversible work, so no gate interrupted the land.

#### What caused friction (agent side)

- `missing-context` — the plan's preparatory fixture step named only `test/composition-root.test.ts`, but `test/print-mode.test.ts` carries its own `makePi()` with the identical one-handler-per-event `Map` and also fires `session_start`.
  The planning session had both files in hand: its turn-41 command was `wc -l packages/pi-subagents/test/composition-root.test.ts packages/pi-subagents/test/print-mode.test.ts`.
  It measured both and carried one into the plan.
  Impact: folded into the same TDD commit and recorded as a deviation — no rework, but the implementer had to re-derive a file list the plan should have carried.

- `missing-context` — the plan named no killing mutation for the relocated `turn_start` wiring, the half the change moved rather than authored.
  Neither `/plan-issue`'s mutation guidance nor `/tdd-plan`'s four mandatory verify-the-pins cases covers a line that merely changes call sites.
  Impact: caught only because the TDD agent went beyond the plan; cost one extra composition-root test.
  Had it not, a behavior-preserving relocation would have shipped unpinned with a green suite and a PASS review.

- `missing-context` (subagent scope) — the `tidy-first-assessor`'s target-file list, drawn per the skill from "the `src`/`test` files the change will modify or create", excluded every test that merely *drives* the composition root.
  `test/composition-root.test.ts` was not a file the design edited; it was a file the design would break.
  The assessor also read SDK `0.79.1` rather than the pinned `0.84.4` for its `session_start` ctx check.
  Impact: none in either case — the planning agent's own post-assessment `grep -rn '#src/index'` caught the first, and it had independently verified the SDK facts against `0.84.4`.
  Both were caught by luck of an ad-hoc follow-up rather than by the dispatch protocol.

#### What caused friction (user side)

None.
Three planning design gates (linger aging, capture wiring, headless handling) and one roadmap-fit gate for [#849] were answered with every recommendation accepted, and no stage required a correction.
No earlier-context or earlier-intervention opportunity identified.

### Diagnostic details

- **Model-performance correlation** — Planning and TDD ran on `anthropic/claude-opus-5` (SDK-fact verification, three design gates, mutation reasoning); Sync and Ship ran on `anthropic/claude-sonnet-5` (lint, `fallow`, rebase, ff-merge, CI, release); this retrospective on `anthropic/claude-opus-5`.
  The judgment-heavy stages got the stronger model and the mechanical ones did not, with no mismatch in either direction.
  The one model-adjacent note is the `tidy-first-assessor` reading a stale SDK copy, which is a scope-bound defect rather than a capability one.

- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest same-target sequence was the mutation loop at peer turns 100–115 (~15 calls), but each call applied or reverted a distinct mutation; that is the protocol executing, not a stall.

- **Unused-tool detection** — skipped.
  Both `missing-context` points had the needed information already in the session (a `wc -l` output, a relocated line in the diff); no subagent or search tool would have supplied anything the agent lacked.

### Changes made

1. `.pi/prompts/plan-issue.md` — added a sentence to the TDD Order mutation guidance requiring a killing mutation for a **moved** registration or call site, not only for code the step authors.
2. `.pi/prompts/tdd-plan.md` — added a fifth mandatory verify-the-pins case covering a relocated call or registration, and corrected the list's stale `Three cases` lead-in to `These cases` (it had four bullets since #801's addition).
3. `.pi/skills/tidy-first/SKILL.md` — widened Step 1's target-file list to include every test that drives the seam the change rewires, even when the design edits none of them.

#### Considered and not made

- A further `when X, grep Y` entry in `/plan-issue`'s Module-Level Changes list for copy-pasted test fixtures.
  The `print-mode.test.ts` miss was not a grep failure — the grep had run and `wc -l` had named both files — so a grep rule would not have prevented it, and change 3 addresses the class at its source.
- A rule requiring the `tidy-first-assessor` to verify the pinned SDK version.
  One instance, zero impact, and `AGENTS.md` already requires confirming an API against the installed version.

[#423]: https://github.com/gotgenes/pi-packages/issues/423
[#849]: https://github.com/gotgenes/pi-packages/issues/849
