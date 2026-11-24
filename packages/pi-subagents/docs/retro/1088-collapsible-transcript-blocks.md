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
