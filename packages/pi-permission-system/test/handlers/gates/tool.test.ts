import { describe, expect, it } from "vitest";

import type { ShellInvocation } from "#src/access-intent/tool-kind";
import { highlightOccurrences } from "#src/authority/permission-prompt-component";
import { describeToolGate } from "#src/handlers/gates/tool";
import type { ToolCallContext } from "#src/handlers/gates/types";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import {
  TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH,
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
    toolInputLogPreviewMaxLength: TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH,
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
    expect(desc.promptDetails.highlightText).toBe("server:tool");
    expect(
      highlightOccurrences(
        desc.promptDetails.message,
        desc.promptDetails.highlightText!,
        (text) => `<warning>${text}</warning>`,
      ),
    ).toBe(
      "Current agent requested MCP target '<warning>server:tool</warning>' " +
        "(matched '*'). Allow this call?",
    );
  });

  it("populates denialContext with kind 'tool' and check result", () => {
    const check = makeCheckResult("deny", { toolName: "read" });
    const desc = describeToolGate(makeTcc(), check, makeFormatter());
    expect(desc.denialContext).toEqual({
      kind: "tool",
      check,
      agentName: undefined,
      input: {},
    });
  });

  it("populates denialContext with agent name when provided", () => {
    const check = makeCheckResult("ask", { toolName: "read" });
    const desc = describeToolGate(
      makeTcc({ agentName: "my-agent" }),
      check,
      makeFormatter(),
    );
    expect(desc.denialContext.agentName).toBe("my-agent");
  });

  it("populates denialContext with input for tool context", () => {
    const check = makeCheckResult("ask", { toolName: "bash", command: "ls" });
    const desc = describeToolGate(
      makeTcc({ toolName: "bash", input: { command: "ls" } }),
      check,
      makeFormatter(),
    );
    expect(desc.denialContext).toMatchObject({
      kind: "tool",
      input: { command: "ls" },
    });
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
      normalizer.forPath("index.html"),
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
      normalizer.forPath("src/foo.ts"),
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
    expect(desc.promptDetails.message).toBeDefined();
    expect(desc.promptDetails.sessionLabel).toBeDefined();
  });

  it("carries the AccessPath's facts on promptDetails for a path-bearing tool", () => {
    const check = makeCheckResult("ask", { toolName: "edit" });
    const accessPath = normalizer.forPath("src/foo.ts");
    const desc = describeToolGate(
      makeTcc({
        toolName: "edit",
        input: { path: "src/foo.ts" },
        cwd: "/test/project",
      }),
      check,
      makeFormatter(),
      accessPath,
    );
    expect(desc.promptDetails.accessIntent).toEqual({
      surface: "edit",
      matchValues: accessPath.matchValues(),
      boundaryValue: accessPath.boundaryValue(),
    });
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
      normalizer.forPath("/a.ts"),
    );
    expect(desc.surface).toBe("edit");
    expect(desc.input).toEqual({ path: "/a.ts" });
  });
});
