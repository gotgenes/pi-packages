---
issue: 262
issue_title: "Add WorkspaceProvider extension seam"
---

# Add the WorkspaceProvider extension seam

## Problem Statement

Phase 16, Step 2 of [ADR-0002].
The core needs only a working directory and a disposal hook for a child run; the default - the parent's cwd, with no setup or teardown - is always correct.
"Where does a child run, and what brackets the run?" is a *strategy* (git worktree, container, tmpdir, remote sandbox), not core behavior.
[ADR-0002] classifies this as the single *generative* extension surface: a concern that must return a value the core consumes synchronously attaches through a rationed provider seam, not an observational event.
This issue adds that seam -`WorkspaceProvider` / `Workspace` plus `SubagentsService.registerWorkspaceProvider` - without the core gaining any knowledge of what an "isolation strategy" is.

## Goals

- Define the `WorkspaceProvider` and `Workspace` interfaces in the core, with zero git or worktree knowledge.
- Add `SubagentsService.registerWorkspaceProvider(provider): () => void` - a single-provider seam (chaining is out of scope) that throws if a provider is already registered and returns an unregister disposer.
- At run-start, consult the registered provider for the child's cwd and a disposal handle; with no provider, the child runs in `baseCwd` (parent cwd - default behavior unchanged).
- Call `dispose()` after the run and append the returned `resultAddendum` to the child's result.
- This change is **additive and non-breaking** - the existing `isolation: "worktree"` path is left intact (its eviction is #263).

## Non-Goals

- Removing `worktree.ts`, `worktree-isolation.ts`, `GitWorktreeManager`, or the `isolation: "worktree"` spawn mode - deferred to #263.
- Removing `isolated` / `extensions: false` / `noSkills` - deferred to #264.
- Born-complete child execution / dissolving the runner - deferred to #265.
- Multiple/chained providers - out of scope per the issue; one provider only.
- Shipping a concrete provider implementation - the worktrees package (#263) is the seam's first real consumer.
  Within this issue the seam is exercised only by test fakes; see Risks for the "no vacant hooks" release-coordination constraint.

## Background

Relevant existing modules:

- `src/lifecycle/agent.ts` - `Agent.run()` calls `this.worktree?.setup()` at run-start to obtain a cwd, threads it into `runner.run({ context: { cwd } })`, and on completion calls `this.worktree?.cleanup(description)`, appending a "Changes saved to branch ..." addendum.
  This is exactly the prepare/dispose shape the seam generalizes.
- `src/lifecycle/worktree-isolation.ts` - `WorktreeIsolation` is the current run-scoped collaborator: `setup()` returns a path, `cleanup(description)` returns a `WorktreeCleanupResult`.
  The seam is its abstraction; #263 will reimplement it as a `WorkspaceProvider` in a separate package.
- `src/lifecycle/agent-manager.ts` - constructs each `Agent`, owns the injected `WorktreeManager`, and threads `getRunConfig` as a getter.
  The same getter pattern is reused for the workspace provider.
- `src/service/service.ts` - the package's public API surface (`package.json` `exports` points at `./src/service.ts`).
  `SubagentsService`, `SpawnOptions`, and `SubagentRecord` all live here; the seam types are re-exported here so the worktrees package can implement them.
- `src/service/service-adapter.ts` - `SubagentsServiceAdapter implements SubagentsService`, wrapping the `AgentManagerLike` narrow interface.
- `src/lifecycle/child-lifecycle.ts` - the *observational* lifecycle events from #261 (`spawning`, `session-created`, `completed`, `disposed`).
  The provider seam is orthogonal: events tell consumers what happened; the provider returns a value the core consumes.

AGENTS.md constraints that apply:

- Pi SDK imports stay out of library modules - the seam interfaces and `AgentManager` accept the provider as a parameter; `index.ts` (the SDK edge) supplies `baseCwd: process.cwd()`.
- Do not read `process.cwd()` inside library functions - `baseCwd` is injected into `AgentManager` from `index.ts`.
- When adding a public API pattern, follow the established convention: the repo's registration/subscription convention is an unsubscribe **function** (`() => void`, as in `SubscribableSession.subscribe` and `pi.events.on`), not a `Symbol.dispose` `Disposable`.
  The seam therefore returns `() => void`; this is a deliberate divergence from the issue's literal `Disposable` to match the codebase convention.

## Design Overview

### Seam interfaces

Defined in a new core module `src/lifecycle/workspace.ts` (sibling to `child-lifecycle.ts`), re-exported from `service.ts` for public consumers.
The `status` field reuses the core `AgentStatus` union (from `agent.ts`), re-exported publicly so the worktrees package can name it.

```typescript
import type { AgentStatus } from "#src/lifecycle/agent";
import type { AgentInvocation, SubagentType } from "#src/types";

/** Context the core hands a provider when a child run starts. */
export interface WorkspacePrepareContext {
  agentId: string;
  agentType: SubagentType;
  baseCwd: string;
  invocation?: AgentInvocation;
}

/** Outcome the core reports to a workspace when the run ends. */
export interface WorkspaceDisposeOutcome {
  status: AgentStatus;
  description: string;
}

/** What dispose may hand back for the core to fold into the child result. */
export interface WorkspaceDisposeResult {
  resultAddendum?: string;
}

/** A prepared working directory plus its bracketed teardown. Born complete. */
export interface Workspace {
  readonly cwd: string; // the directory already exists
  dispose(outcome: WorkspaceDisposeOutcome): WorkspaceDisposeResult | void;
}

/** The single generative seam: supplies a child's workspace. */
export interface WorkspaceProvider {
  prepare(ctx: WorkspacePrepareContext): Promise<Workspace | undefined>;
}
```

Note the addendum-formatting boundary: the core appends `resultAddendum` *verbatim*.
The provider owns its own separator and wording (the worktrees package owns the "Changes saved to branch ..." string in #263).
The core never formats branch text.

### Registration - single provider, throw on duplicate

`AgentManager` holds an optional provider and exposes registration:

```typescript
private workspaceProvider?: WorkspaceProvider;

registerWorkspaceProvider(provider: WorkspaceProvider): () => void {
  if (this.workspaceProvider) {
    throw new Error(
      "A WorkspaceProvider is already registered; only one is supported.",
    );
  }
  this.workspaceProvider = provider;
  return () => {
    if (this.workspaceProvider === provider) this.workspaceProvider = undefined;
  };
}
```

The throw surfaces a misconfiguration loudly (two workspace extensions installed at once).
The disposer clears the slot only if the same provider is still active, so a stale disposer cannot evict a later registration.
`SubagentsServiceAdapter.registerWorkspaceProvider` delegates straight through; `AgentManagerLike` gains the method.

### Run-start consultation (Tell-Don't-Ask call site)

`Agent.run()` consults the provider at the point where it currently calls `worktree?.setup()`.
Provider-first precedence: when a provider supplies a workspace, the core routes cwd and dispose through it and skips the legacy worktree collaborator; with no provider it falls back to the existing worktree path; with neither it runs in `baseCwd` (cwd undefined → SDK uses the parent cwd).

```typescript
// run() - replacing the worktree?.setup() block
let cwd: string | undefined;
try {
  const provider = this._getWorkspaceProvider?.();
  if (provider) {
    this._workspace = await provider.prepare({
      agentId: this.id,
      agentType: this.type,
      baseCwd: this._baseCwd,
      invocation: this.invocation,
    });
    cwd = this._workspace?.cwd;
  } else {
    this.worktree?.setup();
    cwd = this.worktree?.path;
  }
} catch (err) {
  this.markError(err);
  this.releaseListeners();
  this.observer?.onRunFinished?.(this);
  return;
}
// ... runner.run({ context: { cwd, parentSession }, ... })
```

On completion (`completeRun`) the core computes the final status, then disposes:

```typescript
const finalStatus: AgentStatus =
  result.aborted ? "aborted" : result.steered ? "steered" : "completed";
if (this._workspace) {
  const out = this._workspace.dispose({ status: finalStatus, description: this.description });
  if (out?.resultAddendum) finalResult += out.resultAddendum;
} else {
  const wt = this.worktree?.cleanup(this.description);
  if (wt?.hasChanges && wt.branch) finalResult += `\n\n---\nChanges saved to branch \`${wt.branch}\`...`;
}
```

`failRun` mirrors this in a `try/catch`, disposing with `status: "error"` and discarding any addendum (matching the existing error-path behavior, which does not append branch text).

The provider getter is injected into each `Agent` by `AgentManager.spawn` (`getWorkspaceProvider: () => this.workspaceProvider`), exactly like `getRunConfig`.
`baseCwd` is injected into `AgentManager` from `index.ts` and threaded to each `Agent`.

### Why the worktree path stays (scope decision A)

Per the clarification, #262 is the additive seam only; the legacy `isolation: "worktree"` orchestration is untouched and removed in #263.
A genuinely separate strategy could register a provider today and get correct cwd + dispose behavior; worktree spawns keep working unchanged.
Provider-first precedence means the two never silently conflict, and #263 collapses the branch by deleting the worktree arm.

### Edge cases

- `prepare()` resolves `undefined` → `cwd` is undefined → runner uses `baseCwd` (parent cwd).
  No dispose call (no workspace).
- `prepare()` rejects → `markError`, release listeners, notify observer, return (same shape as a worktree `setup()` failure today).
- `dispose()` returns `void` or no `resultAddendum` → result unchanged.
- Duplicate `registerWorkspaceProvider` → throws synchronously.

## Module-Level Changes

| File                                | Change                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lifecycle/workspace.ts`        | **New.** Defines `WorkspaceProvider`, `Workspace`, `WorkspacePrepareContext`, `WorkspaceDisposeOutcome`, `WorkspaceDisposeResult`. No behavior.                                                                                                                                                                                         |
| `src/lifecycle/agent.ts`            | `AgentInit` gains optional `baseCwd?: string` and `getWorkspaceProvider?: () => WorkspaceProvider \| undefined`. New private fields `_baseCwd`, `_getWorkspaceProvider`, `_workspace?: Workspace`. `run()` provider-first prepare; `completeRun`/`failRun` dispose + verbatim `resultAddendum`. Export `AgentStatus` is already public. |
| `src/lifecycle/agent-manager.ts`    | `AgentManagerOptions` gains required `baseCwd: string`. New `workspaceProvider` field, `registerWorkspaceProvider()` (throw on dup, unregister disposer). `spawn()` passes `baseCwd` and the `getWorkspaceProvider` getter into each `Agent`.                                                                                           |
| `src/service/service.ts`            | Re-export the five seam types and `AgentStatus`. Add `registerWorkspaceProvider(provider: WorkspaceProvider): () => void` to the `SubagentsService` interface.                                                                                                                                                                          |
| `src/service/service-adapter.ts`    | `AgentManagerLike` gains `registerWorkspaceProvider(provider): () => void`. `SubagentsServiceAdapter` implements the method, delegating to the manager.                                                                                                                                                                                 |
| `src/index.ts`                      | Pass `baseCwd: process.cwd()` to the `new AgentManager({...})` construction (alongside the existing `GitWorktreeManager(process.cwd())`).                                                                                                                                                                                               |
| `docs/architecture/architecture.md` | Mark Phase 16 Step 2 (#262) as landed in the roadmap; note the seam exists and `workspace.ts` is added to the lifecycle domain listing.                                                                                                                                                                                                 |

No exports are removed or renamed, so no `src/`/`test/` removed-symbol grep is required.
No file in Module-Level Changes is also claimed as unchanged in Non-Goals (the worktree *modules* are non-goals; `agent.ts` touches the worktree *call path* additively, which is consistent).

### Grep checklist before finalizing

- Objects typed as `SubagentsService` in tests: `test/service/service.test.ts` casts `{ spawn: () => "id" } as unknown as SubagentsService`, so adding an interface method does **not** break it (verified).
- `new AgentManager(` call sites: `src/index.ts` (one) and `test/lifecycle/agent-manager.test.ts` `createManager` (one) - both updated for required `baseCwd` in the same step.
- `AgentManagerLike` mocks in `test/service/service-adapter.test.ts` (`defaultManager`, inline `spawn:` stubs) - add `registerWorkspaceProvider` stub in the same step.

## Test Impact Analysis

This is an additive seam, so the work is dominated by *new* tests; little existing coverage is affected.

1. New unit tests the seam enables: provider registration (throw-on-duplicate, disposer-unregisters), run-start consultation (cwd from `prepare`, `resultAddendum` appended on dispose), `prepare` returns undefined → `baseCwd`, `prepare` rejects → `markError`, and adapter delegation.
   These were impossible before because there was no provider abstraction to substitute.
2. Redundant existing tests: none.
   The seam does not subsume worktree tests - they exercise the legacy path, which is preserved.
3. Existing tests that must stay as-is: all `worktree.test.ts`, `worktree-isolation.test.ts`, and the AgentManager worktree-isolation tests (`calls worktrees.create` / `cleanup`) - they genuinely exercise the fallback path that remains in #262.
   The Agent no-provider tests assert unchanged worktree behavior.

## TDD Order

1. **Seam types + registration surface** - `feat`.
   New `src/lifecycle/workspace.ts`; re-export seam types + `AgentStatus` from `service.ts`; add `registerWorkspaceProvider` to `SubagentsService`, `AgentManagerLike`, and `SubagentsServiceAdapter` (delegating); add required `baseCwd` + provider field + `registerWorkspaceProvider` (throw on dup, disposer) to `AgentManager`; update `index.ts` and the `createManager` test factory for `baseCwd`.
   Tests: `agent-manager.test.ts` registration (throws on second register; disposer clears only the active provider; getter returns the registered provider) and `service-adapter.test.ts` delegation.
   This whole surface lands in one commit because the `SubagentsService` interface method forces the adapter to implement it and the required `baseCwd` forces both construction sites - splitting would not type-check.
   Suggested message: `feat: add WorkspaceProvider registration seam to subagents service`.
   Run `pnpm run check` immediately after (shared-interface change).

2. **Run-start consumption + dispose** - `feat`.
   `Agent`: `AgentInit` gains `baseCwd`/`getWorkspaceProvider`; new private fields; `run()` provider-first prepare; `completeRun`/`failRun` dispose + verbatim `resultAddendum`.
   `AgentManager.spawn` passes `baseCwd` and the `getWorkspaceProvider` getter (sole extra construction site, folded in).
   Tests: `agent.test.ts` - provider `prepare` supplies cwd to the runner; `dispose` `resultAddendum` appended to the result; `prepare` undefined → cwd falls back to `baseCwd`; `prepare` rejects → `markError` + `onRunFinished`; no-provider path still uses the worktree collaborator (regression guard).
   Suggested message: `feat: consult workspace provider for child cwd and disposal`.
   Run `pnpm run check` after (AgentInit change).

3. **Architecture doc update** - `docs`.
   Mark Phase 16 Step 2 (#262) landed in the roadmap; add `workspace.ts` to the lifecycle domain listing; cross-link the seam.
   Suggested message: `docs: record WorkspaceProvider seam in phase 16 roadmap`.

## Risks and Mitigations

- **Vacant hook (the headline risk).**
  [ADR-0002]’s “no vacant hooks” rule says a provider seam with no consumer is a speculative abstraction that `fallow` flags as dead.
  Within #262 the seam is exercised only by test fakes.
  Mitigation: land #262 **alongside** #263 (its first real consumer, `@gotgenes/pi-subagents-worktrees`) - do not cut a release that contains the seam without the worktrees package.
  Track this as a release-coordination constraint; the architecture roadmap already pairs Steps 2 and 3.
- **Dual cwd path confusion.**
  Provider-first precedence keeps worktree and provider from silently conflicting; the branch is documented and removed in #263.
- **`baseCwd` source.**
  Injecting `process.cwd()` from `index.ts` matches the existing `GitWorktreeManager(process.cwd())` construction; no new global-state read enters a library module.
- **Status timing in dispose.**
  The final status is computed before the status-transition methods mutate, so `dispose`'s outcome reflects the true terminal status.

## Open Questions

- Should `baseCwd` eventually come from the parent `SessionContext.cwd` rather than `process.cwd()`?
  Deferred -`process.cwd()` preserves current worktree behavior; revisit during the born-complete work (#265).
- Should the `disposed` lifecycle event (#261) and `Workspace.dispose` be reconciled into one teardown notion?
  Deferred - they serve different surfaces (observational vs generative); revisit if #265 dissolves the runner.

[ADR-0002]: ../decisions/0002-extensions-on-a-minimal-core.md
