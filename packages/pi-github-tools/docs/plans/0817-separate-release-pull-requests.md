---
issue: 817
issue_title: "Ship packages independently with release-please separate-pull-requests"
---

# Ship packages independently with release-please separate-pull-requests

## Release Recommendation

**Release:** ship independently

`pi-github-tools` has no `docs/architecture/` roadmap, so issue #817 belongs to no release batch and carries no `Release:` tag to inherit.
The change cuts a `pi-github-tools` release on its own: steps 1–3 land `feat:`/`fix:` commits under `packages/pi-github-tools/`, which is not in `exclude-paths`.
The repo-root edits (`release-please-config.json`, `.pi/prompts/`, `AGENTS.md`, root `README.md`) are attributed to no component and release nothing.

## Problem Statement

`release-please-config.json` does not set `separate-pull-requests`, so it defaults to `false` and all nine components land in one combined `chore: release main` PR.
Because the only lever to defer a release is leaving that PR unmerged (see [#625]), deferring one package's batched release also holds every other package's fixes.
The concrete pain: holding `pi-permission-system`'s batch currently blocks shipping unrelated `pi-subagents` bugfixes.

Versioning is already independent — each component has its own tag (`pi-subagents-v19.3.5`) and its own `CHANGELOG.md`.
Only the pull request is shared.

## Goals

- Make the release-deferral lever per-package by setting `"separate-pull-requests": true`.
- Give `release_pr_find` and `release_watch` a `component` selector, so neither picks arbitrarily once several release PRs (or several tags) are in play.
- Fix `release_watch`'s `version:` line, which today reports the whole component tag instead of the version.
- Thread the component through the three ship/land prompts and update the release prose in `AGENTS.md` and both READMEs.
- Roll the flip out behind a deliberate canary that exercises the PR-**update** path, with a written rollback.

This change is **not** breaking.
Every new parameter is optional, and each tool's behavior with the parameter omitted is preserved for the states that exist under a combined release PR (see Design Overview → Compatibility).

## Non-Goals

- **Replacing release-please** with git-cliff, Changesets, or pnpm's native workspace versioning.
  The issue evaluates and rejects all three; nothing here reopens that.
- **Per-component release batching policy.**
  The `Release:` roadmap tags, the `**Release:**` plan marker, and `/plan-improvements`' `Release batches` subsection keep their current meaning.
  Only what a deferral *costs* changes: it now holds one package instead of nine.
- **A `pull-request-title-pattern` override.**
  The default pattern already yields a component-bearing title; a custom pattern is what [rp-2773]'s reporter used, and adding one buys nothing here.
- **Per-component `separate-pull-requests`.**
  release-please supports it per package ([rp-1412]), but every component here wants the same answer.
- **Cleaning up the stale remote `release-please--branches--main` ref.**
  It carries no open PR (`gh pr list --label 'autorelease: pending'` returns `[]` at planning time), so it is inert.
- **A test harness for repo-root shell scripts.**
  `docs/plans/0816-release-baseline-oldest-component-floor.md` already declined this; verification of `scripts/release-baseline-sha.sh` stays by direct execution.
- **The package-label drift in [#818] and the `actionlint` gate in [#819].**
  Both touch repo automation but neither touches release PR shape.

## Background

### What release-please actually does under separate PRs

Read from release-please's own source rather than inferred:

| Fact                                                                              | Source                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Component branch is `release-please--branches--<target>--components--<component>` | `src/util/branch-name.ts`, `COMPONENT_PATTERN`               |
| Default PR title pattern is `chore${scope}: release${component} ${version}`       | `src/util/pull-request-title.ts`, `DEFAULT_PR_TITLE_PATTERN` |

So a release PR for `pi-subagents` gets branch `release-please--branches--main--components--pi-subagents` and title `chore(main): release pi-subagents 19.3.6`.
The **component** is the `packages[<path>].component` value in `release-please-config.json`; for all nine packages it equals the package directory name, and it is already the string the tag is built from.

Matching on the branch suffix is therefore exact.
Matching on the title would require reimplementing release-please's pattern parser, so the design does not.

### The two tools that pick arbitrarily

`packages/pi-github-tools/src/lib/release.ts`:

- `findReleasePR` lists `gh pr list --label 'autorelease: pending' --limit 5` and returns `prs[0]`.
  With nine components the limit itself truncates, and `prs[0]` is whichever PR `gh` happened to order first.
- `watchRelease` runs `git tag --points-at HEAD` and returns `tags[tags.length - 1]` with a `// most recent tag` comment that the command does not support — `git tag` output is not ordered by recency.

The second is measurable today: `git tag --points-at pi-github-tools-v4.3.2` returns three tags (`pi-colgrep-v1.5.3`, `pi-github-tools-v4.3.2`, `pi-subagents-v19.3.4`), because a combined release commit carries one tag per released component.

`watchRelease` also derives `version:` as `tag.replace(/^v/, "")`.
Component tags have no leading `v`, so today the tool reports `version: pi-github-tools-v4.3.2` rather than `4.3.2`.
That is a live defect independent of this issue, sitting in the exact function this change opens.

### Prerequisite

[#816] has landed.
`scripts/release-baseline-sha.sh` now floors `last-release-sha` at the **oldest** component's release commit, derived from `.release-please-manifest.json`, so a deliberately deferred component's commits can no longer fall outside release-please's walk.
That is precisely the state separate PRs make routine, and it is why this issue depends on that one.

### AGENTS.md constraints that apply

- Pi loads each extension once at session start, so a session that edits `packages/pi-github-tools/src/` keeps running the pre-edit tool — restart before any step that calls `release_pr_find`.
- A slash command's expanded body is a snapshot from process start; after editing `.pi/prompts/ship-issue.md`, the on-disk file is authoritative.
- Do not name an unreleased version in docs.
- Commit messages carry `Refs #817`, never `Closes`.

## Design Overview

### `findReleasePR` — optional component, refuse to guess

```typescript
export interface FindReleasePRArgs {
  /** release-please component (package directory name) whose PR to return. */
  component?: string;
  timeout?: number;
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
}
```

The decision model on each poll, given the fetched list of open `autorelease: pending` PRs:

| `component` | open PRs                                            | result                                              |
| ----------- | --------------------------------------------------- | --------------------------------------------------- |
| given       | one whose branch ends `--components--<component>`   | that PR                                             |
| given       | none matching, but exactly one non-component branch | that PR — a combined PR covers every component      |
| given       | none matching, other components' PRs open           | keep polling, then `timeout: ... for component <c>` |
| omitted     | exactly one                                         | that PR (today's behavior)                          |
| omitted     | more than one                                       | `ambiguous:` — list them, pick none                 |
| omitted     | none                                                | keep polling, then `timeout:` (today's behavior)    |

The `ambiguous:` return is the safety net for a call site that forgot to thread the component.
It reuses the existing single-line-prefix convention (`timeout:`, `aborted:`) so a prompt can branch on it:

```text
ambiguous: 3 open release-please PRs; pass component to select one
  #142  pi-github-tools  chore(main): release pi-github-tools 4.4.0
  #143  pi-subagents  chore(main): release pi-subagents 19.3.6
  #144  (no component)  chore: release main
```

It returns immediately rather than polling — the state is settled, not pending.

The success block gains one line so the caller can confirm what it got:

```text
pr_number: 142
title: chore(main): release pi-github-tools 4.4.0
component: pi-github-tools
head_branch: release-please--branches--main--components--pi-github-tools
url: https://github.com/gotgenes/pi-packages/pull/142
mergeable: MERGEABLE
merge_state: BLOCKED
```

`--limit 5` becomes `--limit 30`: one PR per component, nine components today, headroom for the drift [#818] documents.

### `watchRelease` — optional component, keep the fallback

```typescript
export interface WatchReleaseArgs {
  /** release-please component whose tag to wait for. */
  component?: string;
  timeout?: number;
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
}
```

With a component, filter the tags on HEAD by the `<component>-v` prefix; if none matches, keep polling.
The `-v` in the prefix is load-bearing: `pi-subagents-v` does not match `pi-subagents-worktrees-v0.3.1`.

Without a component, keep the current last-tag fallback.
This is the deliberate asymmetry with `findReleasePR`: a multi-tag HEAD is the **normal** combined-PR state (measured above — three tags on the last release commit), so refusing there would regress a consumer who has not adopted separate PRs, whereas more than one open release PR simply cannot happen for them.

The filtering happens in TypeScript over the output of the unchanged `git tag --points-at HEAD`, not by switching to `git tag --list '<component>-v*'`.
That keeps the exact-git-args assertions in `test/lib/release.test.ts` meaningful instead of rewriting them around a new command.

### `version:` derivation

One shared helper, correct with or without a component:

```typescript
const VERSION_IN_TAG = /(?:^|-)v(?<version>\d[\w.+-]*)$/;

/** The bare version encoded in a release tag: `pi-subagents-v19.3.5` → `19.3.5`. */
function versionOf(tag: string): string {
  return VERSION_IN_TAG.exec(tag)?.groups?.version ?? tag;
}
```

It handles `v1.2.0`, `pi-github-tools-v4.3.2`, and a prerelease such as `pi-nocd-v1.0.0-rc.1`, and falls back to the raw tag for anything that does not encode a version.

### Where the helpers live

Both the branch-suffix parse and `versionOf` stay **private** to `src/lib/release.ts`.
Neither is a collaborator — no new state, no new interface, no consumer outside this file — so extracting a module for two small pure functions would add a boundary that buys nothing, and `pnpm fallow dead-code` would flag the exports until a second caller appeared.
No shared interface or layer wiring changes, so the `design-review` checklist has no seam to examine here.

### Call site the prompts will use

```text
release_pr_find { component: "pi-github-tools" }   # <pkg> from the plan path
→ pr_number: 142 … component: pi-github-tools
release_pr_merge { pr_number: 142 }                # unchanged
release_watch   { component: "pi-github-tools" }
→ tag: pi-github-tools-v4.4.0  version: 4.4.0
```

`release_pr_merge` needs no component: it takes a PR number, which the find step has already disambiguated.

### Compatibility

| Consumer state                               | Before                 | After                                                      |
| -------------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| Combined PR, no component passed             | the one PR             | the one PR, plus a `component: (none)` line                |
| Component-scoped tag, no component passed    | `version: pi-x-v1.2.3` | `version: 1.2.3`                                           |
| Combined PR, component passed                | n/a                    | the one PR (non-component fallback)                        |
| Combined release commit, no component passed | last tag on HEAD       | last tag on HEAD                                           |
| Several release PRs, no component passed     | arbitrary              | `ambiguous:` (a state that cannot occur without this flip) |

The `component:` line is added to **every** success block, not only when a component was passed, and the `version:` correction applies to every component-scoped tag.
Those two are why the change carries a `fix:` commit alongside the `feat:` ones rather than being purely additive.
Neither is breaking: the first is an added line in an unstructured text block no caller parses positionally, and the second replaces a value that was wrong.

### Rollout and canary

The config flip is the second-to-last commit, after the tools and prompts already understand component-scoped PRs.

[rp-2773] is the reason for a canary rather than a plain flip.
It reports a 422 when release-please **updates** an already-open PR under separate PRs: the branch push succeeds, then `POST /pulls` for that branch fails because the PR exists.
The version distance implied by the issue body does not hold up — `googleapis/release-please-action@v5` resolves to tag `v5.0.0`, whose `package-lock.json` pins `release-please` at **17.6.0**, the exact version the report was filed against (the reporter also reproduced on v4).
The report is open with zero comments.
It matters here because the action calls `createReleases()` before `createPullRequests()`, so a throw in the update phase can leave tags created with `releases_created` unset — the [#646] cascade that skips `publish`.

The canary is therefore a **second push**, not an extra assertion:

1. Ship steps 1–5 in one push.
   CI creates `pi-github-tools`' component release PR (the *create* path).
2. Push step 6's `docs(pi-github-tools):` commit alone.
   It touches `packages/pi-github-tools/README.md` — inside the package, not excluded, and an unhidden changelog type — so it changes the open PR's body and forces the *update* path that [rp-2773] describes.
3. Confirm the `release-please` job is green and the PR body gained the `docs:` entry.

Rollback, if it 422s: set `separate-pull-requests` back to `false`, push, then close any component release PRs by hand and delete their branches (release-please does not reconcile abandoned component branches into the combined branch).
The tools' component parameters stay harmless under a combined PR, so only the config line reverts.

## Module-Level Changes

| File                                                    | Change                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `release-please-config.json`                            | Add `"separate-pull-requests": true`                                                                                                                                                                                                                                                                                                                                     |
| `packages/pi-github-tools/src/lib/release.ts`           | `FindReleasePRArgs.component`, `WatchReleaseArgs.component`; branch-suffix match; `ambiguous:` result; `--limit 5` → `--limit 30`; `component:` output line; private `versionOf` replacing `tag.replace(/^v/, "")`; correct the misleading `// most recent tag` comment                                                                                                  |
| `packages/pi-github-tools/src/tools/release-pr-find.ts` | Optional `component` string parameter; description names the disambiguation                                                                                                                                                                                                                                                                                              |
| `packages/pi-github-tools/src/tools/release-watch.ts`   | Optional `component` string parameter                                                                                                                                                                                                                                                                                                                                    |
| `packages/pi-github-tools/test/lib/release.test.ts`     | New `findReleasePR` and `watchRelease` cases (see TDD Order)                                                                                                                                                                                                                                                                                                             |
| `packages/pi-github-tools/README.md`                    | `release_pr_find` and `release_watch` parameter tables gain `component`; document the `ambiguous:` result and the corrected `version:`; refresh the "Typical workflow" snippet (lines 159–161)                                                                                                                                                                           |
| `.pi/skills/package-pi-github-tools/SKILL.md`           | Note that `release.ts` selects PR and tag by component                                                                                                                                                                                                                                                                                                                   |
| `.pi/prompts/ship-issue.md`                             | §6.1 pass `component: <pkg>`; §6.3 rework (a PR now bumps exactly one component — verify it is `<pkg>`; a sibling component's open PR is normal, not a misconfiguration); §6.5 pass `component`; §4b deferral now holds one package; line 81's `chore: release main` → `chore(main): release <component> <version>`; Constraints bullet on "multiple release-please PRs" |
| `.pi/prompts/land-worktree.md`                          | §6.2 pass `component: <pkg>`; §6.3 pass `component`; the "single release-please PR" framing in the §6 preamble                                                                                                                                                                                                                                                           |
| `.pi/prompts/ship-no-issue.md`                          | §5.1 has no `<pkg>` — call without a component and, on `ambiguous:`, ask the operator which to merge; §5.4 unchanged call gains no component; Constraints bullet                                                                                                                                                                                                         |
| `AGENTS.md`                                             | Line 165–170 release-batching paragraph (per-package deferral); line 170's `chore: release main` subject; line 238 and the worktree guardrail's "the single release-please PR"; add the [rp-2773] symptom and the one-line rollback beside the [#646] runbook                                                                                                            |
| `README.md` (root)                                      | Line 209 "the single release-please PR"; line 195 Mermaid label                                                                                                                                                                                                                                                                                                          |

### Greps run before finalizing this list

| Grep                                                                                                                   | Purpose                             | Result                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `release_pr_find\|release_pr_merge\|release_watch\|release-please PR\|autorelease` across `*.md`/`*.ts`/`*.yml`/`*.sh` | every mechanism reference           | the files above, plus `docs/triage/` and an archived plan (both historical, left alone)                        |
| `chore: release main\|chore(main)`                                                                                     | the release commit subject in prose | `AGENTS.md:170`, `.pi/prompts/ship-issue.md:81`, plus test fixtures                                            |
| `the single release\|release batch\|Release batches`                                                                   | batching prose                      | `AGENTS.md`, root `README.md`, `.pi/prompts/plan-improvements.md`, `.pi/skills/improvement-discovery/SKILL.md` |

`plan-improvements.md` and `improvement-discovery/SKILL.md` describe how batches are *authored*, which this change does not alter, so they stay as they are.
No export is removed or renamed, so no consumer-breakage grep is owed.

## Test Impact Analysis

The change adds parameters rather than extracting a layer, so there is no previously-impossible unit test being unlocked and no existing test made redundant.

New tests, all offline through the mocked `runCommand`:

- `findReleasePR` selects the PR whose branch ends `--components--<component>` when several are open.
- `findReleasePR` falls back to a lone non-component-branch PR when a component is requested (the combined-PR consumer).
- `findReleasePR` keeps polling when other components' PRs are open but the requested one is absent, and its timeout line names the component.
- `findReleasePR` returns `ambiguous:` listing every candidate when no component is given and more than one PR is open.
- `findReleasePR` requests `--limit 30`.
- `watchRelease` selects `<component>-v*` from a multi-tag HEAD, and does not match `pi-subagents-v` against `pi-subagents-worktrees-v0.3.1`.
- `watchRelease` keeps polling when the component's tag is absent but siblings' tags are present.
- `versionOf` through `watchRelease`: `pi-github-tools-v4.3.2` → `4.3.2`, `v1.2.0` → `1.2.0`, prerelease preserved.

Tests that must stay exactly as they are, because they pin the no-component contract this change promises not to move: "finds a release-please PR on first poll", "returns timeout when no PR appears", "returns when a tag is found on HEAD" (including its three `toHaveBeenNthCalledWith` git-args assertions), and "returns timeout when no tag appears".

The prompt changes prescribe one new shell command, dry-run at planning time:

```bash
git log --oneline --grep='^chore(main): release'
```

It currently matches early single-package release commits (`414fe6ae`, `5569f50a`, `901a1f84`) and nothing from the combined era, which is the expected pre-flip state; after the flip every release commit matches.

## Invariants at risk

| Invariant                                                                                                   | Origin                                      | Pinned by                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A failed merge call reports `merged: false` / `merged: unknown` rather than guessing                        | [#764]                                      | `test/lib/release.test.ts` → "when the merge call itself fails" block; `mergeReleasePR` is untouched here                                                                                                                                                               |
| Retry backoff is charged against the caller's `timeout`                                                     | [#764]                                      | "charges the retry backoff against the timeout"; the new `ambiguous:` early return sits after the fetch, so it cannot bypass the accounting                                                                                                                             |
| `release_pr_merge` waits out an in-progress check instead of refusing                                       | [#673]                                      | `merge-state.test.ts`; `classifyMergeState` is untouched                                                                                                                                                                                                                |
| `watchRelease` issues exactly `git fetch --tags`, `git tag --points-at HEAD`, `git rev-parse HEAD`          | `docs/plans/0005-abort-signal-threading.md` | "returns when a tag is found on HEAD" — the reason the component filter is applied in TypeScript rather than by changing the git command                                                                                                                                |
| `last-release-sha` floors at the oldest component's release, not the newest                                 | [#816]                                      | No test exists (that plan declined a shell-script harness). Verify by running `./scripts/release-baseline-sha.sh` before and after the flip and confirming identical output — it reads `.release-please-manifest.json` and tags, neither of which the PR shape touches. |
| `scripts/publish-released.sh` derives the publish list from `paths_released` with no hardcoded package list | AGENTS.md § Monorepo Structure              | Read at planning time: under separate PRs each merge yields a single-entry array, which the existing `mapfile`/loop already handles. No change needed.                                                                                                                  |

## TDD Order

Each step lands red and green in one commit, matching `docs/plans/0764-transient-retry-and-merge-verification.md` — no red-only commit reaches `main`.

1. **Select the release PR by component.**
   Test surface: `test/lib/release.test.ts`, `findReleasePR` block.
   Covers branch-suffix selection, the combined-PR fallback, polling past a non-matching set with a component-naming timeout, the `ambiguous:` listing, the new `component:` output line, and `--limit 30`.
   Also updates `src/tools/release-pr-find.ts` in the same commit — the parameter and its consumer cannot land apart.
   Commit: `feat(pi-github-tools): select the release PR by component (#817)`
2. **Select the release tag by component.**
   Test surface: `test/lib/release.test.ts`, `watchRelease` block.
   Covers `<component>-v` filtering on a multi-tag HEAD, the `pi-subagents` / `pi-subagents-worktrees` prefix case, polling while the component's tag is absent, and the preserved no-component fallback.
   Updates `src/tools/release-watch.ts` in the same commit.
   Commit: `feat(pi-github-tools): select the release tag by component (#817)`
3. **Report the bare version for a component-scoped tag.**
   Test surface: `test/lib/release.test.ts`.
   Introduces `versionOf` and covers `pi-github-tools-v4.3.2` → `4.3.2`, `v1.2.0` → `1.2.0`, a prerelease, and an unrecognized tag falling back to itself.
   Separate from step 2 because it changes observable output for a state that already exists today.
   Commit: `fix(pi-github-tools): report the bare version for a component-scoped release tag (#817)`
4. **Thread the component through the workflow prompts.**
   No test surface — prose.
   Updates `.pi/prompts/ship-issue.md`, `.pi/prompts/land-worktree.md`, `.pi/prompts/ship-no-issue.md`, `AGENTS.md`, and the root `README.md`, each per the Module-Level Changes rows.
   Lands before the flip so the workflow is ready the moment separate PRs appear.
   Verify with `pnpm exec rumdl check` on each edited file and by re-running the dry-run grep above.
   Commit: `docs: thread the release component through the ship and land prompts (#817)`
5. **Flip the config.**
   Edits `release-please-config.json` only.
   Verify `./scripts/release-baseline-sha.sh` prints the same SHA as before the edit, and that the file still validates against its `$schema`.
   Commit: `chore: release each package in its own pull request (#817)`
6. **Package docs — held back as the canary.**
   Updates `packages/pi-github-tools/README.md` and `.pi/skills/package-pi-github-tools/SKILL.md`.
   Do **not** include this commit in the same push as steps 1–5.
   Push steps 1–5, let CI create `pi-github-tools`' component release PR, then push this commit alone and confirm the `release-please` job stays green while the PR body gains the `docs:` entry — the [rp-2773] update path.
   Commit: `docs(pi-github-tools): document component selection for the release tools (#817)`

## Risks and Mitigations

| Risk                                                                                                              | Mitigation                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [rp-2773]'s 422 on PR update fires here, failing the `release-please` job after tags exist and skipping `publish` | Step 6 is a deliberate canary for exactly that path, run as a separate second push while nothing else is in flight; the [#646] recovery runbook already covers a stranded publish; the rollback is one config line                                                                     |
| Manifest conflicts between concurrent component PRs ([rp-1870], [rp-1502])                                        | Only adjacent lines in `.release-please-manifest.json` conflict, and release-please force-pushes open release branches from `main`, so it should self-heal on the next push; the documented fallback (strip `autorelease: pending`, re-run) goes into `AGENTS.md` next to the rollback |
| The `/tdd-plan` session keeps running the pre-edit `release_pr_find`, so `/ship-issue` exercises the old tool     | Restart Pi between implementation and ship — AGENTS.md § Stale in-process extension code; the plan's ship note repeats it                                                                                                                                                              |
| `/ship-issue`'s expanded body is a pre-edit snapshot after step 4                                                 | The on-disk prompt is authoritative — AGENTS.md § Stale prompt-template expansion                                                                                                                                                                                                      |
| A prompt call site forgets the component and merges the wrong package's release PR                                | The `ambiguous:` refusal makes a forgotten component a visible stop rather than an arbitrary merge                                                                                                                                                                                     |
| `--limit 30` still truncating as packages are added                                                               | Nine components today; [#818] tracks package-count drift separately, and the `ambiguous:` listing would surface a truncation as a wrong-looking candidate set rather than a silent pick                                                                                                |
| `watchRelease`'s new filter changing the git commands and silently voiding the exact-args assertions              | The filter runs in TypeScript over unchanged `git tag --points-at HEAD` output, and the three `toHaveBeenNthCalledWith` assertions stay untouched as the guard                                                                                                                         |
| The flip landing while a combined release PR is open, orphaning it                                                | Verified none is open at planning time (`gh pr list --label 'autorelease: pending'` → `[]`, and every post-tag commit is in `exclude-paths`); re-check immediately before step 5                                                                                                       |

## Open Questions

- Whether [rp-2773] reproduces on this repo's configuration — a PAT rather than a GitHub App token, flat component names rather than slash-bearing ones, and the default title pattern rather than a custom one.
  Step 6's canary answers it empirically; there is nothing further to determine from documentation.
- Whether the manifest conflict of [rp-1870] genuinely self-heals at this repo's CI cadence.
  It cannot be provoked before two components have pending releases simultaneously, so it is observed rather than tested.
- Whether peers should eventually be allowed to merge their own package's release PR, now that releases no longer share one.
  Left as-is deliberately: the root keeps serializing release merges, and revisiting it is a workflow question rather than a tooling one.

[#625]: https://github.com/gotgenes/pi-packages/issues/625
[#646]: https://github.com/gotgenes/pi-packages/issues/646
[#673]: https://github.com/gotgenes/pi-packages/issues/673
[#764]: https://github.com/gotgenes/pi-packages/issues/764
[#816]: https://github.com/gotgenes/pi-packages/issues/816
[#818]: https://github.com/gotgenes/pi-packages/issues/818
[#819]: https://github.com/gotgenes/pi-packages/issues/819
[rp-1412]: https://github.com/googleapis/release-please/pull/1412
[rp-1502]: https://github.com/googleapis/release-please/issues/1502
[rp-1870]: https://github.com/googleapis/release-please/issues/1870
[rp-2773]: https://github.com/googleapis/release-please/issues/2773
