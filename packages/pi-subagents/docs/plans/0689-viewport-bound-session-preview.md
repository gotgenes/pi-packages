---
issue: 689
issue_title: "pi-subagents: /subagents:sessions becomes unresponsive on large live transcripts"
---

# Make the `/subagents:sessions` preview viewport-bound

## Release Recommendation

**Release:** ship independently

This issue is not a step in the architecture roadmap — no roadmap entry references it, so no `Release:` batch tag applies.
It is a user-visible responsiveness fix (`fix:` and `perf:` commits, both unhidden changelog types), so it cuts a release on its own at ship time.

## Problem Statement

Opening `/subagents:sessions` on a large live subagent transcript makes the overlay progressively unresponsive: arrow keys appear frozen, and rich assistant output streams far more slowly inside the overlay than in the parent Pi TUI.
Pressing Esc restores normal responsiveness immediately, which localizes the cost to the overlay rather than to Pi.

Three independent O(total transcript) costs stack inside `TranscriptOverlay`:

1. `buildContentLines()` runs the whole component tree and re-truncates every transcript row, and it is called from **both** `handleInput()` and `render()` — so one keypress costs two complete rerenders of the entire history.
2. `liveSource.subscribe` discards the `AgentSessionEvent` and the overlay treats every notification identically, so each streaming text/thinking delta rebuilds every rich component in the transcript.
3. `handleInput()` lays out at full terminal width (`tui.terminal.columns - 4`) while the overlay actually renders at 90%, so scroll bounds are computed against a layout that is never displayed.

Defect 3 is a separate user-visible bug in its own right, independent of transcript size: from the bottom of the viewport, ↑ never scrolls at all.
It was diagnosed independently in [#670].

### Measured baseline

Deterministic scratch fixture, 200 messages (interleaved user/assistant markdown, ~2.2k content rows), overlay inner width 144, `Container.render()` call-counted by prototype spy.
All figures below are **measured**, not estimated.

| Hot path (per interaction)           | `main` today | after step 3 | after steps 4–5 |
| ------------------------------------ | ------------ | ------------ | --------------- |
| Scroll (keypress + paint)            | 90.5 ms      | 0.45 ms      | 0.46 ms         |
| Settle (`message_end` + paint)       | 44.7 ms      | 45.0 ms      | 0.81 ms         |
| Streaming delta + paint              | 44.0 ms      | 2.8 ms       | 0.42 ms         |
| Repaint at unchanged width           | 34.4 ms      | 0.60 ms      | 0.58 ms         |
| `Container.render()` calls per paint | 301          | 0 after warm | 0 after warm    |

The cost is linear in transcript size — settle costs 44.8 ms at 200 messages, 85.7 ms at 400, and 170.2 ms at 800.
The reported session (10,876 rendered rows) is roughly 5× the fixture, which projects to ~450 ms per arrow key and ~225 ms per settle.
That is the reported "frozen" symptom.

## Goals

- Make paint and scroll O(viewport), not O(total transcript).
- Make a streaming delta cost one component update, not a full transcript rebuild.
- Make a settled message cost one appended block, not a full transcript rebuild.
- Fix the input/render width mismatch so ↑ scrolls from the bottom at any transcript size.
- Keep the rendered output byte-identical to what the current overlay produces for the same message history.

This change is **not** breaking: no public export, config default, or output shape changes.
The overlay's visible content is pinned line-for-line against a freshly-built equivalent.

## Non-Goals

- No new overlay capability.
  Steering from the preview is [#695] and stays out of scope; this plan only makes the substrate it would build on cheaper.
- No change to `fileSnapshotSource` semantics — a static snapshot has no events and keeps its single-build path.
- No rendering of `custom`-role messages.
  That boundary is unchanged: it needs the child session's message-renderer registry, which the navigator does not hold.
- No change to `listNavigableAgents`, the picker, or the label format.
- No change to `src/ui/display.ts`, `src/ui/glyphs.ts`, `src/ui/agent-widget.ts`, or `src/ui/widget-renderer.ts`.
- No adoption of PR [#690] as a merge target — see Background.

## Background

### Attribution and direction

Issue #689 and PR [#690] are both from `@daoguademeng`; PR [#670] is from `@aqua2k1`.
Neither is the merge target.
Following the precedent set for [#661], [#662], and [#674], the direction is adopted and reimplemented through this package's own TDD cycle, and both PRs are closed with credit.
PR [#690]'s author explicitly invites this ("take the direction and reimplement if that fits your process better").

The diagnosis in both PRs was independently verified here by measurement before planning (see Measured baseline), and PR [#690]'s two commits were applied to a scratch tree and benchmarked against the same fixture to produce the after-columns.

### Current modules

`src/ui/session-navigation.ts` (146 lines) holds the pure core: `listNavigableAgents`, the `TranscriptSource` seam, `liveSource`, `fileSnapshotSource`.
`src/ui/session-navigator.ts` (403 lines) holds the SDK/TUI half: the `SessionNavigatorHandler` command, the `TranscriptOverlay` component, and the free functions `buildTranscriptComponents` / `addMessageComponents` / `addUserComponents` / `userMessageText` that map `SessionMessage` onto Pi's per-entry components.

`TranscriptOverlay` currently owns scroll state, chrome, the streaming indicator, the cached `Container`, and the content-line construction — five concerns in one class.

### Verified Pi runtime ordering

Traced against the sibling checkout `../pi` at HEAD `98145a6c0`.
Every claim the incremental design rests on is confirmed in Pi's source:

| Claim                                                                                                                                              | Citation                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A finalized message is pushed into `state.messages` **before** listeners run                                                                       | `packages/agent/src/agent.ts:556` (push) precedes `:588` (`await listener(event)`)                                                                                           |
| The in-flight streaming message is **never** in `state.messages` — it lives in `state.streamingMessage`                                            | `packages/agent/src/agent.ts:552`                                                                                                                                            |
| Extensions may replace a settled message in place, but that happens **before** session listeners are notified                                      | `packages/coding-agent/src/core/agent-session.ts:634` (`_emitExtensionEvent`) precedes `:637` (`_emit`), replacement applied at `:779` via `_replaceMessageInPlace` (`:710`) |
| `message_end` fires once per message for **every** role — user prompts, assistant messages, and each tool result                                   | `packages/agent/src/agent-loop.ts:113`, `:357`/`:370`, `:795`                                                                                                                |
| Compaction and branching replace the message array wholesale (the `messages` setter slices)                                                        | `packages/agent/src/agent.ts:88`                                                                                                                                             |
| Pi's own interactive TUI already settles incrementally — append on `message_start`, `updateContent` on `message_update`, finalize on `message_end` | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3120`–`3192`                                                                                                |
| pi-tui's `Markdown` already caches its rendered lines per width; `Container.render` does not cache                                                 | `packages/tui/src/components/markdown.ts:248`, `:279`; `packages/tui/src/tui.ts:234`                                                                                         |

Two consequences shape the design.

First, the incremental model is **Pi's own model**, not an invention: we mirror what `interactive-mode.ts` does with the same components.
Second, PR [#690]'s `isLiveMessage` / timestamp-matching guard — which excludes a trailing in-flight assistant message from `getMessages()` — defends against a state that cannot occur, because a partial is never in `state.messages`.
Our version drops it.

The last row explains where the 45 ms rebuild actually goes: `Markdown` leaves are already cached per width, so a rebuild is expensive mostly because it *discards* pi-tui's own caches by constructing fresh components.
Incremental settling is, at bottom, "stop throwing pi-tui's cache away."

### Constraints from AGENTS.md

- Tests that mount Pi's per-entry interactive components must call `initTheme(undefined, false)` in `beforeAll` — the existing suite already does.
- `pnpm fallow dead-code` gates in CI; a new module must be reachable from `src/index.ts` and carry no unused exports.
- Adding a module changes the architecture doc's module tree and the `package-pi-subagents` skill's UI-domain module count.

## Design Overview

### Separation of concerns

`TranscriptOverlay` keeps what an overlay owns: scroll offset, auto-scroll, chrome, key handling, and the lifecycle of its subscription.
Everything about *what rows exist and what they say* moves to a new collaborator, `src/ui/transcript-content.ts`.

```typescript
/** Dependencies the per-entry component tree needs from the SDK/TUI environment. */
export interface TranscriptContentOptions {
  tui: TUI;
  cwd: string;
  markdownTheme: MarkdownTheme;
  source: TranscriptSource;
}

/**
 * The overlay's renderable rows: settled history as per-message component
 * blocks with width-cached lines, plus the live tail.
 */
export class TranscriptContent {
  constructor(options: TranscriptContentOptions);
  /** Total rows at `width`, settled plus live tail. */
  lineCount(width: number): number;
  /** Rows `[start, start + count)`; slices caches, never re-renders history. */
  slice(width: number, start: number, count: number): string[];
  /** Route one session event to the narrowest possible update. */
  apply(event: AgentSessionEvent | undefined): void;
  /** Drop every cached line (theme change, forced repaint). */
  invalidate(): void;
}
```

The overlay's call sites read as Tell-Don't-Ask — it asks for a count and a slice, never for the blocks:

```typescript
render(width: number): string[] {
  const innerW = width - 4;
  this.renderedInnerWidth = innerW;
  const totalLines = this.content.lineCount(innerW);
  const maxScroll = Math.max(0, totalLines - this.viewportHeight());
  if (this.autoScroll) this.scrollOffset = maxScroll;
  const visibleStart = Math.min(this.scrollOffset, maxScroll);
  const visible = this.content.slice(innerW, visibleStart, this.viewportHeight());
  // …chrome…
}
```

`TranscriptContent` talks only to `TranscriptSource` and pi-tui components — the same upstream dependencies the free functions use today, with no new reach-through.
`TUI`, `cwd`, and `markdownTheme` are relayed to the per-entry components exactly as `TranscriptRenderOptions` relays them now, so the extraction carries no new coupling; `TranscriptRenderOptions` is subsumed by `TranscriptContentOptions`.

### Settled/live split

Settled history is an array of blocks, one per consumed message:

```typescript
/** One consumed message's rich components plus its width-cached rendered lines. */
interface SettledBlock {
  readonly container: Container;
  lines: readonly string[] | undefined;
}
```

`settledCount` tracks how many source messages have been consumed; it is decoupled from `settledBlocks.length` so a skipped `custom`-role message advances the count without producing a block.
A flat concatenation of all block lines is cached per width; a tool result invalidates only its own block's lines plus the flat cache.

The live tail is separate: an `AssistantMessageComponent` for the in-flight message, updated per delta via `updateContent`, plus the existing one-line streaming-activity row.
Because a partial is never in `state.messages`, settled and live provably cannot overlap.

### Event routing

| Event                                                       | Action                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `message_start`, `message_update` with an assistant message | Update the live component only                                              |
| `message_start`, `message_update` with any other role       | Consume newly settled messages                                              |
| `message_end`                                               | Clear the live component if it matches, then consume newly settled messages |
| `agent_end`, `compaction_end`                               | Full rebuild — a run or compaction boundary may have rewritten history      |
| any other event, or no event                                | Consume newly settled messages (a no-op when nothing is new)                |

Consuming appends blocks for `messages[settledCount…]`.
Before appending, an identity guard checks that `messages[settledCount - 1]` is still the object last consumed.
A mismatch — or a shorter array — means history was replaced wholesale, so the content resets and rebuilds.
That check is O(1) and catches compaction, branching, and any source that fabricates a fresh array per call.

### Width handling

`render()` records the inner width the compositor actually supplied; `handleInput()` uses that recorded width, so both compute the same wrapped-line count and the same `maxScroll`.
The overlay's width percentage becomes a named constant used both in `overlayOptions` and in a pre-first-render fallback estimate, so the `"90%"` literal is not spelled twice:

```typescript
const OVERLAY_WIDTH_PCT = 90;
// overlayOptions: { anchor: "center", width: `${OVERLAY_WIDTH_PCT}%`, … }
private inputWidth(): number {
  return this.renderedInnerWidth ?? Math.max(0, Math.floor((this.tui.terminal.columns * OVERLAY_WIDTH_PCT) / 100) - 4);
}
```

Recording the supplied width is preferred over recomputing 90% of the terminal on every keypress: it is the compositor's own number, so it cannot drift from the compositor's rounding.
The derived estimate is only a fallback for the (unreachable in practice) case of input before the first paint.

### Edge cases

- **Leading-spacer decision.**
  Today `addUserComponents` decides whether to prepend a `Spacer` by checking `container.children.length > 0` — a whole-transcript property.
  With per-message blocks each container is fresh, so the decision moves to a `hasVisibleContent` flag owned by `TranscriptContent` and threaded in as a parameter.
  This is the one place where identical output depends on hoisted state; the equivalence test pins it.
- **In-place message replacement.**
  An extension returning a replacement from `message_end` mutates the settled object, but Pi applies that *before* notifying session listeners, so the overlay always consumes final content.
- **Empty width.**
  `slice`/`lineCount` return empty/zero for a non-positive width, matching today's `buildContentLines` guard.
- **Width change.**
  A width change clears every block's line cache and the flat cache; blocks and components survive, so pi-tui's `Markdown` caches re-warm at the new width once.
- **Disposal.**
  Unchanged: `dispose()` unsubscribes and sets `closed`, and a late event after `closed` is ignored.

## Module-Level Changes

| File                                                       | Change                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pi-subagents/src/ui/transcript-content.ts`       | **New.** `TranscriptContent` class, `TranscriptContentOptions`, and the `SessionMessage` → component mapping moved out of `session-navigator.ts` (`addMessageComponents`, `addUserComponents`, `userMessageText`, and the `SettledBlock` shape)                                                                                                                                                             |
| `packages/pi-subagents/src/ui/session-navigator.ts`        | `TranscriptOverlay` delegates content to `TranscriptContent`; `buildContentLines`, `rebuild`, `innerWidth`, `buildTranscriptComponents`, `addMessageComponents`, `addUserComponents`, `userMessageText`, and `TranscriptRenderOptions` are removed from this file; `renderedInnerWidth` recorded in `render()` and read in `handleInput()`; `OVERLAY_WIDTH_PCT` constant added and used in `overlayOptions` |
| `packages/pi-subagents/src/ui/session-navigation.ts`       | `TranscriptSource.subscribe` forwards the `AgentSessionEvent` (`subscribe(onChange: (event?: AgentSessionEvent) => void)`); `liveSource` passes the record's event through instead of dropping it                                                                                                                                                                                                           |
| `packages/pi-subagents/test/ui/transcript-content.test.ts` | **New.** Unit tests for the collaborator: settle/slice/lineCount, width invalidation, identity-guard fallback, event routing, and line-for-line equivalence with a freshly-built instance                                                                                                                                                                                                                   |
| `packages/pi-subagents/test/ui/session-navigator.test.ts`  | Overlay tests updated for the event-carrying subscription and the recorded-width input path; the component-mapping assertions that now belong to the collaborator move to the new file                                                                                                                                                                                                                      |
| `packages/pi-subagents/test/ui/session-navigation.test.ts` | `liveSource` subscription test asserts the event is forwarded, not merely that the callback fired                                                                                                                                                                                                                                                                                                           |
| `packages/pi-subagents/docs/architecture/architecture.md`  | Module tree gains `ui/transcript-content.ts` (with the Pi-ordering constraint cited, since it is an active invariant); the `Total LOC` health-metric row's file count goes 58 → 59                                                                                                                                                                                                                          |
| `.pi/skills/package-pi-subagents/SKILL.md`                 | UI domain row: module count 7 → 8, responsibility list gains transcript content/caching                                                                                                                                                                                                                                                                                                                     |

### Symbol-removal sweep

Grepped `src/`, `test/`, `packages/pi-subagents/docs/`, and `.pi/skills/` for every symbol leaving `session-navigator.ts`.
`buildTranscriptComponents`, `addMessageComponents`, `addUserComponents`, `userMessageText`, and `TranscriptRenderOptions` are all module-private (not exported) and referenced only within `session-navigator.ts` and its test.
`buildContentLines` appears in `docs/plans/0134-*.md` and `docs/plans/0170-*.md`, but those describe the **removed** `conversation-viewer.ts`, not this overlay — historical plans, correctly left untouched.
`README.md` documents `/subagents:sessions` behaviorally (lines 21, 233, 241) and names no module or symbol; behavior is unchanged, so no README edit is needed.
No `docs/decisions/` or `docs/guides/` file references the overlay internals.

## Test Impact Analysis

**Newly enabled tests.**
Extracting `TranscriptContent` makes the content model unit-testable without mounting an overlay or supplying chrome/scroll state.
That enables direct tests that are impractical today: incremental-settle render accounting, the identity-guard reset, per-block tool-result invalidation, and — the important one — a **line-for-line equivalence** assertion between a content object driven incrementally through a sequence of events and a fresh one built from the final message array.
That equivalence test is the safety net for the whole incremental design; it cannot be written against the overlay without also asserting chrome.

**Redundant tests.**
`session-navigator.test.ts`'s component-mapping cases ("renders a tool call through Pi's tool-execution component", the tool-result pairing assertions, and the user/skill-block spacing cases) become lower-level tests of the collaborator.
They move to `transcript-content.test.ts` rather than being duplicated.

**Tests that must stay.**
The overlay's own behavior is unaffected by the extraction and stays where it is: Escape/`q` closing and `done`, `dispose()` unsubscribing, no render request after dispose, the streaming-activity indicator row, scroll and auto-scroll semantics, the footer line count and percentage, and all five `SessionNavigatorHandler` cases (empty list, cancelled picker, live source, snapshot source, unreadable file).
The `render(width < 6)` guard test stays as an overlay concern.

**Performance pins.**
Two assertions guard against regressing back to O(total): `vi.spyOn(Container.prototype, "render")` call counts held constant across repeated paints and scrolls, and a `getMessages` call count of zero across paints and scrolls.
These are deliberately white-box and isolated in one `describe`; they are the only assertions that can catch a silent return to per-frame rebuilding.

## Invariants at Risk

This surface is not a prior roadmap phase's outcome — `session-navigator.ts` was landed by [#445] (native session navigation) and [#463] (file-snapshot source), neither of which is a numbered improvement-phase step with `Outcome:` bullets.
The invariants those issues established, and the test that pins each after this change:

| Invariant                                                               | Origin | Pinned by                                                                                                                                                            |
| ----------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The overlay is strictly read-only — no steering, no session takeover    | [#445] | No input path is added; `handleInput` still only scrolls and closes (table-driven bindings, same key set)                                                            |
| A released agent's disk snapshot swaps in without touching the renderer | [#463] | The `SessionNavigatorHandler` snapshot-source test stays as-is; `fileSnapshotSource` returns `subscribe: () => undefined`, so it takes the build-once path unchanged |
| `custom`-role messages are skipped                                      | [#445] | Explicit test in `transcript-content.test.ts`: a `custom` message advances `settledCount` without emitting rows                                                      |
| Rendered output mirrors Pi's `renderSessionContext` mapping             | [#445] | The equivalence test, plus the moved component-mapping tests                                                                                                         |

The quantitative invariant at risk is rendered-output identity, and it is pinned by measurement rather than argument: the equivalence test compares the incremental result to a freshly-built result line for line, and the baseline/after numbers in Measured baseline were both taken on the same fixture.

## TDD Order

1. **Align input width with the rendered overlay width** — `test/ui/session-navigator.test.ts`.
   Red: on a terminal wide enough that 100% and 90% wrap differently, pressing ↑ from the bottom leaves `scrollOffset` at the bottom after the next paint.
   Green: add `OVERLAY_WIDTH_PCT`, use it in `overlayOptions`, record `renderedInnerWidth` in `render()`, and read it (with the percentage-derived fallback) in `handleInput()`.
   Commit: `fix(pi-subagents): scroll the session preview at the width it renders at`.
   Body credits `@aqua2k1` and carries `Refs #670`.

2. **Extract the content model** — `test/ui/transcript-content.test.ts` (new).
   Red: the new test file imports `TranscriptContent` and asserts it renders a user message, a tool call paired to its result, and a skill block — the mapping cases lifted from the overlay test.
   Green: create `src/ui/transcript-content.ts` holding the moved mapping functions and a `TranscriptContent` whose `apply()` rebuilds wholesale (behavior identical to today); `TranscriptOverlay` delegates to it; the moved assertions are deleted from `session-navigator.test.ts`.
   No behavior change and no caching yet.
   Commit: `refactor(pi-subagents): extract transcript content from the session overlay`.

3. **Make paint and scroll viewport-bound** — `test/ui/transcript-content.test.ts`, `test/ui/session-navigator.test.ts`.
   Red: a `Container.prototype.render` spy shows the call count growing across repeated paints and scrolls; `slice()` at an unchanged width re-renders.
   Green: cache the flat settled line array per width inside `TranscriptContent`, add `lineCount`/`slice` that read the cache, and have the overlay slice instead of building and slicing a full array.
   Commit: `perf(pi-subagents): make session-preview paint and scroll viewport-bound`.

4. **Stop rebuilding history per streaming delta** — `test/ui/session-navigation.test.ts`, `test/ui/transcript-content.test.ts`.
   Red: `liveSource` drops the event; a `message_update` costs a full rebuild and live thinking text is not shown until the message settles.
   Green: widen `TranscriptSource.subscribe` to forward the `AgentSessionEvent`, pass the record's event through in `liveSource`, and give `TranscriptContent` a live `AssistantMessageComponent` updated per delta.
   `TranscriptSource` is not a public export, so this is an internal signature widening — `session-navigation.test.ts`'s subscription test updates in the same commit.
   Commit: `perf(pi-subagents): update only the live message on session-preview deltas`.

5. **Settle messages incrementally** — `test/ui/transcript-content.test.ts`.
   Red: a `message_end` for one new message re-renders every message's components; a tool result re-renders blocks other than its own.
   Green: hold settled history as per-message blocks with per-block line caches, consume only `messages[settledCount…]`, pair tool results to their block, and add the identity guard that falls back to a full rebuild when history is rewritten.
   Include the equivalence test (incremental vs. freshly built, line for line), the `agent_end`/`compaction_end` full-rebuild cases, and the `custom`-role skip.
   Commit: `perf(pi-subagents): settle session-preview messages incrementally`.

6. **Documentation** — `packages/pi-subagents/docs/architecture/architecture.md`, `.pi/skills/package-pi-subagents/SKILL.md`.
   Add `ui/transcript-content.ts` to the module tree with its Pi-ordering constraint cited, bump the file count in the health-metrics `Total LOC` row, and update the skill's UI-domain row.
   Commit: `docs(pi-subagents): document the transcript-content module`.

Steps 1 and 2 are independently revertable, which is why the width fix leads rather than riding inside the performance work.
Steps 3–5 each leave the suite green and the overlay correct; each is a strict narrowing of what a given event costs.

## Risks and Mitigations

| Risk                                                                                            | Mitigation                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The incremental design depends on Pi pushing into `state.messages` before notifying listeners   | Verified in source (`agent.ts:556` before `:588`) and load-bearing for Pi's own interactive mode. A violated assumption degrades to a full rebuild via the identity guard and the `agent_end` catch-all — stale rows are repaired at the run boundary, never corrupted permanently |
| A cached block diverges from its message after an in-place mutation                             | Pi applies extension replacements before notifying session listeners (`agent-session.ts:634` before `:637`), so the overlay reads final content. `agent_end` rebuilds wholesale as a backstop                                                                                      |
| Output drifts from today's rendering (spacing, ordering)                                        | The line-for-line equivalence test between incremental and freshly-built content, plus the moved mapping tests. The one hoisted decision (leading spacer) is called out and pinned explicitly                                                                                      |
| The performance work silently regresses later                                                   | The `Container.prototype.render` and `getMessages` call-count pins fail loudly if any path returns to per-frame rebuilding                                                                                                                                                         |
| `TranscriptOverlay` and `TranscriptContent` drift into a two-headed owner of scroll/width state | The overlay owns scroll and the recorded width; `TranscriptContent` takes width as a parameter and holds no scroll state. Its whole API is `lineCount` / `slice` / `apply` / `invalidate`                                                                                          |
| A third-party PR is superseded without acknowledgement                                          | Both PRs are closed with a comment crediting the diagnosis and pointing at the landed commits; step 1's commit body credits [#670] and the perf commits credit [#690]                                                                                                              |

## Open Questions

- Whether the live-tail streaming-activity row (`describeActivity`) should move under `TranscriptContent` or stay an overlay concern.
  The plan keeps it in `TranscriptContent` because it is a content row that participates in `lineCount`/`slice` arithmetic; revisit only if [#695] needs the overlay to own it.
- Whether pi-tui should grow a width-keyed cache on `Container` so every consumer benefits rather than each overlay rolling its own.
  Not filed — it is an upstream question, and this plan's cache is small and local.
  Worth raising upstream only if a second consumer in this repo needs the same thing.

[#445]: https://github.com/gotgenes/pi-packages/issues/445
[#463]: https://github.com/gotgenes/pi-packages/issues/463
[#661]: https://github.com/gotgenes/pi-packages/issues/661
[#662]: https://github.com/gotgenes/pi-packages/issues/662
[#670]: https://github.com/gotgenes/pi-packages/issues/670
[#674]: https://github.com/gotgenes/pi-packages/issues/674
[#690]: https://github.com/gotgenes/pi-packages/issues/690
[#695]: https://github.com/gotgenes/pi-packages/issues/695
