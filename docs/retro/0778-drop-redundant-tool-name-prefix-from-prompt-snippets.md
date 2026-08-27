---
issue: 778
issue_title: "System prompt showing tool names twice"
---

# Retro: #778 — System prompt showing tool names twice

## Stage: Planning (2026-08-19T21:15:16Z)

### Session summary

Confirmed the third-party bug report from `auipga`: Pi's `buildSystemPrompt` always renders `- ${name}: ${snippet}`, so every `promptSnippet` in this monorepo that spells its own tool name produces a doubled label in the `Available tools:` section.
Widened the scope from the labeled package to all three affected packages (11 tools: `pi-colgrep` 1, `pi-github-tools` 7, `pi-subagents` 3) and wrote the cross-package plan `docs/plans/0778-drop-redundant-tool-name-prefix-from-prompt-snippets.md`.

### Observations

- **Evidence, not inference.**
  The prefix was verified in three places before planning: Pi's `main` source (`core/system-prompt.ts:83`), both installed SDK builds in this workspace (`@earendil-works/pi-coding-agent@0.79.1` and `@0.80.5`), and the second render path (`server/create-harness.ts`, which keys snippets by `tool.name` and delegates to the same builder).
  A live session's own system prompt supplied the direct observation (`- subagent: subagent: …` next to a correct `- web_search: …`).
- **The remembered rationale was for a different field.**
  The operator recalled a Pi issue justifying the name prefix; the artifact is `earendil-works/pi#4879` ("Expose promptGuidelines on `ToolInfo`"), which is about `promptGuidelines` bullets being flattened into one *unattributed* `Guidelines:` list.
  That justifies naming the tool inside a guideline, and never applied to `promptSnippet`, which Pi labels itself.
  The distinction is now recorded in the plan's Non-Goals so the next reader does not "restore" the prefix.
- **Provenance of the convention.**
  It traces to `0ad2bbdc` (`pi-colgrep`, [#90]), was copied into `pi-github-tools`, and then into `pi-subagents` via [#152] explicitly as "matching the sibling convention" — no package doc, skill, or ADR ever recorded a reason for it.
- **Guard declined deliberately.**
  A cross-package convention test (assert no snippet starts with `<name>:`) and a `code-design` skill note were both offered and declined; the plan records the resulting coverage gap explicitly (`pi-colgrep` and `pi-github-tools` have no tool-definition tests, so 8 of the 11 edits are review-verified only) so it is not mistaken for an oversight later.
- **Invariants checked, both clear.**
  `pi-permission-system`'s [#437] narrowing parses Pi's rendered `- name:` bullet, never the snippet body; `pi-subagents`' [#640] parent/child prefix invariant is byte-*identity*, not length, and both sides shorten identically.
- **Release shape.**
  Not a roadmap step in any package, so ship independently — but three `fix:` commits, one per package, means three component releases at the next release-PR merge.

## Stage: Implementation — TDD (2026-08-19T21:27:18Z)

### Session summary

Executed all three plan steps: removed the redundant `"<tool_name>: "` prefix from 11 `promptSnippet` literals across `pi-subagents` (3), `pi-github-tools` (7), and `pi-colgrep` (1), landing one `fix:` commit per package.
Only step 1 had a real Red→Green cycle (three exact-string assertions in `pi-subagents`' tool tests went red, then green); steps 2 and 3 have no test surface and were verified by `check`/`lint` plus review against the plan's Design Overview table.
Test count is unchanged at 5218 — no tests were added or removed, three assertion strings were updated in place.

### Observations

- **No deviations from the plan.**
  Every file in Module-Level Changes was touched and nothing else; the predicted "no docs change" held, re-verified independently by the reviewer.
- **Tidy-First assessor: no preparatory tidying warranted.**
  It correctly read the change as 11 isolated string-literal edits with no surrounding friction, and declined a shared `stripToolPrefix`-style helper as new abstraction rather than preparation.
- **Biome reflow happened as the plan predicted.**
  Four github-tools snippets collapsed from a wrapped continuation onto one line (`issue-close.ts`, `release-pr-find.ts`, `release-watch.ts`, and the formatter also tidied `ci-list.ts`), which is why that commit shows 7 insertions against 10 deletions.
  Letting the formatter own the layout kept the diff honest.
- **Coverage gap is by design, not oversight.**
  8 of the 11 edits are in packages with no tool-definition tests (`pi-colgrep`, `pi-github-tools`), a direct consequence of the declined regression guard; the plan and the reviewer both record it explicitly.
- **Pre-completion reviewer: PASS** — all four deterministic checks green, all 11 resulting strings diffed byte-for-byte against the plan's table, and the "no user-facing doc quotes a snippet" claim independently re-verified (only `docs/plans/`, `docs/retro/`, and an unrelated release-please `CHANGELOG.md` entry mention `promptSnippet`).
  No warnings.
- **Release shape at ship time:** three `fix:` commits across three components, so the next release-please PR carries a patch release for each of `pi-subagents`, `pi-github-tools`, and `pi-colgrep`.

## Stage: Final Retrospective (2026-08-19T22:19:13Z)

### Session summary

One continuous session carried issue #778 from planning through TDD to ship: confirmed a third-party bug report, widened it from the single labeled package to all three affected ones, and landed 11 string-literal fixes as three per-package `fix:` commits.
Released `pi-colgrep-v1.5.3`, `pi-github-tools-v4.3.2`, and `pi-subagents-v19.3.4`, all published successfully.
The distinguishing work was archaeological rather than technical — establishing that the convention being removed never had a rationale, and that the rationale the operator remembered governs a different field.

### Observations

#### What went well

1. **The session's own system prompt served as primary evidence.**
   Rather than reasoning about what Pi *would* render, the assembled prompt in context already read `- subagent: subagent: Launch …` next to a correctly-rendered third-party `- web_search: …`.
   That is a reproduction, a control case, and a scope survey in one artifact, available at zero tool cost — and it is exactly the kind of evidence an extension-authoring repo can reach for whenever a change affects prompt assembly.
2. **A half-remembered rationale was resolved to a specific artifact, and disproved.**
   The operator recalled a Pi issue justifying the name prefix.
   It resolved to `earendil-works/pi#4879` ("Expose promptGuidelines on `ToolInfo`"), which concerns `promptGuidelines` bullets being flattened into one *unattributed* `Guidelines:` list — a real constraint, for a different field.
   The distinction now lives in the plan's Non-Goals, so the next reader does not "restore" the prefix on the strength of the same memory.
3. **Verification was redundant by design.**
   The `- ${name}: ${snippet}` render was confirmed in Pi's `main` source, in both installed SDK builds (`0.79.1`, `0.80.5`), and in the second render path (`server/create-harness.ts`), before any claim was written down.
   Checking the installed builds — not just the sibling checkout, which runs ahead of the pinned dependency — is what made the fix safe to ship immediately.
4. **Scope widened on evidence, not on assumption.**
   The issue carried only `pkg:pi-subagents`; a grep for `promptSnippet` across `packages/*/src` found 8 more instances in two other packages, which turned a 3-tool fix into an 11-tool sweep and a three-component release.

#### What caused friction (agent side)

1. `missing-context` — the origin of the convention being removed was not investigated until the operator asked about it.
   The plan-issue template's step 7 covers *introducing* a convention (search siblings, follow the established pattern); the inverse — removing one — has no corresponding step, so the working plan was heading toward the `ask_user` gate with the provenance question unasked.
   Impact: no rework, but the operator supplied context the session should have gathered.
   Self-identified: no — user-prompted.
2. `other` — the rationale hunt spent roughly six exploratory calls (`git log -S` and `git log -L` over `../pi`, two `gh search issues` queries that both returned empty, a `gh issue view 152`, a docs-wide grep) before the operator supplied the exact comment URL, after which two `gh api` calls settled it.
   Impact: ~6 calls of context, no rework; the hunt was bounded and each step was reasonable, but it was searching for something only the operator could name.
3. `other` — during the ship step, a `git log` for the close-comment range was run without its pathspec, dumping ~60 lines of unrelated history across three packages before being redone with `-- packages/<pkg>/`.
   Impact: wasted output, no rework; self-identified immediately.
4. `other` — SHA lengths returned by `git rev-parse` and `release_pr_merge` were re-verified by piping through `wc -c` three separate times.
   The repo's rule is to *resolve* every published SHA with `git rev-parse` rather than retype it, which was already satisfied; counting its characters afterward adds nothing.
   Impact: 3 extra tool calls, no rework.
5. `instruction-violation` — model attribution for the first draft of this retrospective was taken from `env | grep '^PI_'` (`PI_MODEL`, `PI_PROVIDER`, `PI_REASONING_LEVEL`), though the `/retro` prompt names the instrument explicitly: attribute each turn from the inline `[provider/model]` label in an **unfiltered** `read_session` call.
   `PI_MODEL` reports only the session's *current* model, so extrapolating it across the session produced a false claim — that all three stages ran on opus-5, when the ship stage ran entirely on sonnet-5.
   Impact: a factual error landed in a committed, pushed retro and needed a correction commit.
   Self-identified: no — user-caught, by asking why the environment variables were being read at all.
6. `instruction-violation` — the correction itself then reached for `jq` over `$PI_SESSION_FILE` rather than `read_session`, bypassing `pi-session-tools`, the tooling this repo maintains for reading session transcripts.
   Impact: no wrong result (the data matched), but the second failure repeated the shape of the first — an ad-hoc probe in place of the named instrument.
   Self-identified: no — user-caught.

#### What caused friction (user side)

1. **The decisive identifier arrived in the second interjection, not the first.**
   The opening note ("I swear we had some rationale … but I can no longer find the Pi issue") set the hunt going; the follow-up supplying the exact comment URL ended it in two calls.
   Opportunity, not criticism: when the context is a half-remembered artifact, leading with whatever identifier is at hand — URL, issue number, even the repo — converts an unbounded search into a lookup.
   The first note was still valuable: without it, the plan would have shipped without ever asking why the convention existed.

### Diagnostic details

- **Model-performance correlation** — the parent session split across two models: `anthropic/claude-opus-5` for planning and TDD (73 turns, 21:08:11Z–22:06Z) and again for this retrospective (23 turns, from 22:17:44Z), with `anthropic/claude-sonnet-5` for the entire ship stage (29 turns, 22:06:27Z–22:17:38Z — `set_session_name` through the release-CI verification).
  That split is sound: judgment-heavy planning on the stronger model, the procedural ship on the cheaper one.
  The one mismatch is the TDD stage, which ran on opus-5 for 11 mechanical string deletions with no design content.
  Both subagents ran `anthropic/claude-sonnet-5`, appropriately: the `tidy-first-assessor` returned "no preparatory tidying warranted" in 18.5 s / 3 tool uses, and the `pre-completion-reviewer` did judgment-heavy verification in 103.8 s / 21 tool uses, independently re-running all four deterministic gates and diffing all 11 strings against the plan's table.
- **Phantom model switches are real** — the session recorded 6 `model_change` entries, two of them to `opencode-go/deepseek-v4-flash`, which ran **zero** assistant turns.
  Attributing from switch events would have invented two models that never executed anything, which is precisely the failure the `/retro` prompt's unfiltered-read instruction guards against (Refs #737).
  The reliable source is the per-turn `provider`/`model` on each assistant message, read through `pi-session-tools` (`read_session` / `read_session_file`) — the tooling this repo built for it.
  The correction here was made with a raw `jq` query over `$PI_SESSION_FILE`, which reached the same data by the wrong route: it bypasses the transcript rendering the lens is specified against and would drift the moment the session format changes.
- **Escalation-delay tracking** — no sequence exceeded five consecutive calls on the same error; there were no failing-test or lint loops at all, since the implementation was green on first run at every step.
- **Unused-tool detection** — `colgrep` went unused, correctly: every search this session targeted the exact symbol `promptSnippet` or an exact snippet string, which is grep's job per the search decision table.
  An `Explore` subagent for the `../pi` git archaeology is the arguable miss (`AGENTS.md` recommends one for multi-hop traces there), though the evidence that actually settled the question was a GitHub comment, not source.
- **Feedback-loop gap analysis** — no gap.
  The full baseline (`check`, `lint`, `test`, `fallow dead-code`) ran before the first change; each TDD step ran its own package's `vitest` and `check` before committing; the full four-gate suite ran again after the last commit and once more inside the reviewer.

### Changes made

1. `.pi/prompts/plan-issue.md` — appended to step 7 the inverse of the existing introduce-a-convention rule: when a plan *removes* a repo-wide convention, trace its origin with `git log -S` and read the introducing commit's plan and retro first, recording a rationale that governs a different mechanism in Non-Goals.
2. `AGENTS.md` — appended to § Stale in-process extension code: the session's own system prompt is a zero-cost witness for the **published** prompt-assembly behavior, with the caveat that it can never show your uncommitted fix.
3. Corrected this retro's model attribution after the operator questioned the `PI_*` environment-variable read: replaced the "opus-5 for all three stages" claim with per-turn counts, added the phantom-switch finding, and recorded the `instruction-violation` that produced the error.
4. `.pi/prompts/retro.md` — the model-attribution lens now names `pi-session-tools` (`read_session` / `read_session_file`) as the instrument, and rules out both `jq` over `$PI_SESSION_FILE` and `PI_MODEL`/`PI_PROVIDER`.

[#90]: https://github.com/gotgenes/pi-packages/issues/90
[#152]: https://github.com/gotgenes/pi-packages/issues/152
[#437]: https://github.com/gotgenes/pi-packages/issues/437
[#640]: https://github.com/gotgenes/pi-packages/issues/640
