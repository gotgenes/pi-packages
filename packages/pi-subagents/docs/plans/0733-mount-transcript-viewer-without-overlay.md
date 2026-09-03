---
issue: 733
issue_title: "fix(pi-subagents): /subagents:sessions overlay smears box chrome into scrollback"
---

# Mount the transcript viewer without an overlay

## Release Recommendation

**Release:** ship independently

Issue #733 is not a numbered step in any roadmap.
Phase 22's `#### Open-issue sweep dispositions` list records it as deferred — "TUI overlay defect requiring SDK-level rendering investigation, unrelated to this phase's cause" — so it carries no `Release:` batch tag and belongs to no batch.
That deferral's stated basis is now discharged: the investigation it was waiting on is done, and its conclusion is that no SDK change is required.

Note that the TDD Order below contains `feat:` steps (the chrome and height changes the operator chose), so this cuts a **minor**, not a patch.
Confirm with `./scripts/release/next-version.sh pi-subagents` at ship time rather than inferring it from this sentence.

## Problem Statement

`/subagents:sessions` mounts its transcript viewer as a floating overlay via `ui.custom(..., { overlay: true })`.
Pi's regular-mode renderer composites overlays **destructively into the line buffer that backs scrollback**, before the differential compare.
The composited array then becomes the renderer's model of the transcript, so any row that scrolls off the screen is committed to the terminal's history with the viewer's box chrome painted over it.
Closing the viewer does not remove the fragments, because the terminal has already committed them.

## Goals

- Remove the failure mode rather than mitigate it: mount the viewer through the non-overlay path, so no compositing occurs and nothing can be baked into scrollback.
- Adapt the viewer to being a docked pane rather than a floating box: full width, minimal chrome, height sized to its content.
- Record the upstream `compositeOverlays` defect thoroughly enough that a future reader knows why the overlay path is closed to this package, and precisely enough that the operator can file a brief, accurate upstream report by hand.

Not a breaking change.
`/subagents:sessions` keeps its name, its arguments, its read-only contract, and its keybindings.
The package's published surface (`src/service/service.ts`, `src/layered-settings.ts`) is untouched, and every symbol renamed here is internal.

## Non-Goals

- **Fixing `compositeOverlays` upstream.**
  The mechanism is documented in ADR 0007 and a reproduction script is preserved there, but this plan files nothing.
  The operator files upstream by hand, in their own voice.
  This is recorded as an explicit non-goal with no commitment: our fix does not depend on upstream acting.
- **Issue #864 (the widget render loop).**
  Verified during planning to be a distinct mechanism — the widget mounts through `ui.setWidget` into an ordinary `Container` and never enters the overlay stack, so `hasOverlayEntries` is false throughout its reproduction.
  Neither fix addresses the other.
  The finding was posted to [#864] rather than acted on here.
- **Issue [#874] (the `pi-permission-system` config modal).**
  The repo's only other `overlay: true` call site, filed during this planning session and dispositioned out of scope for that package's Phase 14.
  Its exposure is far lower and its fix is a different design question, because it asks for a fixed 82-column width that the non-overlay path does not offer.
- **Issue [#695] (steering from the preview).**
  Deferred by operator decision and untouched here.
  Worth noting only that the editor-slot mount makes it easier, not harder.
- **`transcript-content.ts`.**
  Read-only for this change; its `lineCount` / `slice` API already has the shape the new height rule needs.

## Background

`src/ui/session-navigator.ts` (257 lines) holds the SDK/TUI half of `/subagents:sessions`: `SessionNavigatorHandler` (the picker and source selection) and `TranscriptOverlay` (a scrollable read-only `Component`).
The unit-testable core — which agents are navigable, and how a picked agent's transcript is sourced — lives in `session-navigation.ts` and is untouched.
`TranscriptContent` (`transcript-content.ts`) owns the transcript's components and answers `lineCount(width)` / `slice(width, start, count)`; [#689] made both viewport-bounded.

Three constants govern layout today:

| Constant            | Value | Role                                                                                           |
| ------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| `CHROME_LINES`      | 6     | Top border, header, header separator, footer separator, footer, bottom border                  |
| `MIN_VIEWPORT`      | 3     | Floor on the scrollable region                                                                 |
| `OVERLAY_WIDTH_PCT` | 90    | Overlay width, used both in `overlayOptions` and in `inputWidth()`'s pre-first-render fallback |

### The upstream mechanism, as measured

In `TuiMainScreen.doRender` (pi-tui 0.84.4), overlays are composited into `newLines` before the differential compare, and that composited array becomes `previousLines` — at all three assignment sites (`:314` full render, `:440` deleted-lines path, `:611` the ordinary differential path).
`TuiAltScreen` composites into a bounded `screen` buffer with no scrollback behind it, so this is a regular-mode defect only.

Planning measured the precondition rather than asserting it, and the first two attempts at a reproduction **failed**, which corrected the issue body's account:

- While output is appended a line at a time, the renderer **does** repair the overlay band as it moves, and nothing is lost.
- The failure needs a single append large enough to carry a row from under the overlay past the top of the screen in one frame.
  Then the row is committed to scrollback with the chrome in it, and differential rendering can no longer reach it.

Measured on a 24-row terminal with a 10-line centered overlay (script in ADR 0007):

| Lines appended per frame | Rows committed with chrome |
| ------------------------ | -------------------------- |
| 1, 3, 6, 7               | 0                          |
| 8                        | 57                         |
| 9                        | 114                        |
| 10                       | 171 of 576                 |
| 25                       | 590                        |

The threshold is geometry rather than chance: the box sits at screen row `floor((24 - 10) / 2) = 7`, so a row beneath its top edge must travel 8 rows to leave the screen — one more than the distance to the top.
An identical control run without the overlay commits none.
On the real viewer, whose box is 70% of the terminal height, the threshold is about 7 lines — which nearly any tool call clears, and which is why the issue reports the symptom as worst during tool calls.

### Upstream posture

The maintainer rejected an adjacent diagnosis in [earendil-works/pi#4785] — a report that the diff scan's start index forces `fullRender(true)` on off-screen spinner ticks — with "you are wrong. your clanker is wrong. as explained on twitter.com."
No technical reason is recorded in the tracker; the cited explanation is off-platform and not retrievable.
That report concerns the [#864] family, not this mechanism, so nothing upstream has ruled on the claim here.
It is recorded because it is the reason a future reader should not plan around upstream fixing this.
By contrast [earendil-works/pi#2759], which arrived with a reproduction command against the repo's own example extension, was reproduced by the maintainer and fixed within 33 minutes — which is why ADR 0007 carries a runnable script rather than a source-reading argument.

### Constraints from AGENTS.md

- The `pi-autoformat` extension reflows edited regions; re-read before matching against text just written.
- `docs/decisions` is in this package's `files` allowlist (a bare recursive entry), so ADR 0007 ships in the npm tarball.
- Do not name an unreleased version anywhere in the ADR or plan.

## Design Overview

### Mount

The `ui.custom` call drops its options object in favour of an explicit `{ overlay: false }`, matching the in-repo precedent at `packages/pi-permission-system/src/authority/permission-prompt-component.ts:163`:

```typescript
await ui.custom<undefined>(
  (tui, theme, _keybindings, done) =>
    new TranscriptPane({ tui, theme, source, done, cwd, markdownTheme }),
  { overlay: false },
);
```

Pi's `showExtensionCustom` then takes its non-overlay branch: `disposeActiveSelector()`, clear `editorContainer`, add the component, `setFocus(component)`, `requestRender()`.
The pane renders at full terminal width in the input-editor slot, with the chat streaming above it and Pi's footer below.
On close, `ui.custom` restores the editor and the previously typed text.

This path is not speculative: it is what Pi exercises for the editor on every turn, and what the repo's highest-traffic custom UI (the permission prompt) already uses.
That component's own doc comment confirms a focused `ctx.ui.custom` component consumes every keystroke, so `Esc` and the scroll keys reach the pane unchanged.

### Chrome

`render()` currently emits a full box.
It becomes a header line, the viewport, and a footer line — `CHROME_LINES` drops from 6 to 2.
Removing the `│` side borders also returns 4 columns to the viewport, since `innerW` was `width - 4`.

The pane is already bounded above by the agents widget and below by Pi's footer, so the box was doing less work docked than it did floating.
This is consistent with ADR 0004, which chose native session navigation over "a bespoke, width-capped `ConversationViewer` overlay" and framed the interaction as navigation rather than a live overlay.

### Height

`viewportHeight()` today is a fixed share of the terminal and takes no arguments.
It becomes content-sized with a cap, and therefore width-dependent:

```typescript
private viewportHeight(width: number): number {
  const cap = Math.floor((this.tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100) - CHROME_LINES;
  return Math.max(MIN_VIEWPORT, Math.min(this.content.lineCount(width), cap));
}
```

A three-message snapshot takes the rows it needs and gives the rest back to the chat; a long or live transcript gets the full 70% cap.
There is no feedback loop, because `lineCount` does not depend on the viewport height.

This costs nothing new: `render()` already calls `this.content.lineCount(innerW)` every frame to compute `totalLines`, so [#689]'s viewport-bounded preview is not regressed by adding a second reader of the same value.
Both callers must pass the width they lay out at, which is what the preparatory `scrollBounds(width)` extraction exists to guarantee.

### Naming

`TranscriptOverlay` describes a shape the component no longer has.
It becomes `TranscriptPane`, with `TranscriptOverlayOptions` → `TranscriptPaneOptions` and `OverlayComponentFactory` → `CustomComponentFactory` (it describes Pi's `ui.custom` factory shape in general, not an overlay).
All three are internal: `index.ts` imports only `SessionNavigatorHandler`, and the package's published entries are `src/service/service.ts` and `src/layered-settings.ts`.
The renames are therefore free — no consumer, no semver consequence.

Doc-comment prose across the file describes a "floating overlay", a "read-only scrollable overlay", and a compositor that slices `maxHeight`.
That prose is rewritten in the rename step, not left to contradict the new shape.

## Module-Level Changes

| File                                                                               | Change                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pi-subagents/src/ui/session-navigator.ts`                                | Add `scrollBounds(width)`; drop `OVERLAY_WIDTH_PCT`; `ui.custom` takes `{ overlay: false }`; `CHROME_LINES` 6 → 2 and `render()` paints header/viewport/footer with no box; `viewportHeight(width)` becomes content-sized with a cap; `inputWidth()` fallback becomes full terminal width; rename `TranscriptOverlay` / `TranscriptOverlayOptions` / `OverlayComponentFactory`; reword overlay prose |
| `packages/pi-subagents/test/ui/session-navigator.test.ts`                          | Rename the scroll-bounds width fixture off the 90% framing; update symbol names; add mount-option, chrome, and height assertions                                                                                                                                                                                                                                                                     |
| `packages/pi-subagents/docs/decisions/0007-transcript-viewer-is-not-an-overlay.md` | **New.** The decision, the measured mechanism, upstream posture, the reproduction script verbatim, and the brief text for the operator to file                                                                                                                                                                                                                                                       |

Greps run at planning time, with results:

- `TranscriptOverlay` / `OverlayComponentFactory` across `src/` and `test/`: 9 hits, all inside `session-navigator.ts` and its test.
  `index.ts` imports only `SessionNavigatorHandler`, which is not renamed.
- `.pi/skills/` tree: one hit, `package-pi-subagents/SKILL.md:150`, which names `session-navigator.ts` only in connection with the `initTheme` test requirement.
  Still accurate; no edit.
- `packages/pi-subagents/README.md`: describes the feature as "pi's native read-only viewer" and "pi's native per-entry viewer", neither of which asserts a floating box.
  Still accurate; no edit.
- `packages/pi-subagents/docs/architecture/architecture.md`: the module-tree entry at line 405 reads `session-navigator.ts  /subagents:sessions command handler` and says nothing about mounting.
  No edit.
  Per the operator's decision the constraint is recorded in ADR 0007 only, not as a module-tree issue citation.
- `packages/pi-subagents/docs/decisions/0004-reconsider-ui-direction.md`: uses "overlay" about the **removed** `ConversationViewer`, which this change does not resurrect.
  Historical and still accurate; no edit.

## Test Impact Analysis

**Newly enabled.**
Mounting is now assertable directly — `ui.custom`'s second argument is a value the test can read, where `{ overlay: true }` was previously accepted without comment.
Content-sized height makes two new cases meaningful: a short transcript producing a short pane, and a long one clamping at the cap.
Chrome becomes countable (total rendered lines minus viewport height).

**Becomes redundant.**
`describe("scroll bounds")`'s premise — a 200-column terminal rendering the overlay at 90% to 180 columns — disappears with the overlay.
What it actually pins survives and still matters: scroll math must use the width `render()` was called with, not one derived from `tui.terminal.columns`.
The preparatory `test:` step renames `OVERLAY_WIDTH` to `LAYOUT_WIDTH` and rewrites the comment to state the invariant in host-agnostic terms, so the assertions carry over untouched.

**Must stay as-is.**
The subscribe / dispose / no-render-after-dispose / streaming-indicator / refresh-on-source-change tests, and the whole `SessionNavigatorHandler` block, exercise behavior this change does not touch.
`test/ui/session-navigation.test.ts` and `test/ui/transcript-content.test.ts` are untouched.

## Invariants at risk

- **The layout-width invariant ([#689]).**
  `handleInput` must compute scroll bounds at the width `render()` actually laid out at.
  Pinned by `describe("scroll bounds")`, which is preserved rather than deleted, and strengthened by `scrollBounds(width)` making one method the sole place that turns a width into a viewport height.
- **Viewport-bounded preview ([#689]).**
  The performance win was in not paying O(total transcript) per frame.
  Content-sizing reads `content.lineCount(width)`, which `render()` already calls every frame for `totalLines` — verified by reading the current `render()` body — so the new height rule adds no traversal.
- **Dual sourcing ([#463]).**
  A released agent's transcript is read from its persisted file.
  Pinned by the two `SessionNavigatorHandler` snapshot tests, which assert through the captured factory and are unaffected by how the component is mounted.

## TDD Order

1. **`refactor(pi-subagents): extract scrollBounds from the transcript viewer's render and input paths`** `totalLines` / `viewportHeight` / `maxScroll` are computed inline and separately in both `handleInput()` and `render()`.
   Extract `private scrollBounds(width: number): { totalLines: number; viewportHeight: number; maxScroll: number }` and delegate from both, with no formula change.
   This is where step 5's width-dependent height lands, and it is what stops the two copies drifting while step 3 rewrites the chrome around them.
   Prepares steps 3 and 5.
   Killing mutation: make `handleInput` compute its bounds from `this.tui.terminal.columns` instead of `this.inputWidth()` — the preserved scroll-bounds tests must go red.

2. **`test(pi-subagents): state the scroll-bounds fixture's invariant without the overlay width`** Rename `OVERLAY_WIDTH` to `LAYOUT_WIDTH` and rewrite the block comment to say the host may lay out at a width narrower than the terminal, dropping the 90% arithmetic.
   No assertion changes.
   Lands before step 3 so no passing test cites a percentage the source no longer contains.
   Killing mutation: none — this step adds no coverage, and is typed `test:` for that reason.

3. **`fix(pi-subagents): stop the session transcript viewer painting into scrollback`** Pass `{ overlay: false }`, delete `OVERLAY_WIDTH_PCT`, and make `inputWidth()`'s fallback the full terminal width.
   This is the defect fix and stands alone so it is separately attributable and revertable.
   Red: assert `ui.custom` is called with a second argument of `{ overlay: false }`, and that the pre-first-render `inputWidth()` fallback equals the full terminal width less the chrome's column cost.
   Killing mutation: restore `overlay: true` in the `ui.custom` call — the mount assertion must go red.

4. **`refactor(pi-subagents): rename TranscriptOverlay to TranscriptPane`** Rename the three symbols and rewrite the doc-comment prose that describes a floating overlay, a compositor `maxHeight` slice, and an "overlay's share of the terminal".
   No observable change, hence `refactor:`.
   After the rename, grep the words that described the old shape — `floating`, `overlay`, `compositor`, `share of the terminal` — since no gate flags surviving prose.
   Killing mutation: none — mechanical rename, pinned by the suite continuing to compile and pass.

5. **`feat(pi-subagents): shrink the transcript pane to a header and footer line`** `CHROME_LINES` 6 → 2; `render()` emits a header line, the viewport, and a footer line, with no borders and no separators; `innerW` becomes `width` rather than `width - 4`.
   Red: assert the rendered output contains no box-drawing glyph, and that total lines equal viewport height plus 2.
   Killing mutation: re-add the `hrTop` push — the chrome-count assertion must go red, and the no-box-glyph assertion must go red independently.

6. **`feat(pi-subagents): size the transcript pane to its content`** `viewportHeight(width)` returns `clamp(content.lineCount(width), MIN_VIEWPORT, cap)`, read through `scrollBounds`.
   Red: a three-line transcript renders a pane shorter than the cap; a transcript longer than the cap renders exactly at the cap; a transcript shorter than `MIN_VIEWPORT` still renders `MIN_VIEWPORT` rows.
   Killing mutation: make `viewportHeight` return the cap unconditionally — the short-transcript and floor assertions must go red while the long-transcript one stays green, which is what distinguishes the clamp's three branches.

7. **`docs(pi-subagents): record why the transcript viewer is not an overlay (ADR 0007)`** Status `accepted`, dated, with: the decision and its consequences; the mechanism with file and line citations against pi-tui 0.84.4; the measured burst threshold table; the upstream posture paragraph citing [earendil-works/pi#4785] factually; the reproduction script verbatim in a fenced block; and a clearly delimited brief block for the operator to file by hand.
   The ADR must state that the script is a dated claim about 0.84.4 that nothing in CI runs.

## Risks and Mitigations

| Risk                                                                                                                  | Mitigation                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The pane inherits [#864]'s blanking, since it now lives in the same diff-rendered region as the editor and the widget | That defect already affects the editor on every turn and is not created here. It is [#864]'s to fix, and this plan's Non-Goals say so rather than silently absorbing it                                                                      |
| Content-sizing makes a live pane grow as the child streams, shifting the chat above it                                | Bounded: growth stops at the 70% cap, and a live transcript reaches the cap almost immediately. The visible case is a short completed snapshot, which does not stream at all                                                                 |
| Removing the box makes the pane's boundary ambiguous                                                                  | The header and footer lines remain, and the pane is bracketed by the agents widget above and Pi's footer below. If it reads poorly in practice, `CHROME_LINES` is one constant away from a middle option (keep the box, drop the separators) |
| The upstream report is filed and rejected like [earendil-works/pi#4785]                                               | The brief text was rewritten after measurement to drop an overstated claim the first draft made. It leads with a reproduction runnable against the published package. Regardless, our fix does not depend on the outcome                     |
| The reproduction script rots against a later pi-tui                                                                   | It is recorded as a dated claim about 0.84.4, not a maintained test, and is deliberately kept out of the CI suite                                                                                                                            |

## Open Questions

None blocking.
Two items are deliberately parked:

- Whether `VIEWPORT_HEIGHT_PCT` should stay at 70 once the pane is content-sized in practice.
  The cap only binds for long transcripts, so its effect is much smaller than it was for a fixed-height box; revisit from use rather than in advance.
- Whether the upstream report is filed at all, and when.
  That is the operator's call, and nothing here waits on it.

## Appendix: reproduction script

Preserved here so step 7 can copy it verbatim into ADR 0007.
Run against pi-tui 0.84.4 with `node repro.mjs <burst>`; the reported threshold above used bursts of 1 through 25.

```javascript
import { TuiMainScreen } from "@earendil-works/pi-tui";

const COLUMNS = 80;
const ROWS = 24;
const FRAMES = 60;
const BURST = Number(process.argv[2] ?? 1);

function fakeTerminal() {
  return {
    start() {}, stop() {}, async drainInput() {}, write() {},
    get columns() { return COLUMNS; },
    get rows() { return ROWS; },
    get kittyProtocolActive() { return false; },
    moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {},
    clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {},
  };
}

/** The transcript: plain text only. Never emits a box-drawing glyph. */
class Chat {
  constructor() { this.lineCount = 0; }
  render() {
    return Array.from(
      { length: this.lineCount },
      (_, i) => `chat line ${String(i).padStart(3, "0")}`,
    );
  }
}

/** A bordered overlay, exactly the shape a transcript viewer paints. */
class BoxOverlay {
  render(width) {
    const inner = width - 2;
    const lines = [`╭${"─".repeat(inner)}╮`];
    for (let i = 0; i < 8; i++) lines.push(`│${" ".repeat(inner)}│`);
    lines.push(`╰${"─".repeat(inner)}╯`);
    return lines;
  }
}

const BOX_GLYPHS = /[╭╮╰╯│─]/;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

function run({ withOverlay }) {
  const tui = new TuiMainScreen(fakeTerminal(), false, "/tmp/pi733");
  const chat = new Chat();
  tui.addChild(chat);

  if (withOverlay) {
    tui.showOverlay(new BoxOverlay(), {
      anchor: "center",
      width: "90%",
      maxHeight: "70%",
    });
  }

  // What the terminal keeps for each row index, captured at the last frame
  // in which that row was still on screen (and therefore still repairable).
  const committed = new Map();

  for (let i = 0; i < FRAMES; i++) {
    chat.lineCount = (i + 1) * BURST;
    tui.renderNow();
    const { previousLines, previousViewportTop } = tui.captureRenderState();
    for (let row = previousViewportTop; row < previousLines.length; row++) {
      committed.set(row, previousLines[row]);
    }
  }

  const finalTop = tui.captureRenderState().previousViewportTop;
  return { committed, finalTop, fullRedraws: tui.fullRedraws };
}

function report(label, { committed, finalTop, fullRedraws }) {
  const scrolledOff = [...committed.entries()].filter(([row]) => row < finalTop);
  const contaminated = scrolledOff.filter(([, line]) => BOX_GLYPHS.test(line));

  console.log(`\n--- ${label}`);
  console.log(`  full redraws:               ${fullRedraws}`);
  console.log(`  rows scrolled into history: ${scrolledOff.length}`);
  console.log(`  ...committed WITH chrome:   ${contaminated.length}`);
  for (const [row, line] of contaminated.slice(0, 3)) {
    console.log(`    row ${String(row).padStart(2)}: ${JSON.stringify(stripAnsi(line).slice(0, 56))}`);
    console.log(`            the Chat component rendered: ${JSON.stringify(`chat line ${String(row).padStart(3, "0")}`)}`);
  }
  return contaminated.length;
}

const withOverlay = report("WITH overlay", run({ withOverlay: true }));
const control = report("WITHOUT overlay (control)", run({ withOverlay: false }));

console.log("\n=== Result");
console.log(
  withOverlay > 0 && control === 0
    ? `REPRODUCED: ${withOverlay} rows entered scrollback carrying overlay chrome.`
    : `NOT REPRODUCED (with=${withOverlay}, control=${control}).`,
);
```

[#463]: https://github.com/gotgenes/pi-packages/issues/463
[#689]: https://github.com/gotgenes/pi-packages/issues/689
[#695]: https://github.com/gotgenes/pi-packages/issues/695
[#864]: https://github.com/gotgenes/pi-packages/issues/864
[#874]: https://github.com/gotgenes/pi-packages/issues/874
[earendil-works/pi#2759]: https://github.com/earendil-works/pi/issues/2759
[earendil-works/pi#4785]: https://github.com/earendil-works/pi/issues/4785
