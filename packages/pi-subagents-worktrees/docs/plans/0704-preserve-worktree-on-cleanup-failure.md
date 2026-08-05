---
issue: 704
issue_title: "cleanupWorktree silently discards work when the fallback commit fails"
---

# Preserve the worktree when cleanup fails partway

## Problem Statement

`cleanupWorktree` (`src/worktree.ts`) wraps its "changes exist" path — `git add -A`, `git commit`, branch creation — in a single `try` block.
Its `catch` cannot distinguish "genuinely nothing to do" from "something went wrong partway through": any exception anywhere in that sequence (a rejected pre-commit hook, a transient git error, a full disk) is caught, the worktree is unconditionally force-removed via `removeWorktree`, and the function returns `{ hasChanges: false }` — as if the agent had made no changes.
Since the commit never completed, nothing was ever written to the object database either; the agent's work is not merely "not merged," it is unrecoverable.
`git fsck` finds nothing.

This plan closes that specific hole: **never destroy a worktree whose fate is uncertain**.
It does not change what commands run inside the `try` block (see Non-Goals) — only what happens when one of them throws.

## Goals

- When any step inside `cleanupWorktree`'s changes-exist path throws, leave the worktree directory in place on disk instead of force-removing it.
- Report the failure back through the existing result contract (`WorktreeCleanupResult`) so the caller — ultimately `WorktreeWorkspace.dispose` — can surface it to the agent/user instead of silently reporting "no changes."
- Preserve all currently-passing behavior for the two genuinely-safe-to-remove cases: a confirmed-clean tree, and a confirmed-successful commit-and-branch.

## Non-Goals

- No `--no-verify` on the safety-net commit.
  Deliberately deferred — the fallback commit choosing to *ignore* a repo's pre-commit hook is a separate, more debatable design choice (should a mechanical safety-net commit really bypass the hooks a human commit in the same repo would face?) and is not needed to stop the data loss.
  Leaving the worktree in place is a strictly safer fix on its own: with it, a hook-rejected commit no longer destroys anything, regardless of whether the commit itself ever succeeds.
  If `--no-verify` is wanted later, it is a separate issue.
- No change to the happy-path commands themselves (`git add -A`, `git commit -m ...`, `git branch ...`) — only to what the `catch` block does when one of them throws.
- No change to `createWorktree`, `pruneWorktrees`, or the clean-tree branch of `cleanupWorktree`.
- No change to `WorktreeWorkspaceProvider.prepare` or its throw-on-creation-failure behavior.
- No retry logic (e.g. re-running the commit without the hook, or waiting and retrying on a transient error) — this plan only stops destructive cleanup on failure; recovery remains manual.

## Background

Confirmed still present in the current source (not just the `v0.2.3` release the issue was filed against):

```typescript
} catch (err) {
  debugLog("cleanupWorktree", err);
  try {
    removeWorktree(cwd, worktree.path);
  } catch (removeErr) {
    debugLog("removeWorktree on cleanup error", removeErr);
  }
  return { hasChanges: false };
}
```

The issue's reproduction (a pre-commit hook that mutates a file and exits non-zero) is one concrete trigger, but the `catch` is equally blind to any other exception in the block — a transient `git` failure, a full disk, a `branch` command failing for an unanticipated reason.
The fix targets the `catch`'s behavior, not any specific trigger.

`WorktreeCleanupResult` is consumed in exactly one place, `WorktreeWorkspace.dispose` (`src/workspace-provider.ts`):

```typescript
dispose(outcome: WorkspaceDisposeOutcome): { resultAddendum?: string } | undefined {
  const result = cleanupWorktree(this.repoCwd, this.info, outcome.description);
  if (result.hasChanges && result.branch) {
    return { resultAddendum: `\n\n---\nChanges saved to branch \`${result.branch}\`. Merge with: \`git merge ${result.branch}\`` };
  }
  return undefined;
}
```

Any new result field needs a corresponding branch here to actually reach the agent/user — an unread field on `WorktreeCleanupResult` would leave the bug's observable symptom (the agent sees nothing unusual happened) unchanged even after the worktree itself stops being destroyed.

## Design Overview

Add two optional fields to `WorktreeCleanupResult` — `error` and `path` — and populate them from the `catch` block instead of calling `removeWorktree`:

```typescript
export interface WorktreeCleanupResult {
  hasChanges: boolean;
  branch?: string;
  path?: string;
  /** Set when cleanup failed partway through; the worktree was left in place at `path`. */
  error?: string;
}
```

```typescript
} catch (err) {
  debugLog("cleanupWorktree", err);
  // Do NOT remove the worktree here — its state is uncertain and it may
  // contain uncommitted/staged work that would otherwise be lost with no
  // trace. Leave it on disk and report failure so the caller can decide
  // (e.g. surface the path to the user for manual recovery) instead of
  // silently discarding it.
  return {
    hasChanges: false,
    path: worktree.path,
    error: err instanceof Error ? err.message : String(err),
  };
}
```

`path` is already a documented field on the interface (currently only ever populated on the success path); the failure path reuses it to mean "the worktree that was left behind," which is consistent with its existing doc comment ("Worktree path if it was kept").

`WorktreeWorkspace.dispose` gains a branch to surface the failure:

```typescript
dispose(outcome: WorkspaceDisposeOutcome): { resultAddendum?: string } | undefined {
  const result = cleanupWorktree(this.repoCwd, this.info, outcome.description);
  if (result.error) {
    return {
      resultAddendum: `\n\n---\nWorktree cleanup failed and was left in place for manual recovery at \`${result.path}\`: ${result.error}`,
    };
  }
  if (result.hasChanges && result.branch) {
    return { resultAddendum: `\n\n---\nChanges saved to branch \`${result.branch}\`. Merge with: \`git merge ${result.branch}\`` };
  }
  return undefined;
}
```

The `error` check is ordered first so it cannot be shadowed by a stale `hasChanges`/`branch` value — the two branches are mutually exclusive by construction (the error return never sets `branch`), but checking `error` first keeps the precedence explicit and self-evident at the call site.

### Result matrix (unchanged rows preserved, new row added)

| Scenario                                  | `hasChanges` | `branch` | `path` | `error` | Worktree fate           |
| ----------------------------------------- | ------------ | -------- | ------ | ------- | ----------------------- |
| Clean tree                                | `false`      | —        | —      | —       | removed                 |
| Dirty, commit + branch succeed            | `true`       | set      | set    | —       | removed                 |
| Already-deleted worktree                  | `false`      | —        | —      | —       | n/a (never existed)     |
| Any step in the changes-exist path throws | `false`      | —        | set    | set     | **left in place (new)** |

## Module-Level Changes

- `packages/pi-subagents-worktrees/src/worktree.ts`
  - Add `error?: string` to `WorktreeCleanupResult`; update the `path` field's doc comment to note it is also populated on the failure path.
  - Rewrite the outer `catch` block in `cleanupWorktree`: remove the nested `try { removeWorktree(...) } catch { ... }` call entirely, return `{ hasChanges: false, path: worktree.path, error: ... }` instead.
  - No change to `createWorktree`, `removeWorktree`, `pruneWorktrees`, or the clean-tree/success branches of `cleanupWorktree`.
- `packages/pi-subagents-worktrees/src/workspace-provider.ts`
  - `WorktreeWorkspace.dispose`: add the `result.error` branch (ordered before the existing `hasChanges` check), per the sketch above.
- `packages/pi-subagents-worktrees/test/worktree.test.ts`
  - New test: cleanup that throws partway (see TDD Order) asserts the worktree directory still exists on disk, `result.hasChanges` is `false`, `result.error` is a non-empty string, and `result.path` equals the worktree path.
- `packages/pi-subagents-worktrees/test/workspace-provider.test.ts`
  - New test: `dispose` on a cleanup failure returns a `resultAddendum` containing the worktree path and does not remove the worktree directory.
- `packages/pi-subagents-worktrees/README.md`
  - If the README documents `WorktreeCleanupResult` or the dispose addendum's wording (check before editing) — add the new failure-path addendum text; otherwise no change needed.

No other module references `WorktreeCleanupResult` or calls `cleanupWorktree`.

## Test Impact Analysis

1. **New tests enabled:**
   - `worktree.test.ts` — "leaves the worktree in place when the changes-exist path throws," asserting non-destruction, `error` populated, `path` populated, `hasChanges: false`.
   - `workspace-provider.test.ts` — "dispose surfaces a cleanup failure instead of silently reporting no changes," asserting the `resultAddendum` wording and that the worktree directory is not removed.
2. **Tests that become redundant:** none.
3. **Tests that must stay as-is, unchanged:**
   - `worktree.test.ts`: "removes worktree when no changes made," "commits changes and creates branch when changes exist," "handles already-deleted worktree gracefully," "truncates commit message at 200 chars," the branch-name-conflict case, both `pruneWorktrees` cases.
   - `workspace-provider.test.ts`: all four existing cases (opt-out, prepare, throw-on-non-repo, dispose-no-changes, dispose-with-branch).
   These pin the two rows of the result matrix this change must not touch.

### Forcing a throw inside the changes-exist path, deterministically

The existing "already-deleted worktree" test proves one way to reach the `catch` (the initial `existsSync` guard short-circuits before it, though — that path returns early and never enters the `try`).
To exercise the *new* behavior, the test needs the `try` block itself to throw after `status` is non-empty.
The simplest deterministic trigger, consistent with the issue's own repro and requiring no test-only hook into production code: install a `.git/hooks/pre-commit` in the test repo that exits non-zero, exactly as the upstream bug report's own regression-test sketch does.
This exercises the real code path (the `git commit` call actually throws) rather than mocking `execFileSync`, matching the existing suite's style of using real git operations against a temp repo throughout `worktree.test.ts`.

## Invariants at risk

None of the three currently-tested `cleanupWorktree` outcomes (clean tree, successful commit, already-deleted worktree) change shape or behavior — this plan only touches the previously-untested fourth outcome (partial failure).
`WorktreeWorkspaceProvider.prepare`'s throw-on-creation-failure behavior (a separate code path, unrelated to cleanup) is unaffected.

## TDD Order

1. **fix — stop destroying the worktree on a cleanup failure.** (single cycle)
   - Red: in `test/worktree.test.ts`, add the hook-rejection test described above.
     Run `pnpm --filter @gotgenes/pi-subagents-worktrees run test` — fails, because the current code force-removes the worktree and returns `{ hasChanges: false }` with no `error`/`path`.
   - Green: in the same commit, add `error?: string` to `WorktreeCleanupResult` and rewrite the `catch` block in `cleanupWorktree` per the Design Overview.
   - Verify: `pnpm --filter @gotgenes/pi-subagents-worktrees run check && pnpm --filter @gotgenes/pi-subagents-worktrees run lint && pnpm --filter @gotgenes/pi-subagents-worktrees run test`.
   - Commit: `fix(pi-subagents-worktrees): preserve worktree on cleanup failure instead of discarding it (#704)`.
2. **fix — surface the cleanup failure through `dispose`.** (single cycle)
   - Red: in `test/workspace-provider.test.ts`, add the dispose-surfaces-failure test described above.
     Run the same test command — fails, because `dispose` currently only branches on `hasChanges`/`branch` and returns `undefined` for the new failure shape.
   - Green: add the `result.error` branch to `WorktreeWorkspace.dispose`, ordered before the existing `hasChanges` check.
   - Verify: same command as step 1.
   - Commit: `fix(pi-subagents-worktrees): surface worktree cleanup failures in the dispose addendum (#704)`.

Both commits are `fix:`-typed (a bug that silently loses user data, now handled) — each cuts a release on its own per Conventional Commits, but see Release Recommendation below for batching guidance.

## Risks and Mitigations

- **A left-behind worktree directory accumulates in `tmpdir()` across repeated failures (e.g. a persistently misconfigured hook).**
  Acceptable and intentional: `pruneWorktrees` already exists as an explicit, separate crash-recovery entry point, and a human noticing a failure message has the path to inspect and manually clean up.
  This is the documented trade-off in the issue itself — "leave the worktree in place... such that it or the user can resolve the issue."
- **The `error` message from `err.message` could leak an overly long or unfriendly raw git/exec error into the agent-facing `resultAddendum`.**
  Low risk — `debugLog` already logs the same raw error today; this only additionally surfaces it to the result consumer, which is the explicit goal (make the failure visible instead of swallowing it).
  No truncation is applied in this plan; if a real-world message proves unwieldy, that is a follow-up, not a blocker here.
- **Test flakiness from relying on a real `pre-commit` hook rejection rather than mocking `execFileSync`.**
  Mitigated by matching the existing suite's convention (real git operations against a temp repo, no mocking of `child_process`) and by the hook itself being deterministic (`exit 1` unconditionally).

## Release Recommendation

**Release:** ship independently.

`pi-subagents-worktrees` has no open release batch tracked against this change, and both commits are `fix:`-typed — each is independently releasable and there is no reason to hold this fix for a later batch.
Shipping promptly matters more than usual here: the bug is silent data loss, not a cosmetic defect.

## Open Questions

- None blocking.
  `--no-verify` for the safety-net commit is explicitly out of scope for this plan (see Non-Goals) and can be filed as a separate follow-up issue if wanted later.
