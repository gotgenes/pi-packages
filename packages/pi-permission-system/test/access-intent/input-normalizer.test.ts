import { afterEach, describe, expect, it, vi } from "vitest";

const mockHomedir = vi.hoisted(() => vi.fn(() => "/mock/home"));

vi.mock("node:os", () => ({
  homedir: mockHomedir,
  default: { homedir: mockHomedir },
}));

// Mock node:fs so realpathSync (used by the canonical alias) is controllable.
// Default implementation is identity — lexical tests are unaffected.
const realpathSync = vi.hoisted(() =>
  vi.fn<(path: string) => string>((p) => p),
);
vi.mock("node:fs", () => ({
  realpathSync,
  default: { realpathSync },
}));

import {
  buildAccessIntentForSurface,
  buildResolvedIntentFromMatchValues,
  normalizeInput,
} from "#src/access-intent/input-normalizer";
import { createMcpPermissionTargets } from "#src/access-intent/mcp-targets";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";

afterEach(() => {
  mockHomedir.mockClear();
  realpathSync.mockReset();
  realpathSync.mockImplementation((p: string) => p);
});

describe("normalizeInput — non-MCP surfaces", () => {
  // Path-bearing and special surfaces no longer derive path lookup values
  // through normalizeInput — that is now done by the access-path gate (#502)
  // and the service/RPC builder (#503). normalizeInput's tool branch collapses
  // every path-bearing or special surface to the catch-all ["*"] exactly as it
  // does for any unrecognised extension tool.
  describe("path-bearing and special surfaces collapse to '*'", () => {
    it("path surface ignores input.path and returns ['*']", () => {
      // After #504 removal: path no longer has a special branch.
      const result = normalizeInput("path", { path: ".env" }, []);
      expect(result.surface).toBe("path");
      expect(result.values).toEqual(["*"]);
      expect(result.resultExtras).toEqual({});
    });

    it("external_directory surface ignores input.path and returns ['*']", () => {
      const result = normalizeInput(
        "external_directory",
        { path: "/other/project" },
        [],
      );
      expect(result.surface).toBe("external_directory");
      expect(result.values).toEqual(["*"]);
      expect(result.resultExtras).toEqual({});
    });

    it("read surface ignores input.path and returns ['*']", () => {
      const result = normalizeInput("read", { path: ".env" }, []);
      expect(result.surface).toBe("read");
      expect(result.values).toEqual(["*"]);
      expect(result.resultExtras).toEqual({});
    });

    it("missing path also returns ['*'] (unchanged fallback)", () => {
      for (const surface of [
        "path",
        "external_directory",
        "read",
        "write",
        "edit",
        "grep",
        "find",
        "ls",
      ]) {
        const result = normalizeInput(surface, {}, []);
        expect(result.values).toEqual(["*"]);
      }
    });
  });

  describe("skill", () => {
    it("uses skill name from input.name", () => {
      const result = normalizeInput("skill", { name: "librarian" }, []);
      expect(result.surface).toBe("skill");
      expect(result.values).toEqual(["librarian"]);
      expect(result.resultExtras).toEqual({});
    });

    it("falls back to '*' when name is missing", () => {
      const result = normalizeInput("skill", {}, []);
      expect(result.values).toEqual(["*"]);
    });

    it("falls back to '*' when name is not a string", () => {
      const result = normalizeInput("skill", { name: 99 }, []);
      expect(result.values).toEqual(["*"]);
    });
  });

  describe("bash", () => {
    it("uses command from input.command", () => {
      const result = normalizeInput("bash", { command: "git status" }, []);
      expect(result.surface).toBe("bash");
      expect(result.values).toEqual(["git status"]);
      expect(result.resultExtras).toEqual({ command: "git status" });
    });

    it("uses empty string when command is missing", () => {
      const result = normalizeInput("bash", {}, []);
      expect(result.values).toEqual([""]);
      expect(result.resultExtras).toEqual({ command: "" });
    });

    it("uses empty string when command is not a string", () => {
      const result = normalizeInput("bash", { command: 42 }, []);
      expect(result.values).toEqual([""]);
      expect(result.resultExtras).toEqual({ command: "" });
    });

    it("strips leading comment lines from values but keeps original in resultExtras", () => {
      const cmd = "# Check debug logs\nfind /home -path '*debug*' -type f";
      const result = normalizeInput("bash", { command: cmd }, []);
      expect(result.values).toEqual(["find /home -path '*debug*' -type f"]);
      expect(result.resultExtras).toEqual({ command: cmd });
    });

    it("strips multiple comment lines", () => {
      const cmd = "# Step 1\n# Step 2\ngit status --short";
      const result = normalizeInput("bash", { command: cmd }, []);
      expect(result.values).toEqual(["git status --short"]);
    });

    it("preserves command when no comment lines present", () => {
      const result = normalizeInput(
        "bash",
        { command: "grep -rn foo src/" },
        [],
      );
      expect(result.values).toEqual(["grep -rn foo src/"]);
    });

    it("falls back to original when all lines are comments", () => {
      const cmd = "# just a comment";
      const result = normalizeInput("bash", { command: cmd }, []);
      expect(result.values).toEqual(["# just a comment"]);
    });
  });

  describe("extension tools (non-path-bearing)", () => {
    it("uses '*' as the lookup value for extension tools", () => {
      const result = normalizeInput("my_extension_tool", { some: "input" }, []);
      expect(result.surface).toBe("my_extension_tool");
      expect(result.values).toEqual(["*"]);
      expect(result.resultExtras).toEqual({});
    });

    it("uses '*' even when extension tool has a path field", () => {
      const result = normalizeInput(
        "my_extension_tool",
        { path: "/some/path" },
        [],
      );
      expect(result.values).toEqual(["*"]);
    });
  });
});

describe("normalizeInput — MCP surface", () => {
  it("surface is 'mcp'", () => {
    const result = normalizeInput("mcp", { tool: "exa:search" }, []);
    expect(result.surface).toBe("mcp");
  });

  it("values end with the catch-all 'mcp' target", () => {
    const result = normalizeInput("mcp", { tool: "exa:search" }, []);
    expect(result.values.at(-1)).toBe("mcp");
  });

  it("values include specific targets before the catch-all for a qualified tool call", () => {
    const result = normalizeInput("mcp", { tool: "exa:search" }, []);
    expect(result.values).toContain("exa_search");
    expect(result.values).toContain("exa:search");
    expect(result.values).toContain("exa");
    expect(result.values).toContain("mcp_call");
    // 'mcp' is always last
    expect(result.values.at(-1)).toBe("mcp");
  });

  it("matches createMcpPermissionTargets output + 'mcp' appended", () => {
    const rawTargets = createMcpPermissionTargets({ tool: "exa:search" }, [
      "exa",
    ]);
    const result = normalizeInput("mcp", { tool: "exa:search" }, ["exa"]);
    expect(result.values).toEqual([...rawTargets, "mcp"]);
  });

  it("resultExtras.target is the first specific target (most-specific)", () => {
    const result = normalizeInput("mcp", { tool: "exa:search" }, []);
    expect(result.resultExtras.target).toBe(result.values[0]);
  });

  it("resultExtras.target is 'mcp' when no specific targets are derived", () => {
    // Empty input → only mcp_status then mcp appended
    const result = normalizeInput("mcp", {}, []);
    expect(result.resultExtras.target).toBe("mcp_status");
  });

  it("values contain no duplicates", () => {
    const result = normalizeInput("mcp", { tool: "exa:search" }, ["exa"]);
    const unique = [...new Set(result.values)];
    expect(result.values).toEqual(unique);
  });

  it("produces mcp_status + mcp for status input", () => {
    const result = normalizeInput("mcp", {}, []);
    expect(result.values).toEqual(["mcp_status", "mcp"]);
  });

  it("produces connect targets + mcp for connect input", () => {
    const result = normalizeInput("mcp", { connect: "exa" }, []);
    expect(result.values).toContain("mcp_connect_exa");
    expect(result.values).toContain("mcp_connect");
    expect(result.values.at(-1)).toBe("mcp");
  });
});

describe("buildAccessIntentForSurface", () => {
  const normalizer = new PathNormalizer(posixPathFlavor, "/test/project");

  it("emits an access-path intent carrying the canonical alias for the path surface", () => {
    realpathSync.mockImplementation((p: string) =>
      p === "/test/project/link" ? "/test/project/real" : p,
    );
    const intent = buildAccessIntentForSurface(
      "path",
      "link",
      normalizer,
      undefined,
    );
    expect(intent.kind).toBe("access-path");
    if (intent.kind === "access-path") {
      expect(intent.surface).toBe("path");
      expect(intent.path.matchValues()).toContain("/test/project/real");
      expect(intent.path.value()).toBe("/test/project/link");
    }
  });

  it("emits an access-path intent for the external_directory surface", () => {
    const intent = buildAccessIntentForSurface(
      "external_directory",
      "/outside/dir",
      normalizer,
      undefined,
    );
    expect(intent.kind).toBe("access-path");
    if (intent.kind === "access-path") {
      expect(intent.surface).toBe("external_directory");
      expect(intent.path.value()).toBe("/outside/dir");
    }
  });

  it("emits an access-path intent for a path-bearing tool surface (read)", () => {
    const intent = buildAccessIntentForSurface(
      "read",
      "/test/project/.env",
      normalizer,
      undefined,
    );
    expect(intent.kind).toBe("access-path");
    if (intent.kind === "access-path") {
      expect(intent.surface).toBe("read");
      expect(intent.path.value()).toBe("/test/project/.env");
    }
  });

  it("emits a tool intent for a non-path surface (bash)", () => {
    const intent = buildAccessIntentForSurface(
      "bash",
      "echo hi",
      normalizer,
      "my-agent",
    );
    expect(intent).toEqual({
      kind: "tool",
      surface: "bash",
      input: { command: "echo hi" },
      agentName: "my-agent",
    });
  });

  it("passes agentName through on the access-path branch", () => {
    const intent = buildAccessIntentForSurface(
      "path",
      "/some/file",
      normalizer,
      "Explore",
    );
    expect(intent.agentName).toBe("Explore");
  });

  it("falls back to a tool intent for a value-less path surface", () => {
    const intent = buildAccessIntentForSurface(
      "path",
      undefined,
      normalizer,
      undefined,
    );
    expect(intent.kind).toBe("tool");
    if (intent.kind === "tool") {
      expect(intent.surface).toBe("path");
    }
  });

  it("falls back to a tool intent for a whitespace-only path value", () => {
    const intent = buildAccessIntentForSurface(
      "external_directory",
      "   ",
      normalizer,
      undefined,
    );
    expect(intent.kind).toBe("tool");
  });
});

describe("buildResolvedIntentFromMatchValues", () => {
  // The forwarded-serving wire's sole producer of a pre-fixed ResolvedAccessIntent
  // (#597): match values arrive already fixed at the child (matchValues()), so
  // this never touches a PathNormalizer or rebuilds an AccessPath.
  it("emits a path-values intent carrying the given match values as-is for the path surface", () => {
    const intent = buildResolvedIntentFromMatchValues(
      "path",
      ["/worktree/issue-42/src/foo.ts", "src/foo.ts", "/main/src/foo.ts"],
      "Explore",
    );
    expect(intent).toEqual({
      kind: "path-values",
      surface: "path",
      values: [
        "/worktree/issue-42/src/foo.ts",
        "src/foo.ts",
        "/main/src/foo.ts",
      ],
      agentName: "Explore",
    });
  });

  it("emits a path-values intent for the external_directory surface", () => {
    const intent = buildResolvedIntentFromMatchValues(
      "external_directory",
      ["/tmp/x", "/real/tmp/x"],
      "Explore",
    );
    expect(intent).toEqual({
      kind: "path-values",
      surface: "external_directory",
      values: ["/tmp/x", "/real/tmp/x"],
      agentName: "Explore",
    });
  });

  it("emits a tool intent from the single portable value for a non-path surface (bash)", () => {
    const intent = buildResolvedIntentFromMatchValues(
      "bash",
      ["git status"],
      "Explore",
    );
    expect(intent).toEqual({
      kind: "tool",
      surface: "bash",
      input: { command: "git status" },
      agentName: "Explore",
    });
  });

  it("emits a tool intent from the single portable value for a skill surface", () => {
    const intent = buildResolvedIntentFromMatchValues(
      "skill",
      ["librarian"],
      "Explore",
    );
    expect(intent).toEqual({
      kind: "tool",
      surface: "skill",
      input: { name: "librarian" },
      agentName: "Explore",
    });
  });

  it("threads an empty agentName through for agent-neutral resolution", () => {
    const intent = buildResolvedIntentFromMatchValues("bash", ["ls"], "");
    expect(intent.agentName).toBe("");
  });
});
