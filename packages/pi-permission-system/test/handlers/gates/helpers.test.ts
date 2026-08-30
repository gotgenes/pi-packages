import { describe, expect, it } from "vitest";

import { AccessPath } from "#src/access-intent/access-path";
import {
  accessFactsFromPath,
  accessFactsFromValue,
  buildDecisionEvent,
  deriveDecisionValue,
  resolveYoloGrant,
} from "#src/handlers/gates/helpers";
import { posixPathFlavor } from "#src/path/path-flavor";
import type { PermissionCheckResult } from "#src/types";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

describe("deriveDecisionValue", () => {
  it("returns command for bash", () => {
    expect(deriveDecisionValue("bash", { command: "git status" })).toBe(
      "git status",
    );
  });

  it("falls back to toolName when bash has no command", () => {
    expect(deriveDecisionValue("bash", {})).toBe("bash");
  });

  it("returns target for mcp", () => {
    expect(deriveDecisionValue("mcp", { target: "exa:search" })).toBe(
      "exa:search",
    );
  });

  it("falls back to toolName when mcp has no target", () => {
    expect(deriveDecisionValue("mcp", {})).toBe("mcp");
  });

  it("returns toolName for non-path-bearing tools", () => {
    expect(deriveDecisionValue("my_extension_tool", {})).toBe(
      "my_extension_tool",
    );
  });

  it("returns path for path-bearing tools when path is provided", () => {
    expect(deriveDecisionValue("read", {}, "/project/src/main.ts")).toBe(
      "/project/src/main.ts",
    );
    expect(deriveDecisionValue("write", {}, "src/.env")).toBe("src/.env");
  });

  it("falls back to toolName for path-bearing tools when path is missing", () => {
    expect(deriveDecisionValue("read", {})).toBe("read");
    expect(deriveDecisionValue("write", {}, undefined)).toBe("write");
  });
});

describe("buildDecisionEvent", () => {
  function makeCheck(
    overrides: Partial<PermissionCheckResult> = {},
  ): PermissionCheckResult {
    return {
      state: "allow",
      toolName: "read",
      source: "tool",
      origin: "builtin",
      matchedPattern: "*",
      ...overrides,
    };
  }

  it("builds a decision event with all fields populated", () => {
    const event = buildDecisionEvent(
      { surface: "read", value: "read" },
      makeCheck({ origin: "global", matchedPattern: "read" }),
      "test-agent",
      "allow",
      "policy_allow",
    );
    expect(event).toEqual({
      surface: "read",
      value: "read",
      result: "allow",
      resolution: "policy_allow",
      origin: "global",
      agentName: "test-agent",
      matchedPattern: "read",
    });
  });

  it("normalises undefined origin to null", () => {
    const event = buildDecisionEvent(
      { surface: "bash", value: "git status" },
      makeCheck({ origin: undefined }),
      null,
      "allow",
      "user_approved",
    );
    expect(event.origin).toBeNull();
  });

  it("normalises null agentName to null", () => {
    const event = buildDecisionEvent(
      { surface: "read", value: "read" },
      makeCheck(),
      null,
      "deny",
      "policy_deny",
    );
    expect(event.agentName).toBeNull();
  });

  it("normalises undefined matchedPattern to null", () => {
    const event = buildDecisionEvent(
      { surface: "read", value: "read" },
      makeCheck({ matchedPattern: undefined }),
      null,
      "deny",
      "policy_deny",
    );
    expect(event.matchedPattern).toBeNull();
  });

  it("passes result and resolution through", () => {
    const event = buildDecisionEvent(
      { surface: "bash", value: "rm -rf /" },
      makeCheck(),
      null,
      "deny",
      "user_denied",
    );
    expect(event.result).toBe("deny");
    expect(event.resolution).toBe("user_denied");
  });
});

describe("resolveYoloGrant", () => {
  it("returns the check unchanged for a ruleset-granted yolo allow", () => {
    const check = makeCheckResult({ origin: "yolo", matchedPattern: "*" });

    expect(resolveYoloGrant(check, false)).toBe(check);
  });

  it("grants a residual ask under yolo, preserving the matched pattern", () => {
    const check = makeCheckResult({
      state: "ask",
      source: "bash",
      toolName: "bash",
      matchedPattern: "<indirection-bash-wrapper>",
    });

    expect(resolveYoloGrant(check, true)).toEqual({
      ...check,
      state: "allow",
      origin: "yolo",
    });
  });

  it("returns null for a residual ask with yolo disabled", () => {
    expect(
      resolveYoloGrant(
        makeCheckResult({ state: "ask", matchedPattern: "*" }),
        false,
      ),
    ).toBeNull();
  });

  it("returns null for an allow granted by an ordinary rule", () => {
    expect(
      resolveYoloGrant(
        makeCheckResult({ origin: "global", matchedPattern: "*" }),
        true,
      ),
    ).toBeNull();
  });

  it("returns null for a deny, so an explicit deny survives yolo", () => {
    expect(
      resolveYoloGrant(
        makeCheckResult({ state: "deny", matchedPattern: "rm *" }),
        true,
      ),
    ).toBeNull();
  });
});

describe("accessFactsFromPath", () => {
  it("projects the AccessPath's match set and boundary as strings", () => {
    const path = AccessPath.forPath("/outside/x.ts", {
      cwd: "/repo",
      flavor: posixPathFlavor,
    });
    expect(accessFactsFromPath("external_directory", path)).toEqual({
      surface: "external_directory",
      matchValues: path.matchValues(),
      boundaryValue: path.boundaryValue(),
    });
  });

  it("collapses an empty boundary (literal-only path) to null", () => {
    const path = AccessPath.forLiteral("relative-token");
    expect(path.boundaryValue()).toBe("");
    expect(accessFactsFromPath("path", path)).toEqual({
      surface: "path",
      matchValues: ["relative-token"],
      boundaryValue: null,
    });
  });
});

describe("accessFactsFromValue", () => {
  it("wraps a single portable value with a null boundary", () => {
    expect(accessFactsFromValue("skill", "deep-research")).toEqual({
      surface: "skill",
      matchValues: ["deep-research"],
      boundaryValue: null,
    });
  });
});
