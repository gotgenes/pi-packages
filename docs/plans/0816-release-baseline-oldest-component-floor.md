---
issue: 816
issue_title: "release-please last-release-sha baseline can advance past a component's unreleased commits"
---

# Floor the release-please baseline at the oldest component's last release

## Release Recommendation

**Release:** ship independently

Every path this plan touches is repo-root — `.github/`, `scripts/`, `release-please-config.json`, `AGENTS.md`.
None of them sits under a component path, so release-please attributes no commit here to any component and this change cuts no release on its own.
Issue #816 appears in no package's architecture roadmap, so there is no batch to join.

## Problem Statement

`last-release-sha` is a single repo-global floor on release-please's commit walk, but the CI write-back step advances it to the release commit of whichever component happened to release last.
A component that had no releasable units at that moment is not tagged and does not advance, so its unreleased commits can end up *before* the floor — outside the window release-please ever collects.

Reading `src/manifest.ts` in release-please confirms the mechanism exactly.
`buildPullRequests` walks commits from HEAD backwards and `break`s **before** pushing when `commit.sha === lastReleaseSha`, so the floor commit itself is excluded and everything after it is collected.
`commitsAfterSha` then slices each path's commits at that component's own release sha, and when that sha never entered the window it returns `-1` from `findIndex` and hands back the whole already-truncated window.
The gap between a lagging component's release and the floor is therefore never collected at all — it cannot appear in a changelog or drive a version bump.

Measured on `main` at planning time, all nine components resolve to a tag and the drift is four release commits deep:

| release commit | components                                                       |
| -------------- | ---------------------------------------------------------------- |
| `f9499771`     | pi-autoformat, pi-nocd, pi-session-tools, pi-subagents-worktrees |
| `b330769e`     | pi-colgrep, pi-github-tools                                      |
| `81e19880`     | pi-subagents                                                     |
| `8e151a7c`     | pi-permission-model-judge                                        |
| `8d2d4a32`     | pi-permission-system — the current baseline                      |

The impact today is latent, as the issue says: the components in the gap have only `hidden: true` commits there, which would not surface in a changelog regardless.
It stops being latent under `separate-pull-requests: true` ([#817]), where a deliberately deferred component accumulates visible `feat:`/`fix:` commits while sibling releases keep advancing the floor past them.

## Goals

- Derive the baseline from the oldest commit any component still needs to walk back to, rather than from whichever component released last.
- Keep the walk bounded, preserving the rate-limit protection from [#468].
- Make the derivation runnable outside CI, so the manual-recovery path in [#646] stops being a hand-reconstructed edit.
- Stop a failure in the write-back step from stranding a release with no publish.
- Bring the repo's GitHub Actions pins up to their latest majors and add a Dependabot watcher so they stop drifting silently.

This change is **not** breaking.
It alters no package's observable behavior, output shape, or default; every touched file is repo infrastructure.

## Non-Goals

- **`separate-pull-requests: true`** — that is [#817], which depends on this landing first.
  This plan does nothing to make separate PRs work; it only removes the prerequisite hazard.
- **Per-component baselines.**
  The release-please config schema defines `last-release-sha` at the root only, with no per-package variant, so a single conservative floor is the only available shape.
  Verified against `schemas/config.json` on release-please `main`.
- **An automated test harness for repo-root shell scripts.**
  There is none today (`scripts/publish-released.sh` has no tests), and adding one is a larger question than this bug.
  Verification here is by direct execution, specified per step below.
- **npm dependency freshness.**
  That is the concern of `docs/plans/0370-higher-impact-dependency-updates.md`; this plan's Dependabot config covers the `github-actions` ecosystem only.
- **Tuning `commit-search-depth` or `release-search-depth`.**
  Both stay at their defaults.

## Background

`.github/workflows/ci.yml` has three jobs: `check`, `release-please`, and `publish`.
The write-back lives in `release-please` as the step `Advance release-please last-release-sha baseline`, gated on `steps.release.outputs.releases_created == 'true'`.

Its current SHA derivation picks the first path-prefixed `<path>--sha` output, justified by an inline comment asserting that "every component in one release PR is tagged at the same commit, so any released path's `--sha` is the release commit."
That holds for components *in* the PR and is exactly what this issue disproves for components outside it.
The comment is therefore part of the change, not just the code beneath it.

Two facts about the CI environment shape the design, and neither is accounted for by the script sketched in the issue body.

First, the `release-please` job's `actions/checkout@v6` sets no `fetch-depth`.
The action's defaults are `fetch-depth: 1` and `fetch-tags: false`, so that job runs on a shallow clone with no tags and `git rev-list -1 <tag>` finds nothing.
The current step works only because it touches no git objects — just `git diff`, `git commit`, and `git push`.

Second, the tags for components released in *this* run are created by the action through the GitHub API after the checkout, so they are absent from the local clone even with full history.
The step needs an explicit `git fetch --tags` after the action runs.

Two hazards already present in the step are worth clearing while it is open.
Its `FALLBACK_SHA: ${{ github.sha }}` fallback writes HEAD as the baseline, which is the most aggressive possible floor — this bug in its worst form.
And `set -euo pipefail` means a failure here fails the `release-please` job, which makes GitHub skip `publish`; AGENTS.md documents that exact cascade and its manual recovery under [#646].

Relevant AGENTS.md constraints: do not remove the baseline or the write-back ([#468]); the write-back reads a path-prefixed `<path>--sha` rather than a top-level `sha` (a note this plan supersedes); and commit messages must not carry `Closes #N`.

## Design Overview

### The floor

The baseline must be at or before every component's last release commit.
The natural definition is the oldest of those commits, and the derivation reads the manifest rather than the action's outputs, because the outputs only report the components that released.

For each entry in `.release-please-manifest.json`, the tag is `<component>-v<version>`, given `include-component-in-tag: true`, `include-v-in-tag: true`, and the default `-` separator.
The component name comes from `release-please-config.json`'s `packages[path].component` — authoritative — falling back to the path basename.
That distinction is currently invisible (the two coincide for all nine packages) but the config key is what release-please itself uses to build the tag.

Ordering uses `git merge-base --octopus` over the resolved SHAs rather than a committer-timestamp sort.
On this repo's linear, rebase-merged history the two agree, but a common ancestor is correct by construction: it is guaranteed to be at or before every input, so it is always a safe floor even if history stops being linear.
A timestamp sort carries no such guarantee.

### The bound is free

The floor costs nothing against [#468]'s protection, and this is measurable rather than arguable. release-please already stops its own walk at `releaseCommitsFound >= expectedShas` — the count of *distinct* release SHAs, which is five here, the oldest being `f9499771`.
Setting the baseline to `f9499771` therefore breaks the walk at precisely the commit release-please would have stopped at anyway.

| quantity                                             | measured value                                |
| ---------------------------------------------------- | --------------------------------------------- |
| commits from the current baseline `8d2d4a32` to HEAD | 10                                            |
| commits from the corrected floor `f9499771` to HEAD  | 162                                           |
| release-please's own natural stop                    | `f9499771` — identical to the corrected floor |
| depth at which [#468] failed                         | 500                                           |

The one-time widening from 10 to 162 commits on the first run after this lands is well inside the margin, and it is not slack the baseline introduces — it is the window release-please needs to see all five release SHAs.

### Missing tags

A manifest component can legitimately have no tag: AGENTS.md's new-package flow adds the package at `0.0.0` before its first publish.
Such a component has never released, so its walk must reach back to its first commit — the commit that added its `package.json`.

```bash
git log --diff-filter=A --format=%H -1 -- "$path/package.json"
```

This is the correct floor for an unreleased component rather than a defensive guess, and it keeps the new-package flow from turning the write-back red.
Only if *that* also resolves to nothing does the script fail — a genuinely unexplainable state.

Spot-checked at planning time: `packages/pi-nocd` resolves to `9eb42e22` and `packages/pi-subagents-worktrees` to `9a7dcfc5`, both real commits.

### Separation of concerns

The script stays a pure read: it resolves, orders, and prints a SHA to stdout, and mutates nothing.
`git fetch --tags` is the workflow's job, not the script's, so the script is safe to run against a working checkout during a manual [#646] recovery.

Consumer call site in `ci.yml`:

```bash
BASELINE_SHA=$(./scripts/release-baseline-sha.sh)
jq --arg sha "$BASELINE_SHA" '.["last-release-sha"] = $sha' release-please-config.json > "$tmp"
```

And on the operator's machine:

```bash
git fetch --tags
./scripts/release-baseline-sha.sh   # prints the SHA to write into the config
```

The `FALLBACK_SHA` path disappears entirely.
With the fallback gone, a failure means "baseline unchanged" — safe, since a stale floor only widens the walk — rather than "baseline at HEAD", which is the bug.

### Failure containment

The write-back step gets `continue-on-error: true`.
Its failure stays visible as a red annotation on the run, but no longer propagates to the `release-please` job and no longer makes GitHub skip `publish`.
That converts the [#646] cascade — release tagged, nothing published — into a strictly smaller problem: a baseline that did not advance.

### Action pins

Audited against the GitHub API on 2026-08-27, peeling annotated tag objects to commits.
Two of the five pins are already current; three are behind.

| action                                | pin resolves to      | latest              | action taken   |
| ------------------------------------- | -------------------- | ------------------- | -------------- |
| `actions/checkout@v6`                 | v6.1.0 (`d23441a4`)  | v7.0.1 (`3d3c42e5`) | bump to `@v7`  |
| `actions/setup-node@v6`               | v6.5.0 (`24997072`)  | v7.0.0 (`82076278`) | bump to `@v7`  |
| `actions/github-script@v7`            | `f28e40c7`           | v9.0.0 (`3a2844b7`) | bump to `@v9`  |
| `pnpm/action-setup@v6`                | v6.0.10 (`0977fd99`) | v6.0.10             | none — current |
| `googleapis/release-please-action@v5` | v5.0.0               | v5.0.0              | none — current |

Each bump was checked against the action's real surface rather than assumed from the version number.

`actions/checkout` v7 is input-identical to v6 — the same nineteen inputs, the same `fetch-depth: 1` and `fetch-tags: false` defaults, both `using: node24`.
Its sole breaking change blocks fork-PR checkout for `pull_request_target` and `workflow_run`, and `ci.yml` triggers on `push` and `pull_request` only.
This matters for the floor fix: `fetch-depth: 0` behaves identically on either major, so the two changes are genuinely independent.

`actions/setup-node` v7's input surface is a superset of v6, adding `cache-primary-key` and `cache-matched-key` outputs and removing nothing the repo uses.
Its "Remove dummy NODE_AUTH_TOKEN export" fix is directly relevant: v6 injects a placeholder `NODE_AUTH_TOKEN` into `.npmrc` when no token is set, which upstream describes as able to corrupt `.npmrc` during an OIDC publish.
The `publish` job is exactly that configuration — Trusted Publishing via `id-token: write`, with no `NODE_AUTH_TOKEN` secret — so v7 clears a latent hazard on the publish path.

`actions/github-script` v9 breaks on `require('@actions/github')` and on `const`/`let` redeclaration of the now-injected `getOctokit` parameter.
`label-issues.yml`'s script uses only `context` and `github.rest.issues.addLabels`, so neither pattern is present.

### Dependabot

The three pins drifted because nothing watches them: there is no `.github/dependabot.yml`, and plan `0370` covers npm only.
The config grouping all Action updates into a single weekly PR keeps the fix proportionate to a five-action surface.

Verified against GitHub's Dependabot options reference: `package-ecosystem: "github-actions"` with `directory: "/"`, which searches `.github/workflows` plus any root `action.yml`.
A group identifier must start and end with a letter and may contain letters, pipes, underscores, or hyphens.

## Module-Level Changes

| file                                 | change                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/release-baseline-sha.sh`    | **new** — resolves each manifest component to its last-release commit and prints the oldest                                                                                                                                     |
| `.github/workflows/ci.yml`           | `fetch-depth: 0` on the `release-please` checkout; new `git fetch --tags` step; write-back calls the script, gains `continue-on-error: true`, drops `OUTPUTS`/`FALLBACK_SHA`; comment block rewritten; three action pins bumped |
| `.github/workflows/label-issues.yml` | `actions/github-script@v7` → `@v9`                                                                                                                                                                                              |
| `.github/dependabot.yml`             | **new** — weekly `github-actions` updates, grouped into one PR                                                                                                                                                                  |
| `release-please-config.json`         | `last-release-sha` set to the recomputed floor                                                                                                                                                                                  |
| `AGENTS.md`                          | recovery procedure and write-back description corrected                                                                                                                                                                         |

I grepped `last-release-sha` and `--sha` across all `*.md`, `*.json`, `*.yml`, `*.sh`, and `*.ts` outside `node_modules`.
Beyond the files above, every hit is in a `docs/retro/` file — historical records of past sessions, which stay as written.
`scripts/publish-released.sh` reads `paths_released`, not `<path>--sha`, so it is untouched.

Two prose passages in `AGENTS.md` go stale and must move together:

- The [#646] recovery paragraph instructs the operator to "advance `last-release-sha` in `release-please-config.json` to the release commit" — the precise behavior this change removes.
  It becomes an instruction to run the script.
- The [#468] baseline paragraph ends with a sentence explaining that the write-back reads a path-prefixed `<path>--sha` because components live at non-root paths.
  After this change the write-back reads no action output at all, so that sentence is replaced by the manifest-derived floor rule.

No package `README.md`, `docs/architecture/`, or `.pi/skills/package-*/SKILL.md` names any of these symbols; the grep found no hits outside the table above and the retro files.

## Test Impact Analysis

There is no automated harness for repo-root shell scripts, and this plan does not add one (see Non-Goals).
The precedent is `scripts/publish-released.sh`, which is verified the same way.
This is a `/build-plan` plan, not a TDD one: there is no vitest surface, so each step below carries explicit verification commands instead of a red→green cycle.

The script's two branches are both exercisable without CI:

1. **All components tagged** — run against the live repo and compare to the measured expectation.
   Dry-run at planning time already produces `f9499771`, matching the drift table.
2. **A component with no tag** — construct a synthetic repo in `/tmp` with a manifest entry whose tag does not exist, and confirm the script falls back to that package's `package.json`-adding commit rather than failing.

Both must be re-run at implementation time, since `main` will have moved.

`pnpm exec rumdl check` covers the two markdown files; `pnpm run lint` covers nothing new here, since neither shell nor workflow YAML is in its scope.

## Invariants at risk

**[#468]'s bounded walk.**
This is the invariant the change most plausibly regresses, since it moves the floor backwards.
It is quantitative, so it is measured rather than argued: 162 commits at the corrected floor against the 500 at which [#468] failed, and identical to release-please's own `releaseCommitsFound >= expectedShas` stop, so the baseline contributes no slack whatsoever.
The invariant lives only in AGENTS.md prose and is pinned by no test; this plan does not add one, because the quantity is a property of `main`'s history at a moment rather than of any code under test.
Step 5 re-measures it at implementation time.

**The `publish` job still runs after a release.**
`continue-on-error: true` on the write-back is what protects this, and it is verified by reading the job graph: `publish` needs `release-please.outputs.releases_created`, and a `continue-on-error` step does not fail its job.

**`scripts/publish-released.sh` keeps working.**
It consumes `paths_released` from the `releases` output, which this change does not touch.
Step 2 removes only the `OUTPUTS` env binding on the write-back step, not the job-level `releases` output that `publish` reads.

## Implementation Order

1. **Add the derivation script.**
   Create `scripts/release-baseline-sha.sh`, `chmod +x`.
   Verify: `./scripts/release-baseline-sha.sh` prints the oldest component release SHA, matching a hand-run of the per-component resolution loop.
   Verify the missing-tag branch against a synthetic `/tmp` repo.
   Commit: `feat(ci): derive release baseline from the oldest component release`

2. **Wire it into the workflow.**
   Set `fetch-depth: 0` on the `release-please` job's checkout, add the `git fetch --tags --force origin` step after the release action, and rewrite the write-back step to call the script — dropping `OUTPUTS` and `FALLBACK_SHA`, adding `continue-on-error: true`, and replacing the comment block that asserts the disproven `<path>--sha` claim.
   Verify: `actionlint` if available, otherwise confirm the YAML parses and re-read the job graph to check that `publish`'s `needs` is untouched.
   Commit: `fix(ci): floor the release baseline at the oldest component's release`

3. **Bump the action pins.**
   `actions/checkout@v6` → `@v7` (both call sites in `ci.yml`, including the one step 2 just edited), `actions/setup-node@v6` → `@v7` (both call sites), `actions/github-script@v7` → `@v9` in `label-issues.yml`.
   Verify: `grep -n "uses:" .github/workflows/*.yml` shows no remaining stale major.
   Commit: `build(ci): bump GitHub Actions to their latest majors`

4. **Add the Dependabot watcher.**
   Create `.github/dependabot.yml` with a weekly `github-actions` entry at `directory: "/"`, grouping all updates into one PR.
   Verify: confirm required keys against the options reference — `version`, `updates`, `package-ecosystem`, `directory`, `schedule.interval`.
   Commit: `ci: watch GitHub Action versions with Dependabot`

5. **Correct the checked-in baseline.**
   Run `git fetch --tags && ./scripts/release-baseline-sha.sh` and write its output into `release-please-config.json`.
   Recompute rather than reusing `f9499771` — `main` will have moved, and the planning-time value is a measurement, not a constant.
   Re-measure `git rev-list --count <floor>..HEAD` and confirm it stays far below 500.
   Commit: `fix(ci): correct last-release-sha to the oldest component's release`

6. **Update AGENTS.md.**
   Rewrite the [#646] recovery instruction and the [#468] write-back description per Module-Level Changes.
   Verify: `pnpm exec rumdl check AGENTS.md`.
   Commit: `docs: describe the manifest-derived release baseline`

## Risks and Mitigations

| risk                                                                                | mitigation                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fetch-depth: 0` slows the `release-please` job                                     | `.git` is 33 MB across 5067 commits, and the `check` job already runs at full depth — measured, not estimated                                                |
| `merge-base --octopus` returns an ancestor older than any tag on non-linear history | Always a safe floor by construction; the script logs when the result is not one of the candidates, so the widening is visible rather than silent             |
| `continue-on-error` masks a persistently failing write-back                         | The step still annotates red on the run, and a stalled baseline degrades toward [#468]'s 500-commit failure only after hundreds of commits — far from silent |
| Dependabot PR noise on a PR-heavy repo                                              | All five actions collapse into one grouped weekly PR                                                                                                         |
| The one-time backwards move of the baseline widens the next walk                    | Measured at 162 commits, identical to release-please's own natural stop, against a 500-commit failure threshold                                              |
| A future package added at `0.0.0` has no tag                                        | The `package.json`-adding-commit fallback handles it as a correct floor, so the new-package flow never reddens the step                                      |

## Open Questions

- Whether `release-please-action@v5.0.0` resolves to a release-please version where the manifest-conflict reports matter is [#817]'s question, not this one.
  Nothing in this plan depends on the answer.
- Whether repo-root shell scripts deserve a test harness at all is left open; it affects `scripts/publish-released.sh` equally and should be decided for both together rather than as a side effect of this fix.

[#468]: https://github.com/gotgenes/pi-packages/issues/468
[#646]: https://github.com/gotgenes/pi-packages/issues/646
[#817]: https://github.com/gotgenes/pi-packages/issues/817
