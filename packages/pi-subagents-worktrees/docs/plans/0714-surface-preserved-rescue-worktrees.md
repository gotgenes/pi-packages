---
issue: 714
issue_title: "Surface preserved rescue worktrees at session start"
---

# Surface preserved rescue worktrees at session start

## Release Recommendation

**Release:** ship independently

This package has no `docs/architecture/` roadmap, so this issue belongs to no release batch.
It closes the loop opened by [#704] — which shipped in v0.2.4 — and should reach users as soon as it lands.

## Problem Statement

[#704] stopped `cleanupWorktree` from force-removing a worktree whose cleanup failed partway.
The worktree now survives on disk, and the path is reported once, in the child's result addendum.

That addendum is the only notification the user ever gets.
If it scrolls past unread, or the session ends before anyone acts on it, nothing surfaces the preserved worktree again.
`pruneWorktrees` runs at extension init, but `git worktree prune` drops only administrative entries whose directory is already gone — it reclaims nothing for a worktree that still exists, which is precisely the preserved case.
The worktrees live under `tmpdir()`, which macOS and most Linux distributions clear periodically, so the preserved work is deleted anyway — just on a delay.

The net effect is that [#704] converted immediate silent loss into delayed silent loss.
This issue closes that loop: report preserved worktrees at session start, and give the user a way to act on them without leaving the session.

## Goals

- Warn at session start, once per session, when this repository has rescue worktrees left on disk by a failed cleanup.
- Give the user a `/subagents-worktrees` command that lists preserved worktrees at any time and removes one after an explicit confirmation.
- Never report a worktree that a child of this process is currently running in.
- Never report or offer to remove the worktree the current session is itself running inside.

This change is **not** breaking.
It adds a `session_start` handler and a slash command; no existing behavior, result shape, config key, or default changes.
Commits use `feat:`.

## Non-Goals

- No automatic deletion, and no removal without an explicit confirmation.
  The point of [#704] is that this content is not safe to remove without a human deciding.
- No agent-facing tool.
  Removal is destructive and user-confirmed; the slash command already lets the user act without leaving the session, without giving the model a path to a destructive git operation.
- No retry-the-rescue action (re-running the rescue commit on a preserved worktree from the command).
  Considered and deliberately rejected for this round; recovery stays manual git work.
- No marker file and no `git worktree lock` at preservation time.
  Detection uses the path heuristic only, so worktrees preserved by the already-shipped v0.2.4 are found too.
- No reporting when `@gotgenes/pi-subagents` is absent.
  The package's documented contract is that it does nothing without the core, and preserved worktrees only ever arise from this package's own operation.
- No change to `createWorktree`, `cleanupWorktree`, `pruneWorktrees`, or `loadWorktreesConfig` behavior.
- Nothing from [#707] (wildcards in `worktreeAgents`), which touches `src/config.ts` only.

## Background

### Modules

- `src/worktree.ts` owns all git plumbing: `createWorktree`, `cleanupWorktree`, the private `removeWorktree`, `pruneWorktrees`, and the private `runGit` wrapper.
- `src/workspace-provider.ts` holds `WorktreeWorkspaceProvider` (constructed with a `WorktreesConfig`) and the `WorktreeWorkspace` it hands back; `dispose` calls `cleanupWorktree` and turns the discriminated-union result into a result addendum.
- `src/index.ts` is 45 lines of wiring: load config, `pruneWorktrees(process.cwd())`, look up the subagents service, register the provider, unregister at `session_shutdown`.
- Tests are integration-style against real git repositories, via the `initGitRepo` / `installPreCommitHook` / `lockGitIndex` helpers in `test/support/git-fixture.ts`.

### Facts established at planning time

Each of these was measured in this session, not inferred.

| Fact                                                       | Measurement                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git worktree list --porcelain` reports **resolved** paths | On macOS a worktree created at `/var/folders/…/T/pi-agent-x` lists as `/private/var/folders/…/T/pi-agent-x`, while `os.tmpdir()` returns the `/var/…` form. A naive `path.startsWith(tmpdir())` filter matches nothing.                                                  |
| The listing is cheap                                       | `git worktree list --porcelain` at this repo's root: ~9 ms wall (`time`, warm). One call per session start is negligible.                                                                                                                                                |
| Extension factories run **per session**, not per process   | Pi's loader calls the factory for each session it loads extensions for, and `jiti` runs with `moduleCache: false`, so neither closure state nor module-level state reliably persists across sessions. A "once per process" flag is not available; "once per session" is. |
| `session_start` fires in child (subagent) sessions too     | `pi-subagents` calls `session.bindExtensions({})` for every child, and the default `SessionStartEvent.reason` is `"startup"` — so the reason cannot distinguish a child.                                                                                                 |
| A headless session's `ctx.ui` is a no-op object            | Pi's extension runner substitutes `noOpUIContext` (`notify: () => {}`) when no UI is bound, so a child session cannot show a toast. `ctx.hasUI` is the explicit guard.                                                                                                   |
| `git worktree remove --force` reports failure by throwing  | The existing private `removeWorktree` swallows that and falls back to `prune`; a user-facing command needs the error.                                                                                                                                                    |

### Constraints from AGENTS.md

- pnpm only; ES2024 target; `#src/` and `#test/` aliases, never relative imports.
- The `files` allowlist is `src`, `README.md`, `CHANGELOG.md`, `LICENSE` — the README is the only user-facing doc that ships.
- `pnpm fallow dead-code` gates CI at the end of the work; an intermediate commit may briefly carry an export whose consumer arrives in the next step.

## Design Overview

### What counts as preserved

A registered worktree is reported as preserved when **all** of the following hold:

1. It appears in `git worktree list --porcelain` for the session's repository.
2. Its basename starts with `pi-agent-` (the prefix `createWorktree` uses).
3. It lives under the resolved temp root — `realpathSync(tmpdir())`, not `tmpdir()` (see the measurement above).
4. Its directory still exists.
5. No child of this process is currently running in it.
6. It is not the worktree the current session is running inside.

Rules 5 and 6 are the two false-positive guards.
Rule 5 needs a registry, because a live child's worktree is indistinguishable from a preserved one by path alone.
Rule 6 matters when Pi is itself launched inside a rescue worktree during recovery — without it, the session offers to delete the ground it stands on.

A worktree belonging to a **different** Pi process cannot be excluded; that limitation is documented in the README and mitigated by the confirmation dialog, which names the path.

### Live-worktree registry

```typescript
// src/active-worktrees.ts

/** Read side: is a child of this process still running in that worktree? */
export interface LiveWorktrees {
  contains(resolvedPath: string): boolean;
}

/** Worktree paths this process has a running child in. Stores resolved paths, since git reports resolved paths. */
export class ActiveWorktrees implements LiveWorktrees {
  add(path: string): void;
  remove(path: string): void;
  contains(resolvedPath: string): boolean;
}
```

`add` resolves the path once, while the directory still exists, and keeps a raw→resolved mapping so `remove` works after `cleanupWorktree` has deleted the directory.
The provider calls `add` in `prepare` and the workspace calls `remove` in `dispose`, for every outcome — a preserved worktree stops being live the moment its child is finished, which is exactly when it becomes reportable.

Consumers take the narrow `LiveWorktrees` interface, so a test double is `{ contains: () => false }`.

### Discovery

```typescript
// src/preserved.ts

/** Rescue worktrees left on disk by a failed cleanup, newest git ordering preserved. */
export function findPreservedWorktrees(
  repoCwd: string,
  live: LiveWorktrees,
): string[];

/** The startup warning text for a non-empty list of preserved worktrees. */
export function formatPreservedNotice(paths: readonly string[]): string;
```

`findPreservedWorktrees` calls the new `listWorktreePaths(repoCwd)` in `src/worktree.ts` and applies the six rules above.
A git failure (not a repo, git missing) is swallowed with `debugLog` and returns `[]`, so a session never fails to start because of this feature.

The filtering is deliberately **not** extracted as a pure function tested with synthetic path strings.
The realpath mismatch is the whole point of rule 3, and a synthetic test would encode whichever assumption the author already holds; the package's existing tests build real repositories and real worktrees, and these do the same.

### Startup notice

`src/index.ts` gains one handler, registered after the subagents-service check so the "does nothing without the core" contract holds:

```typescript
const live = new ActiveWorktrees();
const findPreserved = () => findPreservedWorktrees(repoCwd, live);

pi.on("session_start", (_event, ctx) => {
  if (!ctx.hasUI) return; // a child session's ui.notify is a no-op
  const preserved = findPreserved();
  if (preserved.length > 0) {
    ctx.ui.notify(formatPreservedNotice(preserved), "warning");
  }
});
```

The `hasUI` guard is what keeps the scan out of every subagent session — without it, each child would run a pointless `git worktree list` whose toast goes nowhere.

The notice names each path (capped at five, with an `…and N more` tail), says what the worktrees hold, and points at the command:

```text
2 rescue worktrees from a failed cleanup are still on disk:
  /private/var/folders/…/T/pi-agent-abc123-1f2e9c04
  /private/var/folders/…/T/pi-agent-def456-90ab77e1
They hold subagent work that was never merged, and the temp directory is cleared periodically.
Run /subagents-worktrees to inspect or remove them.
```

### `/subagents-worktrees` command

Registered by a new `src/preserved-command.ts`, wired from `index.ts`:

```typescript
registerPreservedWorktreesCommand(pi, {
  findPreserved,
  discard: (path) => discardWorktree(repoCwd, path),
});
```

The handler reads:

```typescript
const preserved = deps.findPreserved();
if (preserved.length === 0) {
  ctx.ui.notify("No preserved rescue worktrees found.", "info");
  return;
}
const choice = await ctx.ui.select("Preserved rescue worktrees", [...preserved, CLOSE]);
if (choice === undefined || choice === CLOSE) return;
const confirmed = await ctx.ui.confirm(
  "Remove this worktree?",
  `Delete ${choice} and everything in it. This cannot be undone — merge or copy anything you need first.`,
);
if (!confirmed) return;
```

Removal is `discardWorktree`, a new export in `src/worktree.ts` that runs `git worktree remove --force` and lets the error propagate; the command catches it and reports through `ctx.ui.notify(…, "error")`.
The existing private `removeWorktree` is rewritten to call `discardWorktree` and keep its best-effort `catch` + `prune` fallback, so there is exactly one place that spells the git command.
The two removal paths differ in lifecycle, not in mechanics: cleanup cannot act on a failure and stays silent, while the command can and must report — the shared piece is the git call, and only the git call is shared.

`discard` is injected rather than imported by the command module, so the command's tests exercise the dialog flow without building a git repository.

### Edge cases

| Case                                            | Behavior                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| No preserved worktrees                          | No toast; the command notifies "No preserved rescue worktrees found."                                         |
| Not a git repository, or git fails              | `[]`; no toast, no throw, one `debugLog` line.                                                                |
| Child session (no UI)                           | Handler returns before scanning.                                                                              |
| A child is running in a matching worktree       | Excluded while live; reported after `dispose` if cleanup failed.                                              |
| Session running inside a rescue worktree        | That worktree is excluded from its own listing.                                                               |
| Directory reaped by the tmp cleaner mid-session | Excluded (rule 4); the stale admin entry is dropped by the next session's `pruneWorktrees`.                   |
| Another Pi process has a live worktree here     | Reported — cannot be distinguished. The confirmation dialog names the path; documented as a known limitation. |
| `git worktree remove --force` fails             | The command reports the error; the worktree stays on disk.                                                    |

## Module-Level Changes

1. `src/active-worktrees.ts` — **new**.
   `LiveWorktrees` interface and `ActiveWorktrees` class (raw→resolved `Map`, `add`/`remove`/`contains`).
2. `src/preserved.ts` — **new**.
   `findPreservedWorktrees` and `formatPreservedNotice`; private helpers for the six rules and for the capped path list.
3. `src/worktree.ts`
   - Add exported `listWorktreePaths(cwd)`: `git worktree list --porcelain` via the existing private `runGit`, returning the `worktree` line values.
   - Add exported `discardWorktree(cwd, worktreePath)`: `git worktree remove --force`, throwing on failure.
   - Rewrite the private `removeWorktree` to delegate to `discardWorktree`, keeping its `catch` + `prune` fallback and `debugLog` calls.
   - No change to `createWorktree`, `cleanupWorktree`, or `pruneWorktrees`.
4. `src/workspace-provider.ts`
   - `WorktreeWorkspaceProvider` takes `ActiveWorktrees` as a second constructor argument and calls `add(info.path)` after a successful `createWorktree`.
   - `WorktreeWorkspace` takes the registry and calls `remove(this.info.path)` in `dispose`, for every outcome, without altering the returned addendum.
5. `src/preserved-command.ts` — **new**.
   `registerPreservedWorktreesCommand(pi, deps)` with `deps = { findPreserved, discard }`; registers the `subagents-worktrees` command (matching the `permission-system` naming precedent in this repo).
6. `src/index.ts`
   - Construct `ActiveWorktrees`, pass it to the provider, and build the `findPreserved` closure.
   - Register the `session_start` notice handler and the command, both **after** the `getSubagentsService()` early return.
7. `test/active-worktrees.test.ts` — **new**: add/remove/contains, resolved-path normalization, remove-after-directory-deleted.
8. `test/preserved.test.ts` — **new**: real repositories and real worktrees covering the six rules, plus the git-failure path and the notice text.
9. `test/workspace-provider.test.ts` — every `new WorktreeWorkspaceProvider({ … })` gains the registry argument; new assertions that a prepared worktree is live and that `dispose` clears it for the clean, committed, and failed outcomes.
10. `test/index.test.ts` — `fakePi` grows to capture the command registration and to pass an `ExtensionContext` double to handlers; new cases for notify-when-found, silence-when-none, `hasUI: false`, and still-no-`pi.on`-without-the-service.
11. `test/preserved-command.test.ts` — **new**: dialog flow with a fake `ctx` (`select`/`confirm`/`notify`), including cancel, decline, and discard-throws.
12. `README.md` — extend Behavior with the startup notice, and add a short "Recovering preserved worktrees" section documenting `/subagents-worktrees` and the cross-process limitation.

Greps run while writing this list: no file outside `packages/pi-subagents-worktrees/` references `cleanupWorktree`, `removeWorktree`, `pruneWorktrees`, or the package's addendum strings except `docs/triage/2026-08-05-backlog.md` (a dated triage record, deliberately left alone) and the historical plans and retros under `docs/`.
`.pi/skills/package-pi-subagents/SKILL.md` mentions this package only as a packaging-pattern reference.
The root `README.md` lists the package in its table and in the no-dedicated-skill note; neither statement changes.

## Test Impact Analysis

1. **Newly enabled coverage.**
   The registry makes "is this worktree live?" an assertable property rather than an implicit consequence of timing, so the exclusion rule can be tested directly instead of through a racing subagent.
   Injecting `discard` into the command makes the whole confirm-and-remove dialog testable without a git repository — the first UI-flow tests in this package.
2. **Tests that become redundant.**
   None.
   This is additive; every existing test keeps its meaning.
3. **Tests that must stay as-is.**
   The five `cleanupWorktree` outcome tests and the three `dispose` addendum tests exercise the [#704] behavior this change must not perturb; they are extended with registry assertions but their existing assertions stay byte-for-byte.
   `test/index.test.ts`'s "no-ops when the subagents service is unavailable" case is load-bearing for the contract in Non-Goals and must keep asserting that `pi.on` is never called.
4. **Assertion quality.**
   Preserved-worktree tests assert the returned **paths**, not merely a count — the realpath form is the property most likely to regress, and a count assertion would pass against the wrong strings.

## Invariants at risk

1. **The package does nothing when `@gotgenes/pi-subagents` is absent.**
   Pinned by `test/index.test.ts` "no-ops when the subagents service is unavailable" (`expect(pi.on).not.toHaveBeenCalled()`).
   Registering the notice or the command before the service check would regress it, so both go after.
2. **`pruneWorktrees(process.cwd())` still runs at init.**
   Pinned by the existing init test.
   The scan runs later (at `session_start`), so stale administrative entries are already gone when it lists.
3. **The three `dispose` addenda are unchanged.**
   Pinned by the existing `workspace-provider` tests for the clean, committed, hook-bypassed, and failed outcomes.
   The registry removal must not sit between the result and the return in a way that changes either.
4. **A preserved worktree is never removed without a human deciding ([#704]'s core outcome).**
   The only new removal path is the command, gated by `ctx.ui.confirm`; pinned by a command test asserting `discard` is not called when confirmation is declined.
5. **Session start stays fast.**
   Measured baseline: `git worktree list --porcelain` ~9 ms at this repo's root, one call per session start, skipped entirely in child sessions via `hasUI`.
   No further measurement is planned at implementation time; if the scan ever grows a second git call, re-measure.

## TDD Order

1. **Live-worktree registry.**
   Red: `test/active-worktrees.test.ts` — `contains` matches the resolved form of a path added in its unresolved form, `remove` works after the directory is gone, and an unknown path is not contained.
   Green: `src/active-worktrees.ts` with `LiveWorktrees` and `ActiveWorktrees`.
   `feat(pi-subagents-worktrees): add a registry of live worktree paths (#714)`
2. **Discovery.**
   Red: `test/preserved.test.ts` — with two worktrees created by `createWorktree`, `findPreservedWorktrees` returns both resolved paths; it excludes the main worktree, a non-`pi-agent-` worktree, a worktree whose directory was deleted, a path reported live by the registry double, and the worktree the scan's own cwd sits in; it returns `[]` for a non-repo directory.
   Green: `listWorktreePaths` in `src/worktree.ts` and `src/preserved.ts`'s `findPreservedWorktrees`.
   `feat(pi-subagents-worktrees): detect preserved rescue worktrees (#714)`
3. **Register live worktrees while children run.**
   Red: `test/workspace-provider.test.ts` — a prepared worktree is contained by the registry, and `dispose` clears it for the clean, committed, and failed outcomes.
   Green: the constructor argument on `WorktreeWorkspaceProvider` and `WorktreeWorkspace`, plus the `index.ts` construction site.
   All six existing provider constructions are updated in this same commit, since the added constructor parameter breaks them at the type level.
   `feat(pi-subagents-worktrees): track live worktrees while children run (#714)`
4. **Startup notice.**
   Red: `test/preserved.test.ts` for `formatPreservedNotice` (names each path, caps the list, singular vs. plural, points at the command) and `test/index.test.ts` for the handler (notifies with `"warning"` when found, stays silent when none, returns before scanning when `hasUI` is false, and still registers nothing without the service).
   Green: `formatPreservedNotice` and the `session_start` handler.
   `feat(pi-subagents-worktrees): warn at session start about preserved rescue worktrees (#714)`
5. **`/subagents-worktrees` command.**
   Red: `test/preserved-command.test.ts` — an empty list notifies and never opens a selector; a cancelled selector and a declined confirmation both leave `discard` uncalled; a confirmed choice calls `discard` with that path and notifies success; a throwing `discard` notifies an error rather than propagating.
   Plus `test/worktree.test.ts` for `discardWorktree` (removes a worktree; throws for an unregistered path) and `test/index.test.ts` for the registration.
   Green: `discardWorktree` and the `removeWorktree` delegation in `src/worktree.ts`, `src/preserved-command.ts`, and the `index.ts` wiring.
   `feat(pi-subagents-worktrees): add /subagents-worktrees to inspect and remove preserved worktrees (#714)`
6. **Documentation.**
   README Behavior bullet for the startup notice, and a "Recovering preserved worktrees" section for the command, the confirmation, and the cross-process limitation.
   `docs(pi-subagents-worktrees): document preserved-worktree recovery (#714)`

## Risks and Mitigations

| Risk                                                                               | Mitigation                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A concurrent Pi process's live worktree is reported as preserved                   | Cannot be detected by path; the notice says the worktrees hold unmerged work rather than asserting they are abandoned, removal always requires a confirmation naming the path, and the README states the limitation. |
| The toast fires before the TUI has drawn and is never seen                         | The command re-lists on demand, so the notice is not the only surface. Verify the toast is visible in a real session during step 4 rather than trusting the handler test.                                            |
| The scan slows session start                                                       | Measured at ~9 ms for one `git worktree list --porcelain`, and skipped entirely when `ctx.hasUI` is false.                                                                                                           |
| The added provider constructor parameter breaks tests noisily                      | Step 3 updates all six constructions in the same commit; a `makeProvider` test helper is the obvious tidy-first candidate and is left to the implementation agent's triage.                                          |
| A repeated toast becomes noise for a user who chooses to keep a preserved worktree | Accepted for this round: the alternative (persisting a dismissal) needs state this package does not have, and the worktree is on borrowed time under `tmpdir()` anyway.                                              |
| `discardWorktree` and `removeWorktree` drift apart                                 | `removeWorktree` delegates to `discardWorktree`, so the git invocation has exactly one home.                                                                                                                         |

## Open Questions

1. Should the command grow a retry-the-rescue action — stage, `commit --no-verify`, branch — so recovery is one keystroke instead of manual git?
   Deliberately deferred: it is the natural follow-up if manual recovery proves annoying in practice, and nothing here forecloses it.
   Not filed as an issue, since it is a rejected alternative rather than named follow-up work.
2. Should the notice also fire when `@gotgenes/pi-subagents` is absent?
   Deferred with the no-op contract in Non-Goals; revisit only if someone reports losing a rescue worktree after uninstalling the core.

[#704]: https://github.com/gotgenes/pi-packages/issues/704
[#707]: https://github.com/gotgenes/pi-packages/issues/707
