---
issue: 1088
issue_title: "`/subagents:sessions` renders every tool call expanded, and the transcript is not click-to-expandable like the main session"
---

# Collapsible blocks in the session viewer

## Release Recommendation

**Release:** ship independently

This issue is a third-party bug report that no roadmap step in `docs/architecture/architecture.md` references, so it carries no `Release:` batch tag.

## Problem Statement

Open `/subagents:sessions` and pick any agent: every tool call paints its whole output inline, and so do compaction summaries and skill blocks.
A transcript with dozens of tool calls becomes unreadable, and the pane offers no way to collapse anything.
Pi's main conversation in the same process mounts those blocks collapsed, toggles all of them with `app.tools.expand` (`Ctrl+O`), and toggles one with a left click.

The reporter (@Asianfleet) traced the cause: `transcript-content.ts` hardcodes `setExpanded(true)` on every tool, summary, and skill component, `TranscriptPane.handleMouse` services only the wheel, and `handleInput` has no `app.tools.expand` branch.

Planning found a second cause the report does not name.
A released agent's transcript comes from `fileSnapshotSource`, whose `getToolDefinition` returns `undefined`.
Without a definition, `ToolExecutionComponent` falls back to printing the call's JSON arguments and its full output whatever its expansion state, so collapsing alone would change nothing for those transcripts.

## Goals

- Tool calls, compaction and branch summaries, skill blocks, and bash executions mount in the main conversation's current expansion state (`ctx.ui.getToolsExpanded()`, read when the pane opens).
- `app.tools.expand` (`Ctrl+O` by default, remaps honored) toggles every block in the pane; the toggle is pane-local and never changes the main conversation.
- In fullscreen mode, a left click on a block toggles that block, through Pi's own per-component click handling.
- The footer names the toggle key when the terminal is wide enough, dropping it first as the width shrinks.
- A tool call whose source has no renderers for a built-in tool (every call in a released agent's transcript; a live child whose registry lacks the tool) draws with Pi's built-in renderers, mirroring Pi's own `withBuiltInRenderers`.
- **Not breaking.**
  Nothing here is config, a public output shape, or a documented default; precedent is the viewer changes of [#876] and [#1032].
  Commits use `fix(pi-subagents):` / `feat(pi-subagents):` without `!`.

## Non-Goals

- **Click-to-toggle in regular mode.**
  pi-tui enables mouse reporting only in `TuiAltScreen` (fullscreen), so the main conversation is not clickable in regular mode either; the pane's `Ctrl+O` covers it.
- **Extension tools in a released transcript.**
  Pi exposes no extension tool's renderers to another extension (`pi.getAllTools()` returns `ToolInfo`: name, description, parameters, guidelines), so a released agent's `colgrep`, `subagent`, or MCP calls keep Pi's generic full rendering, as Pi itself draws a tool it no longer has registered.
- **Clicks on the in-flight message or the activity row.**
  Only settled blocks are hit-tested; the streaming message's thinking toggle stays unreachable until it settles.
- **Per-block click state across a rebuild.**
  `agent_end`, `compaction_end`, and rewritten history remount every block at the pane's current state, as Pi's own session re-render does.
- **Writing the pane's toggle back to the main conversation** (`ui.setToolsExpanded`): it would also print Pi's "Tool output: …" status line into the parent chat behind the pane.
- **Raising the Pi floor.**
  Nothing this plan relies on is newer than 1.0.0 (see Background); the operator kept the floor at `>=1.0.0`.
- **Keyboard navigation between blocks** (a focused-block cursor): not requested, and Pi's main conversation has none.

## Background

- `src/ui/transcript-content.ts` — `TranscriptContent` maps settled `SessionMessage`s onto one `SettledBlock` (a `Container` plus its cached rows) per message, mirroring Pi's interactive-mode mapping, and serves rows by width.
  Expansion is set at three sites: `consumeAssistant` (tool), `consumeSummary` (compaction/branch), and the free function `addUserComponents` (skill).
  `BashExecutionComponent` is never touched and keeps Pi's default `expanded = false`.
- `src/ui/session-navigator.ts` — `TranscriptPane` owns scroll state, chrome, and keys; it records `renderedWidth` so input lays out like the last paint (the `scrollBounds` comment), and `handleMouse` returns `undefined` for every non-wheel event.
  `SessionNavigatorHandler.handle` probes the TUI mode, then mounts the pane through `ui.custom` (docked in regular mode, ADR 0007; overlay in fullscreen, ADR 0012).
- `src/ui/session-navigation.ts` — `liveSource.getToolDefinition` delegates to the child session's registry; `fileSnapshotSource.getToolDefinition` returns `undefined`.
- `src/index.ts` passes `ctx.ui` structurally as `SessionNavigatorUI`; `ExtensionUIContext` already declares `getToolsExpanded(): boolean` in Pi 1.0.0.

### Pi 1.0.0 facts the design rests on

Read from the installed `dist/` of `@earendil-works/pi-coding-agent@1.0.0` and `@earendil-works/pi-tui@1.0.0`:

- Interactive mode mounts every expandable at `this.toolOutputExpanded` (default `false`), and `setToolsExpanded` walks the chat container's direct children with a duck-typed `isExpandable` (`"setExpanded" in obj`).
- `ToolExecutionComponent`, `CompactionSummaryMessageComponent`, `BranchSummaryMessageComponent`, and `SkillInvocationMessageComponent` wrap their content in a `MouseRegion` whose handler toggles `setExpanded(!expanded)` on `type === "click" && button === "left"` (a tool only once it has a result).
  `Container.handleMouse` and `Box.handleMouse` route an event to the child under `event.y` using the layout recorded by their last `render` at the same width.
- In fullscreen, an unhandled `press` over an overlay falls through to text selection; on a release without drag the TUI synthesizes a `click` and dispatches it to the overlay again (`tui-alt-screen.js` `handleSelectionMouseEvent`), after opening a clicked URL if there was one.
  So the pane must return `undefined` for `press` to keep selection, URL clicks, and click synthesis working.
- `ui.custom` passes the interactive mode's own `KeybindingsManager`, which defines `app.tools.expand` (`ctrl+o`); Pi binds that action on the editor only, so it reaches the focused pane.
  The pane's `ui.custom` factory also explains reading `getToolsExpanded()` **after** the picker: Pi's extension selector toggles the global state on `Ctrl+O`.
- Pi interactive mode looks a tool's renderers up as `withBuiltInRenderers(name, session.getToolDefinition(name))`.
  `withBuiltInRenderers`, `createAllToolRenderers`, `createToolDefinition`, and `allToolNames` are internal: the root barrel exports none of them in 1.0.0 through 1.6.0 or on `main`, and the `exports` map is `.`, `./rpc-entry` (plus `./client`, `./experimental/plugin` in 1.0.0).
  The root barrel does export the eight per-tool factories `create{Read,Bash,Edit,Write,Grep,Find,Ls,PowerShell}ToolDefinition(cwd)`, each carrying `renderCall`/`renderResult`.
- `ToolExecutionComponent`'s constructor takes `toolDefinition: ToolRenderers | ToolDefinition<any, any, any> | undefined`; `ToolRenderers` is not exported until 1.0.1.

### Measured (disposable spike, 80 columns, initialized theme)

| Block                                       | Collapsed rows | Expanded rows |
| ------------------------------------------- | -------------- | ------------- |
| `read`, 50-line result, built-in definition | 4              | 55            |
| `bash`, 50-line result, built-in definition | 11             | 55            |
| `grep`, 50-line result, built-in definition | 21             | 55            |
| any tool, no definition                     | 58             | 58            |
| compaction summary, 20-line summary         | 5              | 26            |
| skill block, 20-line body                   | 3              | 25            |

- A collapsed `read` hides its result body entirely, even a one-line one; collapsed `grep` and `bash` still show a short body.
  That makes a `read` call the discriminating fixture for collapse tests.
- Every factory returned a definition whose `name` equals its tool name, with function-valued `renderCall` and `renderResult`; one call costs about 1 µs (measured over 1,000 calls each), so no memoization.
- A left `click` routed through a block `Container` to a built-in `bash`/`grep` result toggled it (rows 11 → 55, 21 → 55) and returned `handled`; a click on a box's padding row returned `undefined`.
- A local `Pick<ToolDefinition, "renderShell" | "renderCall" | "renderResult">` fails `tsc` against the factories (parameter contravariance; Pi's own `ToolRenderers` uses `ToolDefinition<any, any, any>`, and `no-explicit-any` is on for `src/`).
  `NonNullable<ConstructorParameters<typeof ToolExecutionComponent>[4]>` type-checks with no `any` in our code and no cast.

## Design Overview

### Built-in renderer fallback (new `src/ui/builtin-tool-renderers.ts`)

```typescript
/** What `ToolExecutionComponent` accepts to draw a tool's call and result. */
type ToolRenderers = NonNullable<ConstructorParameters<typeof ToolExecutionComponent>[4]>;

/** Pi's built-in tools, by the name a transcript's tool call carries. */
const BUILT_IN_TOOLS: ReadonlyMap<string, (cwd: string) => ToolRenderers> = new Map([
  ["read", createReadToolDefinition],
  // bash, edit, write, grep, find, ls, powershell
]);

/**
 * A tool's renderers, falling back to Pi's built-in ones the way Pi's own
 * interactive mode does: a missing definition takes the built-in, and a
 * definition without `renderCall`/`renderResult` borrows them.
 */
export function withBuiltInRenderers(
  toolName: string,
  definition: ToolRenderers | undefined,
  cwd: string,
): ToolRenderers | undefined;
```

- A `ReadonlyMap`, not a `Record`: `noUncheckedIndexedAccess` is off, so a `Record` lookup types as always present.
- `cwd` is the parent's (the one `ToolExecutionComponent` already receives); renderers read their working directory from the render context, and Pi's own renderers-only module takes none.
- The merge copies Pi's semantics exactly: `renderCall`/`renderResult` from the definition when present, else from the built-in; `renderShell` is not merged.
- The type alias stays unexported (one consumer, the module itself); `transcript-content.ts` passes `source.getToolDefinition(name)`, whose `ToolDefinition` already satisfies the union.
- Applies to both sources, because `TranscriptContent` does not know which source it holds:

```typescript
const tool = new ToolExecutionComponent(
  content.name, content.id, content.arguments, { showImages: false },
  withBuiltInRenderers(content.name, this.options.source.getToolDefinition(content.name), this.options.cwd),
  this.options.tui, this.options.cwd,
);
```

### Expansion state (in `TranscriptContent`)

- New `TranscriptContentOptions.toolsExpanded: boolean`, copied into `private expanded`.
- **Lifecycle of `expanded`:** set in the constructor from the option; flipped only by `toggleExpanded()`; read when blocks are appended (by `consumeSettled`) and when toggling; never reset — `reset()` clears blocks, not the state, so a rebuild remounts at the current state.
- One mechanism applies it.
  `consumeSettled` records `this.blocks.length` **after** its possible `reset()`, consumes the new messages, then walks the appended blocks' `container.children` and calls `setExpanded(this.expanded)` on each child that passes a local `isExpandable` guard (the shape of Pi's own).
  Every expandable is a direct child of its block's container (tool, summary, skill, bash), so a one-level walk suffices (verified by the Tidy-First assessor).
  The three hardcoded `setExpanded(true)` calls go away; `addUserComponents` loses its `skill.setExpanded(true)` and gains no parameter.
- `toggleExpanded()` flips `expanded`, walks every block the same way, and clears every `block.rows` and `settledRows`.
- **Bash executions** now follow the pane state too (today they stay at Pi's collapsed default even though every other block is expanded); with the default `false` state nothing changes for them.

### Click forwarding

`TranscriptContent.handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined`, where `event.y` is a **transcript** row and `event.width` the layout width:

1. Render (or reuse) settled rows at `event.width`, then walk `blocks` summing `rows.length` to find the block covering `event.y`; a row in the tail (in-flight message, activity row) or past the end returns `undefined`.
2. Dispatch `block.container.handleMouse({ ...event, y: event.y - blockStart, height: blockRows })`.
3. On a result, clear that block's rows and `settledRows` and return `{ handled: true }`; otherwise `undefined`.

`TranscriptPane`:

- `render` also records the painted viewport start (`renderedStart`, alongside `renderedWidth`); both are set on every paint and read only by input handling, and neither is cleared during the pane's life.
- `handleMouse`: wheel scrolls as today.
  Any other event on a content row (`1 <= event.y <= viewportHeight`; row 0 is the header rule) before which a paint has happened is forwarded as `content.handleMouse({ ...event, y: renderedStart + event.y - 1, width: renderedWidth })`.
  Header, footer, and pre-paint events return `undefined`.
- Returning `undefined` for `press` (Pi's components handle only `click`) preserves fullscreen text selection, URL activation, and the TUI's click synthesis.

### Keys and footer

- `handleInput`: after the close keys, `this.keys.matches(data, "app.tools.expand")` calls `this.content.toggleExpanded()`; the host renders after input, as for the scroll keys.
  If the pane was following the bottom it keeps following; otherwise the scroll offset stays and `render` clamps it.
- `footerHint` gains a `Ctrl+O expand` segment (first key of `app.tools.expand` via `displayKey`, omitted when unbound) before `Esc close`.
  The footer passes the right label as fallbacks — with the segment, then without — so `labeledRule` drops the segment before it drops the hints.
  At the test fixture's left label (`3 lines · 100%`), the full footer needs 89 columns (computed: 3 + 14 + 2 + 1 + 66 + 3) against today's 73, so 80 columns keeps today's footer exactly.

### Seeding from the main conversation

`SessionNavigatorUI` gains `getToolsExpanded(): boolean`.
`handle` reads it after the picker resolves and the source loads, and passes `toolsExpanded` through `TranscriptPaneOptions` into `TranscriptContent`.
The pane holds no `ui` reference, so it cannot write the state back.

### Edge cases (each pinned in the named step)

- A source without a definition for a built-in tool draws Pi's renderer (Steps 1–2); an unknown tool keeps the generic rendering (Step 1).
- A definition missing `renderCall`/`renderResult` borrows the built-in ones (Step 1).
- A block that settles after mount, and every block after a rebuild, mounts at the current state (Steps 3 and 5).
- Bash output follows the state (Step 3).
- A remapped `app.tools.expand` toggles on the new key only (Step 5); an unbound one shows no footer segment (Step 6).
- A `press`, a header-row click, and a click on a block with no click handler (user message) are left to the host (Step 8).
- A click re-renders only the clicked block (Step 8).

## Module-Level Changes

- `packages/pi-subagents/src/ui/builtin-tool-renderers.ts` (new): `withBuiltInRenderers`, the `BUILT_IN_TOOLS` map, the local `ToolRenderers` alias (Steps 1–2).
- `packages/pi-subagents/src/ui/transcript-content.ts`:
  - `consumeAssistant` resolves renderers through `withBuiltInRenderers` (Step 1).
  - `TranscriptContentOptions.toolsExpanded`, `expanded`, the block walk in `consumeSettled`, `isExpandable`; removes the three `setExpanded(true)` calls (Step 3).
  - `toggleExpanded()` (Step 5); `handleMouse()` (Step 8).
  - The module doc comment gains a sentence on expansion and click forwarding (Step 8).
- `packages/pi-subagents/src/ui/session-navigator.ts`:
  - `SessionNavigatorUI.getToolsExpanded`, `TranscriptPaneOptions.toolsExpanded`, `handle` wiring (Step 3).
  - `handleInput` toggle branch (Step 5); `footerHint` segment and fallback (Step 6).
  - `renderedStart`, `handleMouse` forwarding, its doc comment (Step 8).
- `packages/pi-subagents/test/ui/builtin-tool-renderers.test.ts` (new): Steps 1–2.
- `packages/pi-subagents/test/ui/transcript-content.test.ts`: `makeContent` gains an optional `toolsExpanded` (default `false`); the two `read` tests asserting a result body pass `true` (Step 3); new tests in Steps 1, 3, 5, 8.
- `packages/pi-subagents/test/ui/session-navigator.test.ts`: `makePane` gains `toolsExpanded`, `makeUI` gains `getToolsExpanded` (Step 3); `keysWith` gains the `app.tools.expand` definition (Step 4); the `mouse()` helper takes overrides and the wheel tests nest under `describe("mouse")` (Step 7); new tests in Steps 3, 5, 6, 8; the "leaves other mouse events to the host" test is renamed to what it now claims (Step 8).
- `packages/pi-subagents/docs/architecture/architecture.md`: module tree gains `builtin-tool-renderers.ts`; `transcript-content.ts`'s entry names its expansion state (Steps 1 and 3).
- `.pi/skills/package-pi-subagents/SKILL.md`:
  - UI domain row: `11` → `12` modules, naming built-in tool renderers (Step 1).
  - Upstream assumptions: three rows (Step 9) — Pi's built-in tool set matches `BUILT_IN_TOOLS` (`packages/coding-agent/src/core/tools/index.ts`, `allToolNames`; Coverage-gap); per-entry components toggle on a left click through `MouseRegion` and containers route mouse events by their last render (`packages/coding-agent/src/modes/interactive/components/*.ts`, `packages/tui/src/tui.ts`, `packages/tui/src/components/box.ts`; Behavioral-silent); `app.tools.expand` is the toggle action's id and is bound on the editor only (`packages/coding-agent/src/core/keybindings.ts`, `interactive-mode.ts`; Behavioral-silent).
- `packages/pi-subagents/README.md` `### /subagents:sessions`: blocks open in the main conversation's state, `Ctrl+O`, fullscreen click, built-in rendering of released transcripts, the footer sentence about dropping hints (Step 9).
- Predicted unchanged:
  - `src/index.ts` — it passes `ctx.ui`, whose `ExtensionUIContext` already has `getToolsExpanded` in 1.0.0.
  - `src/ui/session-navigation.ts` — the fallback lives in `TranscriptContent`, so `fileSnapshotSource` keeps returning `undefined`.
  - The architecture doc's Mermaid "UI domain" subgraph — it names `session-navigator` only; no node models expansion or mouse routing.
  - ADRs 0007 and 0012 — mount options are untouched.
  - `test/helpers/transcript-fixtures.ts` — `fakeSource` already returns `undefined` definitions, which the fallback now resolves.

## Test Impact Analysis

- **New tests the change enables:** table-driven verification of every built-in row against the real SDK; collapse/expand per block kind; toggle and remap; footer width fallback; click hit-testing at both the content and pane levels; per-block render accounting for clicks.
- **Existing tests that change:**
  - `transcript-content.test.ts` › `renders a tool call and its result through Pi's tool-execution component` and › `re-renders only the affected block when a tool result lands` assert a `read` body; a collapsed `read` hides it (measured), so Step 3 constructs them with `toolsExpanded: true` — their subject is the body landing, not expansion.
  - `session-navigator.test.ts` › `leaves other mouse events to the host` clicks `y: 5`, which becomes a forwarded content row over a user message; it stays green (no `MouseRegion` there) and is renamed in Step 8.
  - The footer tests at 80 and 40 columns stay as-is and pin the fallback (Step 6).
- **Must stay as-is:** the `render accounting` suite (the #689 incremental-settle invariants), the ADR 0007/0012 mount tests, and the handler's #423 reactive-consumer assertion (`record.getToolDefinition` not called by the handler).

## Invariants at risk

| Invariant                                                                  | Constituency                          | Pinned by                                                                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| A paint or scroll re-renders nothing (#689)                                | Long live transcripts                 | `render accounting › renders the component tree once across repeated paints and scrolls`; the walk runs at consume time, not paint time |
| A tool result re-renders only its block (#689)                             | Live transcripts                      | `incremental settling › re-renders only the affected block when a tool result lands` (kept, with `toolsExpanded: true`)                 |
| A click re-renders only its block                                          | Long transcripts                      | New in Step 8                                                                                                                           |
| Regular mode mounts docked (ADR 0007), fullscreen as an overlay (ADR 0012) | Scrollback / fullscreen paging        | `mounts the transcript outside Pi's overlay compositor`, `mount mode` suite                                                             |
| The handler never reads tool definitions off the record (#423)             | Reactive-consumer spine               | `opens a read-only pane sourced from the picked record`                                                                                 |
| Fullscreen text selection and URL clicks over the pane keep working        | Operators copying from the transcript | Step 8's `press` test plus the renamed host test                                                                                        |

## TDD Order

1. **`feat(pi-subagents): draw read calls in a released subagent's transcript with Pi's own renderer`.**
   Add `src/ui/builtin-tool-renderers.ts` with the merge mechanism and the `read` row only, and route `consumeAssistant` through it.
   Tests (`builtin-tool-renderers.test.ts`, new `describe` per concern):
   - No definition, `read` → a result with `name: "read"` (`toHaveProperty`).
   - No definition, `colgrep` → `undefined`.
   - A definition with both renderers → returned as the same object (`toBe`).
   - A definition with only `renderResult` → keeps that `renderResult` (`toBe`) and its other fields, gains a function `renderCall`.
   Test (`transcript-content.test.ts`, `describe("built-in tool renderers")`): a `read` call from a source with no definitions renders without the generic JSON (`not.toContain('"path"')`).
   Killing mutations:
   - Pass `this.options.source.getToolDefinition(content.name)` directly in `consumeAssistant` → the transcript test goes red.
   - Make `withBuiltInRenderers` return `definition` unconditionally → the no-definition test goes red.
   - Return `definition` whenever it is present (no merge) → the merge test goes red.
   - Return the built-in whenever one exists → the identity test goes red.
   Docs: architecture module tree line; SKILL.md UI row count and description.
   Before committing, re-read the new module against the `code-design` skill (a mirror of Pi's code inherits its shape).
2. **`feat(pi-subagents): draw every built-in tool call in a released subagent's transcript with Pi's own renderers`.**
   Write the row check first: `it.each` over `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `powershell` asserting `withBuiltInRenderers(name, undefined, cwd)` has `name` equal to the key; it is red for seven rows.
   Then add the seven rows.
   Killing mutation: swap the `grep` and `find` factories → exactly those two rows go red.
3. **`fix(pi-subagents): open a subagent's transcript in the main conversation's tool-output state`.**
   `toolsExpanded` option, `expanded`, the walk over appended blocks in `consumeSettled` (start index read after `reset()`), `isExpandable`; remove the three `setExpanded(true)` calls; `SessionNavigatorUI.getToolsExpanded`, `TranscriptPaneOptions.toolsExpanded`, and the `handle` wiring; test doubles (`makeContent`, `makePane`, `makeUI`); the two `read` tests pass `toolsExpanded: true`.
   Tests (`transcript-content.test.ts`, `describe("expansion")`, nested `collapsed` / `expanded`):
   - Collapsed: a `read` body is hidden; a compaction summary's text is hidden; a skill body is hidden.
   - Expanded: each of those is shown; a 30-line bash output shows its last line.
   - Expanded: a `read` that settles in a later batch shows its body.
   - Expanded: after `agent_end` rebuilds over the same history, the `read` body is still shown.
   Tests (`session-navigator.test.ts`, handler suite): `getToolsExpanded() → true` shows a picked agent's `read` body; `→ false` hides it.
   Killing mutations:
   - `setExpanded(true)` in the walk → the collapsed tests go red.
   - Walk only `ToolExecutionComponent` instances → the summary, skill, and bash expanded tests go red.
   - Record the start index before `reset()` → the rebuild test goes red.
   - Pass `toolsExpanded: false` literally in `handle` → the handler's expanded test goes red.
   Docs: the architecture tree's `transcript-content.ts` entry names its expansion state.
   Trailer: `Co-authored-by: Asianfleet <88229228+Asianfleet@users.noreply.github.com>` in the final paragraph, below `Refs #1088`.
4. **`test(pi-subagents): give the viewer's test keybindings Pi's tool-output toggle`.**
   `keysWith` builds from `{ ...TUI_KEYBINDINGS, "app.tools.expand": { defaultKeys: "ctrl+o", description: "Toggle tool output" } }` (Pi's `KEYBINDINGS` is not exported).
   Every existing test stays green; no killing mutation (fixture only).
5. **`feat(pi-subagents): toggle every block in the session viewer with Ctrl+O`.**
   `TranscriptContent.toggleExpanded()`; the `handleInput` branch.
   Tests (content, `describe("toggling")`): a collapsed `read` body shows after one toggle and hides after two; a `read` that settles after a toggle mounts expanded.
   Tests (pane, `describe("tool output toggle")`): `\x0f` (Ctrl+O) shows a `read` body; with `app.tools.expand` remapped to `ctrl+t`, `\x0f` changes nothing and `\x14` toggles.
   Killing mutations:
   - Skip clearing `block.rows` in `toggleExpanded` → the content toggle test goes red (stale cache).
   - Flip each component's own state instead of `expanded` → the settles-after-toggle test goes red.
   - Match `matchesKey(data, "ctrl+o")` instead of the binding → the remap test goes red.
   Trailer: as in Step 3.
6. **`feat(pi-subagents): name the tool-output toggle key in the session viewer's footer`.**
   `footerHint` segment and the two-entry right-label fallback.
   Tests (`footer rule`): at 100 columns the footer ends `… Home/End · Ctrl+O expand · Esc close ──`; with `app.tools.expand` unbound, at 100 columns it ends `… Home/End · Esc close ──`; the existing 80- and 40-column tests are unchanged.
   Killing mutations:
   - Pass only the full hint (no fallback) → the 80-column test goes red (the hints drop entirely).
   - Drop the unbound check → the unbound test goes red.
7. **`test(pi-subagents): let the viewer's mouse fixture take overrides`.**
   `mouse()` takes a partial `TuiMouseEvent`; `describe("mouse wheel")` nests under `describe("mouse")`.
   Tests stay green; no killing mutation.
8. **`feat(pi-subagents): click a block in the fullscreen session viewer to expand or collapse it`.**
   `TranscriptContent.handleMouse`, `renderedStart`, the pane's forwarding, doc comments.
   Tests (content, `describe("clicks")`):
   - A left click on a collapsed `read` call's row (located by its rendered text) shows its body.
   - A click on a user-message row and a click on the activity row both return `undefined`.
   - A click re-renders fewer `Container.render` calls than a full rebuild (the render-accounting spy pattern, measured before any spy).
   Tests (pane, under `describe("mouse")`):
   - A left click on the row whose text names the `read` call returns `{ handled: true }`, and the next paint shows its body.
   - A click on row 0 (header) and a `press` on the tool row both return `undefined`.
   - The existing `y: 5` test is renamed `leaves a click no block handles to the host`.
   Killing mutations:
   - Drop the `- 1` header offset → the pane click lands on the box's padding row and goes red.
   - Skip clearing the clicked block's rows → both click tests go red (stale paint).
   - Return `{ handled: true }` for every forwarded event → the `press` test goes red.
   - Clear every block's rows on a click → the render-accounting test goes red.
   Trailer: as in Step 3.
9. **`docs(pi-subagents): describe collapsible blocks in the session viewer`.**
   README `### /subagents:sessions`; SKILL.md upstream-assumption rows.
   Verify: in a fresh Pi session, open a live and a released agent in regular mode (collapsed, `Ctrl+O`, footer) and in fullscreen (click), and with the main conversation's tool output expanded before opening.
   Record whether Pi's inline "(N more lines, … to expand)" names the key (see Risks).

## Risks and Mitigations

- **Pi's inline expand hint may print without its key.**
  The components the pane constructs come from this extension's import of `pi-coding-agent`; if that resolves to a different module copy than the host's (the case Pi's 1.5.0 fix #11630 describes for renderers), its `keyHint("app.tools.expand", …)` reads unset keybindings and renders " to expand".
  A version bump does not help: the pane constructs `ToolExecutionComponent` itself, so it always uses its own copy's `keyHint`.
  Mitigation: the footer names the key from the host's own `KeybindingsManager`; Step 9 checks the inline hint for real and records it.
- **A future built-in tool is missing from `BUILT_IN_TOOLS`.**
  It degrades to Pi's generic rendering, not an error; the SKILL.md watchlist row names `allToolNames` for `/upstream-impact`.
- **Container mouse routing reads the layout of the last render.**
  The block's cached rows and its container's layout come from the same `render` call; every path that clears `block.rows` forces both to refresh together.
  Step 8's tests click after a toggle and after a result lands, exercising that pairing.
- **`main` rewrote `Container`'s mouse layout (`renderChildLines`, unreleased).**
  The design calls only `container.handleMouse`, the public `Component` API, which keeps its contract on `main`.

## Open Questions

- **Upstream export (operator to file, in their own voice per Pi's CONTRIBUTING).**
  Pi's `packages/coding-agent/src/core/tools/renderers/index.ts` documents `createAllToolRenderers` / `withBuiltInRenderers` as the import for "a process that only renders", and interactive mode wraps every lookup with `withBuiltInRenderers`; neither is exported from the root barrel or the `exports` map (checked 1.0.0, 1.6.0, `main`).
  Exporting them would let `builtin-tool-renderers.ts` shrink to a re-export and track Pi's tool set automatically.
- **Clicks on the in-flight message.**
  Revisit if operators want to toggle a streaming thinking block.

[#876]: https://github.com/gotgenes/pi-packages/issues/876
[#1032]: https://github.com/gotgenes/pi-packages/issues/1032
