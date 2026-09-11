---
issue: 636
issue_title: "Add compact, Ctrl+O-expandable rendering for `get_subagent_result`"
---

# Bound the `get_subagent_result` result view at one terminal row per line

## Release Recommendation

**Release:** ship independently

Issue [#636] is not a roadmap step.
It appears in Phase 22's `#### Open-issue sweep dispositions` only as a deferred item ("feature/UX requests that do not gate a structural phase"), so it belongs to no release batch and carries no `Release:` tag of its own.
The change is user-visible in the TUI, so its `feat:` commit cuts a release on its own.

## Problem Statement

`get_subagent_result` supplies neither of Pi's tool-rendering hooks, so its result is drawn by Pi's fallback renderers.
Issue [#636] reports that the fallback "displays its complete text output inline", filling the terminal and pushing the surrounding conversation out of view.

That premise was true when the issue was filed and is **no longer the whole story**.
Pi capped the collapsed fallback in `0.84.2` (`e14afc648`, "collapse fallback tool output"), so the collapsed view is now ten lines plus a `... (N more lines, ctrl+o to expand)` hint.
The package's declared peer floor is `>=0.81.0`, and the cap is absent in `0.81.0` through `0.84.1`, so the originally reported unbounded collapsed dump is still reachable for a supported operator.

Three defects survive on **every** supported version.

**The expanded view is unbounded.**
`app.tools.expand` (Ctrl+O) is a *global* toggle — `setToolsExpanded` walks every expandable child in the chat container — so expanding to read any one tool result expands every `get_subagent_result` in the transcript to its full length.
Measured on a real stored report (182 result lines, 9 054 characters, longest line 526 characters): 227–258 terminal rows at widths 80–120, before `verbose: true` adds the whole child conversation on top.
The sibling `subagent` tool caps its expanded body at 50 lines in `renderCompleted`; `get_subagent_result` has no cap at all.

**The collapsed ten lines are an arbitrary window, not a summary.**
They are raw unthemed report text with no status glyph, and the window cuts mid-result-body.
Every other subagent surface is compact and themed: `subagent` renders `✓ sonnet · 44 tool uses · 95.9k token · 213.0s`, and the completion nudge has its own themed presentation.

**The call header names no agent.**
Pi's `createCallFallback` renders the bold tool name alone, so a transcript of several retrievals shows an undifferentiated stack of `get_subagent_result` headers.
`subagent`'s `renderCall` shows the agent's display name and description.

## Goals

- Give `get_subagent_result` a custom `renderCall` that names the agent being retrieved.
- Give it a custom `renderResult` whose collapsed view is three rows: status glyph with stats, description, and a one-line result preview.
- Bound the expanded view at **exactly one terminal row per displayed line**, capped at 50 lines, so a long line cannot wrap into an unbounded number of rows — 51 rows at every terminal width, measured.
- Keep the complete report text — including the verbose conversation — in the tool result's `content`, unchanged, for the parent model and the session store.
- Carry only compact metadata in `details`, never the full result or conversation.

This change is **not** breaking.
It alters no tool parameter, no result `content`, and no public export; it adds presentation the TUI previously supplied by fallback.

## Non-Goals

- **Raising the `@earendil-works/pi-coding-agent` peer floor to `>=0.84.2`.**
  Offered to the operator and declined.
  The renderer must therefore work on `0.81.0`–`0.84.1`, where the collapsed fallback is uncapped — which it does, because a custom `renderResult` replaces the fallback outright on every version.
- **Changing `formatAgentReport`'s output.**
  The report text is the model-facing contract and stays byte-identical; this change only adds a second, human-facing view of it.
- **Rendering the verbose conversation as its own expanded section.**
  The conversation is part of the report text and is bounded by the same 50-line cap as everything else; the transcript pointer is the affordance for reading it in full.
- **Adding a model name to the report or the stats line.**
  That is sibling issue [#755], open against the same two files, deliberately left alone here.
- **Giving `steer_subagent` custom rendering.**
  It shares the gap but not the size — its results are a few lines — and no issue asks for it.
- **Animating the running status.**
  `isPartial` is never `true` for this tool (it supplies no `onUpdate`), so there is no streaming state to animate.

## Background

### The surfaces involved

`src/tools/get-result-tool.ts` (120 lines) holds `GetResultTool`, whose `execute` runs the carrier-claim lifecycle (`claim()`, `waitUntilSettled()`, `markConsumed()`, `release()`) and whose private `buildReport` assembles an `AgentReport` for `formatAgentReport`.
Its `toToolDefinition()` returns a `defineTool({...})` with no rendering hooks.

`src/tools/agent-tool.ts` is the pattern to mirror: its `toToolDefinition()` carries a `renderCall` that builds one `Text`, and a `renderResult` that reads the result text from `result.content[0].text` and delegates formatting to the pure `src/tools/result-renderer.ts`.

`src/ui/transcript-content.ts` and `src/ui/session-navigator.ts` already implement width-aware `Component`s in this package, clipping each row with `truncateToWidth(row, width)`.

### Verified SDK facts

These were established against the checkout at `../../pi` and confirmed against the installed pinned version (`0.84.4`, `devDependencies`) and the declared peer floors.

| Fact                                                                        | Evidence                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderResult` receives `{ expanded, isPartial }` and a `ToolRenderContext` | `core/extensions/types.ts` `ToolRenderResultOptions`, `ToolDefinition.renderResult`                                                                                                            |
| `ToolRenderContext` carries **no** terminal width                           | `core/extensions/types.ts:421-446` — `args`, `toolCallId`, `invalidate`, `lastComponent`, `state`, `cwd`, `executionStarted`, `argsComplete`, `isPartial`, `expanded`, `showImages`, `isError` |
| Ctrl+O is global, not per-call                                              | `interactive-mode.ts` `setToolsExpanded` walks every expandable child; new components are seeded from `this.toolOutputExpanded`                                                                |
| `isPartial` is `true` only for streaming `onUpdate`                         | `tool_execution_update` passes `true`; every completion path uses the `isPartial = false` default                                                                                              |
| `details` is written verbatim into the session JSONL                        | `ToolResultMessage.details` → `MessageEntry` → `JSON.stringify` in `harness/session/jsonl/io.ts`                                                                                               |
| `details` is **never** sent to the model                                    | `anthropic-messages.ts` `convertToolResult` reads `content`, `toolCallId`, `isError`, `addedToolNames` only; `estimate.ts` counts `content` only                                               |
| `Text` word-wraps, it does not clip                                         | `components/text.ts` calls `wrapTextWithAnsi(text, contentWidth)`                                                                                                                              |
| `truncateToWidth` / `visibleWidth` are exported and east-asian-width aware  | `tui/src/index.ts`; present at the `>=0.75.0` pi-tui floor (`git show v0.75.0:packages/tui/src/index.ts`)                                                                                      |
| `TruncatedText` renders only the first line                                 | `components/truncated-text.ts` stops at the first `\n` — unusable for a multi-line body                                                                                                        |

Because `ToolRenderContext` carries no width, a fixed column budget would be a guess; the width only becomes known inside `Component.render(width)`, which is why the bound lives in a component rather than in the string builder.

### Constraints from AGENTS.md and the package skill

- Every semantic glyph comes from `src/ui/glyphs.ts` and is never spelled at a render site.
  This change adds no new glyph — it reuses `success`, `failure`, `stopped`, `subLine`, `toolCall`, `queued`, `streaming`, and `compactions`.
- The architecture module tree describes current behavior; a new module gets a plain descriptive entry with no issue ref, because none of these entries encodes an active constraint.
- `Co-authored-by:` credit is owed on adoption, not on merge.
  Both [#636]'s reporter and PR [#729]'s author contributed accepted design.

## Design Overview

### Why PR #729 is not taken as-is

PR [#729] (rosingrind) implements the same feature and is `MERGEABLE`.
Two of its decisions are not carried forward, and the reasons shape this design.

It assigns `details.result = record.result` — the complete result text.
Since `details` is `JSON.stringify`'d into the session JSONL and is never sent to the model, that roughly doubles the on-disk bytes of every retrieval while buying nothing, and it contradicts the issue author's own instruction to "avoid duplicating the complete result or conversation in the details object".
The result text is already reachable: `result.content[0].text`, exactly as `agent-tool.ts` reads it.

It describes its limits as "display-width-aware" but implements them with `String.length`, which counts UTF-16 code units.
Combined with `Text`'s word wrapping, a 200-unit cap still produces three rows at width 80, and a CJK line overruns further.

Its renderer also lives inline in `get-result-tool.ts` rather than in a pure sibling module, and it adds `textResultWithDetails<T>` as a clone of `textResult` rather than widening the original.

### The three pieces

```text
get-result-tool.ts          renderCall ─→ Text
   (wiring + details)       renderResult ─→ get-result-renderer ─→ string[] ─→ BoundedLines
```

**`BoundedLines`** (`src/ui/bounded-lines.ts`) is the row bound.
It receives pre-themed lines and emits exactly one terminal row per line:

```typescript
export class BoundedLines implements Component {
	constructor(private readonly lines: readonly string[]) {}

	render(width: number): string[] {
		return this.lines.map((line) => truncateToWidth(line, width));
	}
}
```

The invariant is testable directly — `new BoundedLines(lines).render(80).length === lines.length` — for any content, including a 526-character line and a CJK line whose code-unit length understates its columns.

**`get-result-renderer.ts`** is pure and mirrors `result-renderer.ts`: it turns details plus report text into the line array, choosing between the collapsed and expanded shapes.
It never returns a `Component`, so it stays free of SDK and TUI types beyond `Theme`.

**`get-result-tool.ts`** wires both into `toToolDefinition()` and builds the details object.

### Details shape

```typescript
/** Compact presentation metadata for a get_subagent_result result. Never the full result. */
export interface GetResultDetails {
	agentId: string;
	displayName: string;
	status: SubagentStatus;
	description: string;
	toolUses: number;
	/** Pre-formatted lifetime token total; "" when zero. */
	tokens: string;
	contextPercent: number | null;
	compactionCount: number;
	/** Pre-formatted duration string. */
	duration: string;
	/** First non-empty line of the result body, clipped to PREVIEW_CHARS. Never the whole result. */
	preview?: string;
	error?: string;
	/** Whether the conversation was requested, so the expanded view can say so. */
	verbose: boolean;
	transcriptPath?: string;
}
```

`preview` is the one field that summarizes the result, and it is deliberately produced at `execute` time from `record.result` rather than recovered at render time by parsing `formatAgentReport`'s output — the issue asks for structured metadata over report parsing, and the report's first lines are its header, not its body.
It is clipped to a fixed character budget before it enters `details`, so the field is bounded by construction and cannot become the duplication PR [#729] introduced.

It lives in `get-result-renderer.ts` beside the function that consumes it, not in `src/ui/display.ts`.
`AgentDetails` sits in `display.ts` because four modules build it; `GetResultDetails` has exactly one producer and one consumer.

### Collapsed shape — four rows

For the real agent measured above:

```text
▸ Get Agent Result  df6d68f5-1113-466
✓ Explore · 44 tool uses · 95.9k token · 9% · 213.0s
  ⎿  Trace Pi tool-result rendering
  ⎿  ## Summary  All paths relative to `/Users/chris/development/pi/pi`. …
```

The first row is `renderCall`; the other three are `renderResult`.
The preview row is what distinguishes this tool from `subagent`: a retrieval's whole purpose is the payload, so the collapsed view must say whether one arrived.
The verbose conversation never appears here — it is not in `details` at all.

### Expanded shape — at most 51 rows

Up to `MAX_EXPANDED_LINES` (50) lines of the report text, one row each, plus a trailing indicator when lines were dropped:

```text
  … (139 more lines — full transcript at /Users/chris/.pi/agent/sessions/…/tasks/….jsonl)
```

The indicator names the transcript path, so the pointer earns its row instead of being a separate always-present line.
When `verbose` was requested and lines were dropped, the indicator says so too — the conversation is inside the truncated region.

One rule covers everything: the expanded body is the report text, capped.
There is no per-status branching and no special case for the conversation, because the conversation is part of that text.

### Status glyph mapping

Both renderers need status → (glyph, theme colour) over the same `SubagentStatus` union.
`result-renderer.ts` spells it inline across `renderCompleted`, `renderStopped`, and `renderFailed`; the new module would re-derive it.
Step 1 extracts it to a narrow `renderStatusIcon(status, theme): string` taking only the two values both renderers have — not either details bag, so it raises no ISP question.

`SubagentStatus` has seven members (`src/lifecycle/subagent-state.ts:24-31`), and the helper is exhaustive over all seven, so a member added later fails to compile rather than falling through:

| Status      | Glyph       | Colour    |
| ----------- | ----------- | --------- |
| `completed` | `success`   | `success` |
| `steered`   | `success`   | `warning` |
| `stopped`   | `stopped`   | `dim`     |
| `error`     | `failure`   | `error`   |
| `aborted`   | `failure`   | `error`   |
| `queued`    | `queued`    | `dim`     |
| `running`   | `streaming` | `dim`     |

`queued` and `running` are reachable here and are not in `result-renderer.ts`'s three per-status renderers, because `get_subagent_result` can be called on an agent that has not settled — `renderAgentResult` peels those off in its dispatcher before the per-status renderers run.

### `textResult` widening

`textResult(msg, details?: AgentDetails)` becomes `textResult<T = AgentDetails>(msg: string, details?: T)`.
There are 15 call sites; 13 sit outside `get-result-tool.ts` and are unaffected — the nine that pass no details rely on the default, and the four that pass one pass `buildDetails(...)`, which returns `AgentDetails`, so `T` infers to today's type.
No exported alias pins the old return shape.
The change is type-only and lands in the wiring step with its consumer, because a generic parameter with no caller needing it is not independently verifiable.

## Module-Level Changes

| File                                     | Change                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tools/result-renderer.ts`           | Add exported `renderStatusIcon(status, theme)`; `renderCompleted`/`renderStopped`/`renderFailed` call it instead of inlining the mapping                      |
| `src/ui/bounded-lines.ts`                | **New.** `BoundedLines implements Component` — one clipped row per line                                                                                       |
| `src/tools/get-result-renderer.ts`       | **New.** `GetResultDetails`, `renderGetResultLines(details, reportText, expanded, theme): string[]`, and the `MAX_EXPANDED_LINES` / `PREVIEW_CHARS` constants |
| `src/tools/get-result-tool.ts`           | Add `renderCall` + `renderResult` to `toToolDefinition()`; add private `buildGetResultDetails(record, verbose)`; pass details through `textResult`            |
| `src/tools/helpers.ts`                   | `textResult` gains `<T = AgentDetails>`                                                                                                                       |
| `test/ui/bounded-lines.test.ts`          | **New.** Row-count invariant at several widths, long-line and CJK clipping                                                                                    |
| `test/tools/get-result-renderer.test.ts` | **New.** Collapsed/expanded shapes, preview, cap, indicator, per-status glyph                                                                                 |
| `test/tools/result-renderer.test.ts`     | Add `renderStatusIcon` coverage; existing assertions unchanged                                                                                                |
| `test/tools/get-result-tool.test.ts`     | Add a `describe` for the rendering hooks and the details payload                                                                                              |
| `README.md`                              | Note the compact/expandable presentation under `### get_subagent_result`                                                                                      |
| `docs/architecture/architecture.md`      | Add `bounded-lines.ts` and `get-result-renderer.ts` to the module-layout tree; add a `get-result-renderer` node to the tools subgraph                         |

`buildGetResultDetails` is named in full rather than `buildDetails`, because `helpers.ts` already exports a module-level `buildDetails` producing the structurally different `AgentDetails`, and `get-result-tool.ts` is one of the files a reader compares against `agent-tool.ts`.

### Predicted unchanged

| File                                       | Prediction | Claim it rests on                                                                                                                        |
| ------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tools/get-result-report.ts`           | Unchanged  | The report text is untouched; the renderer consumes its output, never its internals                                                      |
| `src/observation/outcome-delivery.ts`      | Unchanged  | Only `formatAgentReport` calls it, and that call is unchanged                                                                            |
| `src/ui/glyphs.ts`                         | Unchanged  | Every glyph the design needs already exists                                                                                              |
| `src/ui/display.ts`                        | Unchanged  | `GetResultDetails` lives beside its consumer; `Theme` and `formatDuration`/`getDisplayName` are imported as they already are             |
| `test/tools/helpers.test.ts`               | Unchanged  | Both existing calls (`textResult("hello")`, `textResult("done", details)`) are covered by the generic default and by inference           |
| `src/index.ts`                             | Unchanged  | `GetResultTool` is constructed the same way; rendering is internal to `toToolDefinition()`                                               |
| `docs/configuration.md`                    | Unchanged  | Its four `get_subagent_result` mentions concern the tool allowlist, update delivery, and session retention — none describes presentation |
| `.pi/skills/package-pi-subagents/SKILL.md` | Unchanged  | Its `get_subagent_result` mentions are the child-tool boundary and the update ledger, not rendering                                      |

## Test Impact Analysis

The extraction enables tests that are impractical today.

- **Row-count as a direct assertion.**
  `BoundedLines.render(width).length` is the invariant the issue actually asks for, and it is checkable at several widths against pathological input.
  PR [#729] could only assert on substrings of a string, which cannot see a wrapped row at all.
- **Collapsed/expanded shape as a line array.** `renderGetResultLines` returns `string[]`, so "collapsed is four lines" and "the conversation never appears collapsed" are exact assertions rather than `not.toContain` probes.
- **Exhaustive status coverage.** `renderStatusIcon` takes a bare `SubagentStatus`, so all seven members are covered by a table-driven test rather than through seven fully-built details bags.

No existing test becomes redundant.
`test/tools/get-result-report.test.ts` covers report text, which this change does not touch, and `test/tools/get-result-tool.test.ts`'s carrier-claim tests cover `execute`'s lifecycle, which is the invariant below.

The theme double is a two-method structural stub (`fg`, `bold`) matching `Theme` in `src/ui/display.ts`; it needs no `as unknown as` cast.
Assertions on rendered rows use `toEqual` on the array where the shape is fixed, and `toBe` on `.length` for the bound.

## Invariants at risk

| Invariant                                                                                                                | Owner                    | Pinned by                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exactly-once outcome delivery: a `wait` claims before settling, a settled record is consumed, an abandoned wait releases | [#903], [#872]           | `test/tools/get-result-tool.test.ts` `describe("GetResultTool — carrier claim")` — asserts `record.claimed` / `record.consumed` directly on the real record, not through a mock |
| The report text `formatAgentReport` produces is unchanged                                                                | [#798], [#878]           | `test/tools/get-result-report.test.ts` and the existing content assertions in `test/tools/get-result-tool.test.ts`                                                              |
| `renderAgentResult`'s per-status output for the `subagent` tool                                                          | Phase 20 ([#535]–[#538]) | `test/tools/result-renderer.test.ts` — Step 1 is a pure extraction and must leave every assertion green unedited                                                                |

`execute` gains one statement (building details) and one changed return expression.
It must not gain a branch, and the claim/consume calls must not move relative to `isActive()`: the tests above are the guard, and they exercise the real `Subagent` record rather than a stub of it.

The quantitative invariant this change establishes, measured on the real 189-line report:

| Terminal width |    Today | After |
| -------------- | -------: | ----: |
| 80             | 258 rows |    51 |
| 100            | 234 rows |    51 |
| 120            | 227 rows |    51 |

Those counts are the result body alone, as rendered by `renderResult`; the call header is one further row before and after.
The collapsed body goes from 10 rows (on `0.84.2`+) or the whole report (below it) to 3.

## TDD Order

1. **`refactor(pi-subagents): extract the status glyph mapping in result-renderer`** Add `renderStatusIcon(status: SubagentStatus, theme: Theme): string`, exhaustive over all seven members, and call it from `renderCompleted`, `renderStopped`, and `renderFailed`.
   Prepares the friction the new renderer would otherwise hit: re-deriving the same mapping for the same enum in a second file.
   Tests: a table-driven case per status in `test/tools/result-renderer.test.ts`; every existing assertion stays green **unedited**.
   Killing mutation: make `renderStatusIcon` return `theme.fg("success", GLYPHS.success)` for every status — the new table cases and the existing `renderStopped`/`renderFailed` tests must go red.

2. **`refactor(pi-subagents): add a width-aware bounded-lines component`** New `src/ui/bounded-lines.ts`.
   No module imports it yet, so it is `refactor:` however new it is.
   Tests: `render(w).length` equals the input line count at widths 40, 80, and 120; a 526-character line yields exactly one row; a CJK line is clipped by display columns, not code units (`visibleWidth(row) <= width`); an empty line survives as one row.
   Killing mutation: make `render` return `[...this.lines]` unclipped — the long-line and CJK cases must go red while the short-line cases stay green.

3. **`refactor(pi-subagents): add the get_subagent_result line renderer`** New `src/tools/get-result-renderer.ts` with `GetResultDetails`, `renderGetResultLines`, and both constants.
   Still unimported by `src/`, so still `refactor:`.
   Tests, as two `describe` blocks:
   - collapsed — exactly three lines; carries the status glyph, the dot-joined stats, the description, and the preview; contains neither the report body beyond the preview nor any conversation text;
   - expanded — at most `MAX_EXPANDED_LINES` report lines plus one indicator; the indicator names the transcript path and appears only when lines were dropped; a report shorter than the cap produces no indicator; `verbose: true` is reflected in the indicator wording.

   Two killing mutations, one per equivalence class:
   - ignore the `expanded` argument and always build the expanded array — every collapsed test goes red, expanded tests stay green;
   - change the cap slice to `lines.slice(0)` — the cap and indicator tests go red, the short-report test stays green.

4. **`feat(pi-subagents): show subagent results compactly, expandable with Ctrl+O`** Wire `renderCall` and `renderResult` into `toToolDefinition()`, add `buildGetResultDetails`, widen `textResult` to `<T = AgentDetails>`, and pass details on both `execute` return paths.
   The generic change lands here because this is its only consumer and `tsc` is its instrument.
   Tests in a new `describe` in `test/tools/get-result-tool.test.ts`:
   - `toToolDefinition().renderResult` exists and, given a real result, returns a component whose `render(100).length` is 3 collapsed and at most 51 expanded;
   - `toToolDefinition().renderCall` renders the `agent_id` argument;
   - `execute` returns `details` whose `preview` is bounded and which contains neither `record.result` in full nor any conversation text;
   - the agent-not-found path still returns its message and omits details.

   Killing mutations:
   - delete the `renderResult` entry from the `defineTool` object — the row-count tests must go red (a newly added registration is as unpinned as a relocated one);
   - make `buildGetResultDetails` set `preview: record.result` — the bounded-preview test must go red.

5. **`docs(pi-subagents): document the compact result presentation`** README's `### get_subagent_result` section gains a sentence on the collapsed/expanded views and the Ctrl+O affordance.
   `docs/architecture/architecture.md` gains `bounded-lines.ts` and `get-result-renderer.ts` in the module-layout tree and a `get-result-renderer` node in the tools subgraph.
   Verification: `pnpm exec rumdl check` on both files, and the Mermaid block renders.

## Risks and Mitigations

| Risk                                                        | Mitigation                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A thrown renderer blanks the tool row                       | Pi wraps both hooks in `try`/`catch` and falls back to `createCallFallback`/`createResultFallback`, so a throw degrades to today's behavior rather than breaking the TUI. The renderer is nonetheless total: every field it reads is either required or explicitly optional-guarded. |
| Clipping hides content the operator wanted                  | Clipping is horizontal only and applies to the *view*; `content` is untouched, and the indicator names the transcript path. The 50-line cap matches the `subagent` tool's existing, accepted budget.                                                                                 |
| The collapsed preview leaks something long                  | `preview` is clipped at `PREVIEW_CHARS` before entering `details`, and clipped again to the terminal width by `BoundedLines` — two independent bounds, the second of which cannot be bypassed by a wide glyph.                                                                       |
| `truncateToWidth` behaves differently at the pi-tui floor   | Verified present and exported at `v0.75.0`, the declared floor, as well as in the installed `0.84.4`.                                                                                                                                                                                |
| Step 1's extraction silently changes `subagent`'s rendering | Step 1 edits no test. Any change in `result-renderer.ts`'s output fails an existing assertion rather than being absorbed.                                                                                                                                                            |
| `details` growth re-introduces the [#729] duplication later | The interface doc-comment states the constraint, and Step 4's mutation test pins it: setting `preview` to the full result turns a test red.                                                                                                                                          |

## Open Questions

None blocking.
Two items are deliberately left to their own issues: the model name in the stats line ([#755]) and `steer_subagent`'s missing rendering, which no issue requests.

## Credit

Both contributors' accepted design ships here, so the `feat:` commit in Step 4 carries, in its final paragraph:

```text
Refs #636

Co-authored-by: Tony Wong <27016195+tonybro233@users.noreply.github.com>
Co-authored-by: Adam Barton <108860307+rosingrind@users.noreply.github.com>
```

`tonybro233` contributed the structured-metadata-over-report-parsing constraint and the bounded-rows requirement; `rosingrind` contributed the working shape of the collapsed/expanded split in PR [#729].
PR [#729] is a close target at ship time, with a comment naming what was adopted and why the details payload and width handling differ.
Both numeric user ids were resolved from `gh api users/<login>` during planning, so the addresses above are ready to use verbatim.
Verify the trailers with `git interpret-trailers --parse` — they must be the message's final paragraph, below `Refs #636`.

[#535]: https://github.com/gotgenes/pi-packages/issues/535
[#538]: https://github.com/gotgenes/pi-packages/issues/538
[#636]: https://github.com/gotgenes/pi-packages/issues/636
[#729]: https://github.com/gotgenes/pi-packages/pull/729
[#755]: https://github.com/gotgenes/pi-packages/issues/755
[#798]: https://github.com/gotgenes/pi-packages/issues/798
[#872]: https://github.com/gotgenes/pi-packages/issues/872
[#878]: https://github.com/gotgenes/pi-packages/issues/878
[#903]: https://github.com/gotgenes/pi-packages/issues/903
