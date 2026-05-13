import { describe, expect, it } from "vitest";

import {
  deriveDecisionValue,
  deriveResolution,
} from "../../../src/handlers/gates/helpers";

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

describe("deriveResolution", () => {
  it("returns policy_allow for allow state", () => {
    expect(deriveResolution("allow", "allow", false, true)).toBe(
      "policy_allow",
    );
  });

  it("returns policy_deny for deny state", () => {
    expect(deriveResolution("deny", "block", false, true)).toBe("policy_deny");
  });

  it("returns user_approved for ask + allow without session", () => {
    expect(deriveResolution("ask", "allow", false, true)).toBe("user_approved");
  });

  it("returns user_approved_for_session for ask + allow with session", () => {
    expect(deriveResolution("ask", "allow", true, true)).toBe(
      "user_approved_for_session",
    );
  });

  it("returns auto_approved when autoApproved flag is set", () => {
    expect(deriveResolution("ask", "allow", false, true, true)).toBe(
      "auto_approved",
    );
  });

  it("returns approved_with_custom_pattern for ask + allow with custom pattern", () => {
    expect(deriveResolution("ask", "allow", false, true, false, true)).toBe(
      "approved_with_custom_pattern",
    );
  });

  it("returns user_denied for ask + block with canConfirm", () => {
    expect(deriveResolution("ask", "block", false, true)).toBe("user_denied");
  });

  it("returns confirmation_unavailable for ask + block without canConfirm", () => {
    expect(deriveResolution("ask", "block", false, false)).toBe(
      "confirmation_unavailable",
    );
  });
});
