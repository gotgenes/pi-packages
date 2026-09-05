import { describe, expect, it } from "vitest";

import { PermissionManager } from "#src/policy/permission-manager";
import type { ScopeConfig } from "#src/types";
import { createInMemoryPolicyLoader } from "#test/helpers/manager-harness";

/**
 * Fail-closed clamp (#646): when a non-global config scope (project / agent /
 * project-agent) is invalid, the composed policy is floored so nothing resolves
 * more permissively than `ask` (`allow` → `ask`, tagged `origin: "fail-closed"`).
 * An invalid global scope never triggers the clamp; hard `deny` survives.
 */
function makeManager(scopes: {
  global?: ScopeConfig;
  project?: ScopeConfig;
  agent?: Record<string, ScopeConfig>;
  projectAgent?: Record<string, ScopeConfig>;
}): PermissionManager {
  return new PermissionManager({
    policyLoader: createInMemoryPolicyLoader(scopes),
  });
}

const bashCheck = {
  kind: "tool" as const,
  surface: "bash",
  input: { command: "echo hi" },
};

describe("PermissionManager fail-closed clamp on invalid non-global scope", () => {
  it("floors a lower-scope allow to ask when a project scope is invalid", () => {
    const manager = makeManager({
      global: { permission: { bash: "allow" } },
      project: { invalid: true },
    });
    const result = manager.check(bashCheck);
    expect(result.state).toBe("ask");
    expect(result.origin).toBe("fail-closed");
  });

  it("preserves a lower-scope deny when a project scope is invalid", () => {
    const manager = makeManager({
      global: { permission: { bash: "deny" } },
      project: { invalid: true },
    });
    const result = manager.check(bashCheck);
    expect(result.state).toBe("deny");
    expect(result.origin).not.toBe("fail-closed");
  });

  it("floors when an agent scope is invalid", () => {
    const manager = makeManager({
      global: { permission: { bash: "allow" } },
      agent: { coder: { invalid: true } },
    });
    const result = manager.check({ ...bashCheck, agentName: "coder" });
    expect(result.state).toBe("ask");
    expect(result.origin).toBe("fail-closed");
  });

  it("does not floor when the invalid flag is on the global scope", () => {
    // Global is the lowest precedence — nothing more permissive is inherited,
    // so its invalid flag is ignored by the clamp.
    const manager = makeManager({
      global: { permission: { bash: "allow" }, invalid: true },
    });
    const result = manager.check(bashCheck);
    expect(result.state).toBe("allow");
    expect(result.origin).not.toBe("fail-closed");
  });

  it("does not floor when all scopes are valid", () => {
    const manager = makeManager({
      global: { permission: { bash: "allow" } },
      project: { permission: { read: "allow" } },
    });
    const result = manager.check(bashCheck);
    expect(result.state).toBe("allow");
    expect(result.origin).not.toBe("fail-closed");
  });

  it("floors getToolPermission too (display parity)", () => {
    const manager = makeManager({
      global: { permission: { bash: "allow" } },
      project: { invalid: true },
    });
    expect(manager.getToolPermission("bash")).toBe("ask");
  });

  it("keeps a floored tool exposed — the clamp makes allows ask, never deny", () => {
    const manager = makeManager({
      global: { permission: { bash: "allow" } },
      project: { invalid: true },
    });
    expect(manager.isToolFullyDenied("bash")).toBe(false);
  });

  it("appends a fail-closed notice to config issues naming the invalid scope", () => {
    const manager = makeManager({
      global: { permission: { bash: "allow" } },
      project: { invalid: true },
    });
    expect(manager.getConfigIssues()).toEqual([
      "Invalid project configuration detected — failing closed: 'allow' rules " +
        "are clamped to 'ask' for this session until the configuration is corrected.",
    ]);
  });

  it("emits no fail-closed notice when all scopes are valid", () => {
    const manager = makeManager({
      global: { permission: { bash: "allow" } },
      project: { permission: { read: "allow" } },
    });
    expect(manager.getConfigIssues()).toEqual([]);
  });
});
