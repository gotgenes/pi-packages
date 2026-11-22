import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { FilePolicyLoader } from "#src/config/policy-loader";

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

  return new FilePolicyLoader({
    globalConfigPath,
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
// getResolvedPolicyPaths
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.getResolvedPolicyPaths", () => {
  it("returns correct paths and existence when files exist", () => {
    const baseDir = makeTempDir();
    try {
      const globalConfigPath = join(baseDir, "config.json");
      const agentsDir = join(baseDir, "agents");
      writeFileSync(globalConfigPath, "{}");
      mkdirSync(agentsDir, { recursive: true });

      const loader = new FilePolicyLoader({ globalConfigPath, agentsDir });
      const paths = loader.getResolvedPolicyPaths();

      expect(paths.globalConfigPath).toBe(globalConfigPath);
      expect(paths.globalConfigExists).toBe(true);
      expect(paths.agentsDir).toBe(agentsDir);
      expect(paths.agentsDirExists).toBe(true);
      expect(paths.projectConfigPath).toBeNull();
      expect(paths.projectConfigExists).toBe(false);
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

  it("merges server names from the global and project mcp.json, longest first", () => {
    const baseDir = makeTempDir();
    try {
      const globalMcp = join(baseDir, "global-mcp.json");
      const projectMcp = join(baseDir, "project-mcp.json");
      writeFileSync(
        globalMcp,
        JSON.stringify({ mcpServers: { exa: {}, shared: {} } }),
      );
      writeFileSync(
        projectMcp,
        JSON.stringify({ mcpServers: { "danger-srv": {}, shared: {} } }),
      );

      const loader = new FilePolicyLoader({
        globalConfigPath: "/nonexistent/config.json",
        agentsDir: "/nonexistent/agents",
        globalMcpConfigPath: globalMcp,
        projectMcpConfigPath: projectMcp,
      });
      expect(loader.getConfiguredMcpServerNames()).toEqual([
        "danger-srv",
        "shared",
        "exa",
      ]);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("re-reads the project mcp.json after it changes", () => {
    const baseDir = makeTempDir();
    try {
      const projectMcp = join(baseDir, "project-mcp.json");
      writeFileSync(projectMcp, JSON.stringify({ mcpServers: { exa: {} } }));

      const loader = new FilePolicyLoader({
        globalConfigPath: "/nonexistent/config.json",
        agentsDir: "/nonexistent/agents",
        globalMcpConfigPath: "/nonexistent/mcp.json",
        projectMcpConfigPath: projectMcp,
      });
      expect(loader.getConfiguredMcpServerNames()).toEqual(["exa"]);

      writeFileSync(
        projectMcp,
        JSON.stringify({ mcpServers: { exa: {}, research: {} } }),
      );
      utimesSync(projectMcp, new Date(), new Date(Date.now() + 5000));
      expect(loader.getConfiguredMcpServerNames()).toEqual(["research", "exa"]);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
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
// Ancestor project config chain (projectConfigScopes)
// ---------------------------------------------------------------------------

describe("FilePolicyLoader ancestor chain", () => {
  function writeJson(path: string, content: Record<string, unknown>): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(content));
  }

  function makeChainLoader(baseDir: string): {
    loader: FilePolicyLoader;
    parentDir: string;
    childDir: string;
  } {
    const parentDir = join(baseDir, "project");
    const childDir = join(baseDir, "project", "packages", "api");
    const loader = new FilePolicyLoader({
      globalConfigPath: join(baseDir, "global.json"),
      agentsDir: join(baseDir, "agents"),
      projectConfigScopes: [
        {
          dir: parentDir,
          configPath: join(
            parentDir,
            ".pi",
            "extensions",
            "pi-permission-system",
            "config.json",
          ),
        },
        {
          dir: childDir,
          configPath: join(
            childDir,
            ".pi",
            "extensions",
            "pi-permission-system",
            "config.json",
          ),
        },
      ],
      projectAgentsDirs: [
        join(parentDir, ".pi", "agents"),
        join(childDir, ".pi", "agents"),
      ],
    });
    writeJson(join(baseDir, "global.json"), {});
    mkdirSync(join(baseDir, "agents"), { recursive: true });
    return { loader, parentDir, childDir };
  }

  it("merges parent and child project configs with the nearest winning", () => {
    const baseDir = makeTempDir();
    try {
      const { loader, parentDir, childDir } = makeChainLoader(baseDir);
      writeJson(
        join(
          parentDir,
          ".pi",
          "extensions",
          "pi-permission-system",
          "config.json",
        ),
        { permission: { "*": "ask", read: "allow", bash: "deny" } },
      );
      writeJson(
        join(
          childDir,
          ".pi",
          "extensions",
          "pi-permission-system",
          "config.json",
        ),
        { permission: { read: "deny" } },
      );

      expect(loader.loadProjectConfig()).toEqual({
        permission: { "*": "ask", read: "deny", bash: "deny" },
      });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("rebases an ancestor scope's relative path patterns, not the nearest's", () => {
    const baseDir = makeTempDir();
    try {
      const { loader, parentDir, childDir } = makeChainLoader(baseDir);
      writeJson(
        join(
          parentDir,
          ".pi",
          "extensions",
          "pi-permission-system",
          "config.json",
        ),
        { permission: { read: { "src/*": "allow" } } },
      );
      writeJson(
        join(
          childDir,
          ".pi",
          "extensions",
          "pi-permission-system",
          "config.json",
        ),
        { permission: { write: { "src/*": "deny" } } },
      );

      expect(loader.loadProjectConfig()).toEqual({
        permission: {
          read: { [join(parentDir, "src/*")]: "allow" },
          write: { "src/*": "deny" },
        },
      });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("marks the merged scope invalid when any ancestor config is rejected", () => {
    const baseDir = makeTempDir();
    try {
      const { loader, parentDir, childDir } = makeChainLoader(baseDir);
      writeJson(
        join(
          parentDir,
          ".pi",
          "extensions",
          "pi-permission-system",
          "config.json",
        ),
        // Unrecognized key — schema rejection.
        { debugLo: true },
      );
      writeJson(
        join(
          childDir,
          ".pi",
          "extensions",
          "pi-permission-system",
          "config.json",
        ),
        { permission: { read: "allow" } },
      );

      const config = loader.loadProjectConfig();
      expect(config.invalid).toBe(true);
      // The valid child's rules still merge; the manager floors them to ask.
      expect(config.permission).toEqual({ read: "allow" });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("merges project agent frontmatter across the chain, nearest winning", () => {
    const baseDir = makeTempDir();
    try {
      const { loader, parentDir, childDir } = makeChainLoader(baseDir);
      mkdirSync(join(parentDir, ".pi", "agents"), { recursive: true });
      writeFileSync(
        join(parentDir, ".pi", "agents", "coder.md"),
        "---\npermission:\n  read: allow\n  write: deny\n---\n# Coder\n",
      );
      mkdirSync(join(childDir, ".pi", "agents"), { recursive: true });
      writeFileSync(
        join(childDir, ".pi", "agents", "coder.md"),
        "---\npermission:\n  write: allow\n---\n# Coder\n",
      );

      expect(loader.loadProjectAgentConfig("coder")).toEqual({
        permission: { read: "allow", write: "allow" },
      });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("falls back to the singular projectGlobalConfigPath without rebasing", () => {
    const baseDir = makeTempDir();
    try {
      const projectConfigPath = join(baseDir, "project-config.json");
      writeFileSync(
        projectConfigPath,
        JSON.stringify({ permission: { read: { "src/*": "allow" } } }),
      );
      const loader = new FilePolicyLoader({
        globalConfigPath: "/nonexistent/config.json",
        agentsDir: "/nonexistent/agents",
        projectGlobalConfigPath: projectConfigPath,
      });
      expect(loader.loadProjectConfig()).toEqual({
        permission: { read: { "src/*": "allow" } },
      });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("reports the chain in resolved paths with the nearest as singular", () => {
    const baseDir = makeTempDir();
    try {
      const { loader, parentDir, childDir } = makeChainLoader(baseDir);
      const paths = loader.getResolvedPolicyPaths();
      expect(paths.projectConfigPaths).toEqual([
        join(
          parentDir,
          ".pi",
          "extensions",
          "pi-permission-system",
          "config.json",
        ),
        join(
          childDir,
          ".pi",
          "extensions",
          "pi-permission-system",
          "config.json",
        ),
      ]);
      expect(paths.projectConfigPath).toBe(
        join(
          childDir,
          ".pi",
          "extensions",
          "pi-permission-system",
          "config.json",
        ),
      );
      expect(paths.projectAgentsDirs).toEqual([
        join(parentDir, ".pi", "agents"),
        join(childDir, ".pi", "agents"),
      ]);
      expect(paths.projectAgentsDir).toBe(join(childDir, ".pi", "agents"));
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
