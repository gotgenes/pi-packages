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

## Stage: Sync (worktree) (2026-09-11T15:40:54Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both pass with no changes needed.
The branch's last substantive commit is `docs: refresh the pi-subagents module counts in its skill`, closing out the second pre-completion review round; the plan's `**Release:** ship independently` marker stands, and PR [#729] remains an open ship-time close target with credit already resolved into the `feat:` commit's trailers.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-636--/2026-09-11T07-48-29-040Z_01a08f70-7cef-705d-9571-151dde301bed.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

No new findings at this stage; the two pre-completion review rounds already surfaced and resolved the substantive issues (see the Implementation — TDD stage entry above).
Ready for `git rebase main` and handoff to the root `/ship 636`.

## Stage: Final Retrospective (2026-09-11T15:53:11Z)

### Session summary

Shipped [#636] through the worktree lane: fast-forward merged `issue-636-add-compact-ctrl-o-expandable-rendering` into `main`, verified CI, closed the issue and superseded PR [#729] with contributor credit, and released `pi-subagents` v21.7.0.
The issue spanned three peer-session stages (planning, TDD, sync) on `claude-opus-5` plus a root ship on `claude-sonnet-5`, landing eight commits and +52 tests.
The dominant pattern across all four stages was measurement displacing argument — at the design gate, at every killing mutation, and in both pre-completion review rounds.

### Observations

#### What went well

- **Measurement replaced argument at the design gate, and overturned the in-package convention.**
  Three candidate expanded-view policies were costed at three terminal widths against the real stored 182-line result, which showed the existing convention — a 50-line cap, as `result-renderer.ts` already does for `subagent` — overshooting its own budget by roughly 25 % because `Text` word-wraps rather than clips.
  The width-aware component delivered exactly 51 rows at every width against 227–258 today.
  No prose argument reaches that conclusion; the plan would have adopted the existing convention on consistency grounds alone.
- **`/ship` step 2's plan-and-retro read paid off exactly as designed.**
  PR [#729] was named as a ship-time close target in the Planning stage note, and no commit in the `"$PLAN"^..HEAD` range mentions it.
  A step that only greps the plan for `**Release:**` would have left it open — the precise failure [#849] added this read to prevent.
- **The `pre-completion-reviewer` found a defect in the change's central claim, in two consecutive rounds.**
  `BoundedLines.render` returned one array element per line, but an element carrying an embedded `\n` still cost the terminal extra rows, so the bound held in the assertion and not on screen.
  A test asserting `render(w).length` structurally cannot see the difference.
  Round 2 widened the same gap to `\v` and `\f`, which are zero-width and so survive a width clip while still moving the cursor down.
  Both fixes went into `BoundedLines` rather than its two call sites, because the component is what promises the bound.
- **Two `AGENTS.md` version-discipline rules earned their keep.**
  Enumerating *published* versions (`pnpm view … versions`) rather than git tags pinned `0.84.2` as the fallback-cap boundary.
  Reading the persistence path rather than the `.d.ts` established that `details` is `JSON.stringify`'d into the session JSONL and never sent to the model — the single most decision-relevant fact, invisible from the type declarations, and what justified diverging from PR [#729]'s design.

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — the PR [#729] close comment was posted with `gh pr comment --body` and an inline double-quoted body containing backticks and backslash escapes.
  `AGENTS.md` requires `--body-file` for a body containing backticks, but states its rationale for *single* quotes (`` \` `` ships literally), so the double-quoted form read as permitted.
  Three opening backticks were lost to escape collapse, publishing `` `\n`/\r`/\v`/\f` `` on a contributor-facing comment.
  Impact: 2 extra tool calls to read the comment back via `gh api` and `PATCH` it from a `--body-file` heredoc, which worked first try; malformed for under a minute, no other rework.
- `instruction-violation` (self-identified, no impact) — the ship session ran `pnpm run lint 2>&1 | tail -40` and `pnpm fallow dead-code 2>&1 | tail -60`, the exact pipe-through-`tail` pattern `AGENTS.md` forbids because a pipeline's exit status is the filter's.
  Nothing was gated on the status and both outputs carried explicit success text, so the gate held by reading rather than by construction.
  Impact: none this time.
- `instruction-violation` (self-identified) — a test block was appended to `test/tools/get-result-tool.test.ts` with a python heredoc, writing a literal `\n` into the file.
  This is the hazard `AGENTS.md` names outright; the autoformatter surfaced it immediately.
  Impact: 2 calls to detect and repair.
- `instruction-violation` (self-identified) — a mid-file `Edit` inserting a sibling function into `src/ui/bounded-lines.ts` closed the class early and reparented `render`.
  Impact: recovered by rewriting the file with `Write`.
- `instruction-violation` (self-identified) — `git checkout -- src/tools/background-spawner.ts`, used to revert an excess-property-checking probe, discarded the uncommitted fix because HEAD was the pre-fix commit.
  Notable as a pattern break rather than a knowledge gap: the session used the correct `cp /tmp/green-*.ts` save-and-restore for all five plan-named killing mutations, then abandoned it for an ad-hoc probe run during review-fix verification — after `/tdd-plan`'s "Verify the pins" step, which is where the rule lives.
  Impact: fix re-applied, ~2 calls.

#### What caused friction (user side)

- Nothing that cost the session anything — both operator interventions were unusually well-timed.
  The paste of the operator's own collapsed render settled the stale-premise question at the exact moment the session was about to spend more calls on version archaeology.
  The one-sentence redirect "we already have some sort of custom result rendering somewhere else" pointed at the `agent-tool.ts` + `result-renderer.ts` convention before the design committed, rather than as a correction after it.
  Recorded as the pattern to keep, not as an opportunity.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5`, sync and ship on `anthropic/claude-sonnet-5`, this retro on `claude-opus-5`.
  All four subagent dispatches were appropriately matched: `Explore` with an explicit `model: "sonnet-5"` for the multi-hop Pi-checkout trace (the `AGENTS.md` rule, rather than the weak haiku default), and `tidy-first-assessor` plus two `pre-completion-reviewer` rounds on their frontmatter default `anthropic/claude-sonnet-5`.
  No mismatch found in either direction.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest same-target sequence was the `background-spawner.ts` type-check fix at roughly 8 calls, but it changed approach three times deliberately (explicit type argument → rejected by `@typescript-eslint/no-unnecessary-type-arguments` → typed local), each redirect driven by a new gate result rather than by repetition.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check`, root `pnpm run lint`, and the per-file vitest run fired after every step, with `pnpm fallow dead-code` after steps 2, 3, and 4 and the killing mutation verified before every commit.
  Two fallow findings were caught at the step that created them — the `BoundedLines` `invalidate` suppression, and `PREVIEW_CHARS` having no consumer until step 4 — rather than at end-of-cycle, which is what let `PREVIEW_CHARS` move to its consumer's step instead of being suppressed.
- **Unused-tool detection** — skipped; no `rabbit-hole` or `missing-context` findings to attribute.
  Worth noting only that `colgrep` went unused across all stages, with exploration done by exact-symbol grep and whole-file reads — defensible here, since the issue named its own target modules.

### Changes made

1. `AGENTS.md` § Shell and search — widened the `gh issue comment` / `gh pr comment` rule to require `--body-file` *whatever the quoting*, and split the quoting mechanism onto its own sentence.
   The rule previously stated only the single-quote failure, so the double-quoted form this session used read as the sanctioned workaround.
2. `AGENTS.md` § Commits — widened the `git checkout <ref> -- <path>` warning from "as the swap in an A/B measurement" to "to revert any probe — an A/B swap, a killing mutation, a type-check spike".
   The probe that lost work here was none of the framings the rule named.
3. Declined: a read-back rule for posted GitHub comments (`gh api …/comments/<id> --jq .body`).
   It detects rather than prevents, and change 1 closes the source.
4. Declined: restating the pipe-through-`tail`, heredoc-`\n`, and mid-file-`Edit` hazards.
   All three are already in `AGENTS.md` naming this exact failure mode; three self-caught trips in one session is a salience signal, and more text worsens salience.
5. `AGENTS.md` § Commits — added a cost clause to the `rumdl` cache rule, after the operator asked why the cache was being cleared at all.
   The rule's trigger is a commit that moves or renames files; this session cleared the cache three times on content-only edits, which invalidate their own entries.
   Measured on this tree: a cold `rumdl check .` reports 1927 ms against 93 ms warm (4.32 s vs 2.44 s wall, 17.68 s vs 0.65 s CPU), and discards a 4.5 MB cache the next run rebuilds.
   The rule stated when to clear and never that clearing costs anything, which reads as "clear when unsure".

[#636]: https://github.com/gotgenes/pi-packages/issues/636
[#729]: https://github.com/gotgenes/pi-packages/pull/729
[#755]: https://github.com/gotgenes/pi-packages/issues/755
[#849]: https://github.com/gotgenes/pi-packages/issues/849
