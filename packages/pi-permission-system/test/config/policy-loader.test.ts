import { utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilePolicyLoader } from "#src/config/policy-loader";
import type { ScopeName } from "#src/policy/rule";
import type { ScopeConfig } from "#src/types";
import { createTmpFixture, type TmpFixture } from "#test/helpers/tmp-fixture";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let fixture: TmpFixture;

beforeEach(() => {
  fixture = createTmpFixture();
});

afterEach(() => {
  fixture.cleanup();
});

interface LoaderFiles {
  globalConfig?: Record<string, unknown>;
  /** Written as the project config file; omitted leaves no project path. */
  projectConfig?: Record<string, unknown>;
  /** Agent name → file content, under the global agents directory. */
  agents?: Record<string, string>;
  /** Agent name → file content; omitted leaves no project agents directory. */
  projectAgents?: Record<string, string>;
  mcpServerNames?: readonly string[];
}

/** A loader over a temp tree holding the given files. */
function makeLoader(files: LoaderFiles = {}) {
  const baseDir = fixture.dir("policy-loader-test-");
  const globalConfigPath = fixture.file(
    baseDir,
    "config.json",
    JSON.stringify(files.globalConfig ?? {}, null, 2),
  );
  const agentsDir = fixture.subdir(baseDir, "agents");
  for (const [name, content] of Object.entries(files.agents ?? {})) {
    fixture.file(agentsDir, `${name}.md`, content);
  }
  const projectConfigPath = files.projectConfig
    ? fixture.file(
        baseDir,
        "project-config.json",
        JSON.stringify(files.projectConfig),
      )
    : undefined;
  const projectAgentsDir = files.projectAgents
    ? fixture.subdir(baseDir, "project-agents")
    : undefined;
  for (const [name, content] of Object.entries(files.projectAgents ?? {})) {
    fixture.file(projectAgentsDir ?? baseDir, `${name}.md`, content);
  }

  const loader = new FilePolicyLoader({
    globalConfigPath,
    agentsDir,
    projectGlobalConfigPath: projectConfigPath,
    projectAgentsDir,
    mcpServerNames: files.mcpServerNames
      ? [...files.mcpServerNames]
      : undefined,
  });
  return {
    loader,
    globalConfigPath,
    agentsDir,
    projectConfigPath,
    projectAgentsDir,
  };
}

/** What `loader` loads for one scope. */
function scopeConfig(
  loader: FilePolicyLoader,
  name: ScopeName,
  agentName?: string,
): ScopeConfig {
  const scope = loader
    .loadScopes(agentName)
    .find((candidate) => candidate.name === name);
  if (!scope) throw new Error(`no ${name} scope loaded`);
  return scope.config;
}

/** Busy-wait past the filesystem's mtime resolution. */
function waitForMtimeTick(): void {
  const now = Date.now();
  while (Date.now() - now < 50) {
    /* spin */
  }
}

// ---------------------------------------------------------------------------
// loadScopes
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.loadScopes", () => {
  it("lists the four scopes lowest precedence first, every one but global flooring", () => {
    const { loader } = makeLoader();
    const scopes = loader.loadScopes("coder");
    expect(
      scopes.map(({ name, floorsWhenInvalid }) => [name, floorsWhenInvalid]),
    ).toEqual([
      ["global", false],
      ["project", true],
      ["agent", true],
      ["project-agent", true],
    ]);
  });

  it("marks a rejected global file invalid", () => {
    const { loader } = makeLoader({ globalConfig: { debugLo: true } });
    expect(scopeConfig(loader, "global").invalid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Global scope
// ---------------------------------------------------------------------------

describe("FilePolicyLoader global scope", () => {
  it("returns ScopeConfig with permission from a valid config file", () => {
    const { loader } = makeLoader({
      globalConfig: { permission: { "*": "allow", read: "ask" } },
    });
    const config = scopeConfig(loader, "global");
    expect(config.permission).toEqual({ "*": "allow", read: "ask" });
  });

  it("returns empty ScopeConfig when config file is missing", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
    });
    const config = scopeConfig(loader, "global");
    expect(config.permission).toBeUndefined();
  });

  it("returns empty ScopeConfig when config file has no permission key", () => {
    const { loader } = makeLoader({ globalConfig: { debugLog: true } });
    const config = scopeConfig(loader, "global");
    expect(config.permission).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Project scope
// ---------------------------------------------------------------------------

describe("FilePolicyLoader project scope", () => {
  it("returns empty ScopeConfig when no project path is configured", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
    });
    const config = scopeConfig(loader, "project");
    expect(config).toEqual({});
  });

  it("returns ScopeConfig from a project config file", () => {
    const { loader } = makeLoader({
      projectConfig: { permission: { bash: "allow" } },
    });
    const config = scopeConfig(loader, "project");
    expect(config.permission).toEqual({ bash: "allow" });
    expect(config.invalid).toBeUndefined();
  });

  it("marks the scope invalid when the project config file is rejected", () => {
    // Unrecognized key — schema rejection, the issue's "typo" scenario.
    const { loader } = makeLoader({ projectConfig: { debugLo: true } });
    const config = scopeConfig(loader, "project");
    expect(config.invalid).toBe(true);
  });

  it("leaves invalid unset when no project file is present", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
      projectGlobalConfigPath: "/nonexistent/project-config.json",
    });
    const config = scopeConfig(loader, "project");
    expect(config.invalid).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Agent and project-agent scopes
// ---------------------------------------------------------------------------

describe("FilePolicyLoader agent scope", () => {
  it("returns empty ScopeConfig when agentName is undefined", () => {
    const { loader } = makeLoader();
    expect(scopeConfig(loader, "agent")).toEqual({});
  });

  it("returns ScopeConfig from agent frontmatter", () => {
    const { loader } = makeLoader({
      agents: {
        coder: `---\npermission:\n  bash: allow\n---\n# Coder agent\n`,
      },
    });
    const config = scopeConfig(loader, "agent", "coder");
    expect(config.permission).toEqual({ bash: "allow" });
  });

  it("returns empty ScopeConfig when agent file does not exist", () => {
    const { loader } = makeLoader();
    const config = scopeConfig(loader, "agent", "nonexistent");
    expect(config).toEqual({});
    expect(config.invalid).toBeUndefined();
  });

  it("marks the scope invalid when an existing agent file cannot be read", () => {
    const { loader, agentsDir } = makeLoader();
    // A directory at the agent's file path exists (stat succeeds) but
    // readFileSync throws EISDIR — a present-but-unreadable file.
    fixture.subdir(agentsDir, "coder.md");
    const config = scopeConfig(loader, "agent", "coder");
    expect(config.invalid).toBe(true);
  });
});

describe("FilePolicyLoader project-agent scope", () => {
  it("returns empty ScopeConfig when no projectAgentsDir is configured", () => {
    const { loader } = makeLoader();
    expect(scopeConfig(loader, "project-agent", "coder")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// getResolvedPolicyPaths
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.getResolvedPolicyPaths", () => {
  it("lists each scope's path and existence, lowest precedence first", () => {
    const { loader, globalConfigPath, agentsDir } = makeLoader();
    expect(loader.getResolvedPolicyPaths()).toEqual([
      { name: "global", path: globalConfigPath, exists: true },
      { name: "project", path: null, exists: false },
      { name: "agent", path: agentsDir, exists: true },
      { name: "project-agent", path: null, exists: false },
    ]);
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
    const { loader, globalConfigPath } = makeLoader();
    const stamp1 = loader.getCacheStamp();

    waitForMtimeTick();
    writeFileSync(globalConfigPath, '{"permission": {}}');
    const stamp2 = loader.getCacheStamp();

    expect(stamp1).not.toBe(stamp2);
  });

  it("includes agent stamp when agentName is provided and agent file exists", () => {
    const { loader } = makeLoader({
      agents: { coder: "---\npermission:\n  read: allow\n---\n" },
    });

    const stampWithout = loader.getCacheStamp();
    const stampWith = loader.getCacheStamp("coder");
    // Agent file exists, so the stamp differs from the no-agent case.
    expect(stampWithout).not.toBe(stampWith);
  });

  describe("follows every scope's file", () => {
    const agentFile = "---\npermission:\n  read: allow\n---\n";

    function makeFullLoader() {
      const made = makeLoader({
        projectConfig: {},
        agents: { coder: agentFile },
        projectAgents: { coder: agentFile },
      });
      return {
        loader: made.loader,
        files: {
          global: made.globalConfigPath,
          project: made.projectConfigPath ?? "",
          agent: join(made.agentsDir, "coder.md"),
          "project-agent": join(made.projectAgentsDir ?? "", "coder.md"),
        },
      };
    }

    it.each(["global", "project", "agent", "project-agent"] as const)(
      "changes when the %s file changes",
      (scope) => {
        const { loader, files } = makeFullLoader();
        const before = loader.getCacheStamp("coder");

        const later = new Date(Date.now() + 5000);
        utimesSync(files[scope], later, later);

        expect(loader.getCacheStamp("coder")).not.toBe(before);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Mtime cache invalidation
// ---------------------------------------------------------------------------

describe("FilePolicyLoader mtime caching", () => {
  it("returns cached value on second call with unchanged file", () => {
    const { loader } = makeLoader({
      globalConfig: { permission: { "*": "allow" } },
    });
    const first = scopeConfig(loader, "global");
    const second = scopeConfig(loader, "global");
    // Same reference — cache hit
    expect(second).toBe(first);
  });

  it("reloads when file mtime changes", () => {
    const { loader, globalConfigPath } = makeLoader({
      globalConfig: { permission: { "*": "allow" } },
    });
    const first = scopeConfig(loader, "global");
    expect(first.permission?.["*"]).toBe("allow");

    waitForMtimeTick();
    writeFileSync(
      globalConfigPath,
      JSON.stringify({ permission: { "*": "deny" } }),
    );
    const second = scopeConfig(loader, "global");
    expect(second.permission?.["*"]).toBe("deny");
    expect(second).not.toBe(first);
  });
});

// ---------------------------------------------------------------------------
// Agent frontmatter loading
// ---------------------------------------------------------------------------

describe("FilePolicyLoader agent frontmatter", () => {
  it("loads permission from agent frontmatter with pattern map", () => {
    const { loader } = makeLoader({
      agents: {
        coder: [
          "---",
          "permission:",
          "  bash:",
          '    "git *": allow',
          '    "rm *": deny',
          "---",
          "# Coder",
        ].join("\n"),
      },
    });
    const config = scopeConfig(loader, "agent", "coder");
    expect(config.permission).toBeDefined();
    expect(config.permission?.bash).toEqual({
      "git *": "allow",
      "rm *": "deny",
    });
  });

  it("returns empty config for agent file without frontmatter", () => {
    const { loader } = makeLoader({
      agents: { plain: "# No frontmatter\n" },
    });
    expect(scopeConfig(loader, "agent", "plain")).toEqual({});
  });

  it("project agent config loads from projectAgentsDir", () => {
    const { loader } = makeLoader({
      projectAgents: {
        coder: "---\npermission:\n  write: allow\n---\n# Coder\n",
      },
    });
    const config = scopeConfig(loader, "project-agent", "coder");
    expect(config.permission).toEqual({ write: "allow" });
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
    const baseDir = fixture.dir("policy-loader-test-");
    const mcpConfigPath = fixture.file(
      baseDir,
      "mcp.json",
      JSON.stringify({ mcpServers: { exa: {}, research: {} } }),
    );

    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
      globalMcpConfigPath: mcpConfigPath,
    });
    const names = loader.getConfiguredMcpServerNames();
    expect(names).toEqual(expect.arrayContaining(["exa", "research"]));
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
    const baseDir = fixture.dir("policy-loader-test-");
    const globalMcp = fixture.file(
      baseDir,
      "global-mcp.json",
      JSON.stringify({ mcpServers: { exa: {}, shared: {} } }),
    );
    const projectMcp = fixture.file(
      baseDir,
      "project-mcp.json",
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
  });

  it("re-reads the project mcp.json after it changes", () => {
    const baseDir = fixture.dir("policy-loader-test-");
    const projectMcp = fixture.file(
      baseDir,
      "project-mcp.json",
      JSON.stringify({ mcpServers: { exa: {} } }),
    );

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
  });

  it("caches MCP server names across calls", () => {
    const baseDir = fixture.dir("policy-loader-test-");
    const mcpConfigPath = fixture.file(
      baseDir,
      "mcp.json",
      JSON.stringify({ mcpServers: { exa: {} } }),
    );

    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
      globalMcpConfigPath: mcpConfigPath,
    });
    const first = loader.getConfiguredMcpServerNames();
    const second = loader.getConfiguredMcpServerNames();
    // Same reference — cache hit
    expect(second).toBe(first);
  });
});
