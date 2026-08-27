---
issue: 776
issue_title: "Add CONTRIBUTING.md establishing an issues-first contribution path"
---

# Retro: #776 — Add CONTRIBUTING.md establishing an issues-first contribution path

## Stage: Planning (2026-08-19T17:34:17Z)

### Session summary

Planned a root `CONTRIBUTING.md` establishing an issues-first path, plus two pointers to it (a root README `## Contributing` section and a `contact_links` entry on the issue chooser) and one resolved forward reference in `pi-subagents`' architecture doc.
One clarification gate settled size, candor, README overlap, and wiring together.
Plan committed as `docs/plans/0776-contributing-guide.md` in `141cbd8d`; follow-ups [#781] (pull request template) and [#782] (`CODE_OF_CONDUCT.md`) filed for the two items the issue named as out of scope.

### Observations

- The gate was built directly against [#775]'s two failure modes, both of which apply to this change.
  Size was asked **with** a worked draft at the target length rather than as an abstract preference, and the answer (compact, ~80 lines) is now pinned by a per-section budget table and a `wc -l` ceiling of 95 in the verification steps.
- The operator amended the candor wording at the gate: "may land as a reimplementation" rather than "often lands as".
  The modal form is the whole difference between setting an expectation and warning someone off, and it was worth more than the option label it was attached to.
- Agent disclosure was offered as a candor variant and declined.
  The guide states the reason for rework as "conventions it could not have known about" without describing the maintainer's toolchain.
- The README answers look contradictory and are not: `## Development` is untouched (no setup content moves into the guide, no duplication), while a new three-line `## Contributing` section is added above it.
  Called out explicitly in Non-Goals, since the plan template warns about Module-Level Changes contradicting Non-Goals.
- `.pi/prompts/pr-review.md` turned out to be the internal counterpart of this guide — it already states the reimplement-don't-merge outcome and mandates `Co-authored-by:` plus an `@login` close comment.
  The guide describes the *outcome and the credit*; the prompt owns the *decision procedure*.
  Keeping that split is what lets the two evolve without a sync obligation, which is why cross-linking them was left as a deferred Open Question.
- One live forward reference exists in the repo: `packages/pi-subagents/docs/architecture/architecture.md:60` says the pattern "belongs in `CONTRIBUTING.md`".
  It becomes a pointer in build step 3 — and because that directory **is** in `pi-subagents`' `files` allowlist, the link must be an absolute GitHub URL per [#647].
  The reverse direction is unconstrained: root `CONTRIBUTING.md` ships in no tarball, so its own links stay repo-relative.
- Release framing is unusual and worth recording: every touched path is either root-level or in `exclude-paths`, so this change cuts **no release at all**.
  "Ship independently" here means land and close, with no release-please PR to wait on.
- Deliberately avoided nine `#scope-and-non-goals` anchor links, one per package.
  Linking the README package table once is the [#775] manufactured-link lesson applied preemptively — and it removes nine links that would go stale if a package were ever renamed or retired.
- The issue's measured merge-rate statistics are motivation, not content.
  Recorded as a Non-Goal so the build session does not reach for them when the `## Pull requests` section feels thin.

## Stage: Implementation — Build (2026-08-19T19:35:18Z)

### Session summary

Executed all three build steps: the 42-line `CONTRIBUTING.md`, the two pointers to it (a root README `## Contributing` section and a `contact_links` entry on the issue chooser), and the resolved forward reference in `pi-subagents`' architecture doc.
Commits `f114989d`, `2f7328c9`, `54e21b0a`.
Pre-completion reviewer: PASS.

### Observations

- The shipped guide is **byte-identical to the plan's worked draft** — the reviewer confirmed this with a `diff` returning zero.
  That is the [#775] size lesson working exactly as intended: settling the size at the gate with a real draft left the build step nothing to negotiate, and no section drifted longer under the pressure of writing it.
- Reviewer WARN (non-blocking, planning-artifact only): the plan's per-section line-budget table sums to "~74, hard ceiling 95", while its own worked draft — labeled "the target, not a placeholder" — was already 42 lines.
  The two were never reconciled against each other at planning time.
  Nothing was dropped to reach 42; the arithmetic simply over-counted blank lines and per-section sentences.
  Left the plan uncorrected as a historical record and recorded the discrepancy here instead.
  The transferable lesson is narrow but real: when a plan carries **both** a budget table and a worked example, the example is the binding artifact and the table should be derived from it (`wc -l`), not estimated alongside it.
- The `contact_links` YAML was verified by parsing it with the repo's own `yaml` package rather than by eye.
  Worth doing: the `about:` value contains an em-dash and an apostrophe, and the `url:` value contains an unquoted `https://`, all of which are valid plain scalars but none of which are obvious by inspection.
  The rendered chooser page remains a post-push check.
- The `pi-subagents` pointer is the one link in this change where the form is load-bearing.
  The reviewer independently confirmed `docs/architecture` is in that package's `files` array, which is what makes the absolute URL required rather than stylistic ([#647]).
- `README.md` verification was framed as a scoping assertion and checked as one: `git diff` reports 4 insertions and **0 deletions**, so the Non-Goals claim that `## Development` is untouched is pinned by a number rather than by reading.
- Deliberately did not load the `package-pi-subagents` skill for the one-line prose pointer in that package's architecture doc.
  The edit changes no module, symbol, or boundary — only a forward reference to a file that now exists.
- No `src/`/`test/` files were touched, so Tidy First was skipped per its applicability gate, and `pnpm run test` was not required — the reviewer ran the full suite anyway and it was green.

## Stage: Final Retrospective (2026-08-19T20:09:04Z)

### Session summary

Planned, built, and shipped a root `CONTRIBUTING.md` establishing an issues-first contribution path, in a single session across all three stages (six commits, `141cbd8d`..
`56d6a55e`).
The guide shipped byte-identical to the draft written at the planning gate, the pre-completion reviewer returned PASS, and the change cut no release by design.
Two follow-ups ([#781], [#782]) were filed during planning for the items the issue named as out of scope.

### Observations

#### What went well

1. **[#775]'s retro change fired on its first application, and it is measurable.**
   That session added the size-budget rule to `AGENTS.md` § Clarification gates after shipping nine README sections that ran 29–68 lines and needed two operator-driven revision rounds.
   This session asked size at the gate **with a real draft attached**, and the file that shipped is byte-identical to that draft — the reviewer confirmed it with a `diff` returning zero.
   Zero revision rounds followed.
   That is the retro loop closing on itself rather than a rule being written and forgotten.
2. **Reading this repo's own workflow prompt shaped the design.**
   `.pi/prompts/pr-review.md` turned out to be the internal counterpart of the guide being written — it already mandates the `Co-authored-by:` trailer and the `@login` close comment, and already states that the preferred outcome is adopt-and-reimplement rather than merge.
   Finding it produced the split that keeps the two in sync without a sync obligation: the guide owns the **outcome and the credit**, the prompt owns the **decision procedure**.
   Neither the issue nor the plan template pointed at that file; it surfaced from a `grep` for `Co-authored-by` across `AGENTS.md` and `.pi/prompts/`.
3. **The subagent model alias resolved correctly, verified rather than assumed.**
   `AGENTS.md` warns that a model ID absent from the registry silently falls back to the parent session's model.
   The task session file records `"modelId":"claude-sonnet-5"`, confirming the `pre-completion-reviewer`'s frontmatter alias took effect and the checklist pass did not silently run on the parent's `claude-opus-5`.
4. **The `contact_links` YAML was parsed, not eyeballed.**
   The `about:` value carries an em-dash and an apostrophe and the `url:` value an unquoted `https://` — all valid plain scalars, none obvious by inspection.
   Parsing it with the repo's own `yaml` package turned a judgment call into a check.

#### What caused friction (agent side)

1. `other` — **BSD `grep` silently dropped half an alternation during link verification.**
   `grep -n '^## Packages$\|^## Development$' README.md` returned only `## Development` and exited 0.
   BRE alternation `\|` is a GNU extension that this macOS `grep` (BSD 2.6.0) does not honor; reproduced deterministically after the fact.
   The failure mode is the dangerous one — not an error, a silent partial match with a success exit code — and it landed on an anchor-existence check, where a false negative reads as "the heading you are linking to does not exist."
   Impact: two extra tool calls to recover (`od -c` on the line, then a plain `grep -n '^## '`), no rework, but a verification step briefly reported the wrong answer.
2. `other` — **a planning artifact contradicted itself: budget table ~74 lines, worked draft 42.**
   The plan carried both a per-section line-budget table summing to "~74, hard ceiling 95" and a worked draft labeled "the target, not a placeholder".
   The two were never reconciled; the table over-counted blank lines and per-section sentences by 76%.
   Caught by the `pre-completion-reviewer`, not by me, and only because it ran `diff` between the draft and the shipped file.
   Impact: no rework — the shipped file was correct, and nothing was dropped to reach 42.
   The latent risk is the inverse of [#775]'s: a budget written **above** the real draft is an instruction to pad, and a different build session might have taken it as one.
3. `other` — **twice distrusted correct deterministic tool output.**
   `git rev-parse HEAD` returned a valid 40-char SHA and was re-checked with `wc -c`; three labeled `git rev-parse` outputs were read as "concatenated together" and re-run with `echo` labels.
   Impact: roughly three wasted tool calls in the ship stage, no rework.
   Both instances were self-caught within one call.

#### What caused friction (user side)

1. Nothing obstructive.
   The single clarification gate was answered in full, and the one amendment the operator made to it — "may land as a reimplementation" in place of "often lands as" — was worth more than the option it was attached to.
   The modal form is the entire difference between setting an expectation and warning someone off, and it went straight into the shipped guide unchanged.
2. Worth naming for symmetry with [#775]: that session's retro faulted the planning gate for asking placement without a size budget.
   This session's gate asked size, candor, README overlap, and wiring together and needed no follow-up round — so the correction held, and there is no new user-side gap to report.

### Diagnostic details

- **Model-performance correlation** — the session ran on `anthropic/claude-opus-5` at `high` reasoning across planning, build, and ship.
  One subagent was dispatched: `pre-completion-reviewer` on `anthropic/claude-sonnet-5` (confirmed in the task session file, not merely from frontmatter), which is the appropriate weight for a deterministic-checks-plus-checklist pass and is the dispatch this repo already tunes for.
  No mismatch in either direction.
  Notably the reviewer earned its cost here: the budget-versus-draft contradiction was found by an agent with no planning bias, exactly the case the fresh-context dispatch exists for.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest run on a single confusion was two consecutive calls (the `grep` alternation, and each distrust-of-output instance), well under the five-call threshold.
- **Unused-tool detection** — no finding.
  `colgrep` was never dispatched, which is correct for this change: every target file was known by name from the issue and [#775]'s artifacts, so exact `grep` was the right instrument throughout.
- **Feedback-loop gap analysis** — verification was incremental, not terminal.
  `pnpm run check` and `pnpm run lint` ran at baseline; `rumdl check` ran before each of the five doc commits; `pnpm run lint` ran after each of the three build steps; the YAML was parsed at the moment it was written; `pnpm run lint` and `pnpm fallow dead-code` ran pre-push; the reviewer ran the full suite across all nine packages.
  No gap to flag.

### Changes made

1. `docs/retro/0776-contributing-guide.md` — this Final Retrospective entry.
   No other file was changed.

Both candidate rule changes were surfaced with proposed text and **declined** by the operator, so they are recorded here as findings rather than promoted to project-wide rules:

1. `AGENTS.md` § Shell and search — a rule that BRE alternation `\|` is a GNU extension this macOS `grep` (BSD 2.6.0) does not honor, silently matching one branch and exiting 0.
   The behavior is real and reproducible; a future session that hits it can cite this entry.
2. `AGENTS.md` § Clarification gates — a clause deriving a plan's size budget from its worked example (`wc -l`) instead of estimating it alongside.
   The [#775] rule that produced this session's clean result stands unamended.

Also considered and not proposed: a `/ship-issue` step 4b note for package-less changes (the existing paragraph already answered it), a rule against re-verifying deterministic tool output (unactionable as phrased), a rule to parse rather than eyeball config files (one data point), and a skill-loading proportionality note (rule-bloat for a rare case).

[#647]: https://github.com/gotgenes/pi-packages/issues/647
[#775]: https://github.com/gotgenes/pi-packages/issues/775
[#781]: https://github.com/gotgenes/pi-packages/issues/781
[#782]: https://github.com/gotgenes/pi-packages/issues/782
