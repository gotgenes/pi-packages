/**
 * Shared real-instance test fixtures for PermissionSession and
 * PermissionResolver.
 *
 * Use these instead of hand-rolling per-file mock intersection types.
 * Build a real PermissionSession from small per-collaborator fakes so tests
 * assert against actual behavior rather than mock contracts.
 *
 * Note: tests that exercise `resolveAgentName` must mock `active-agent` in
 * their own file (the vi.hoisted / vi.mock pattern from permission-session.test.ts)
 * since that mock is module-scoped.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

import type { ResolvedAccessIntent } from "#src/access-intent/access-intent";
import type { SessionConfigStore } from "#src/config-store";
import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";
import type { ExtensionPaths } from "#src/extension-paths";
import type { ForwardingController } from "#src/forwarding-manager";
import type { ScopedPermissionManager } from "#src/permission-manager";
import { PermissionResolver } from "#src/permission-resolver";
import { PermissionSession } from "#src/permission-session";
import type { PromptingGatewayLifecycle } from "#src/prompting-gateway";
import type { Ruleset } from "#src/rule";
import type { SessionLogger } from "#src/session-logger";
import { SessionRules } from "#src/session-rules";
import type { PermissionCheckResult, PermissionState } from "#src/types";

// ── Per-collaborator fake factories ────────────────────────────────────────

export function makePaths(
  overrides: Partial<ExtensionPaths> = {},
): ExtensionPaths {
  return {
    agentDir: "/test/agent",
    sessionsDir: "/test/agent/sessions",
    subagentSessionsDir: "/test/agent/subagent-sessions",
    forwardingDir: "/test/agent/sessions/permission-forwarding",
    globalLogsDir: "/test/agent/logs",
    piInfrastructureDirs: ["/test/agent", "/test/agent/git"],
    ...overrides,
  };
}

export function makeLogger(): SessionLogger {
  return {
    debug: vi.fn(),
    review: vi.fn(),
    warn: vi.fn(),
  };
}

export function makeConfigStore(
  overrides: Partial<SessionConfigStore> = {},
): SessionConfigStore {
  return {
    current:
      overrides.current ??
      vi
        .fn<() => typeof DEFAULT_EXTENSION_CONFIG>()
        .mockReturnValue({ ...DEFAULT_EXTENSION_CONFIG }),
    refresh: overrides.refresh ?? vi.fn<(ctx?: ExtensionContext) => void>(),
    logResolvedPaths: overrides.logResolvedPaths ?? vi.fn<() => void>(),
  };
}

export function makeGateway(): PromptingGatewayLifecycle {
  return {
    activate: vi.fn<PromptingGatewayLifecycle["activate"]>(),
    deactivate: vi.fn<PromptingGatewayLifecycle["deactivate"]>(),
  };
}

export function makeForwarding(): ForwardingController {
  return {
    start: vi.fn(),
    stop: vi.fn(),
  };
}

/**
 * Fake `ScopedPermissionManager` with vi.fn() stubs.
 *
 * Return type is intentionally unannotated so callers retain full `vi.fn()`
 * mock access (`mock.calls`, `toHaveBeenCalledWith`, `mockReturnValue`, etc.).
 */
export function makeFakePermissionManager() {
  return {
    configureForCwd: vi.fn<(cwd: string | undefined | null) => void>(),
    check: vi
      .fn<
        (
          intent: ResolvedAccessIntent,
          sessionRules?: Ruleset,
        ) => PermissionCheckResult
      >()
      .mockReturnValue({
        state: "allow",
        toolName: "read",
        source: "tool",
        origin: "builtin",
      }),
    getToolPermission: vi
      .fn<(toolName: string, agentName?: string) => PermissionState>()
      .mockReturnValue("allow"),
    getConfigIssues: vi.fn((): string[] => []),
    hasPathRules: vi.fn((): boolean => false),
  };
}

// ── Real-instance factories ────────────────────────────────────────────────

/**
 * Build a real PermissionSession from per-collaborator fakes.
 *
 * Returns the session and every collaborator so callers can destructure only
 * what they need and assert against collaborator spies directly.
 * The `permissionManager` is a `makeFakePermissionManager()` result unless
 * the caller passes an explicit `ScopedPermissionManager`.
 */
export function makeRealSession(overrides?: {
  paths?: Partial<ExtensionPaths>;
  logger?: SessionLogger;
  forwarding?: ForwardingController;
  permissionManager?: ScopedPermissionManager;
  sessionRules?: SessionRules;
  configStore?: SessionConfigStore;
  gateway?: PromptingGatewayLifecycle;
}): {
  session: PermissionSession;
  paths: ExtensionPaths;
  logger: SessionLogger;
  forwarding: ForwardingController;
  permissionManager: ReturnType<typeof makeFakePermissionManager>;
  sessionRules: SessionRules;
  configStore: SessionConfigStore;
  gateway: PromptingGatewayLifecycle;
} {
  const paths = makePaths(overrides?.paths);
  const logger = overrides?.logger ?? makeLogger();
  const forwarding = overrides?.forwarding ?? makeForwarding();
  const permissionManager =
    (overrides?.permissionManager as
      | ReturnType<typeof makeFakePermissionManager>
      | undefined) ?? makeFakePermissionManager();
  const sessionRules = overrides?.sessionRules ?? new SessionRules();
  const configStore = overrides?.configStore ?? makeConfigStore();
  const gateway = overrides?.gateway ?? makeGateway();
  const session = new PermissionSession(
    paths,
    forwarding,
    permissionManager,
    sessionRules,
    configStore,
    gateway,
  );
  return {
    session,
    paths,
    logger,
    forwarding,
    permissionManager,
    sessionRules,
    configStore,
    gateway,
  };
}

/**
 * Build a real PermissionResolver from a fake manager and a SessionRules
 * instance.
 *
 * When called with no arguments, creates a fresh fake manager and fresh
 * SessionRules.  Pass shared instances to connect the resolver to the same
 * manager/rules used by a real session.
 */
export function makeRealResolver(
  manager?: ReturnType<typeof makeFakePermissionManager>,
  sessionRules?: SessionRules,
): {
  resolver: PermissionResolver;
  manager: ReturnType<typeof makeFakePermissionManager>;
  sessionRules: SessionRules;
} {
  const resolvedManager = manager ?? makeFakePermissionManager();
  const resolvedRules = sessionRules ?? new SessionRules();
  const resolver = new PermissionResolver(resolvedManager, resolvedRules);
  return { resolver, manager: resolvedManager, sessionRules: resolvedRules };
}
