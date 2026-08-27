---
issue: 807
issue_title: "pi-permission-system: attribute bash path-token effects from syntax proofs and a pure-reader core"
---

# Retro: #807 — pi-permission-system: attribute bash path-token effects from syntax proofs and a pure-reader core

## Stage: Planning (2026-08-25T16:52:00Z)

### Session summary

Planned Phase 14 Step 2 — per-token effect attribution from redirect syntax proofs and a 22-word frozen pure-reader core — as `docs/plans/0807-bash-effect-attribution.md`, nine TDD cycles.
One clarification gate settled the core's breadth, its retraction guards, and how narrow a bash session approval becomes; the operator's note on the third answer produced [#810], filed and adopted as Phase 14 Step 10.
Two facts were measured rather than argued: the core's relief ceiling, from the local review log, and the parse-tree shapes the syntax proofs read.

### Observations

**The gate was grounded on a measurement, and the measurement is what chose the option.**
A marginal-contribution scan over 803 bash asks (229 recent) showed relief concentrated in three words — `echo`, `find`, `diff` take the recent figure from 5.7% to 27.5% — while the next ~40 audited coreutils add about one point.
Without that table the "broad audited core" option reads strictly better than the focused one; with it, the focused core is obviously right and the broad one is 40 extra audit liabilities for a rounding error.
The script ships as `scripts/measure-core-coverage.mjs` in the docs cycle, per ADR 0013's own rule that a durable number's instrument is committed beside it.

**The issue's single-module sketch splits in two, for a layering reason.**
Issue [#807] puts the `Effect` type in `src/access-intent/bash/command-effects.ts`.
But `path-surfaces.ts` needs the effect type to expose `capabilitySurfaceForEffect`, and a core-layer vocabulary module importing from the `bash/` subtree is the same violation that relocated `pickMostRestrictive` out of `handlers/gates/` in [#806].
So the vocabulary lands in `src/access-intent/effect.ts` and the bash-specific proofs (roster, guards, redirect table) stay in `command-effects.ts`.
The roadmap's metric row greps for the file name and still passes.

**`EffectSource` gained a fourth value the ADR implies but does not name.**
`"retracted"` is distinct from `"unproven"` because "nobody claimed anything about `pnpm`" and "`find` is core but `-delete` withdrew the claim" are different diagnoses, and ADR 0013 §7 explicitly wants the second as a blame line.
It costs one union member and makes the two new log fields self-explanatory.

**Dedup folds rather than splits, and the ADR is what makes that honest.**
Keying the dedup on `(path, effect)` would split `cat ~/a > ~/a` into two entries and show the path twice in the prompt.
Merging instead — two disagreeing proven effects fall to unproven — routes identically and keeps the entry count unchanged, and ADR 0013's 2026-08-25 amendment states outright that proven-both and unproven-at-all are one mechanism, not two.
So the fold is the ADR's own reading rather than a convenience.

**The roadmap's assigned tidy-first prep is dropped, for the second consecutive step.**
Phase 14 assigns the `runDescriptor` split to this step because "this change extends exactly that dispatch".
It does not: provenance rides in each gate's `logContext`, which the runner already spreads, so `runner.ts` has zero diff and Tidy First's own rule excludes it.
This is the identical call [#806] made about `selectUncoveredPathCandidates`, which suggests the roadmap's prep assignments were made against a gate-side design that neither step delivered.

**The change is verifiably non-breaking, and the check was cheap.**
`pnpm view` reports 27.0.1 published, and `git show pi-permission-system-v27.0.1:…/path-surfaces.ts` has no directional surfaces — Step 1 is unreleased.
So no released config can name `path_read`, and a bare-family config expands to identical rule lists on both members, making a read-routed answer bit-identical.
Two commands settled what would otherwise have been a paragraph of reasoning.

**The [#806] fixture work is what keeps the test migration to four files.**
`makeSurfaceCheck` has answered a family key for its directional members since [#806], so every handler test that declares `external_directory: deny` keeps working when the gate asks for `external_directory_read`.
Only the three files that assert *token shapes* (`token-collection.test.ts`, `program.test.ts`) or *surface names* (the two bash gate tests) migrate.

**One invariant citation was checked by opening the file, not by memory.**
The plan pins the forwarded-child deny on the `ServingPolicy resolves a forwarded request against real recorded authority` block — the one block in `test/authority/forwarded-request-server.test.ts` that rebuilds the real wiring; every other test in that file stubs `policy`.
That is exactly the defect [#806]'s pre-completion review caught in its own plan, and the `/plan-issue` template now carries the rule.

## Stage: Implementation — TDD (2026-08-27T00:50:41Z)

### Session summary

Implemented all nine TDD cycles plus one Tidy-First preparatory commit, landing per-token effect attribution from redirect syntax proofs and a frozen pure-reader command core, and routing a proven-effect bash token to its directional surface in both path gates.
The suite went 3337 → 3501 tests (+164) across 13 commits.
Pre-completion review returned FAIL on the first pass with two fail-opens in the roster, which a `fix:` commit closed; the re-review returned PASS.

### Observations

**The pre-completion reviewer earned its keep, and the finding was in the plan, not the code.**
It found two commands whose write-destination token could be attributed `read`: `find -fprint0` was missing from the retraction guard (the plan's guard list named `-fprint`/`-fprintf`/`-fls` but not `-fprint0`), and `file` was admitted to the roster unguarded even though `-C`/`--compile` writes a `magic.mgc` file.
Both defects were transcribed faithfully from the plan — the implementation did exactly what it was told.
The roster's "structural bar" is stated as prose in the plan and re-stated in the module, and prose does not check itself; only someone re-deriving each word against a real man page catches a word that fails it.
That is a good argument for briefing the reviewer to **re-derive rather than verify**, which this dispatch did explicitly and which produced both findings.

**Dropping `file` beat guarding it, and the measurement is what settled it.**
The reviewer offered both remedies.
`file` appears in one ask out of 804, and removing it moved neither published figure, so a fourth guard entry would have bought nothing while adding an option list to keep correct.
The guard table stays at three words, all chosen because their write options spell identically in GNU and BSD.

**Committing the instrument falsified the plan's own number, which is the point of committing it.**
The plan's headline relief figure (27.9% recent) came from a scan that never applied the retraction guards it described in the same table.
Re-running the committed `scripts/measure-core-coverage.mjs` with guards applied gives 23.0%; the marginal table reproduces row for row with the guards switched **off**, which is how the gap was localized to `find` in one run.
All 14 recent asks the guards exclude are `find … -exec <core reader> {} +`, already floored to `ask` by the indirection wrapper — so the guard forfeits no reachable relief and those asks are [#803]'s population, not this step's loss.
The correction landed as a note appended to the plan rather than a rewrite, per the operator's call.

**The plan's Goal hid a user-visible cost that only the suite surfaced.**
"Narrow a bash session approval to the direction the gate proved" reads as pure tightening, but it means a write grant no longer silences a later read of the same path — `echo hi > out.txt` then `cat out.txt` now asks twice.
Two tests in `external-directory-session-dedup.test.ts` failed and were the only warning.
The operator kept the narrowing (it matches the direction the prompt named, and least privilege is the package's stated default) and the residual became [#813], adopted as Phase 14 Step 11.
A plan Goal phrased as a tightening deserves an explicit "and here is what stops working" line.

**Mutation testing was worth the two minutes on cycle 8.**
All ten cross-layer invariant pins passed on first run, which the testing skill flags as either an invariant pin or a broken probe.
Forcing `capabilitySurfaceForEffect` to the bare family failed exactly the five direction-sensitive cases; forcing `proveCommandEffect` to prove a read for every word failed exactly the three fail-closed cases.
That is a cheap, decisive answer to "is this test doing anything", and it also proved the doc-roster parity test live.

**The Tidy-First rename was right but under-scoped, and the full suite caught it.**
The assessor's one recommendation — split the `externalPaths` → `externalAccesses` rename out of the reshape — was correct and did shrink the reshape.
But the rename commit only ran the four files the grep found, and `tool-call-gate-pipeline.test.ts` builds `BashProgram` mocks with `externalPaths:` as an **object key**, which no call-site grep sees.
The prep commit was therefore red for one file until cycle 5.
A mechanical rename of a method should run the full package suite, not the files its call-site grep matched — exactly the producer-vs-assertion hazard `AGENTS.md` names.

**`git add -A` under `--amend` swallowed an in-flight cycle.**
Amending the roadmap-disposition commit with `git add -A` staged eight uncommitted cycle-7 files into it.
`git reset --mixed HEAD~1` plus a pathspec-scoped re-commit split it back cleanly, but the safe form was `git commit --amend -- <path>` from the start.

#### Deferred tidyings

- `src/handlers/gates/bash-path.ts` and `src/handlers/gates/bash-external-directory.ts` — the assessor declined extracting a shared "resolve candidates, pick worst" loop.
  They already share the real primitives (`pickMostRestrictive`, `resolveExternalDirectoryPolicy`), and their surrounding loops differ load-bearingly: early-break single-worst versus full-aggregate multi-pattern.
  Unifying them now would need a discriminator flag.
- `src/access-intent/bash/wrapper-analysis.ts` — declined sharing code with the new `command-effects.ts`.
  Both are pure word-based classifiers, but they classify different things (wrapper floor versus filesystem effect), and the change does not touch `wrapper-analysis.ts`.
  Worth revisiting when [#803] gives both modules a reason to read the same roster.

### Reviewer verdict

Pre-completion reviewer: **FAIL** on the first pass (two fail-opens: `find -fprint0` missing from the guard, `file` failing the roster bar), **PASS** on re-review after `50b42101`.
The re-review independently walked all 21 roster words and all three guard lists for further fail-opens and found none, checked the new abbreviation matcher for regressions, and re-ran the measurement.

## Stage: Final Retrospective (2026-08-27T01:02:53Z)

### Session summary

Shipped Phase 14 Step 2 across three stages: a plan built on a measured relief ceiling, nine TDD cycles plus a Tidy-First prep commit (3337 → 3501 tests, 13 commits), and a ship that closed the issue while deferring the release per the plan's `mid-batch — defer` marker.
The dominant theme across all three stages is **a plan's claims not surviving contact**: its measured figure was falsified by the instrument it asked to be committed, its roster shipped two fail-opens, and one of its Goals hid a user-visible regression.
Every one of those was caught by a mechanism the workflow already had — the committed instrument, the pre-completion reviewer, and the existing suite — which is the session's most useful signal.

### Observations

#### What went well

- **A `sonnet-5` reviewer out-audited an `opus-5` implementer on a security roster.**
  The `pre-completion-reviewer` runs on `anthropic/claude-sonnet-5`; the TDD stage ran on `anthropic/claude-opus-5`.
  The weaker model found two genuine fail-opens (`find -fprint0` missing from the retraction guard, `file -C` writing a `magic.mgc` file) that the stronger one had transcribed straight from the plan.
  The difference was not capability but **posture**: the dispatch brief said "re-derive rather than accept my summary" and named the words to scrutinize, and the reviewer went to the local man pages.
  Fresh context plus an adversarial mandate beat raw model strength on this task.
- **Committing the measurement instrument falsified the number it was committed to support.**
  ADR 0013's rule that a durable figure ships beside its script paid off within one cycle: re-running `scripts/measure-core-coverage.mjs` gave 23.0% recent against the plan's 27.9%, and switching the guards off reproduced the plan's marginal table row for row — localizing the entire gap to `find`'s guard in a single run.
  A number defended by prose would have shipped wrong.
- **Mutation testing settled "is this pin real" in two minutes.**
  All ten cross-layer pins in `test/bash-effect-invariants.test.ts` passed on first run.
  Forcing `capabilitySurfaceForEffect` to the bare family failed exactly the five direction-sensitive cases; forcing `proveCommandEffect` to prove a read for every word failed exactly the three fail-closed cases; the doc-roster parity test was proved live the same way.
  The partition was clean enough to be self-documenting.
- **The `mid-batch — defer` marker worked exactly as designed.**
  `/ship-issue` read it before any irreversible action, asked once, and the deferral held through close — the issue closed on `main` with release-please PR #809 left open for the [#803] batch tail.

#### What caused friction (agent side)

- `missing-context` — the 22-word roster and the three retraction guard lists were transcribed from the plan's prose without re-deriving any word against its real option surface, in a package where a wrong admission is a fail-open.
  `man file` and `man find` were one call away and were never made until the reviewer forced it.
  Impact: two fail-opens shipped into a security boundary and survived nine TDD cycles; one extra `fix:` commit (`50b42101`), one extra full review round, and roster-count corrections across seven files (module, test, `docs/configuration.md`, `README.md`, package skill, architecture doc, instrument).
- `instruction-violation` (self-identified, late) — the Tidy-First prep commit `85e3603a` was verified against only the four files its call-site grep matched, not the package suite.
  `tool-call-gate-pipeline.test.ts` builds `BashProgram` mocks with `externalPaths:` as an **object key**, which the `\.externalPaths\(` grep cannot see.
  The `tidy-first` skill requires each prep commit to leave the tree green; it did not.
  Impact: the prep commit was red for one file from cycle 0 until cycle 5 caught it at turn 88 — no rework beyond the fix cycle 5 needed anyway, but the commit is wrong in history.
- `other` (git hygiene) — `git add -A && git commit --amend` on the roadmap-disposition commit swept eight uncommitted cycle-7 files into it.
  Impact: `git reset --mixed HEAD~1` plus a pathspec-scoped re-commit, ~3 tool calls, no lasting damage.
  `AGENTS.md` carries the pathspec rule for `git rm` deletions but nothing about `git add -A` before an amend.
- `instruction-violation` (self-identified) — three `Edit` calls failed on `oldText` mismatch (turns 43, 59, 220), each on a region either `pi-autoformat` had reflowed or a decorative `─` rule line.
  `AGENTS.md` names both hazards and prescribes re-reading a just-edited region before matching against it.
  Impact: ~6 extra tool calls; no rework.

#### What caused friction (user side)

- The roadmap-fit disposition for [#813] was answered "fold into Step 10" and reversed one turn later to "make it a new step."
  The reversal cost a revert plus a rewrite of the Phase 14 step list, diagram, tracks, and release batches (~10 tool calls), and the `git add -A` amend mishap happened inside that rework.
  Framed as opportunity rather than criticism: my option list marked *defer to Phase 15* as recommended while the operator's consistent preference was clearly "inside Phase 14" — my recommendation was the outlier, so the gate spent its framing budget on the wrong axis.
  A gate whose recommendation is rejected twice on the same object is a signal to re-derive the axis, not to re-recommend along it.

### Diagnostic details

- **Model-performance correlation** — TDD stage on `anthropic/claude-opus-5` (judgment-heavy: layering decisions, the dedup fold, two clarification gates) and ship stage on `anthropic/claude-sonnet-5` (procedural checklist, executed clean on the first pass including SHA re-verification and correct defer handling).
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer` ×2) ran on `anthropic/claude-sonnet-5` per their frontmatter.
  No mismatch: the cheaper model handled the mechanical stage and the reviewer's fresh-context audit, and it outperformed the expensive model on the audit specifically.
- **Escalation-delay tracking** — no `rabbit-hole` friction points, and no sequence exceeded 5 consecutive tool calls on one error.
  The longest investigation (the measurement discrepancy, turns 190–196, 7 calls) advanced on every call and produced a durable correction, so it is investigation rather than thrash.
- **Unused-tool detection** — for the `missing-context` roster defect, the unused tool was `man` itself, plus `source_check`, which was eventually used exactly once (to confirm GNU `find -fprint0`) *after* the reviewer flagged it.
  A roster of 22 externally-defined command words in a permission boundary warranted that verification up front.
- **Feedback-loop gap analysis** — verification was incremental and dense: `check`/`lint`/scoped `vitest` after every cycle, full package suite at cycles 5, 6, 7, 8, and 9, `fallow dead-code` at cycle 9.
  The one gap is the Tidy-First prep commit above, which ran a 4-file suite instead of the package suite.

### Changes made

1. `AGENTS.md` — appended to the scripted-bulk-edit block: a scripted rename is verified by the **full package suite**, not the files its own grep matched, because a mock producer spells the symbol as an object key that a call-site grep cannot see.
2. `AGENTS.md` — added to "Reading this repo's own artifacts": a plan's enumerated **external** facts (a command's options, an API surface, a spec's values) are a lead, not a citation — verify each against the real surface before it lands in a security boundary.
   This generalizes the section's existing plan-Non-Goal rule from this repo's artifacts to the outside world a plan quotes.
3. `.pi/skills/testing/SKILL.md` — appended to the invariant-pin-vs-broken-probe rule: decide by mutation — break the code the pin covers and confirm the pin fails.

### Follow-ups recorded, not implemented

1. A `/plan-issue` rule that a Goal phrased as a tightening must name what stops working.
   The session-approval narrowing is the evidence, but it is one instance and rewriting a prompt's scope exceeds a retro's budget — file an issue and run `/plan-issue` if it recurs.
2. A rule that a plan's measured figure must come from an instrument implementing the design it measures.
   Same failure class as change 2 above, approached from the measurement side; folded in rather than stacked, to avoid two rules for one lesson.
3. Declined during the proposal gate: a rule against `git add -A` before `git commit --amend` (it swept eight in-flight files into the disposition commit this session).
   The mishap cost one `reset --mixed` and a pathspec re-commit.

[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#806]: https://github.com/gotgenes/pi-packages/issues/806
[#810]: https://github.com/gotgenes/pi-packages/issues/810
[#813]: https://github.com/gotgenes/pi-packages/issues/813
