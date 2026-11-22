---
issue: 43
issue_title: "Eliminate module-scope mutable state and cached getAgentDir() in src/index.ts"
---

# Eliminate module-scope mutable state

## Problem Statement

`src/index.ts` has 16 module-scope declarations (5 cached path constants, 4 mutable variables, 3 setter functions, and 4 helper functions that close over them) that violate the AGENTS.md rule against caching `getAgentDir()` at module scope.
Additionally, `src/forwarded-permissions/io.ts` has its own module-scope `logger` variable with a `setForwardedPermissionLogger` setter — a hidden temporal coupling that silently no-ops if the setter is never called.

These work in production but make the module untestable in isolation because tests set `PI_CODING_AGENT_DIR` after import, by which point the cached values are already frozen.
The setter-injection pattern (`setExtensionConfig`, `setLoggingWarningReporter`, `setForwardedPermissionLogger`) creates hidden call-order requirements: if the setup sequence changes, state silently breaks.

## Goals

- Create an `ExtensionRuntime` context object in `src/runtime.ts`, constructed inside `piPermissionSystemExtension()` at factory invocation time (calling `getAgentDir()` then).
- Move all module-scope mutable state and cached path constants from `src/index.ts` into `ExtensionRuntime`.
- Eliminate `setExtensionConfig`, `setLoggingWarningReporter`, and `setForwardedPermissionLogger` by threading the runtime (or its logger) through to the functions that need it.
- Simplify `HandlerDeps` to reference `ExtensionRuntime` instead of duplicating getter/setter pairs.
- Reduce `src/index.ts` toward the ≤200-line target by moving factory helpers into the runtime module.

## Non-Goals

- Changing permission resolution logic, merge precedence, or default policy.
- Unifying the Rule type or normalizing config into flat Ruleset (#56).
- Replacing `SessionApprovalCache` with session Ruleset (#57).
- Changing the on-disk config format, schema, or example config.
- Extracting the `/permission-system` slash command registration to a separate module.

## Background

### Dependencies (all resolved)

- #41 (permission-gate extraction) — CLOSED.
  `applyPermissionGate` exists in `src/permission-gate.ts`.
- #42 (handler extraction) — CLOSED.
  Handlers live in `src/handlers/` and receive a `HandlerDeps` object.
  The #42 plan explicitly noted: "#43 will fold the getter/setter pairs and mutable fields into ExtensionRuntime."

### Current module-scope state in `src/index.ts`

Lines 74–108 contain everything that must move:

```typescript
// Cached getAgentDir() — AGENTS.md violation
const PI_AGENT_DIR = getAgentDir();
const SESSIONS_DIR = join(PI_AGENT_DIR, "sessions");
const SUBAGENT_SESSIONS_DIR = join(PI_AGENT_DIR, "subagent-sessions");
const PERMISSION_FORWARDING_DIR = join(SESSIONS_DIR, "permission-forwarding");
const GLOBAL_LOGS_DIR = getGlobalLogsDir(PI_AGENT_DIR);

// Mutable config state + setter
let extensionConfig: PermissionSystemExtensionConfig = { ...DEFAULT_EXTENSION_CONFIG };
function setExtensionConfig(config) { ... }

// Logger created from cached paths + config getter
const extensionLogger = createPermissionSystemLogger({ ... });

// Warning dedup state + setter
const reportedLoggingWarnings = new Set<string>();
let loggingWarningReporter: ((message: string) => void) | null = null;
function setLoggingWarningReporter(reporter) { ... }

// Logging helpers that close over the above
function reportLoggingWarning(message) { ... }
function writeDebugLog(event, details) { ... }
function writeReviewLog(event, details) { ... }
```

### Setter injection in `src/forwarded-permissions/io.ts`

Lines 28–33: module-scope `logger` variable with `setForwardedPermissionLogger` setter.
Called from `src/index.ts` line 259.
Used by `logPermissionForwardingWarning` and `logPermissionForwardingError`, which are in turn called by 8+ IO functions in the same file.

### Current `HandlerDeps` (from `src/handlers/types.ts`)

95 lines of getter/setter pairs and helper closures.
The #42 plan designed it as a stepping stone: "Handler function signatures use a single deps parameter — swapping the type is a one-line change per handler."

### Permission surfaces involved

All surfaces (tools, bash, mcp, skills, special, external_directory) — this is a cross-cutting structural refactor, not a surface-specific change.

## Design Overview

### `ExtensionRuntime` interface

```typescript
export interface ExtensionRuntime {
  // ── Immutable paths (derived from getAgentDir() at construction) ─────
  readonly agentDir: string;
  readonly sessionsDir: string;
  readonly subagentSessionsDir: string;
  readonly forwardingDir: string;
  readonly globalLogsDir: string;

  // ── Mutable state ──────────────────────────────────────────────────────
  config: PermissionSystemExtensionConfig;
  runtimeContext: ExtensionContext | null;
  permissionManager: PermissionManager;
  activeSkillEntries: SkillPromptEntry[];
  lastKnownActiveAgentName: string | null;
  lastActiveToolsCacheKey: string | null;
  lastPromptStateCacheKey: string | null;
  lastConfigWarning: string | null;
  readonly sessionApprovalCache: SessionApprovalCache;

  // ── Forwarding polling state ───────────────────────────────────────────
  permissionForwardingContext: ExtensionContext | null;
  permissionForwardingTimer: NodeJS.Timeout | null;
  isProcessingForwardedRequests: boolean;

  // ── Logging (created at construction, closes over config) ──────────────
  writeDebugLog(event: string, details?: Record<string, unknown>): void;
  writeReviewLog(event: string, details?: Record<string, unknown>): void;
}
```

### `createExtensionRuntime()` factory

```typescript
export function createExtensionRuntime(
  options?: { agentDir?: string },
): ExtensionRuntime { ... }
```

- Calls `getAgentDir()` (or uses the override from `options`) to derive all path constants.
- Creates the logger via `createPermissionSystemLogger()` with the derived paths.
- Initializes mutable state to defaults.
- Tests call `createExtensionRuntime({ agentDir: tmpDir })` — no module-scope caching, no `PI_CODING_AGENT_DIR` timing issues.

### `HandlerDeps` simplification

Replace getter/setter pairs with direct `ExtensionRuntime` access.
The interface shrinks from ~95 lines to ~40 by referencing the runtime:

```typescript
export interface HandlerDeps {
  readonly runtime: ExtensionRuntime;

  // Factories
  createPermissionManagerForCwd(cwd: string | undefined | null): PermissionManager;

  // Config & lifecycle
  refreshExtensionConfig(ctx?: ExtensionContext): void;
  notifyWarning(message: string): void;
  logResolvedConfigPaths(): void;

  // Permission helpers
  resolveAgentName(ctx: ExtensionContext, systemPrompt?: string): string | null;
  canRequestPermissionConfirmation(ctx: ExtensionContext): boolean;
  promptPermission(ctx: ExtensionContext, details: PromptPermissionDetails): Promise<PermissionPromptDecision>;
  createPermissionRequestId(prefix: string): string;

  // Forwarding
  startForwardedPermissionPolling(ctx: ExtensionContext): void;
  stopForwardedPermissionPolling(): void;

  // Pi API subset
  getAllTools(): unknown[];
  setActiveTools(names: string[]): void;
}
```

Handlers access state via `deps.runtime.config`, `deps.runtime.permissionManager`, etc. instead of `deps.getPermissionManager()`.

### Forwarded-permission logger threading

Two approaches for eliminating `setForwardedPermissionLogger`:

1. Add a `logger` field to `PermissionForwardingDeps` (which already exists and is threaded through).
2. Make `logPermissionForwardingWarning` and `logPermissionForwardingError` accept a logger parameter, threaded through the ~8 IO functions that call them.

Option 1 is simpler — `PermissionForwardingDeps` already has `writeReviewLog` and is threaded to `polling.ts`.
The remaining gap is `io.ts` functions called *within* polling that call `logPermissionForwardingWarning/Error`.
These functions already receive context indirectly; adding an explicit logger parameter to each is mechanical but verbose.

The pragmatic approach: make `logPermissionForwardingWarning` and `logPermissionForwardingError` accept an optional `logger` parameter (falling back to `null` for backward compat during migration), then convert all internal call sites to pass the logger.
Once all callers pass it, remove the module-scope `logger` variable and `setForwardedPermissionLogger`, and make the parameter required.

### Helper function relocation

Factory helpers currently defined inside `piPermissionSystemExtension()` in `src/index.ts` (~200 lines) move into `src/runtime.ts` as standalone functions that take `ExtensionRuntime`:

| Helper                            | Current location      | New location                            |
| --------------------------------- | --------------------- | --------------------------------------- |
| `refreshExtensionConfig`          | index.ts closure      | `src/runtime.ts` (takes runtime)        |
| `saveExtensionConfig`             | index.ts closure      | `src/runtime.ts` (takes runtime)        |
| `createPermissionManagerForCwd`   | index.ts module scope | `src/runtime.ts` (takes agentDir)       |
| `derivePiProjectPaths`            | index.ts module scope | `src/runtime.ts` (pure, unchanged)      |
| `writeDebugLog`/`writeReviewLog`  | index.ts module scope | `ExtensionRuntime` methods              |
| `reportLoggingWarning`            | index.ts module scope | internal to runtime logger setup        |
| `reviewPermissionDecision`        | index.ts closure      | `src/runtime.ts` (takes writeReviewLog) |
| `promptPermission`                | index.ts closure      | `src/runtime.ts` (takes runtime)        |
| `resolveAgentName`                | index.ts closure      | `src/runtime.ts` (takes runtime)        |
| `logResolvedConfigPaths`          | index.ts closure      | `src/runtime.ts` (takes runtime)        |
| `startForwardedPermissionPolling` | index.ts closure      | `src/runtime.ts` (takes runtime)        |
| `stopForwardedPermissionPolling`  | index.ts closure      | `src/runtime.ts` (takes runtime)        |

### Target `src/index.ts` shape

After this refactor, `src/index.ts` becomes:

```typescript
export default function piPermissionSystemExtension(pi: ExtensionAPI): void {
  const runtime = createExtensionRuntime();
  const deps = createHandlerDeps(runtime, pi);

  refreshExtensionConfig(runtime);
  registerPermissionSystemCommand(pi, { ... });

  pi.on("session_start", (event, ctx) => handleSessionStart(deps, event, ctx));
  pi.on("resources_discover", (event) => handleResourcesDiscover(deps, event));
  // ... etc
}
```

Target: ≤150 lines.

## Module-Level Changes

### New files

| File             | Contents                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `src/runtime.ts` | `ExtensionRuntime` interface, `createExtensionRuntime()` factory, relocated helper functions |

### Modified files

| File                                   | Change                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                         | Remove all module-scope state (lines 74–130), remove factory helper closures (~200 lines), replace with `createExtensionRuntime()` + `createHandlerDeps()`. Target ≤150 lines.                 |
| `src/handlers/types.ts`                | Simplify `HandlerDeps`: replace getter/setter pairs with `runtime: ExtensionRuntime` field. Remove ~30 lines of accessor declarations.                                                         |
| `src/handlers/lifecycle.ts`            | Update to access state via `deps.runtime.*` instead of `deps.get*()` / `deps.set*()`.                                                                                                          |
| `src/handlers/before-agent-start.ts`   | Same state-access updates.                                                                                                                                                                     |
| `src/handlers/input.ts`                | Same state-access updates.                                                                                                                                                                     |
| `src/handlers/tool-call.ts`            | Same state-access updates.                                                                                                                                                                     |
| `src/forwarded-permissions/io.ts`      | Remove module-scope `logger` and `setForwardedPermissionLogger`. Add logger parameter to `logPermissionForwardingWarning` and `logPermissionForwardingError`. Thread through internal callers. |
| `src/forwarded-permissions/polling.ts` | Pass logger from `PermissionForwardingDeps` to IO functions that need it.                                                                                                                      |

### Test files

| File                                                     | Change                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `tests/runtime.test.ts` (new)                            | Unit tests for `createExtensionRuntime()` and relocated helper functions.                       |
| `tests/handlers/lifecycle.test.ts`                       | Update mock deps to use `runtime` field instead of getter/setter stubs.                         |
| `tests/handlers/before-agent-start.test.ts`              | Same mock deps updates.                                                                         |
| `tests/handlers/input.test.ts`                           | Same mock deps updates.                                                                         |
| `tests/handlers/tool-call.test.ts`                       | Same mock deps updates.                                                                         |
| `tests/permission-system.test.ts`                        | May need updates if module-scope imports of removed functions change. Run full suite to verify. |
| `tests/forwarded-permissions/io.test.ts` (new or update) | Test that IO functions work with explicit logger parameter.                                     |

### No changes to

- `schemas/permissions.schema.json`, `config/config.example.json`, `README.md` — this is an internal structural refactor with no config, schema, or user-facing impact.
- `src/permission-manager.ts`, `src/permission-gate.ts`, `src/permission-dialog.ts` — consumed but not modified.
- `src/config-paths.ts`, `src/config-loader.ts` — pure path/loading functions, unchanged.

## TDD Order

### Step 1: Define `ExtensionRuntime` interface and `createExtensionRuntime()`

- Test surface: `tests/runtime.test.ts` — verify `createExtensionRuntime()` derives correct paths from a test `agentDir`; verify default mutable state; verify `writeDebugLog`/`writeReviewLog` delegate to the logger.
- Commit: `feat: define ExtensionRuntime and createExtensionRuntime factory (#43)`

### Step 2: Extract helper functions into `src/runtime.ts`

- Test surface: `tests/runtime.test.ts` — test `createPermissionManagerForCwd`, `derivePiProjectPaths`, `refreshExtensionConfig`, `resolveAgentName` as standalone functions that take runtime.
  Verify they read/write `runtime.*` fields correctly.
- Commit: `feat: relocate factory helpers into src/runtime.ts (#43)`

### Step 3: Update handler tests to use `runtime` field in mock deps

- Test surface: `tests/handlers/*.test.ts` — update all mock `HandlerDeps` construction to use `{ runtime: mockRuntime, ... }` instead of getter/setter stubs.
  All existing handler tests must still pass.
- Commit: `test: update handler test mocks for ExtensionRuntime deps (#43)`

### Step 4: Simplify `HandlerDeps` and update handler implementations

- Test surface: all handler tests + `npx vitest run` full suite.
- Change `HandlerDeps` in `src/handlers/types.ts` to use `runtime: ExtensionRuntime`.
- Update all handler files to access `deps.runtime.*` instead of `deps.get*()`.
- Commit: `feat: simplify HandlerDeps to use ExtensionRuntime (#43)`

### Step 5: Thread logger through forwarded-permissions IO

- Test surface: `tests/forwarded-permissions/io.test.ts` (new or existing) — verify `logPermissionForwardingWarning` and `logPermissionForwardingError` call the provided logger; verify IO functions that call them propagate the logger.
- Remove `setForwardedPermissionLogger` and module-scope `logger`.
- Update `src/forwarded-permissions/polling.ts` to pass the logger.
- Commit: `feat: thread logger through forwarded-permissions IO (#43)`

### Step 6: Wire `ExtensionRuntime` in `src/index.ts` and remove module-scope state

- Remove all module-scope mutable state (lines 74–130).
- Remove `setExtensionConfig`, `setLoggingWarningReporter`, module-scope helper functions.
- Replace with `createExtensionRuntime()` call inside factory.
- Build deps from runtime.
- Run full test suite.
- Commit: `feat: eliminate module-scope state in src/index.ts (#43)`

### Step 7: Verify line count and clean build

- Confirm `src/index.ts` is ≤150 lines.
- Run `pnpm run build` for type checking.
- Run `npx vitest run` for full suite.
- Commit: `docs: update plan notes for module-scope state elimination (#43)`

## Risks and Mitigations

| Risk                                                                                            | Mitigation                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Could this silently weaken a permission?                                                        | No — this is a pure structural refactor. Permission decisions are unchanged. The same `PermissionManager`, `applyPermissionGate`, and handler logic run with identical inputs. No new `"allow"` path is introduced.                                                                                                                           |
| Handler tests break due to mock shape change                                                    | Step 3 updates all handler test mocks *before* step 4 changes the production `HandlerDeps` type. This ensures tests are green on both sides of the transition.                                                                                                                                                                                |
| `forwarded-permissions/io.ts` functions silently lose logging                                   | Step 5 adds the logger parameter and removes the setter in one atomic step. Any function that previously called `logger?.writeReviewLog(...)` now receives the logger explicitly. The `?.` optional chaining is preserved for the case where no logger is configured (e.g., direct IO function usage in tests).                               |
| Integration tests in `permission-system.test.ts` import module-scope functions that get removed | `permission-system.test.ts` imports `piPermissionSystemExtension` (the factory), not the module-scope helpers directly. The only risk is if test setup depends on module-scope state being initialized at import time — but the test already sets `PI_CODING_AGENT_DIR` before calling the factory, so the fix aligns with the test's intent. |
| `createExtensionRuntime` called multiple times in concurrent test files                         | Each call creates an independent runtime with its own state. No shared mutable state between instances — this is the whole point.                                                                                                                                                                                                             |
| Large changeset across many files                                                               | Steps are ordered so each commit is independently valid and testable. The riskiest step (6) is preceded by comprehensive mock updates (3) and type changes (4) that surface any mismatch at compile time.                                                                                                                                     |

## Implementation Notes

- `createHandlerDeps` was kept inline in `src/index.ts` (≤20 lines as predicted).
- `PermissionForwardingDeps` gained a `logger: ForwardedPermissionLogger` field (step 5 option 1 from the Open Questions).
  All io.ts functions that log now take `logger: ForwardedPermissionLogger | null` as the first parameter.
  The module-scope `logger` variable and `setForwardedPermissionLogger` were removed entirely.
- `src/index.ts` reduced from 466 → 99 lines (79% reduction).
  The ≤150-line target was comfortably met.
- `runtime.writeReviewLog` / `runtime.writeDebugLog` are plain arrow functions on the runtime object (not class methods), so `.bind(runtime)` is technically a no-op but was added for clarity when passing them as callbacks.
- The `getContextSystemPrompt` helper in `polling.ts` calls `logPermissionForwardingWarning(null, ...)` because it has no access to `deps` — the warning is silently dropped in that one case, which is acceptable (it's a best-effort metadata read).

## Open Questions

- None remaining.
