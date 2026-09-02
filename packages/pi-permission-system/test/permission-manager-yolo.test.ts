import { describe, expect, it } from "vitest";

import { PermissionManager } from "#src/permission-manager";
import type { ScopeConfig } from "#src/types";
import { createInMemoryPolicyLoader } from "#test/helpers/manager-harness";

/**
 * yolo mode as recorded authority (#526): when the injected reader reports
 * true, `check()` rewrites every matched `ask` to `allow` tagged
 * `origin: "yolo"`. Display surfaces (`getComposedConfigRules`,
 * `getToolPermission`) stay yolo-free.
 */
function makeManager(
  global: Record<string, unknown>,
  isYoloEnabled: () => boolean,
  project?: ScopeConfig,
): PermissionManager {
  return new PermissionManager({
    policyLoader: createInMemoryPolicyLoader({
      global: { permission: global } as ScopeConfig,
      project,
    }),
    isYoloEnabled,
  });
}

describe("PermissionManager yolo rewrite", () => {
  it("rewrites a would-be-ask tool check to allow with origin 'yolo'", () => {
    const manager = makeManager({ bash: "ask" }, () => true);
    const result = manager.check({
      kind: "tool",
      surface: "bash",
      input: { command: "rm -rf /tmp/x" },
    });
    expect(result.state).toBe("allow");
    expect(result.origin).toBe("yolo");
  });

  it("rewrites the synthesized universal-default ask to allow with origin 'yolo'", () => {
    // No rule for the surface; falls through to the universal "*" default (ask).
    const manager = makeManager({}, () => true);
    const result = manager.check({
      kind: "tool",
      surface: "someExtensionTool",
      input: {},
    });
    expect(result.state).toBe("allow");
    expect(result.origin).toBe("yolo");
  });

  it("preserves explicit deny under yolo (hard denies survive)", () => {
    const manager = makeManager({ bash: "deny" }, () => true);
    const result = manager.check({
      kind: "tool",
      surface: "bash",
      input: { command: "rm -rf /" },
    });
    expect(result.state).toBe("deny");
    expect(result.origin).not.toBe("yolo");
  });

  it("passes an explicit allow through unchanged (not tagged yolo)", () => {
    const manager = makeManager({ read: "allow" }, () => true);
    const result = manager.check({
      kind: "tool",
      surface: "read",
      input: { path: "/tmp/x" },
    });
    expect(result.state).toBe("allow");
    expect(result.origin).not.toBe("yolo");
  });

  it("does not rewrite when yolo is disabled (state stays ask)", () => {
    const manager = makeManager({ bash: "ask" }, () => false);
    const result = manager.check({
      kind: "tool",
      surface: "bash",
      input: { command: "rm -rf /tmp/x" },
    });
    expect(result.state).toBe("ask");
    expect(result.origin).not.toBe("yolo");
  });

  it("leaves display surfaces yolo-free even when yolo is enabled", () => {
    const manager = makeManager({ bash: "ask" }, () => true);

    // getComposedConfigRules shows the configured action, not the rewrite.
    const bashRule = manager
      .getComposedConfigRules()
      .find((r) => r.surface === "bash");
    expect(bashRule?.action).toBe("ask");
    expect(bashRule?.origin).not.toBe("yolo");

    // getToolPermission reports the configured surface state.
    expect(manager.getToolPermission("bash")).toBe("ask");
  });

  it("does not re-expose a denied tool — the rewrite touches asks, never denies", () => {
    const manager = makeManager({ bash: "deny" }, () => true);
    expect(manager.isToolFullyDenied("bash")).toBe(true);
  });
});

describe("PermissionManager fail-closed clamp under yolo (#646)", () => {
  it("yolo re-permits a fail-closed floored allow (allow→ask→allow)", () => {
    // Invalid project scope floors global's `allow` to `ask` at composition;
    // yolo then rewrites the `ask` back to `allow`. yolo is an explicit
    // full-permissive opt-in, so yolo users are unaffected by the clamp.
    const manager = makeManager({ bash: "allow" }, () => true, {
      invalid: true,
    });
    const result = manager.check({
      kind: "tool",
      surface: "bash",
      input: { command: "echo hi" },
    });
    expect(result.state).toBe("allow");
    expect(result.origin).toBe("yolo");
  });

  it("preserves a hard deny under yolo even with an invalid scope", () => {
    const manager = makeManager({ bash: "deny" }, () => true, {
      invalid: true,
    });
    const result = manager.check({
      kind: "tool",
      surface: "bash",
      input: { command: "rm -rf /" },
    });
    expect(result.state).toBe("deny");
    expect(result.origin).not.toBe("yolo");
  });
});
