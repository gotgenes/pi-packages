---
issue: 864
issue_title: "pi-subagents: regular TUI can go blank when background AgentWidget starts; resize restores it"
---

# Retro: #864 — pi-subagents: regular TUI can go blank when background AgentWidget starts; resize restores it

## Stage: Planning (2026-09-21T15:49:58Z)

### Session summary

Planned the fix for a third-party report (`Kacep91`) that Pi's regular-mode TUI goes blank while the background agents widget animates.
The reported mechanism was traced to Pi's `firstChanged < prevViewportTop` guard in `tui-main-screen.js`, then **reproduced and measured** with a throwaway spike that drove Pi's real `TuiMainScreen` against a fake `Terminal` with the real `AgentWidget` mounted.
The plan (`packages/pi-subagents/docs/plans/0864-bound-widget-to-terminal-viewport.md`) has seven steps: three Tidy-First preparations, a viewport-derived line budget, a running-only timer rule, the 250 ms cadence, and a doc refresh.

### Observations

- The reporter's diagnosis named the 80 ms loop but not the path to a blank screen.
  Measuring found it: at 12 widget lines and 14 terminal rows, **100 of 100** spinner ticks call `fullRender(true)`, which clears screen *and* scrollback and repaints the whole transcript (53,699 bytes/tick on a 2000-line transcript, roughly 671 KB/s at 12.5 Hz).
  At 24 rows it is 0 of 100.
  The trigger is `(widgetLines - 1) + dockLinesBelowWidget > terminalRows`, so the extension owns a real lever: `renderWidgetLines` never saw `tui.terminal.rows` and capped at a hard-coded 12.
- The spike refuted the reporter's proposed item 2 and redirected it.
  Change-gating `requestRender()` on a content snapshot saves nothing while an agent runs, because the spinner and the `formatMs` elapsed readout genuinely change every tick.
  The saving lives entirely in the no-running-agent case: a queued-only or finished-only widget writes **0 bytes** per tick yet burns 0.34–0.41 ms of whole-tree re-render, indefinitely, since `finishedTurnAge` ages only on `turn_start`.
  That became a timer-lifetime rule (`timer runs iff runningCount > 0`) rather than a cached snapshot, which needs no new state.
- Verified the issue's six cross-references rather than trusting them.
  All six exist.
  `pi#4785` (the closest match: names `pi-subagents`, the 80 ms spinner, and `fullRender(true)` in small panes) is closed **completed** while its one-line PR `pi#4784` is closed **unmerged**, and the guard is unchanged in Pi 0.86.0.
  `pi#8923`, which the body summarizes as "missing terminal rows restored by resize", is actually a **fullscreen**-mode issue closed `NOT_PLANNED` whose own repro notes regular-mode recovery worked and that the failure persists with widgets removed, so it does not support the regular-mode claim.
- The issue's diagnostics recipe (`PI_DEBUG_REDRAW=1`, log at `~/.pi/agent/pi-debug.log`) is correct for the reported 0.84.4 but wrong for current Pi: `main` renamed it to `PI_TUI_DEBUG_REDRAW` and the log to `pi-tui-debug.log` under `logDirectory`.
- The operator asked whether to match Pi's own animation timer instead of picking 250 ms. Checked: Pi's `Loader` default is also 80 ms, so we already match, but `DEFAULT_INTERVAL_MS` is module-private, `InteractiveMode.workingIndicatorOptions` is `private`, and `ctx.ui.setWorkingIndicator()` is a setter with no getter, so there is no runtime read path.
  More decisive: Pi's loader animates only while the parent is *working* and is swapped for the static `IdleStatus` when idle, the opposite duty cycle to ours, so its cadence carries no justification for our window.
  Operator chose 250 ms flat.
- The package already had the convention for this: `TranscriptPane.viewportHeight` in `session-navigator.ts` reads `tui.terminal.rows` and clamps with a `CHROME_LINES` / `MIN_VIEWPORT` / `VIEWPORT_HEIGHT_PCT` triple.
  `widgetLineBudget` mirrors it, using the absolute-reserve form rather than the percentage one because the reserved quantity is a literal count of dock rows below the widget.
- An existing doc comment on `onSubagentResuming` already asserts "the timer stops once nothing is running", which the code does not hold (`clearWidget` stops it only when nothing is active *and* nothing finished).
  Step 5 makes the comment true.
- Escape-hatch setting declined by the operator: once the height bound removes the hazard, a disable knob guards nothing, and mechanism is forever while docs are reversible.
- Tidy-First assessor returned three Recommended preparations (a params builder in `test/widget-renderer.test.ts`, a `stubTui()` builder in `test/ui/agent-widget.test.ts`, and a `setTimerRunning(shouldRun)` extraction in `agent-widget.ts`), and corrected the design summary's field count (the params object has 6 fields, so `terminalHeight` is the 7th, not the 8th).
  Its most useful note was a rejection: a fully behavior-preserving "single owner in `update()`" refactor is not reachable, because collapsing three event triggers to one state check *is* the behavior change, so it stays one atomic `fix:` commit on top of the mechanism extraction.
  Every count it reported was re-verified by grep before the plan recorded it.

#### Deferred tidyings

- `packages/pi-subagents/test/widget-renderer.test.ts` and `packages/pi-subagents/test/ui/agent-widget.test.ts` — promoting the two new local builders to `test/helpers/ui-stubs.ts` was rejected as premature; neither shape is reused outside its own file today, and `ui-stubs.ts` currently exports only `makeMenuUI`.
- `packages/pi-subagents/src/ui/widget-renderer.ts` — narrowing the `renderWidgetLines` params object was rejected: every field is read on every call by the single consumer, so 6→7 fields is cohesion, not a dependency bag.

## Stage: Implementation — TDD (2026-09-21T17:28:02Z)

### Session summary

Executed all seven planned steps plus one unplanned eighth, each as its own commit leaving the tree green.
The widget's rendered height now derives from `tui.terminal.rows`, its animation timer runs if and only if a subagent is running, and the cadence is 250 ms. Test count 1803 → 1830 (+27), including a new `test/ui/widget-viewport.test.ts` that drives Pi's real `TuiMainScreen` against a fake `Terminal`.

### Observations

- The new integration test **reproduced the reported defect before fixing it**, at exactly the cells the planning spike measured: 10 rows with 4 agents, 12 rows with 4 agents, and 14 rows with 6 agents all failed on the Red step, while 16, 18, 24, and 40 rows passed.
  That is the strongest evidence this branch carries — the test would have caught the bug, not merely documents the fix.
- Every step's killing mutations behaved as predicted, with two informative surprises.
  The `setTimerRunning(true)` no-op mutation killed four tests where the plan named three: `"clears the update interval"` also asserts the timer exists before `dispose()`, so it depends on the start path too.
  The `terminalHeight: tui.terminal.columns` mutation killed only the integration cells and left every `widgetLineBudget` unit test green, which is precisely why both layers exist.
- One planned test had a **wrong premise** and was corrected during Red: `"counts every agent behind a dropped queued line"` originally used one running plus three queued agents, but `totalBody` (3) fits `maxBody` (3), so `assembleWithinBudget` ran and no overflow occurred.
  Adding a finished agent forced the overflow path the test is about.
- Deviation, doc-only: `packages/pi-subagents/docs/architecture/client-server-opportunities.md` was not in the plan's Module-Level Changes but stated the old 80 ms poll in three places.
  It is a live forward-looking note rather than a `history/` file, so it was updated; the reviewer confirmed every remaining `80 ms` hit under the package is in `docs/plans/`, `docs/architecture/history/`, or `docs/retro/`, all frozen artifacts.
- Deviation, behavioral: the plan predicted **no change** to `assembleOverflow`, and that prediction was falsified by this change's own effect.
  Lowering the line budget made a pre-existing queued-drop path reachable at ordinary small-pane sizes — at 10 rows with one running, one queued, and one finished agent the summary reported `+1 more (1 finished)` while hiding two agents.
  The pre-completion reviewer found it; the finding was reproduced independently with a throwaway probe before acting on it, rather than accepted as a premise.
  The operator chose to fix it in this branch over filing a follow-up, since the reachability is this change's doing and lands where the issue lives.
  Raising the budget floor to hide the path again was offered and declined: it would trade the honest 3-line floor for a widget the viewport bound cannot protect.
  The plan now carries a `### Departure: assembleOverflow counts hidden queued agents` section recording this.
- `perf(pi-subagents): slow the agents widget animation to 250 ms` was kept despite reading as mechanism-named, because `perf` reaches the changelog and the animation cadence *is* the observable — a user sees the spinner rate.
  The rule against seam-named subjects targets things like "add `terminalHeight` param", not a user-visible behavior change stated with its value.
- Two ESLint auto-fixes landed during commits: the fake `Terminal` satisfies Pi's interface structurally, so both `as unknown as Terminal` and the `as never` casts on the widget-factory arguments were unnecessary.
  The compiled fake needing no cast is a small piece of evidence that the test couples to Pi's public surface rather than its internals.
- Pre-completion reviewer: **WARN** (round 1) → **WARN** (round 2, delta-scoped).
  Round 1's re-derivation confirmed the timer-stop claim (the one `Date.now()` in `renderFinishedLine` is unreachable, since `categorizeAgents` only routes agents that already have `completedAt`), `dispose()`'s #849 inertness, linger-aging independence from the timer, and the integration test's line-order fidelity against Pi's real mount order.
  Round 2 verified the fix's arithmetic, proved `+0 more ()` is unreachable, and reduced to a documentation finding — the stale plan prediction and a missing retro entry, both addressed here.

## Stage: Sync (worktree) (2026-09-21T17:31:25Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both passed clean with no fixes needed before this note.
The branch carries eleven commits over the plan: seven planned TDD steps plus one unplanned eighth (`fix(pi-subagents): count hidden queued agents in the widget overflow summary`, a pre-completion-reviewer finding fixed in-branch per the operator's choice) plus two documentation-only corrections closing the reviewer's round-2 WARN.
The plan's `**Release:** ship independently` marker still applies — no roadmap step references #864, so nothing gates this on a batch.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-864--/2026-09-20T22-29-02-289Z_01a0c0ef-e4d1-71e3-8faa-17061c81cebf.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

Nothing deferred beyond what the plan's own Open Questions already name (an optional upstream `pi-tui` report, and the overflow-summary presentation at a 3-line budget).
No follow-up issues were filed during implementation.

## Stage: Final Retrospective (2026-09-21T17:54:18Z)

### Session summary

Shipped #864 through the worktree lane: fast-forward merged thirteen commits, verified CI, closed the issue, and released `pi-subagents` v21.7.5.
The ship itself ran without a single correction or retry — thirty-four turns, every gate green on the first attempt.
This entry synthesizes all four stages (planning, TDD, sync, ship), reading the peer session transcript for the three that ran outside this session.

### Observations

#### What went well

- The planning spike is the strongest thing this issue produced.
  It drove Pi's **real** `TuiMainScreen` against a fake `Terminal` with the real `AgentWidget` mounted, and the measured table (100 of 100 destructive redraws at 12 widget lines / 14 rows; 0 of 100 at 24 rows) did more than confirm the report — it **refuted the reporter's proposed change-gating** and redirected it to a timer-lifetime rule.
  A theorized fix would have shipped the wrong mechanism.
- The Red step was verified against a measured prediction rather than a guess.
  `test/ui/widget-viewport.test.ts` failed at exactly the cells the spike measured (10 rows × 4 agents, 12 × 4, 14 × 6) and passed at 16, 18, 24, and 40 — so the test demonstrably would have caught the bug, not merely documented the fix.
- The pre-completion reviewer's finding was **independently reproduced before being acted on**.
  The implementing session wrote a throwaway probe (`test/probe.test.ts`, deleted immediately after) to confirm the `assembleOverflow` undercount rather than accepting the subagent's claim as a premise — exactly the posture `AGENTS.md` principle 2 asks for.
- The tidy-first assessor's most valuable output was a **rejection**: it ruled that collapsing three timer-start triggers into one state check *is* the behavior change, not a preparation for it, which kept the `refactor:` mechanism extraction and the `fix:` rule change as separate commits.
- Feedback loops ran incrementally throughout, not at the end.
  Every step ran `vitest run` at Red and at Green, `pnpm run check` after Green, and its planned killing mutations before committing — with two mutations returning informative surprises (a fourth test killed where three were predicted; a `terminalHeight` mutation that killed only the integration cells, proving the two test layers discriminate different claims).

#### What caused friction (agent side)

- `instruction-violation` (self-identified, recurrent) — an em-dash written as a literal `\u2014` token in `Edit` bodies, in **both** peer sessions and under **both** models.
  It landed as literal text in `test/ui/agent-widget.test.ts` (twice) and in the plan file, and caused one failed `Edit` in the sync stage where the `oldText` did not match the real character already in the file.
  Both `markdown-conventions` § Non-ASCII in authored prose and the `AGENTS.md` addendum already carry this rule, and it was still violated.
  Impact: roughly six extra tool calls across the peer sessions, including an `od -c` inspection to diagnose the failed match.
  No content rework.
- `instruction-violation` (self-identified) — the repair for those literals reached for `perl -CSD -pi` rather than a second `Edit`, and the first attempt (`s/AgentWidget \\\\u2014 the animation/…/`) was itself over-escaped and matched nothing.
  `edit-tool` § Scripted substitutions already says a replacement containing backslashes is a trap and to use `Edit`; the skill does not name the *repair* case specifically, which is where both sessions went wrong.
  Impact: one wasted `perl` invocation plus its verification grep.
- `missing-context` (reviewer-caught) — the plan asserted "No change to `assembleOverflow`" on the strength of a reachability the change itself altered.
  Lowering the line budget from a fixed 10 to a viewport-derived floor of 3 made a pre-existing queued-drop miscount reachable at ≤10 rows with an ordinary agent mix, where it previously needed five simultaneous running agents.
  Impact: one extra `fix:` commit and two documentation commits at the end of TDD.
  The pre-completion reviewer caught it before the land, so the designed safety net worked.
- `other` (self-identified) — a commit body passed to `git commit -m` with literal `\n` sequences instead of separate `-m` arguments, landing the escape in the message.
  Caught immediately with `git log -1 --format=%B | cat -A` and amended.
  Impact: three tool calls, no rework.

#### What caused friction (user side)

- Nothing that cost time.
  Two interventions materially improved the outcome:
  - Asking "why not match Pi's own animation timer?" at the cadence gate turned a picked number into a grounded one — the investigation found Pi's `Loader` default is *also* 80 ms but module-private, setter-only, and animating on the **opposite** duty cycle, which is a far better justification for choosing 250 ms than the original.
  - Choosing to fix the `assembleOverflow` finding in-branch rather than defer it kept the fix where its reachability was created, and declining the offered "raise the budget floor to hide the path again" preserved the honest 3-line floor.
- Opportunity, not criticism: the operator reviewed the `perf:` subject-line judgment call only because the implementing session surfaced it explicitly at handoff.
  That surfacing is worth keeping as a habit — it converted a silent judgment into a reviewed one at zero cost.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5` (judgment-heavy: root-cause analysis, spike design, TDD sequencing); sync and ship ran on `anthropic/claude-sonnet-5` (procedural gate-and-merge work); this retrospective on `anthropic/claude-opus-5`.
  All four subagent dispatches — the root-cause Explore, the tidy-first assessor, and both pre-completion review rounds — ran on `claude-sonnet-5`, attributed from their own task transcripts rather than their agent definitions.
  No mismatch to flag: the sonnet-5 reviewer found the one substantive defect the opus-5 plan missed, and the sonnet-5 ship lane needed no judgment calls.
- **Escalation-delay tracking** — no sequence exceeded five consecutive tool calls on the same error.
  The longest same-target run was five edit-and-measure cycles on the planning spike, which was deliberate instrument refinement producing the measured table, not a rabbit hole.
- **Feedback-loop gap analysis** — no gap.
  Verification ran after every Red and every Green, killing mutations ran per step before each commit, and the full gate set (`check`, `lint`, `test`, `fallow dead-code`) ran after the last step and again at ship time on the merged tree.
  The ship lane's own gates caught nothing because the peer's had already run — the redundancy cost about 26 seconds and remains correct, since the tip the root merged was rebased after the peer checked it.

### Changes made

1. `.pi/skills/edit-tool/SKILL.md` — added one sentence to § Scripted substitutions naming the repair case for a literal `\uXXXX` an edit body just wrote: re-edit with the character typed literally rather than reaching for a `perl` substitution carrying the same escape.
   The surrounding backslash-escape trap was already documented; both peer sessions failed to recognize the repair as an instance of it.
2. `.pi/prompts/plan-issue.md` — added one sentence to the Non-Goals bullet: a Non-Goal resting on a path being unreachable is a claim about the current bound, so re-derive the reachability when the change moves that bound.
   Written against this issue's own falsified `assembleOverflow` prediction.

Nothing was added to `AGENTS.md`: the em-dash rule already has two skill homes, and a third copy fails the admission test's second question.
