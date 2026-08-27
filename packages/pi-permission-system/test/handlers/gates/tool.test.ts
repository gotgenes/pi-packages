import { describe, expect, it } from "vitest";

import type { ShellInvocation } from "#src/access-intent/tool-kind";
import type { ToolPathAccess } from "#src/handlers/gates/tool";
import { describeToolGate } from "#src/handlers/gates/tool";
import type { ToolCallContext } from "#src/handlers/gates/types";
import { posixPathFlavor, win32PathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import {
  TOOL_INPUT_PREVIEW_MAX_LENGTH,
  TOOL_TEXT_SUMMARY_MAX_LENGTH,
} from "#src/tool-input-preview";
import { ToolPreviewFormatter } from "#src/tool-preview-formatter";
import type { PermissionCheckResult } from "#src/types";

// ── helpers ────────────────────────────────────────────────────────────────

function makeFormatter(): ToolPreviewFormatter {
  return new ToolPreviewFormatter({
    toolInputPreviewMaxLength: TOOL_INPUT_PREVIEW_MAX_LENGTH,
    toolTextSummaryMaxLength: TOOL_TEXT_SUMMARY_MAX_LENGTH,
  });
}

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "read",
    agentName: null,
    input: {},
    toolCallId: "tc-1",
    cwd: "/test/project",
    ...overrides,
  };
}

function makeCheckResult(
  state: "allow" | "deny" | "ask",
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    state,
    toolName: "read",
    source: "tool",
    origin: "builtin",
    matchedPattern: "*",
    ...overrides,
  };
}

// The per-tool gate now receives the AccessPath the pipeline builds, bound to
// the makeTcc default cwd; approval values derive from `accessPath.value()`.
const normalizer = new PathNormalizer(posixPathFlavor, "/test/project");

/** Pair the pipeline hands the gate: the resolved path and its approval scope. */
function pathAccessFor(
  pathValue: string,
  n: PathNormalizer = normalizer,
): ToolPathAccess {
  const path = n.forPath(pathValue);
  return { path, approvalPattern: n.approvalPatternFor(path) };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("describeToolGate", () => {
  it("returns descriptor with tool name as surface for standard tools", () => {
    const desc = describeToolGate(
      makeTcc({ toolName: "read" }),
      makeCheckResult("ask"),
      makeFormatter(),
    );
    expect(desc.surface).toBe("read");
    expect(desc.decision.surface).toBe("read");
  });

  it("returns descriptor with tool name as decision value for standard tools", () => {
    const desc = describeToolGate(
      makeTcc({ toolName: "write" }),
      makeCheckResult("ask"),
      makeFormatter(),
    );
    expect(desc.decision.value).toBe("write");
  });

  it("returns bash surface with command in decision.value for bash tools", () => {
    const check = makeCheckResult("ask", {
      toolName: "bash",
      command: "git status",
    });
    const desc = describeToolGate(
      makeTcc({ toolName: "bash", input: { command: "git status" } }),
      check,
      makeFormatter(),
    );
    expect(desc.surface).toBe("bash");
    expect(desc.decision.surface).toBe("bash");
    expect(desc.decision.value).toBe("git status");
  });

  it("gates an aliased shell tool on the bash surface while keeping its tool name in logs (#574)", () => {
    const shell: ShellInvocation = {
      command: "npm install",
      workdir: undefined,
    };
    const check = makeCheckResult("ask", {
      toolName: "bash",
      source: "bash",
      command: "npm install",
    });
    const desc = describeToolGate(
      makeTcc({ toolName: "exec_command", input: { cmd: "npm install" } }),
      check,
      makeFormatter(),
      undefined,
      shell,
    );
    // Gated as bash: decision, surface, and session rule are bash-shaped.
    expect(desc.surface).toBe("bash");
    expect(desc.decision.surface).toBe("bash");
    expect(desc.decision.value).toBe("npm install");
    expect(desc.sessionApproval?.surface).toBe("bash");
    expect(desc.sessionApproval?.representativePattern).toBe("npm install*");
    // The invoked tool name is preserved for the review log and prompt.
    expect(desc.logContext.toolName).toBe("exec_command");
    expect(desc.promptDetails.toolName).toBe("exec_command");
    // "Gated as bash, invoked as exec_command" is two facts, and the payload
    // records both rather than collapsing them.
    expect(desc.payload.kind).toBe("bash");
    expect(desc.payload.request.toolName).toBe("bash");
    expect(desc.payload.request.invokedToolName).toBe("exec_command");
  });

  it("returns mcp surface with target in decision.value for MCP tools", () => {
    const check = makeCheckResult("ask", {
      toolName: "mcp",
      target: "server:tool",
    });
    const desc = describeToolGate(
      makeTcc({ toolName: "mcp", input: { tool: "server:tool" } }),
      check,
      makeFormatter(),
    );
    expect(desc.surface).toBe("mcp");
    expect(desc.decision.surface).toBe("mcp");
    expect(desc.decision.value).toBe("server:tool");
  });

  it("carries the checked tool and its matched rule on the payload", () => {
    const check = makeCheckResult("deny", {
      toolName: "read",
      matchedPattern: "re*",
    });
    const desc = describeToolGate(makeTcc(), check, makeFormatter());
    expect(desc.payload.kind).toBe("tool");
    expect(desc.payload.request.toolName).toBe("read");
    expect(desc.payload.request.matchedPattern).toBe("re*");
    expect(desc.payload.request.requester.agentName).toBeNull();
  });

  it("names the requesting agent on the payload when provided", () => {
    const check = makeCheckResult("ask", { toolName: "read" });
    const desc = describeToolGate(
      makeTcc({ agentName: "my-agent" }),
      check,
      makeFormatter(),
    );
    expect(desc.payload.request.requester.agentName).toBe("my-agent");
  });

  it("carries the command as the decision-relevant value for a bash ask", () => {
    const check = makeCheckResult("ask", { toolName: "bash", command: "ls" });
    const desc = describeToolGate(
      makeTcc({ toolName: "bash", input: { command: "ls" } }),
      check,
      makeFormatter(),
    );
    expect(desc.payload.kind).toBe("bash");
    expect(desc.payload.request.value).toBe("ls");
  });

  it("populates sessionApproval via suggestSessionPattern", () => {
    const check = makeCheckResult("ask", {
      toolName: "bash",
      command: "git status",
    });
    const desc = describeToolGate(
      makeTcc({ toolName: "bash", input: { command: "git status" } }),
      check,
      makeFormatter(),
    );
    expect(desc.sessionApproval).toBeDefined();
    expect(desc.sessionApproval?.surface).toBe("bash");
    expect(desc.sessionApproval?.representativePattern).toBeDefined();
  });

  it("binds a current-directory file's session approval to the cwd subtree", () => {
    const check = makeCheckResult("ask", { toolName: "edit" });
    const desc = describeToolGate(
      makeTcc({
        toolName: "edit",
        input: { path: "index.html" },
        cwd: "/test/project",
      }),
      check,
      makeFormatter(),
      pathAccessFor("index.html"),
    );
    expect(desc.sessionApproval?.surface).toBe("edit");
    expect(desc.sessionApproval?.representativePattern).toBe("/test/project/*");
  });

  it("resolves a sub-directory file's session approval to an absolute pattern", () => {
    // The approval value derives from the AccessPath's lexical absolute form
    // (`value()`), so sub-directory approvals are absolute too — the deliberate
    // tradeoff that keeps the pattern aligned with the policy values it is
    // matched against.
    const check = makeCheckResult("ask", { toolName: "edit" });
    const desc = describeToolGate(
      makeTcc({
        toolName: "edit",
        input: { path: "src/foo.ts" },
        cwd: "/test/project",
      }),
      check,
      makeFormatter(),
      pathAccessFor("src/foo.ts"),
    );
    expect(desc.sessionApproval?.representativePattern).toBe(
      "/test/project/src/*",
    );
  });

  it("falls back to a wildcard session approval when no AccessPath is given", () => {
    // A path-bearing tool with no `input.path` keeps the `tool` intent and gets
    // no AccessPath, so the suggestion collapses to the catch-all.
    const desc = describeToolGate(
      makeTcc({ toolName: "read", input: {} }),
      makeCheckResult("ask"),
      makeFormatter(),
    );
    expect(desc.sessionApproval?.surface).toBe("read");
    expect(desc.sessionApproval?.representativePattern).toBe("*");
  });

  it("populates promptDetails with correct fields", () => {
    const check = makeCheckResult("ask");
    const desc = describeToolGate(
      makeTcc({ toolName: "read", agentName: "my-agent", toolCallId: "tc-42" }),
      check,
      makeFormatter(),
    );
    expect(desc.promptDetails).toMatchObject({
      source: "tool_call",
      agentName: "my-agent",
      toolCallId: "tc-42",
      toolName: "read",
    });
    expect(desc.promptDetails.sessionLabel).toBeDefined();
  });

  it("carries the AccessPath's facts on promptDetails for a path-bearing tool", () => {
    const check = makeCheckResult("ask", { toolName: "edit" });
    const pathAccess = pathAccessFor("src/foo.ts");
    const desc = describeToolGate(
      makeTcc({
        toolName: "edit",
        input: { path: "src/foo.ts" },
        cwd: "/test/project",
      }),
      check,
      makeFormatter(),
      pathAccess,
    );
    expect(desc.promptDetails.accessIntent).toEqual({
      surface: "edit",
      matchValues: pathAccess.path.matchValues(),
      boundaryValue: pathAccess.path.boundaryValue(),
    });
  });

  it("records the approval pattern the pipeline derived", () => {
    const desc = describeToolGate(
      makeTcc({ toolName: "edit", input: { path: "src/foo.ts" } }),
      makeCheckResult("ask", { toolName: "edit" }),
      makeFormatter(),
      pathAccessFor("src/foo.ts"),
    );
    expect(desc.sessionApproval?.patterns).toEqual(["/test/project/src/*"]);
    expect(desc.promptDetails.sessionLabel).toBe(
      'Yes, allow edit "/test/project/src/*" for this session',
    );
  });

  it("derives the approval through the injected flavor, not the host", () => {
    // A native Windows path carries backslash separators the *host* POSIX
    // `node:path` cannot see, so an ambient derivation collapses it to `./*`
    // and the recorded grant matches nothing (#655).
    const win32Normalizer = new PathNormalizer(
      win32PathFlavor,
      "C:\\Projects\\App",
    );
    const desc = describeToolGate(
      makeTcc({
        toolName: "edit",
        input: { path: "src\\foo.ts" },
        cwd: "C:\\Projects\\App",
      }),
      makeCheckResult("ask", { toolName: "edit" }),
      makeFormatter(),
      pathAccessFor("src\\foo.ts", win32Normalizer),
    );
    expect(desc.sessionApproval?.patterns).toEqual([
      "c:\\projects\\app\\src\\*",
    ]);
  });

  it("carries the single decision value on promptDetails for a non-path tool (bash)", () => {
    const check = makeCheckResult("ask", {
      toolName: "bash",
      command: "git status",
    });
    const desc = describeToolGate(
      makeTcc({ toolName: "bash", input: { command: "git status" } }),
      check,
      makeFormatter(),
    );
    expect(desc.promptDetails.accessIntent).toEqual({
      surface: "bash",
      matchValues: ["git status"],
      boundaryValue: null,
    });
  });

  it("populates logContext with tool input preview fields", () => {
    const check = makeCheckResult("ask", { toolName: "bash", command: "ls" });
    const desc = describeToolGate(
      makeTcc({ toolName: "bash", input: { command: "ls" } }),
      check,
      makeFormatter(),
    );
    expect(desc.logContext).toMatchObject({
      source: "tool_call",
      toolName: "bash",
    });
    expect(desc.logContext.command).toBe("ls");
  });

  it("uses toolName as input for checkPermission surface", () => {
    const desc = describeToolGate(
      makeTcc({ toolName: "edit", input: { path: "/a.ts" } }),
      makeCheckResult("ask", { toolName: "edit" }),
      makeFormatter(),
      pathAccessFor("/a.ts"),
    );
    expect(desc.surface).toBe("edit");
    expect(desc.input).toEqual({ path: "/a.ts" });
  });
});
