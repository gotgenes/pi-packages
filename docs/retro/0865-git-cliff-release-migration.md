---
issue: 865
issue_title: "release-please walk depth grows without bound while the oldest component is dormant"
---

# Retro: #865 — release-please walk depth grows without bound while the oldest component is dormant

## Stage: Planning (2026-09-01T16:42:15Z)

### Session summary

The issue was filed as a walk-depth bug with three candidate fixes; four clarification rounds turned it into a full migration off release-please onto git-cliff.
The operator rejected the first option set on the premise ("why do we make GraphQL calls at all?"), which surfaced release-please's unused `LocalGitHub` backend, and then pointed at a sibling repo (`~/tinyigsoftware/repone`) whose git-cliff toolchain proved to be the better fit once release **latency** — not walk depth — was named as the real pain.
Produced `docs/plans/0865-git-cliff-release-migration.md`: eight build steps covering `cliff.toml`, four release scripts, a dispatched `release.yml`, changelog regeneration, a breaking `pi-github-tools` deletion, and the prompt/skill/`AGENTS.md` ripple.

### Observations

- **The issue's own framing was wrong in a load-bearing way, and measuring caught it.**
  The depth does not grow without bound — it self-caps at `commit-search-depth` 500.
  But 500 ÷ `commit-batch-size` 10 = 50 GraphQL requests, which is exactly the burst at which [#468] failed.
  So the ceiling is real and close (44 requests at planning time), just not a ramp.
  Correcting this in the plan mattered, because "unbounded growth" implies a different class of fix than "a ceiling that is also the failure point".

- **#816's floor rule is sufficient but not necessary, proven from source.**
  `commitsAfterSha` in release-please 17.6.0 returns the *whole* path-split window when a component's release SHA is absent (`findIndex` → `-1`), and the only other consequence is an unused `latestReleasePullRequest` plus a warn.
  So the necessary invariant is "floor at or before every component's oldest **unreleased** commit", not "at the oldest **release** commit".
  Measured, that was 113 commits versus 436 — a viable 4× fix that was offered and declined, correctly, because it addresses 2.3 min of a 14–24 min cycle.
  Worth keeping: this is the record of *why* the cheaper fix was not taken.

- **Reading the dependency's `src/` directory listing was the highest-value single tool call.**
  `src/local-github.ts` was not something any search would have suggested; it appeared only from listing the package's source tree.
  It reframed "are we at release-please's limits?"
  from yes to "no, there is an unused code path" — which then made the *real* answer visible, namely that the unused code path fixes the wrong problem.

- **The operator's pain and the issue's pain were different, and only the operator knew.**
  Everything I measured pointed at the 135 s `release-please` job.
  The actual cost is 14–24 min work-to-published, of which publishing is 30 s and the rest is the two-CI-cycle release-PR round trip with a human merge in the middle.
  `--local` would have cut the visible number and left the felt one.
  Measuring the *end-to-end* latency, not the job I was staring at, is what made the comparison honest.

- **Running the candidate tool against the real repo beat every doc claim.**
  git-cliff reproduced all nine components' versions exactly, in 9.4 s, zero network — including the subtle case (`pi-subagents-worktrees` staying at `0.3.1` because its only commit is `test:`, matching release-please's `changelogEmpty`).
  Unskipping `test` bumped it to `0.3.2`, proving the check was discriminating rather than vacuously green.
  Two dry runs also produced findings that changed the design: `--prepend` writes to byte 0 above the file's own header (so step 4 regenerates with `-o`), and `--bumped-version` prints the prefixed tag rather than a bare SemVer.

- **The `exclude-paths` convention was verified against every package, not sampled.**
  `docs/{plans,retro,architecture,decisions,assets}` reproduces the current 25-entry list exactly — including that `pi-permission-system/docs/guides` and `docs/migration` stay included as shipped user docs.
  This turns a hand-maintained array that AGENTS.md requires editing per new subdirectory into a convention, which is a genuine simplification rather than a like-for-like port.

- **A live check refuted the assessor's one correction.**
  The Tidy-First assessor confirmed both dead-code cascade claims exactly (`merge-state.ts` and `config.ts` each have exactly one non-test importer) and flagged `github.ts`'s `git()` as a possible fourth dead symbol.
  It is called by `detectRepo` at `github.ts:117`, so it survives.
  The assessor also verified that `findRun` matches purely on `headSha` with no `push`-trigger assumption, which is what makes `ci_find`/`ci_watch` usable against a `workflow_dispatch` run with no changes — and it surfaced the `-f sha` vs `--ref` race, which is now stated in the plan rather than papered over.

- **The npm Trusted Publishing move is the plan's most likely production failure**, and it is not a code change.
  The publisher is configured against workflow `ci.yml`; moving publish to `release.yml` 403s until the operator updates it on npmjs.org for all nine packages.
  Called out explicitly in step 3 and in Invariants at risk.

- **Scope grew by operator decision at every gate, never by drift.**
  Round 1 offered five mechanisms within release-please; round 2 was rejected on premise; round 3 introduced `--local`; round 4 introduced git-cliff after the operator supplied `repone`.
  The final scope (re-scope #865 to the migration, plan end to end) was the operator's explicit choice over filing a separate ADR issue.
  Recorded because a plan spanning workflows, scripts, a breaking package change, three prompts, three skills, and `AGENTS.md` otherwise reads like uncontrolled growth.

- **The implementing session will be shipping with tools it is deleting.**
  Both AGENTS.md staleness rules bite at once here: step 6 rewrites `/ship-issue` while step 5 removes the tools `/ship-issue` calls.
  The plan's risk table says to restart Pi before shipping and treat the on-disk prompt as authoritative.

#### Deferred tidyings

- `packages/pi-github-tools/src/tools/ci-find.ts` — its `promptSnippet` says "Wait for a CI run matching a **pushed** SHA", which becomes inaccurate once the tool is routinely used against `workflow_dispatch` runs.
  The assessor rejected it as scope creep for the deletion; it is a natural fold-in for whoever next touches that file.

### Next stage

`/build-plan` — there is no vitest surface anywhere in this change, and every step carries explicit verification commands rather than a red→green cycle.

## Stage: Implementation — Build (2026-09-01T18:26:16Z)

### Session summary

Executed all eight planned steps, plus three unplanned fix commits, for twelve commits total.
Release automation now runs on git-cliff from a `workflow_dispatch` workflow: `cliff.toml` plus six scripts under `scripts/release/`, with `release-please-config.json`, `.release-please-manifest.json`, both baseline scripts, the `release-please` and `publish` jobs in `ci.yml`, and `pi-github-tools`' three release tools all removed.
Pre-completion reviewer: **FAIL** on round 1 (one blocking defect), **WARN** on round 2; both findings were real and both are fixed.

### Observations

- **The plan's step 4 was wrong, and its own verification criterion caught it.**
  The plan said to regenerate all nine `CHANGELOG.md` files, and I had sold that to the operator as a reformat.
  The step's heading-vs-tag check showed it deletes 101 of 220 entries for `pi-permission-system`.
  Two causes, neither fixable by configuration: 153 entries predate this repository (the packages were consolidated from separate repos and only the changelog *text* came across, as `MIGRATION.md` records), and ~45 tagged releases were cut entirely from `docs:` commits under paths added to `exclude-paths` later.
  Stopping to re-ask was correct; the operator chose the seam.
  The general lesson is that the cost I quoted at the gate was an inference, and the gate's decision rested on it.

- **The reviewer's blocking finding was a fact I had already read and then contradicted.**
  I printed `release-please-config.json`'s `changelog-sections` during planning, where `chore` is plainly `hidden=false`, then wrote "the visible five … the hidden six" into `cliff.toml` and repeated it in three more places.
  A package whose only unreleased commits were `chore:` would have been unreleasable forever.
  `verify-cliff-parity.sh` could not catch it, because it compares current tip versions and no package has a chore-only interval pending.
  This is the same failure mode `AGENTS.md` records for #816 — citing a source for a property without re-checking that it has it.

- **Round 2's WARN corrected my explanation, not my code.**
  I justified the `chore(release)` skip as defence against a coincidence, claiming path scoping already handled it.
  The reviewer showed the skip is load-bearing for a case I had not considered: `create-github-releases.sh` runs `git-cliff --latest` *after* the commit and tag exist, so without the rule a release's own GitHub notes list `* **release:** <pkg> <version>`.
  Verified by rendering both ways before rewriting the comment.
  Worth remembering that a correct change with a wrong rationale still ships a wrong rationale.

- **The zsh word-splitting trap in `AGENTS.md` cost a real defect.**
  `CLIFF_EXCLUDED_DOC_DIRS` was a space-separated string expanded unquoted; bash splits it, zsh does not.
  The executed scripts were fine under their bash shebang, so `verify-cliff-parity.sh` stayed green; it surfaced only when I regenerated changelogs by sourcing `lib.sh` inline from the Bash tool, which is zsh here, and `docs/retro` commits leaked in.
  An array fixes it under both shells.

- **Two facts were only discoverable by running the tool.**
  `link_parsers` belongs to `[git]`, not `[changelog]`; git-cliff silently ignores the misplaced key, so `closes [#N]` links just never appeared.
  And `--prepend` inserts at byte 0, above the file's own `# Changelog` header, which is what made the splice a hand-written function rather than a flag.

- **Backticks in a `git commit -m` double-quoted string ran as command substitution**, silently eating three spans from the step 3 message.
  `AGENTS.md` records this for `gh issue comment` bodies; it applies to commit messages just as much.
  Every later commit used `--file=-` with a quoted heredoc.

- **A planned killing mutation turned out to be invalid.**
  The plan said deleting `detectRepo`'s call to `git()` should make `fallow dead-code` report `git()`.
  It does not: `github.test.ts` imports `git()`, so it is not dead.
  Probed the gate with a genuinely unreferenced export instead, which it reported immediately.
  A mutation is only a check if you run it.

- **The migration's own first release exercises the new pipeline.**
  `next-version.sh` reports `pi-github-tools-v5.0.0` — the breaking removal correctly majoring from 4.4.0 on real history.

#### Operator action required before shipping

npm Trusted Publishing is configured against `ci.yml`, and the publish step now lives in `release.yml`.
The publisher must be repointed on npmjs.org for all nine packages, or the first dispatched release 403s.
This cannot be done from the repository.

#### Deviations from the plan

1. **Step 4 replaced**: splice each release below the header instead of regenerating, with an HTML era marker (operator-approved after the measurement above).
2. **`prepare-release.sh` gained a `sha` output**, and `publish`/`github-release` check out that commit rather than `main` — a push landing between jobs would otherwise move `main` past the release commit and `git tag --points-at HEAD` would find nothing.
3. **Three unplanned fix commits**: the zsh array fix, the `chore` mapping fix, and the `chore(release)` rationale correction.
4. **Extra files touched**, all found by grep rather than named in the plan: `.github/workflows/label-issues.yml`, `.pi/prompts/triage-backlog.md` (its fork-approval audit named the retired `release-please` job as the secret-bearing one), and `scripts/label-issues.sh`.

### Next stage

`/ship-issue 865` — but restart Pi first.
This session removed the very tools `/ship-issue` calls and rewrote the prompt itself, so a same-process invocation would run the pre-edit template against tools that no longer exist.

[#468]: https://github.com/gotgenes/pi-packages/issues/468
