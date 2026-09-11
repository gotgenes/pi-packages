import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createPermissionForwardingLocation,
  isForwardedPermissionRequestForSession,
  resolvePermissionForwardingTarget,
  SUBAGENT_PARENT_SESSION_ENV_CANDIDATES,
  SUBAGENT_PARENT_SESSION_ENV_KEY,
} from "#src/authority/permission-forwarding";
import { makeSubagentRegistry } from "#test/helpers/forwarding-fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SUBAGENT_PARENT_SESSION_ENV_CANDIDATES", () => {
  test("is an array containing PI_AGENT_ROUTER_PARENT_SESSION_ID", () => {
    expect(Array.isArray(SUBAGENT_PARENT_SESSION_ENV_CANDIDATES)).toBe(true);
    expect(SUBAGENT_PARENT_SESSION_ENV_CANDIDATES).toContain(
      "PI_AGENT_ROUTER_PARENT_SESSION_ID",
    );
  });

  test("contains PI_SUBAGENT_PARENT_SESSION for CLI-based subagent extensions", () => {
    expect(SUBAGENT_PARENT_SESSION_ENV_CANDIDATES).toContain(
      "PI_SUBAGENT_PARENT_SESSION",
    );
  });

  test("deprecated SUBAGENT_PARENT_SESSION_ENV_KEY equals the first candidate", () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- test verifying the deprecated alias
    expect(SUBAGENT_PARENT_SESSION_ENV_KEY).toBe(
      SUBAGENT_PARENT_SESSION_ENV_CANDIDATES[0],
    );
  });
});

describe("resolvePermissionForwardingTarget", () => {
  test("isSubagent=false returns null", () => {
    expect(
      resolvePermissionForwardingTarget({
        isSubagent: false,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-session-abc" },
      }),
    ).toBeNull();
  });

  test("isSubagent=true, no candidates set returns null", () => {
    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: {},
      }),
    ).toBeNull();
  });

  test("isSubagent=true, PI_AGENT_ROUTER_PARENT_SESSION_ID set returns its value", () => {
    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-session-abc" },
      }),
    ).toEqual({ sessionId: "parent-session-abc", source: "env" });
  });

  test("isSubagent=true, PI_SUBAGENT_PARENT_SESSION resolves when PI_AGENT_ROUTER_PARENT_SESSION_ID is absent", () => {
    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: {
          PI_SUBAGENT_PARENT_SESSION: "parent-from-convention",
        },
      }),
    ).toEqual({ sessionId: "parent-from-convention", source: "env" });
  });

  test("isSubagent=true, PI_AGENT_ROUTER_PARENT_SESSION_ID takes precedence over PI_SUBAGENT_PARENT_SESSION", () => {
    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: {
          PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-from-router",
          PI_SUBAGENT_PARENT_SESSION: "parent-from-convention",
        },
      }),
    ).toEqual({ sessionId: "parent-from-router", source: "env" });
  });

  test("isSubagent=true, candidate value is empty string returns null", () => {
    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "" },
      }),
    ).toBeNull();
  });

  test("isSubagent=true, candidate value is 'unknown' returns null", () => {
    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "unknown" },
      }),
    ).toBeNull();
  });

  // A request written into your own inbox is drained by a watcher you are not
  // running, so it can never be answered. A spawner's marker is overwritten
  // with the child's own id when the child's own copy of that extension does
  // not recognize it as a child (#907).
  test("skips a candidate naming the requesting session and takes the next", () => {
    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: {
          PI_AGENT_ROUTER_PARENT_SESSION_ID: "session-xyz",
          PI_SUBAGENT_PARENT_SESSION: "parent-from-convention",
        },
      }),
    ).toEqual({ sessionId: "parent-from-convention", source: "env" });
  });

  test("returns null when the only candidate names the requesting session", () => {
    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: { PI_SUBAGENT_PARENT_SESSION: "session-xyz" },
      }),
    ).toBeNull();
  });

  test("skips a self-naming candidate that is whitespace-padded", () => {
    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        currentSessionId: " session-xyz ",
        env: { PI_SUBAGENT_PARENT_SESSION: "  session-xyz  " },
      }),
    ).toBeNull();
  });

  test("env defaults to process.env when omitted", () => {
    vi.stubEnv("PI_AGENT_ROUTER_PARENT_SESSION_ID", "env-session-abc");
    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
      }),
    ).toEqual({ sessionId: "env-session-abc", source: "env" });
  });
});

describe("resolvePermissionForwardingTarget — registry resolution", () => {
  const childSessionId = "child-session-abc";

  test("returns parentSessionId from registry when env vars are absent", () => {
    const registry = makeSubagentRegistry(childSessionId, {
      parentSessionId: "parent-from-registry",
    });

    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        sessionId: childSessionId,
        registry,
        env: {},
      }),
    ).toEqual({ sessionId: "parent-from-registry", source: "registry" });
  });

  test("registry takes priority over env vars", () => {
    const registry = makeSubagentRegistry(childSessionId, {
      parentSessionId: "parent-from-registry",
    });

    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        sessionId: childSessionId,
        registry,
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-from-env" },
      }),
    ).toEqual({ sessionId: "parent-from-registry", source: "registry" });
  });

  test("falls through to env vars when the registry entry names the requesting session", () => {
    const registry = makeSubagentRegistry(childSessionId, {
      parentSessionId: childSessionId,
    });

    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        currentSessionId: childSessionId,
        sessionId: childSessionId,
        registry,
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-from-env" },
      }),
    ).toEqual({ sessionId: "parent-from-env", source: "env" });
  });

  test("falls through to env vars when registry entry has no parentSessionId", () => {
    const registry = makeSubagentRegistry(childSessionId, {}); // no parentSessionId

    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        sessionId: childSessionId,
        registry,
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-from-env" },
      }),
    ).toEqual({ sessionId: "parent-from-env", source: "env" });
  });

  test("falls through to env vars when sessionId is not in registry", () => {
    const registry = makeSubagentRegistry(childSessionId); // empty

    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        sessionId: childSessionId,
        registry,
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-from-env" },
      }),
    ).toEqual({ sessionId: "parent-from-env", source: "env" });
  });

  test("returns null when registry entry has no parentSessionId and no env vars set", () => {
    const registry = makeSubagentRegistry(childSessionId, {}); // no parentSessionId

    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        sessionId: childSessionId,
        registry,
        env: {},
      }),
    ).toBeNull();
  });

  test("omitting registry preserves existing behaviour", () => {
    expect(
      resolvePermissionForwardingTarget({
        isSubagent: true,
        sessionId: childSessionId,
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-from-env" },
      }),
    ).toEqual({ sessionId: "parent-from-env", source: "env" });
  });
});

// ---------------------------------------------------------------------------
// Moved from permission-system.test.ts catch-all (#342)
// ---------------------------------------------------------------------------

test("Permission forwarding resolves the parent interactive session from subagent runtime env", () => {
  const target = resolvePermissionForwardingTarget({
    isSubagent: true,
    currentSessionId: "child-session",
    env: {
      PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-session",
    },
  });

  expect(target).toEqual({ sessionId: "parent-session", source: "env" });
});

test("Permission forwarding does not guess a target session when subagent runtime env is missing", () => {
  const target = resolvePermissionForwardingTarget({
    isSubagent: true,
    currentSessionId: "child-session",
    env: {},
  });

  expect(target).toBe(null);
});

test("Permission forwarding uses session-scoped directories per interactive session", () => {
  const forwardingRoot = join(tmpdir(), "pi-permission-system-forwarding-root");
  const sessionA = createPermissionForwardingLocation(
    forwardingRoot,
    "session-a",
  );
  const sessionB = createPermissionForwardingLocation(
    forwardingRoot,
    "session-b",
  );

  expect(sessionA.sessionRootDir).not.toBe(sessionB.sessionRootDir);
  expect(sessionA.requestsDir).not.toBe(sessionB.requestsDir);
  expect(sessionA.responsesDir).not.toBe(sessionB.responsesDir);
});

test("Permission forwarding request routing only matches the intended UI session", () => {
  expect(
    isForwardedPermissionRequestForSession(
      { targetSessionId: "session-a" },
      "session-a",
    ),
  ).toBe(true);
  expect(
    isForwardedPermissionRequestForSession(
      { targetSessionId: "session-a" },
      "session-b",
    ),
  ).toBe(false);
});

test("Permission forwarding rejects unresolved sentinel session ids", () => {
  const target = resolvePermissionForwardingTarget({
    isSubagent: false,
    currentSessionId: "unknown",
  });

  expect(target).toBe(null);
});
