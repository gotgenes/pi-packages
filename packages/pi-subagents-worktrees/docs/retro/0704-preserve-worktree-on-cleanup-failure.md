---
issue: 704
issue_title: "cleanupWorktree silently discards work when the fallback commit fails"
---

# Retro: #704 — cleanupWorktree silently discards work when the fallback commit fails

## Stage: Implementation — TDD (2026-08-05T16:03:24Z)

### Session summary

Implemented both plan steps as two `fix:` commits plus a `docs:` commit: `cleanupWorktree`'s `catch` block now leaves the worktree in place and returns `{ hasChanges: false, path, error }` instead of force-removing it, and `WorktreeWorkspace.dispose` surfaces `result.error` in the result addendum (checked before the existing `hasChanges` branch).
Two TDD cycles completed exactly as planned; test count went from 26 to 28 in `pi-subagents-worktrees`.
The `tidy-first-assessor` found no preparatory refactoring warranted, and the `pre-completion-reviewer` returned `Overall: PASS`.

### Observations

- Both new tests needed the pre-commit-hook trigger to install at `repoDir/.git/hooks/pre-commit`, not `wt.path/.git/hooks/pre-commit` — a worktree's `.git` is a file (not a directory) pointing back at the main repo's `.git`, since worktrees share hooks with the main repo.
  The first attempt hit `ENOTDIR` writing to the non-existent worktree-local hooks path; the plan's Test Impact Analysis correctly named "install a `.git/hooks/pre-commit`" as the trigger mechanism but didn't call out which repo root to install it under — worth noting for anyone reusing this pattern.
- Pre-completion reviewer: **PASS** — all deterministic checks, docs, code design, and test-artifact checks passed; no WARN findings.
- README's "Behavior" section already documented the dispose addendum wording, so per the plan's conditional README instruction, the new failure-path addendum text was added there as a separate `docs:` commit.
- No `docs/architecture/` directory exists for this package, so no architecture-doc update was needed.
