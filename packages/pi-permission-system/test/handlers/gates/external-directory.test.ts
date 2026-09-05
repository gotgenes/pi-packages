import { describe, expect, it, vi } from "vitest";

import type {
  GateBypass,
  GateDescriptor,
} from "#src/handlers/gates/descriptor";
import { isGateBypass, isGateDescriptor } from "#src/handlers/gates/descriptor";
import { describeExternalDirectoryGate } from "#src/handlers/gates/external-directory";
import type { ToolCallContext } from "#src/handlers/gates/types";
import { pathFlavorForPlatform, win32PathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";
import type { ScopedPermissionResolver } from "#src/policy/permission-resolver";
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
    // Containment allowed this, not a rule the operator wrote.
    expect(bypass.decidedBy).toEqual({ kind: "infrastructure_read" });
  });

  it("records no extractor source, which only a built-in read tool can reach", () => {
    // The bypass is gated on READ_ONLY_PATH_BEARING_TOOLS, and every tool in
    // that set classifies as `path` — whose branch resolves by convention and
    // never consults an extractor. So a bypass can never carry an inherited
    // path today. The gate still threads the source through, so the record
    // stays correct if that set ever widens; this pins the fact meanwhile.
    const result = gateUnderTest(
      makeTcc({
        toolName: "read",
        input: { path: "/test/agent/git/some-package/SKILL.md" },
      }),
      ["/test/agent", "/test/agent/git"],
      {
        resolve: () => ({
          extractor: () => "/somewhere/else.md",
          origin: "inherited" as const,
        }),
      },
    );

    expect(isGateBypass(result)).toBe(true);
    // Full-shape, so the absence of extractorSource is asserted rather than
    // merely unchecked.
    expect((result as GateBypass).log).toEqual({
      event: "permission_request.infrastructure_auto_allowed",
      details: {
        source: "tool_call",
        toolCallId: "tc-1",
        toolName: "read",
        agentName: null,
        path: "/test/agent/git/some-package/SKILL.md",
      },
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

  it("returns GateDescriptor with surface 'external_directory_read'", () => {
    const result = gateUnderTest(makeTcc(), ["/test/agent"]);
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.surface).toBe("external_directory_read");
  });

  it("decision value is the external path", () => {
    const result = gateUnderTest(
      makeTcc({ input: { path: "/outside/project/file.ts" } }),
      ["/test/agent"],
    ) as GateDescriptor;
    expect(result.decision.value).toBe("/outside/project/file.ts");
    expect(result.decision.surface).toBe("external_directory_read");
  });

  it("carries the child-fixed access facts on promptDetails (external_directory_read surface)", () => {
    const path = "/outside/project/file.ts";
    const result = gateUnderTest(makeTcc({ input: { path } }), [
      "/test/agent",
    ]) as GateDescriptor;
    const accessPath = new PathNormalizer(
      pathFlavorForPlatform(process.platform),
      "/test/project",
    ).forPath(path);
    expect(result.promptDetails.accessIntent).toEqual({
      surface: "external_directory_read",
      matchValues: accessPath.matchValues(),
      boundaryValue: accessPath.boundaryValue(),
    });
  });

  it("emits an external_directory payload carrying the escaped boundary", () => {
    const result = gateUnderTest(
      makeTcc({ input: { path: "/outside/project/file.ts" } }),
      ["/test/agent"],
    ) as GateDescriptor;

    expect(result.payload.kind).toBe("external_directory");
    expect(result.payload.request.value).toBe("/outside/project/file.ts");
    expect(result.payload.evidence).toContainEqual({
      label: "working directory",
      text: "/test/project",
      detail: null,
    });
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

  it("resolves the typed and symlink-resolved aliases on the external_directory_read surface (#418)", () => {
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
        surface: "external_directory_read",
        agentName: undefined,
      }),
    );
    const intent = resolver.resolve.mock.calls[0][0];
    expect(intent.kind).toBe("access-path");
    if (intent.kind === "access-path") {
      expect(intent.path.matchValues()).toEqual(["/outside/project/file.ts"]);
    }
  });

  it("records a directory-scoped session approval on the external_directory_read surface", () => {
    const result = gateUnderTest(
      makeTcc({ input: { path: "/outside/project/file.ts" } }),
      ["/test/agent"],
    ) as GateDescriptor;
    expect(result.sessionApproval?.grants[0]?.surface).toBe(
      "external_directory_read",
    );
    expect(
      result.sessionApproval?.grants.map((grant) => grant.pattern),
    ).toEqual(["/outside/project/*"]);
  });

  it("payload contains the external path and the boundary it escaped", () => {
    const result = gateUnderTest(
      makeTcc({ input: { path: "/outside/project/file.ts" } }),
      ["/test/agent"],
    ) as GateDescriptor;
    expect(result.payload.kind).toBe("external_directory");
    expect(result.payload.request.toolName).toBe("read");
    expect(result.payload.request.value).toBe("/outside/project/file.ts");
    expect(result.payload.evidence).toContainEqual({
      label: "working directory",
      text: "/test/project",
      detail: null,
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

  it("logContext includes the path, and no prompt wording", () => {
    const result = gateUnderTest(makeTcc(), ["/test/agent"]) as GateDescriptor;
    expect(result.logContext).toMatchObject({
      source: "tool_call",
      path: "/outside/project/file.ts",
    });
    // The payload's request facts are stamped by the runner, not the gate.
    expect(result.logContext).not.toHaveProperty("message");
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
      resolve: (name: string) =>
        name === "ffgrep"
          ? {
              extractor: (input: Record<string, unknown>) =>
                typeof input.target === "string" ? input.target : undefined,
              origin: "local" as const,
            }
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

  describe("tool-identity direction routing", () => {
    /** The gate names the narrowest `external_directory`-family surface. */
    function surfacesFor(toolName: string) {
      const resolver = makeResolver(makeCheckResult({ state: "ask" }));
      const descriptor = gateUnderTest(
        makeTcc({ toolName }),
        [],
        undefined,
        resolver,
      ) as GateDescriptor;
      return {
        intent: vi.mocked(resolver.resolve).mock.calls[0][0].surface,
        descriptor: descriptor.surface,
        approval: descriptor.sessionApproval?.grants[0]?.surface,
        facts: descriptor.promptDetails.accessIntent?.surface,
        decision: descriptor.decision.surface,
        payload: descriptor.payload.request.surface,
      };
    }

    it.each(["read", "grep", "find", "ls"])(
      "names external_directory_read for %s",
      (toolName) => {
        const surface = "external_directory_read";
        expect(surfacesFor(toolName)).toEqual({
          intent: surface,
          descriptor: surface,
          approval: surface,
          facts: surface,
          decision: surface,
          payload: surface,
        });
      },
    );

    it("names external_directory_write for write", () => {
      const surface = "external_directory_write";
      expect(surfacesFor("write")).toEqual({
        intent: surface,
        descriptor: surface,
        approval: surface,
        facts: surface,
        decision: surface,
        payload: surface,
      });
    });

    it("names the bare family for edit, and for a tool of unknown direction", () => {
      for (const toolName of ["edit", "my-ext"]) {
        expect(surfacesFor(toolName)).toEqual({
          intent: "external_directory",
          descriptor: "external_directory",
          approval: "external_directory",
          facts: "external_directory",
          decision: "external_directory",
          payload: "external_directory",
        });
      }
    });

    it("keeps the payload kind 'external_directory' so renderer dispatch is untouched", () => {
      const result = gateUnderTest(makeTcc({ toolName: "read" }), []);
      expect((result as GateDescriptor).payload.kind).toBe(
        "external_directory",
      );
    });
  });

  it("derives the session approval through the injected flavor, not the host", () => {
    // A native Windows path carries backslash separators the *host* POSIX
    // `node:path` cannot see, so an ambient derivation collapses it to `./*`
    // and the recorded grant matches nothing (#655).
    const result = describeExternalDirectoryGate(
      makeTcc({
        input: { path: "C:\\Other\\data\\x.txt" },
        cwd: "C:\\Projects\\App",
      }),
      [],
      makeResolver(
        makeCheckResult({ state: "ask", toolName: "external_directory" }),
      ),
      new PathNormalizer(win32PathFlavor, "C:\\Projects\\App"),
    );
    expect(isGateDescriptor(result)).toBe(true);
    expect(
      (result as GateDescriptor).sessionApproval?.grants.map(
        (grant) => grant.pattern,
      ),
    ).toEqual(["c:\\other\\data\\*"]);
  });
});
