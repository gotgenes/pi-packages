---
issue: 129
issue_title: "refactor: extract PermissionSession class to encapsulate mutable session state"
---

# Extract PermissionSession class

## Problem statement

`HandlerDeps` is a wide bag passed identically to every handler.
Handlers reach through `deps.session.permissionManager.checkPermission(...)` and `deps.session.sessionRules.getRuleset()` (Law of Demeter violations), write back into `deps.session.runtimeContext = ctx` (output argument), and duplicate the same 4-field reset sequence across three lifecycle handlers.
No single object owns the mutable session state, so callers must coordinate scattered mutations.

## Goals

- Extract a `PermissionSession` class that owns all mutable session state (`PermissionManager`, `SessionRules`, cache keys, skill entries, runtime context) and exposes operations instead of fields.
- Eliminate LoD violations: callers call `session.checkPermission(...)` instead of `deps.session.permissionManager.checkPermission(...)`.
- Eliminate output arguments: `session.activate(ctx)` replaces `deps.session.runtimeContext = ctx`.
- Consolidate scattered resets into `resetForNewSession()` and `shutdown()`.
- `PermissionSession` satisfies `GateRunnerDeps` directly — the adapter construction in `handleToolCall` becomes trivial.
- Constructor takes 4 deps: `ExtensionPaths`, `SessionLogger`, `PermissionPrompter`, `ForwardingManager`.
- No behavioral change — same permission decisions, same event emissions, same config loading.

## Non-goals

- Replacing `HandlerDeps` entirely — that is #130 (handler classes).
- Refactoring `PermissionManager` or `PermissionPrompter` internals.
- Changing the `/permission-system` slash command or config format.
- Changing any default policy state.

## Dependencies

- **#126 — ExtensionPaths** (closed, implemented).
- **#127 — SessionLogger** (closed, implemented).
- **#128 — ForwardingManager** (closed, implemented).
- **PermissionPrompter** (existing class, unchanged).

## Background

### Permission surfaces involved

None directly — pure internal refactor.
All surfaces (tools, bash, mcp, skills, special, external_directory) are exercised by the handlers being refactored; integration tests validate correctness.

### Current state

`SessionState` is a 7-field mutable interface defined in `src/runtime.ts`.
`ExtensionRuntime` extends both `ExtensionPaths` and `SessionState`, adding `config`, `lastConfigWarning`, and logging methods.
Handlers receive `HandlerDeps` with `session: SessionState` and 15+ additional fields for logging, config refresh, prompting, etc.

The scattered mutations in lifecycle handlers:

| Handler                            | Fields reset                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `handleSessionStart`               | `runtimeContext`, `permissionManager`, `activeSkillEntries`, `lastActiveToolsCacheKey`, `lastPromptStateCacheKey`, `lastKnownActiveAgentName` |
| `handleResourcesDiscover` (reload) | `permissionManager`, `activeSkillEntries`, `lastActiveToolsCacheKey`, `lastPromptStateCacheKey`                                               |
| `handleSessionShutdown`            | `runtimeContext`, `activeSkillEntries`, `lastActiveToolsCacheKey`, `lastPromptStateCacheKey`, `sessionRules.clear()`                          |

### GateRunnerDeps alignment

`GateRunnerDeps` (defined in `src/handlers/gates/descriptor.ts`) has 7 leaf methods: `checkPermission`, `getSessionRuleset`, `approveSessionRule`, `writeReviewLog`, `emitDecision`, `canConfirm`, `promptPermission`.
`PermissionSession` will expose matching methods so it can satisfy this interface directly (except `emitDecision`, `canConfirm`, and `promptPermission` which depend on `ctx` or the event bus — those remain as adapter closures).

## Design overview

### PermissionSession class shape

```typescript
class PermissionSession {
  constructor(
    private readonly paths: ExtensionPaths,
    private readonly logger: SessionLogger,
    private readonly prompter: PermissionPrompterApi,
    private readonly forwarding: ForwardingController,
  );

  // Context lifecycle
  activate(ctx: ExtensionContext): void;
  deactivate(): void;

  // Permission checking (delegates to internal PermissionManager)
  checkPermission(surface: string, input: unknown, agentName?: string, rules?: Rule[]): PermissionCheckResult;
  getToolPermission(toolName: string, agentName?: string): PermissionState;
  getConfigIssues(agentName?: string): string[];
  getPolicyCacheStamp(agentName?: string): string;
  getComposedConfigRules(agentName?: string): unknown;
  getResolvedPolicyPaths(): unknown;

  // Session rules (delegates to internal SessionRules)
  getSessionRuleset(): Rule[];
  approveSessionRule(surface: string, pattern: string): void;

  // Session lifecycle (replaces scattered field resets)
  resetForNewSession(ctx: ExtensionContext): void;
  reload(): void;
  shutdown(): void;

  // Agent-start caching
  shouldUpdateActiveTools(cacheKey: string): boolean;
  commitActiveToolsCacheKey(cacheKey: string): void;
  shouldUpdatePromptState(cacheKey: string): boolean;
  commitPromptStateCacheKey(cacheKey: string): void;

  // Skill entries
  getActiveSkillEntries(): SkillPromptEntry[];
  setActiveSkillEntries(entries: SkillPromptEntry[]): void;

  // Agent name
  resolveAgentName(ctx: ExtensionContext, systemPrompt?: string): string | null;
  get lastKnownActiveAgentName(): string | null;

  // Config
  refreshConfig(ctx?: ExtensionContext): void;
  logResolvedConfigPaths(): void;
  get config(): PermissionSystemExtensionConfig;

  // Prompting
  canPrompt(ctx: ExtensionContext): boolean;
  prompt(ctx: ExtensionContext, details: PromptPermissionDetails): Promise<PermissionPromptDecision>;

  // Infrastructure paths
  getInfrastructureDirs(): string[];
  getInfrastructureReadPaths(): string[];

  // Forwarding
  startForwarding(ctx: ExtensionContext): void;
  stopForwarding(): void;
}
```

Key design points:

1. **4 constructor deps**, all real abstractions — not raw fields.
2. **`activate(ctx)`** replaces `deps.session.runtimeContext = ctx` + `deps.forwarding.start(ctx)`.
3. **`checkPermission(...)`** delegates to internal `PermissionManager` — callers never see it.
4. **`resetForNewSession(ctx)`** replaces the 4-field reset copy-paste.
5. **`canPrompt(ctx)` and `prompt(ctx, details)`** still take `ctx` because the session does not hold the event bus and the context may change between calls.
6. Internal `PermissionManager` is recreated in `resetForNewSession()` via `createPermissionManagerForCwd()`.

### Migration strategy: alongside, then swap

1. Introduce `PermissionSession` as a new class in `src/permission-session.ts`.
2. Keep `SessionState` and `HandlerDeps` unchanged initially.
3. Wire `PermissionSession` in `src/index.ts` alongside the existing runtime.
4. Migrate handlers one at a time to use `PermissionSession` instead of reaching through `deps.session.*` fields.
5. Once all handlers are migrated, `HandlerDeps.session` changes type from `SessionState` to `PermissionSession`.
6. `SessionState` interface can be removed (or retained as the test-mock interface for `PermissionSession`).

### HandlerDeps evolution

After migration, `HandlerDeps` shrinks — many fields become unnecessary because `PermissionSession` encapsulates them:

| Removed from HandlerDeps           | Absorbed by PermissionSession                                                |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `createPermissionManagerForCwd`    | Internal to `resetForNewSession()`                                           |
| `refreshExtensionConfig`           | `session.refreshConfig()`                                                    |
| `logResolvedConfigPaths`           | `session.logResolvedConfigPaths()`                                           |
| `resolveAgentName`                 | `session.resolveAgentName()`                                                 |
| `canRequestPermissionConfirmation` | `session.canPrompt()`                                                        |
| `promptPermission`                 | `session.prompt()`                                                           |
| `forwarding`                       | Internal, exposed via `session.startForwarding()`/`session.stopForwarding()` |
| `piInfrastructureDirs`             | `session.getInfrastructureDirs()`                                            |
| `getPiInfrastructureReadPaths`     | `session.getInfrastructureReadPaths()`                                       |

Fields that remain on `HandlerDeps` (until #130 removes it entirely): `events`, `stopPermissionRpcHandlers`, `getAllTools`, `setActiveTools`, `createPermissionRequestId`.

### GateRunnerDeps adapter simplification

Before (in `handleToolCall`):

```typescript
const runnerDeps: GateRunnerDeps = {
  checkPermission: (s, i, a, r) => deps.session.permissionManager.checkPermission(s, i, a, r),
  getSessionRuleset: () => deps.session.sessionRules.getRuleset(),
  approveSessionRule: (s, p) => deps.session.sessionRules.approve(s, p),
  writeReviewLog: deps.logger.review,
  emitDecision: (e) => emitDecisionEvent(deps.events, e),
  canConfirm,
  promptPermission,
};
```

After:

```typescript
const runnerDeps: GateRunnerDeps = {
  checkPermission: (s, i, a, r) => session.checkPermission(s, i, a, r),
  getSessionRuleset: () => session.getSessionRuleset(),
  approveSessionRule: (s, p) => session.approveSessionRule(s, p),
  writeReviewLog: (e, d) => session.logger.review(e, d),
  emitDecision: (e) => emitDecisionEvent(deps.events, e),
  canConfirm: () => session.canPrompt(ctx),
  promptPermission: (d) => session.prompt(ctx, d),
};
```

No more LoD violations — every call is one level deep.

## Module-level changes

| File                                        | Change                                                                                                                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/permission-session.ts`                 | **New.** `PermissionSession` class with 4 constructor deps.                                                                                                                                        |
| `src/runtime.ts`                            | `SessionState` retained for backward compat during migration. `createPermissionManagerForCwd` stays as a free function (used by `PermissionSession` internally).                                   |
| `src/handlers/types.ts`                     | `HandlerDeps.session` type changes from `SessionState` to `PermissionSession`. Remove fields absorbed by the session.                                                                              |
| `src/handlers/lifecycle.ts`                 | Replace scattered field resets with `session.resetForNewSession(ctx)` / `session.shutdown()`. Remove `deps.createPermissionManagerForCwd` / `deps.refreshExtensionConfig` calls.                   |
| `src/handlers/before-agent-start.ts`        | Replace `deps.session.permissionManager.*` with `session.checkPermission(...)` etc. Replace `deps.resolveAgentName` with `session.resolveAgentName`.                                               |
| `src/handlers/tool-call.ts`                 | Simplify gate adapter construction — delegate to `session.*` methods. Replace `deps.forwarding.start(ctx)` with `session.startForwarding(ctx)`.                                                    |
| `src/handlers/input.ts`                     | Replace `deps.session.permissionManager.checkPermission` with `session.checkPermission`. Replace `deps.canRequestPermissionConfirmation` with `session.canPrompt`.                                 |
| `src/index.ts`                              | Construct `PermissionSession` with `ExtensionPaths`, `SessionLogger`, `PermissionPrompter`, `ForwardingManager`. Pass it as `deps.session`. Remove fields from `deps` that are now on the session. |
| `tests/permission-session.test.ts`          | **New.** Unit tests for `PermissionSession` methods: `activate`, `resetForNewSession`, `shutdown`, `checkPermission` delegation, `resolveAgentName`, cache key methods.                            |
| `tests/handlers/lifecycle.test.ts`          | Replace `makeSession()` with `PermissionSession` mock. Simplify — no more direct field assertions on session state.                                                                                |
| `tests/handlers/before-agent-start.test.ts` | Replace LoD mock chains with flat `session.checkPermission` / `session.getToolPermission` stubs.                                                                                                   |
| `tests/handlers/tool-call.test.ts`          | Simplify `makeDeps()` — session mock provides `checkPermission`, `getSessionRuleset`, etc. directly.                                                                                               |
| `tests/handlers/tool-call-events.test.ts`   | Same simplification.                                                                                                                                                                               |
| `tests/handlers/input.test.ts`              | Replace `deps.session.permissionManager.checkPermission` with `session.checkPermission`.                                                                                                           |
| `tests/handlers/input-events.test.ts`       | Same simplification.                                                                                                                                                                               |
| `docs/architecture/architecture.md`         | Update module listing: add `permission-session.ts`, update `handlers/types.ts` description.                                                                                                        |

## Test impact analysis

1. **New unit tests enabled**: `PermissionSession` can be tested in isolation — `resetForNewSession()`, `shutdown()`, `activate()`, cache key logic, agent name resolution.
   These were previously untestable because the logic was scattered across handlers.
2. **Existing handler tests simplified**: `makeSession()` factories shrink from 7+ fields with nested mocks (`permissionManager: { checkPermission: vi.fn() }`) to a flat mock of `PermissionSession` methods.
   `as unknown as` casts on `SessionState["permissionManager"]` disappear.
3. **Existing handler tests that must stay**: Tests that verify handler orchestration logic (which gates are called, in what order, how results are handled) must remain.
   Tests that verify the scattered reset sequences can be simplified to assert `session.resetForNewSession()` / `session.shutdown()` was called once.
4. **Integration test unaffected**: `tests/permission-system.test.ts` calls `piPermissionSystemExtension(mockPi)` and never constructs `HandlerDeps` — validates the wiring is correct.

## TDD order

### Phase 1: PermissionSession class (new code, no existing code changes)

1. Write `tests/permission-session.test.ts` with tests for constructor, `activate(ctx)`, `deactivate()`, `checkPermission` delegation, `getToolPermission` delegation, `getSessionRuleset` delegation, `approveSessionRule` delegation.
   Red — class does not exist yet.
   `test: add PermissionSession unit tests (#129)`

2. Implement `src/permission-session.ts` with constructor and delegation methods.
   Tests go green.
   `feat: PermissionSession class with delegation methods (#129)`

3. Add tests for `resetForNewSession(ctx)` — verifies new `PermissionManager` is created, cache keys are cleared, skill entries are cleared, forwarding is started.
   Red, then implement.
   `test: PermissionSession resetForNewSession (#129)`

4. Add tests for `shutdown()` — verifies `sessionRules.clear()`, cache keys cleared, forwarding stopped, context deactivated.
   Red, then implement.
   `test: PermissionSession shutdown (#129)`

5. Add tests for cache key methods (`shouldUpdateActiveTools`, `commitActiveToolsCacheKey`, `shouldUpdatePromptState`, `commitPromptStateCacheKey`).
   Red, then implement.
   `test: PermissionSession cache key methods (#129)`

6. Add tests for `resolveAgentName(ctx, systemPrompt?)`, `refreshConfig(ctx?)`, `logResolvedConfigPaths()`, `getInfrastructureDirs()`, `getInfrastructureReadPaths()`, `canPrompt(ctx)`, `prompt(ctx, details)`.
   Red, then implement.
   `test: PermissionSession config and prompt methods (#129)`

### Phase 2: Wire PermissionSession into index.ts (alongside existing)

1. Construct `PermissionSession` in `src/index.ts`.
   Pass it as `deps.session` on `HandlerDeps`.
   Update `HandlerDeps.session` type from `SessionState` to `PermissionSession`.
   Remove absorbed fields from `HandlerDeps`.
   Existing handler tests break (type mismatch) — update `makeDeps` factories to use a `PermissionSession` mock.
   `refactor: wire PermissionSession into HandlerDeps (#129)`

### Phase 3: Migrate handlers (one at a time)

1. Migrate `handleSessionStart` and `handleResourcesDiscover` to use `session.resetForNewSession(ctx)` instead of scattered field writes.
   Migrate `handleSessionShutdown` to use `session.shutdown()`.
   Update lifecycle tests: assert `session.resetForNewSession` / `session.shutdown` called instead of checking individual field values.
   `refactor: lifecycle handlers use PermissionSession (#129)`

2. Migrate `handleBeforeAgentStart` to use `session.resolveAgentName()`, `session.getToolPermission()`, `session.refreshConfig()`, `session.startForwarding()`, `session.getPolicyCacheStamp()`, `session.setActiveSkillEntries()`.
   Update before-agent-start tests.
   `refactor: handleBeforeAgentStart uses PermissionSession (#129)`

3. Migrate `handleToolCall` to use `session.checkPermission()`, `session.getSessionRuleset()`, `session.approveSessionRule()`, `session.startForwarding()`, `session.resolveAgentName()`, `session.getActiveSkillEntries()`, `session.getInfrastructureDirs()`, `session.getInfrastructureReadPaths()`.
   Update tool-call and tool-call-events tests.
   `refactor: handleToolCall uses PermissionSession (#129)`

4. Migrate `handleInput` to use `session.checkPermission()`, `session.canPrompt()`, `session.prompt()`, `session.resolveAgentName()`, `session.startForwarding()`.
   Update input and input-events tests.
   `refactor: handleInput uses PermissionSession (#129)`

### Phase 4: Cleanup

1. Remove `SessionState` interface from `src/runtime.ts` if no longer referenced.
   Remove absorbed free functions (`resolveAgentName`, `logResolvedConfigPaths`) from `runtime.ts` if they are now only used internally by `PermissionSession`.
   `refactor: remove SessionState interface (#129)`

2. Update `docs/architecture/architecture.md` module listing.
   `docs: update architecture for PermissionSession (#129)`

## Risks and mitigations

| Risk                                                                                                          | Mitigation                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Could this silently weaken a permission?                                                                      | Pure refactor — same `checkPermission` calls, same parameters, same gate evaluation order. `PermissionSession.checkPermission` delegates directly to `PermissionManager.checkPermission`. Integration tests validate end-to-end.              |
| Large blast radius across 6 test files                                                                        | Handlers are migrated one at a time (phase 3). Each step leaves the repo green. `PermissionSession` mock is flat — no nested object chains.                                                                                                   |
| `PermissionSession` becomes a god object                                                                      | It encapsulates state that is already coupled (permissionManager + sessionRules + caches + skillEntries all reset together). The class has ~20 methods but they are thin delegates — no business logic beyond lifecycle coordination.         |
| `ExtensionRuntime` and `PermissionSession` overlap during migration                                           | `ExtensionRuntime` continues to exist as the internal composition root. `PermissionSession` wraps a subset of its state. After #130 (handler classes), `ExtensionRuntime` may be simplified further.                                          |
| Test factories must be rewritten                                                                              | `makeSession()` factories change from 7 nested-mock fields to flat `vi.fn()` stubs on `PermissionSession` methods. This is mechanical and reduces test boilerplate.                                                                           |
| `refreshExtensionConfig` and `saveExtensionConfig` live on `runtime.ts` and touch `ExtensionRuntime` directly | `PermissionSession.refreshConfig()` delegates to the existing `refreshExtensionConfig(runtime, ctx)` free function. `saveExtensionConfig` stays on `runtime.ts` — it is only called from the `/permission-system` command, not from handlers. |

## Open questions

- Should `PermissionSession` expose a `logger` property so `handleToolCall` can pass `session.logger.review` to `GateRunnerDeps.writeReviewLog`?
  Or should it expose a `writeReviewLog` method directly?
  Leaning toward exposing the `SessionLogger` since it is already a narrow interface — avoids duplicating method signatures.
- Should `canPrompt(ctx)` and `prompt(ctx, details)` absorb `ctx` via `activate()` so they become zero-arg / one-arg?
  The issue suggests this but it adds temporal coupling (must call `activate` before `canPrompt`).
  Current plan keeps `ctx` explicit for safety — revisit in #130 if handler classes guarantee `activate` is always called first.
- Should the `config-modal.ts` command (`getComposedRules`, `getConfig`) read from `PermissionSession` instead of `runtime`?
  Defer — the command is wired in `index.ts` with closures over `runtime` and does not flow through `HandlerDeps`.
