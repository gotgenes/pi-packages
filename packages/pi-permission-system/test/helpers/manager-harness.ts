/**
 * Filesystem-backed PermissionManager harness for integration tests.
 *
 * Writes a real config file and agents directory to a temp directory so
 * PermissionManager can load them without mocking the file system.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getGlobalConfigPath,
  getProjectConfigPath,
} from "#src/config/config-paths";
import {
  FilePolicyLoader,
  type PolicyLoaderOptions,
  type ResolvedPolicyPaths,
} from "#src/config/policy-loader";
import type { PathFlavor } from "#src/path/path-flavor";
import {
  PermissionManager,
  type PolicyLoader,
} from "#src/policy/permission-manager";
import type { Rule } from "#src/policy/rule";
import type { PermissionState, ScopeConfig } from "#src/types";

/**
 * Minimal in-memory PolicyLoader for testing merge + evaluation logic
 * without touching the filesystem.
 */
export function createInMemoryPolicyLoader(
  scopes: {
    global?: ScopeConfig;
    project?: ScopeConfig;
    agent?: Record<string, ScopeConfig>;
    projectAgent?: Record<string, ScopeConfig>;
  } = {},
  mcpServerNames: readonly string[] = [],
): PolicyLoader {
  return {
    loadGlobalConfig: () => scopes.global ?? ({} as const),
    loadProjectConfig: () => scopes.project ?? ({} as const),
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || is intentional: handles both falsy name and missing key
    loadAgentConfig: (name?: string) => (name && scopes.agent?.[name]) || {},
    loadProjectAgentConfig: (name?: string) =>
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || is intentional: handles both falsy name and missing key
      (name && scopes.projectAgent?.[name]) || {},
    getConfiguredMcpServerNames: () => mcpServerNames,
    getCacheStamp: () => "in-memory",
    getResolvedPolicyPaths: (): ResolvedPolicyPaths => ({
      globalConfigPath: "/in-memory/config.json",
      globalConfigExists: true,
      projectConfigPath: null,
      projectConfigExists: false,
      agentsDir: "/in-memory/agents",
      agentsDirExists: false,
      projectAgentsDir: null,
      projectAgentsDirExists: false,
    }),
  };
}

/** Manager backed by an in-memory PolicyLoader — no filesystem required. */
export function createInMemoryManager(
  scopes: Parameters<typeof createInMemoryPolicyLoader>[0] = {},
  mcpServerNames: readonly string[] = [],
): PermissionManager {
  return new PermissionManager({
    policyLoader: createInMemoryPolicyLoader(scopes, mcpServerNames),
  });
}

/** The common case: a manager over one global scope and nothing else. */
export function createInMemoryGlobalManager(
  global: ScopeConfig,
  mcpServerNames: readonly string[] = [],
): PermissionManager {
  return createInMemoryManager({ global }, mcpServerNames);
}

/**
 * Manager reading policy files at explicit paths, for tests that place config
 * outside an agentDir layout. Production derives every path from an agentDir.
 */
export function createManagerFromPaths(
  paths: PolicyLoaderOptions,
  options: { flavor?: PathFlavor; isYoloEnabled?: () => boolean } = {},
): PermissionManager {
  return new PermissionManager({
    policyLoader: new FilePolicyLoader(paths),
    ...options,
  });
}

/** Manager backed by nonexistent config paths — universal default is "ask". */
export function createMissingConfigManager(
  mcpServerNames: readonly string[] = [],
): PermissionManager {
  return createManagerFromPaths({
    globalConfigPath: "/nonexistent/config.json",
    agentsDir: "/nonexistent/agents",
    mcpServerNames: [...mcpServerNames],
  });
}

/** Build a session-layer rule (default action "allow"). */
export function sessionRule(
  surface: string,
  pattern: string,
  action: PermissionState = "allow",
): Rule {
  return { surface, pattern, action, layer: "session", origin: "session" };
}

export type CreateManagerOptions = {
  mcpServerNames?: readonly string[];
};

export type CreateManagerWithProjectOptions = CreateManagerOptions & {
  projectConfig?: ScopeConfig;
  projectAgentFiles?: Record<string, string>;
};

export function createManager(
  config: ScopeConfig,
  agentFiles: Record<string, string> = {},
  options: CreateManagerOptions = {},
) {
  const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-test-"));
  const globalConfigPath = join(baseDir, "pi-permissions.jsonc");
  const agentsDir = join(baseDir, "agents");

  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    globalConfigPath,
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );

  for (const [name, content] of Object.entries(agentFiles)) {
    writeFileSync(join(agentsDir, `${name}.md`), content, "utf8");
  }

  const manager = createManagerFromPaths({
    globalConfigPath,
    agentsDir,
    mcpServerNames: options.mcpServerNames,
  });

  return {
    manager,
    globalConfigPath,
    cleanup: (): void => {
      rmSync(baseDir, { recursive: true, force: true });
    },
  };
}

/**
 * Manager backed by a temp config holding only a permission map.
 * Delegates to createManager; returns the manager and its cleanup.
 */
export function createManagerWithConfig(
  permission: Record<string, unknown>,
  mcpServerNames: readonly string[] = [],
): { manager: PermissionManager; cleanup: () => void } {
  const { manager, cleanup } = createManager(
    { permission } as ScopeConfig,
    {},
    { mcpServerNames },
  );
  return { manager, cleanup };
}

export function createManagerWithProject(
  config: ScopeConfig,
  agentFiles: Record<string, string> = {},
  options: CreateManagerWithProjectOptions = {},
) {
  const baseDir = mkdtempSync(
    join(tmpdir(), "pi-permission-system-proj-test-"),
  );
  const globalConfigPath = join(baseDir, "pi-permissions.jsonc");
  const agentsDir = join(baseDir, "agents");
  const projectRoot = join(baseDir, "project");
  const projectGlobalConfigPath = join(projectRoot, "pi-permissions.jsonc");
  const projectAgentsDir = join(projectRoot, "agents");

  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(projectAgentsDir, { recursive: true });

  writeFileSync(
    globalConfigPath,
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
  if (options.projectConfig) {
    writeFileSync(
      projectGlobalConfigPath,
      `${JSON.stringify(options.projectConfig, null, 2)}\n`,
      "utf8",
    );
  }

  for (const [name, content] of Object.entries(agentFiles)) {
    writeFileSync(join(agentsDir, `${name}.md`), content, "utf8");
  }

  for (const [name, content] of Object.entries(
    options.projectAgentFiles ?? {},
  )) {
    writeFileSync(join(projectAgentsDir, `${name}.md`), content, "utf8");
  }

  const manager = createManagerFromPaths({
    globalConfigPath,
    agentsDir,
    projectGlobalConfigPath,
    projectAgentsDir,
    mcpServerNames: options.mcpServerNames,
  });

  return {
    manager,
    cleanup: (): void => {
      rmSync(baseDir, { recursive: true, force: true });
    },
  };
}

/**
 * Build a temp agentDir with a global config and an optional cwd with a
 * project config. Returns the paths and a cleanup function.
 */
export function createAgentDirHarness(opts: {
  globalPermission: Record<string, unknown>;
  projectPermission?: Record<string, unknown>;
}): {
  agentDir: string;
  cwd: string;
  globalConfigPath: string;
  projectConfigPath: string;
  cleanup: () => void;
} {
  const baseDir = mkdtempSync(join(tmpdir(), "pm-agent-dir-test-"));
  const agentDir = join(baseDir, "agent");
  const cwd = join(baseDir, "project");

  const globalConfigPath = getGlobalConfigPath(agentDir);
  mkdirSync(join(agentDir, "extensions", "pi-permission-system"), {
    recursive: true,
  });
  writeFileSync(
    globalConfigPath,
    JSON.stringify({ permission: opts.globalPermission }, null, 2),
  );

  const projectConfigPath = getProjectConfigPath(cwd);
  mkdirSync(join(cwd, ".pi", "extensions", "pi-permission-system"), {
    recursive: true,
  });
  if (opts.projectPermission) {
    writeFileSync(
      projectConfigPath,
      JSON.stringify({ permission: opts.projectPermission }, null, 2),
    );
  }

  return {
    agentDir,
    cwd,
    globalConfigPath,
    projectConfigPath,
    cleanup: () => rmSync(baseDir, { recursive: true, force: true }),
  };
}
