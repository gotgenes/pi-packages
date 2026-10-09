---
package: pi-subagents
phase: 23
---

# Retro: pi-subagents — Phase 23 Planning (first-class-runs)

## Stage: Improvement Planning (2026-10-09T02:33:39Z)

### Session summary

The cause hypothesis, written before any tool ran, was that a run is not a first-class concept: a subagent is a sequence of runs (the initial run, then one per resume), but every per-run fact lives on the per-agent record and "initial or resume" is re-decided in parallel method pairs at three layers.
Discovery corroborated it from four independent directions, and the operator chose a full phase: Track A (runs as first-class, four new issues [#1048] to [#1051] with [#949] folded into [#1049]), Track A+ ([#1013]), Track B ([#947] with [#912]), and Track D ([#1017]), nine steps at the ceiling.
A follow-up question from the operator ("are we cleaning up enough technical debt?") added named ride-along tidyings to four steps and a named Phase 24 candidate for the remainder.

### Observations

- **The cause and its corroboration.**
  The hypothesis traced to the first-principles section's "`Subagent` is four conflated domains", which describes one run; the roadmap commit adds the refinement as "A subagent is a sequence of runs".
  Corroboration, each measured: `completeRun`/`completeResume` have diverged (a resumed run that wraps up at its turn limit while asking a question keeps its workspace, untested; [#1022] gave resumes a turn budget without carrying [#1021]'s rule); fallow's first production clone group since Phase 19 is `runTurnLoop`/`resumeTurnLoop`; `lifecycle/subagent.ts` rose from 39.9 to 52.1 and overtook `index.ts`; and three open issues ([#1012], [#1013], [#949]) are the cause seen from the widget, the concurrency gate, and the abort lever.
  The craftsmanship scout found the divergence independently, without being told the hypothesis.
- **Method extraction was the wrong tool, twice.**
  Two Tidy-First assessors had declined method-level fixes on exactly this pair ([#913]'s `beginRun`, [#857]'s `holdForResume`), both correctly: the sequences do not line up because the state has no owner.
  The deferred-tidyings sweep is what surfaced this; a rejected tidying recurring on the same pair is a signal for a lifecycle object, not a third attempt at a helper.
- **Declared candidate.**
  Phase 22's Findings named [#947], [#912], and [#755] as a phase's spine; [#755] has since closed.
  It was put in the first `ask_user` beside the run spine, and the operator took both, so it became Track B rather than the spine.
- **Deferral gate.**
  Did not fire: the primary cause is Category C with user-visible bugs attached.
  The scout's only concentrated cluster (`subagent.test.ts` against `subagent.ts`) rides [#1050]; all five fallow large-function flags on test files were refuted.
- **Repeat deferrals.**
  [#608] and [#519] (3rd sweep) were closed as not planned; [#722], [#735], and [#564] lost the `pkg:pi-subagents` label; 2nd-sweep feature asks were deferred with rationale, except [#912], which the operator scheduled.
- **The boy-scout path is not reducing scattered debt.**
  Comparable counts grew across phases: `(manager as any).sweep()` 7 to 8, the events-observer payload triad 4 to 5.
  A change-scoped Tidy-First assessment declines debt on lines its change does not touch (the [#858] retro records exactly this), so scattered items in hot files persist indefinitely unless a roadmap names them.
  The operator's answer: name each item on the step that already edits its file, with a metric row, and name the cold remainder as the Phase 24 candidate.
  This is worth carrying into `/plan-improvements` itself: "scattered, defer to boy-scout" should check whether a step already touches the file before deferring.
- **Feasibility probe.**
  [#1017]'s precondition was confirmed against the installed Pi 1.0.0 `dist/core/system-prompt.js`: `buildSystemPromptSections` renders only the section shape, so the pre-0.86 footer arm cannot run.
- **Trajectory.**
  Maximum step priority 15, 16, 16, 16 (Phases 20 to 23) with the top hotspot heating, so the cadence question did not fire.
- **Non-ASCII corruption in one large `Edit`.**
  The roadmap insertion carried about 45 non-ASCII characters (em-dashes, arrows, comparison signs, a warning sign); they arrived as stray `cb`/`cf` tokens and blank lines, and `pi-autoformat` then reflowed the damage into broken table rows and split list items.
  Recovery: excise the region, rewrite it in a `.txt` file with ASCII placeholders, and splice it back with a Python substitution; every later edit stayed ASCII-only.
  For a large roadmap insertion, the placeholder route is cheaper to use up front than to recover into.

[#1012]: https://github.com/gotgenes/pi-packages/issues/1012
[#1013]: https://github.com/gotgenes/pi-packages/issues/1013
[#1017]: https://github.com/gotgenes/pi-packages/issues/1017
[#1021]: https://github.com/gotgenes/pi-packages/issues/1021
[#1022]: https://github.com/gotgenes/pi-packages/issues/1022
[#1048]: https://github.com/gotgenes/pi-packages/issues/1048
[#1049]: https://github.com/gotgenes/pi-packages/issues/1049
[#1050]: https://github.com/gotgenes/pi-packages/issues/1050
[#1051]: https://github.com/gotgenes/pi-packages/issues/1051
[#519]: https://github.com/gotgenes/pi-packages/issues/519
[#564]: https://github.com/gotgenes/pi-packages/issues/564
[#608]: https://github.com/gotgenes/pi-packages/issues/608
[#722]: https://github.com/gotgenes/pi-packages/issues/722
[#735]: https://github.com/gotgenes/pi-packages/issues/735
[#755]: https://github.com/gotgenes/pi-packages/issues/755
[#857]: https://github.com/gotgenes/pi-packages/issues/857
[#858]: https://github.com/gotgenes/pi-packages/issues/858
[#912]: https://github.com/gotgenes/pi-packages/issues/912
[#913]: https://github.com/gotgenes/pi-packages/issues/913
[#947]: https://github.com/gotgenes/pi-packages/issues/947
[#949]: https://github.com/gotgenes/pi-packages/issues/949
