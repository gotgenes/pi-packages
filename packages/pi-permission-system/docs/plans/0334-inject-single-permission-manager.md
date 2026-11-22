---
issue: 334
issue_title: "Inject a single PermissionManager into PermissionSession (configure once at session_start)"
---

# Inject a single PermissionManager into PermissionSession

## Problem Statement

`PermissionSession` constructs its own `PermissionManager` by calling the free function `createPermissionManagerForCwd(...)` in three places — the constructor, `resetForNewSession()`, and `reload()`.
The manager is never injected, which is a Dependency Inversion (DIP) violation: the session cannot be built with a test double.
The cost lands in `permission-session.test.ts`, which must `vi.mock("../src/runtime")` to stub the factory and route a `{...} as unknown as PermissionManager` mock through it.

The per-call reconstruction implies the project cwd can change across a session.
It cannot: the issue verified against Pi core that `AgentSession._cwd` and `ExtensionRunner.cwd` are each assigned once and never reassigned, and `/reload` re-emits `session_start` with the same cwd.
The instance-swapping is dead generality — the extension simply does not *learn* the cwd until `session_start`.

This is Phase 4 Step 1 (Track A: Injection foundation) from `docs/architecture/architecture.md`.
It is behavior-preserving and unblocks the session-split work in Steps 6-7.

## Goals

- Inject one `PermissionManager` instance into `PermissionSession`, constructed in `index.ts`.
- Add `PermissionManager.configureForCwd(cwd)` that rebuilds its `FilePolicyLoader` for the cwd-derived config paths and clears the resolved-permissions cache.
- `resetForNewSession(ctx)` calls `manager.configureForCwd(ctx.cwd)` once; `reload()` calls it with the current (unchanged) cwd, preserving today's refresh semantics.
- Remove `createPermissionManagerForCwd` (and its sole helper `derivePiProjectPaths`) — the cwd→paths derivation moves onto a thin pure helper owned by `permission-manager.ts`.
- Make the injected dependency a narrow interface so the test mock needs no `as unknown as PermissionManager` cast.
- Behavior-preserving: no observable change to permission decisions in production.

## Non-Goals

- Unifying the session's `PermissionManager` with `runtime.permissionManager` (the split-brain the RPC/command/service path reads from).
  That split is intentional here and is fixed in Step 4 (#337, dissolve `ExtensionRuntime`).
- Removing the belt-and-suspenders `reload()` rebuild (the `FilePolicyLoader` already does mtime-based cache invalidation).
  The issue flags this for Step 4, not here.
- Touching `permissions-service.ts`, `permission-event-rpc.ts`, or `config-modal.ts` wiring.
- Any `PermissionSession` god-object decomposition (Steps 6-8).

## Background

Relevant modules:

- `src/permission-session.ts` — the god object.
  Field `private permissionManager: PermissionManager` is assigned by `createPermissionManagerForCwd(...)` in the constructor (cwd `undefined`), `resetForNewSession` (cwd `ctx.cwd`), and `reload` (cwd `this.context?.cwd`).
  It uses the manager for `checkPermission`, `getToolPermission`, `getConfigIssues`, `getPolicyCacheStamp`.
- `src/permission-manager.ts` — `PermissionManager` owns a `PolicyLoader` (default `FilePolicyLoader`) and a `resolvedPermissionsCache: Map`.
  Constructor: `this.loader = options.policyLoader ?? new FilePolicyLoader(options)`.
- `src/runtime.ts` — defines `derivePiProjectPaths(cwd)` and `createPermissionManagerForCwd(agentDir, cwd)`.
  The latter is called by the session (3×) and by `createExtensionRuntime()` (1×, for the separate `runtime.permissionManager`).
- `src/policy-loader.ts` — `FilePolicyLoader` reads config from `globalConfigPath` / `projectGlobalConfigPath` / `projectAgentsDir` / `agentsDir`, with mtime-based caching.
  `PolicyLoaderOptions` carries those paths.
- `src/config-paths.ts` — `getGlobalConfigPath(agentDir)`, `getProjectConfigPath(cwd)`.
- `src/index.ts` — the composition root.
  Constructs `runtime` (which holds `runtime.permissionManager`) and `new PermissionSession(runtime, logger, forwarding, runtimeDeps)`.

Constraints from AGENTS.md / package skill:

- DIP: inject the new collaborator even though the class still constructs others internally (existing internal construction is the smell being removed).
- Use a narrow interface type — not the concrete class — for the injected collaborator, so test mocks need no cast (concrete class types leak private fields to TypeScript's structural checker).
- Do not read `process.env` / `getAgentDir()` inside library functions — accept the value (here `agentDir`) as a parameter.
  The current `createPermissionManagerForCwd` partially honors this; the new derivation honors it fully.
- Keep schema/example/docs aligned only if config surface changes — it does not here.

### Why the split-brain stays

`runtime.permissionManager` (read by the RPC check, `config-modal`, and `LocalPermissionsService`) is a *different instance* from the one `PermissionSession` builds (Finding 3 in the roadmap).
`runtime.permissionManager` is constructed with cwd `undefined` and never reconfigured, so it stays global-only; the session's manager is cwd-scoped.
This Step keeps that split exactly as-is — Step 4 (#337) points all consumers at the same manager.
Unifying them now would change what the RPC/command/service path resolves (global-only → cwd-scoped), which is out of scope for a behavior-preserving Step 1.

## Design Overview

### `configureForCwd` and the cwd→paths derivation

`PermissionManager` gains an `agentDir` option and a `configureForCwd` method.
The cwd→`PolicyLoaderOptions` derivation becomes a thin pure helper owned by `permission-manager.ts` (replacing `derivePiProjectPaths` + the body of `createPermissionManagerForCwd`):

```typescript
function derivePolicyLoaderOptions(
  agentDir: string,
  cwd: string | undefined | null,
): PolicyLoaderOptions {
  return {
    globalConfigPath: getGlobalConfigPath(agentDir),
    agentsDir: join(agentDir, "agents"),
    projectGlobalConfigPath: cwd ? getProjectConfigPath(cwd) : undefined,
    projectAgentsDir: cwd ? join(cwd, ".pi", "agent", "agents") : undefined,
  };
}
```

Note: this sets `agentsDir` explicitly from `agentDir`.
Today `createPermissionManagerForCwd` leaves `agentsDir` unset, so `FilePolicyLoader` falls back to `join(getAgentDir(), "agents")` — a hidden `getAgentDir()` env read.
In production `agentDir === getAgentDir()`, so the value is identical; deriving it from the passed `agentDir` is production-behavior-preserving and removes the hidden env dependency (and makes the new unit test deterministic under a temp `agentDir`).

The manager stores `agentDir` and rebuilds its loader on demand:

```typescript
export interface PermissionManagerOptions extends PolicyLoaderOptions {
  policyLoader?: PolicyLoader;
  agentDir?: string;
}

constructor(options: PermissionManagerOptions = {}) {
  this.agentDir = options.agentDir;
  this.loader =
    options.policyLoader ??
    new FilePolicyLoader(
      options.agentDir !== undefined
        ? derivePolicyLoaderOptions(options.agentDir, undefined)
        : options,
    );
}

configureForCwd(cwd: string | undefined | null): void {
  if (this.agentDir !== undefined) {
    this.loader = new FilePolicyLoader(
      derivePolicyLoaderOptions(this.agentDir, cwd),
    );
  }
  this.resolvedPermissionsCache.clear();
}
```

- Construction with `{ agentDir }` yields the global-only loader — identical to today's `createPermissionManagerForCwd(agentDir, undefined)`.
- `configureForCwd(cwd)` re-derives the loader for the cwd and clears the cache.
- When `agentDir` is undefined (test managers built with an injected `policyLoader` or explicit paths via `createManager`), `configureForCwd` only clears the cache and leaves the injected loader intact — those tests never call it, but the no-op keeps the contract safe.

### Narrow injected interface

`PermissionSession` depends on a narrow interface — the five methods it actually uses — not the concrete class.
This is the seam that lets the test mock drop its cast.

```typescript
// permission-manager.ts
export interface ScopedPermissionManager {
  configureForCwd(cwd: string | undefined | null): void;
  checkPermission(
    toolName: string,
    input: unknown,
    agentName?: string,
    sessionRules?: Ruleset,
  ): PermissionCheckResult;
  getToolPermission(toolName: string, agentName?: string): PermissionState;
  getConfigIssues(agentName?: string): string[];
  getPolicyCacheStamp(agentName?: string): string;
}

export class PermissionManager implements ScopedPermissionManager { … }
```

ISP check: `PermissionSession` is the sole consumer and uses all five members together (it owns the manager's per-session lifecycle: configure on reset/reload, query on demand), so one cohesive interface is correct here — not over-fragmented.
`getComposedConfigRules` and `getResolvedPolicyPaths` are deliberately *excluded*: only the `runtime.permissionManager` path uses those, and that path keeps the concrete `PermissionManager` type.

### Consumer call site (index.ts)

```typescript
const runtime = createExtensionRuntime();
// ... existing wiring ...
const sessionManager = new PermissionManager({ agentDir: runtime.agentDir });
const session = new PermissionSession(
  runtime,
  createSessionLogger(runtime),
  new ForwardingManager(runtime.subagentSessionsDir, forwarder, subagentRegistry),
  sessionManager,
  { /* runtimeDeps unchanged */ },
);
```

`sessionManager` is global-only at construction; `lifecycle.handleSessionStart` → `session.resetForNewSession(ctx)` → `sessionManager.configureForCwd(ctx.cwd)` scopes it once.
This is Tell-Don't-Ask: the session tells the manager to reconfigure rather than rebuilding it.

### Extracted-module upstream check

`derivePolicyLoaderOptions` lives in `permission-manager.ts` and imports only `getGlobalConfigPath` / `getProjectConfigPath` (`config-paths.ts`) and `join` (`node:path`).
`config-paths.ts` does not import `permission-manager.ts`, so there is no import cycle — unlike keeping the helper in `runtime.ts` (which imports `permission-manager.ts`).
No output-argument mutation or reverse-search patterns are carried over; the helper is a pure value producer.

### Edge cases

- `cwd` null/undefined/empty-string → global-only loader (matches `derivePiProjectPaths`' falsy guard).
- `reload()` before activation (`this.context === null`) → `configureForCwd(undefined)` → global-only; same as today's `createPermissionManagerForCwd(agentDir, undefined)`.
- Resolved-permissions cache: `configureForCwd` clears it so a config change between sessions is observed even when mtimes look stale.

## Module-Level Changes

- `src/permission-manager.ts`
  - Add `agentDir?: string` to `PermissionManagerOptions`; store `this.agentDir`.
  - Add the `derivePolicyLoaderOptions(agentDir, cwd)` pure helper (imports `getGlobalConfigPath`, `getProjectConfigPath`, `join`).
  - Constructor: derive the loader from `agentDir` when provided and no `policyLoader`.
  - Add `configureForCwd(cwd)` method.
  - Add and export the `ScopedPermissionManager` interface; `class PermissionManager implements ScopedPermissionManager`.
- `src/permission-session.ts`
  - Add constructor param `permissionManager: ScopedPermissionManager` (inserted after `forwarding`, before `runtimeDeps`); field becomes `private readonly permissionManager: ScopedPermissionManager`.
  - Remove `import { createPermissionManagerForCwd } from "./runtime"` and the constructor body that builds the manager.
  - `resetForNewSession(ctx)`: replace the rebuild with `this.permissionManager.configureForCwd(ctx.cwd)`.
  - `reload()`: replace the rebuild with `this.permissionManager.configureForCwd(this.context?.cwd)`.
  - Update the `type { PermissionManager }` import to `type { ScopedPermissionManager }`.
- `src/index.ts`
  - Construct `const sessionManager = new PermissionManager({ agentDir: runtime.agentDir })` and pass it into `new PermissionSession(...)`.
  - `PermissionManager` is already imported indirectly?
    No — add the `PermissionManager` import (the class) for the explicit construction.
- `src/runtime.ts`
  - `createExtensionRuntime`: replace `createPermissionManagerForCwd(agentDir, undefined)` with `new PermissionManager({ agentDir })`.
  - Delete `createPermissionManagerForCwd` and `derivePiProjectPaths`.
  - Remove the now-unused `getProjectConfigPath` import (keep `getGlobalConfigPath`, still used by `saveExtensionConfig` / `logResolvedConfigPaths`).
- `test/permission-manager-unified.test.ts`
  - Add a `configureForCwd` / `agentDir` describe block (filesystem-backed via a temp `agentDir`).
- `test/permission-session.test.ts`
  - Remove `vi.mock("../src/runtime")` and the `mockCreatePermissionManagerForCwd` hoisted stub.
  - `makePermissionManager` returns a `ScopedPermissionManager` (add `configureForCwd: vi.fn()`, drop `getComposedConfigRules` / `getResolvedPolicyPaths` and the `as unknown as PermissionManager` cast).
  - `createSession` builds a manager mock and injects it.
  - `resetForNewSession` test: assert `pm.configureForCwd` called with `ctx.cwd` (was: `createPermissionManagerForCwd` called with `agentDir`, `cwd`).
  - `reload` test: assert `pm.configureForCwd` called with the current context cwd.
- `test/runtime.test.ts`
  - Remove the `createPermissionManagerForCwd` and `derivePiProjectPaths` imports and their two `describe` blocks.
  - Remove the now-unused `getProjectConfigPath` import if it is used only by those blocks.

No symbol referenced from these removed exports survives elsewhere (grep confirms `createPermissionManagerForCwd` / `derivePiProjectPaths` appear only in `runtime.ts`, `permission-session.ts`, `permission-session.test.ts`, `runtime.test.ts`).
The package skill (`.pi/skills/package-pi-permission-system/SKILL.md`) does not reference either symbol.

No doc updates required: `docs/architecture/architecture.md` references `createPermissionManagerForCwd` only in the descriptive Step 1 narrative (a record of intent, not a stale code reference); the constructibility metrics table is a snapshot, not a live count.

## Test Impact Analysis

1. New unit tests enabled by the change:
   - `PermissionManager.configureForCwd` is now directly testable: construct `new PermissionManager({ agentDir })`, write a global config and a cwd-scoped project config, assert that `configureForCwd(cwd)` makes the project policy take effect (last-match-wins) and that `configureForCwd(undefined)` reverts to global-only — proving both the loader rebuild and the cache clear.
   - `PermissionSession` becomes constructable with a plain mock collaborator (no module mock, no cast), so its delegation tests assert directly on the injected double.
2. Tests that become redundant:
   - `runtime.test.ts`'s `createPermissionManagerForCwd` and `derivePiProjectPaths` blocks — the function under test is deleted; its behavior is covered by the new `configureForCwd` unit tests at the layer that now owns the derivation.
3. Tests that must stay as-is:
   - `permission-session.test.ts` delegation tests (`checkPermission`, `getToolPermission`, `resolve`, session-rules, lifecycle) — they exercise the session's delegation contract, which is unchanged; only their fixture wiring (inject vs. mock-factory) moves.
   - `permission-manager-unified.test.ts` existing tests using the `createManager` harness (explicit `globalConfigPath` / `agentsDir`, no `agentDir`) — unaffected; they hit the non-`agentDir` constructor branch.

## TDD Order

1. **Add `configureForCwd` + `agentDir` to `PermissionManager`** — `feat:`
   - Red: in `test/permission-manager-unified.test.ts`, add tests: `{ agentDir }` construction reads global config from `getGlobalConfigPath(agentDir)`; `configureForCwd(cwd)` applies project config from `getProjectConfigPath(cwd)` and clears the cache; `configureForCwd(undefined)` reverts to global-only.
   - Green: add the `agentDir` option, the `derivePolicyLoaderOptions` helper, the `configureForCwd` method, and the `ScopedPermissionManager` interface with `implements`.
   - Purely additive — no existing caller changes.
     Run `pnpm run check` and the manager test file.
   - Note: `ScopedPermissionManager` gains its production consumer in Step 2; that is fine within the same plan (not a speculative export).
   - Commit: `feat: add PermissionManager.configureForCwd and agentDir option`.

2. **Inject the manager into `PermissionSession`** — `refactor:`
   - This is a coupled step: the constructor-signature change has a single production call site (`index.ts`) and the test helper (`createSession`), so the session change, the `index.ts` update, and the `permission-session.test.ts` update must land together.
   - Red: update `permission-session.test.ts` — remove `vi.mock("../src/runtime")` and `mockCreatePermissionManagerForCwd`; `makePermissionManager` returns a `ScopedPermissionManager` (add `configureForCwd`, drop the two unused methods and the cast); `createSession` injects the manager; rewrite the `resetForNewSession` and `reload` assertions to check `pm.configureForCwd`.
   - Green: change the `PermissionSession` constructor to accept and store the injected `ScopedPermissionManager`; remove the `createPermissionManagerForCwd` import and the three internal builds; `resetForNewSession` / `reload` call `configureForCwd`.
     Update `index.ts` to construct `new PermissionManager({ agentDir: runtime.agentDir })` and inject it.
   - Run `pnpm run check` (shared-interface change) and the full suite.
   - Commit: `refactor: inject PermissionManager into PermissionSession`.

3. **Remove the `createPermissionManagerForCwd` factory** — `refactor:`
   - Now that the session no longer calls it, point `createExtensionRuntime` at `new PermissionManager({ agentDir })`, then delete `createPermissionManagerForCwd` and `derivePiProjectPaths` and their `runtime.test.ts` blocks; drop the unused `getProjectConfigPath` imports.
   - Run `pnpm run check`, the full suite, and `pnpm fallow dead-code` to confirm no orphaned exports.
   - Commit: `refactor: remove createPermissionManagerForCwd factory`.

## Risks and Mitigations

- Risk: the `agentsDir` derivation change (explicit vs. env-default) alters which agents directory is read.
  Mitigation: in production `agentDir === getAgentDir()`, so `join(agentDir, "agents")` equals the former default; the change only removes a hidden env read and is covered by the new deterministic unit test.
- Risk: a consumer relies on the session and `runtime.permissionManager` being the same instance.
  Mitigation: they are already different instances today; this Step preserves that exactly (split-brain fix is Step 4 / #337).
  Called out in Non-Goals.
- Risk: dropping the `as unknown as PermissionManager` cast surfaces incomplete mock return values that the cast previously masked.
  Mitigation: the session-test mocks already return full `PermissionCheckResult` shapes via explicit literals; the narrow interface only requires the five methods, all stubbed.
- Risk: removing `createPermissionManagerForCwd` breaks an importer not found by grep.
  Mitigation: grep across `src/` and `test/` is clean; Step 3 runs `pnpm fallow dead-code` as a backstop.

## Open Questions

- Should the session's manager and `runtime.permissionManager` be unified (one instance for gates, RPC, command, and service)?
  Deferred to Step 4 (#337); tracked there, not here.
- Should `reload()`'s loader rebuild be dropped in favor of `FilePolicyLoader`'s mtime invalidation alone?
  Deferred to Step 4 per the issue note; kept here for behavior preservation.
