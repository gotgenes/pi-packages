---
issue: 817
issue_title: "Ship packages independently with release-please separate-pull-requests"
---

# Retro: #817 — Ship packages independently with release-please separate-pull-requests

## Stage: Planning (2026-08-27T19:26:35Z)

### Session summary

Planned the flip to `separate-pull-requests: true` plus the tooling and prose changes it forces.
The plan lives at `packages/pi-github-tools/docs/plans/0817-separate-release-pull-requests.md` — single-package, because `pi-github-tools` is the only package whose code changes; the other touched paths (`release-please-config.json`, `.pi/prompts/`, `AGENTS.md`, root `README.md`) are repo-root and attributed to no component.
Six TDD steps: three code commits, a prompt/`AGENTS.md` commit, the config flip, and a package-docs commit deliberately held back as a canary on a second push.

### Observations

- **The issue's own risk assessment needed correcting.**
  The body treats [googleapis/release-please#2773](https://github.com/googleapis/release-please/issues/2773) as version-distant ("filed against v17.6.0; latest is v17.11.2").
  Resolving what the action actually ships shows otherwise: `googleapis/release-please-action@v5` → tag `v5.0.0`, whose `package-lock.json` pins `release-please` at **17.6.0** — the exact reported version, with the report still open and uncommented.
  Its trigger (a second push touching a component that already has an open release PR) is this repo's normal cadence, and it fires after `createReleases()`, so it can strand a publish via the [#646] cascade.
  That finding is what turned "flip it" into "flip it behind a canary with a written rollback".
- **Branch matching over title matching.**
  Verified from release-please source rather than inferred: `src/util/branch-name.ts` gives `release-please--branches--main--components--<component>`, and `src/util/pull-request-title.ts` gives the default `chore${scope}: release${component} ${version}`.
  Matching the branch suffix is exact; matching the title would mean reimplementing release-please's pattern parser.
- **A live defect found in the function the change opens.**
  `watchRelease` derives `version:` as `tag.replace(/^v/, "")`, which leaves a component tag whole — the tool reports `version: pi-github-tools-v4.3.2` today.
  Planned as its own `fix:` step rather than folded into the component work, since it changes observable output for a state that already exists.
- **Deliberate asymmetry between the two tools.**
  `findReleasePR` refuses to guess (`ambiguous:`) when the component is omitted and several PRs are open; `watchRelease` keeps its last-tag fallback.
  Reason, measured rather than argued: `git tag --points-at pi-github-tools-v4.3.2` returns three tags, so a multi-tag HEAD is the *normal* combined-PR state and refusing there would regress a consumer who has not flipped, whereas several open release PRs simply cannot occur for them.
  This is what keeps the whole change non-breaking.
- **The filter deliberately runs in TypeScript, not in git.**
  Switching to `git tag --list '<component>-v*'` would have voided the three `toHaveBeenNthCalledWith` git-args assertions in `test/lib/release.test.ts` that pin `docs/plans/0005-abort-signal-threading.md`'s invariant.
  Filtering over the unchanged `git tag --points-at HEAD` output keeps them as guards.
- **Clean state to flip into.**
  No open `autorelease: pending` PR at planning time, and every post-tag commit per component sits in `exclude-paths` — so nothing pending gets orphaned.
  The plan re-checks this immediately before the flip step.
- **Prerequisite confirmed landed.**
  [#816] is closed and `scripts/release-baseline-sha.sh` floors at the oldest component's release, which is the hazard separate PRs would otherwise make routine.
- **Historical curiosity.**
  `10f5e764` is a merge of `release-please--branches--main--components--pi-github-tools` from 2026-05-14, so a component-scoped release PR has merged in this repo before — though `git log -S'separate-pull-requests'` finds no config history, so that came from a different early setup.
- **No follow-up issues filed.**
  The Open Questions are empirical observations the canary answers, not deferred work.
- **Two staleness hazards for the next stages.**
  The implementation session must restart Pi before shipping (it will hold the pre-edit `release_pr_find`), and after step 4 the expanded `/ship-issue` body is a pre-edit snapshot — the on-disk file is authoritative.

## Stage: Implementation — TDD (2026-08-27T19:57:21Z)

### Session summary

Landed all six planned TDD steps plus one preparatory tidying and two review-driven fixes — nine commits.
`release_pr_find` and `release_watch` now select by component, `release_watch` reports a bare version, and `release-please-config.json` sets `separate-pull-requests: true`.
`pi-github-tools` went from 162 to 178 tests; `check`, root `lint`, the full 5497-test suite, and `fallow dead-code` are all green.

### Observations

- **Tidy First landed one commit.**
  The assessor recommended a `releasePR()` fixture builder for the `findReleasePR` tests and explicitly declined the `while (true)` loop extraction it was asked about — its reasoning was that the block to extract is exactly the block the feature step rewrites, so extracting first relocates the diff rather than shrinking it.
  That judgment held up; the builder paid for itself across six new arrangements.
- **A deliberate asymmetry between the two tools survived review.**
  `findReleasePR` refuses to guess (`ambiguous:`) when no component is passed and several PRs are open; `watchRelease` keeps its last-tag fallback.
  The reason is measured, not stylistic: a multi-tag HEAD is the normal combined-PR state, so refusing there would regress a consumer still on a shared release PR, whereas several open release PRs cannot occur for them.
  This is what keeps the whole change non-breaking.
- **The filter deliberately runs in TypeScript rather than in git.**
  Narrowing to `git tag --list '<component>-v*'` would have voided the three `toHaveBeenNthCalledWith` git-args assertions that pin `0005-abort-signal-threading.md`'s invariant.
  A test asserting the git commands are unchanged was added and passed during Red — an invariant pin, confirmed not a broken probe.
- **The reviewer caught a latent regex trap the plan did not anticipate.**
  `versionOf`'s first regex matched the *leftmost* `-v`, so a component whose own name looked versioned would report the component's digits (`pi-v8-v1.0.0` → `8-v1.0.0`).
  Not live — no component has a `-v<digit>` substring, and both regexes agree on all 347 real tags — but fixed to a greedy `^(?:.*-)?v` split at the last separator.
- **The reviewer also found a real prompt gap.**
  The ship and land prompts told the agent to stop when a release PR bumps more than one package, which misfires on `findReleasePR`'s combined-PR fallback — exactly the rollback state `AGENTS.md` documents.
  Both now read the new `component:` line to decide which check applies.
  Worth noting that this gap existed *because* the fallback was added; the plan described the fallback and the stop rule in separate sections and never crossed them.
- **Two-push canary is deliberate and must survive into the ship stage.**
  Push 1 ends at `458389bd` (the config flip) and creates the component release PR; push 2 carries the docs and fix commits and exercises release-please's PR-**update** path, where [googleapis/release-please#2773](https://github.com/googleapis/release-please/issues/2773) reports a 422.
  A single push would create the PR and never test the update path.
- **Preconditions verified before the flip rather than assumed.**
  No open `autorelease: pending` PR to orphan, `scripts/release-baseline-sha.sh` prints an unchanged floor, and `separate-pull-requests` confirmed a valid boolean in release-please's published schema.
- **Pre-completion reviewer: WARN → PASS on re-review.**
  First round raised three findings (the regex trap, the prompt gap, and a Compatibility-table imprecision in the plan); all three were fixed in `e7547322`, and the re-review re-derived each independently — including running both regexes against all 347 real tags — before passing.
  One carried-forward wording nit was folded in as `94e6c97c`.

#### Deferred tidyings

- `packages/pi-github-tools/test/lib/release.test.ts` — the `mergeReleasePR` block repeats the `chore(main): release 1.2.0` title literal roughly fifteen times over a differently-shaped `PRState` fixture.
  Real duplication, but outside this change's boundary; the assessor declined it as scope creep.

## Stage: Final Retrospective (2026-08-27T20:42:19Z)

### Session summary

Planning, TDD, and ship ran end to end in a single session, landing `separate-pull-requests: true` plus component selection in `release_pr_find` and `release_watch`, and releasing `pi-github-tools@4.4.0`.
Ten commits; `pi-github-tools` went from 162 to 178 tests; the pre-completion reviewer went WARN then PASS.
The plan's two-push canary on release-please's PR-update path executed as designed and passed, answering the issue's open question empirically.

### Observations

#### What went well

- **A plan-mandated deviation survived two stage boundaries and a model change.**
  The two-push canary was invented at planning (opus-5), carried in the TDD stage note, and executed at ship — where the running model was sonnet-5 and `/ship-issue`'s own step 3 says "`git push`", singular.
  The ship stage read the breadcrumb, surfaced the deviation before any git action, and split the push.
  This is the retro-breadcrumb mechanism doing the thing it exists for, across a model switch, without the operator restating it.
- **The reviewer's re-derivation mandate earned its keep.**
  The dispatch prompt said "do not take my word on any of the following; verify each against the code and the repo, and enumerate your own candidate inputs rather than only the ones the tests cover."
  It returned three findings, two of which no test could have caught, and on re-review it re-derived the regex fix against all 347 real tags rather than accepting the claim.
  `AGENTS.md` § Background agent guardrails prescribes exactly this ("hand a reviewer the raw source and a mandate to re-derive, not your tables"); this is a clean instance of it working.
- **Fact-checking the issue's own risk assessment changed the plan's shape.**
  The issue framed [googleapis/release-please#2773](https://github.com/googleapis/release-please/issues/2773) as version-distant — "filed against v17.6.0; latest is v17.11.2."
  Resolving what the action actually ships (`release-please-action@v5` → tag `v5.0.0` → `package-lock.json` pins `release-please` 17.6.0) inverted that: the pinned version *is* the reported one.
  That single lookup turned "flip the config" into "flip it behind a canary with a written rollback," which is the shape that shipped.

#### What caused friction (agent side)

- `premature-convergence` — the `versionOf` regex.
  The plan sketched `/(?:^|-)v(?<version>\d[\w.+-]*)$/` and explicitly hedged "I'll present it as a shape and let TDD settle exact regex."
  TDD did not settle it — it pinned exactly the four cases the plan had enumerated and shipped the plan's literal pattern.
  The reviewer enumerated its own inputs and found `pi-v8-v1.0.0` → `8-v1.0.0`, a leftmost-match split.
  Impact: one extra `fix:` commit (`e7547322`); latent rather than live, since no component name contains `-v<digit>`.
  The plan's enumerated test cases became the ceiling instead of the floor.
- `missing-context` — the combined-PR fallback and the wrong-PR stop rule were written in the same change and never crossed.
  The plan's Design Overview added a fallback where a requested component resolves to a combined PR, and the same change wrote "an unexpected bump means you have the wrong PR — stop rather than merge it" into `.pi/prompts/ship-issue.md` §6.3.
  A combined PR bumps every package by design, so the stop rule would have misfired on the fallback — reachable only during the rollback `AGENTS.md` documents.
  Impact: folded into `e7547322`; no code rework.
- `other` (plan-artifact drift) — the plan's Compatibility table went stale against the code the same plan produced.
  It listed "Combined PR, no component passed" as unchanged, but the shipped `formatReleasePR` emits `component: (none)` on **every** success block, and `versionOf` changed the `version:` line for every component-scoped tag.
  Impact: table amended in `e7547322`; caught by the reviewer, not by any gate.
- `other` (tool-use error) — an `Edit` on `packages/pi-github-tools/src/tools/release-watch.ts` truncated mid-string-literal, leaving an unterminated string and five parse errors.
  `pi-autoformat`'s biome run surfaced it immediately; recovered by rewriting the file with `Write`.
  Impact: two extra tool calls, no rework.
  Self-identified.
- `other` (prompt defect — the agent complied correctly) — `/ship-issue` step 5's close-comment range is derived from the package tag with no scoping.
  `git log --oneline pi-github-tools-v4.3.2..HEAD` returned **165 commits spanning 32 distinct issues**; the issue's own range (`284c4c3a^..HEAD`) is **13**.
  Step 4b's command carries a path-scoping warning for exactly this hazard; step 5's does not, and step 5's is the one that dumped everything.
  Impact: ~165 lines of wasted context, then a manual re-scope to `284c4c3a..HEAD` to run the stacked-work scan.
  No rework.
  Separate-pull-requests makes this strictly worse going forward: packages now release on independent cadences, so a deferred package's tag drifts arbitrarily far from `main`.

#### What caused friction (user side)

None identified.
The operator answered one `ask_user` gate at planning time (accepting all three recommended options) and made zero corrections across all three stages.
Worth naming as a structural observation rather than a criticism: the entire quality load was carried by automated gates — the pre-completion reviewer, `pi-autoformat`/biome, and the CI runs.
That worked here, and it concentrates risk on the reviewer dispatch being well-specified; the three findings it returned were all things no deterministic gate would have caught.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5`, ship on `anthropic/claude-sonnet-5`, retro on `anthropic/claude-opus-5`.
  The split matches the work: judgment-heavy design, regex authoring, and the `ask_user` gate on opus; procedural push/CI-watch/close on sonnet.
  No mismatch — and notably the sonnet ship stage correctly executed a non-standard, plan-mandated two-push deviation rather than following its prompt's literal single-push step.
  All three subagent dispatches (`tidy-first-assessor` once, `pre-completion-reviewer` twice) ran `anthropic/claude-sonnet-5` per their frontmatter; appropriate for read-only review, and the reviewer's findings bear that out.
- **Escalation-delay tracking** — nothing to flag.
  No `rabbit-hole` friction points; the longest single-error sequence was the `release-watch.ts` truncation at three tool calls (error → rewrite → verify).
- **Unused-tool detection** — one finding, tied to the `versionOf` `premature-convergence` point.
  The verification that settled it — running both regexes over `git tag --list` (347 tags) — was a single command available at planning time and at TDD time, and neither ran it.
  The reviewer ran it.
  When a pattern parses a value the repo already produces in bulk, the corpus is sitting right there.
- **Feedback-loop gap analysis** — no gap; recording as a positive.
  `vitest run <file>` ran after every Red and every Green, `pnpm run check` after each interface-touching step, and the full four-gate sweep (`check`, root `lint`, `test`, `fallow dead-code`) both after the last TDD step and again after the reviewer-driven fix.
  No end-of-session surprise.

### Changes made

1. `.pi/prompts/ship-issue.md` § 5 — replaced the package-tag range derivation with a plan-commit anchor (`PLAN=$(git log --format='%H' --grep="docs: plan .*(#$1)" -1)`), adopting the anchor `.pi/skills/pre-completion/SKILL.md` already prescribes for the same over-scoping hazard.
2. `.pi/prompts/ship-issue.md` § 4b — inlined the package-tag derivation that § 5 used to supply, so the `<last-tag>` reference is no longer orphaned; kept the required path scope and the lexical-sort warning.
3. `.pi/prompts/ship-issue.md` § 5 — repointed the stacked-work scan from the `<pkg-tag>..HEAD` range to `"$PLAN"^..HEAD`.
4. `.pi/prompts/land-worktree.md` § 5 — same plan-commit anchor, replacing the identical tag-derivation text.
5. `.pi/prompts/tdd-plan.md` — added two lines to the Red step: a plan's literal pattern is a floor, not the case list, and run it over the values the repo already produces in bulk before committing.

Both new command blocks were dry-run before landing: the plan anchor resolves `284c4c3a` and yields 13 commits (against 165 for the tag range), and the § 4b derivation runs clean.

[#646]: https://github.com/gotgenes/pi-packages/issues/646
[#816]: https://github.com/gotgenes/pi-packages/issues/816
