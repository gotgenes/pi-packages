import { describe, expect, test } from "vitest";
import { findEvidence } from "#src/presentation/prompt-payload";
import {
  buildToolAskPayload,
  type ToolAskFacts,
} from "#src/presentation/tool-ask-payload";
import type { ToolInputFormatterLookup } from "#src/tool-input-formatter-registry";
import type { PermissionCheckResult } from "#src/types";
import {
  makePermissionCheckResult,
  makeToolPreviewFormatter,
} from "#test/helpers/presentation-fixtures";

function makeFormatter(lookup?: ToolInputFormatterLookup) {
  return makeToolPreviewFormatter({}, lookup);
}

function makeMcpLookup(preview: string): ToolInputFormatterLookup {
  return { get: (name) => (name === "mcp" ? () => preview : undefined) };
}

function toolResult(
  toolName: string,
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return makePermissionCheckResult(toolName, overrides);
}

function mcpResult(
  target: string,
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return makePermissionCheckResult("mcp", { target, ...overrides });
}

/** Build a payload the way the per-tool gate does, defaulting the surface. */
function buildPayload(
  facts: Omit<ToolAskFacts, "surface" | "agentName"> & {
    surface?: string;
    agentName?: string | null;
  },
) {
  return buildToolAskPayload({
    agentName: null,
    surface: facts.check.toolName,
    ...facts,
  });
}

describe("buildToolAskPayload", () => {
  describe("the invariant core", () => {
    test("carries the gate surface, matched rule, and offending command", () => {
      const payload = buildPayload({
        check: toolResult("bash", {
          command: "rm -rf foo",
          matchedPattern: "rm *",
          commandContext: "command_substitution",
        }),
        surface: "bash",
      });

      expect(payload.kind).toBe("bash");
      expect(payload.request).toEqual({
        requester: { agentName: null, forwarded: false, sessionId: null },
        surface: "bash",
        toolName: "bash",
        invokedToolName: null,
        value: "rm -rf foo",
        matchedPattern: "rm *",
        commandContext: "command_substitution",
        executedUnit: null,
      });
    });

    test("carries the executed unit of a wrapper (#713)", () => {
      const payload = buildPayload({
        check: toolResult("bash", {
          command: "xargs grep foo",
          matchedPattern: "<indirection-bash-wrapper>",
          executedUnit: "grep foo",
        }),
        surface: "bash",
      });

      expect(payload.request.executedUnit).toBe("grep foo");
    });

    test("names the invoked tool when a shell alias re-exposes bash (#574)", () => {
      const payload = buildPayload({
        check: toolResult("bash", { command: "ls" }),
        surface: "bash",
        invokedToolName: "exec_command",
      });

      expect(payload.request.toolName).toBe("bash");
      expect(payload.request.invokedToolName).toBe("exec_command");
    });

    test("omits the invoked tool when it repeats the gated one", () => {
      const payload = buildPayload({
        check: toolResult("read"),
        invokedToolName: "read",
      });

      expect(payload.request.invokedToolName).toBeNull();
    });

    test("leaves the value empty for a bash check with no resolved command", () => {
      expect(buildPayload({ check: toolResult("bash") }).request.value).toBe(
        "",
      );
    });

    test("lands the annotations slot empty", () => {
      expect(buildPayload({ check: toolResult("read") }).annotations).toEqual(
        [],
      );
    });
  });

  describe("the bash evidence", () => {
    test("names the agent when one is known", () => {
      expect(
        buildPayload({
          check: toolResult("read"),
          agentName: "my-agent",
          input: { path: "/src" },
          formatter: makeFormatter(),
        }).request.requester.agentName,
      ).toBe("my-agent");
    });

    test("carries the enclosing command when the gated unit is only part of it", () => {
      expect(
        findEvidence(
          buildPayload({
            check: toolResult("bash", { command: "rm -rf ." }),
            input: { command: 'echo "hello" && rm -rf .' },
            formatter: makeFormatter(),
          }),
          "full command",
        ),
      ).toEqual({
        label: "full command",
        text: 'echo "hello" && rm -rf .',
        detail: null,
      });
    });

    test("omits the enclosing command when it is the gated unit", () => {
      expect(
        findEvidence(
          buildPayload({
            check: toolResult("bash", { command: "git push" }),
            input: { command: "git push" },
            formatter: makeFormatter(),
          }),
          "full command",
        ),
      ).toBeUndefined();
    });

    test.each([
      ["input is undefined", undefined],
      ["input has no command field", { unrelated: "value" }],
      ["input command is empty", { command: "" }],
    ])("omits the enclosing command when %s", (_case, input) => {
      expect(
        findEvidence(
          buildPayload({
            check: toolResult("bash", { command: "git push" }),
            input,
            formatter: makeFormatter(),
          }),
          "full command",
        ),
      ).toBeUndefined();
    });

    test("adds no input preview, since the command is the value", () => {
      expect(
        findEvidence(
          buildPayload({
            check: toolResult("bash", { command: "git status" }),
            input: { command: "git status" },
            formatter: makeFormatter(),
          }),
          "input",
        ),
      ).toBeUndefined();
    });
  });

  describe("mcp", () => {
    test("makes the target the decision-relevant value", () => {
      const payload = buildPayload({
        check: mcpResult("server:query", { matchedPattern: "server:*" }),
        formatter: makeFormatter(),
      });

      expect(payload.kind).toBe("mcp");
      expect(payload.request.value).toBe("server:query");
      expect(payload.request.matchedPattern).toBe("server:*");
    });

    test("carries the argument summary a registered formatter produced", () => {
      expect(
        findEvidence(
          buildPayload({
            check: mcpResult("exa:search"),
            input: { tool: "exa:search", arguments: { query: "typescript" } },
            formatter: makeFormatter(makeMcpLookup('with query: "typescript"')),
          }),
          "input",
        ),
      ).toEqual({
        label: "input",
        text: 'with query: "typescript"',
        detail: null,
      });
    });

    test("carries no evidence when the registered formatter declines", () => {
      const noArgsLookup: ToolInputFormatterLookup = {
        get: (name) => (name === "mcp" ? () => undefined : undefined),
      };

      expect(
        buildPayload({
          check: mcpResult("exa:search"),
          input: { tool: "exa:search" },
          formatter: makeFormatter(noArgsLookup),
        }).evidence,
      ).toEqual([]);
    });

    test("carries no evidence when no formatter is provided", () => {
      expect(
        buildPayload({
          check: mcpResult("exa:search"),
          input: { tool: "exa:search", arguments: { query: "test" } },
        }).evidence,
      ).toEqual([]);
    });
  });

  describe("generic tools", () => {
    test("carries the real input preview as evidence", () => {
      expect(
        findEvidence(
          buildPayload({
            check: toolResult("read"),
            input: { path: "/src/foo.ts" },
            formatter: makeFormatter(),
          }),
          "input",
        )?.text,
      ).toContain("path '/src/foo.ts'");
    });

    test("carries no evidence when the formatter produces nothing", () => {
      expect(
        buildPayload({
          check: toolResult("task"),
          input: {},
          formatter: makeFormatter(),
        }).evidence,
      ).toEqual([]);
    });

    test("carries no evidence when no formatter is provided", () => {
      expect(
        buildPayload({ check: toolResult("task"), input: { path: "/src" } })
          .evidence,
      ).toEqual([]);
    });
  });
});
