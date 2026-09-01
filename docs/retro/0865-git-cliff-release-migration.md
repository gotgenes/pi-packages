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

[#468]: https://github.com/gotgenes/pi-packages/issues/468
