import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FilePolicyLoader } from "#src/policy-loader";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "policy-loader-test-"));
}

function makeLoader(
  baseDir: string,
  options: {
    globalConfig?: Record<string, unknown>;
    settingsPolicy?: Record<string, unknown>;
    mcpServerNames?: readonly string[];
  } = {},
) {
  const agentsDir = join(baseDir, "agents");
  mkdirSync(agentsDir, { recursive: true });

  const globalConfigPath = join(baseDir, "config.json");
  writeFileSync(
    globalConfigPath,
    JSON.stringify(options.globalConfig ?? {}, null, 2),
  );
  const globalSettingsPath = join(baseDir, "settings.json");
  writeFileSync(
    globalSettingsPath,
    JSON.stringify(
      options.settingsPolicy
        ? { piPermissionSystem: options.settingsPolicy }
        : {},
      null,
      2,
    ),
  );

  return new FilePolicyLoader({
    globalConfigPath,
    globalSettingsPath,
    agentsDir,
    mcpServerNames: options.mcpServerNames
      ? [...options.mcpServerNames]
      : undefined,
  });
}

// ---------------------------------------------------------------------------
// loadGlobalConfig
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.loadGlobalConfig", () => {
  it("returns ScopeConfig with permission from a valid config file", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir, {
        globalConfig: { permission: { "*": "allow", read: "ask" } },
      });
      const config = loader.loadGlobalConfig();
      expect(config.permission).toEqual({ "*": "allow", read: "ask" });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("returns empty ScopeConfig when config file is missing", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
    });
    const config = loader.loadGlobalConfig();
    expect(config.permission).toBeUndefined();
  });

  it("loads settings policy below the dedicated config file", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir, {
        settingsPolicy: {
          permission: { "*": "ask", read: "allow", write: "deny" },
        },
        globalConfig: { permission: { read: "deny" } },
      });
      expect(loader.loadGlobalConfig().permission).toEqual({
        "*": "ask",
        read: "deny",
        write: "deny",
      });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("returns empty ScopeConfig when config file has no permission key", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir, {
        globalConfig: { debugLog: true },
      });
      const config = loader.loadGlobalConfig();
      expect(config.permission).toBeUndefined();
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// loadProjectConfig
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.loadProjectConfig", () => {
  it("returns empty ScopeConfig when no project path is configured", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
    });
    const config = loader.loadProjectConfig();
    expect(config).toEqual({});
  });

  it("returns ScopeConfig from a project config file", () => {
    const baseDir = makeTempDir();
    try {
      const projectConfigPath = join(baseDir, "project-config.json");
      writeFileSync(
        projectConfigPath,
        JSON.stringify({ permission: { bash: "allow" } }),
      );
      const loader = new FilePolicyLoader({
        globalConfigPath: "/nonexistent/config.json",
        agentsDir: "/nonexistent/agents",
        projectGlobalConfigPath: projectConfigPath,
      });
      const config = loader.loadProjectConfig();
      expect(config.permission).toEqual({ bash: "allow" });
      expect(config.invalid).toBeUndefined();
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("loads project settings below the dedicated project config", () => {
    const baseDir = makeTempDir();
    try {
      const projectSettingsPath = join(baseDir, "project-settings.json");
      writeFileSync(
        projectSettingsPath,
        JSON.stringify({
          piPermissionSystem: {
            permission: { "*": "ask", bash: "deny", read: "allow" },
          },
        }),
      );
      const projectConfigPath = join(baseDir, "project-config.json");
      writeFileSync(
        projectConfigPath,
        JSON.stringify({ permission: { read: "deny" } }),
      );
      const loader = new FilePolicyLoader({
        globalConfigPath: "/nonexistent/config.json",
        agentsDir: "/nonexistent/agents",
        projectGlobalConfigPath: projectConfigPath,
        projectSettingsPath,
      });

      expect(loader.loadProjectConfig().permission).toEqual({
        "*": "ask",
        bash: "deny",
        read: "deny",
      });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("marks the scope invalid when the project config file is rejected", () => {
    const baseDir = makeTempDir();
    try {
      const projectConfigPath = join(baseDir, "project-config.json");
      // Unrecognized key — schema rejection, the issue's "typo" scenario.
      writeFileSync(projectConfigPath, JSON.stringify({ debugLo: true }));
      const loader = new FilePolicyLoader({
        globalConfigPath: "/nonexistent/config.json",
        agentsDir: "/nonexistent/agents",
        projectGlobalConfigPath: projectConfigPath,
      });
      const config = loader.loadProjectConfig();
      expect(config.invalid).toBe(true);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("leaves invalid unset when no project file is present", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
      projectGlobalConfigPath: "/nonexistent/project-config.json",
    });
    const config = loader.loadProjectConfig();
    expect(config.invalid).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadAgentConfig / loadProjectAgentConfig
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.loadAgentConfig", () => {
  it("returns empty ScopeConfig when agentName is undefined", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir);
      expect(loader.loadAgentConfig()).toEqual({});
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("returns ScopeConfig from agent frontmatter", () => {
    const baseDir = makeTempDir();
    try {
      const agentsDir = join(baseDir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, "coder.md"),
        `---\npermission:\n  bash: allow\n---\n# Coder agent\n`,
      );
      const loader = new FilePolicyLoader({
        globalConfigPath: join(baseDir, "config.json"),
        agentsDir,
      });
      writeFileSync(join(baseDir, "config.json"), "{}");
      const config = loader.loadAgentConfig("coder");
      expect(config.permission).toEqual({ bash: "allow" });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("loads per-agent settings below agent frontmatter", () => {
    const baseDir = makeTempDir();
    try {
      const agentsDir = join(baseDir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, "coder.md"),
        `---\npermission:\n  edit: deny\n---\n# Coder agent\n`,
      );
      const loader = makeLoader(baseDir, {
        settingsPolicy: {
          agents: {
            coder: { bash: "deny", edit: "allow", write: "allow" },
          },
        },
      });

      expect(loader.loadAgentConfig("coder").permission).toEqual({
        bash: "deny",
        edit: "deny",
        write: "allow",
      });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("returns empty ScopeConfig when agent file does not exist", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir);
      const config = loader.loadAgentConfig("nonexistent");
      expect(config).toEqual({});
      expect(config.invalid).toBeUndefined();
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("marks the scope invalid when an existing agent file cannot be read", () => {
    const baseDir = makeTempDir();
    try {
      const agentsDir = join(baseDir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      // A directory at the agent's file path exists (stat succeeds) but
      // readFileSync throws EISDIR — a present-but-unreadable file.
      mkdirSync(join(agentsDir, "coder.md"));
      const loader = new FilePolicyLoader({
        globalConfigPath: join(baseDir, "config.json"),
        agentsDir,
      });
      writeFileSync(join(baseDir, "config.json"), "{}");
      const config = loader.loadAgentConfig("coder");
      expect(config.invalid).toBe(true);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe("FilePolicyLoader.loadProjectAgentConfig", () => {
  it("returns empty ScopeConfig when no projectAgentsDir is configured", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir);
      expect(loader.loadProjectAgentConfig("coder")).toEqual({});
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// getConfigIssues
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.getConfigIssues", () => {
  it("returns empty array before any loads", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
    });
    expect(loader.getConfigIssues()).toEqual([]);
  });

  it("returns empty array for valid config", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir, {
        globalConfig: { permission: { "*": "ask" } },
      });
      loader.loadGlobalConfig();
      expect(loader.getConfigIssues()).toEqual([]);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// getResolvedPolicyPaths
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.getResolvedPolicyPaths", () => {
  it("returns correct paths and existence when files exist", () => {
    const baseDir = makeTempDir();
    try {
      const globalConfigPath = join(baseDir, "config.json");
      const globalSettingsPath = join(baseDir, "settings.json");
      const agentsDir = join(baseDir, "agents");
      writeFileSync(globalConfigPath, "{}");
      writeFileSync(globalSettingsPath, "{}");
      mkdirSync(agentsDir, { recursive: true });

      const loader = new FilePolicyLoader({
        globalConfigPath,
        globalSettingsPath,
        agentsDir,
      });
      const paths = loader.getResolvedPolicyPaths();

      expect(paths.globalConfigPath).toBe(globalConfigPath);
      expect(paths.globalConfigExists).toBe(true);
      expect(paths.globalSettingsPath).toBe(globalSettingsPath);
      expect(paths.globalSettingsExists).toBe(true);
      expect(paths.agentsDir).toBe(agentsDir);
      expect(paths.agentsDirExists).toBe(true);
      expect(paths.projectConfigPath).toBeNull();
      expect(paths.projectConfigExists).toBe(false);
      expect(paths.projectSettingsPath).toBeNull();
      expect(paths.projectSettingsExists).toBe(false);
      expect(paths.projectAgentsDir).toBeNull();
      expect(paths.projectAgentsDirExists).toBe(false);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// getCacheStamp
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.getCacheStamp", () => {
  it("returns a string stamp", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
    });
    const stamp = loader.getCacheStamp();
    expect(typeof stamp).toBe("string");
    expect(stamp.length).toBeGreaterThan(0);
  });

  it("changes when the global config file changes", () => {
    const baseDir = makeTempDir();
    try {
      const globalConfigPath = join(baseDir, "config.json");
      writeFileSync(globalConfigPath, "{}");
      const agentsDir = join(baseDir, "agents");
      mkdirSync(agentsDir, { recursive: true });

      const loader = new FilePolicyLoader({ globalConfigPath, agentsDir });
      const stamp1 = loader.getCacheStamp();

      // Wait a tick so mtime changes
      const now = Date.now();
      while (Date.now() - now < 50) {
        // busy-wait for mtime resolution
      }
      writeFileSync(globalConfigPath, '{"permission": {}}');
      const stamp2 = loader.getCacheStamp();

      expect(stamp1).not.toBe(stamp2);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("includes agent stamp when agentName is provided and agent file exists", () => {
    const baseDir = makeTempDir();
    try {
      const agentsDir = join(baseDir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(baseDir, "config.json"), "{}");
      writeFileSync(
        join(agentsDir, "coder.md"),
        "---\npermission:\n  read: allow\n---\n",
      );

      const loader = new FilePolicyLoader({
        globalConfigPath: join(baseDir, "config.json"),
        agentsDir,
      });

      const stampWithout = loader.getCacheStamp();
      const stampWith = loader.getCacheStamp("coder");
      // Agent file exists, so the stamp differs from the no-agent case.
      expect(stampWithout).not.toBe(stampWith);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Mtime cache invalidation
// ---------------------------------------------------------------------------

describe("FilePolicyLoader mtime caching", () => {
  it("returns cached value on second call with unchanged file", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir, {
        globalConfig: { permission: { "*": "allow" } },
      });
      const first = loader.loadGlobalConfig();
      const second = loader.loadGlobalConfig();
      // Same reference — cache hit
      expect(second).toBe(first);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("reloads when file mtime changes", () => {
    const baseDir = makeTempDir();
    try {
      const globalConfigPath = join(baseDir, "config.json");
      const agentsDir = join(baseDir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({ permission: { "*": "allow" } }),
      );

      const loader = new FilePolicyLoader({ globalConfigPath, agentsDir });
      const first = loader.loadGlobalConfig();
      expect(first.permission?.["*"]).toBe("allow");

      // busy-wait for mtime resolution
      const now = Date.now();
      while (Date.now() - now < 50) {
        /* spin */
      }

      writeFileSync(
        globalConfigPath,
        JSON.stringify({ permission: { "*": "deny" } }),
      );
      const second = loader.loadGlobalConfig();
      expect(second.permission?.["*"]).toBe("deny");
      expect(second).not.toBe(first);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Agent frontmatter loading
// ---------------------------------------------------------------------------

describe("FilePolicyLoader agent frontmatter", () => {
  it("loads permission from agent frontmatter with pattern map", () => {
    const baseDir = makeTempDir();
    try {
      const agentsDir = join(baseDir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(baseDir, "config.json"), "{}");
      writeFileSync(
        join(agentsDir, "coder.md"),
        [
          "---",
          "permission:",
          "  bash:",
          '    "git *": allow',
          '    "rm *": deny',
          "---",
          "# Coder",
        ].join("\n"),
      );

      const loader = new FilePolicyLoader({
        globalConfigPath: join(baseDir, "config.json"),
        agentsDir,
      });
      const config = loader.loadAgentConfig("coder");
      expect(config.permission).toBeDefined();
      expect(config.permission?.bash).toEqual({
        "git *": "allow",
        "rm *": "deny",
      });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("returns empty config for agent file without frontmatter", () => {
    const baseDir = makeTempDir();
    try {
      const agentsDir = join(baseDir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(baseDir, "config.json"), "{}");
      writeFileSync(join(agentsDir, "plain.md"), "# No frontmatter\n");

      const loader = new FilePolicyLoader({
        globalConfigPath: join(baseDir, "config.json"),
        agentsDir,
      });
      expect(loader.loadAgentConfig("plain")).toEqual({});
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("project agent config loads from projectAgentsDir", () => {
    const baseDir = makeTempDir();
    try {
      const agentsDir = join(baseDir, "agents");
      const projectAgentsDir = join(baseDir, "project-agents");
      mkdirSync(agentsDir, { recursive: true });
      mkdirSync(projectAgentsDir, { recursive: true });
      writeFileSync(join(baseDir, "config.json"), "{}");
      writeFileSync(
        join(projectAgentsDir, "coder.md"),
        "---\npermission:\n  write: allow\n---\n# Coder\n",
      );

      const loader = new FilePolicyLoader({
        globalConfigPath: join(baseDir, "config.json"),
        agentsDir,
        projectAgentsDir,
      });
      const config = loader.loadProjectAgentConfig("coder");
      expect(config.permission).toEqual({ write: "allow" });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// MCP server name reading
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.getConfiguredMcpServerNames", () => {
  it("returns override names when provided", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
      mcpServerNames: ["exa", "research"],
    });
    expect(loader.getConfiguredMcpServerNames()).toEqual(
      expect.arrayContaining(["exa", "research"]),
    );
  });

  it("deduplicates and trims override names", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
      mcpServerNames: [" exa ", "exa", "research"],
    });
    const names = loader.getConfiguredMcpServerNames();
    expect(names.filter((n) => n === "exa")).toHaveLength(1);
  });

  it("reads server names from mcp.json on disk", () => {
    const baseDir = makeTempDir();
    try {
      const mcpConfigPath = join(baseDir, "mcp.json");
      writeFileSync(
        mcpConfigPath,
        JSON.stringify({ mcpServers: { exa: {}, research: {} } }),
      );

      const loader = new FilePolicyLoader({
        globalConfigPath: "/nonexistent/config.json",
        agentsDir: "/nonexistent/agents",
        globalMcpConfigPath: mcpConfigPath,
      });
      const names = loader.getConfiguredMcpServerNames();
      expect(names).toEqual(expect.arrayContaining(["exa", "research"]));
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("returns empty array when mcp.json is missing", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
      globalMcpConfigPath: "/nonexistent/mcp.json",
    });
    expect(loader.getConfiguredMcpServerNames()).toEqual([]);
  });

  it("caches MCP server names across calls", () => {
    const baseDir = makeTempDir();
    try {
      const mcpConfigPath = join(baseDir, "mcp.json");
      writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { exa: {} } }));

      const loader = new FilePolicyLoader({
        globalConfigPath: "/nonexistent/config.json",
        agentsDir: "/nonexistent/agents",
        globalMcpConfigPath: mcpConfigPath,
      });
      const first = loader.getConfiguredMcpServerNames();
      const second = loader.getConfiguredMcpServerNames();
      // Same reference — cache hit
      expect(second).toBe(first);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Config issue accumulation
// ---------------------------------------------------------------------------

describe("FilePolicyLoader config issue accumulation", () => {
  it("accumulates issues from malformed config files", () => {
    const baseDir = makeTempDir();
    try {
      // Write invalid JSON to trigger a parse error issue
      const globalConfigPath = join(baseDir, "config.json");
      const agentsDir = join(baseDir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(globalConfigPath, "{ INVALID JSON");

      const loader = new FilePolicyLoader({ globalConfigPath, agentsDir });
      loader.loadGlobalConfig();
      const issues = loader.getConfigIssues();
      expect(issues.length).toBeGreaterThanOrEqual(1);
      expect(issues[0]).toContain("Failed to read config");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("does not duplicate issues on repeated loads", () => {
    const baseDir = makeTempDir();
    try {
      const globalConfigPath = join(baseDir, "config.json");
      const agentsDir = join(baseDir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(globalConfigPath, "{ INVALID JSON");

      const loader = new FilePolicyLoader({ globalConfigPath, agentsDir });
      loader.loadGlobalConfig();
      const issuesBefore = loader.getConfigIssues();

      // Bust cache by waiting for mtime change
      const now = Date.now();
      while (Date.now() - now < 50) {
        /* spin */
      }
      writeFileSync(globalConfigPath, "{ INVALID JSON");
      loader.loadGlobalConfig();
      const issuesAfter = loader.getConfigIssues();
      expect(issuesAfter.length).toBe(issuesBefore.length);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
