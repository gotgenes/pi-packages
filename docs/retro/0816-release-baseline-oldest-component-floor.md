---
issue: 816
issue_title: "release-please last-release-sha baseline can advance past a component's unreleased commits"
---

# Retro: #816 — release-please last-release-sha baseline can advance past a component's unreleased commits

## Stage: Planning (2026-08-27T17:59:08Z)

### Session summary

Confirmed the reported defect against release-please's own source rather than inference, measured the current four-release drift across all nine components, and produced `docs/plans/0816-release-baseline-oldest-component-floor.md`.
The operator's clarification gate settled three design calls (extracted script, `package.json`-add-commit fallback for untagged components, `continue-on-error` containment) and then folded a GitHub Actions freshness sweep plus a Dependabot watcher into the same issue.
Six-step build plan; no follow-up issues filed, since every spun-off concern landed inside #816.

### Observations

- **The diagnosis was verified, not assumed.**
  Reading `buildPullRequests` and `commitsAfterSha` in release-please's `src/manifest.ts` showed the floor commit is excluded by a `break` placed before the `commits.push`, and that a component whose release sha never enters the window falls through `findIndex`'s `-1` branch.
  That confirmed the issue's framing exactly and gave the plan a mechanism rather than a restatement.
- **Two CI facts would have broken the issue's suggested script.**
  The `release-please` job's checkout has no `fetch-depth`, so it runs shallow with no tags (`actions/checkout` defaults to `fetch-depth: 1`, `fetch-tags: false`), and the tags for components released in the same run are created via the API after checkout.
  The plan adds `fetch-depth: 0` and an explicit `git fetch --tags`.
  This is the AGENTS.md rule about verifying a plan's enumerated external facts against the real surface paying off.
- **The bound turned out to be free, and that is measured.**
  release-please already stops at `releaseCommitsFound >= expectedShas`, which lands on the same commit as the corrected floor (`f9499771`, 162 commits from HEAD against the 500 at which #468 failed).
  So the fix adds zero slack to the walk — a much stronger argument than "162 is probably fine."
- **`merge-base --octopus` was chosen over the issue's timestamp sort.**
  A common ancestor is at-or-before every input by construction, so it stays a safe floor even if history stops being linear; a timestamp sort carries no such guarantee.
  The two agree on today's rebase-merged history.
- **The missing-tag case is a documented flow, not a hypothetical.**
  AGENTS.md's new-package procedure adds a package at `0.0.0` before its first publish, so the issue's "fail loudly" suggestion would have reddened the write-back on every new package.
  The operator chose flooring at the `package.json`-adding commit, which is the genuinely correct floor for a never-released component.
- **An annotated-tag artifact nearly became a false finding.**
  The first pass at the Actions audit read `pnpm/action-setup@v6` and `github-script@v9` as stale floating tags, because `git/ref/tags/X` returns the *tag object* sha for annotated tags.
  Peeling through `git/tags/<sha>` showed both were current.
  Worth remembering for any future pin audit.
- **`setup-node` v7 turned out to matter more than a routine bump.**
  Its "Remove dummy `NODE_AUTH_TOKEN` export" fix targets exactly this repo's publish configuration — Trusted Publishing via OIDC with no `NODE_AUTH_TOKEN` secret — where v6 injects a placeholder into `.npmrc`.
  A version-number-only reading would have missed that.
- **Scope was widened deliberately by the operator, not drifted into.**
  The gate offered keeping #816 pure; the operator chose to fold the three bumps and the Dependabot config in.
  Recorded here because the plan's shape (six commits spanning three unrelated concerns) otherwise reads like scope creep.
- **Two pre-existing hazards in the write-back step were cleared while it was open**: the `github.sha` fallback that could write HEAD as the baseline, and the `set -euo pipefail` failure path that makes GitHub skip `publish` (the #646 cascade).
- **No test harness exists for repo-root shell scripts**, matching `scripts/publish-released.sh`.
  The plan verifies by direct execution against the live repo plus a synthetic `/tmp` repo for the missing-tag branch, and leaves the harness question open for both scripts together rather than deciding it as a side effect.
- **Next stage is `/build-plan`, not `/tdd-plan`** — there is no vitest surface anywhere in this change.

## Stage: Implementation — Build (2026-08-27T18:51:18Z)

### Session summary

Executed all six planned steps, then three more from review and operator feedback, for nine commits total.
The baseline now derives from the manifest via `scripts/release-baseline-sha.sh`, the write-back lives in `scripts/advance-release-baseline.sh`, the checked-in `last-release-sha` moved back to the oldest component's release, three GitHub Actions were bumped, and Dependabot now watches them.
Pre-completion reviewer: **PASS** on the third pass, after WARN on the first two.

### Observations

- **Both WARN rounds found real defects, and the second overturned my reasoning.**
  Round one caught that the separate `Fetch tags` step had no `continue-on-error`, reintroducing the #646 cascade at a new location the plan's containment section never analyzed.
  Round two caught that the `publish-released.sh` precedent I cited to justify leaving `advance-release-baseline.sh` unguarded does not transfer — that script's `RELEASES` env-var requirement is an *incidental* guard against bare invocation, which the new script lacked.
  Both were things a self-review had already passed over.
- **The reviewer's suggested fix for its own finding would have been worse.**
  Adding `continue-on-error: true` to the fetch step looks like the obvious fix, but a silently skipped fetch makes just-released components look untagged, so the derivation floors them at their `package.json`-adding commits and the walk explodes past the #468 threshold.
  Folding the fetch into the write-back step was the correct containment, because `pipefail` then stops before the derivation runs.
  Worth remembering that a finding can be right while its proposed remedy is not.
- **Verification was by execution, not inspection, throughout.**
  Every branch of both scripts was exercised against synthetic `/tmp` repos — untagged fallback, config `component` differing from path basename, empty and malformed manifests, a component with neither tag nor `package.json`, and disjoint histories with no common ancestor.
  The write-back's commit-and-push path was proven against a local bare remote rather than reasoned about.
- **`mapfile` was a real portability defect, not a theoretical one.**
  Stock macOS `/bin/bash` is 3.2 and has no `mapfile`; the script only worked because the shebang picks up Homebrew bash.
  Since AGENTS.md's #646 recovery tells an operator to hand-run a script from `scripts/`, the `while IFS= read -r` rewrite was worth the three lines.
- **Peeling annotated tags changed the Actions audit.**
  `gh api git/ref/tags/X` returns the *tag object* SHA for annotated tags, which made `pnpm/action-setup@v6` and `github-script@v9` look like stale floating tags on the first pass.
  After dereferencing through `git/tags/<sha>`, both were current and only three of five pins actually needed bumping.
- **`setup-node` v7 was more than a routine bump.**
  Its "Remove dummy `NODE_AUTH_TOKEN` export" fix targets exactly this repo's `publish` job — Trusted Publishing over OIDC with no `NODE_AUTH_TOKEN` secret — where v6 injects a placeholder into `.npmrc`.
  Reading release notes rather than version numbers is what surfaced it.
- **Two deviations from the plan, both operator-directed.**
  The plan's step 2 kept the tag fetch as its own workflow step; review moved it inside the write-back.
  The plan had no extraction step at all; the operator asked for the inline shell to become a script, so `scripts/advance-release-baseline.sh` and its `CI`/`ALLOW_LOCAL_PUSH` guard are additions the plan never named.
  Every `run:` in `ci.yml` is now a one-liner.
- **The plan's own "both call sites" phrasing was slightly wrong** — `actions/checkout` has three call sites in `ci.yml`, not two.
  A global substitution handled it, but a hand-edit following the plan literally would have missed one.
- **Filed [#818]** for the auto-labeler, found while surveying `label-issues.yml` for extraction candidates: it knows 4 of 9 packages while all 9 `pkg:*` labels exist, so issues about `pi-colgrep`, `pi-nocd`, `pi-permission-model-judge`, `pi-session-tools`, and `pi-subagents-worktrees` are never auto-labeled. #816's own four `pkg:*` labels are an artifact of the same `body.includes` matching, on a change that touches no package source.
  Extraction of that JS is folded into the same issue, because it needs an `actions/checkout` step the workflow currently lacks and the manifest-driven list needs that checkout anyway.
  `roadmap-fit` exited at step 1: no `pkg:*` label and a repo-root plan mean no resolvable package, so no phase disposition was recorded.
- **The `last-release-sha` value in the config is a measurement with a shelf life.**
  It was recomputed at implementation time rather than copied from the plan, and it will need recomputing again if this sits unmerged while releases land.

[#818]: https://github.com/gotgenes/pi-packages/issues/818
