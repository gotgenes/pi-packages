---
status: accepted
date: 2026-09-03
---

# 0007 — The transcript viewer is a docked pane, not an overlay

## Status

Accepted.
Closes Pi's overlay mount to this package until the upstream compositor changes.

## Context

`/subagents:sessions` mounted its transcript viewer with `ui.custom(..., { overlay: true })`.
Operators reported fragments of the viewer's box — the `╭─` top rule, the `Subagent session` header, empty box rows — interwoven through the terminal's scrollback, repeating every few screens and surviving the viewer being closed ([#733]).

### The mechanism

In pi-tui 0.84.4's `TuiMainScreen.doRender`, overlays are composited into the rendered lines **before** the differential compare (`packages/tui/src/tui-main-screen.ts:267`), and that composited array is then stored as `previousLines` — at every assignment site, not only the clearing one (`:315` full render, `:441` deleted-lines path, `:612` the ordinary differential path).
The renderer's model of the transcript at those rows *is* the overlay.

Differential rendering can only repair rows still on screen.
Anything the terminal has scrolled past is already committed to scrollback with the overlay's pixels in it.

`TuiAltScreen` composites into a bounded `screen` buffer with no scrollback behind it (`tui-alt-screen.ts:1321`), so this is a regular-mode defect only.

### The precondition, measured

The obvious account — that every row under the overlay eventually scrolls off carrying chrome — is **wrong**, and the first two attempts at a reproduction correctly found nothing.
While output is appended a line at a time, the overlay band moves up through rows that are still on screen, and the differential renderer repairs each one before it scrolls away.

The failure needs a single append large enough to carry a row from under the overlay past the top of the screen in one frame.
That row is committed with the chrome still in it and can never be reached again.

Measured on a 24-row terminal with a 10-line centered overlay, by the script below:

| Lines appended per frame | Rows committed carrying chrome |
| ------------------------ | ------------------------------ |
| 1, 3, 6, 7               | 0                              |
| 8                        | 57                             |
| 9                        | 114                            |
| 10                       | 171 of 576                     |
| 25                       | 590                            |

The threshold of 8 is the distance from the overlay's top edge to the top of the screen — a 10-line box centered in 24 rows sits at row `floor((24 - 10) / 2) = 7` — so it is geometry, not chance.
An identical control run without the overlay commits none.

This is why the symptom is intermittent, and why [#733] reports it as worst during tool calls: tool output arrives in chunks.
The shipped viewer's box was 70% of the terminal height, putting its threshold around 7 lines, which nearly any tool call clears.

### Upstream

The maintainer rejected an adjacent diagnosis in [earendil-works/pi#4785] — a report that the diff scan's start index forces a full redraw on off-screen spinner ticks — with "you are wrong. your clanker is wrong. as explained on twitter.com."
No technical reason is recorded in the tracker and the cited explanation is off-platform.
That report concerns the widget render loop ([#864]), not this mechanism, so nothing upstream has ruled on the claim here.

It is recorded because it is the reason not to plan around upstream fixing this.
By contrast [earendil-works/pi#2759], which arrived with a reproduction command against the repo's own example extension, was reproduced by the maintainer and fixed within the hour — which is why the script below exists.

## Decision

Mount the transcript viewer through `ui.custom`'s **non-overlay** path, and do not use `overlay: true` in this package.

Pi's `showExtensionCustom` then clears the input-editor container, adds the component, and focuses it.
The pane renders at full terminal width with the conversation streaming above it, and `ui.custom` restores the editor and any typed text on close.
No compositing happens, so nothing can be baked into scrollback.

The rejected alternative was forcing a full repaint on close (`requestRender(true)`).
It erases the fragments already in scrollback but leaves the viewer shredding while open, and wipes the terminal's scrollback history as a side effect.

Fixing `compositeOverlays` upstream is the more general answer and is not ours to make.
The non-overlay path is entirely within our control and removes the failure mode rather than papering over it.

## Consequences

- The viewer is a pane docked above the editor, not a floating window.
  Its chrome is a header and a footer line: docked, it is already bracketed by the agents widget above and Pi's footer below, so a frame costs rows for nothing.
- It renders at full terminal width, so there is no overlay width to keep in sync and no compositor `maxHeight` slice.
- Its height is sized to its content, capped at a share of the terminal, because a docked pane that reserves a fixed 70% pushes the conversation off screen to show blank space.
- The path is well exercised rather than novel: it is what Pi runs for the editor on every turn, and what `pi-permission-system`'s permission prompt already uses with an explicit `{ overlay: false }`.
- This is consistent with [ADR 0004](0004-reconsider-ui-direction.md), which replaced the bespoke `ConversationViewer` overlay with native session navigation and framed the interaction as navigation rather than a live overlay.
- The repo's other `overlay: true` call site, `pi-permission-system`'s settings modal, has the same defect at much lower exposure and is tracked separately as [#874].
  Its fix is a different question, because it asks for a fixed 82-column width the non-overlay path does not offer.

## Reproduction

A dated claim about `@earendil-works/pi-tui` **0.84.4**, using only its public API (`TuiMainScreen`, `showOverlay`, `renderNow`, `captureRenderState`).
It needs no Pi monorepo checkout and no extension.
Nothing in CI runs it; it is preserved as evidence, not as a test, and it will stop being meaningful when the upstream compositor changes.

Run with `node repro.mjs <lines-appended-per-frame>`; the table above used 1 through 25.

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

  // What the terminal keeps for each row index, captured at the last frame in
  // which that row was still on screen (and therefore still repairable).
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

At a burst of 10 it reports a row the `Chat` component rendered as `"chat line 013"` committed to history as `"chat╭─────…"` — the overlay having overwritten from column 4, its left margin.
That is the signature operators see in scrollback.

## An upstream report, if one is filed

Nobody has filed this upstream, and this repository does not depend on anyone doing so.
The text below is kept ready rather than pending.

```markdown
Title: Regular-mode overlays composite into the scrollback buffer, baking chrome into history

In `TuiMainScreen.doRender`, overlays are composited into `newLines` before the
differential compare, and that composited array becomes `previousLines`
(`tui-main-screen.ts:267`, assigned at `:315`, `:441`, and `:612`). The renderer's
model of the transcript at those rows is the overlay.

While output is appended a line at a time the band is repaired as it moves, so
nothing is lost. The failure needs a single append large enough to carry a row from
under the overlay past the top of the screen: that row is committed to scrollback
with the chrome in it, and differential rendering can no longer reach it.

Measured on 0.84.4, 24-row terminal, 10-line centered overlay: zero contamination
for appends of 7 lines or fewer; 57 rows at 8; 171 of 576 at 10. The threshold of 8
is the distance from the overlay's top edge to the top of the screen. An identical
control run without the overlay commits none.

Repro script, public API only, no monorepo checkout needed: <attached>
```

[#733]: https://github.com/gotgenes/pi-packages/issues/733
[#864]: https://github.com/gotgenes/pi-packages/issues/864
[#874]: https://github.com/gotgenes/pi-packages/issues/874
[earendil-works/pi#2759]: https://github.com/earendil-works/pi/issues/2759
[earendil-works/pi#4785]: https://github.com/earendil-works/pi/issues/4785
