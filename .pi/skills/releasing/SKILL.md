---
name: releasing
description: |
  Load before dispatching a release, a package's first publish, adding a new package,
  editing a `files` allowlist, or when a same-day sibling bump fails `minimumReleaseAge`.
---

# Releasing and packaging

## Dispatching a release

`.github/workflows/release.yml` triggers only on `workflow_dispatch` and takes an explicit package list plus an optional expected-SHA guard:

```bash
gh workflow run release.yml -f packages="pi-subagents pi-colgrep" -f sha="$(git rev-parse HEAD)"
```

Naming packages explicitly is the point: several can be releasable at once, and only the named ones go.
Deferring a release is therefore an omission with no state to clean up — just do not name the package.
A `release` concurrency group serializes runs.

To see what would release, without releasing anything:

```bash
./scripts/release/next-version.sh <pkg>   # prints <pkg>-v<version>, or nothing
./scripts/release/verify-cliff-parity.sh  # all packages: tags, package.json, and what is pending
```

Both are read-only and offline.
Never name a package that `next-version.sh` prints nothing for — `prepare-release.sh` validates every named package **before** writing anything, so one such package refuses the whole run and nothing is tagged.

The run's three jobs are `prepare` → `publish` → `github-release`.
If `prepare` fails, nothing was tagged and the release can simply be re-dispatched.
If a later job fails, the tags are already pushed — fix the cause and re-run that job; re-dispatching would refuse on the existing tag.
A just-published version can 404 on the npm registry for a few minutes, and `pnpm view` serves the stale packument meanwhile.
The `publish` job's `Published package <name>@<version>` log line is the evidence; do not poll the registry.

Versions and changelogs come from [git-cliff](https://git-cliff.org) reading local git, with no network in the derivation.
See `docs/decisions/0002-git-cliff-release-automation.md` for why, and for the accepted residual (there is no release-PR review gate).

## What cuts a release

Release batching is plan-driven: `/plan-improvements` annotates each roadmap step with a grep-able `Release:` tag (and a `Release batches` subsection), `/plan-issue` derives a `Release Recommendation` from those annotations, and `/ship` reads the plan's `**Release:**` marker early — asking only when it is `mid-batch — defer`, otherwise releasing now.
A `refactor:`/`style:`/`test:`/`build:`/`ci:` commit is a skipped changelog type and does not cut a release on its own; such work lands on `main` and auto-batches into the next releasing commit.
`chore:` is **not** skipped — it is a visible "Miscellaneous Chores" section and cuts a patch on its own.
So a refactor-only plan's `Release Recommendation` rationale must not claim it will cut a release.
Do not reason about this from commit types when you can ask: `./scripts/release/next-version.sh <pkg>` applies the real rules offline and prints the tag that would be cut, or nothing.

Release is independent of any issue's open/closed state: holding an issue open does not defer its merged `fix:`/`feat:` commits, and closing one does not release them.
The only lever is which packages a release dispatch names, which makes deferral per-package by construction and leaves no state behind — there is no open pull request to remember.
A cross-package change names every package it bumps in one dispatch.

A package's internal docs directories — `docs/plans`, `docs/retro`, `docs/architecture`, `docs/decisions`, `docs/assets` — are excluded from its release scope by convention, in `scripts/release/lib.sh`.
Adding one of those subdirectories needs no configuration edit; adding a differently named one does.
So does adding a file *directly* under `packages/<pkg>/docs/`: the exclusions match `docs/<sub>/**`, so `docs/fallow-snapshot.json` cuts a release even though the `files` allowlist keeps it out of the tarball.
Tarball scope and release scope are different lists — check the one you mean.
Commits that only touch excluded paths do not trigger releases, and neither do files outside the package tree.
A package's own `CHANGELOG.md` is excluded too, so a release commit never re-enters the next changelog.

## A package's first release

A brand-new package's **first** release is a manual, operator-chosen step. npm Trusted Publishing cannot create a package that does not exist, so `publish` 404s; and `next-version.sh` refuses an untagged package rather than inventing a first version, because this repo's packages opened at 1.0.0, 0.2.0, and 0.1.0 with no convention to infer.
Publish the first version manually (`pnpm login`, then `pnpm --filter @gotgenes/<pkg> publish --access public --no-git-checks` — no `--provenance`), tag it `<pkg>-v<version>`, then configure the Trusted Publisher on npmjs.org (repo `gotgenes/pi-packages`, workflow **`release.yml`**).
The publish needs an interactive terminal when the registry requires an OTP (`ERR_PNPM_OTP_NON_INTERACTIVE`) — the operator runs it, not the agent.
Every release after that runs through the workflow.

## Same-day sibling bumps

A cross-package change bumping a dependent package to a **same-day-published** sibling hits pnpm's 24h `minimumReleaseAge` supply-chain gate — CI's `--frozen-lockfile` install and local `pnpm exec` hooks fail `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`.
`minimumReleaseAgeExclude` does not fix it (honored at resolution, ignored by pnpm's lockfile verification pass); the repo sets `trustLockfile: true` in `pnpm-workspace.yaml` to trust the reviewed lockfile and skip that re-verification.
Do not remove it, and do not reach for `minimumReleaseAge: 0` (which also disables the delay for a fresh `pnpm add`).

## Adding a new package

When adding a new package, wire it into all of:

1. `.pi/settings.json` — add the `../packages/<pkg>` load path.
   Add the `{ "source": "npm:@gotgenes/<pkg>", "extensions": [], "skills": [] }` disable entry (prevents double-load) **only after the package's first npm publish** — before that, the `npm:` reference makes Pi and the subagent launcher `npm install` a nonexistent package and fail.
2. `README.md` — add the package to the Packages table, and to the no-dedicated-skill note unless it ships a `package-<pkg>` skill.
3. `.github/ISSUE_TEMPLATE/bug_report.yml` and `.github/ISSUE_TEMPLATE/feature_request.yml` — add the package to the `Package` dropdown in **both** forms.
   The dropdown is `required: true` and `blank_issues_enabled: false`, so a package missing here cannot be reported at all.
   These are static YAML that GitHub reads from the default branch, so they cannot derive the list at run time the way the labeler does.
4. `gh label create pkg:<pkg> --description "Issues related to <pkg>" --color 0075ca` — the label must exist before an issue selects the package, or `scripts/label-issues.sh` fails on `gh issue edit`.

Release configuration is **not** on that list, and neither is the issue auto-labeler.
Both derive the package list from the workspace on disk: `scripts/release/lib.sh` and `scripts/issue-package-labels.sh` enumerate `packages/*/package.json`, so a new package is picked up with no edit at all.

## Docs-in-distribution convention

The published npm tarball ships runtime code, user-facing docs, and nothing else — no dev files (`test/`, `tsconfig.json`, `vitest.config.ts`, `AGENTS.md`, `.pi/`, `.prettierignore`) and no internal working docs.
Every package uses a `files` allowlist in `package.json`; no package uses `.npmignore`.
A bare directory entry (e.g. `"src"`) is recursive, so runtime code ships without allowlist edits as it grows; npm always auto-includes `package.json`, `README*`, and `LICENSE*` regardless of the allowlist.
List only the additional top-level ship targets explicitly: `dist` (built type bundles), `schemas`, `config/*.example.json`, and user-doc paths.
Ship the docs the README links to (`docs/*.md` plus referenced subdirectories such as `guides`/`migration`/`assets`/`architecture`/`decisions`), never a bare `"docs"` entry — that would also ship `docs/plans` and `docs/retro`.
A package with no user-facing docs omits any `docs` entry from its allowlist entirely.
A link from a shipped doc into a non-shipped path (`docs/decisions/`, `docs/architecture/`) resolves to nothing in the tarball — use an absolute GitHub URL, or add the target to `files`.
Verify the allowlist with `pnpm --filter <pkg> exec pnpm pack --pack-destination /tmp` and inspect `tar tzf` for the expected file set — confirm it contains runtime code and user docs, and excludes `test/`, dev config, and internal docs.
Run `pnpm fallow dead-code` locally before pushing a new or dependency-changed package — CI gates on it, and `devDependencies` copied from a sibling package often include unused entries.

## Workflow scripts

A multi-line `run:` block in `.github/workflows/` belongs in `scripts/`, with the workflow keeping a one-line invocation.
Split a script that pushes from the read-only derivation it calls, and refuse the pushing half outside CI — `scripts/release/prepare-release.sh` guards on `CI`, `scripts/release/next-version.sh` only prints.
