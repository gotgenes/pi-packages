---
issue: 148
issue_title: "Split AgentWidget rendering from lifecycle (Phase 9, Step P)"
---

# Retro: #148 — Split AgentWidget rendering from lifecycle

## Final Retrospective (2026-05-23T06:20:00Z)

### Session summary

Extracted pure rendering functions (`renderWidgetLines`, `renderFinishedLine`, `renderRunningLines`) from `AgentWidget` into `ui/widget-renderer.ts`.
The widget shrank from 374 to 198 lines — now a thin lifecycle wrapper.
23 new unit tests cover all status variants, overflow, tree connectors, and empty states.
Released as `pi-subagents-v6.16.1`.

### Observations

#### What went well

- TDD cycles were fast and clean: 9 commits, all tests green on first or second try, zero test regressions across the full 806-test suite.
- The `WidgetAgent` / `WidgetActivity` interfaces worked well as structural subsets — `AgentRecord` and `AgentActivityTracker` satisfy them without mapping code.
- The stub `Theme` pattern from `test/renderer.test.ts` (`fg: (c, t) => \`[\${c}:\${t}]\``) transferred cleanly to the new test file, keeping assertions readable.

#### What caused friction (agent side)

- `missing-context` — The plan's `renderWidgetLines` API spec omitted `theme` from its parameters, even though the heading, tree connectors, and per-agent render calls all require it.
  Caught immediately at step 4 (first `renderWidgetLines` test) and fixed by adding `theme` to the params.
  Impact: deviation note in commit body; no rework.

- `missing-context` — Step 3 (`renderRunningLines` implementation) initially missed importing `SPINNER` from `display.ts`.
  The test caught it as a runtime `ReferenceError`, fixed in the same Red→Green cycle.
  Impact: added friction but no rework.

- `wrong-abstraction` — Step 8 ("Extract into `widget-renderer.ts`") was a no-op because the module was created incrementally during steps 1–7 (tests must import from the new module to run).
  Impact: step skipped; noted in summary.

#### What caused friction (user side)

- None observed — the session ran autonomously from plan through ship with no user corrections needed.
