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

[#646]: https://github.com/gotgenes/pi-packages/issues/646
[#816]: https://github.com/gotgenes/pi-packages/issues/816
