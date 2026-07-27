---
issue_title: "Add a process-scoped yolo launcher override"
---

# Session Yolo Launcher Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a trusted launcher to activate the existing deny-preserving yolo composition for one Pi process without changing global or project configuration.

**Architecture:** A pure runtime-override module parses an injected environment map and applies the resulting immutable override to normalized extension configuration.
`index.ts` is the only production reader of `process.env`, and `ConfigStore` owns applying the override after initialization, refresh, and save while preserving the file-backed yolo value during persistence.

**Tech Stack:** TypeScript, Vitest, pnpm, Pi extension API.

## Global Constraints

- The enabling contract is the exact process environment value `PI_PERMISSION_SYSTEM_YOLO=1`.
- Missing, empty, or any other value leaves file-backed configuration unchanged.
- The override reuses the existing `ask` to `allow` yolo rewrite and therefore preserves explicit `deny` decisions.
- The override is process-scoped and must never be persisted to global or project configuration.
- Configuration refreshes must retain the override for the lifetime of the process.
- Status, config summaries, and diagnostics must report the effective yolo state.
- No source module other than `src/index.ts` reads `process.env`.

---

### Task 1: Parse and apply the launcher override

**Files:**

- Create: `packages/pi-permission-system/src/runtime-config-overrides.ts`
- Create: `packages/pi-permission-system/test/runtime-config-overrides.test.ts`

**Interfaces:**

Consumes: `PermissionSystemExtensionConfig` from `#src/extension-config`.

Produces: `PI_PERMISSION_SYSTEM_YOLO_ENV`, `PermissionSystemRuntimeOverrides`, `readPermissionSystemRuntimeOverrides(environment)`, and `applyPermissionSystemRuntimeOverrides(config, overrides)`.

- [ ] **Step 1: Write the failing parser and application tests**

```typescript
import { describe, expect, it } from "vitest";
import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";
import {
  applyPermissionSystemRuntimeOverrides,
  readPermissionSystemRuntimeOverrides,
} from "#src/runtime-config-overrides";

describe("readPermissionSystemRuntimeOverrides", () => {
  it("enables yolo only for the exact string 1", () => {
    expect(
      readPermissionSystemRuntimeOverrides({
        PI_PERMISSION_SYSTEM_YOLO: "1",
      }),
    ).toEqual({ yoloMode: true });
  });

  it.each([undefined, "", "0", "true", "yes"])(
    "does not enable yolo for %s",
    (value) => {
      expect(
        readPermissionSystemRuntimeOverrides({
          PI_PERMISSION_SYSTEM_YOLO: value,
        }),
      ).toEqual({});
    },
  );
});

describe("applyPermissionSystemRuntimeOverrides", () => {
  it("returns an effective yolo-on config without mutating the input", () => {
    const config = { ...DEFAULT_EXTENSION_CONFIG, yoloMode: false };
    const result = applyPermissionSystemRuntimeOverrides(config, {
      yoloMode: true,
    });
    expect(result).toEqual({ ...config, yoloMode: true });
    expect(config.yoloMode).toBe(false);
  });

  it("returns the file-backed values when no override is present", () => {
    const config = { ...DEFAULT_EXTENSION_CONFIG, debugLog: true };
    expect(applyPermissionSystemRuntimeOverrides(config, {})).toEqual(config);
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run:

```bash
corepack pnpm --filter @gotgenes/pi-permission-system exec vitest run test/runtime-config-overrides.test.ts
```

Expected: FAIL because `#src/runtime-config-overrides` does not exist.

- [ ] **Step 3: Implement the pure runtime-override module**

```typescript
import type { PermissionSystemExtensionConfig } from "./extension-config";

export const PI_PERMISSION_SYSTEM_YOLO_ENV = "PI_PERMISSION_SYSTEM_YOLO";

export interface PermissionSystemRuntimeOverrides {
  yoloMode?: true;
}

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function readPermissionSystemRuntimeOverrides(
  environment: RuntimeEnvironment,
): PermissionSystemRuntimeOverrides {
  return environment[PI_PERMISSION_SYSTEM_YOLO_ENV] === "1"
    ? { yoloMode: true }
    : {};
}

export function applyPermissionSystemRuntimeOverrides(
  config: PermissionSystemExtensionConfig,
  overrides: PermissionSystemRuntimeOverrides,
): PermissionSystemExtensionConfig {
  return overrides.yoloMode === true
    ? { ...config, yoloMode: true }
    : config;
}
```

- [ ] **Step 4: Run the focused test and typecheck**

Run:

```bash
corepack pnpm --filter @gotgenes/pi-permission-system exec vitest run test/runtime-config-overrides.test.ts
corepack pnpm --filter @gotgenes/pi-permission-system run check
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the pure contract**

```bash
git add packages/pi-permission-system/src/runtime-config-overrides.ts packages/pi-permission-system/test/runtime-config-overrides.test.ts
git commit -m "feat(pi-permission-system): add launcher yolo override contract"
```

### Task 2: Keep the override effective across the configuration lifecycle

**Files:**

- Modify: `packages/pi-permission-system/src/config-store.ts`
- Modify: `packages/pi-permission-system/src/index.ts`
- Modify: `packages/pi-permission-system/test/config-store.test.ts`
- Modify: `packages/pi-permission-system/test/composition-root.test.ts`

**Interfaces:**

Consumes: `PermissionSystemRuntimeOverrides`, `readPermissionSystemRuntimeOverrides`, and `applyPermissionSystemRuntimeOverrides` from Task 1.

Produces: `ConfigStore.current()` as the effective runtime configuration while `ConfigStore.save()` persists the pre-override yolo value.

- [ ] **Step 1: Add failing `ConfigStore` lifecycle tests**

Add `runtimeOverrides: {}` to `makeStore`'s default `ConfigStoreDeps`.
Add these cases:

```typescript
it("applies a yolo runtime override before any refresh", () => {
  const { store } = makeStore({ runtimeOverrides: { yoloMode: true } });
  expect(store.current()).toEqual({
    ...DEFAULT_EXTENSION_CONFIG,
    yoloMode: true,
  });
});

it("retains a yolo runtime override across refresh", () => {
  const { store } = makeStore({ runtimeOverrides: { yoloMode: true } });
  mockLoadAndMergeConfigs.mockReturnValue({
    merged: { ...DEFAULT_EXTENSION_CONFIG, yoloMode: false },
    issues: [],
  });
  store.refresh(undefined, true);
  expect(store.current().yoloMode).toBe(true);
});

it("syncs the effective yolo state after refresh", () => {
  const { store } = makeStore({ runtimeOverrides: { yoloMode: true } });
  const ctx = makeCtx({ hasUI: true });
  store.refresh(ctx, true);
  expect(mockSyncPermissionSystemStatus).toHaveBeenCalledWith(ctx, {
    ...DEFAULT_EXTENSION_CONFIG,
    yoloMode: true,
  });
});

it("does not persist the process-scoped yolo override", () => {
  const { store } = makeStore({ runtimeOverrides: { yoloMode: true } });
  mockLoadUnifiedConfig.mockReturnValue({
    config: { yoloMode: false },
  });
  store.save(store.current(), makeCommandCtx());
  expect(mockWriteFileSync).toHaveBeenCalledWith(
    expect.stringContaining(".tmp"),
    expect.stringContaining('"yoloMode": false'),
    "utf-8",
  );
  expect(store.current().yoloMode).toBe(true);
});
```

- [ ] **Step 2: Add the failing composition-root integration test**

```typescript
describe("process-scoped yolo launcher override", () => {
  it("rewrites asks while preserving explicit denies", async () => {
    vi.stubEnv("PI_PERMISSION_SYSTEM_YOLO", "1");
    writeGlobalConfig({
      yoloMode: false,
      permission: { "*": "allow", demo: "ask", blockedDemo: "deny" },
    });
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-yolo-env-cwd-"));
    const pi = makeFakePi({ toolNames: ["demo", "blockedDemo"] });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    await fireSessionStart(pi, makeChildCtx(cwd, "yolo-env-session"));

    const service = getPermissionsService();
    const allowed = service!.checkPermission("demo");
    const denied = service!.checkPermission("blockedDemo");
    expect(allowed.state).toBe("allow");
    expect(allowed.origin).toBe("yolo");
    expect(denied.state).toBe("deny");
    expect(denied.origin).not.toBe("yolo");
    rmSync(cwd, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: Run both tests and verify they fail for the missing wiring**

Run:

```bash
corepack pnpm --filter @gotgenes/pi-permission-system exec vitest run test/config-store.test.ts test/composition-root.test.ts
```

Expected: FAIL because `ConfigStoreDeps` has no runtime override and `index.ts` does not read the launcher environment.

- [ ] **Step 4: Apply overrides inside `ConfigStore`**

Add a required `runtimeOverrides: PermissionSystemRuntimeOverrides` field to `ConfigStoreDeps`.
Use one private method as the only application point:

```typescript
export interface ConfigStoreDeps {
  agentDir: string;
  policyPaths: ResolvedPolicyPathProvider;
  logger: DebugReviewLogger;
  runtimeOverrides: PermissionSystemRuntimeOverrides;
}

constructor(private readonly deps: ConfigStoreDeps) {
  this.config = this.applyRuntimeOverrides({
    ...DEFAULT_EXTENSION_CONFIG,
  });
}

private applyRuntimeOverrides(
  config: PermissionSystemExtensionConfig,
): PermissionSystemExtensionConfig {
  return applyPermissionSystemRuntimeOverrides(
    config,
    this.deps.runtimeOverrides,
  );
}
```

In `refresh`, replace the direct normalized assignment with:

```typescript
const fileConfig = normalizePermissionSystemConfig(mergeResult.merged);
const runtimeConfig = this.applyRuntimeOverrides(fileConfig);
this.config = runtimeConfig;
```

In `save`, preserve the file-backed yolo value whenever the runtime override is active:

```typescript
const normalized = normalizePermissionSystemConfig(next);
const globalPath = getGlobalConfigPath(this.deps.agentDir);
const existing = loadUnifiedConfig(globalPath);
const persistedYoloMode =
  this.deps.runtimeOverrides.yoloMode === true
    ? existing.config.yoloMode === true
    : normalized.yoloMode;
const persistedConfig = { ...normalized, yoloMode: persistedYoloMode };
const merged = {
  ...existing.config,
  debugLog: persistedConfig.debugLog,
  permissionReviewLog: persistedConfig.permissionReviewLog,
  yoloMode: persistedConfig.yoloMode,
};
```

After the successful rename, assign and report the effective configuration:

```typescript
this.config = this.applyRuntimeOverrides(persistedConfig);
syncPermissionSystemStatus(ctx, this.config);
this.lastConfigWarning = null;
this.deps.logger.debug("config.saved", {
  debugLog: this.config.debugLog,
  permissionReviewLog: this.config.permissionReviewLog,
  yoloMode: this.config.yoloMode,
});
```

- [ ] **Step 5: Wire the environment at the composition root**

```typescript
const runtimeOverrides = readPermissionSystemRuntimeOverrides(process.env);

configStore = new ConfigStore({
  agentDir,
  policyPaths: permissionManager,
  logger,
  runtimeOverrides,
});
```

Keep this read in `src/index.ts`, alongside the existing `process.platform` composition-root read.

- [ ] **Step 6: Run the focused tests and package typecheck**

Run:

```bash
corepack pnpm --filter @gotgenes/pi-permission-system exec vitest run test/config-store.test.ts test/composition-root.test.ts test/permission-manager-yolo.test.ts test/status.test.ts
corepack pnpm --filter @gotgenes/pi-permission-system run check
```

Expected: all commands PASS, including the existing hard-deny yolo regression tests.

- [ ] **Step 7: Commit the lifecycle wiring**

```bash
git add packages/pi-permission-system/src/config-store.ts packages/pi-permission-system/src/index.ts packages/pi-permission-system/test/config-store.test.ts packages/pi-permission-system/test/composition-root.test.ts
git commit -m "feat(pi-permission-system): honor launcher yolo override"
```

### Task 3: Document and verify the launcher API

**Files:**

- Modify: `packages/pi-permission-system/README.md`
- Modify: `packages/pi-permission-system/docs/configuration.md`

**Interfaces:**

Consumes: the exact `PI_PERMISSION_SYSTEM_YOLO=1` contract implemented in Tasks 1 and 2.

Produces: user-facing launcher guidance that states scope, exact parsing, persistence, and deny preservation.

- [ ] **Step 1: Add user documentation**

Document the environment variable as a trusted-launcher integration.
State that only exact `1` enables it, it applies to one Pi process and descendants, configuration reloads retain it, config files are never changed by it, and explicit deny rules remain deny.
Include this minimal example:

```bash
PI_PERMISSION_SYSTEM_YOLO=1 pi
```

- [ ] **Step 2: Run formatting, lint, tests, and dead-code checks**

Run:

```bash
corepack pnpm exec rumdl fmt packages/pi-permission-system/README.md packages/pi-permission-system/docs/configuration.md packages/pi-permission-system/docs/plans/2026-07-27-session-yolo-launcher-override.md
corepack pnpm --filter @gotgenes/pi-permission-system run check
corepack pnpm --filter @gotgenes/pi-permission-system exec vitest run
corepack pnpm run lint
corepack pnpm fallow dead-code
```

Expected: 130 or more test files pass, lint reports no errors, and dead-code analysis passes.

- [ ] **Step 3: Commit the documentation**

```bash
git add packages/pi-permission-system/README.md packages/pi-permission-system/docs/configuration.md packages/pi-permission-system/docs/plans/2026-07-27-session-yolo-launcher-override.md
git commit -m "docs(pi-permission-system): document launcher yolo override"
```
