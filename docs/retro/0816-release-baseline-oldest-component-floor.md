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
