---
issue: 865
issue_title: "release-please walk depth grows without bound while the oldest component is dormant"
---

# Migrate release automation from release-please to git-cliff

## Release Recommendation

**Release:** ship independently

Issue #865 appears in no package's architecture roadmap, so there is no batch to join.
Most of this plan is repo-root infrastructure that belongs to no component, but step 5 lands `feat(pi-github-tools)!:`, which cuts a **major** release of `pi-github-tools` (4.4.0 → 5.0.0).
That release is itself the migration's first end-to-end proof: it is cut by the new dispatched workflow, not by release-please.

## Problem Statement

Issue #865 reports that release-please's commit walk has grown from 1 commit to 434 since [#816] landed, with no mechanism to shrink, and that on the current slope it re-enters the depth regime that produced the `Bad credentials` failure [#468] fixed.

Investigation confirmed the symptom and then reframed the cause.
The walk does **not** grow without bound: it self-caps at `commit-search-depth`, whose default is 500.
But 500 commits at the default `commit-batch-size` of 10 is **50 GraphQL requests**, and that is precisely the burst at which [#468] failed.
Measured at planning time the depth was 436 — 44 requests, against the 50 that failed.

The deeper finding is that none of those requests need to exist. release-please reads commits over the GitHub API because it is built to run as a bot with no checkout.
This repo's `release-please` job has had `fetch-depth: 0` since [#816] — a full clone with tags — and release-please never looks at it.
Every request re-derives what is already in `.git`.

The operator's own framing settled the scope: the pain is not the walk, it is release **latency**, and release-please's release-PR round trip is the cause.

## Goals

- Replace release-please with git-cliff, deriving every component's version and changelog from local git with no network in the derivation.
- Cut release latency by removing the two-CI-cycle release-PR round trip, replacing it with a single `workflow_dispatch` run.
- Keep releases **explicitly** per-package, so parallel worktree work on several packages never releases a package the operator did not name.
- Preserve the existing tag scheme (`<component>-v<version>`), per-package `CHANGELOG.md`, per-component GitHub Releases, and npm Trusted Publishing.
- Preserve today's conventional-commit semantics exactly: which types are user-visible, which are hidden, and that a `!` forces a major bump even on a hidden type.
- Delete the machinery that existed only to work around the API walk: `last-release-sha`, both baseline scripts, and the write-back step ([#468], [#646], [#816], #865 are all one cause).
- Remove `pi-github-tools`' three release-please PR tools, which have no meaning once there is no release PR.

This change **is breaking** for `pi-github-tools`: `release_pr_find`, `release_pr_merge`, and `release_watch` are removed from a published package, along with its `defaultMergeMethod` configuration.
Step 5 therefore uses `feat(pi-github-tools)!:` with a `BREAKING CHANGE:` footer.

## Non-Goals

- **A `release_run` tool for `pi-github-tools`.**
  The surviving `ci_find` / `ci_watch` already take a workflow name, and the Tidy-First assessment verified that `findRun` matches purely on `headSha` with no `push`-trigger assumption baked in, so they watch a `workflow_dispatch` run correctly as-is.
  The prompts call `gh workflow run` directly.
  This is a deferral, not a boundary — if the raw invocation proves fiddly in practice, a tool is the obvious next move.
- **Changesets, semantic-release, lerna-lite, or nx release.**
  Evaluated and declined during the clarification gate; the ADR in step 7 records why.
- **A test harness for repo-root shell scripts.**
  Still absent, still deliberately so — the question was left open by [#816] for `scripts/publish-released.sh` and is unchanged here.
  Verification is by direct execution against synthetic repositories, specified per step.
- **Retroactive rewriting of `docs/triage/`, `docs/retro/`, `MIGRATION.md`, or `docs/architecture/history/`.**
  These are historical records of what was true when written.
  `MIGRATION.md` documents the original multi-repo consolidation and its `release-please` mentions describe that historical migration, not current behavior.
- **Changing which commit types are user-visible.**
  The `changelog-sections` mapping is reproduced exactly, not revisited.

## Background

### Measured state at planning time

| quantity                                                  | measured                                           |
| --------------------------------------------------------- | -------------------------------------------------- |
| walk depth (`last-release-sha` to HEAD)                   | 436 commits                                        |
| GraphQL requests per run (depth ÷ `commit-batch-size` 10) | 44, against the 50 at which [#468] failed          |
| `release-please` job duration on `main`                   | 117–173 s, **on every push**, twice per release    |
| `check` job duration                                      | 128–163 s, also twice per release                  |
| `publish` job duration                                    | 27–30 s                                            |
| **work committed → published on npm**                     | **14, 14, 14, 24 min** over the last four releases |

The actual publishing is 30 seconds.
Everything else is the round trip.

### Why the floor could not shrink

The floor is pinned by the oldest component's last release, and four components (`pi-autoformat`, `pi-nocd`, `pi-session-tools`, `pi-subagents-worktrees`) last released at `f9499771` and have released nothing since.
`scripts/advance-release-baseline.sh` therefore cannot move it.

Honoring `exclude-paths`, only one component had any unreleased commit in its own paths — a single `test:` commit at depth 112.
So the window release-please actually needed was 113 commits, not 436.
That gap is a property of [#816]'s rule (floor at the oldest **release** commit) rather than of the necessary invariant (floor at or before the oldest **unreleased** commit), verified against `commitsAfterSha` in release-please 17.6.0.
A tighter floor was a viable fix and was offered; it was declined because it addresses 2.3 minutes of a 14–24 minute cycle.

### Constraints from AGENTS.md that apply

- A multi-line `run:` block in `.github/workflows/` belongs in `scripts/`, with the workflow keeping a one-line invocation.
- A script that pushes must be split from the read-only derivation it calls, and must refuse to run outside CI.
  `scripts/advance-release-baseline.sh` is the precedent, guarding on `CI` with an `ALLOW_LOCAL_PUSH` escape.
- Commit type is determined by what a user can observe once the commit lands, not by what it adds to the tree.
- `!` goes after the scope: `feat(pi-github-tools)!:`.
- A published package's export renames for free only if it has not shipped; `pi-github-tools` is at 4.4.0 on npm, so the removal is genuinely breaking.
- Editing a `.pi/prompts/*.md` template mid-session does not change the already-loaded copy, and editing `packages/<pkg>/src/` does not change the already-loaded extension.
  Both matter acutely here, because this plan rewrites `/ship-issue` **and** removes the tools `/ship-issue` calls.

## Design Overview

### Derivation

git-cliff computes each component's next version and changelog body from tags and local history:

```bash
git-cliff --tag-pattern "^<pkg>-v" \
  --include-path "packages/<pkg>/**" \
  --exclude-path "packages/<pkg>/docs/{plans,retro,architecture,decisions,assets}/**" \
  --exclude-path "packages/<pkg>/CHANGELOG.md" \
  --bumped-version
```

Verified at planning time against the live repository, with git-cliff 2.13.1:

| check                               | result                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| version for all nine components     | matches `.release-please-manifest.json` exactly, every one                                                                               |
| wall clock, all nine, cold          | 9.4 s, zero network                                                                                                                      |
| hidden-type semantics               | `pi-subagents-worktrees` stays at `0.3.1`; its lone `test:` commit is `skip = true`, matching release-please's `changelogEmpty` behavior |
| bump detection is live, not vacuous | unskipping `test` bumps it to `0.3.2`                                                                                                    |
| rendering                           | produced the correct grouped body for `pi-subagents-v21.2.0`                                                                             |

`--bumped-version` emits the full prefixed tag (`pi-colgrep-v1.5.3`), so the scripts derive the bare SemVer by stripping `^<pkg>-v`.

### Exclude paths become a convention, not a list

release-please carries a hand-maintained `exclude-paths` array that AGENTS.md requires editing whenever a package gains an internal docs subdirectory. git-cliff takes its paths on the command line, so the scripts derive them by convention: `docs/{plans,retro,architecture,decisions,assets}` under each package, plus that package's `CHANGELOG.md`.

This was checked against every package rather than assumed.
The convention reproduces the current 25-entry package-scoped list exactly — including that `pi-permission-system/docs/guides` and `docs/migration` stay **included** (they are shipped user docs), and that `pi-subagents-worktrees` has no `architecture`/`decisions` directory to exclude.
Root-level `docs/plans`, `docs/retro`, `docs/decisions`, and `docs/triage` need no exclusion at all, because `--include-path "packages/<pkg>/**"` never reaches them.

Excluding each package's own `CHANGELOG.md` is new and deliberate: it keeps a changelog-writing commit from re-entering the next changelog, which makes the one-time regeneration in step 4 invisible to future releases and lets it carry an honest `docs:` type.

### Preserving commit-type semantics

`cliff.toml`'s `commit_parsers` reproduce `release-please-config.json`'s `changelog-sections` one for one — `feat`, `fix`, `perf`, `revert`, and `docs` visible; `style`, `refactor`, `test`, `build`, `ci`, and `chore` skipped.

The subtle one is breaking changes on a hidden type.
History contains `refactor(pi-subagents)!: drop the unread invocation field from the workspace seam`.
Under release-please, `refactor` is `hidden: true` but `!` still drives a major bump through `DefaultVersioningStrategy`. git-cliff reproduces this only with `protect_breaking_commits = true`, which keeps a breaking commit from being dropped by a `skip = true` parser.
That is an external fact the whole versioning contract rests on, so step 1 pins it with an executable check rather than asserting it.

### The release workflow

`.github/workflows/release.yml`, `workflow_dispatch` only:

| input      | required | meaning                                                      |
| ---------- | -------- | ------------------------------------------------------------ |
| `packages` | yes      | space- or comma-separated package directory names to release |
| `sha`      | no       | expected `HEAD`; the run aborts if `main` moved              |

The explicit list is the operator's stated requirement: with parallel worktrees, several packages may be releasable at once and only the named ones may go.
`concurrency: group: release, cancel-in-progress: false` serializes runs, which replaces the "release is the root's serialized responsibility" convention with a mechanism.

Jobs: `prepare` → `publish` → `github-release`.

`prepare` checks out `main` at full depth, installs git-cliff via `taiki-e/install-action@git-cliff`, and runs one script.
`publish` reuses today's npm Trusted Publishing setup unchanged.
`github-release` creates one GitHub Release per tag with notes from `git-cliff --latest`.

`ci.yml` loses the `release-please` and `publish` jobs; `check` is untouched.
That removes ~135 s from **every** push to `main`, not only from releases.

### Deriving what was released

The action's `paths_released` output is replaced by git itself:

```bash
git fetch --tags --force origin
git tag --points-at HEAD          # -> pi-github-tools-v5.0.0
```

`prepare` tags every released package at the single release commit, so `--points-at HEAD` names exactly that set.
This is strictly more local than the JSON-encoded action output `scripts/publish-released.sh` parses today, and it removes that script's `mapfile` (which AGENTS.md records as a real macOS bash 3.2 portability defect in the sibling script).

### Script split

Following the [#816] precedent that a pushing script is separated from the read-only derivation it calls:

| script                                      | pushes  | role                                                                                          |
| ------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `scripts/release/next-version.sh <pkg>`     | no      | prints `<pkg>-v<X.Y.Z>`, or nothing when there is nothing to release                          |
| `scripts/release/prepare-release.sh`        | **yes** | per package: bump `package.json`, regenerate `CHANGELOG.md`, commit, tag; one push at the end |
| `scripts/release/publish-released.sh`       | no      | publishes every package named by `git tag --points-at HEAD`                                   |
| `scripts/release/create-github-releases.sh` | no      | one `gh release create` per tag, notes from `git-cliff --latest`                              |

`prepare-release.sh` guards on `CI` with an `ALLOW_LOCAL_PUSH` escape, exactly as `advance-release-baseline.sh` does.
`next-version.sh` is safe to run in a working checkout, which is what makes "what would release?"
answerable locally — something the release-please setup could never do.

### Version write-back and the lockfile

`prepare-release.sh` writes the bare version into `packages/<pkg>/package.json` with `jq`, since git-cliff computes versions but does not write them (release-please's `node` type did).

This does not dirty `pnpm-lock.yaml`.
Checked: the lockfile contains no `workspace:` specifiers, and the two internal dependencies (`pi-permission-model-judge` → `pi-permission-system`, `pi-subagents-worktrees` → `pi-subagents`) are registry ranges (`>=27.0.0`, `^16.4.0`), not workspace links.
So `pnpm install --frozen-lockfile` in the `publish` job stays green after a bump.

### Consumer call site

The shipping prompts replace `release_pr_find` / `release_pr_merge` / `release_watch` with:

```bash
gh workflow run release.yml -f packages="pi-subagents" -f sha="$(git rev-parse HEAD)"
```

then `ci_find` with `workflow: "release"` and that same SHA, then `ci_watch` on the returned run.

The Tidy-First assessment verified `findRun` matches on `run.headSha` with no trigger-type assumption, so this works unchanged.
It also surfaced the one real hazard: `-f sha` is a workflow *input*, not `--ref`, so GitHub resolves `head_sha` from `main`'s tip at dispatch time.
If `main` moves between deriving the SHA and dispatching, `ci_find` will not match — and the run's own SHA guard will have failed anyway, which is the correct outcome.
The prompts state this rather than papering over it.

## Module-Level Changes

### Added

| file                                                  | change                                                                                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cliff.toml`                                          | **new** — changelog template, `[bump]` rules, `commit_parsers` mirroring `changelog-sections`, `protect_breaking_commits = true`, `[remote.github]` for commit and compare links |
| `scripts/release/next-version.sh`                     | **new** — read-only per-package version derivation                                                                                                                               |
| `scripts/release/prepare-release.sh`                  | **new** — CI-guarded bump, changelog, commit, tag, push                                                                                                                          |
| `scripts/release/publish-released.sh`                 | **new** — publishes packages named by `git tag --points-at HEAD`                                                                                                                 |
| `scripts/release/create-github-releases.sh`           | **new** — one GitHub Release per tag                                                                                                                                             |
| `scripts/release/verify-cliff-parity.sh`              | **new** — asserts git-cliff's derived version equals the manifest's for all nine; the migration's correctness gate                                                               |
| `.github/workflows/release.yml`                       | **new** — `workflow_dispatch` release pipeline                                                                                                                                   |
| `docs/decisions/0002-git-cliff-release-automation.md` | **new** — the ADR                                                                                                                                                                |

### Removed

| file                                                     | reason                                              |
| -------------------------------------------------------- | --------------------------------------------------- |
| `release-please-config.json`                             | release-please only                                 |
| `.release-please-manifest.json`                          | version source of truth moves to tags               |
| `scripts/release-baseline-sha.sh`                        | existed only to bound the API walk                  |
| `scripts/advance-release-baseline.sh`                    | same                                                |
| `scripts/publish-released.sh`                            | superseded by `scripts/release/publish-released.sh` |
| `packages/pi-github-tools/src/lib/release.ts`            | drives release-please PRs only (559 lines)          |
| `packages/pi-github-tools/src/lib/merge-state.ts`        | dead once `release.ts` goes (117 lines)             |
| `packages/pi-github-tools/src/lib/config.ts`             | dead once `release-pr-merge.ts` goes (60 lines)     |
| `packages/pi-github-tools/src/tools/release-pr-find.ts`  | no release PR exists                                |
| `packages/pi-github-tools/src/tools/release-pr-merge.ts` | same                                                |
| `packages/pi-github-tools/src/tools/release-watch.ts`    | `ci_watch` on the release run supersedes it         |
| `packages/pi-github-tools/test/lib/release.test.ts`      | (887 lines)                                         |
| `packages/pi-github-tools/test/lib/merge-state.test.ts`  | (314 lines)                                         |
| `packages/pi-github-tools/test/lib/config.test.ts`       | (164 lines)                                         |
| `.pi/extensions/pi-github-tools/config.json`             | its only key is `defaultMergeMethod`                |

The dead-code cascade was verified by the Tidy-First assessor against the real files, not inferred: `merge-state.ts` has exactly one non-test importer (`release.ts:13`), and `config.ts` has exactly one (`release-pr-merge.ts`).

The assessor also flagged that `github.ts`'s `git()` helper might become a fourth dead symbol.
Checked and **refuted**: `git()` is called by `detectRepo` at `github.ts:117`, so it survives.
`ci-helpers.ts`, `retry.ts`, and the rest of `github.ts` keep live callers through `ci.ts`.
There is no barrel file and no shared test fixture module, so the deletion is self-contained.

### Modified

| file                                          | change                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                    | delete the `release-please` and `publish` jobs                                                                 |
| `scripts/issue-package-labels.sh`             | derive the package list from `packages/*/package.json` instead of `.release-please-manifest.json` (line 34/44) |
| `scripts/hunk-pkg-diff.sh`                    | comment at line 9 attributes the tag scheme to release-please                                                  |
| `packages/pi-github-tools/src/extension.ts`   | drop three imports and three `registerTool` calls                                                              |
| `packages/pi-github-tools/README.md`          | remove the three tools' sections and the `separate-pull-requests` / `defaultMergeMethod` prose                 |
| `packages/*/CHANGELOG.md` (nine files)        | regenerated in git-cliff format                                                                                |
| `packages/*/package.json`                     | version written by `prepare-release.sh` at release time (not in this plan's commits)                           |
| `.pi/prompts/ship-issue.md`                   | "Release coordination", step 4b, and step 6                                                                    |
| `.pi/prompts/ship-worktree.md`                | lines 35–38, 70, 97, 100, 111–120, 147, 149                                                                    |
| `.pi/prompts/ship-no-issue.md`                | description line and steps 4–5                                                                                 |
| `.pi/prompts/build-plan.md`                   | line 114 — "release-please owns `CHANGELOG.md`"                                                                |
| `.pi/prompts/tdd-plan.md`                     | line 155 — same                                                                                                |
| `.pi/prompts/retro.md`                        | line 232 — same                                                                                                |
| `.pi/skills/package-pi-github-tools/SKILL.md` | module tree, the `separate-pull-requests` paragraph, `defaultMergeMethod`                                      |
| `.pi/skills/roadmap-fit/SKILL.md`             | line 75 cites `release-please-config.json`'s `exclude-paths`                                                   |
| `.pi/skills/improvement-discovery/SKILL.md`   | the `Release:` tag semantics survive; the mechanism note changes                                               |
| `AGENTS.md`                                   | see below                                                                                                      |
| `README.md`                                   | lines 139, 195, 208, 209                                                                                       |

The grep behind this list covered `release-please`, `release_pr_find`, `release_pr_merge`, `release_watch`, `releases_created`, `paths_released`, `last-release-sha`, and `defaultMergeMethod` across the repository, excluding `node_modules`, `.pi/npm`, `CHANGELOG.md`, and the `docs/plans`/`docs/retro` trees.
Everything it found outside the tables above is historical: `docs/triage/*`, `MIGRATION.md`, `docs/decisions/0001-commit-message-linter.md`, and two `docs/architecture/history/` files.
Those stay as written, per Non-Goals.

`AGENTS.md` loses or rewrites: the six-step new-package checklist (steps 1 and 2 disappear entirely, since neither file survives); the automatic-publishing paragraphs; the [#646] recovery procedure; the [#468]/[#816] baseline paragraphs; the release-please 422 paragraph and its `separate-pull-requests` rollback note; the release-batching paragraph and its "the only lever to defer a release is leaving the release-please PR unmerged" claim; the `defaultMergeMethod` / `release_pr_merge` guidance; the worktree convergence section's release step; and the `exclude-paths` instruction for new docs subdirectories.

## Test Impact Analysis

**New tests the change enables.**
None in the vitest sense — this deletes test surface rather than adding it.
What it does enable is a **local** answer to "what would release?", which release-please could not give at all: `scripts/release/next-version.sh <pkg>` runs offline in under a second.
`scripts/release/verify-cliff-parity.sh` turns that into a standing gate.

**Tests that become redundant.**
`release.test.ts` (887), `merge-state.test.ts` (314), and `config.test.ts` (164) all go with their subjects — 1365 lines of test for behavior that no longer exists.

**Tests that must stay.**
`ci.test.ts`, `ci-helpers.test.ts`, `issue.test.ts`, `github.test.ts`, `retry.test.ts`, `process.test.ts`.
`github.test.ts` matters especially: it exercises `git()` at lines 165, 181, and 195, which is the surviving evidence that the helper the assessor flagged is genuinely still live.

**The shell commands this plan prescribes are its testable surface**, and every load-bearing one was dry-run at planning time: per-component `--bumped-version` for all nine (all matching), the `test:`-unskipped bump, `--latest` rendering, and `git tag --points-at HEAD`.
Two were run and produced findings that changed the design:

- `--prepend` inserts at byte 0, *above* the file's own `# Changelog` header.
  This is why step 4 regenerates with `-o` instead.
- `--bumped-version` prints the full prefixed tag, not a bare SemVer, so the scripts must strip the prefix before writing `package.json`.

**The parser's input domain**, not the inputs I can picture, is what step 1's parity check covers: it runs git-cliff over all nine components' full real histories and compares against the versions release-please independently arrived at.

## Invariants at risk

**Every component's current version is reproducible from git alone.**
This is the migration's load-bearing claim, and it is measured, not argued: all nine of git-cliff's `--bumped-version` results equal `.release-please-manifest.json` today.
`scripts/release/verify-cliff-parity.sh` (step 1) pins it, and it must be run **before** step 3 deletes the manifest it compares against — after that, the evidence is gone.

**A `!` on a hidden type still forces a major bump.**
Pinned by `protect_breaking_commits = true` and by step 1's explicit check, using the real `refactor(pi-subagents)!:` commit in history.
Without it, a breaking refactor would silently ship as a patch — the most expensive possible regression here, and one no other gate would catch.

**Hidden types do not cut a release on their own.**
Verified live: `pi-subagents-worktrees`' lone `test:` commit leaves it at `0.3.1` under git-cliff, matching release-please's `changelogEmpty` behavior.
Step 1's parity check covers this, since a regression would show as a spurious bump.

**npm Trusted Publishing keeps working.**
The publisher is configured against repo `gotgenes/pi-packages` and workflow **`ci.yml`**.
Moving the publish step to `release.yml` **breaks it** until the npm-side Trusted Publisher configuration is updated to the new workflow filename.
This is an operator action on npmjs.org, not a code change, and it must happen before the first dispatched release or the publish 403s.
Step 3 names it explicitly; it is the single most likely way this migration fails in production.

**`publish` still runs after a release.**
Today this is protected by `continue-on-error` on the write-back and by `needs: release-please`.
Under `release.yml` it is a plain `needs: prepare` edge with no `continue-on-error` anywhere in the path, which is strictly simpler: if `prepare` fails, nothing was tagged, so there is nothing to publish.
The [#646] cascade class disappears rather than being contained.

**The issue auto-labeler keeps knowing all nine packages.**
It reads `.release-please-manifest.json` today ([#818] made that the single source).
Step 3 repoints it to `packages/*/package.json` in the same commit that deletes the manifest, and verifies it still lists nine.

## TDD Order

The Tidy-First assessor found **no preparatory refactorings warranted** — the `pi-github-tools` change is a clean, self-contained deletion with no shared abstraction to narrow and no fixture to migrate.
Its one correction (a possible fourth dead symbol) was checked and refuted, as recorded above.

This is a `/build-plan`, not a `/tdd-plan`: there is no vitest surface to drive red→green, so each step carries explicit verification commands.
Where a step establishes a semantic the design rests on, it names the mutation that must break the check.

1. **Add the git-cliff configuration and read-only derivation.**
   Write `cliff.toml` and `scripts/release/next-version.sh`, plus `scripts/release/verify-cliff-parity.sh`.
   Verify: `verify-cliff-parity.sh` reports all nine components matching `.release-please-manifest.json`.
   *Killing mutation:* set `protect_breaking_commits = false` and confirm a range containing only `refactor(pi-subagents)!:` stops producing a major bump — if it still majors, the check is not discriminating and the parser mapping is wrong.
   *Second mutation:* remove the `{ message = "^test", skip = true }` parser and confirm `pi-subagents-worktrees` starts reporting `0.3.2`, proving the hidden-type rule is actually being exercised rather than vacuously true.
   Commit: `build: derive package versions and changelogs with git-cliff`

2. **Add the release scripts.**
   Write `prepare-release.sh` (CI-guarded, `ALLOW_LOCAL_PUSH` escape), `publish-released.sh`, and `create-github-releases.sh`.
   Verify by execution against a synthetic repository in `/tmp` with a local bare remote — the method [#816]'s retro records as what proved the write-back's push path.
   Exercise: a package with nothing to release (no tag, no commit, clean exit), two packages in one run, the SHA-guard mismatch path, and the `CI`-unset refusal.
   *Killing mutation:* drop the `<pkg>-v` prefix strip and confirm `package.json` ends up with `pi-nocd-v1.0.3` instead of `1.0.3` — this is the concrete failure the `--bumped-version` dry run predicted.
   Commit: `ci: add the git-cliff release preparation and publish scripts`

3. **Cut over the workflows.**
   Add `.github/workflows/release.yml`; delete the `release-please` and `publish` jobs from `ci.yml`; delete `release-please-config.json`, `.release-please-manifest.json`, `scripts/release-baseline-sha.sh`, `scripts/advance-release-baseline.sh`, and `scripts/publish-released.sh`; repoint `scripts/issue-package-labels.sh` at `packages/*/package.json`; fix `scripts/hunk-pkg-diff.sh`'s comment.
   These must be one commit: the labeler's source file is deleted here, and leaving `publish` in `ci.yml` while adding it to `release.yml` would double-publish.
   Run `verify-cliff-parity.sh` one last time **before** staging the manifest deletion.
   Verify: `actionlint` on both workflows; `scripts/issue-package-labels.sh` still enumerates nine packages; `grep -rn "release-please" .github/ scripts/` is empty.
   **Operator action, not a code change:** update the npm Trusted Publisher for all nine packages from `ci.yml` to `release.yml` before the first dispatch, or `publish` will 403.
   Commit: `ci: release packages from a dispatched git-cliff workflow`

4. **Regenerate the nine changelogs.**
   Run `git-cliff -o packages/<pkg>/CHANGELOG.md` per package with the scoping flags.
   Verify: each file's release headings match `git tag --list '<pkg>-v*'` one for one, and the newest entry's bullets match the existing release-please text semantically (spot-check `pi-subagents-v21.2.0`, whose expected content is recorded in this plan).
   Because `cliff.toml` excludes each package's own `CHANGELOG.md`, this commit cannot re-enter a future changelog, so `docs:` is the honest type.
   Commit: `docs: regenerate package changelogs in git-cliff format`

5. **Remove the release-please PR tools from `pi-github-tools`.**
   Delete the three tools, `release.ts`, `merge-state.ts`, `config.ts`, and their three test files; strip three imports and three `registerTool` calls from `extension.ts`; update the package README; delete `.pi/extensions/pi-github-tools/config.json`.
   Verify: `pnpm run check`, `pnpm -r run test`, `pnpm run lint`, and `pnpm fallow dead-code` all clean — the dead-code gate is what would catch a missed cascade.
   *Killing mutation:* delete `github.ts`'s `detectRepo` call to `git()` and confirm `fallow dead-code` then reports `git()` — proving the gate actually sees this class of symbol, rather than passing because it looks at nothing.
   Commit: `feat(pi-github-tools)!: remove the release-please pull-request tools` With a `BREAKING CHANGE:` footer naming the replacement: `gh workflow run release.yml`, then `ci_find` / `ci_watch` with `workflow: "release"`.

6. **Retarget the prompts and skills.**
   Rewrite `/ship-issue`, `/ship-worktree`, and `/ship-no-issue`'s release sections; fix the `CHANGELOG.md` ownership lines in `build-plan.md`, `tdd-plan.md`, and `retro.md`; update `package-pi-github-tools`, `roadmap-fit`, and `improvement-discovery`.
   Each prompt states the `head_sha` race explicitly rather than hiding it.
   Verify: dry-run each new shell command the prompts prescribe (`gh workflow run --help`, the package-list derivation, `git tag --points-at HEAD`); `grep -rn "release_pr_find\|release_pr_merge\|release_watch" .pi/` is empty; `pnpm exec rumdl check` on every edited file.
   Commit: `docs: retarget the shipping prompts at the dispatched release workflow`

7. **Record the decision.**
   Write `docs/decisions/0002-git-cliff-release-automation.md`: the measured latency and request-count evidence, the `commitsAfterSha` finding, why `--local` and the tighter floor were declined, why Changesets was declined, and the accepted residual — no release-PR review gate.
   Verify: `pnpm exec rumdl check`.
   Commit: `docs: record the git-cliff release automation decision`

8. **Update `AGENTS.md` and `README.md`.**
   Apply the rewrites enumerated in Module-Level Changes.
   Verify: `pnpm exec rumdl check`; `grep -n "release-please" AGENTS.md README.md` returns only deliberate historical references, if any.
   Commit: `docs: describe the git-cliff release flow`

Step 5 must precede step 6, because the prompts stop referencing tools that still exist rather than referencing tools that do not.
Steps 7 and 8 are last so they describe what landed.

## Risks and Mitigations

| risk                                                                       | mitigation                                                                                                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm Trusted Publishing still points at `ci.yml` and the first release 403s | Named as an explicit operator action in step 3; it is the most likely production failure and cannot be fixed from the repo                                     |
| git-cliff's bump differs from release-please's for some component          | Measured for all nine before anything is deleted; `verify-cliff-parity.sh` is run again immediately before the manifest is removed                             |
| A breaking hidden-type commit silently ships as a patch                    | `protect_breaking_commits = true`, pinned by step 1's killing mutation against a real `refactor(...)!:` commit in history                                      |
| Losing the release-PR review gate lets a wrong version ship                | Accepted trade, recorded in the ADR. Partly offset: `next-version.sh` answers "what would release?" locally and instantly, which no release-please setup could |
| The session that implements this cannot use its own new `/ship-issue`      | AGENTS.md's stale-template and stale-extension rules both apply. Restart Pi before shipping, and treat the on-disk prompt as authoritative                     |
| `main` moves between deriving the SHA and dispatching                      | The run's own SHA guard aborts; `ci_find` then correctly fails to match. The prompts state this rather than retrying blindly                                   |
| A regenerated changelog loses content                                      | Step 4 verifies heading-to-tag parity per package, not a sample                                                                                                |
| `pi-github-tools` consumers break on the major                             | Genuine breaking change, correctly typed `feat(pi-github-tools)!:` with a `BREAKING CHANGE:` footer naming the replacement                                     |
| Deleting three modules leaves a dangling import                            | `pnpm run check` plus `pnpm fallow dead-code`, with a killing mutation proving the gate sees this symbol class                                                 |

## Open Questions

- Whether `pi-github-tools` should eventually regain a first-class `release_run` tool wrapping dispatch-plus-watch.
  Deferred deliberately (see Non-Goals) rather than answered — the prompts using `gh workflow run` directly is the experiment that decides it.
- Whether the repo-root shell scripts deserve a test harness.
  Left open by [#816] and still open; this plan adds four more scripts to that question without resolving it, which strengthens the case without changing this change's scope.

[#468]: https://github.com/gotgenes/pi-packages/issues/468
[#646]: https://github.com/gotgenes/pi-packages/issues/646
[#816]: https://github.com/gotgenes/pi-packages/issues/816
[#818]: https://github.com/gotgenes/pi-packages/issues/818
