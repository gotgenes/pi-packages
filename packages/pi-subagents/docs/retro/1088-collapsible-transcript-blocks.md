---
issue: 1088
issue_title: "`/subagents:sessions` renders every tool call expanded, and the transcript is not click-to-expandable like the main session"
---

# Retro: #1088 — `/subagents:sessions` renders every tool call expanded, and the transcript is not click-to-expandable like the main session

## Stage: Planning (2026-11-24T05:43:57Z)

### Session summary

Planned the fix for a third-party report (@Asianfleet): blocks in the session viewer open in the main conversation's expansion state, `Ctrl+O` toggles every block, a fullscreen left click toggles one, and the footer names the key.
Planning found a second cause the report omits: a released agent's snapshot source has no tool definitions, so Pi's generic rendering ignores expansion; the plan adds a built-in renderer fallback mirroring Pi's internal `withBuiltInRenderers`.
Plan committed as `packages/pi-subagents/docs/plans/1088-collapsible-transcript-blocks.md` (9 TDD steps).

### Observations

- Operator decisions: build all three parts; seed from `ctx.ui.getToolsExpanded()` with a pane-local toggle; include released agents; add the footer hint (dropped first); apply the built-in fallback to both sources; keep the Pi floor at `>=1.0.0`; record the upstream export ask in Open Questions for the operator to file (Pi's CONTRIBUTING bars LLM-written issues).
- The operator asked twice what newer Pi offers.
  Checked 1.0.0 through 1.6.0 and `main`: nothing new helps.
  `withBuiltInRenderers`/`createAllToolRenderers` exist since 1.0.0 but are unexported; `ToolRenderers` is exported from 1.0.1; `main`'s `renderChildLines`/`dispatchMouseToChildLines` are unreleased and unexported; regular mode never gets mouse tracking.
- My first recommendation (a local `Pick<ToolDefinition, …>` instead of bumping for `ToolRenderers`) was wrong: it fails `tsc` on parameter contravariance without `any`, and `no-explicit-any` is on for `src/`.
  `NonNullable<ConstructorParameters<typeof ToolExecutionComponent>[4]>` type-checks with no `any`; the plan records it.
  The operator chose the floor before that correction surfaced; the corrected type keeps their choice sound, but the gate premise was a claim I had not compiled.
- Spike measurements (80 columns): built-in `read` collapses 55 → 4 rows and hides even a one-line body, making it the discriminating test fixture; a tool with no definition renders 58 rows either way.
- Fullscreen click flow verified in `tui-alt-screen.js`: an unhandled `press` falls to text selection, and release synthesizes a `click` for the overlay, so the pane must return `undefined` for `press`.
- Tidy-First assessor: recommended `keysWith` gaining `app.tools.expand` and a `mouse()` fixture with overrides (both taken as `test:` steps).
  Its recommended separate refactor for the expansion walk was folded into the `fix:` step instead, because the walk also expands bash output (Pi's default is collapsed), which is a behavior change.
  It confirmed that a one-level walk over `block.container.children` reaches every expandable, and that the walk's start index must be read after `reset()`.
- `Co-authored-by: Asianfleet <88229228+Asianfleet@users.noreply.github.com>` on Steps 3, 5, and 8 (the reporter's root cause and fix direction).
- Risk to check in Step 9's live run: Pi's inline "(N more lines, … to expand)" may print without its key if the extension's `pi-coding-agent` import is a different module copy than the host's.

#### Deferred tidyings

- `packages/pi-subagents/src/ui/session-navigator.ts`: `TranscriptPaneOptions` relays `toolsExpanded`/`cwd`/`markdownTheme` into `TranscriptContent` untouched; a pane built around a prebuilt content object would drop the relay (assessor rejected as scope creep).

## Stage: Implementation — TDD (2026-11-24T06:12:59Z)

### Session summary

All 9 planned TDD steps landed, plus two review follow-ups (a relocated click test and a `renderShell` comment): built-in renderer fallback (mechanism, then the seven remaining rows), blocks opening in the main conversation's tool-output state, `Ctrl+O` toggle, the footer hint, and fullscreen click-to-toggle.
pi-subagents tests went from 2189 to 2229 (+40); `check`, root `lint`, `test`, and `fallow dead-code` are green.

### Observations

- Plan deviations, each recorded in its commit body:
  - Step 1: Pi's `withBuiltInRenderers` returns a merged copy whenever a built-in exists, so the planned identity (`toBe`) test was wrong; it asserts the kept renderers instead, plus a passthrough test for a non-built-in tool.
  - Step 2: `new Map([...])` infers its value type from the first row, so the heterogeneous factory table needed `new Map<string, DefinitionFactory>`.
  - Step 3: `agent_end` resets in `apply()` before `consumeSettled`, so it cannot kill the planned "start index before reset" mutation; a "history replaced by a shorter one" test does.
  - Step 6: the existing unbound-Home/End footer test now shows the toggle at 80 columns (it needs 78 once that pair is gone); the plan missed it.
    `keyPair` became the variadic `firstKeys`.
  - Step 8: the pane records `renderedView {start, rows}`.
    The two bounds guards had no test in the plan; scrolled header-row and footer-row click tests now pin them.
    The existing host-click test never painted first, so it returned before forwarding and pinned nothing until it rendered.
- Every planned killing mutation went red as predicted, plus extras for the two expanded-state tests, the passthrough test, and both bounds guards.
- A same-message batch of a doc edit plus `git commit` left `architecture.md` unstaged and tripped the invisible-characters hook's stash; it re-committed cleanly.
  Likewise, a full-suite run batched with a mutation script read the mutated tree.
  Both are the AGENTS.md "never batch" rule.
- Biome ignores the test files, so the re-indent after nesting `describe("wheel")` under `describe("mouse")` was scripted.
- I passed the pre-completion reviewer a base ref I had written from memory rather than from the `git rev-parse` output printed one call earlier; the reviewer caught it and used the right parent.
- Pre-completion reviewer: WARN, then PASS on the delta.
  The WARN's code findings (a click test nested under `wheel`; the `edit` `renderShell` difference from Pi's renderers-only table) were fixed in two follow-up commits.
  Still open: Step 9's live check in a real Pi session (live and released agents, regular and fullscreen, main conversation expanded first, and whether Pi's inline "… to expand" hint names its key).
  This session cannot drive the interactive TUI, so the operator should run it before `/ship`.
