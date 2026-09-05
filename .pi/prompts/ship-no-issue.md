---
description: Push, verify CI, and dispatch the release (no issue to close)
---

# Ship (no issue)

## 1. Sync with remote

Before pushing, make sure local `HEAD` is current with the remote:

1. Run `git pull --ff-only`.
2. If it fails for **any** reason — uncommitted changes, divergent history, merge conflict, network error, detached HEAD — stop immediately and report the failure to the user.
   Do not attempt to stash, rebase, force, or otherwise resolve.
3. Only proceed once the pull reports a clean fast-forward (or `Already up to date.`).

## 2. Pre-push checks

Run from the **repo root** (not a package subdirectory):

1. `pnpm run lint` — catches cross-package lint violations CI runs at root level; package-level `pnpm run lint` may miss sibling-package issues.
2. `pnpm fallow dead-code` — CI runs this gate on every `main` push (not on PRs), so a pre-existing failure blocks your push regardless of whether this work introduced it.

If either fails, fix the issues and commit before pushing.

## 3. Push

- Determine the current branch (`git branch --show-current`).
- `git push`.
- If the push is rejected as non-fast-forward, stop and report — do not force-push.

## 4. Verify CI on the pushed commit

Read the `## 7. Verify CI on the pushed commit` section of `.pi/prompts/ship.md` and follow it, with one difference: there is no worktree lane here, so the fix-forward rule for a failed ff-merge does not apply.
On a `failure` conclusion, stop and report — do not release anything.

That section is the single source for the SHA discipline this step depends on (pass the exact `git rev-parse HEAD` value, never hand-expand a short SHA, do not measure its shape, re-check the SHA on a `ci_find` timeout).

## 5. Dispatch the release (if anything is releasable)

The package set is derived differently here, because there is no issue plan to name it:

1. Ask which packages have releasable commits:

   ```bash
   for pkg in $(ls packages); do ./scripts/release/next-version.sh "$pkg"; done
   ```

   Each package prints the tag it would cut, or nothing.
2. If none prints a tag, skip to step 6.
3. **Show the operator the list and ask which to release** — do not release everything that happens to be releasable.

With the set confirmed, read the `## 10. Dispatch the release` section of `.pi/prompts/ship.md` (from its dispatch command onward) and the `## 11. Verify the release run` section, and follow both.
Skip the path-based package derivation in section 10 — steps 1–3 above replace it.

## 6. Final report

Print:

- The new HEAD on `main` (`git log --oneline -1`).
- The released version, if a release commit just landed (`git tag --points-at HEAD` or read `package.json`).
- Anything that was skipped and why.

## Constraints

- Never force-push.
- Never release a package without the operator's confirmation here — with no issue plan, nothing in this flow says which packages the push was for.
- Never name a package in the release dispatch that `next-version.sh` reports nothing for — the run refuses it and no package releases.
- Never re-dispatch a release after `prepare` succeeded; the tags exist and the run would refuse on them.
- If CI fails, do not release anything.
