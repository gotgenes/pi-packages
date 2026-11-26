/**
 * Integration tests for `PermissionManager`: real policy composition and
 * evaluation over an in-memory or a file-backed `PolicyLoader`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedAccessIntent } from "#src/access-intent/access-intent";
import { BashProgram } from "#src/access-intent/bash/program";
import { buildResolvedIntentFromMatchValues } from "#src/access-intent/input-normalizer";
import { getPathPolicyValues } from "#src/access-intent/path-normalization";
import {
  getGlobalConfigPath,
  getProjectAgentsDir,
  getProjectConfigPath,
} from "#src/config/config-paths";
import { posixPathFlavor, win32PathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";
import {
  PermissionManager,
  type ScopedPermissionManager,
} from "#src/policy/permission-manager";
import type { Ruleset } from "#src/policy/rule";
import type {
  FlatPermissionConfig,
  PermissionCheckResult,
  PermissionState,
  ScopeConfig,
} from "#src/types";
import {
  createAgentDirHarness,
  createInMemoryGlobalManager,
  createInMemoryManager,
  createInMemoryPolicyLoader,
  createManager,
  createManagerFromPaths,
  createManagerWithConfig,
  createManagerWithProject,
  createMissingConfigManager,
  sessionRule,
} from "#test/helpers/manager-harness";
import { createTmpFixture, type TmpFixture } from "#test/helpers/tmp-fixture";

// Adapters that build an AccessIntent and call the unified `check` entry point,
// so these tests exercise the single resolution path (#478) without a
// production-class wrapper used only by tests.
function checkTool(
  manager: PermissionManager,
  toolName: string,
  input: unknown,
  agentName?: string,
  sessionRules?: Ruleset,
): PermissionCheckResult {
  return manager.check(
    { kind: "tool", surface: toolName, input, agentName },
    sessionRules,
  );
}

function checkPathValues(
  manager: PermissionManager,
  values: readonly string[],
  agentName?: string,
  sessionRules?: Ruleset,
  surface = "path_read",
): PermissionCheckResult {
  return manager.check(
    { kind: "path-values", surface, values, agentName },
    sessionRules,
  );
}

function checkPath(
  manager: PermissionManager,
  path: string,
  opts: { cwd?: string } = {},
  surface = "path_read",
  agentName?: string,
  sessionRules?: Ruleset,
): PermissionCheckResult {
  return checkPathValues(
    manager,
    getPathPolicyValues(
      path,
      opts.cwd ? { cwd: opts.cwd } : {},
      posixPathFlavor,
    ),
    agentName,
    sessionRules,
    surface,
  );
}

describe("PermissionManager", () => {
  describe("scope composition", () => {
    describe("universal fallback", () => {
      it("defaults to ask when no config is provided", () => {
        const manager = createInMemoryManager();
        const result = checkTool(manager, "read", {});
        expect(result.state).toBe("ask");
        expect(result.origin).toBe("builtin");
      });

      it("respects permission['*'] = 'allow' from global config", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "allow" },
        });
        const result = checkTool(manager, "read", {});
        expect(result.state).toBe("allow");
        expect(result.origin).toBe("global");
      });

      it("respects permission['*'] = 'deny' from global config", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "deny" },
        });
        const result = checkTool(manager, "write", {});
        expect(result.state).toBe("deny");
      });
    });

    describe("precedence between scopes", () => {
      it("project overrides global", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { read: "ask" } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { permission: { read: "allow" } },
            floorsWhenInvalid: true,
          },
        ]);
        const result = checkTool(manager, "read", {});
        expect(result.state).toBe("allow");
        expect(result.origin).toBe("project");
      });

      it("agent overrides project", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { read: "ask" } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { permission: { read: "allow" } },
            floorsWhenInvalid: true,
          },
          {
            name: "agent",
            agentName: "coder",
            config: { permission: { read: "deny" } },
            floorsWhenInvalid: true,
          },
        ]);
        const result = checkTool(manager, "read", {}, "coder");
        expect(result.state).toBe("deny");
        expect(result.origin).toBe("agent");
      });

      it("project-agent overrides agent", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { read: "deny" } },
            floorsWhenInvalid: false,
          },
          {
            name: "agent",
            agentName: "coder",
            config: { permission: { read: "deny" } },
            floorsWhenInvalid: true,
          },
          {
            name: "project-agent",
            agentName: "coder",
            config: { permission: { read: "allow" } },
            floorsWhenInvalid: true,
          },
        ]);
        const result = checkTool(manager, "read", {}, "coder");
        expect(result.state).toBe("allow");
        expect(result.origin).toBe("project-agent");
      });

      it("keeps each scope's patterns, each attributed to its scope", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { bash: { "git *": "allow" } } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { permission: { bash: { "rm *": "deny" } } },
            floorsWhenInvalid: true,
          },
        ]);
        const gitResult = checkTool(manager, "bash", {
          command: "git status",
        });
        expect(gitResult.state).toBe("allow");
        expect(gitResult.origin).toBe("global");

        const rmResult = checkTool(manager, "bash", {
          command: "rm -rf /",
        });
        expect(rmResult.state).toBe("deny");
        expect(rmResult.origin).toBe("project");
      });

      it("a later string catch-all shadows an earlier scope's patterns", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: {
              permission: { bash: { "git *": "ask", "npm *": "ask" } },
            },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { permission: { bash: "allow" } },
            floorsWhenInvalid: true,
          },
        ]);
        const result = checkTool(manager, "bash", { command: "anything" });
        expect(result.state).toBe("allow");
        expect(result.origin).toBe("project");
      });

      it("Project-level config overrides base bash patterns", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: {
              permission: {
                "*": "allow",
                bash: { "*": "ask", "rm -rf *": "deny" },
              },
            },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: {
              permission: { bash: { "rm -rf build": "allow" } },
            },
            floorsWhenInvalid: true,
          },
        ]);

        const allowed = checkTool(manager, "bash", {
          command: "rm -rf build",
        });
        expect(allowed.state).toBe("allow");
        expect(allowed.matchedPattern).toBe("rm -rf build");

        const denied = checkTool(manager, "bash", {
          command: "rm -rf node_modules",
        });
        expect(denied.state).toBe("deny");
        expect(denied.matchedPattern).toBe("rm -rf *");
      });

      describe("a later scope's patterns follow an earlier scope's", () => {
        const lockedAgent = `---
name: locked
permission:
  bash:
    "*": deny
---
Locked.
`;

        it("an agent's catch-all denies a command the global config allows", () => {
          const { manager, cleanup } = createManager(
            { permission: { bash: { "*": "ask", "git *": "allow" } } },
            { locked: lockedAgent },
          );
          try {
            const result = checkTool(
              manager,
              "bash",
              { command: "git status" },
              "locked",
            );
            expect(result.state).toBe("deny");
            expect(result.matchedPattern).toBe("*");
            expect(result.origin).toBe("agent");
          } finally {
            cleanup();
          }
        });

        it("withholds the tool from an agent whose catch-all denies every pattern", () => {
          const { manager, cleanup } = createManager(
            { permission: { bash: { "*": "ask", "git *": "allow" } } },
            { locked: lockedAgent },
          );
          try {
            expect(manager.isToolFullyDenied("bash", "locked")).toBe(true);
          } finally {
            cleanup();
          }
        });

        it("keeps an earlier scope's string catch-all under a later scope's pattern map", () => {
          const manager = createInMemoryManager([
            {
              name: "global",
              config: { permission: { bash: "allow" } },
              floorsWhenInvalid: false,
            },
            {
              name: "project",
              config: { permission: { bash: { "rm *": "deny" } } },
              floorsWhenInvalid: true,
            },
          ]);
          const result = checkTool(manager, "bash", { command: "ls" });
          expect(result.state).toBe("allow");
          expect(result.origin).toBe("global");
        });

        it("leaves the universal fallback below every scope's surface rules", () => {
          const manager = createInMemoryManager([
            {
              name: "global",
              config: { permission: { bash: { "git *": "allow" } } },
              floorsWhenInvalid: false,
            },
            {
              name: "agent",
              agentName: "coder",
              config: { permission: { "*": "deny" } },
              floorsWhenInvalid: true,
            },
          ]);
          const git = checkTool(
            manager,
            "bash",
            { command: "git status" },
            "coder",
          );
          expect(git.state).toBe("allow");
          expect(git.origin).toBe("global");

          const ls = checkTool(manager, "bash", { command: "ls" }, "coder");
          expect(ls.state).toBe("deny");
          expect(ls.origin).toBe("agent");
        });

        it("lets a later scope's own key order decide between its patterns", () => {
          const manager = createInMemoryManager([
            {
              name: "agent",
              agentName: "analyst",
              config: { permission: { skill: { "*": "ask" } } },
              floorsWhenInvalid: true,
            },
            {
              name: "project-agent",
              agentName: "analyst",
              config: {
                permission: { skill: { "pi-*": "allow", "*": "deny" } },
              },
              floorsWhenInvalid: true,
            },
          ]);
          const result = checkTool(
            manager,
            "skill",
            { name: "pi-code-review" },
            "analyst",
          );
          expect(result.state).toBe("deny");
          expect(result.matchedPattern).toBe("*");
          expect(result.origin).toBe("project-agent");
        });

        it("does not auto-allow mcp discovery from an mcp allow a later scope overrides", () => {
          const manager = createInMemoryManager(
            [
              {
                name: "global",
                config: { permission: { mcp: { github: "allow" } } },
                floorsWhenInvalid: false,
              },
              {
                name: "project",
                config: { permission: { mcp: { github: "deny" } } },
                floorsWhenInvalid: true,
              },
            ],
            ["github"],
          );
          const result = checkTool(manager, "mcp", {
            describe: "unconfigured_server_tool",
          });
          expect(result.state).toBe("ask");
          expect(result.origin).toBe("builtin");
        });
      });
    });

    describe("rule origin", () => {
      it("single-scope global: config rule has origin 'global'", () => {
        const manager = createInMemoryGlobalManager({
          permission: { read: "allow" },
        });
        const result = checkTool(manager, "read", {});
        expect(result.state).toBe("allow");
        expect(result.origin).toBe("global");
      });

      it("single-scope global with pattern map: origin is 'global'", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            bash: { "git *": "allow" },
          },
        });
        const result = checkTool(manager, "bash", { command: "git status" });
        expect(result.state).toBe("allow");
        expect(result.origin).toBe("global");
      });

      it("both-object merge: project pattern overrides global pattern for same key", () => {
        // Both scopes define bash["git *"]; project wins for that pattern.
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { bash: { "git *": "ask" } } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { permission: { bash: { "git *": "allow" } } },
            floorsWhenInvalid: true,
          },
        ]);
        const result = checkTool(manager, "bash", {
          command: "git status",
        });
        expect(result.state).toBe("allow");
        expect(result.origin).toBe("project");
      });

      it("a later pattern-map catch-all shadows an earlier string, with origin 'project'", () => {
        // global defines read as a string "ask"; project's "*" follows it.
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { read: "ask" } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { permission: { read: { "*": "allow" } } },
            floorsWhenInvalid: true,
          },
        ]);
        const result = checkTool(manager, "read", {});
        expect(result.state).toBe("allow");
        expect(result.origin).toBe("project");
      });

      it("universal fallback from project carries origin 'project'", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { "*": "ask" } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { permission: { "*": "allow" } },
            floorsWhenInvalid: true,
          },
        ]);
        const result = checkTool(manager, "read", {});
        expect(result.state).toBe("allow");
        expect(result.origin).toBe("project");
      });
    });

    describe("agent frontmatter", () => {
      it("System-agent config overrides project-level bash patterns", () => {
        const { manager, cleanup } = createManagerWithProject(
          {
            permission: { "*": "allow", bash: "ask" },
          },
          {
            reviewer: `---
name: reviewer
permission:
  bash:
    "git log *": allow
---
`,
          },
          {
            projectConfig: {
              permission: { bash: { "git *": "deny" } },
            },
          },
        );

        try {
          const allowed = checkTool(
            manager,
            "bash",
            { command: "git log --oneline" },
            "reviewer",
          );
          expect(allowed.state).toBe("allow");
          expect(allowed.matchedPattern).toBe("git log *");

          const denied = checkTool(
            manager,
            "bash",
            { command: "git status" },
            "reviewer",
          );
          expect(denied.state).toBe("deny");
          expect(denied.matchedPattern).toBe("git *");
        } finally {
          cleanup();
        }
      });

      it("Full precedence chain base < project < system-agent < project-agent for universal default", () => {
        const { manager, cleanup } = createManagerWithProject(
          {
            permission: { "*": "deny" },
          },
          {
            reviewer: `---
name: reviewer
permission:
  "*": ask
---
`,
          },
          {
            projectConfig: {
              permission: { "*": "allow" },
            },
            projectAgentFiles: {
              reviewer: `---
name: reviewer
permission:
  "*": deny
---
`,
            },
          },
        );

        try {
          const reviewerResult = checkTool(
            manager,
            "custom_extension_tool",
            {},
            "reviewer",
          );
          expect(reviewerResult.state).toBe("deny");
          expect(reviewerResult.source).toBe("default");

          const globalResult = checkTool(manager, "custom_extension_tool", {});
          expect(globalResult.state).toBe("allow");
          expect(globalResult.source).toBe("default");
        } finally {
          cleanup();
        }
      });

      it("Project-agent applies even without a matching system-agent file", () => {
        const { manager, cleanup } = createManagerWithProject(
          {
            permission: { "*": "allow" },
          },
          {},
          {
            projectAgentFiles: {
              reviewer: `---
name: reviewer
permission:
  read: deny
---
`,
            },
          },
        );

        try {
          const agentResult = checkTool(manager, "read", {}, "reviewer");
          expect(agentResult.state).toBe("deny");
          expect(agentResult.source).toBe("tool");

          const globalResult = checkTool(manager, "read", {});
          expect(globalResult.state).toBe("allow");
          expect(globalResult.source).toBe("tool");
        } finally {
          cleanup();
        }
      });

      it("Agent frontmatter canonical tools resolve correctly", () => {
        const { manager, cleanup } = createManager(
          {
            permission: { "*": "deny" },
          },
          {
            reviewer: `---
name: reviewer
permission:
  find: allow
  ls: deny
---
`,
          },
        );

        try {
          const findResult = checkTool(manager, "find", {}, "reviewer");
          expect(findResult.state).toBe("allow");
          expect(findResult.source).toBe("tool");

          const lsResult = checkTool(manager, "ls", {}, "reviewer");
          expect(lsResult.state).toBe("deny");
          expect(lsResult.source).toBe("tool");
        } finally {
          cleanup();
        }
      });

      it("All surface names work in agent frontmatter flat permission format", () => {
        const { manager, cleanup } = createManager(
          {
            permission: { "*": "deny" },
          },
          {
            reviewer: `---
name: reviewer
permission:
  find: allow
  task: allow
  mcp: allow
---
`,
          },
        );

        try {
          const findResult = checkTool(manager, "find", {}, "reviewer");
          expect(findResult.state).toBe("allow");
          expect(findResult.source).toBe("tool");

          const taskResult = checkTool(manager, "task", {}, "reviewer");
          expect(taskResult.state).toBe("allow");
          expect(taskResult.source).toBe("tool");

          const mcpResult = checkTool(
            manager,
            "mcp",
            { tool: "exa:web_search_exa" },
            "reviewer",
          );
          expect(mcpResult.state).toBe("allow");
        } finally {
          cleanup();
        }
      });

      it("mcp catch-all in agent frontmatter overrides global default", () => {
        const { manager, cleanup } = createManager(
          {
            permission: { "*": "deny" },
          },
          {
            reviewer: `---
name: reviewer
permission:
  mcp: allow
---
`,
          },
        );

        try {
          const readResult = checkTool(manager, "read", {}, "reviewer");
          expect(readResult.state).toBe("deny");
          expect(readResult.source).toBe("tool");

          const mcpResult = checkTool(
            manager,
            "mcp",
            { tool: "exa:web_search_exa" },
            "reviewer",
          );
          expect(mcpResult.state).toBe("allow");
          expect(mcpResult.source).toBe("mcp");
        } finally {
          cleanup();
        }
      });

      it("external_directory permission respects per-agent override", () => {
        const { manager, cleanup } = createManager(
          {
            permission: { "*": "allow", external_directory: "deny" },
          },
          {
            trusted: `---
name: trusted
permission:
  external_directory: allow
---
`,
          },
        );

        try {
          const globalResult = checkTool(
            manager,
            "external_directory_read",
            {},
          );
          expect(globalResult.state).toBe("deny");

          const agentResult = checkTool(
            manager,
            "external_directory_read",
            {},
            "trusted",
          );
          expect(agentResult.state).toBe("allow");
          expect(agentResult.source).toBe("special");
        } finally {
          cleanup();
        }
      });

      it("skill pattern map in agent frontmatter overrides global skill policy", () => {
        const { manager, cleanup } = createManager(
          {
            permission: { "*": "deny", skill: "deny" },
          },
          {
            reviewer: `---
name: reviewer
permission:
  skill:
    "*": ask
    "pi-*": allow
---
`,
          },
        );

        try {
          const allowed = checkTool(
            manager,
            "skill",
            { name: "pi-code-review" },
            "reviewer",
          );
          expect(allowed.state).toBe("allow");
          expect(allowed.matchedPattern).toBe("pi-*");
          expect(allowed.source).toBe("skill");

          const asked = checkTool(
            manager,
            "skill",
            { name: "other-skill" },
            "reviewer",
          );
          expect(asked.state).toBe("ask");
          expect(asked.matchedPattern).toBe("*");

          const denied = checkTool(manager, "skill", {
            name: "pi-code-review",
          });
          expect(denied.state).toBe("deny");
          expect(denied.source).toBe("skill");
        } finally {
          cleanup();
        }
      });

      it("external_directory pattern map in agent frontmatter overrides global policy", () => {
        const { manager, cleanup } = createManager(
          {
            permission: { "*": "allow", external_directory: "deny" },
          },
          {
            trusted: `---
name: trusted
permission:
  external_directory:
    "*": deny
    "~/Downloads/*": allow
---
`,
          },
        );

        try {
          const allowed = checkPath(
            manager,
            `${homedir()}/Downloads/file.txt`,
            {},
            "external_directory_read",
            "trusted",
          );
          expect(allowed.state).toBe("allow");
          expect(allowed.matchedPattern).toBe("~/Downloads/*");
          expect(allowed.source).toBe("special");

          const denied = checkPath(
            manager,
            `${homedir()}/Documents/secret.txt`,
            {},
            "external_directory_read",
            "trusted",
          );
          expect(denied.state).toBe("deny");
          expect(denied.matchedPattern).toBe("*");

          const globalDenied = checkTool(
            manager,
            "external_directory_read",
            {},
          );
          expect(globalDenied.state).toBe("deny");
          expect(globalDenied.source).toBe("special");
        } finally {
          cleanup();
        }
      });

      it("project-agent frontmatter skill rules override global-agent frontmatter skill rules", () => {
        const { manager, cleanup } = createManagerWithProject(
          {
            permission: { "*": "deny" },
          },
          {
            analyst: `---
name: analyst
permission:
  skill:
    "*": ask
---
`,
          },
          {
            projectAgentFiles: {
              analyst: `---
name: analyst
permission:
  skill:
    "*": deny
    "pi-*": allow
---
`,
            },
          },
        );

        try {
          const allowed = checkTool(
            manager,
            "skill",
            { name: "pi-code-review" },
            "analyst",
          );
          expect(allowed.state).toBe("allow");
          expect(allowed.matchedPattern).toBe("pi-*");

          const denied = checkTool(
            manager,
            "skill",
            { name: "other-skill" },
            "analyst",
          );
          expect(denied.state).toBe("deny");
          expect(denied.matchedPattern).toBe("*");
        } finally {
          cleanup();
        }
      });

      it("project-agent frontmatter external_directory rules override global-agent frontmatter rules", () => {
        const { manager, cleanup } = createManagerWithProject(
          {
            permission: { "*": "allow", external_directory: "deny" },
          },
          {
            analyst: `---
name: analyst
permission:
  external_directory: ask
---
`,
          },
          {
            projectAgentFiles: {
              analyst: `---
name: analyst
permission:
  external_directory: allow
---
`,
            },
          },
        );

        try {
          const result = checkTool(
            manager,
            "external_directory_read",
            {},
            "analyst",
          );
          expect(result.state).toBe("allow");
          expect(result.source).toBe("special");

          const globalResult = checkTool(
            manager,
            "external_directory_read",
            {},
          );
          expect(globalResult.state).toBe("deny");
        } finally {
          cleanup();
        }
      });
    });

    describe("an invalid non-global scope fails closed", () => {
      // When a non-global config scope (project, agent, or project-agent) is invalid,
      // the composed policy is floored so nothing resolves more permissively than
      // `ask` (`allow` → `ask`, tagged `origin: "fail-closed"`). An invalid global
      // scope never triggers the clamp; a hard `deny` survives.
      const bashCheck = {
        kind: "tool" as const,
        surface: "bash",
        input: { command: "echo hi" },
      };

      it("floors a lower-scope allow to ask when a project scope is invalid", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { bash: "allow" } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { invalid: true },
            floorsWhenInvalid: true,
          },
        ]);
        const result = manager.check(bashCheck);
        expect(result.state).toBe("ask");
        expect(result.origin).toBe("fail-closed");
      });

      it("preserves a lower-scope deny when a project scope is invalid", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { bash: "deny" } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { invalid: true },
            floorsWhenInvalid: true,
          },
        ]);
        const result = manager.check(bashCheck);
        expect(result.state).toBe("deny");
        expect(result.origin).not.toBe("fail-closed");
      });

      it("floors when an agent scope is invalid", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { bash: "allow" } },
            floorsWhenInvalid: false,
          },
          {
            name: "agent",
            agentName: "coder",
            config: { invalid: true },
            floorsWhenInvalid: true,
          },
        ]);
        const result = manager.check({ ...bashCheck, agentName: "coder" });
        expect(result.state).toBe("ask");
        expect(result.origin).toBe("fail-closed");
      });

      it("does not floor for an invalid scope that is not marked to floor", () => {
        // Which scopes floor is the loader's call (global does not; see
        // "over real files"); the manager honors the flag, not the name.
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { bash: "allow" } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { invalid: true },
            floorsWhenInvalid: false,
          },
        ]);
        const result = manager.check(bashCheck);
        expect(result.state).toBe("allow");
        expect(result.origin).toBe("global");
        expect(manager.getPolicyIssues()).toEqual([]);
      });

      it("does not floor when all scopes are valid", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { bash: "allow" } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { permission: { read: "allow" } },
            floorsWhenInvalid: true,
          },
        ]);
        const result = manager.check(bashCheck);
        expect(result.state).toBe("allow");
        expect(result.origin).not.toBe("fail-closed");
      });

      it("floors getToolPermission too (display parity)", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { bash: "allow" } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { invalid: true },
            floorsWhenInvalid: true,
          },
        ]);
        expect(manager.getToolPermission("bash")).toBe("ask");
      });

      it("keeps a floored tool exposed — the clamp makes allows ask, never deny", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { bash: "allow" } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { invalid: true },
            floorsWhenInvalid: true,
          },
        ]);
        expect(manager.isToolFullyDenied("bash")).toBe(false);
      });

      it("appends a fail-closed notice to config issues naming the invalid scope", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { bash: "allow" } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { invalid: true },
            floorsWhenInvalid: true,
          },
        ]);
        expect(manager.getPolicyIssues()).toEqual([
          "Invalid project configuration detected — failing closed: 'allow' rules " +
            "are clamped to 'ask' for this session until the configuration is corrected.",
        ]);
      });

      it("emits no fail-closed notice when all scopes are valid", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: { permission: { bash: "allow" } },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { permission: { read: "allow" } },
            floorsWhenInvalid: true,
          },
        ]);
        expect(manager.getPolicyIssues()).toEqual([]);
      });

      describe("over real files", () => {
        // Production decides which scopes floor; these rows read real files
        // through `FilePolicyLoader`, so they pin that decision, not a fixture's.
        let fixture: TmpFixture;

        beforeEach(() => {
          fixture = createTmpFixture();
        });

        afterEach(() => {
          fixture.cleanup();
        });

        type ConfigScope = "global" | "project" | "agent" | "project-agent";

        /**
         * A manager whose global file allows `read`, with each named scope's
         * file made invalid: malformed JSON for a config file, a directory at
         * the agent's file path (EISDIR) for agent frontmatter.
         */
        function managerWithInvalid(
          invalid: readonly ConfigScope[],
        ): PermissionManager {
          const baseDir = fixture.dir("fail-closed-");
          const malformed = "{ not json";
          const globalConfigPath = fixture.file(
            baseDir,
            "config.json",
            invalid.includes("global")
              ? malformed
              : JSON.stringify({ permission: { read: "allow" } }),
          );
          const projectGlobalConfigPath = fixture.file(
            baseDir,
            "project/config.json",
            invalid.includes("project") ? malformed : "{}",
          );
          const agentsDir = fixture.subdir(baseDir, "agents");
          const projectAgentsDir = fixture.subdir(baseDir, "project/agents");
          if (invalid.includes("agent")) fixture.subdir(agentsDir, "coder.md");
          if (invalid.includes("project-agent")) {
            fixture.subdir(projectAgentsDir, "coder.md");
          }
          return createManagerFromPaths({
            globalConfigPath,
            agentsDir,
            projectGlobalConfigPath,
            projectAgentsDir,
            mcpServerNames: [],
          });
        }

        function failClosedNotice(named: string): string {
          return (
            `Invalid ${named} configuration detected — failing closed: 'allow' rules ` +
            "are clamped to 'ask' for this session until the configuration is corrected."
          );
        }

        it.each<{ invalid: ConfigScope[]; named: string }>([
          { invalid: ["project"], named: "project" },
          { invalid: ["agent"], named: "agent" },
          { invalid: ["project-agent"], named: "project-agent" },
          {
            invalid: ["project", "project-agent"],
            named: "project, project-agent",
          },
        ])("floors the global allow and names $named", ({ invalid, named }) => {
          const manager = managerWithInvalid(invalid);
          const result = checkTool(manager, "read", {}, "coder");
          expect(result.state).toBe("ask");
          expect(result.origin).toBe("fail-closed");
          expect(manager.getPolicyIssues("coder")).toEqual([
            failClosedNotice(named),
          ]);
        });

        it("neither floors nor reports an invalid global file", () => {
          const manager = managerWithInvalid(["global"]);
          const result = checkTool(manager, "read", {}, "coder");
          expect(result.state).toBe("ask");
          expect(result.origin).toBe("builtin");
          expect(manager.getPolicyIssues("coder")).toEqual([]);
        });
      });
    });

    describe("composed config rules", () => {
      it("returns only config-layer rules", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "ask", bash: { "git *": "allow" } },
        });
        const rules = manager.getComposedConfigRules();
        expect(rules.every((r) => r.layer === "config")).toBe(true);
        expect(
          rules.some((r) => r.surface === "bash" && r.pattern === "git *"),
        ).toBe(true);
      });

      it("lists a pattern two scopes define once, at the later scope's position", () => {
        const manager = createInMemoryManager([
          {
            name: "global",
            config: {
              permission: { bash: { "git *": "ask", "ls *": "allow" } },
            },
            floorsWhenInvalid: false,
          },
          {
            name: "project",
            config: { permission: { bash: { "git *": "allow" } } },
            floorsWhenInvalid: true,
          },
        ]);
        expect(manager.getComposedConfigRules()).toEqual([
          {
            surface: "bash",
            pattern: "ls *",
            action: "allow",
            layer: "config",
            origin: "global",
          },
          {
            surface: "bash",
            pattern: "git *",
            action: "allow",
            layer: "config",
            origin: "project",
          },
        ]);
      });
    });

    describe("policy issues", () => {
      it("is empty for a clean config", () => {
        const config: ScopeConfig = {
          permission: { "*": "ask", external_directory: "ask" },
        };
        const manager = createInMemoryGlobalManager(config);
        const issues = manager.getPolicyIssues();
        expect(issues.length).toBe(0);
      });

      it("is empty for an empty config", () => {
        const manager = createInMemoryGlobalManager({});
        const issues = manager.getPolicyIssues();
        expect(issues.length).toBe(0);
      });

      describe("over a rejected config file", () => {
        // A rejected config file's own schema errors are `ConfigStore`'s to report: it
        // loads the same file through the same `loadUnifiedConfig`. The policy side
        // answers only what composing policy reveals, so the operator hears each fact
        // once.
        const unknownKey = { bogusKey: 1 } as unknown as ScopeConfig;

        it("answers only the fail-closed notice for a rejected project file", () => {
          const { manager, cleanup } = createManagerWithProject(
            { permission: { bash: "allow" } },
            {},
            { projectConfig: { permission: { read: "allow" }, ...unknownKey } },
          );
          try {
            expect(manager.getPolicyIssues()).toEqual([
              "Invalid project configuration detected — failing closed: 'allow' rules " +
                "are clamped to 'ask' for this session until the configuration is corrected.",
            ]);
          } finally {
            cleanup();
          }
        });

        it("answers nothing for a rejected global file, which is never clamped", () => {
          const { manager, cleanup } = createManagerWithProject({
            permission: { bash: "allow" },
            ...unknownKey,
          });
          try {
            expect(manager.getPolicyIssues()).toEqual([]);
          } finally {
            cleanup();
          }
        });
      });
    });
  });

  describe("yolo", () => {
    // yolo is recorded authority: when the injected reader reports true, `check()`
    // rewrites every matched `ask` to `allow` tagged `origin: "yolo"`. Display
    // surfaces (`getComposedConfigRules`, `getToolPermission`) stay yolo-free.
    function makeYoloManager(
      global: Record<string, unknown>,
      isYoloEnabled: () => boolean,
      project?: ScopeConfig,
    ): PermissionManager {
      return new PermissionManager({
        policyLoader: createInMemoryPolicyLoader([
          {
            name: "global",
            config: { permission: global } as ScopeConfig,
            floorsWhenInvalid: false,
          },
          { name: "project", config: project ?? {}, floorsWhenInvalid: true },
        ]),
        isYoloEnabled,
      });
    }

    describe("rewrites asks", () => {
      it("rewrites a would-be-ask tool check to allow with origin 'yolo'", () => {
        const manager = makeYoloManager({ bash: "ask" }, () => true);
        const result = manager.check({
          kind: "tool",
          surface: "bash",
          input: { command: "rm -rf /tmp/x" },
        });
        expect(result.state).toBe("allow");
        expect(result.origin).toBe("yolo");
      });

      it("rewrites the synthesized universal-default ask to allow with origin 'yolo'", () => {
        // No rule for the surface; falls through to the universal "*" default (ask).
        const manager = makeYoloManager({}, () => true);
        const result = manager.check({
          kind: "tool",
          surface: "someExtensionTool",
          input: {},
        });
        expect(result.state).toBe("allow");
        expect(result.origin).toBe("yolo");
      });

      it("preserves explicit deny under yolo (hard denies survive)", () => {
        const manager = makeYoloManager({ bash: "deny" }, () => true);
        const result = manager.check({
          kind: "tool",
          surface: "bash",
          input: { command: "rm -rf /" },
        });
        expect(result.state).toBe("deny");
        expect(result.origin).not.toBe("yolo");
      });

      it("passes an explicit allow through unchanged (not tagged yolo)", () => {
        const manager = makeYoloManager({ read: "allow" }, () => true);
        const result = manager.check({
          kind: "tool",
          surface: "read",
          input: { path: "/tmp/x" },
        });
        expect(result.state).toBe("allow");
        expect(result.origin).not.toBe("yolo");
      });

      it("does not rewrite when yolo is disabled (state stays ask)", () => {
        const manager = makeYoloManager({ bash: "ask" }, () => false);
        const result = manager.check({
          kind: "tool",
          surface: "bash",
          input: { command: "rm -rf /tmp/x" },
        });
        expect(result.state).toBe("ask");
        expect(result.origin).not.toBe("yolo");
      });

      it("leaves display surfaces yolo-free even when yolo is enabled", () => {
        const manager = makeYoloManager({ bash: "ask" }, () => true);

        // getComposedConfigRules shows the configured action, not the rewrite.
        const bashRule = manager
          .getComposedConfigRules()
          .find((r) => r.surface === "bash");
        expect(bashRule?.action).toBe("ask");
        expect(bashRule?.origin).not.toBe("yolo");

        // getToolPermission reports the configured surface state.
        expect(manager.getToolPermission("bash")).toBe("ask");
      });

      it("does not re-expose a denied tool — the rewrite touches asks, never denies", () => {
        const manager = makeYoloManager({ bash: "deny" }, () => true);
        expect(manager.isToolFullyDenied("bash")).toBe(true);
      });
    });

    describe("under a fail-closed scope", () => {
      it("yolo re-permits a fail-closed floored allow (allow→ask→allow)", () => {
        // Invalid project scope floors global's `allow` to `ask` at composition;
        // yolo then rewrites the `ask` back to `allow`. yolo is an explicit
        // full-permissive opt-in, so yolo users are unaffected by the clamp.
        const manager = makeYoloManager({ bash: "allow" }, () => true, {
          invalid: true,
        });
        const result = manager.check({
          kind: "tool",
          surface: "bash",
          input: { command: "echo hi" },
        });
        expect(result.state).toBe("allow");
        expect(result.origin).toBe("yolo");
      });

      it("preserves a hard deny under yolo even with an invalid scope", () => {
        const manager = makeYoloManager({ bash: "deny" }, () => true, {
          invalid: true,
        });
        const result = manager.check({
          kind: "tool",
          surface: "bash",
          input: { command: "rm -rf /" },
        });
        expect(result.state).toBe("deny");
        expect(result.origin).not.toBe("yolo");
      });
    });
  });

  describe("session rules", () => {
    describe("over the default", () => {
      it("session rule wins over the universal default (external_directory)", () => {
        const manager = createMissingConfigManager();
        const sessionRules: Ruleset = [
          sessionRule("external_directory_read", "/other/project"),
        ];
        const result = checkPath(
          manager,
          "/other/project",
          {},
          "external_directory_read",
          undefined,
          sessionRules,
        );
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
        expect(result.matchedPattern).toBe("/other/project");
      });

      it("session rule wins over the universal default (skill)", () => {
        const manager = createMissingConfigManager();
        const sessionRules: Ruleset = [sessionRule("skill", "librarian")];
        const result = checkTool(
          manager,
          "skill",
          { name: "librarian" },
          undefined,
          sessionRules,
        );
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
        expect(result.matchedPattern).toBe("librarian");
      });

      it("session rule wins over the universal default (bash)", () => {
        const manager = createMissingConfigManager();
        const sessionRules: Ruleset = [sessionRule("bash", "git status")];
        const result = checkTool(
          manager,
          "bash",
          { command: "git status" },
          undefined,
          sessionRules,
        );
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
        expect(result.matchedPattern).toBe("git status");
      });

      it("session rule wins over the universal default (tool — read)", () => {
        const manager = createMissingConfigManager();
        const sessionRules: Ruleset = [sessionRule("read", "*")];
        const result = checkTool(manager, "read", {}, undefined, sessionRules);
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
      });

      it("session rule wins over the universal default (mcp)", () => {
        const manager = createMissingConfigManager();
        const sessionRules: Ruleset = [sessionRule("mcp", "mcp_status")];
        const result = checkTool(manager, "mcp", {}, undefined, sessionRules);
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
      });

      it("no session rules — falls through to default (ask)", () => {
        const manager = createMissingConfigManager();
        const result = checkTool(manager, "read", {}, undefined, []);
        expect(result.state).toBe("ask");
        expect(result.source).not.toBe("session");
      });

      it("session rule with narrower pattern does not block a broader command not in session", () => {
        const manager = createMissingConfigManager();
        // Only "git status" is session-approved; "git push" should fall through to default.
        const sessionRules: Ruleset = [sessionRule("bash", "git status")];
        const result = checkTool(
          manager,
          "bash",
          { command: "git push origin main" },
          undefined,
          sessionRules,
        );
        expect(result.state).toBe("ask");
        expect(result.source).not.toBe("session");
      });

      it("session wildcard pattern matches multiple commands", () => {
        const manager = createMissingConfigManager();
        const sessionRules: Ruleset = [sessionRule("bash", "git *")];
        const push = checkTool(
          manager,
          "bash",
          { command: "git push origin main" },
          undefined,
          sessionRules,
        );
        const status = checkTool(
          manager,
          "bash",
          { command: "git status" },
          undefined,
          sessionRules,
        );
        expect(push.state).toBe("allow");
        expect(push.source).toBe("session");
        expect(status.state).toBe("allow");
        expect(status.source).toBe("session");
      });

      it("returns source 'session' for bash when session rules match", () => {
        const manager = createInMemoryGlobalManager({ permission: {} });
        const sessionRules = [sessionRule("bash", "git *")];

        const result = checkTool(
          manager,
          "bash",
          { command: "git status --short" },
          undefined,
          sessionRules,
        );
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
        expect(result.matchedPattern).toBe("git *");
      });

      it("returns source 'session' for bash when session rule is exact match", () => {
        const manager = createInMemoryGlobalManager({ permission: {} });
        const sessionRules = [sessionRule("bash", "ls")];

        const result = checkTool(
          manager,
          "bash",
          { command: "ls" },
          undefined,
          sessionRules,
        );
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
      });

      it("returns source 'session' for mcp when session rules match the target", () => {
        const manager = createInMemoryGlobalManager({ permission: {} });
        const sessionRules = [sessionRule("mcp", "exa:*")];

        const result = checkTool(
          manager,
          "mcp",
          { tool: "exa:search" },
          undefined,
          sessionRules,
        );
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
      });
    });

    describe("over a config rule", () => {
      it("session rule wins over config", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "deny" },
        });
        const sessionRules: Ruleset = [sessionRule("read", "*")];
        const result = checkTool(manager, "read", {}, undefined, sessionRules);
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
      });

      it("returns source 'session' when session rules cover the external_directory path", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "allow" },
        });
        const sessionRules = [
          sessionRule("external_directory_read", "/other/project/*"),
        ];

        const result = checkPath(
          manager,
          "/other/project/src/foo.ts",
          {},
          "external_directory_read",
          undefined,
          sessionRules,
        );
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
        expect(result.matchedPattern).toBe("/other/project/*");
      });

      it("falls back to config policy when session rules do not cover the path", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "allow", external_directory: "deny" },
        });
        const sessionRules = [
          sessionRule("external_directory_read", "/other/project/*"),
        ];

        const result = checkTool(
          manager,
          "external_directory_read",
          { path: "/completely/different/path.ts" },
          undefined,
          sessionRules,
        );
        expect(result.state).toBe("deny");
        expect(result.source).toBe("special");
      });

      it("session rules override config deny for external_directory", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "allow", external_directory: "deny" },
        });
        const sessionRules = [
          sessionRule("external_directory_read", "/other/project/*"),
        ];

        const result = checkPath(
          manager,
          "/other/project/src/foo.ts",
          {},
          "external_directory_read",
          undefined,
          sessionRules,
        );
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
      });

      it("falls back to config for bash when session rules do not match the command", () => {
        const manager = createInMemoryGlobalManager({
          permission: { bash: "deny" },
        });
        const sessionRules = [sessionRule("bash", "git *")];

        const result = checkTool(
          manager,
          "bash",
          { command: "npm run build" },
          undefined,
          sessionRules,
        );
        expect(result.state).toBe("deny");
        expect(result.source).toBe("bash");
      });

      it("treats an empty session ruleset like none", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "allow", external_directory: "deny" },
        });
        const withEmpty = checkPath(
          manager,
          "/other/project/foo.ts",
          {},
          "external_directory_read",
          undefined,
          [],
        );
        const withoutArg = checkPath(
          manager,
          "/other/project/foo.ts",
          {},
          "external_directory_read",
        );
        const expected: PermissionCheckResult = {
          toolName: "external_directory_read",
          state: "deny",
          matchedPattern: "*",
          source: "special",
          origin: "global",
        };
        expect(withEmpty).toEqual(expected);
        expect(withoutArg).toEqual(expected);
      });

      it("session rule for specific path overrides config deny", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            read: { "*": "allow", "*.env": "deny" },
          },
        });
        const sessionRules: Ruleset = [sessionRule("read", ".env")];
        const result = checkPath(
          manager,
          ".env",
          {},
          "read",
          undefined,
          sessionRules,
        );
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
      });

      it("session approval on path surface overrides config deny", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            path: { "*": "allow", "*.env": "deny" },
          },
        });
        const sessionRules: Ruleset = [
          sessionRule("path_read", "/project/.env"),
        ];
        const result = checkPath(
          manager,
          "/project/.env",
          {},
          "path_read",
          undefined,
          sessionRules,
        );
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
      });
    });

    describe("surface isolation", () => {
      it("session rule does not bleed across surfaces", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "ask" },
        });
        const sessionRules: Ruleset = [sessionRule("bash", "git *")];
        const bashResult = checkTool(
          manager,
          "bash",
          { command: "git status" },
          undefined,
          sessionRules,
        );
        expect(bashResult.state).toBe("allow");

        const readResult = checkTool(
          manager,
          "read",
          {},
          undefined,
          sessionRules,
        );
        expect(readResult.state).toBe("ask");
      });

      it("session rules for one surface do not affect checks on other surfaces", () => {
        const manager = createInMemoryGlobalManager({ permission: {} });
        const sessionRules = [
          sessionRule("external_directory_read", "/other/project/*"),
        ];

        const bashResult = checkTool(
          manager,
          "bash",
          { command: "git status" },
          undefined,
          sessionRules,
        );
        expect(bashResult.state).toBe("ask");
        expect(bashResult.source).toBe("bash");

        const mcpResult = checkTool(
          manager,
          "mcp",
          { tool: "exa:search" },
          undefined,
          sessionRules,
        );
        expect(mcpResult.state).toBe("ask");
        expect(mcpResult.source).toBe("default");
      });

      it("bash session rules do not bleed into mcp checks", () => {
        const manager = createInMemoryGlobalManager({ permission: {} });
        const sessionRules = [sessionRule("bash", "git *")];

        const result = checkTool(
          manager,
          "mcp",
          { tool: "exa:search" },
          undefined,
          sessionRules,
        );
        expect(result.source).not.toBe("session");
      });
    });

    describe("attribution", () => {
      it("matchedPattern is the session rule pattern for a session match (bash)", () => {
        const manager = createMissingConfigManager();
        const sessionRules: Ruleset = [sessionRule("bash", "git *")];
        const result = checkTool(
          manager,
          "bash",
          { command: "git status" },
          undefined,
          sessionRules,
        );
        expect(result.matchedPattern).toBe("git *");
        expect(result.source).toBe("session");
      });

      it("session rule: origin is 'session'", () => {
        const manager = createMissingConfigManager();
        const sessionRules: Ruleset = [sessionRule("read", "*")];
        const result = checkTool(manager, "read", {}, undefined, sessionRules);
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
        expect(result.origin).toBe("session");
      });
    });
  });

  describe("surfaces", () => {
    describe("source and matchedPattern", () => {
      describe("external_directory (special surface)", () => {
        it("source is 'special' for a config-matched path", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              "*": "ask",
              external_directory: { "/trusted/*": "allow" },
            },
          });
          const result = checkPath(
            manager,
            "/trusted/repo",
            {},
            "external_directory_read",
          );
          expect(result.state).toBe("allow");
          expect(result.source).toBe("special");
          expect(result.matchedPattern).toBe("/trusted/*");
        });

        it("source is 'special' even for a default match (no config rule)", () => {
          const manager = createMissingConfigManager();
          const result = checkPath(
            manager,
            "/some/path",
            {},
            "external_directory",
          );
          expect(result.state).toBe("ask");
          expect(result.source).toBe("special");
          expect(result.matchedPattern).toBeUndefined();
        });

        it("matchedPattern is undefined for a default match", () => {
          const manager = createMissingConfigManager();
          const result = checkPath(
            manager,
            "/unknown",
            {},
            "external_directory",
          );
          expect(result.matchedPattern).toBeUndefined();
        });
      });

      describe("directional path surfaces (special by family)", () => {
        it.each([
          "path_read",
          "path_write",
          "external_directory_read",
          "external_directory_write",
        ])("source is 'special' for a config-matched %s rule", (surface) => {
          const manager = createInMemoryGlobalManager({
            permission: {
              "*": "ask",
              [surface]: { "/trusted/*": "allow" },
            },
          });
          const result = checkPath(manager, "/trusted/repo", {}, surface);
          expect(result.state).toBe("allow");
          expect(result.source).toBe("special");
          expect(result.matchedPattern).toBe("/trusted/*");
        });
      });

      describe("skill surface", () => {
        it("source is 'skill' for a config-matched skill name", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              "*": "ask",
              skill: { librarian: "allow" },
            },
          });
          const result = checkTool(manager, "skill", { name: "librarian" });
          expect(result.state).toBe("allow");
          expect(result.source).toBe("skill");
          expect(result.matchedPattern).toBe("librarian");
        });

        it("source is 'skill' even for a default match", () => {
          const manager = createMissingConfigManager();
          const result = checkTool(manager, "skill", { name: "unknown" });
          expect(result.state).toBe("ask");
          expect(result.source).toBe("skill");
        });
      });

      describe("bash surface", () => {
        it("source is 'bash' and command is included in result", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              "*": "ask",
              bash: { "git *": "allow" },
            },
          });
          const result = checkTool(manager, "bash", {
            command: "git status",
          });
          expect(result.state).toBe("allow");
          expect(result.source).toBe("bash");
          expect(result.command).toBe("git status");
          expect(result.matchedPattern).toBe("git *");
        });

        it("source is 'bash' even for a default match, command is empty string", () => {
          const manager = createMissingConfigManager();
          const result = checkTool(manager, "bash", {});
          expect(result.source).toBe("bash");
          expect(result.command).toBe("");
          expect(result.matchedPattern).toBeUndefined();
        });
      });

      describe("mcp surface", () => {
        it("source is 'mcp' for a config-matched target", () => {
          const manager = createInMemoryGlobalManager(
            {
              permission: { "*": "ask", mcp: { exa_search: "allow" } },
            },
            ["exa"],
          );
          const result = checkTool(manager, "mcp", {
            tool: "exa:search",
            server: "exa",
          });
          expect(result.state).toBe("allow");
          expect(result.source).toBe("mcp");
          expect(result.matchedPattern).toBe("exa_search");
          expect(result.target).toBeDefined();
        });

        it("source is 'default' when all targets match only the synthesized default", () => {
          const manager = createMissingConfigManager();
          const result = checkTool(manager, "mcp", { tool: "exa:search" });
          expect(result.state).toBe("ask");
          expect(result.source).toBe("default");
          expect(result.matchedPattern).toBeUndefined();
        });

        it("target field is set for a matched mcp call", () => {
          const manager = createInMemoryGlobalManager(
            {
              permission: { "*": "ask", mcp: { mcp_status: "allow" } },
            },
            [],
          );
          const result = checkTool(manager, "mcp", {});
          expect(result.target).toBeDefined();
          expect(result.source).toBe("mcp");
        });
      });

      describe("tool surfaces", () => {
        it("built-in tool: source is always 'tool' (config match)", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              "*": "ask",
              read: "allow",
            },
          });
          const result = checkTool(manager, "read", {});
          expect(result.state).toBe("allow");
          expect(result.source).toBe("tool");
        });

        it("built-in tool: source is 'tool' even for a default match", () => {
          const manager = createMissingConfigManager();
          const result = checkTool(manager, "read", {});
          expect(result.state).toBe("ask");
          expect(result.source).toBe("tool");
        });

        it("extension tool: source is 'default' when no config rule matches", () => {
          const manager = createMissingConfigManager();
          const result = checkTool(manager, "my_custom_tool", {});
          expect(result.state).toBe("ask");
          expect(result.source).toBe("default");
        });

        it("extension tool: source is 'tool' when a config rule matches", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              "*": "ask",
              my_custom_tool: "allow",
            },
          });
          const result = checkTool(manager, "my_custom_tool", {});
          expect(result.state).toBe("allow");
          expect(result.source).toBe("tool");
        });

        it("extension tools use 'default' source when no config rule matches", () => {
          const manager = createInMemoryGlobalManager({
            permission: { "*": "ask" },
          });
          const result = checkTool(manager, "my_custom_tool", {});
          expect(result.state).toBe("ask");
          expect(result.source).toBe("default");
        });
      });
    });

    describe("built-in and extension tools", () => {
      it("resolves a canonical built-in tool on its tool surface", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "deny", read: "allow" },
        });
        const readResult = checkTool(manager, "read", {});
        expect(readResult.state).toBe("allow");
        expect(readResult.source).toBe("tool");

        const writeResult = checkTool(manager, "write", {});
        expect(writeResult.state).toBe("deny");
        expect(writeResult.source).toBe("tool");
      });

      it("Arbitrary extension tools use exact-name tool permissions instead of MCP fallback", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            "*": "deny",
            third_party_tool: "allow",
            mcp: { "*": "deny" },
          },
        });
        const allowed = checkTool(manager, "third_party_tool", {});
        expect(allowed.state).toBe("allow");
        expect(allowed.source).toBe("tool");

        // another_extension_tool has no explicit rule — falls through to the
        // universal default (permission["*"] = "deny") with source "default".
        const fallback = checkTool(manager, "another_extension_tool", {});
        expect(fallback.state).toBe("deny");
        expect(fallback.source).toBe("default");
      });

      it("Canonical tools map directly without legacy aliases", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "ask", find: "allow", ls: "deny" },
        });
        const findResult = checkTool(manager, "find", {});
        expect(findResult.state).toBe("allow");
        expect(findResult.source).toBe("tool");

        const lsResult = checkTool(manager, "ls", {});
        expect(lsResult.state).toBe("deny");
        expect(lsResult.source).toBe("tool");
      });

      it("task uses exact-name tool permissions like any registered extension tool", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "deny", task: "allow" },
        });
        const taskResult = checkTool(manager, "task", {});
        expect(taskResult.state).toBe("allow");
        expect(taskResult.source).toBe("tool");
      });
    });

    describe("bash", () => {
      it("multiline bash command resolves to allow via universal fallback", () => {
        // Regression test for #73: node -e "..." with embedded newlines was
        // falling through to the hard-coded 'ask' default because wildcardMatch
        // used /^.*$/ (no dotAll), which does not match '\n'.
        const manager = createInMemoryGlobalManager({
          permission: {
            "*": "allow",
            bash: { "rm -rf *": "deny", "sudo *": "ask" },
          },
        });
        const command =
          "node -e \"\nimport('x').then(() => {\n  console.log('done');\n});\n\"";
        const result = checkTool(manager, "bash", { command });
        expect(result.state).toBe("allow");
      });

      it("Bash specific deny patterns override catch-all within the same config", () => {
        // In the flat format, patterns within a surface map are ordered by insertion.
        // Last-match-wins means specific patterns placed AFTER the catch-all override it.
        const manager = createInMemoryGlobalManager({
          permission: {
            "*": "ask",
            bash: { "*": "allow", "rm -rf *": "deny" },
          },
        });
        const denied = checkTool(manager, "bash", {
          command: "rm -rf build",
        });
        expect(denied.state).toBe("deny");
        expect(denied.source).toBe("bash");
        expect(denied.matchedPattern).toBe("rm -rf *");

        const allowed = checkTool(manager, "bash", { command: "echo hello" });
        expect(allowed.state).toBe("allow");
        expect(allowed.source).toBe("bash");
        expect(allowed.matchedPattern).toBe("*");
      });

      describe("a bash command evaluated with its spellings", () => {
        const home = homedir();

        function checkCommand(
          bash: Record<string, PermissionState>,
          command: string,
          spellings: readonly string[],
          sessionRules?: Ruleset,
        ): PermissionCheckResult {
          const manager = createInMemoryGlobalManager({ permission: { bash } });
          return manager.check(
            { kind: "bash-command", surface: "bash", command, spellings },
            sessionRules,
          );
        }

        it("matches a home-anchored rule through the spelling, reporting the command as typed", () => {
          const result = checkCommand(
            { "*": "ask", "~/bin/x": "allow" },
            "~/bin/x",
            [`${home}/bin/x`],
          );
          expect(result.state).toBe("allow");
          expect(result.matchedPattern).toBe("~/bin/x");
          expect(result.command).toBe("~/bin/x");
        });

        it("matches only the typed text when there are no spellings", () => {
          const result = checkCommand(
            { "*": "ask", "~/bin/x": "allow" },
            "~/bin/x",
            [],
          );
          expect(result.state).toBe("ask");
          expect(result.matchedPattern).toBe("*");
        });

        it("lets rule position decide, not which spelling a rule matched", () => {
          const result = checkCommand(
            { "~/bin/x": "allow", "*": "ask" },
            "~/bin/x",
            [`${home}/bin/x`],
          );
          expect(result.state).toBe("ask");
          expect(result.matchedPattern).toBe("*");
        });

        it("lets a later rule matching only the spelling override an earlier one matching only the typed text", () => {
          // `?/bin/x` matches the typed `~/bin/x` and not the spelling, so a
          // first-value-wins evaluation would stop at its allow.
          const result = checkCommand(
            { "*": "ask", "?/bin/x": "allow", "~/bin/x": "deny" },
            "~/bin/x",
            [`${home}/bin/x`],
          );
          expect(result.state).toBe("deny");
          expect(result.matchedPattern).toBe("~/bin/x");
        });

        it("reaches a home-anchored deny through the spelling", () => {
          const result = checkCommand(
            { "*": "allow", "~/bin/danger *": "deny" },
            "~/bin/danger --now",
            [`${home}/bin/danger --now`],
          );
          expect(result.state).toBe("deny");
          expect(result.matchedPattern).toBe("~/bin/danger *");
        });

        it("matches a session grant recorded for the typed command", () => {
          const result = checkCommand(
            { "*": "ask" },
            "~/bin/x",
            [`${home}/bin/x`],
            [sessionRule("bash", "~/bin/x")],
          );
          expect(result.state).toBe("allow");
          expect(result.source).toBe("session");
        });

        describe("the spelling the winning rule matched", () => {
          it("is reported when the rule matched only a spelling", () => {
            const result = checkCommand(
              { "*": "ask", "rm /tmp/a/*": "allow" },
              "rm a/x",
              ["rm /tmp/a/x"],
            );
            expect(result.state).toBe("allow");
            expect(result.matchedSpelling).toBe("rm /tmp/a/x");
          });

          it("is not reported when the rule also matched the command as typed", () => {
            const result = checkCommand(
              { "*": "ask", "rm *": "allow" },
              "rm a/x",
              ["rm /tmp/a/x"],
            );
            expect(result.state).toBe("allow");
            expect("matchedSpelling" in result).toBe(false);
          });

          it("is not reported when no rule matched", () => {
            const result = checkCommand({}, "rm a/x", ["rm /tmp/a/x"]);
            expect("matchedSpelling" in result).toBe(false);
          });

          it("is never reported for an MCP target matched under a later candidate", () => {
            const manager = createInMemoryGlobalManager(
              { permission: { mcp: { "*": "ask", github: "deny" } } },
              ["github"],
            );
            const result = manager.check({
              kind: "tool",
              surface: "mcp",
              input: { tool: "github_search" },
            });
            expect(result.state).toBe("deny");
            expect("matchedSpelling" in result).toBe(false);
          });

          it("is never reported for a path matched under a later alias", () => {
            const manager = createInMemoryGlobalManager({
              permission: { path: { "*": "ask", "src/*": "deny" } },
            });
            const result = checkPathValues(manager, ["/repo/src/x", "src/x"]);
            expect(result.state).toBe("deny");
            expect("matchedSpelling" in result).toBe(false);
          });
        });
      });
    });

    describe("skill", () => {
      it("Skill permission matching", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            "*": "ask",
            skill: {
              "*": "ask",
              "web-*": "deny",
              "requesting-code-review": "allow",
            },
          },
        });
        const allowed = checkTool(manager, "skill", {
          name: "requesting-code-review",
        });
        expect(allowed.state).toBe("allow");
        expect(allowed.matchedPattern).toBe("requesting-code-review");
        expect(allowed.source).toBe("skill");

        const denied = checkTool(manager, "skill", {
          name: "web-design-guidelines",
        });
        expect(denied.state).toBe("deny");
        expect(denied.matchedPattern).toBe("web-*");

        const fallback = checkTool(manager, "skill", {
          name: "unknown-skill",
        });
        expect(fallback.state).toBe("ask");
        expect(fallback.matchedPattern).toBe("*");
      });
    });

    describe("deny reasons", () => {
      it("deny-with-reason: reason threads through to PermissionCheckResult", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            bash: { "npm *": { action: "deny", reason: "Use pnpm instead" } },
          },
        });
        const result = checkTool(manager, "bash", {
          command: "npm install",
        });
        expect(result.state).toBe("deny");
        expect(result.reason).toBe("Use pnpm instead");
        expect(result.matchedPattern).toBe("npm *");
      });

      it("deny-without-reason: reason is undefined in PermissionCheckResult", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            bash: { "rm -rf *": "deny" },
          },
        });
        const result = checkTool(manager, "bash", { command: "rm -rf /" });
        expect(result.state).toBe("deny");
        expect(result.reason).toBeUndefined();
      });

      it("deny-with-reason on a non-bash surface", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            read: {
              "*.env": {
                action: "deny",
                reason: "Environment files contain secrets",
              },
            },
          },
        });
        const result = checkPath(manager, ".env", {}, "read");
        expect(result.state).toBe("deny");
        expect(result.reason).toBe("Environment files contain secrets");
        expect(result.matchedPattern).toBe("*.env");
      });

      it("non-string reason falls through to the default (malformed config)", () => {
        const { manager, cleanup } = createManagerWithConfig({
          bash: { "npm *": { action: "deny", reason: 42 } },
        });
        try {
          const result = checkTool(manager, "bash", {
            command: "npm install",
          });
          expect(result.state).toBe("ask");
          expect(result.reason).toBeUndefined();
        } finally {
          cleanup();
        }
      });
    });

    describe("tool exposure", () => {
      describe("getToolPermission", () => {
        it("returns tool-level state for built-in tools", () => {
          const manager = createInMemoryGlobalManager({
            permission: { "*": "deny", read: "allow" },
          });
          expect(manager.getToolPermission("read")).toBe("allow");
          expect(manager.getToolPermission("write")).toBe("deny");
        });

        it("returns tool-level state for bash surface", () => {
          const manager = createInMemoryGlobalManager({
            permission: { "*": "deny", bash: "allow" },
          });
          expect(manager.getToolPermission("bash")).toBe("allow");
        });

        it("reports the surface catch-all even when a nested pattern is permissive", () => {
          const manager = createInMemoryGlobalManager({
            permission: { "*": "ask", bash: { "*": "deny", "git *": "ask" } },
          });
          expect(manager.getToolPermission("bash")).toBe("deny");
        });

        it("getToolPermission returns tool-level policy for canonical and extension tools", () => {
          const { manager, cleanup } = createManager(
            {
              permission: { "*": "ask" },
            },
            {
              reviewer: `---
name: reviewer
permission:
  bash: deny
  read: deny
  task: allow
---
`,
            },
          );

          try {
            const bashPermission = manager.getToolPermission(
              "bash",
              "reviewer",
            );
            expect(bashPermission).toBe("deny");

            const taskPermission = manager.getToolPermission(
              "task",
              "reviewer",
            );
            expect(taskPermission).toBe("allow");

            const readPermission = manager.getToolPermission(
              "read",
              "reviewer",
            );
            expect(readPermission).toBe("deny");

            const defaultBashPermission = manager.getToolPermission("bash");
            expect(defaultBashPermission).toBe("ask");
          } finally {
            cleanup();
          }
        });

        it("getToolPermission supports arbitrary extension tool names", () => {
          const manager = createInMemoryGlobalManager({
            permission: { "*": "deny", third_party_tool: "allow" },
          });
          const explicitPermission =
            manager.getToolPermission("third_party_tool");
          expect(explicitPermission).toBe("allow");

          const fallbackPermission = manager.getToolPermission(
            "missing_extension_tool",
          );
          expect(fallbackPermission).toBe("deny");
        });
      });

      describe("isToolFullyDenied", () => {
        it("is false when a nested pattern under a deny catch-all is reachable", () => {
          const manager = createInMemoryGlobalManager({
            permission: { "*": "ask", bash: { "*": "deny", "git *": "ask" } },
          });
          expect(manager.isToolFullyDenied("bash")).toBe(false);
        });

        it("is true when the surface is denied outright", () => {
          const manager = createInMemoryGlobalManager({
            permission: { "*": "ask", bash: "deny" },
          });
          expect(manager.isToolFullyDenied("bash")).toBe(true);
        });

        it("is true when the exception is shadowed by a later deny catch-all", () => {
          const manager = createInMemoryGlobalManager({
            permission: { "*": "ask", bash: { "git *": "ask", "*": "deny" } },
          });
          expect(manager.isToolFullyDenied("bash")).toBe(true);
        });

        it("is false for a path-bearing tool with a permissive path pattern", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              "*": "ask",
              read: { "*": "deny", "~/notes/*": "allow" },
            },
          });
          expect(manager.isToolFullyDenied("read")).toBe(false);
        });

        it("is true for every tool under a universal deny", () => {
          const manager = createInMemoryGlobalManager({
            permission: { "*": "deny" },
          });
          expect(manager.isToolFullyDenied("bash")).toBe(true);
          expect(manager.isToolFullyDenied("third_party_tool")).toBe(true);
        });

        it("trims the tool name and honors the agent scope", () => {
          const manager = createInMemoryManager([
            {
              name: "global",
              config: { permission: { "*": "ask", bash: "deny" } },
              floorsWhenInvalid: false,
            },
            {
              name: "agent",
              agentName: "reviewer",
              config: {
                permission: { bash: { "*": "deny", "git *": "ask" } },
              },
              floorsWhenInvalid: true,
            },
          ]);
          expect(manager.isToolFullyDenied(" bash ")).toBe(true);
          expect(manager.isToolFullyDenied("bash", "reviewer")).toBe(false);
        });
      });
    });

    describe("a tool intent", () => {
      it("resolves a tool call on the bash surface", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            bash: { "*": "allow", "git push": "deny" },
          },
        });
        const intent: ResolvedAccessIntent = {
          kind: "tool",
          surface: "bash",
          input: { command: "git push" },
        };
        const result = manager.check(intent);
        expect(result.state).toBe("deny");
        expect(result.toolName).toBe("bash");
        expect(result.source).toBe("bash");
      });

      it("resolves a tool call on the read surface", () => {
        const manager = createInMemoryGlobalManager({
          permission: { read: "deny" },
        });
        const intent: ResolvedAccessIntent = {
          kind: "tool",
          surface: "read",
          input: { path: "/some/file.txt" },
        };
        const result = manager.check(intent);
        expect(result.state).toBe("deny");
        expect(result.toolName).toBe("read");
        expect(result.source).toBe("tool");
      });

      it("applies session rules via the tool intent", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            bash: { "*": "deny" },
          },
        });
        const sessionRules: Ruleset = [sessionRule("bash", "echo *")];
        const intent: ResolvedAccessIntent = {
          kind: "tool",
          surface: "bash",
          input: { command: "echo hello" },
        };
        const result = manager.check(intent, sessionRules);
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
      });

      it("threads agentName through the tool intent", () => {
        const { manager, cleanup } = createManager(
          { permission: { bash: "deny" } },
          {
            "agent-a": `---\nname: agent-a\npermission:\n  bash: allow\n---\n`,
          },
        );
        try {
          const intent: ResolvedAccessIntent = {
            kind: "tool",
            surface: "bash",
            input: { command: "echo hi" },
            agentName: "agent-a",
          };
          const result = manager.check(intent);
          expect(result.state).toBe("allow");
        } finally {
          cleanup();
        }
      });
    });
  });

  describe("mcp", () => {
    describe("target resolution", () => {
      it("MCP wildcard matching uses the registered mcp tool", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            "*": "ask",
            mcp: {
              "*": "deny",
              "research_*": "ask",
              "research_query-*": "allow",
            },
          },
        });
        const queryDocs = checkTool(manager, "mcp", {
          tool: "research:query-docs",
        });
        expect(queryDocs.state).toBe("allow");
        expect(queryDocs.source).toBe("mcp");
        expect(queryDocs.matchedPattern).toBe("research_query-*");
        expect(queryDocs.target).toBe("research_query-docs");

        const resolve2 = checkTool(manager, "mcp", {
          tool: "research:resolve-context",
        });
        expect(resolve2.state).toBe("ask");
        expect(resolve2.matchedPattern).toBe("research_*");
        expect(resolve2.target).toBe("research_resolve-context");

        const unknown = checkTool(manager, "mcp", {
          tool: "search:provider",
        });
        expect(unknown.state).toBe("deny");
        expect(unknown.matchedPattern).toBe("*");
        expect(unknown.target).toBe("search_provider");
      });

      it("MCP proxy tool infers server-prefixed aliases from configured server names", () => {
        const manager = createInMemoryGlobalManager(
          {
            permission: {
              "*": "ask",
              mcp: { "exa_*": "deny", exa_get_code_context_exa: "allow" },
            },
          },
          ["exa"],
        );
        const result = checkTool(manager, "mcp", {
          tool: "get_code_context_exa",
        });
        expect(result.state).toBe("allow");
        expect(result.source).toBe("mcp");
        expect(result.matchedPattern).toBe("exa_get_code_context_exa");
        expect(result.target).toBe("exa_get_code_context_exa");
      });

      it("MCP describe mode normalizes qualified tool names without duplicating server prefixes", () => {
        const manager = createInMemoryGlobalManager(
          {
            permission: {
              "*": "ask",
              mcp: { "exa_*": "deny", exa_web_search_exa: "allow" },
            },
          },
          ["exa"],
        );
        const result = checkTool(manager, "mcp", {
          describe: "exa:web_search_exa",
          server: "exa",
        });
        expect(result.state).toBe("allow");
        expect(result.source).toBe("mcp");
        expect(result.matchedPattern).toBe("exa_web_search_exa");
        expect(result.target).toBe("exa_web_search_exa");
      });

      it("mcp catch-all acts as fallback for unmatched MCP targets", () => {
        const { manager, cleanup } = createManager(
          {
            permission: { "*": "ask" },
          },
          {
            reviewer: `---
name: reviewer
permission:
  mcp: allow
---
`,
          },
        );

        try {
          const result = checkTool(
            manager,
            "mcp",
            { tool: "exa:web_search_exa" },
            "reviewer",
          );
          expect(result.state).toBe("allow");
          expect(result.source).toBe("mcp");
          expect(result.target).toBe("exa_web_search_exa");
        } finally {
          cleanup();
        }
      });

      it("specific MCP rules override mcp catch-all", () => {
        const { manager, cleanup } = createManager(
          {
            permission: { "*": "ask" },
          },
          {
            reviewer: `---
name: reviewer
permission:
  mcp:
    "*": allow
    exa_web_search_exa: deny
---
`,
          },
          { mcpServerNames: ["exa"] },
        );

        try {
          const result = checkTool(
            manager,
            "mcp",
            { tool: "web_search_exa" },
            "reviewer",
          );
          expect(result.state).toBe("deny");
          expect(result.source).toBe("mcp");
          expect(result.matchedPattern).toBe("exa_web_search_exa");
          expect(result.target).toBe("exa_web_search_exa");
        } finally {
          cleanup();
        }
      });

      it("specific MCP rules still win when mcp catch-all is deny", () => {
        const { manager, cleanup } = createManager(
          {
            permission: { "*": "ask" },
          },
          {
            reviewer: `---
name: reviewer
permission:
  mcp:
    "*": deny
    exa_web_search_exa: allow
---
`,
          },
          { mcpServerNames: ["exa"] },
        );

        try {
          const allowed = checkTool(
            manager,
            "mcp",
            { tool: "web_search_exa" },
            "reviewer",
          );
          expect(allowed.state).toBe("allow");
          expect(allowed.source).toBe("mcp");
          expect(allowed.matchedPattern).toBe("exa_web_search_exa");
          expect(allowed.target).toBe("exa_web_search_exa");

          const fallback = checkTool(
            manager,
            "mcp",
            { tool: "other_exa" },
            "reviewer",
          );
          expect(fallback.state).toBe("deny");
          expect(fallback.source).toBe("mcp");
          expect(fallback.target).toBe("exa_other_exa");
        } finally {
          cleanup();
        }
      });
    });

    describe("last-match-wins across candidates", () => {
      // Every surface but `mcp` produces a single candidate, so `mcp` is the only
      // place where "which candidate" and "which rule" can disagree. A catch-all
      // written above a specific rule must not mask it: README.md publishes
      // last-match-wins for this surface.
      describe("the configuration.md example", () => {
        // docs/configuration.md publishes this exact config under `### `mcp` Surface`.
        const documentedConfig: FlatPermissionConfig = {
          mcp: {
            "*": "ask",
            mcp_status: "allow",
            mcp_list: "allow",
            "myServer:*": "ask",
            dangerousServer: "deny",
          },
        };
        const servers = ["myServer", "dangerousServer"];

        it("grants the documented mcp_list allow for a server listing", () => {
          const manager = createInMemoryGlobalManager(
            { permission: documentedConfig },
            servers,
          );
          const result = checkTool(manager, "mcp", { server: "myServer" });
          expect(result.state).toBe("allow");
          expect(result.matchedPattern).toBe("mcp_list");
        });

        it("enforces the documented dangerousServer deny for an explicit server", () => {
          const manager = createInMemoryGlobalManager(
            { permission: documentedConfig },
            servers,
          );
          const result = checkTool(manager, "mcp", {
            tool: "wipe",
            server: "dangerousServer",
          });
          expect(result.state).toBe("deny");
          expect(result.matchedPattern).toBe("dangerousServer");
        });
      });

      describe("a catch-all above a specific rule no longer masks it", () => {
        it("allows a discovery operation named after the catch-all", () => {
          // The shape reported in #687: the wildcard matches the tool-name
          // candidate before the `mcp_describe` candidate is ever reached.
          const manager = createInMemoryGlobalManager(
            {
              permission: { mcp: { "*": "ask", mcp_describe: "allow" } },
            },
            ["github"],
          );
          const result = checkTool(manager, "mcp", {
            describe: "github_list_issues",
          });
          expect(result.state).toBe("allow");
          expect(result.matchedPattern).toBe("mcp_describe");
        });

        it.each([
          ["a suffix-named tool", { tool: "search_code_github" }],
          ["a qualified tool name", { tool: "github:search_code" }],
          [
            "an explicit server argument",
            { tool: "search_code", server: "github" },
          ],
        ])("denies the named server for %s", (_label, input) => {
          const manager = createInMemoryGlobalManager(
            { permission: { mcp: { "*": "allow", github: "deny" } } },
            ["github"],
          );
          const result = checkTool(manager, "mcp", input);
          expect(result.state).toBe("deny");
          expect(result.matchedPattern).toBe("github");
        });
      });

      describe("rule position decides, not rule specificity", () => {
        // The control for the block above: `evaluateAnyValue` privileges where a
        // rule sits in the config, not how specific its pattern is. A catch-all
        // written last still wins, which is what last-match-wins means.
        it.each([
          ["a suffix-named tool", { tool: "search_code_github" }],
          ["a qualified tool name", { tool: "github:search_code" }],
          [
            "an explicit server argument",
            { tool: "search_code", server: "github" },
          ],
        ])(
          "lets a trailing catch-all override the server rule for %s",
          (_label, input) => {
            const manager = createInMemoryGlobalManager(
              { permission: { mcp: { github: "deny", "*": "ask" } } },
              ["github"],
            );
            const result = checkTool(manager, "mcp", input);
            expect(result.state).toBe("ask");
            expect(result.matchedPattern).toBe("*");
          },
        );
      });

      describe("session grants", () => {
        it("honors a session grant matching a later candidate than the config rule", () => {
          const manager = createInMemoryGlobalManager(
            { permission: { mcp: { exa_search: "deny" } } },
            ["exa"],
          );
          const result = checkTool(
            manager,
            "mcp",
            { tool: "exa_search" },
            undefined,
            [sessionRule("mcp", "mcp_call")],
          );
          expect(result.state).toBe("allow");
          expect(result.source).toBe("session");
        });
      });

      describe("baseline discovery auto-allow", () => {
        // `synthesizeBaseline` emits allow rules for the five `mcp_*` metadata
        // targets whenever any explicit mcp allow rule exists. Those rules sit
        // *before* the config layer, so a config rule matching any candidate
        // outranks them -- the attribution this pins.
        it("attributes a describe to the server rule once a candidate names it", () => {
          // Prefix derivation (#928) gives this call a `github` candidate, so the
          // config rule outranks the baseline. The decision is the same `allow`
          // the baseline already produced; only the attribution moved, and the
          // more specific reason is the better one to show.
          const manager = createInMemoryGlobalManager(
            { permission: { mcp: { github: "allow" } } },
            ["github"],
          );
          const result = checkTool(manager, "mcp", {
            describe: "github_search_code",
          });
          expect(result.state).toBe("allow");
          expect(result.matchedPattern).toBe("github");
        });

        it("still auto-allows a discovery operation no config rule can name", () => {
          // The baseline's own constituency: a granted server plus a describe of a
          // tool belonging to some *other*, unconfigured server. Nothing in the
          // config matches any candidate, so the baseline decides and reports no
          // `matchedPattern` -- only a config or session rule does.
          const manager = createInMemoryGlobalManager(
            { permission: { mcp: { github: "allow" } } },
            ["github"],
          );
          const result = checkTool(manager, "mcp", {
            describe: "unconfigured_server_tool",
          });
          expect(result.state).toBe("allow");
          expect(result.matchedPattern).toBeUndefined();
          expect(result.target).toBe("mcp_describe");
        });
      });
    });

    describe("Pi MCP tools", () => {
      function withManager<T>(
        permission: FlatPermissionConfig,
        use: (manager: PermissionManager) => T,
      ): T {
        const manager = createInMemoryGlobalManager({ permission }, [
          "danger-srv",
        ]);
        return use(manager);
      }

      describe("mcp__<server>__<tool> resolves on the mcp surface", () => {
        const toolName = "mcp__danger_srv__wipe";
        const wipe = (manager: PermissionManager): PermissionCheckResult =>
          checkTool(manager, toolName, { target: "prod" });

        function resolveWith(
          permission: FlatPermissionConfig,
          servers: readonly string[] = ["danger-srv"],
        ): PermissionCheckResult {
          const manager = createInMemoryGlobalManager({ permission }, servers);
          return wipe(manager);
        }

        it.each<[string, Record<string, PermissionState>, string]>([
          ["the configured spelling", { "danger-srv": "deny" }, "danger-srv"],
          ["Pi's spelling", { danger_srv: "deny" }, "danger_srv"],
          [
            "a server-qualified tool",
            { "danger-srv:wipe": "deny" },
            "danger-srv:wipe",
          ],
          [
            "the full Pi name",
            { "mcp__danger_srv__*": "deny" },
            "mcp__danger_srv__wipe",
          ],
        ])("denies on an mcp rule naming %s", (_label, rules, target) => {
          const result = resolveWith({
            "*": "allow",
            mcp: { "*": "allow", ...rules },
          });
          expect(result.state).toBe("deny");
          expect(result.source).toBe("mcp");
          expect(result.target).toBe(target);
          expect(result.toolName).toBe(toolName);
        });

        it("applies an mcp catch-all over the universal fallback", () => {
          const result = resolveWith({ "*": "ask", mcp: "allow" });
          expect(result.state).toBe("allow");
          expect(result.source).toBe("mcp");
        });

        it("falls back to the universal default when no mcp rule matches", () => {
          const result = resolveWith({ "*": "ask" });
          expect(result.state).toBe("ask");
          expect(result.source).toBe("default");
          expect(result.target).toBe("danger-srv_wipe");
        });

        it("derives Pi's spelling for a server no mcp.json names", () => {
          const result = resolveWith(
            { "*": "allow", mcp: { danger_srv: "deny" } },
            [],
          );
          expect(result.state).toBe("deny");
        });
      });

      describe("a top-level mcp__ key keeps applying to the Pi MCP tool it names", () => {
        const toolName = "mcp__danger_srv__wipe";
        const portNotice =
          'Top-level permission keys naming Pi MCP tools are applied as "mcp" rules: "mcp__danger_srv__wipe". ' +
          'Move them under "mcp" — see https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/migration/1001-pi-mcp-tools-on-mcp-surface.md';

        it.each<[string, FlatPermissionConfig]>([
          [
            "before",
            { "*": "allow", [toolName]: "deny", mcp: { "*": "allow" } },
          ],
          [
            "after",
            { "*": "allow", mcp: { "*": "allow" }, [toolName]: "deny" },
          ],
        ])(
          "denies when the key is written %s the mcp catch-all",
          (_order, config) => {
            withManager(config, (manager) => {
              const result = checkTool(manager, toolName, { target: "prod" });
              expect(result.state).toBe("deny");
              expect(result.matchedPattern).toBe(toolName);
              expect(result.source).toBe("mcp");
            });
          },
        );

        it("applies a wildcard key to every tool it names", () => {
          withManager(
            { "*": "allow", "mcp__danger_srv__*": "deny" },
            (manager) => {
              expect(checkTool(manager, toolName, {}).state).toBe("deny");
              expect(checkTool(manager, "mcp__other__x", {}).state).toBe(
                "allow",
              );
            },
          );
        });

        it("does not let a relocated allow open the proxy's discovery targets", () => {
          withManager({ "*": "ask", [toolName]: "allow" }, (manager) => {
            expect(checkTool(manager, toolName, {}).state).toBe("allow");
            expect(checkTool(manager, "mcp", {}).state).toBe("ask");
          });
        });

        it("asks the operator to port the key", () => {
          withManager({ "*": "allow", [toolName]: "deny" }, (manager) => {
            expect(manager.getPolicyIssues()).toEqual([portNotice]);
          });
        });

        it.each<[string, FlatPermissionConfig]>([
          ["an exact key", { "*": "allow", mcp__foo: "deny" }],
          ["a wildcard key", { "*": "allow", "mcp__*": "deny" }],
        ])(
          "still denies a non-Pi tool named mcp__foo through %s",
          (_label, config) => {
            withManager(config, (manager) => {
              expect(checkTool(manager, "mcp__foo", {}).state).toBe("deny");
              expect(manager.isToolFullyDenied("mcp__foo")).toBe(true);
            });
          },
        );

        it("raises no notice for a key that can name no Pi MCP tool", () => {
          withManager({ "*": "allow", mcp__foo: "deny" }, (manager) => {
            expect(manager.getPolicyIssues()).toEqual([]);
          });
        });

        it("raises no notice when no such key exists", () => {
          withManager(
            { "*": "allow", mcp: { "danger-srv": "deny" } },
            (manager) => {
              expect(manager.getPolicyIssues()).toEqual([]);
            },
          );
        });

        it("yields to a later scope's mcp catch-all", () => {
          const manager = createInMemoryManager(
            [
              {
                name: "global",
                config: { permission: { [toolName]: "allow" } },
                floorsWhenInvalid: false,
              },
              {
                name: "agent",
                agentName: "coder",
                config: { permission: { mcp: { "*": "deny" } } },
                floorsWhenInvalid: true,
              },
            ],
            ["danger-srv"],
          );
          const result = checkTool(manager, toolName, {}, "coder");
          expect(result.state).toBe("deny");
          expect(result.matchedPattern).toBe("*");
          expect(result.origin).toBe("agent");
        });
      });

      describe("tool exposure follows the mcp rules", () => {
        it("withholds a tool whose server an mcp rule denies, and only that server's", () => {
          withManager(
            { "*": "allow", mcp: { "danger-srv": "deny" } },
            (manager) => {
              expect(manager.isToolFullyDenied("mcp__danger_srv__wipe")).toBe(
                true,
              );
              expect(manager.getToolPermission("mcp__danger_srv__wipe")).toBe(
                "deny",
              );
              expect(manager.isToolFullyDenied("mcp__other__x")).toBe(false);
              expect(manager.getToolPermission("mcp__other__x")).toBe("allow");
            },
          );
        });

        it("withholds a tool a relocated top-level key denies", () => {
          withManager(
            { "*": "allow", "mcp__danger_srv__*": "deny" },
            (manager) => {
              expect(manager.isToolFullyDenied("mcp__danger_srv__wipe")).toBe(
                true,
              );
            },
          );
        });

        it("keeps a tool an exception after an mcp deny catch-all allows", () => {
          withManager(
            { "*": "allow", mcp: { "*": "deny", "danger-srv": "allow" } },
            (manager) => {
              expect(manager.isToolFullyDenied("mcp__danger_srv__wipe")).toBe(
                false,
              );
              expect(manager.isToolFullyDenied("mcp__other__x")).toBe(true);
            },
          );
        });
      });
    });

    describe("a forwarded request", () => {
      const config: FlatPermissionConfig = {
        "*": "ask",
        mcp: { github: "allow", danger: "deny" },
      };

      function serve(values: string[]): PermissionCheckResult {
        const manager = createInMemoryGlobalManager({ permission: config }, [
          "github",
          "danger",
        ]);
        return manager.check(
          buildResolvedIntentFromMatchValues("mcp", values, "Explore"),
        );
      }

      it("denies a target on a denied server rather than allowing the status probe", () => {
        const result = serve(["danger"]);
        expect(result.state).toBe("deny");
        expect(result.target).toBe("danger");
        expect(result.matchedPattern).toBe("danger");
      });

      it("asks for a target no rule names rather than allowing the status probe", () => {
        const result = serve(["danger_wipe"]);
        expect(result.state).toBe("ask");
        expect(result.target).toBe("danger_wipe");
      });
    });
  });

  describe("paths", () => {
    describe("injected path flavor", () => {
      const winAllow: Ruleset = [
        sessionRule("external_directory_read", "C:\\Users\\Foo\\pi\\*"),
      ];

      it("win32 manager folds case for path-surface matching", () => {
        const manager = createManagerFromPaths(
          {
            globalConfigPath: "/nonexistent/config.json",
            agentsDir: "/nonexistent/agents",
            mcpServerNames: [],
          },
          { flavor: win32PathFlavor },
        );
        const result = manager.check(
          {
            kind: "path-values",
            surface: "external_directory_read",
            values: ["c:\\users\\foo\\pi\\docs\\readme.md"],
          },
          winAllow,
        );
        expect(result.state).toBe("allow");
      });

      it("posix manager keeps path-surface matching case-sensitive", () => {
        const manager = createManagerFromPaths(
          {
            globalConfigPath: "/nonexistent/config.json",
            agentsDir: "/nonexistent/agents",
            mcpServerNames: [],
          },
          { flavor: posixPathFlavor },
        );
        const result = manager.check(
          {
            kind: "path-values",
            surface: "external_directory_read",
            values: ["c:\\users\\foo\\pi\\docs\\readme.md"],
          },
          winAllow,
        );
        expect(result.state).not.toBe("allow");
      });

      it("win32: a /tmp* allow rule suppresses a Git Bash /tmp path", async () => {
        // End to end: parse `ls /tmp` under win32, take the token's match values,
        // and confirm a natural `/tmp*` external_directory allow rule matches them.
        // The win32 matcher folds separators on both the rule and the value (#653),
        // so the as-typed literal resolves without a backslash match alias.
        const program = await BashProgram.parse(
          "ls /tmp",
          new PathNormalizer(win32PathFlavor, "C:/projects/app"),
        );
        const values = program.externalAccesses()[0].path.matchValues();
        const manager = createManagerFromPaths(
          {
            globalConfigPath: "/nonexistent/config.json",
            agentsDir: "/nonexistent/agents",
            mcpServerNames: [],
          },
          { flavor: win32PathFlavor },
        );

        const allowed = manager.check(
          { kind: "path-values", surface: "external_directory_read", values },
          [sessionRule("external_directory_read", "/tmp*")],
        );
        expect(allowed.state).toBe("allow");

        const noRule = manager.check(
          { kind: "path-values", surface: "external_directory_read", values },
          [],
        );
        expect(noRule.state).not.toBe("allow");
      });

      it("win32: a /dev/null path allow rule suppresses the Git Bash device prompt", async () => {
        // The reported repro: `echo hi > /dev/null` reaches the `path` surface with
        // the device spelled as typed, so a rule written the same way must win over
        // a preceding universal ask.
        const program = await BashProgram.parse(
          "echo hi > /dev/null",
          new PathNormalizer(win32PathFlavor, "C:\\projects\\app"),
        );
        const values = program.pathRuleCandidates()[0].path.matchValues();
        expect(values).toEqual(["/dev/null"]);

        const manager = createManagerFromPaths(
          {
            globalConfigPath: "/nonexistent/config.json",
            agentsDir: "/nonexistent/agents",
            mcpServerNames: [],
          },
          { flavor: win32PathFlavor },
        );

        const allowed = manager.check(
          { kind: "path-values", surface: "path_read", values },
          [
            sessionRule("path_read", "*", "ask"),
            sessionRule("path_read", "/dev/null"),
          ],
        );
        expect(allowed.state).toBe("allow");

        const askedWithoutRule = manager.check(
          { kind: "path-values", surface: "path_read", values },
          [sessionRule("path_read", "*", "ask")],
        );
        expect(askedWithoutRule.state).toBe("ask");
      });
    });

    describe("directional sugar", () => {
      it("expands a bare path rule onto both directional surfaces at load", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            "*": "ask",
            path: { "/secret/*": "deny" },
          },
        });
        for (const surface of ["path_read", "path_write"]) {
          const result = checkPath(manager, "/secret/x", {}, surface);
          expect(result.state).toBe("deny");
          expect(result.matchedPattern).toBe("/secret/*");
        }
        // Nothing survives on the bare surface — the fold is the read path.
        expect(checkPath(manager, "/secret/x", {}, "path").matchedPattern).toBe(
          undefined,
        );
      });

      it("appends an explicit directional rule after the sugar-derived ones", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            "*": "ask",
            external_directory: { "*": "ask" },
            external_directory_read: { "/dev-root/*": "allow" },
          },
        });
        expect(
          checkPath(manager, "/dev-root/x", {}, "external_directory_read")
            .state,
        ).toBe("allow");
        expect(
          checkPath(manager, "/dev-root/x", {}, "external_directory_write")
            .state,
        ).toBe("ask");
      });
    });

    describe("per-tool path patterns", () => {
      it("denies read of .env when path pattern matches", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            read: { "*": "allow", "*.env": "deny" },
          },
        });
        const result = checkPath(manager, ".env", {}, "read");
        expect(result.state).toBe("deny");
        expect(result.matchedPattern).toBe("*.env");
      });

      it("allows read of non-.env file when .env is denied", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            read: { "*": "allow", "*.env": "deny" },
          },
        });
        const result = checkPath(manager, "src/main.ts", {}, "read");
        expect(result.state).toBe("allow");
      });

      it("allows write to src/ when only src/ is allowed", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            write: { "*": "deny", "src/*": "allow" },
          },
        });
        const result = checkPath(manager, "src/main.ts", {}, "write");
        expect(result.state).toBe("allow");
        expect(result.matchedPattern).toBe("src/*");
      });

      it("denies write outside src/ when only src/ is allowed", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            write: { "*": "deny", "src/*": "allow" },
          },
        });
        const result = checkPath(manager, "vendor/lib.ts", {}, "write");
        expect(result.state).toBe("deny");
      });

      it("backward compat: 'read': 'allow' allows read of any path", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            read: "allow",
          },
        });
        const result = checkPath(manager, ".env", {}, "read");
        expect(result.state).toBe("allow");
      });

      it("backward compat: 'read': 'deny' denies read of any path", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            read: "deny",
          },
        });
        const result = checkPath(manager, "src/main.ts", {}, "read");
        expect(result.state).toBe("deny");
      });

      it("falls back to '*' when input.path is missing", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            read: { "*": "allow", "*.env": "deny" },
          },
        });
        const result = checkTool(manager, "read", {});
        expect(result.state).toBe("allow");
      });

      it("getToolPermission still returns surface-level state (not path-specific)", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            read: { "*": "allow", "*.env": "deny" },
          },
        });
        const toolState = manager.getToolPermission("read");
        expect(toolState).toBe("allow");
      });
    });

    describe("path surface", () => {
      it("denies .env via the path surface", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            path: { "*": "allow", "*.env": "deny" },
            read: "allow",
          },
        });
        const result = checkPath(manager, ".env");
        expect(result.state).toBe("deny");
        expect(result.matchedPattern).toBe("*.env");
      });

      it("allows non-matching paths via the path surface", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            path: { "*": "allow", "*.env": "deny" },
            read: "allow",
          },
        });
        const result = checkPath(manager, "README.md");
        expect(result.state).toBe("allow");
      });

      it("path surface does not interfere with per-tool rules", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            path: { "*": "allow" },
            read: { "*": "allow", "*.secret": "deny" },
          },
        });
        // path surface allows, per-tool denies
        const readResult = checkPath(manager, "data.secret", {}, "read");
        expect(readResult.state).toBe("deny");
        // path surface also allows
        const pathResult = checkPath(manager, "data.secret");
        expect(pathResult.state).toBe("allow");
      });

      it("getToolPermission('path') returns catch-all action", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            path: { "*": "allow", "*.env": "deny" },
          },
        });
        const toolState = manager.getToolPermission("path_read");
        expect(toolState).toBe("allow");
      });

      it("configs without path key behave identically (no path gate fires)", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            read: "allow",
          },
        });
        // path surface falls through to universal default
        const result = checkPath(manager, ".env");
        expect(result.state).toBe("ask");
      });

      it("universal default produces undefined matchedPattern for gate skip", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            "*": "ask",
            read: "allow",
            find: "allow",
          },
        });
        // No explicit "path" key → matchedPattern must be undefined so the
        // path gate skips (describePathGate returns null).
        const result = checkPath(manager, "src/main.ts");
        expect(result.state).toBe("ask");
        expect(result.matchedPattern).toBeUndefined();

        // Meanwhile the tool-level check should allow read.
        const readResult = checkPath(manager, "src/main.ts", {}, "read");
        expect(readResult.state).toBe("allow");
        expect(readResult.matchedPattern).toBe("*");
      });

      // ── Last-match-wins ordering ────────────────────────────────────────────

      it("last-match-wins: catch-all after deny overrides the deny", () => {
        // Classic misconfiguration: deny is before allow, so allow wins.
        const manager = createInMemoryGlobalManager({
          permission: {
            path: { "*.env": "deny", "*": "allow" },
          },
        });
        const result = checkPath(manager, ".env");
        // "*" is last and matches .env → allow (the deny is shadowed)
        expect(result.state).toBe("allow");
      });

      it("last-match-wins: deny after catch-all blocks the path", () => {
        // Correct ordering: catch-all first, specific deny after.
        const manager = createInMemoryGlobalManager({
          permission: {
            path: { "*": "allow", "*.env": "deny" },
          },
        });
        const result = checkPath(manager, ".env");
        expect(result.state).toBe("deny");
      });

      // ── .env.example override recipe ────────────────────────────────────────

      it(".env.example override: denies .env and .env.local, allows .env.example", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            path: {
              "*": "allow",
              "*.env": "deny",
              "*.env.*": "deny",
              "*.env.example": "allow",
            },
          },
        });
        expect(checkPath(manager, ".env").state).toBe("deny");
        expect(checkPath(manager, ".env.local").state).toBe("deny");
        expect(checkPath(manager, ".env.production").state).toBe("deny");
        expect(checkPath(manager, "src/.env").state).toBe("deny");
        expect(checkPath(manager, ".env.example").state).toBe("allow");
        expect(checkPath(manager, "README.md").state).toBe("allow");
      });

      // ── Universal fallback interaction ──────────────────────────────────────

      it("universal '*': 'allow' with no path key makes the path gate transparent", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            "*": "allow",
          },
        });
        const result = checkPath(manager, ".env");
        expect(result.state).toBe("allow");
      });

      it("universal '*': 'deny' with no path key denies via path surface too", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            "*": "deny",
          },
        });
        const result = checkPath(manager, ".env");
        expect(result.state).toBe("deny");
      });

      // ── Composition: path allows, per-tool denies ──────────────────────

      it("per-tool deny still blocks even when path surface allows", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            path: { "*": "allow" },
            read: "deny",
          },
        });
        // path gate passes (allow), but tool gate denies
        const pathResult = checkPath(manager, "secret.txt");
        expect(pathResult.state).toBe("allow");
        const readResult = checkPath(manager, "secret.txt", {}, "read");
        expect(readResult.state).toBe("deny");
      });
    });

    describe("home expansion", () => {
      describe("in path values", () => {
        it("~/... path value is denied by a ~/* rule (reported footgun)", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              path: { "*": "allow", "~/.ssh/*": "deny" },
            },
          });
          const result = checkPath(manager, "~/.ssh/config");
          expect(result.state).toBe("deny");
          expect(result.matchedPattern).toBe("~/.ssh/*");
        });

        it("$HOME/... path value is denied by a ~/* rule", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              path: { "*": "allow", "~/.ssh/*": "deny" },
            },
          });
          const result = checkPath(manager, `${homedir()}/.ssh/config`);
          expect(result.state).toBe("deny");
          expect(result.matchedPattern).toBe("~/.ssh/*");
        });

        it("$HOME/... path value matches a $HOME/* pattern rule", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              path: { "*": "allow", "$HOME/.ssh/*": "deny" },
            },
          });
          const result = checkPath(manager, "$HOME/.ssh/config");
          expect(result.state).toBe("deny");
          expect(result.matchedPattern).toBe("$HOME/.ssh/*");
        });

        it("already-absolute home path is still denied by ~/* rule", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              path: { "*": "allow", "~/.ssh/*": "deny" },
            },
          });
          const result = checkPath(manager, `${homedir()}/.ssh/config`);
          expect(result.state).toBe("deny");
        });

        it("non-home value is unchanged — .env still matches *.env", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              path: { "*": "allow", "*.env": "deny" },
            },
          });
          const result = checkPath(manager, ".env");
          expect(result.state).toBe("deny");
          expect(result.matchedPattern).toBe("*.env");
        });

        it("per-tool read surface denies ~/... path with a ~/* rule", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              "*": "allow",
              read: { "*": "allow", "~/.ssh/*": "deny" },
            },
          });
          const result = checkPath(manager, "~/.ssh/config", {}, "read");
          expect(result.state).toBe("deny");
          expect(result.matchedPattern).toBe("~/.ssh/*");
        });
      });

      describe("in external_directory rules", () => {
        it("~/glob pattern allows a path under the real home directory", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              "*": "ask",
              external_directory: { "~/trusted/*": "allow" },
            },
          });
          const result = checkPath(
            manager,
            join(homedir(), "trusted/repo"),
            {},
            "external_directory_read",
          );
          expect(result.state).toBe("allow");
          expect(result.source).toBe("special");
          expect(result.matchedPattern).toBe("~/trusted/*");
        });

        it("$HOME/glob pattern allows a path under the real home directory", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              "*": "ask",
              external_directory: { "$HOME/trusted/*": "allow" },
            },
          });
          const result = checkPath(
            manager,
            join(homedir(), "trusted/repo"),
            {},
            "external_directory_read",
          );
          expect(result.state).toBe("allow");
          expect(result.source).toBe("special");
          expect(result.matchedPattern).toBe("$HOME/trusted/*");
        });

        it("~/glob deny rule blocks a path under home", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              "*": "allow",
              external_directory: { "~/private/*": "deny" },
            },
          });
          const result = checkPath(
            manager,
            join(homedir(), "private/secrets.txt"),
            {},
            "external_directory_read",
          );
          expect(result.state).toBe("deny");
          expect(result.matchedPattern).toBe("~/private/*");
        });

        it("~/glob pattern does not match a path outside home", () => {
          const manager = createInMemoryGlobalManager({
            permission: {
              "*": "ask",
              external_directory: { "~/trusted/*": "allow" },
            },
          });
          const result = checkPath(
            manager,
            "/tmp/not-home/file",
            {},
            "external_directory_read",
          );
          // Falls back to the "*": "ask" default — no allow from the ~/trusted/* rule.
          expect(result.state).toBe("ask");
          expect(result.matchedPattern).toBeUndefined();
        });
      });
    });

    describe("external_directory config", () => {
      it("external_directory permission falls back to universal default when not explicitly configured", () => {
        const manager = createInMemoryGlobalManager({ permission: {} });
        const result = checkTool(manager, "external_directory_read", {});
        expect(result.state).toBe("ask");
        expect(result.source).toBe("special");
        expect(result.matchedPattern).toBe(undefined);
      });

      it("external_directory permission respects explicit deny", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "allow", external_directory: "deny" },
        });
        const result = checkTool(manager, "external_directory_read", {});
        expect(result.state).toBe("deny");
        expect(result.source).toBe("special");
        expect(result.matchedPattern).toBe("*");
      });

      it("external_directory permission can be explicitly allowed", () => {
        const manager = createInMemoryGlobalManager({
          permission: { "*": "allow", external_directory: "allow" },
        });
        const result = checkTool(manager, "external_directory_read", {});
        expect(result.state).toBe("allow");
        expect(result.source).toBe("special");
        expect(result.matchedPattern).toBe("*");
      });
    });

    describe("cwd-aware path values", () => {
      const cwd = "/workspace/project";

      it("matches a relative read input against an absolute allowlist", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            read: { "*": "ask", [`${cwd}/*`]: "allow" },
          },
        });
        manager.configureForCwd(cwd);
        const result = checkPath(manager, "src/App.jsx", { cwd }, "read");
        expect(result.state).toBe("allow");
        expect(result.matchedPattern).toBe(`${cwd}/*`);
      });

      it("keeps legacy relative path rules working after configureForCwd", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            read: { "*": "allow", "src/*": "deny" },
          },
        });
        manager.configureForCwd(cwd);
        const result = checkPath(manager, "src/App.jsx", { cwd }, "read");
        expect(result.state).toBe("deny");
        expect(result.matchedPattern).toBe("src/*");
      });

      it("preserves last-match-wins across absolute and relative aliases", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            read: {
              "*": "ask",
              [`${cwd}/*`]: "allow",
              "src/*": "deny",
            },
          },
        });
        manager.configureForCwd(cwd);
        const result = checkPath(manager, "src/App.jsx", { cwd }, "read");
        // The later "src/*" deny wins over the earlier absolute allow.
        expect(result.state).toBe("deny");
        expect(result.matchedPattern).toBe("src/*");
      });

      it("matches the cross-cutting path surface against absolute allowlists", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            path: { "*": "ask", [`${cwd}/*`]: "allow" },
          },
        });
        manager.configureForCwd(cwd);
        const result = checkPath(manager, "src/App.jsx", { cwd });
        expect(result.state).toBe("allow");
        expect(result.matchedPattern).toBe(`${cwd}/*`);
      });
    });

    describe("a path-values intent", () => {
      const cwd = "/workspace/project";

      it("evaluates precomputed policy values against the path surface", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            path: { "*": "ask", [`${cwd}/*`]: "allow" },
          },
        });
        const intent: ResolvedAccessIntent = {
          kind: "path-values",
          surface: "path_read",
          values: [`${cwd}/src/App.jsx`, "src/App.jsx"],
        };
        const result = manager.check(intent);
        expect(result.state).toBe("allow");
        expect(result.matchedPattern).toBe(`${cwd}/*`);
        expect(result.source).toBe("special");
        expect(result.toolName).toBe("path_read");
      });

      it("evaluates against the external_directory surface", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            external_directory: { "*": "ask", "/tmp/*": "allow" },
          },
        });
        const intent: ResolvedAccessIntent = {
          kind: "path-values",
          surface: "external_directory_read",
          values: ["/tmp/x"],
        };
        const result = manager.check(intent);
        expect(result.state).toBe("allow");
        expect(result.matchedPattern).toBe("/tmp/*");
        expect(result.source).toBe("special");
        expect(result.toolName).toBe("external_directory_read");
      });

      it("falls back to the catch-all for an empty value list", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            path: { "*": "deny" },
          },
        });
        const intent: ResolvedAccessIntent = {
          kind: "path-values",
          surface: "path_read",
          values: [],
        };
        const result = manager.check(intent);
        expect(result.state).toBe("deny");
        expect(result.matchedPattern).toBe("*");
      });

      it("applies session rules via the path-values intent", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            path: { "*": "ask", "src/*": "deny" },
          },
        });
        const sessionRules: Ruleset = [sessionRule("path_read", "src/*")];
        const intent: ResolvedAccessIntent = {
          kind: "path-values",
          surface: "path_read",
          values: ["src/App.jsx"],
        };
        const result = manager.check(intent, sessionRules);
        expect(result.state).toBe("allow");
        expect(result.source).toBe("session");
      });

      it("last-match-wins across the provided aliases", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            path: { "*": "ask", [`${cwd}/*`]: "allow", "src/*": "deny" },
          },
        });
        const intent: ResolvedAccessIntent = {
          kind: "path-values",
          surface: "path_read",
          values: [`${cwd}/src/App.jsx`, "src/App.jsx"],
        };
        const result = manager.check(intent);
        expect(result.state).toBe("deny");
        expect(result.matchedPattern).toBe("src/*");
      });

      it("does not apply an external_directory rule on the path surface", () => {
        const manager = createInMemoryGlobalManager({
          permission: {
            external_directory: { "*": "ask", "/tmp/*": "allow" },
            path: { "*": "allow" },
          },
        });
        const intent: ResolvedAccessIntent = {
          kind: "path-values",
          surface: "path_read",
          values: ["/tmp/x"],
        };
        const result = manager.check(intent);
        expect(result.toolName).toBe("path_read");
        expect(result.state).toBe("allow");
        expect(result.matchedPattern).toBe("*");
      });
    });
  });

  describe("config sources", () => {
    describe("agentDir and configureForCwd", () => {
      it("ScopedPermissionManager is exported and PermissionManager satisfies it", () => {
        // Type-level assertion: assigning PermissionManager to ScopedPermissionManager compiles.
        const manager = createManagerFromPaths({
          globalConfigPath: "/nonexistent/config.json",
          agentsDir: "/nonexistent/agents",
        });
        const scoped: ScopedPermissionManager = manager;
        expect(typeof scoped.configureForCwd).toBe("function");
        expect(typeof scoped.check).toBe("function");
        expect(typeof scoped.getToolPermission).toBe("function");
        expect(typeof scoped.isToolFullyDenied).toBe("function");
        expect(typeof scoped.getPolicyIssues).toBe("function");
      });

      it("construction with { agentDir } reads global config from getGlobalConfigPath(agentDir)", () => {
        const { agentDir, cleanup } = createAgentDirHarness({
          globalPermission: { read: "deny" },
        });
        try {
          const manager = new PermissionManager({ agentDir });
          const result = checkPath(manager, "foo.txt", {}, "read");
          expect(result.state).toBe("deny");
        } finally {
          cleanup();
        }
      });

      it("configureForCwd(cwd) applies project config (project overrides global)", () => {
        const { agentDir, cwd, cleanup } = createAgentDirHarness({
          globalPermission: { read: "deny" },
          projectPermission: { read: "allow" },
        });
        try {
          const manager = new PermissionManager({ agentDir });
          // Before configureForCwd: global policy applies
          expect(checkPath(manager, "foo.txt", {}, "read").state).toBe("deny");

          manager.configureForCwd(cwd);

          // After configureForCwd: project override applies (last-match-wins)
          expect(checkPath(manager, "foo.txt", {}, "read").state).toBe("allow");
        } finally {
          cleanup();
        }
      });

      it("configureForCwd(undefined) reverts to global-only", () => {
        const { agentDir, cwd, cleanup } = createAgentDirHarness({
          globalPermission: { read: "deny" },
          projectPermission: { read: "allow" },
        });
        try {
          const manager = new PermissionManager({ agentDir });
          manager.configureForCwd(cwd);
          expect(checkPath(manager, "foo.txt", {}, "read").state).toBe("allow");

          manager.configureForCwd(undefined);

          // After reverting: global policy applies again
          expect(checkPath(manager, "foo.txt", {}, "read").state).toBe("deny");
        } finally {
          cleanup();
        }
      });

      it("configureForCwd clears the resolved-permissions cache", () => {
        const { agentDir, globalConfigPath, cleanup } = createAgentDirHarness({
          globalPermission: { read: "allow" },
        });
        try {
          const manager = new PermissionManager({ agentDir });
          // Warm the cache
          expect(checkPath(manager, "foo.txt", {}, "read").state).toBe("allow");
          // Update global config on disk to deny read
          writeFileSync(
            globalConfigPath,
            JSON.stringify({ permission: { read: "deny" } }, null, 2),
          );
          // configureForCwd clears cache + rebuilds loader
          manager.configureForCwd(undefined);
          // Should pick up the changed global config
          expect(checkPath(manager, "foo.txt", {}, "read").state).toBe("deny");
        } finally {
          cleanup();
        }
      });

      it("configureForCwd(cwd) derives projectAgentsDir at <cwd>/.pi/agents", () => {
        // Bug: old code derived <cwd>/.pi/agent/agents instead of <cwd>/.pi/agents.
        // This test pins the correct path and verifies agentsDir is unchanged.
        const { agentDir, cwd, cleanup } = createAgentDirHarness({
          globalPermission: { read: "allow" },
        });
        try {
          const manager = new PermissionManager({ agentDir });
          manager.configureForCwd(cwd);
          const paths = manager.getResolvedPolicyPaths();
          expect(paths.map(({ name, path }) => [name, path])).toEqual([
            ["global", getGlobalConfigPath(agentDir)],
            ["project", getProjectConfigPath(cwd)],
            ["agent", join(agentDir, "agents")],
            ["project-agent", getProjectAgentsDir(cwd)],
          ]);
        } finally {
          cleanup();
        }
      });

      it("configureForCwd(cwd) enforces permission: frontmatter from <cwd>/.pi/agents/<agent>.md", () => {
        // Bug: wrong directory meant project-agent frontmatter was never loaded.
        const { agentDir, cwd, cleanup } = createAgentDirHarness({
          globalPermission: { read: "allow" },
        });
        try {
          // Write a project agent definition with a deny override.
          const projectAgentsDir = getProjectAgentsDir(cwd);
          mkdirSync(projectAgentsDir, { recursive: true });
          writeFileSync(
            join(projectAgentsDir, "coder.md"),
            "---\npermission:\n  read: deny\n---\n# Coder\n",
          );

          const manager = new PermissionManager({ agentDir });
          manager.configureForCwd(cwd);

          // Without an agent name: global allow applies.
          expect(checkPath(manager, "foo.txt", {}, "read").state).toBe("allow");
          // With the "coder" agent: project-agent deny overrides global allow.
          expect(checkPath(manager, "foo.txt", {}, "read", "coder").state).toBe(
            "deny",
          );
        } finally {
          cleanup();
        }
      });
    });

    describe("MCP server names", () => {
      const mcpCall = (
        manager: PermissionManager,
        tool: string,
      ): PermissionCheckResult =>
        manager.check({ kind: "tool", surface: "mcp", input: { tool } });

      it("derives a server configured only in the project's .pi/mcp.json once the cwd is set", () => {
        const { agentDir, cwd, cleanup } = createAgentDirHarness({
          globalPermission: {
            "*": "allow",
            mcp: { "*": "allow", github: "deny" },
          },
        });
        try {
          writeFileSync(
            join(cwd, ".pi", "mcp.json"),
            JSON.stringify({ mcpServers: { github: {} } }),
          );
          const manager = new PermissionManager({ agentDir });
          expect(mcpCall(manager, "github_search").state).toBe("allow");

          manager.configureForCwd(cwd);
          expect(mcpCall(manager, "github_search").state).toBe("deny");

          manager.configureForCwd(undefined);
          expect(mcpCall(manager, "github_search").state).toBe("allow");
        } finally {
          cleanup();
        }
      });

      it("reads the global mcp.json from the agentDir it was given", () => {
        const { agentDir, cleanup } = createAgentDirHarness({
          globalPermission: {
            "*": "allow",
            mcp: { "*": "allow", github: "deny" },
          },
        });
        try {
          writeFileSync(
            join(agentDir, "mcp.json"),
            JSON.stringify({ mcpServers: { github: {} } }),
          );
          const manager = new PermissionManager({ agentDir });
          expect(mcpCall(manager, "github_search").state).toBe("deny");
        } finally {
          cleanup();
        }
      });

      it("MCP server names in settings.json are not used — only mcp.json is consulted", () => {
        const baseDir = mkdtempSync(
          join(tmpdir(), "pi-permission-system-test-"),
        );
        const globalConfigPath = join(baseDir, "pi-permissions.jsonc");
        const mcpConfigPath = join(baseDir, "mcp.json");
        const settingsJsonPath = join(baseDir, "settings.json");
        const agentsDir = join(baseDir, "agents");
        mkdirSync(agentsDir, { recursive: true });

        const config: ScopeConfig = {
          permission: { "*": "ask", mcp: { "legacy-server_*": "allow" } },
        };

        writeFileSync(
          globalConfigPath,
          `${JSON.stringify(config, null, 2)}\n`,
          "utf8",
        );
        writeFileSync(
          mcpConfigPath,
          JSON.stringify({ mcpServers: {} }),
          "utf8",
        );
        writeFileSync(
          settingsJsonPath,
          JSON.stringify({ mcpServers: { "legacy-server": {} } }),
          "utf8",
        );

        const manager = createManagerFromPaths({
          globalConfigPath,
          agentsDir,
          globalMcpConfigPath: mcpConfigPath,
        });

        try {
          const result = checkTool(manager, "mcp", {
            tool: "some_tool_legacy-server",
          });
          expect(result.state).toBe("ask");
        } finally {
          rmSync(baseDir, { recursive: true, force: true });
        }
      });
    });

    describe("PI_CODING_AGENT_DIR", () => {
      it("reads config from PI_CODING_AGENT_DIR when set", () => {
        const baseDir = mkdtempSync(
          join(tmpdir(), "pi-permission-system-envdir-"),
        );
        const agentsDir = join(baseDir, "agents");
        const newConfigPath = getGlobalConfigPath(baseDir);
        mkdirSync(agentsDir, { recursive: true });
        mkdirSync(dirname(newConfigPath), { recursive: true });

        const config: ScopeConfig = {
          permission: { "*": "deny", read: "allow" },
        };
        writeFileSync(newConfigPath, JSON.stringify(config), "utf8");

        const original = process.env.PI_CODING_AGENT_DIR;
        process.env.PI_CODING_AGENT_DIR = baseDir;
        try {
          const manager = new PermissionManager();
          const result = checkTool(manager, "read", {});
          expect(result.state).toBe("allow");

          const result2 = checkTool(manager, "write", {});
          expect(result2.state).toBe("deny");
        } finally {
          if (original !== undefined) {
            process.env.PI_CODING_AGENT_DIR = original;
          } else {
            delete process.env.PI_CODING_AGENT_DIR;
          }
          rmSync(baseDir, { recursive: true, force: true });
        }
      });
    });

    describe("resolved policy paths", () => {
      it("getResolvedPolicyPaths returns correct paths and existence when files exist", () => {
        const tempDir = mkdtempSync(join(tmpdir(), "policy-paths-exist-"));
        try {
          const globalConfigPath = join(tempDir, "pi-permissions.jsonc");
          const agentsDir = join(tempDir, "agents");
          const projectConfigPath = join(
            tempDir,
            "project",
            "pi-permissions.jsonc",
          );
          const projectAgentsDir = join(tempDir, "project", "agents");

          writeFileSync(globalConfigPath, "{}", "utf-8");
          mkdirSync(agentsDir, { recursive: true });
          mkdirSync(join(tempDir, "project"), { recursive: true });
          writeFileSync(projectConfigPath, "{}", "utf-8");
          mkdirSync(projectAgentsDir, { recursive: true });

          const pm = createManagerFromPaths({
            globalConfigPath,
            agentsDir,
            projectGlobalConfigPath: projectConfigPath,
            projectAgentsDir,
          });

          expect(pm.getResolvedPolicyPaths()).toEqual([
            { name: "global", path: globalConfigPath, exists: true },
            { name: "project", path: projectConfigPath, exists: true },
            { name: "agent", path: agentsDir, exists: true },
            { name: "project-agent", path: projectAgentsDir, exists: true },
          ]);
        } finally {
          rmSync(tempDir, { recursive: true, force: true });
        }
      });

      it("getResolvedPolicyPaths returns false for missing files and null for absent project paths", () => {
        const tempDir = mkdtempSync(join(tmpdir(), "policy-paths-missing-"));
        try {
          const globalConfigPath = join(tempDir, "does-not-exist.jsonc");
          const agentsDir = join(tempDir, "no-agents");

          const pm = createManagerFromPaths({
            globalConfigPath,
            agentsDir,
          });

          expect(pm.getResolvedPolicyPaths()).toEqual([
            { name: "global", path: globalConfigPath, exists: false },
            { name: "project", path: null, exists: false },
            { name: "agent", path: agentsDir, exists: false },
            { name: "project-agent", path: null, exists: false },
          ]);
        } finally {
          rmSync(tempDir, { recursive: true, force: true });
        }
      });
    });
  });
});
