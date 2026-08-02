---
status: accepted
date: 2026-05-29
---

# 0002 — Workspaces and permissions are extensions on a minimal core

## Status

Accepted.
Supersedes the "agent collaborator architecture" framing of Phase 16 (an abandoned exploration) and the work shipped under it: issue #256 (`WorktreeIsolation` as an `Agent` collaborator) and issue #257 (`ChildSessionFactory` extraction, parked at planning).
Reclaims Phase 16's original intent — "invert dependencies" — and extends it to evict worktree isolation from the core.

## Context

The core question that triggered this decision: a single-method `ChildSessionFactory` with a `create(cwd?)` method (planned for #257) looked like it wanted to be a function, and the `cwd` parameter was late-bound.
Pulling that thread exposed progressively more rudimentary issues.

1. `cwd` is late-bound because `WorktreeIsolation.setup()` is called lazily inside `Agent.run()`, after construction — a two-phase `construct-then-setup()` that violates design principle 8 ("Construct complete").
2. The worktree is *ready* only at dequeue (a concurrency slot is held and `git worktree add` has run).
   "Construct when ready" therefore means constructing the worktree at run-start, not at spawn — which dissolves the lazy `setup()` and makes `cwd` knowable at construction.
3. The worktree and the child session share one lifespan: both are born at run-start and torn down at completion (the worktree's cleanup saves a branch; the session is disposed).
   Resources with one lifetime are one resource, not sibling collaborators that `Agent` must sequence.
   The `create(cwd?)` parameter only existed because we split one run-scoped resource (the worktree) out and made `Agent` relay its output back in.
4. Worktrees are not intrinsic to what makes subagents useful.
   The maintainer never uses them (WIP-of-1, trunk-based, CI/CD).
   Git worktree isolation is one *strategy* for answering "where does this child run, and what brackets the run?"
   — a container, a throwaway tmpdir, or a remote sandbox are others.
   The core needs only *a working directory and a disposal hook*; the default (the parent's cwd, no setup/teardown) is always correct.
5. This mirrors Phase 14, which evicted tool/extension *policy* (`disallowed_tools`, `extensions` filtering) to `@gotgenes/pi-permission-system`.
   Worktrees are *environment* policy; they belong outside the core for the same reason.

Permissions and workspaces are orthogonal concerns that must compose as independent extensions on the core, never knowing about each other.

## Decision

pi-subagents is a minimal orchestrator: it spawns a child session derived from the parent, runs the turn loop, tracks and streams and collects the result, gates concurrency, supports resume, and **publishes its lifecycle**.
Everything else attaches through exactly two extension surfaces, distinguished by the direction of information flow.

### Two extension surfaces

1. **Lifecycle events (observational) — unlimited.**
   The core emits awaited, ordered events for the child-execution lifecycle (`spawning`, `session-created` pre-`bindExtensions`, `completed`, `disposed`).
   Any number of extensions subscribe; handlers return nothing.
   Reactive concerns live here: permission detection, telemetry, UI, notifications.
   Adding a reactive concern never modifies the core.

2. **Provider seams (generative) — rationed.**
   The rare concern that must *inject* a value the core consumes synchronously registers a provider the core consults.
   Today there is exactly one: the **workspace provider** (it returns the child's working directory plus bracketed setup/teardown).
   A provider seam is the only place the core is "open," so the list is kept as small as possible.

### The discriminator

When deciding how a concern attaches:

- It only needs to **know** what happened → subscribe to a lifecycle event (observational, unlimited).
- It must **return a value the core consumes** → register a provider (generative, rationed).

Permissions are observational: the core does not enforce policy; it publishes the child's identity at the pre-bind instant so the permission extension (loaded in the child) can detect "am I a subagent?"
and gate tool calls at runtime.
Workspaces are generative: the core cannot default the cwd away when an isolation strategy is requested, so the provider hands it back.

### The governing rule: no vacant hooks

The architecture must *admit* a seam without *shipping* it until a concrete consumer exists.
A provider seam with no consumer is not extensibility — it is a speculative abstraction that taxes every reader, and `fallow` flags it as dead.
Latent extensibility (the design can host the seam additively) is the deliverable; a vacant hook is not.

### What leaves the core

- **Worktree isolation** (`worktree.ts`, `worktree-isolation.ts`, `GitWorktreeManager`, the `isolation: "worktree"` spawn mode) → a new package, `@gotgenes/pi-subagents-worktrees`, that implements the workspace provider and owns the git plumbing and the "saved to branch" result.
- **`permission-bridge.ts`** → retired.
  The core stops reaching *out* to `Symbol.for("@gotgenes/pi-permission-system:service")` and instead *emits* lifecycle events the permission system subscribes to.
- **`isolated` / `extensions: false` / `noSkills`** → removed.
  Deny-at-use (the in-child permission layer blocking disallowed tool calls) covers what `isolated` pretended to do for tools.
  Prevent-load (refusing to bind an extension because of load-time side effects, cost, or true sandboxing) is genuinely generative and cannot be reduced to observation, so it is left as a *latent* (un-built) provider seam, added only if a real consumer needs it.

### What stays in the core (not policy)

- The **recursion guard** (stripping the core's own `subagent` / `get_subagent_result` / `steer_subagent` tools from children).
  It defends the core's own invariant — a subagent must not recursively spawn — keyed off the core's own tool names.
  With `isolated` gone, children always load the parent's resources, so the guard becomes unconditional rather than gated on `cfg.extensions`.

### Composition test

Install neither extension, only permissions, only workspaces, or both: the core is byte-for-byte identical in all four cases, and the two extensions never reference each other.
Permissions depend only on the core's events; workspaces depend only on the core's provider seam; the core depends on neither.

## Consequences

- The "agent collaborator architecture" Phase 16 (give `Agent` a worktree collaborator + a session factory) is abandoned.
  #256 is superseded (worktree was placed in the wrong layer); #257 is parked (it polished a subsystem slated for eviction).
- A new package `@gotgenes/pi-subagents-worktrees` is introduced; the core spawn API drops `isolation` and `isolated`.
- `permission-bridge.ts` is removed; `@gotgenes/pi-permission-system` migrates from a published-service lookup to lifecycle-event subscription, which requires the core to emit an awaited, ordered `session-created` event before `bindExtensions()`.
  Confirming Pi's event model supports awaited pre-bind emission is the first investigation of the reclaimed phase.
- Once the cwd is resolved through the provider seam rather than relayed by `Agent`, child-session creation can construct a born-complete execution and the "runner" concept dissolves — recovering the structural goal of the abandoned collaborator steps by a cleaner route.
- The reclaimed Phase 16 roadmap and step issues live in [`docs/architecture/architecture.md`](../architecture/architecture.md).

## Amendment: concrete prevent-load consumer

Magic Context exposed a concrete integration failure: in-process children reloaded its session-wide extension runtime and multiplied global session discovery in the shared V8 heap.
The core therefore admits a narrow package-level prevent-load setting, `excludedExtensionPackages`.
It applies globally or per project before child resource loading, preserves default inheritance, and does not restore per-agent policy or tool permission semantics.
