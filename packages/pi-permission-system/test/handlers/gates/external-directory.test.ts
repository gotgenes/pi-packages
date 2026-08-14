import { describe, expect, it } from "vitest";

import { highlightOccurrences } from "#src/authority/permission-prompt-component";
import type {
  GateBypass,
  GateDescriptor,
} from "#src/handlers/gates/descriptor";
import { isGateBypass, isGateDescriptor } from "#src/handlers/gates/descriptor";
import { describeExternalDirectoryGate } from "#src/handlers/gates/external-directory";
import type { ToolCallContext } from "#src/handlers/gates/types";
import { pathFlavorForPlatform } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import type { ToolAccessExtractorLookup } from "#src/tool-access-extractor-registry";
import { makeResolver } from "#test/helpers/gate-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

// ── helpers ───────────────────────────��────────────────────────────��───────

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "read",
    agentName: null,
    input: { path: "/outside/project/file.ts" },
    toolCallId: "tc-1",
    cwd: "/test/project",
    ...overrides,
  };
}

// Default resolver for descriptor-shape tests that do not assert the resolved
// state: returns `ask` for the external_directory surface so a descriptor is
// produced. Tests that assert the typed+resolved matching pass an explicit
// resolver to `describeExternalDirectoryGate` directly.
function gateUnderTest(
  tcc: ToolCallContext,
  infraDirs: string[],
  extractors?: ToolAccessExtractorLookup,
  resolver: ScopedPermissionResolver = makeResolver(
    makeCheckResult({ state: "ask", toolName: "external_directory" }),
  ),
) {
  return describeExternalDirectoryGate(
    tcc,
    infraDirs,
    resolver,
    new PathNormalizer(pathFlavorForPlatform(process.platform), tcc.cwd),
    extractors,
  );
}

// ── tests ────────────────────��────────────────────────────────────��────────

describe("describeExternalDirectoryGate", () => {
  it("returns null when tool is not path-bearing", () => {
    const result = gateUnderTest(
      makeTcc({ toolName: "bash", input: { command: "ls" } }),
      ["/test/agent"],
    );
    expect(result).toBeNull();
  });

  it("returns null when path is inside CWD", () => {
    const result = gateUnderTest(
      makeTcc({ input: { path: "/test/project/src/index.ts" } }),
      ["/test/agent"],
    );
    expect(result).toBeNull();
  });

  // ── Pi infrastructure read bypass ─────────────────���────────────────────

  it("returns GateBypass for read targeting an infra dir", () => {
    const result = gateUnderTest(
      makeTcc({
        toolName: "read",
        input: { path: "/test/agent/git/some-package/SKILL.md" },
      }),
      ["/test/agent", "/test/agent/git"],
    );
    expect(result).not.toBeNull();
    expect(isGateBypass(result)).toBe(true);
    const bypass = result as GateBypass;
    expect(bypass.action).toBe("allow");
    expect(bypass.decision).toMatchObject({
      resolution: "infrastructure_auto_allowed",
      result: "allow",
    });
    expect(bypass.log).toMatchObject({
      event: "permission_request.infrastructure_auto_allowed",
    });
  });

  it("returns GateBypass respecting custom infraDirs", () => {
    const result = gateUnderTest(
      makeTcc({
        toolName: "read",
        input: { path: "/custom/infra/SKILL.md" },
      }),
      ["/custom/infra"],
    );
    expect(isGateBypass(result)).toBe(true);
  });

  it("does NOT bypass for write tools targeting infra dirs", () => {
    const result = gateUnderTest(
      makeTcc({
        toolName: "write",
        input: { path: "/test/agent/git/some-file.ts", content: "x" },
      }),
      ["/test/agent", "/test/agent/git"],
    );
    // Should be a GateDescriptor (needs permission check), not a bypass
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
  });

  // ── GateDescriptor for external paths ─────────────────────────────────��

  it("returns GateDescriptor with surface 'external_directory'", () => {
    const result = gateUnderTest(makeTcc(), ["/test/agent"]);
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.surface).toBe("external_directory");
  });

  it("decision value is the external path", () => {
    const result = gateUnderTest(
      makeTcc({ input: { path: "/outside/project/file.ts" } }),
      ["/test/agent"],
    ) as GateDescriptor;
    expect(result.decision.value).toBe("/outside/project/file.ts");
    expect(result.decision.surface).toBe("external_directory");
  });

  it("carries the child-fixed access facts on promptDetails (external_directory surface)", () => {
    const path = "/outside/project/file.ts";
    const result = gateUnderTest(makeTcc({ input: { path } }), [
      "/test/agent",
    ]) as GateDescriptor;
    const accessPath = new PathNormalizer(
      pathFlavorForPlatform(process.platform),
      "/test/project",
    ).forPath(path);
    expect(result.promptDetails.accessIntent).toEqual({
      surface: "external_directory",
      matchValues: accessPath.matchValues(),
      boundaryValue: accessPath.boundaryValue(),
    });
    expect(result.promptDetails.highlightText).toBe(path);
    expect(
      highlightOccurrences(
        result.promptDetails.message,
        result.promptDetails.highlightText!,
        (text) => `<warning>${text}</warning>`,
      ),
    ).toBe(
      "Current agent requested tool 'read' for path " +
        "'<warning>/outside/project/file.ts</warning>' outside working " +
        "directory '/test/project'. Allow this external directory access?",
    );
  });

  it("carries a precomputed preCheck and an empty input (matching is done by the gate)", () => {
    const result = gateUnderTest(
      makeTcc({ input: { path: "/outside/project/file.ts" } }),
      ["/test/agent"],
    ) as GateDescriptor;
    expect(result.input).toEqual({});
    expect(result.preCheck).toBeDefined();
    expect(result.preCheck?.state).toBe("ask");
  });

  it("resolves the typed and symlink-resolved aliases on the external_directory surface (#418)", () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "ask", toolName: "external_directory" }),
    );
    gateUnderTest(
      makeTcc({ input: { path: "/outside/project/file.ts" } }),
      ["/test/agent"],
      undefined,
      resolver,
    );
    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "access-path",
        surface: "external_directory",
        agentName: undefined,
      }),
    );
    const intent = resolver.resolve.mock.calls[0][0];
    expect(intent.kind).toBe("access-path");
    if (intent.kind === "access-path") {
      expect(intent.path.matchValues()).toEqual(["/outside/project/file.ts"]);
    }
  });

  it("sessionApproval uses deriveApprovalPattern", () => {
    const result = gateUnderTest(
      makeTcc({ input: { path: "/outside/project/file.ts" } }),
      ["/test/agent"],
    ) as GateDescriptor;
    expect(result.sessionApproval).toBeDefined();
    expect(result.sessionApproval?.surface).toBe("external_directory");
    expect(result.sessionApproval?.representativePattern).toBeDefined();
  });

  it("denialContext contains the external path and cwd", () => {
    const result = gateUnderTest(
      makeTcc({ input: { path: "/outside/project/file.ts" } }),
      ["/test/agent"],
    ) as GateDescriptor;
    expect(result.denialContext).toMatchObject({
      kind: "external_directory",
      toolName: "read",
      pathValue: "/outside/project/file.ts",
      cwd: "/test/project",
    });
  });

  it("promptDetails includes path and tool_call source", () => {
    const result = gateUnderTest(
      makeTcc({ toolName: "read", agentName: "agent-1", toolCallId: "tc-5" }),
      ["/test/agent"],
    ) as GateDescriptor;
    expect(result.promptDetails).toMatchObject({
      source: "tool_call",
      agentName: "agent-1",
      toolCallId: "tc-5",
      toolName: "read",
      path: "/outside/project/file.ts",
    });
  });

  it("logContext includes path and message", () => {
    const result = gateUnderTest(makeTcc(), ["/test/agent"]) as GateDescriptor;
    expect(result.logContext).toMatchObject({
      source: "tool_call",
      path: "/outside/project/file.ts",
    });
    expect(result.logContext.message).toBeDefined();
  });
});

// Extension and MCP tools are now external-directory gated (#352) ───────────

describe("describeExternalDirectoryGate — extension and MCP tools (#352)", () => {
  it("gates an extension tool with an external input.path", () => {
    const result = gateUnderTest(
      makeTcc({
        toolName: "my-ext",
        input: { path: "/outside/project/file.ts" },
      }),
      ["/test/agent"],
    );
    expect(isGateDescriptor(result)).toBe(true);
    expect((result as GateDescriptor).surface).toBe("external_directory");
  });

  it("gates an MCP tool with an external arguments.path", () => {
    const result = gateUnderTest(
      makeTcc({
        toolName: "mcp",
        input: { arguments: { path: "/outside/project/file.ts" } },
      }),
      ["/test/agent"],
    );
    expect(isGateDescriptor(result)).toBe(true);
  });

  it("uses a registered extractor's external path for a custom-shaped tool", () => {
    const extractors = {
      get: (name: string) =>
        name === "ffgrep"
          ? (input: Record<string, unknown>) =>
              typeof input.target === "string" ? input.target : undefined
          : undefined,
    };
    const result = gateUnderTest(
      makeTcc({ toolName: "ffgrep", input: { target: "/outside/project/x" } }),
      ["/test/agent"],
      extractors,
    );
    expect(isGateDescriptor(result)).toBe(true);
  });

  it("returns null for an extension tool whose path is inside cwd", () => {
    const result = gateUnderTest(
      makeTcc({
        toolName: "my-ext",
        input: { path: "/test/project/src/x.ts" },
      }),
      ["/test/agent"],
    );
    expect(result).toBeNull();
  });
});
