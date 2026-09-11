---
issue: 636
issue_title: "Add compact, Ctrl+O-expandable rendering for `get_subagent_result`"
---

# Retro: #636 — Add compact, Ctrl+O-expandable rendering for `get_subagent_result`

## Stage: Planning (2026-09-11T08:07:50Z)

### Session summary

Planned custom `renderCall`/`renderResult` hooks for `get_subagent_result`, after establishing that the issue's headline premise no longer holds on current Pi.
The operator chose to reimplement in-repo rather than merge third-party PR [#729], with a three-row collapsed view including a result preview, and a width-aware component bounding the expanded view at exactly one terminal row per line.
Plan committed as `docs/plans/0636-compact-expandable-get-result-rendering.md`.

### Observations

- **The issue's premise was half-stale, and only reading Pi's source showed it.**
  [#636] says Pi "displays its complete text output inline".
  Pi capped the collapsed fallback at ten lines in `0.84.2` (`e14afc648`), which the operator confirmed live from their own transcript.
  The package's peer floor is `>=0.81.0`, so the original unbounded dump is still reachable on `0.81.0`–`0.84.1` — the fix is justified on both the floor range and on the expanded view, which is unbounded everywhere.
  Enumerating published versions (`pnpm view ... versions`) rather than git tags was what pinned `0.84.2` as the boundary.
- **`app.tools.expand` is a global toggle, not per-call.**
  `setToolsExpanded` walks every expandable child, so expanding to read one tool result expands every `get_subagent_result` in the transcript at once.
  This is why the expanded bound, not the collapsed view, is the load-bearing half of the change.
- **`details` is persisted but not sent to the model.**
  It is `JSON.stringify`'d into the session JSONL and is absent from `convertToolResult` and `estimateMessageTokens`.
  PR [#729] puts the complete result text there, which roughly doubles on-disk bytes per retrieval and contradicts the issue author's own instruction.
  This was the single most decision-relevant fact found, and it is invisible from the type declarations.
- **`ToolRenderContext` carries no terminal width.**
  That is why the row bound lives in a `Component` (`render(width)`) rather than in the string builder — a fixed column budget would have been a guess, and `Text` word-wraps rather than clips, so a code-unit cap does not bound rows at all.
  PR [#729]'s "display-width-aware" limits use `String.length`.
- **Measurement replaced argument throughout.**
  The real stored result (182 lines, 9 054 chars, longest line 526) was measured from a session transcript and each candidate policy costed at three widths: uncapped 227–258 rows, line-cap-only 58–64, width-aware exactly 51.
  The line-cap-only option — which is the existing in-package convention — overshoots its own stated budget by ~25 %, which no prose argument would have surfaced.
- **Third-party PR with an accepted design.**
  Both [#636]'s reporter and PR [#729]'s author contributed design that ships, so the plan records resolved `Co-authored-by:` trailers (numeric ids fetched from `gh api users/<login>`) and names [#729] as a ship-time close target.
- **Triage said "deferred" twice; the operator scheduled it this session.**
  The `2026-09-02` backlog also records that [#729] has been waiting for a maintainer answer since 2026-08-13 with CI approval withheld — that response debt is discharged by shipping this.
- Sibling issue [#755] is open against the same two files (model name in the stats line).
  Deliberately out of scope, recorded as a Non-Goal so the two do not collide.

#### Deferred tidyings

- `src/tools/get-result-tool.ts` — the assessor considered and **declined** splitting the carrier-claim lifecycle from report assembly: the file mirrors `agent-tool.ts`'s shape (thin `toToolDefinition` wiring plus private `build*` methods) and grows to roughly 150–160 lines, below `agent-tool.ts`'s 304.
- `src/tools/result-renderer.ts` — a `joinDim(parts, theme)` extraction for the `" · "` dim-join idiom was rated Optional and dropped; three lines, and the two call sites build different part lists.
- `src/tools/helpers.ts` — splitting `textResult`/`buildDetails` from the type-list and guideline builders it also hosts was rejected as unrelated to this change.

#### Assessor corrections to the design

The `tidy-first-assessor` corrected two premises before the plan was written: `textResult` has 15 call sites (13 unaffected), not the 14 the design summary asserted, and there is no structural argument for splitting `get-result-tool.ts` first.
It recommended one preparatory commit — extracting the status→(glyph, colour) mapping from `result-renderer.ts` — which became TDD Step 1, and rejected a shared `renderStats` extraction as a wrong abstraction, since `AgentDetails` and `GetResultDetails` overlap in only two fields.

## Stage: Implementation — TDD (2026-09-11T15:38:34Z)

### Session summary

All five TDD Order steps completed as planned, in order, each with its killing mutation verified before commit: the status-glyph extraction, `BoundedLines`, `get-result-renderer.ts`, the tool wiring, and the docs.
Two pre-completion review rounds followed, producing three further commits.
Test count went from 1712 to 1764 (+52: `result-renderer` +8, `bounded-lines` +11, `get-result-renderer` +24, `get-result-tool` +9).

### Observations

- **Every predicted mutation killed exactly the predicted class.**
  Step 1's mutation reddened three *pre-existing* `renderStopped`/`renderFailed` tests alongside the new table, which is what proved the extraction was behavior-preserving rather than merely green.
  Step 3's two mutations split 15 collapsed / 9 expanded and 5 cap / 19 other, matching the plan's per-class predictions.
  Two negative-assertion tests (`omits the compaction glyph`, `omits the context percent`) stayed green under the collapsed mutation; each has a positive sibling that went red, so the pair discriminates even though neither half does alone.
- **The plan's central claim was incomplete, and only the reviewer's adversarial input enumeration found it.**
  `BoundedLines.render` returned one array element per line, but an element carrying an embedded `\n` still cost the terminal extra rows — so the bound held in the test and not on screen.
  The fix went into `BoundedLines` rather than the two `subLine` call sites: the component is what promises the bound, and putting it at the call sites would have left the guarantee resting on every future caller's care.
  Pi's own `TruncatedText` cuts at the first newline for the same reason.
- **The second review round widened the same gap again.**
  `\v` and `\f` are zero-width, so they survive a width-based clip, and a VT100-class terminal moves the cursor down for both exactly as for `\n`.
  The cut is now `/[\r\n\v\f]/`.
  Lesson: "one row per line" is a claim about what the *terminal* does with the string, not about array length — the test that asserts `render(w).length` cannot see the difference, which is precisely why the reviewer's re-derivation mandate was worth writing.
- **A generic default silently removed a type check.**
  Widening `textResult` to `<T = AgentDetails>` meant `background-spawner.ts`'s inline details literal began *defining* `T` instead of being checked against `AgentDetails`.
  `tsc` stayed green because the literal happened to conform.
  Fixed by hoisting to `const details: AgentDetails = {…}`; an explicit `textResult<AgentDetails>(…)` was tried first and rejected by `@typescript-eslint/no-unnecessary-type-arguments`.
  Verified by adding an unknown field and confirming `tsc` now fails where it previously passed.
- **Accepted residuals.**
  The `asSdkTheme` cast in `test/tools/get-result-tool.test.ts` stands: the registered hooks take Pi's full `Theme`, while `display.ts` narrows it to the two methods the renderers call, so a double is structurally short of the SDK type by design.
  The plan's claim that no cast would be needed was true of the pure-function tests and not of the hook-invoking ones.
  The `\r` cut can also drop trailing content on a report line embedding a mid-line carriage return — the same trade-off `TruncatedText` already makes, and the full text remains in `content` and the session entry.
- **Three process notes.**
  Appending a test block with a python heredoc wrote a literal `\n` into the file, the exact hazard `AGENTS.md` warns about; the autoformatter caught it immediately.
  A mid-file `Edit` inserting a sibling function closed the `BoundedLines` class early and reparented `render` — recovered by rewriting the file with `Write`.
  `git checkout -- <file>` used to revert a mutation probe discarded an uncommitted fix, because HEAD was the pre-fix commit; the fix had to be re-applied.
- Two `--autosquash` rebases folded the review fixes into the commit that introduced the code, since nothing had shipped and a `fix:` for a never-released defect would have been a false changelog entry.
  Both were verified with a backup tag and a subject diff.

### Reviewer verdict

Pre-completion reviewer: **WARN** (both rounds), no blocking findings.
Round 1 raised four findings; three were fixed (the row-bound gap, the `textResult` loosening, a stale module-count table in the package skill) and one accepted (the `asSdkTheme` cast).
Round 2 raised two; one was fixed (`\v`/`\f`) and one accepted (mid-line `\r` truncation).

[#636]: https://github.com/gotgenes/pi-packages/issues/636
[#729]: https://github.com/gotgenes/pi-packages/pull/729
[#755]: https://github.com/gotgenes/pi-packages/issues/755
