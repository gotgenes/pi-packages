---
issue: 130
issue_title: "refactor: replace HandlerDeps with handler classes using narrow constructor injection"
---

# Replace HandlerDeps with handler classes

## Problem statement

After `PermissionSession` exists (#129), `HandlerDeps` still acts as a monolithic bag.
Free-function handlers all receive the same 8-field interface even though each uses a different subset.
This makes dependency requirements invisible and test factories (`makeDeps()`) unnecessarily wide — every test file builds the same full bag regardless of which fields the handler under test touches.

## Goals

- Replace `HandlerDeps` + free-function handlers with three handler classes, each with narrow constructor injection:
  1. `SessionLifecycleHandler` (2 deps: `session`, `cleanupRpc`)
  2. `AgentPrepHandler` (2 deps: `session`, `toolRegistry`)
  3. `PermissionGateHandler` (3 deps: `session`, `events`, `toolRegistry`)
- Extract a `ToolRegistry` interface wrapping `pi.getAllTools()` and `pi.setActiveTools()`.
- Absorb `canRequestPermissionConfirmation` and `promptPermission` into `PermissionSession` (deferred from #129, see its open questions).
- Delete `HandlerDeps` and `src/handlers/types.ts`.
- Move `PromptPermissionDetails` and `PermissionReviewSource` to a shared location before their host file is deleted.
- No behavioral change — same permission decisions, same event emissions, same config loading.

## Non-goals

- Refactoring `PermissionManager` or `PermissionPrompter` internals.
- Changing the `/permission-system` slash command or config format.
- Changing any default policy state.
- Migrating `registerPermissionRpcHandlers` or `registerPermissionSystemCommand` to use `PermissionSession` — they wire through `runtime` directly in `index.ts` and are unaffected.
- Extracting `handleInput`'s permission logic into a gate descriptor (future follow-up).

## Dependencies

- **#129 — PermissionSession** (closed, implemented).
- **#126 — ExtensionPaths** (closed, implemented).
- **#127 — SessionLogger** (closed, implemented).
- **#128 — ForwardingManager** (closed, implemented).

Part of the handler decomposition series — see [plan doc](0126-handler-decomposition.md).

## Background

### Permission surfaces involved

None directly — pure internal refactor.
All surfaces (tools, bash, mcp, skills, special, external_directory) are exercised by the handlers being refactored; integration tests validate correctness.

### Current state after #129

`HandlerDeps` has 8 fields:

| Field                                   | Used by                                  |
| --------------------------------------- | ---------------------------------------- |
| `session: PermissionSession`            | all handlers                             |
| `events: PermissionEventBus`            | tool-call, input (for emitDecisionEvent) |
| `canRequestPermissionConfirmation(ctx)` | tool-call, input                         |
| `promptPermission(ctx, details)`        | tool-call, input                         |
| `createPermissionRequestId(prefix)`     | input only                               |
| `stopPermissionRpcHandlers()`           | lifecycle shutdown only                  |
| `getAllTools()`                         | before-agent-start, tool-call            |
| `setActiveTools(names)`                 | before-agent-start only                  |

Each handler uses a different subset:

- **lifecycle**: session + stopPermissionRpcHandlers
- **before-agent-start**: session + getAllTools + setActiveTools
- **tool-call**: session + events + getAllTools + canRequestPermissionConfirmation + promptPermission
- **input**: session + events + canRequestPermissionConfirmation + promptPermission + createPermissionRequestId

### Types that must relocate

`src/handlers/types.ts` currently defines `PromptPermissionDetails` and `PermissionReviewSource`.
These are imported by `src/permission-prompter.ts` and `src/handlers/gates/descriptor.ts`.
They must move to a shared location before the file is deleted.

## Design overview

### ToolRegistry interface

```typescript
interface ToolRegistry {
  getAll(): unknown[];
  setActive(names: string[]): void;
}
```

Defined in `src/tool-registry.ts` (alongside existing `getToolNameFromValue` and `checkRequestedToolRegistration`).
Constructed in `index.ts` wrapping `pi.getAllTools()` and `pi.setActiveTools()`.

### Absorb prompting into PermissionSession

`PermissionSession` gains three new methods and two new runtime deps:

```typescript
// Added to PermissionSessionRuntimeDeps
canRequestPermissionConfirmation(ctx: ExtensionContext): boolean;
promptPermission(
  ctx: ExtensionContext,
  details: PromptPermissionDetails,
): Promise<PermissionPromptDecision>;

// Added to PermissionSession
canPrompt(ctx: ExtensionContext): boolean;
prompt(
  ctx: ExtensionContext,
  details: PromptPermissionDetails,
): Promise<PermissionPromptDecision>;
createPermissionRequestId(prefix: string): string;
```

`canPrompt` delegates to `runtimeDeps.canRequestPermissionConfirmation`.
`prompt` delegates to `runtimeDeps.promptPermission`.
`createPermissionRequestId` is a self-contained ID generator (moved from `index.ts` closure).

This completes the migration that #129 deferred: handler classes call `session.canPrompt(ctx)` and `session.prompt(ctx, details)` instead of reaching through `deps.*`.

### Handler classes

```typescript
// src/handlers/lifecycle.ts
class SessionLifecycleHandler {
  constructor(
    private readonly session: PermissionSession,
    private readonly cleanupRpc: () => void,
  ) {}

  handleSessionStart(event: SessionStartPayload, ctx: ExtensionContext): Promise<void>;
  handleResourcesDiscover(event: ResourcesDiscoverPayload): Promise<void>;
  handleSessionShutdown(): Promise<void>;
}
```

```typescript
// src/handlers/before-agent-start.ts
class AgentPrepHandler {
  constructor(
    private readonly session: PermissionSession,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  handle(event: BeforeAgentStartPayload, ctx: ExtensionContext): Promise<BeforeAgentStartEventResult>;
}
```

```typescript
// src/handlers/tool-call.ts  (handleToolCall method)
// src/handlers/input.ts      (handleInput method)
class PermissionGateHandler {
  constructor(
    private readonly session: PermissionSession,
    private readonly events: PermissionEventBus,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  handleToolCall(event: unknown, ctx: ExtensionContext): Promise<{ block?: true; reason?: string }>;
  handleInput(event: InputPayload, ctx: ExtensionContext): Promise<InputEventResult>;
}
```

### Wiring in index.ts

```typescript
const session = new PermissionSession(paths, logger, forwarding, runtimeDeps);
const toolRegistry: ToolRegistry = {
  getAll: () => pi.getAllTools(),
  setActive: (names) => pi.setActiveTools(names),
};

const lifecycle = new SessionLifecycleHandler(session, () => {
  rpcHandles.unsubCheck();
  rpcHandles.unsubPrompt();
});
const agentPrep = new AgentPrepHandler(session, toolRegistry);
const gates = new PermissionGateHandler(session, pi.events, toolRegistry);

pi.on("session_start", (e, ctx) => lifecycle.handleSessionStart(e, ctx));
pi.on("resources_discover", (e) => lifecycle.handleResourcesDiscover(e));
pi.on("session_shutdown", () => lifecycle.handleSessionShutdown());
pi.on("before_agent_start", (e, ctx) => agentPrep.handle(e, ctx));
pi.on("input", (e, ctx) => gates.handleInput(e, ctx));
pi.on("tool_call", (e, ctx) => gates.handleToolCall(e, ctx));
```

### PromptPermissionDetails relocation

Move `PromptPermissionDetails` and `PermissionReviewSource` from `src/handlers/types.ts` to `src/permission-prompter.ts` (collocated with the `PermissionPrompterApi` interface that already depends on it).
Update imports in `src/handlers/gates/descriptor.ts`, `src/handlers/tool-call.ts`, `src/handlers/input.ts`, `src/handlers/index.ts`.

### GateRunnerDeps construction after refactoring

Inside `PermissionGateHandler.handleToolCall`:

```typescript
const runnerDeps: GateRunnerDeps = {
  checkPermission: (s, i, a, r) => this.session.checkPermission(s, i, a, r),
  getSessionRuleset: () => this.session.getSessionRuleset(),
  approveSessionRule: (s, p) => this.session.approveSessionRule(s, p),
  writeReviewLog: this.session.logger.review,
  emitDecision: (e) => emitDecisionEvent(this.events, e),
  canConfirm: () => this.session.canPrompt(ctx),
  promptPermission: (d) => this.session.prompt(ctx, d),
};
```

Same pattern but with `this.session` / `this.events` instead of `deps.session` / `deps.events`.

### Pure helpers that survive the class migration

`shouldExposeTool` (pure helper in `before-agent-start.ts`), `extractSkillNameFromInput` (pure helper in `input.ts`), `getEventInput` (pure helper in `tool-call.ts`) remain as exported free functions alongside their handler classes.
Tests for these pure helpers do not change.

## Module-level changes

| File                                        | Change                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/permission-session.ts`                 | Add `canPrompt(ctx)`, `prompt(ctx, details)`, `createPermissionRequestId(prefix)`. Expand `PermissionSessionRuntimeDeps` with two new delegates.                                                                                                                                                                                          |
| `src/permission-prompter.ts`                | Receives `PromptPermissionDetails` and `PermissionReviewSource` type definitions (moved from `src/handlers/types.ts`).                                                                                                                                                                                                                    |
| `src/tool-registry.ts`                      | Add `ToolRegistry` interface (alongside existing exports).                                                                                                                                                                                                                                                                                |
| `src/handlers/types.ts`                     | **Deleted.** Types moved; `HandlerDeps` removed.                                                                                                                                                                                                                                                                                          |
| `src/handlers/lifecycle.ts`                 | Free functions → `SessionLifecycleHandler` class. Constructor takes `(session, cleanupRpc)`. Methods unchanged in logic.                                                                                                                                                                                                                  |
| `src/handlers/before-agent-start.ts`        | Free function → `AgentPrepHandler` class. Constructor takes `(session, toolRegistry)`. `shouldExposeTool` stays as exported free function.                                                                                                                                                                                                |
| `src/handlers/tool-call.ts`                 | `handleToolCall` free function → `PermissionGateHandler.handleToolCall` method. Constructor takes `(session, events, toolRegistry)`. `getEventInput` stays as exported free function. Prompt closures use `this.session.canPrompt(ctx)` / `this.session.prompt(ctx, details)`. Tool registration check uses `this.toolRegistry.getAll()`. |
| `src/handlers/input.ts`                     | `handleInput` free function → `PermissionGateHandler.handleInput` method (same class as tool-call). `extractSkillNameFromInput` stays as exported free function. Uses `this.session.canPrompt(ctx)` / `this.session.prompt(ctx, details)` / `this.session.createPermissionRequestId(prefix)`.                                             |
| `src/handlers/index.ts`                     | Update re-exports: export classes + pure helpers. Remove `HandlerDeps`, `PromptPermissionDetails`, `PermissionReviewSource` re-exports.                                                                                                                                                                                                   |
| `src/handlers/gates/descriptor.ts`          | Update `PromptPermissionDetails` import path to `src/permission-prompter.ts`.                                                                                                                                                                                                                                                             |
| `src/index.ts`                              | Replace `deps: HandlerDeps` construction with handler class instantiation. Wire events to class methods. Expand `PermissionSessionRuntimeDeps` construction with `canRequestPermissionConfirmation` and `promptPermission`.                                                                                                               |
| `tests/permission-session.test.ts`          | Add tests for `canPrompt`, `prompt`, `createPermissionRequestId`.                                                                                                                                                                                                                                                                         |
| `tests/handlers/lifecycle.test.ts`          | Replace `makeDeps()` with `new SessionLifecycleHandler(mockSession, mockCleanup)`. Remove unused fields from factory.                                                                                                                                                                                                                     |
| `tests/handlers/before-agent-start.test.ts` | Replace `makeDeps()` with `new AgentPrepHandler(mockSession, mockToolRegistry)`. Remove unused fields.                                                                                                                                                                                                                                    |
| `tests/handlers/tool-call.test.ts`          | Replace `makeDeps()` with `new PermissionGateHandler(mockSession, mockEvents, mockToolRegistry)`. Remove unused fields. Add `canPrompt`/`prompt` to session mock.                                                                                                                                                                         |
| `tests/handlers/tool-call-events.test.ts`   | Same pattern as `tool-call.test.ts`.                                                                                                                                                                                                                                                                                                      |
| `tests/handlers/input.test.ts`              | Replace `makeDeps()` with `new PermissionGateHandler(mockSession, mockEvents, mockToolRegistry)`. Add `canPrompt`/`prompt`/`createPermissionRequestId` to session mock.                                                                                                                                                                   |
| `tests/handlers/input-events.test.ts`       | Same pattern as `input.test.ts`.                                                                                                                                                                                                                                                                                                          |
| `docs/architecture/architecture.md`         | Update module listing: remove `types.ts` entry, update handler file descriptions to mention classes, add `ToolRegistry` to `tool-registry.ts` description.                                                                                                                                                                                |

## Test impact analysis

1. **New unit tests enabled**: `PermissionSession.canPrompt`, `.prompt`, `.createPermissionRequestId` can be tested in isolation — these were previously untestable closures in `index.ts`.
2. **Existing tests simplified**: All 6 handler test files lose their `makeDeps()` factory.
   Each test constructs the specific handler class with only the deps it needs.
   The session mock gains `canPrompt`/`prompt`/`createPermissionRequestId` but this is mechanical — and the mock is still flat `vi.fn()` stubs.
3. **Existing tests that must stay**: Tests for handler orchestration logic (gate ordering, cache key checks, prompt flow) stay intact — they test the same class methods.
   Tests for pure helpers (`shouldExposeTool`, `extractSkillNameFromInput`, `getEventInput`) are completely unchanged.
4. **Integration test unaffected**: `tests/permission-system.test.ts` calls `piPermissionSystemExtension(mockPi)` and never sees handler internals.

## TDD order

### Step 1: Relocate PromptPermissionDetails and PermissionReviewSource

Move types from `src/handlers/types.ts` to `src/permission-prompter.ts`.
Update all import paths.
`HandlerDeps` stays temporarily in `src/handlers/types.ts`.

`refactor: move PromptPermissionDetails to permission-prompter (#130)`

### Step 2: Add ToolRegistry interface

Add `ToolRegistry` interface to `src/tool-registry.ts`.
No consumers yet — this is a type-only addition.
Run `pnpm run build` to verify.

`feat: add ToolRegistry interface (#130)`

### Step 3: Add canPrompt, prompt, createPermissionRequestId to PermissionSession

1. Add tests to `tests/permission-session.test.ts` for the three new methods.
2. Expand `PermissionSessionRuntimeDeps` with `canRequestPermissionConfirmation` and `promptPermission`.
3. Implement the methods on `PermissionSession`.
4. Update `tests/permission-session.test.ts` helper (`makeRuntimeDeps`) to include new delegates.
5. Run `pnpm run build` to verify types.

`feat: PermissionSession absorbs prompting methods (#130)`

### Step 4: Convert lifecycle handlers to SessionLifecycleHandler

1. Convert `handleSessionStart`, `handleResourcesDiscover`, `handleSessionShutdown` from free functions to methods on `SessionLifecycleHandler` class.
2. Keep the free functions as deprecated re-exports temporarily (or just update callers).
3. Update `tests/handlers/lifecycle.test.ts`: replace `makeDeps()` + `handleSessionStart(deps, ...)` with `new SessionLifecycleHandler(mockSession, mockCleanup)` + `handler.handleSessionStart(...)`.
4. Update `src/index.ts` to construct `SessionLifecycleHandler` and wire lifecycle events.
5. Remove lifecycle handler fields from `HandlerDeps` that are no longer needed (just `stopPermissionRpcHandlers`).

`refactor: SessionLifecycleHandler class (#130)`

### Step 5: Convert before-agent-start handler to AgentPrepHandler

1. Convert `handleBeforeAgentStart` to `AgentPrepHandler.handle` method.
2. Update `tests/handlers/before-agent-start.test.ts`: replace `makeDeps()` with `new AgentPrepHandler(mockSession, mockToolRegistry)`.
3. Update `src/index.ts` to construct `AgentPrepHandler` and wire `before_agent_start`.
4. `shouldExposeTool` stays as an exported free function in the same file.

`refactor: AgentPrepHandler class (#130)`

### Step 6: Convert tool-call and input handlers to PermissionGateHandler

1. Create `PermissionGateHandler` class with `handleToolCall` and `handleInput` methods.
2. `handleToolCall` moves from `src/handlers/tool-call.ts` into the class.
   `getEventInput` stays as exported free function.
3. `handleInput` moves from `src/handlers/input.ts` into the class.
   `extractSkillNameFromInput` stays as exported free function.
4. Update `tests/handlers/tool-call.test.ts` and `tests/handlers/tool-call-events.test.ts`: replace `makeDeps()` with `new PermissionGateHandler(mockSession, mockEvents, mockToolRegistry)`.
   Add `canPrompt`/`prompt` to session mock.
5. Update `tests/handlers/input.test.ts` and `tests/handlers/input-events.test.ts`: same pattern.
6. Update `src/index.ts` to construct `PermissionGateHandler` and wire `tool_call` + `input`.

`refactor: PermissionGateHandler class (#130)`

### Step 7: Delete HandlerDeps and src/handlers/types.ts

1. Remove the `HandlerDeps` interface from `src/handlers/types.ts`.
2. Delete `src/handlers/types.ts` entirely (types already relocated in step 1).
3. Update `src/handlers/index.ts` re-exports — export classes + pure helpers only.
4. Run `pnpm run build` + `pnpm vitest run` to verify nothing references `HandlerDeps`.

`refactor: delete HandlerDeps and handlers/types.ts (#130)`

### Step 8: Update architecture doc

Update `docs/architecture/architecture.md` module listing:

- Remove `types.ts` entry from `handlers/`.
- Update `lifecycle.ts`, `before-agent-start.ts`, `tool-call.ts`, `input.ts` descriptions to mention handler classes.
- Add `ToolRegistry` to `tool-registry.ts` description.
- Note that `PromptPermissionDetails` moved to `permission-prompter.ts`.

`docs: update architecture for handler classes (#130)`

## Risks and mitigations

| Risk                                                                     | Mitigation                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Could this silently weaken a permission?                                 | Pure refactor — same `checkPermission` calls, same parameters, same gate evaluation order. `PermissionGateHandler.handleToolCall` produces identical `GateRunnerDeps`. Integration tests validate end-to-end.                                                                                                                                         |
| Handler class constructor changes could break test compilation           | Each handler class is in its own file (or a new shared file for `PermissionGateHandler`). Migration is per-handler, not all-at-once. Each step leaves the repo green.                                                                                                                                                                                 |
| `PermissionSession` grows by 3 methods — risk of god object?             | The 3 new methods (`canPrompt`, `prompt`, `createPermissionRequestId`) are thin delegates. The session already coordinates prompting conceptually (it owns the `PermissionPrompter`'s caller-side interface). Total method count stays reasonable.                                                                                                    |
| `PromptPermissionDetails` relocation could break external consumers      | No external consumers — it's an internal type. All import paths are updated mechanically.                                                                                                                                                                                                                                                             |
| `ToolRegistry` interface could be too narrow or too wide                 | It mirrors exactly `pi.getAllTools()` and `pi.setActiveTools()` — the only two Pi API methods handlers need. If more are needed later, the interface can grow.                                                                                                                                                                                        |
| `createPermissionRequestId` on `PermissionSession` may feel out of place | It's a trivial ID generator that only handlers call. Alternative: a free function or a private method on `PermissionGateHandler`. Placing it on `PermissionSession` keeps the handler class constructors exactly as specified in the issue (3 deps). If it feels wrong during implementation, it can be extracted to a free utility in the same step. |
| Steps 4–6 each partially consume `HandlerDeps` while it still exists     | Each step updates `index.ts` wiring for the converted handler while leaving `HandlerDeps` in place for the remaining free functions. Step 7 is the final deletion. This incremental approach avoids a big-bang change.                                                                                                                                |

## Open questions

- Should `PermissionGateHandler` live in a single new file (e.g. `src/handlers/permission-gate-handler.ts`) or should `handleToolCall` stay in `tool-call.ts` and `handleInput` stay in `input.ts` with each exporting a class?
  Leaning toward a single file since the issue proposes a single class, but implementation may reveal it's cleaner to keep two files with one class spanning them via re-export.
  Decide during step 6.
- Should `createPermissionRequestId` live on `PermissionSession` or as a standalone free function?
  The plan places it on `PermissionSession` to keep handler class constructors minimal, but it's a pure function with no state dependency.
  Decide during step 3.
