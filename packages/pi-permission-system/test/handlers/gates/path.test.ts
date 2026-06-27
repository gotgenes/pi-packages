import { describe, expect, it } from "vitest";

import type { GateDescriptor } from "#src/handlers/gates/descriptor";
import { isGateDescriptor } from "#src/handlers/gates/descriptor";
import { describePathGate } from "#src/handlers/gates/path";
import type { ToolCallContext } from "#src/handlers/gates/types";

import {
  makeGateCheckResult as makeCheckResult,
  makeResolver,
} from "#test/helpers/gate-fixtures";

// ── helpers ────────────────────────────────────────────────────────────────

// path.test.ts uses read-tool defaults; the shared makeTcc uses bash defaults.
function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "read",
    agentName: null,
    input: { path: ".env" },
    toolCallId: "tc-1",
    cwd: "/test/project",
    ...overrides,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("describePathGate", () => {
  it("returns null for non-path-bearing tools", async () => {
    const resolver = makeResolver();
    const result = await describePathGate(
      makeTcc({ toolName: "bash", input: { command: "ls" } }),
      resolver,
    );
    expect(result).toBeNull();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it("returns null when tool has no extractable path", async () => {
    const resolver = makeResolver();
    const result = await describePathGate(
      makeTcc({ toolName: "read", input: {} }),
      resolver,
    );
    expect(result).toBeNull();
  });

  it("returns null when path check result is allow", async () => {
    const resolver = makeResolver(makeCheckResult({ state: "allow" }));
    const result = await describePathGate(makeTcc(), resolver);
    expect(result).toBeNull();
  });

  it("returns null when matchedPattern is undefined (universal default)", async () => {
    const resolver = makeResolver(
      makeCheckResult({
        state: "ask",
        matchedPattern: undefined,
        source: "special",
        origin: "builtin",
      }),
    );
    const result = await describePathGate(makeTcc(), resolver);
    expect(result).toBeNull();
  });

  it("returns GateDescriptor when matchedPattern is defined (explicit path rule)", async () => {
    const resolver = makeResolver(
      makeCheckResult({
        state: "ask",
        matchedPattern: "*.env",
        source: "special",
        origin: "global",
      }),
    );
    const result = await describePathGate(makeTcc(), resolver);
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
  });

  it("returns GateDescriptor when path check result is deny", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "deny", matchedPattern: "*.env" }),
    );
    const result = await describePathGate(makeTcc(), resolver);
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.surface).toBe("path");
    expect(desc.preCheck?.state).toBe("deny");
  });

  it("returns GateDescriptor when path check result is ask", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "ask", matchedPattern: "*.env" }),
    );
    const result = await describePathGate(makeTcc(), resolver);
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.surface).toBe("path");
    expect(desc.preCheck?.state).toBe("ask");
  });

  it("descriptor has correct session approval surface and pattern", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "ask", matchedPattern: "*" }),
    );
    const result = await describePathGate(
      makeTcc({ input: { path: "/test/project/src/.env" } }),
      resolver,
    ) as GateDescriptor;
    expect(result.sessionApproval).toBeDefined();
    expect(result.sessionApproval?.surface).toBe("path");
    expect(result.sessionApproval?.representativePattern).toBeDefined();
  });

  it("binds a current-directory file's session approval to the cwd subtree", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "ask", matchedPattern: "*" }),
    );
    const result = await describePathGate(
      makeTcc({ input: { path: "index.html" }, cwd: "/test/project" }),
      resolver,
    ) as GateDescriptor;
    expect(result.sessionApproval?.surface).toBe("path");
    expect(result.sessionApproval?.representativePattern).toBe(
      "/test/project/*",
    );
  });

  it("descriptor denialContext references the file path and tool name", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "deny", matchedPattern: "*.env" }),
    );
    const result = await describePathGate(makeTcc(), resolver) as GateDescriptor;
    expect(result.denialContext).toEqual({
      kind: "path",
      toolName: "read",
      pathValue: ".env",
      agentName: undefined,
    });
  });

  it("descriptor decision uses surface 'path' and the file path as value", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "deny", matchedPattern: "*.env" }),
    );
    const result = await describePathGate(makeTcc(), resolver) as GateDescriptor;
    expect(result.decision.surface).toBe("path");
    expect(result.decision.value).toBe(".env");
  });

  it("resolves the path surface with the file path and agent name", async () => {
    const resolver = makeResolver(makeCheckResult({ state: "allow" }));
    await describePathGate(makeTcc({ agentName: "my-agent" }), resolver);
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "path",
      input: { path: ".env" },
      agentName: "my-agent",
    });
  });
});

// Home-relative path characterization (#350) ──────────────────────────────
//
// The gate passes the raw path to the resolver; home expansion is handled
// downstream by normalizeInput. These tests lock in that the gate works
// correctly when the tool input contains a ~/... or $HOME/... path.

describe("describePathGate — home-relative paths", () => {
  it("passes raw ~/... path to resolver and builds descriptor on deny", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "deny", matchedPattern: "~/.ssh/*" }),
    );
    const result = await describePathGate(
      makeTcc({ input: { path: "~/.ssh/config" } }),
      resolver,
    ) as GateDescriptor;

    expect(isGateDescriptor(result)).toBe(true);
    expect(result.preCheck?.state).toBe("deny");
    // Raw path preserved in denial context for display.
    expect(result.denialContext).toMatchObject({
      kind: "path",
      toolName: "read",
      pathValue: "~/.ssh/config",
    });
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "path",
      input: { path: "~/.ssh/config" },
      agentName: undefined,
    });
  });

  it("passes raw $HOME/... path to resolver and builds descriptor on deny", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "deny", matchedPattern: "$HOME/.ssh/*" }),
    );
    const result = await describePathGate(
      makeTcc({ input: { path: "$HOME/.ssh/config" } }),
      resolver,
    ) as GateDescriptor;

    expect(isGateDescriptor(result)).toBe(true);
    expect(result.preCheck?.state).toBe("deny");
    expect(result.denialContext).toMatchObject({
      kind: "path",
      pathValue: "$HOME/.ssh/config",
    });
  });

  it("returns null when home-relative path resolves to allow", async () => {
    const resolver = makeResolver(makeCheckResult({ state: "allow" }));
    const result = await describePathGate(
      makeTcc({ input: { path: "~/.ssh/config" } }),
      resolver,
    );
    expect(result).toBeNull();
  });
});

// Extension and MCP tools are now path-gated (#352) ──────────────────────────

describe("describePathGate — extension and MCP tools (#352)", () => {
  function extractorLookup(toolName: string, key: string) {
    return {
      get: (name: string) =>
        name === toolName
          ? (input: Record<string, unknown>) =>
              typeof input[key] === "string" ? input[key] : undefined
          : undefined,
    };
  }

  it("gates an extension tool that exposes input.path", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "deny", matchedPattern: "*.env" }),
    );
    const result = await describePathGate(
      makeTcc({ toolName: "my-ext", input: { path: ".env" } }),
      resolver,
    );
    expect(isGateDescriptor(result)).toBe(true);
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "path",
      input: { path: ".env" },
      agentName: undefined,
    });
  });

  it("gates an MCP tool via arguments.path", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "deny", matchedPattern: "*.env" }),
    );
    const result = await describePathGate(
      makeTcc({ toolName: "mcp", input: { arguments: { path: ".env" } } }),
      resolver,
    );
    expect(isGateDescriptor(result)).toBe(true);
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "path",
      input: { path: ".env" },
      agentName: undefined,
    });
  });

  it("uses a registered extractor's path for a custom-shaped tool", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "deny", matchedPattern: "*" }),
    );
    await describePathGate(
      makeTcc({ toolName: "ffgrep", input: { target: "/etc/passwd" } }),
      resolver,
      extractorLookup("ffgrep", "target"),
    );
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "path",
      input: { path: "/etc/passwd" },
      agentName: undefined,
    });
  });

  it("returns null for an extension tool without a path", async () => {
    const resolver = makeResolver();
    const result = await describePathGate(
      makeTcc({ toolName: "my-ext", input: { other: true } }),
      resolver,
    );
    expect(result).toBeNull();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
});
