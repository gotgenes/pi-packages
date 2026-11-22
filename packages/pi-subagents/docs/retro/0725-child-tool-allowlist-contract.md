---
issue: 725
issue_title: "child sessions: registerTool during bind is silently dropped. intended?"
---

# Retro: #725 — child sessions: registerTool during bind is silently dropped. intended?

## Stage: Planning (2026-08-13T22:38:00Z)

### Session summary

Traced the reported behavior to Pi's own `tools:` allowlist semantics: `createSubagentSession` passes `tools: cfg.toolNames` to `createAgentSession`, the SDK stores it as `_allowedToolNames`, and `_refreshToolRegistry` filters extension-registered tools out **before** building the child's registry.
An extension's `registerTool` in a child therefore succeeds and is then discarded — Pi's documented behavior, not a defect, and not a `pi-subagents` bug either.
Planned a docs-first response: document the allowlist contract and extension tool names as first-class `tools:` entries, make the YAML sequence form intentional, extract `docs/configuration.md` from the 487-line README, and harden the recursion guard into an SDK `excludeTools` denylist.

### Observations

- The issue is third-party (`krisdock`), so the `ask_user` gate ran on direction, not just design.
  The operator chose docs-only over inheriting extension tools into children; the deciding evidence was concrete rather than abstract — in this repo, default inheritance would hand a read-only `Explore` child `issue_close`, `release_pr_merge`, `ci_watch`, `web_search`, and `fetch_content`.
- Open [PR 612] (`wolfgangmeyers`) attacks the same symptom by unioning the parent's active tools into the child's allowlist.
  Reading the SDK source turned up two defects the PR body does not mention: the parent's active set includes built-ins (so a read-only agent would gain `bash`/`edit`/`write`), and admitting `subagent` into the allowlist makes the next refresh restore it after the post-bind guard strips it.
  `/ship-issue` closes the PR with thanks and that analysis.
- The second defect generalizes: with an allowlist set, **every** `_refreshToolRegistry()` re-adds every allowlisted registry tool to the active set, so the existing post-bind `applyRecursionGuard` is not durable.
  It only bites an agent whose frontmatter names `subagent`, but the fix is smaller than the bug report — pass `excludeTools`, delete the guard function.
  That turned a docs-only plan into a two-commit `feat:`/`fix:` plan, which also guarantees the docs ship in a release.
- Measured rather than assumed the frontmatter question the operator raised: frontmatter is YAML, and both sequence forms already work by accident through `String(val)` on an array.
  The plan makes it intentional instead of documenting a coincidence.
- Scope grew twice by operator request, each time deliberately: the `builtinToolNames` → `toolNames` rename (the field name became a lie once extension names are documented) and the `docs/configuration.md` extraction (mirroring `pi-permission-system`'s 178-line README plus configuration doc).
- The `as any` at `src/index.ts:114` came up during the guard design: it is the seam where narrow `*Like` test contracts meet the SDK's concrete classes.
  Planned a field-scoped downcast instead of generics, since parameterizing the IO would infect `ParentSnapshot`.
  Step 3 is independent and droppable if the narrowed assertion does not compile.
- An `Explore` subagent on `sonnet-5` did the SDK trace (68 tool calls, 85k tokens) and returned exact file/line evidence, keeping the hunt out of this session's context.
  Its one wrong conclusion — "no ordering/capping issue" — came from a Pi regression test where no allowlist was in play; reading `_refreshToolRegistry` in the installed `dist` directly settled it.
  Verify a subagent's negative finding against the code path your caller actually takes.

## Stage: Implementation — TDD (2026-08-13T23:50:00Z)

### Session summary

Six commits, all six plan steps: the YAML-sequence `tools:` parse, the `excludeTools` recursion guard, the SDK-seam retyping, the `builtinToolNames` → `toolNames` rename, the `docs/configuration.md` extraction, and the tool-allowlist contract documentation.
`pi-subagents` went 1229 → 1230 tests (five new `tools:` form cases and two new guard cases, against three retired post-bind guard cases and three retired fixture self-tests).
Pre-completion reviewer: PASS.

### Observations

- The tidy-first assessor recommended no preparatory commits and made one call that proved right: the fixture's `toolsBeforeBind`/`toolsAfterBind` toggle went dead as a consequence of the guard change, so it belonged inside that commit rather than before it.
- Step 1 landed as `fix:`, not the planned `feat:`.
  Four of the five new parser tests passed on the first run — the sequence forms already worked through `String(val)` coercion, exactly as the plan measured.
  The fifth (a quoted sequence entry containing a comma) failed, which is the whole behavior delta and makes `fix:` the honest type.
  A plan that predicts "this already works" should expect a thin red.
- Removing the `as any` at the SDK seam turned out to be self-verifying: the file-level `@typescript-eslint/no-unsafe-argument` disable immediately reported as unused, proving the cast was its only cause.
  The field-scoped downcast compiled on the first try, so the plan's fallback (a single documented `as unknown as` in a named helper) was not needed.
- The reviewer noted the new `### Child tool selection` architecture subsection had landed after `### What the core dropped`; moved it up beside `### What the core owns`, where an ownership-policy statement belongs, and amended.
- Deviations beyond the plan, all small: `parseCsvField` → `parseListField` and `csvList` → `listField` (the names described a CSV-only parser that no longer exists), and the removal of the now-unused eslint-disable.
- Ship-time reminder carried forward from planning: PR #612 closes with thanks and the two-defect analysis (built-in leakage into read-only agents; the guard restored by the next registry rebuild).

## Stage: Final Retrospective (2026-08-14T00:04:54Z)

### Session summary

One process carried all four stages — planning, TDD, ship, and this retro — for a third-party report that turned out to describe Pi's own SDK semantics rather than a `pi-subagents` defect.
Six implementation commits landed `@gotgenes/pi-subagents@19.3.2`: two `fix:` (YAML-sequence `tools:` parsing, durable recursion guard), two `refactor:` (SDK-seam typing, `builtinToolNames` → `toolNames`), and two `docs:` (the new `docs/configuration.md`, the tool-allowlist contract).
Issue #725 closed with a root-cause explanation, and [PR 612] closed as superseded with the two defects named.

### Observations

#### What went well

- The diagnosis held up end to end because it was read out of source, not inferred.
  The whole issue turns on one line in the installed SDK — `_refreshToolRegistry`'s `isAllowedTool` filter running *before* the registry is built — and every downstream decision (docs-only direction, `excludeTools` denylist, the PR 612 critique) rests on it.
  Reading `node_modules/.pnpm/@earendil-works+pi-coding-agent@0.80.5/.../core/agent-session.js` directly cost about four tool calls and settled questions that prose could not.
- The `ask_user` free-text note channel did real design work.
  Three of this issue's scope decisions arrived as notes attached to option selections, not as answers to the options: the YAML-vs-CSV frontmatter question (became the parser fix), "this package deserves its own configuration doc" (became `docs/configuration.md`), and "can we please avoid an `as any` cast?" (became the seam retyping).
  None required rework; each was a genuine improvement the option set had not anticipated.
- Verification ran incrementally and caught two things at the moment they happened: root `pnpm run lint` reported the file-level `@typescript-eslint/no-unsafe-argument` disable as unused the instant the `as any` left `src/index.ts` (proving the cast was its only cause), and `pnpm pack` + `tar tzf` confirmed the new `docs/configuration.md` ships in the tarball — a risk the plan named rather than an assumption.
- The plan's Risks table made the TDD stage decision-free.
  Both hedges it recorded (a fallback `as unknown as` helper if the field-scoped downcast would not compile; the tarball check) resolved on the first attempt, so no step needed re-deciding mid-implementation.

#### What caused friction (agent side)

- `other` — `rg -rn 'setActiveTools|before_agent_start' packages/pi-permission-system/src/` returned output with every match rewritten to `n` (`pi.n(names)`, `pi.on("n", ...)`), because `rg -r` is `--replace`, not `--recursive`, and it consumed the `n` from the bundled flags.
  The output looked like plausible minified code rather than an error, so the first reaction was to suspect a `RIPGREP_CONFIG_PATH` replacement setting.
  Confirmed after the fact: `rg -rn 'alpha' file` on `alpha beta` prints `n beta`.
  Impact: about three wasted tool calls and a near-misreading of the permission-system source; no rework, because the mangling was noticed before any conclusion was drawn from it.
- `other` — the `Explore` subagent's SDK trace returned an internally inconsistent report: it answered the caller's actual configuration correctly under "what does the `tools` option do" (an allowlist) and "what does a subagent-style caller get", then concluded under "is there an ordering/capping issue" that there is **none**, citing a Pi regression test that runs without the allowlist in play.
  Accepting that negative would have inverted the entire diagnosis.
  Impact: no rework — the contradiction was visible within the report itself and settled by reading `_refreshToolRegistry` directly — but it cost the verification detour and is the session's clearest reusable lesson.
- `instruction-violation` (self-identified) — used `echo ===` as a separator inside a bundled `bash` call and hit `zsh:1: == not found`, discarding the rest of the chain.
  `AGENTS.md` documents this exact trap and prescribes `echo ---`.
  Impact: one wasted command, corrected immediately on the next call; no rework.
- `other` — the plan scheduled step 1 as `feat:` while its own Design Overview measured that both YAML sequence forms already worked through `String(val)` coercion.
  Four of the five new parser tests passed on the first run; only the quoted-comma-entry case was genuinely red, which is what made `fix:` the honest commit type.
  Impact: no rework — the type was corrected at commit time and the deviation recorded in the commit body — but a plan that measures "this already works" should name the one failing input up front or reclassify the step as `test:` + `refactor:`.

#### What caused friction (user side)

- Nothing that cost rework.
  One modest opportunity: the three scope-expanding asides arrived across three separate `ask_user` rounds, so each cost a round-trip.
  The frontmatter-format question in particular was answerable at the first ask — had the pre-ask message shown `parseCsvField`'s `String(val).split(",")` alongside the direction options, the CSV-vs-YAML observation and the direction choice could have been made together.
  Showing a config field's parse path in the pre-ask context, not just its documented semantics, is the generalizable version.

### Diagnostic details

- **Model-performance correlation** — the session ran three effective model switches: `claude-opus-5` for planning, `claude-sonnet-5` for TDD and ship, `claude-opus-5` for this retro.
  The split matches the work: judgment-heavy direction-setting and design on opus, mechanical red→green→commit execution and the deterministic ship sequence on sonnet.
  Three subagents ran: `Explore` on `sonnet-5` for the SDK trace (68 tool calls, 85k tokens, one wrong negative as noted above — the model choice was right for a multi-hop trace, and `haiku` would have done worse), `tidy-first-assessor` (returned no preparatory commits plus one correct call — that the fixture's before/after-bind toggle would go dead as a *consequence* of the guard change, so it belonged inside that commit), and `pre-completion-reviewer` (PASS, with one placement note that was acted on).
- **Escalation-delay tracking** — no sequence exceeded five consecutive tool calls on the same error.
  The one investigation deep enough to qualify (the SDK semantics hunt) was delegated to `Explore` rather than run inline, per the `AGENTS.md` guidance.
- **Unused-tool detection** — nothing material.
  `colgrep` went unused, but every search this session targeted exact symbols (`builtinToolNames`, `applyRecursionGuard`, `excludeTools`), which is `grep`'s case per the `colgrep` skill's decision table.
- **Feedback-loop gap analysis** — verification was incremental throughout: `pnpm run check` after every type-touching step, a targeted `vitest run <file>` per red/green cycle, root `pnpm run lint` immediately after the seam change, and the full suite plus `pnpm fallow dead-code` at the end and again before push.
  No gap to flag.

### Changes made

1. `AGENTS.md` — new `## Shell and search` section, carrying the four items that had accumulated under `## Code Style` (the `colgrep`-vs-`grep` split, glob quoting, `=`-leading bash words, `*/` inside a block comment) plus the new `rg -r` rule.
   The operator's observation on reviewing the proposal: those items are tool usage, not code style, and had been misfiled all along.
2. `AGENTS.md` § Background agent guardrails — added the rule for consuming a subagent report: a universal claim is the one to verify, and a multi-question report should be checked against itself first.
   The first framing proposed ("trust positives, distrust negatives") was imprecise and the operator pushed back on it.
   The real asymmetry is existential vs. universal — a positive finding is usually existential and one cited line settles it, while a negative usually quantifies over configurations the report never enumerates.
   The concrete tell in this session's trace was an evidence-class switch: questions 1 and 2 were answered from the implementation and were right, question 3 was answered from a test fixture (`2835-tools-allowlist-filters-extension-tools.test.ts`) and was wrong, because a test proves only the configuration it sets up.
3. `.pi/skills/testing/SKILL.md` § TDD planning rules — added the rule that a plan measuring "this already works" must name the failing input or reclassify the step as `test:` plus `refactor:`.

[PR 612]: https://github.com/gotgenes/pi-packages/pull/612
