import { afterEach, describe, expect, it, vi } from "vitest";

const mockHomedir = vi.hoisted(() => vi.fn(() => "/mock/home"));

vi.mock("node:os", () => ({
  homedir: mockHomedir,
  default: { homedir: mockHomedir },
}));

// Mock node:fs so realpathSync (used by the canonical alias) is controllable.
// Default implementation is identity — lexical tests are unaffected.
const realpathSync = vi.hoisted(() => {
  const fn = vi.fn<(path: string) => string>((p) => p);
  // `native` is the same spy, so the POSIX canonicalizer is controlled too.
  return Object.assign(fn, { native: fn });
});
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    realpathSync,
    default: { ...actual, realpathSync },
  };
});

import {
  buildAccessIntentForSurface,
  buildResolvedIntentFromMatchValues,
  normalizeBashCommand,
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

  describe("normalizeBashCommand: a command's spellings", () => {
    it("matches the typed command and each spelling as aliases, keeping the typed one as the command", () => {
      expect(normalizeBashCommand("~/bin/x --y", ["/h/bin/x --y"])).toEqual({
        surface: "bash",
        values: ["~/bin/x --y", "/h/bin/x --y"],
        resultExtras: { command: "~/bin/x --y" },
      });
    });

    it("drops a spelling identical to the typed command", () => {
      expect(normalizeBashCommand("/h/x", ["/h/x"]).values).toEqual(["/h/x"]);
    });

    it("strips comment lines from the typed command but not from a spelling", () => {
      const cmd = "# why\n~/bin/x";
      expect(normalizeBashCommand(cmd, ["# kept\n/h/bin/x"])).toEqual({
        surface: "bash",
        values: ["~/bin/x", "# kept\n/h/bin/x"],
        resultExtras: { command: cmd },
      });
    });

    it("is what the bash tool input normalizes through, with no spellings", () => {
      expect(normalizeInput("bash", { command: "ls" }, [])).toEqual(
        normalizeBashCommand("ls", []),
      );
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

  // `evaluateAnyValue` is the sole multi-value evaluator (#928). That is only
  // sound because `mcp` is the one surface producing more than one candidate:
  // everywhere else the list has a single element, where a last-match-wins scan
  // across candidates and a first-non-default scan across them cannot differ.
  // The claim is structural — `normalizeInput`'s switch is exhaustive over
  // `ToolKind` — so it is pinned here rather than inferred from a green suite.
  describe("candidate count per surface", () => {
    it.each([
      ["skill", "skill", { name: "my-skill" }],
      ["bash", "bash", { command: "ls -la" }],
      ["path-bearing tool", "read", { path: ".env" }],
      ["extension tool", "my_extension_tool", { some: "input" }],
    ])(
      "a %s call produces exactly one candidate",
      (_label, toolName, input) => {
        const result = normalizeInput(toolName, input, ["exa"]);
        expect(result.values).toHaveLength(1);
      },
    );

    it("an mcp call produces more than one candidate", () => {
      const result = normalizeInput("mcp", { tool: "exa_search" }, ["exa"]);
      expect(result.values.length).toBeGreaterThan(1);
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

describe("normalizeInput — a Pi MCP tool (mcp__<server>__<tool>)", () => {
  it("resolves on the mcp surface under the Pi-name candidates, then 'mcp'", () => {
    expect(
      normalizeInput("mcp__danger_srv__wipe", { target: "prod" }, [
        "danger-srv",
      ]),
    ).toEqual({
      surface: "mcp",
      values: [
        "danger-srv_wipe",
        "danger-srv:wipe",
        "danger-srv",
        "danger_srv_wipe",
        "danger_srv:wipe",
        "danger_srv",
        "wipe",
        "mcp__danger_srv__wipe",
        "mcp_call",
        "mcp",
      ],
      resultExtras: { target: "danger-srv_wipe" },
    });
  });

  it("ignores the tool's input, which is the MCP arguments", () => {
    expect(
      normalizeInput(
        "mcp__srv__x",
        { tool: "other:thing", server: "other" },
        [],
      ).values,
    ).toEqual(["srv_x", "srv:x", "srv", "x", "mcp__srv__x", "mcp_call", "mcp"]);
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

  it("resolves a built-in tool surface's value to the file the tool opens", () => {
    const intent = buildAccessIntentForSurface(
      "read",
      "file:///test/project/.env",
      normalizer,
      undefined,
    );
    expect(intent.kind === "access-path" && intent.path.value()).toBe(
      "/test/project/.env",
    );
  });

  it("keeps the path surface's value as typed", () => {
    const intent = buildAccessIntentForSurface(
      "path",
      "file:///test/project/.env",
      normalizer,
      undefined,
    );
    expect(intent.kind === "access-path" && intent.path.value()).toBe(
      "/test/project/file:/test/project/.env",
    );
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

describe("a value-bearing mcp query evaluates its value as-is", () => {
  // Building `{}` for an mcp value derives only the status probe
  // `mcp_status`, which the MCP baseline allows whenever any mcp allow exists,
  // so a forwarded or service mcp query must carry its own value instead.
  const normalizer = new PathNormalizer(posixPathFlavor, "/test/project");

  it("serves a forwarded mcp request from its child-fixed values", () => {
    expect(
      buildResolvedIntentFromMatchValues("mcp", ["danger_wipe"], "Explore"),
    ).toEqual({
      kind: "path-values",
      surface: "mcp",
      values: ["danger_wipe"],
      agentName: "Explore",
    });
  });

  it("answers a service mcp query from the value it names", () => {
    expect(
      buildAccessIntentForSurface("mcp", "danger", normalizer, "Explore"),
    ).toEqual({
      kind: "path-values",
      surface: "mcp",
      values: ["danger"],
      agentName: "Explore",
    });
  });

  it("keeps a value-less mcp query on the tool intent", () => {
    expect(
      buildAccessIntentForSurface("mcp", undefined, normalizer, "Explore"),
    ).toEqual({
      kind: "tool",
      surface: "mcp",
      input: {},
      agentName: "Explore",
    });
  });
});
