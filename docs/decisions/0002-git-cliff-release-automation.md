---
status: accepted
date: 2026-09-01
issue: 865
---

# 2. Release with git-cliff from a dispatched workflow

## Status

Accepted.

## Context

Issue [#865] reported that release-please's commit walk had grown from 1 commit to 434 with no mechanism to shrink, and that it was re-entering the depth regime that produced the `Bad credentials` failure [#468] fixed.

Investigation confirmed the symptom and reframed the cause twice.

**The walk does not grow without bound.**
It self-caps at `commit-search-depth`, whose default is 500.
But `mergeCommitIterator` pages `commit-batch-size` commits per GraphQL request, default 10, so 500 commits is **50 requests** — the burst at which [#468] failed.
The measured depth was 436, or 44 requests.
The ceiling was real, close, and a ceiling rather than a ramp.

**The requests never needed to exist.**
release-please reads commits over the GitHub API because it is built to run as a bot with no checkout.
The `release-please` job has had `fetch-depth: 0` since [#816] — a full clone with tags — and release-please never looked at it.

**The felt cost was latency, not the walk.**
Measured end to end, work-to-published was 14, 14, 14, and 24 minutes across the last four releases.
The `publish` job accounts for 27–30 s of that.
The rest is the two-CI-cycle release-PR round trip: `check` (128–163 s) plus `release-please` (117–173 s), a human merge, then both jobs again.

Three fixes were considered and rejected:

- **A tighter `last-release-sha` floor.**
  Reading `commitsAfterSha` in release-please 17.6.0 showed the necessary invariant is "floor at or before every component's oldest *unreleased* commit", not [#816]'s "floor at the oldest *release* commit" — 113 commits rather than 436.
  Correct, and it addresses 2.3 minutes of a 14–24 minute cycle.
- **`commit-batch-size: 50`**, cutting 44 requests to 9.
  Same objection.
- **release-please's own `LocalGitHub` backend** (`--local`), which replaces the GraphQL walk with one `git log`.
  This removes the walk entirely but keeps the release-PR round trip, and `googleapis/release-please-action@v5.0.0` exposes no input for it, so it already required dropping the action.

Changesets was also considered.
It eliminates history walking permanently, but it abandons conventional-commit-derived changelogs and needs pnpm ≥ 11.13 for the workspace-native path (this repo is on 11.5.2).

## Decision

Release with [git-cliff](https://git-cliff.org), driven by a `workflow_dispatch` workflow that takes an **explicit package list** and an optional expected-SHA guard.

git-cliff derives each component's version and changelog from tags and local history:

```bash
git-cliff --tag-pattern "^<pkg>-v" --include-path "packages/<pkg>/**" \
  --exclude-path ... --bumped-version
```

Verified before anything was deleted: this reproduces all nine components' current versions exactly, in 9.4 s, with no network.

The package list is explicit because several packages can be releasable at once — parallel worktrees make that normal — and releasing one must never drag a sibling along.
Deferring a release is now simply not naming the package, which replaces "leave the release-please PR unmerged" with an act rather than an omission.

`release-please-config.json`, `.release-please-manifest.json`, `last-release-sha`, both baseline scripts, and the write-back step are removed. [#468], [#646], [#816], and [#865] were all one cause.

`pi-github-tools` loses `release_pr_find`, `release_pr_merge`, and `release_watch`, a breaking change.
A dispatched release is an ordinary Actions run, so the existing `ci_find` and `ci_watch` follow it unchanged.

## Consequences

**Latency.**
One run — git-cliff (< 1 s per package), publish (~30 s), plus setup — instead of two CI cycles and a human merge.

**The release-PR review gate is gone.**
This is the trade that buys the latency, and it is the decision's main cost.
It is partly offset by something release-please could not do at all: `scripts/release/next-version.sh <pkg>` answers "what would release?"
locally, offline, before anything is dispatched.

**Exclusions became a convention.**
`docs/{plans,retro,architecture,decisions,assets}` per package, verified to reproduce the retired hand-maintained `exclude-paths` array exactly.
Adding a docs subdirectory no longer requires a config edit.

**Breaking changes on hidden types need `protect_breaking_commits`.**
History contains `refactor(pi-subagents)!:`.
Under release-please a `!` forced a major even on a hidden type; git-cliff reproduces that only with this setting.
Without it, such a commit is dropped by the `skip` parser and produces no release at all — confirmed against a synthetic repository.

**The changelogs are not regenerated.**
Regeneration was the original plan and was abandoned on measurement: it deletes 101 of 220 entries for `pi-permission-system` and 71 of 192 for `pi-subagents`.
Two causes, neither fixable by configuration. 153 entries predate this repository — these packages were consolidated from separate repos and only the changelog text came across, as `MIGRATION.md` records — and roughly 45 tagged releases were cut entirely from `docs:` commits under paths added to `exclude-paths` later.
Each release is therefore spliced in below the header, and an HTML comment marks the boundary.

**npm Trusted Publishing must be repointed.**
The publisher was configured against `ci.yml` and the publish step now lives in `release.yml`.
This is an operator action on npmjs.org, per package, and it is the most likely way this migration fails in production.

**Two upstream hazard classes disappear**: the `separate-pull-requests` 422 (googleapis/release-please#2773) and the [#646] cascade where a failed post-release job silently skips `publish`.

**We now own the release scripts.**
Four shell scripts under `scripts/release/` replace a maintained action, and there is still no test harness for repo-root shell — the question [#816] left open, now with four more scripts behind it.

[#468]: https://github.com/gotgenes/pi-packages/issues/468
[#646]: https://github.com/gotgenes/pi-packages/issues/646
[#816]: https://github.com/gotgenes/pi-packages/issues/816
[#865]: https://github.com/gotgenes/pi-packages/issues/865
