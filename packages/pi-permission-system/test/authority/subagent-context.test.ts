import { afterEach, describe, expect, test, vi } from "vitest";
import { SUBAGENT_ENV_HINT_KEYS } from "#src/authority/permission-forwarding";
import {
  isRegisteredSubagentChild,
  isSubagentExecutionContext,
  normalizeFilesystemPath,
  type SubagentDetectionContext,
} from "#src/authority/subagent-context";
import {
  getSubagentSessionRegistry,
  SubagentSessionRegistry,
} from "#src/authority/subagent-registry";
import { posixPathFlavor, win32PathFlavor } from "#src/path/path-flavor";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function makeCtx(
  sessionDir: string | null,
  sessionId: string = "",
): SubagentDetectionContext {
  return {
    sessionManager: {
      getSessionDir: vi.fn(() => sessionDir ?? ""),
      getSessionId: vi.fn(() => sessionId),
    },
  };
}

describe("isRegisteredSubagentChild", () => {
  const childSessionId = "child-session-abc";

  test("returns true when the session id is registered", () => {
    const registry = new SubagentSessionRegistry();
    registry.register(childSessionId, {});
    expect(
      isRegisteredSubagentChild(makeCtx(null, childSessionId), registry),
    ).toBe(true);
  });

  test("returns false when the session id is not registered", () => {
    const registry = new SubagentSessionRegistry();
    expect(
      isRegisteredSubagentChild(makeCtx(null, childSessionId), registry),
    ).toBe(false);
  });

  test("returns false when the session id is empty", () => {
    const registry = new SubagentSessionRegistry();
    registry.register("", {});
    expect(isRegisteredSubagentChild(makeCtx(null, ""), registry)).toBe(false);
  });

  test("returns false when getSessionId throws", () => {
    const registry = new SubagentSessionRegistry();
    registry.register(childSessionId, {});
    const ctx: SubagentDetectionContext = {
      sessionManager: {
        getSessionDir: vi.fn(() => ""),
        getSessionId: vi.fn(() => {
          throw new Error("session id unavailable");
        }),
      },
    };
    expect(isRegisteredSubagentChild(ctx, registry)).toBe(false);
  });
});

describe("isRegisteredSubagentChild (public one-arg form)", () => {
  test("reads from the process-global subagent session registry", () => {
    const sessionId = "global-child-session";
    const registry = getSubagentSessionRegistry();
    registry.register(sessionId, {});

    try {
      expect(isRegisteredSubagentChild(makeCtx(null, sessionId))).toBe(true);
    } finally {
      registry.unregister(sessionId);
    }
  });
});

describe("normalizeFilesystemPath", () => {
  test("normalizes a simple absolute path", () => {
    expect(normalizeFilesystemPath("/projects/my-app", posixPathFlavor)).toBe(
      "/projects/my-app",
    );
  });

  test("collapses redundant separators", () => {
    expect(normalizeFilesystemPath("/projects//my-app", posixPathFlavor)).toBe(
      "/projects/my-app",
    );
  });

  test("resolves . and .. segments", () => {
    expect(
      normalizeFilesystemPath("/projects/my-app/../other", posixPathFlavor),
    ).toBe("/projects/other");
  });

  test("win32: lowercases and normalizes with win32 separators", () => {
    expect(
      normalizeFilesystemPath("C:\\Projects\\My-App", win32PathFlavor),
    ).toBe("c:\\projects\\my-app");
  });

  test("posix: leaves case untouched", () => {
    expect(normalizeFilesystemPath("/Projects/My-App", posixPathFlavor)).toBe(
      "/Projects/My-App",
    );
  });
});

describe("isSubagentExecutionContext — injected platform (#510)", () => {
  test("win32: detects a subagent session dir case-insensitively", () => {
    const subagentRoot = "C:\\Sessions\\Subagents";
    const sessionDir = "c:\\sessions\\subagents\\child";
    expect(
      isSubagentExecutionContext(
        makeCtx(sessionDir),
        subagentRoot,
        win32PathFlavor,
      ),
    ).toBe(true);
  });

  test("posix: the same mixed-case dir is not a subagent context", () => {
    const subagentRoot = "/Sessions/Subagents";
    const sessionDir = "/sessions/subagents/child";
    expect(
      isSubagentExecutionContext(
        makeCtx(sessionDir),
        subagentRoot,
        posixPathFlavor,
      ),
    ).toBe(false);
  });
});

describe("isSubagentExecutionContext — env hint detection", () => {
  test("returns true when PI_IS_SUBAGENT is set", () => {
    vi.stubEnv("PI_IS_SUBAGENT", "true");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("returns true when PI_SUBAGENT_SESSION_ID is set", () => {
    vi.stubEnv("PI_SUBAGENT_SESSION_ID", "abc123");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("returns true when PI_AGENT_ROUTER_SUBAGENT is set", () => {
    vi.stubEnv("PI_AGENT_ROUTER_SUBAGENT", "1");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  // nicobailon/pi-subagents keys
  test("returns true when PI_SUBAGENT_CHILD is set", () => {
    vi.stubEnv("PI_SUBAGENT_CHILD", "1");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("returns true when PI_SUBAGENT_RUN_ID is set", () => {
    vi.stubEnv("PI_SUBAGENT_RUN_ID", "run-abc");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("returns true when PI_SUBAGENT_CHILD_AGENT is set", () => {
    vi.stubEnv("PI_SUBAGENT_CHILD_AGENT", "worker");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("returns true when PI_SUBAGENT_DEPTH is set", () => {
    vi.stubEnv("PI_SUBAGENT_DEPTH", "1");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("returns true when PI_SUBAGENT_DEPTH is zero (depth-0 is still a subagent context)", () => {
    vi.stubEnv("PI_SUBAGENT_DEPTH", "0");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  // HazAT/pi-interactive-subagents keys
  test("returns true when PI_SUBAGENT_NAME is set", () => {
    vi.stubEnv("PI_SUBAGENT_NAME", "my-agent");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("returns true when PI_SUBAGENT_ID is set", () => {
    vi.stubEnv("PI_SUBAGENT_ID", "id-xyz");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("returns true when PI_SUBAGENT_SESSION is set", () => {
    vi.stubEnv("PI_SUBAGENT_SESSION", "session-xyz");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("returns true when PI_SUBAGENT_ACTIVITY_FILE is set", () => {
    vi.stubEnv("PI_SUBAGENT_ACTIVITY_FILE", "/tmp/activity.json");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("covers all declared SUBAGENT_ENV_HINT_KEYS", () => {
    // Verify the keys we test match what the module declares.
    expect(SUBAGENT_ENV_HINT_KEYS).toContain("PI_IS_SUBAGENT");
    expect(SUBAGENT_ENV_HINT_KEYS).toContain("PI_SUBAGENT_SESSION_ID");
    expect(SUBAGENT_ENV_HINT_KEYS).toContain("PI_AGENT_ROUTER_SUBAGENT");
    // nicobailon/pi-subagents
    expect(SUBAGENT_ENV_HINT_KEYS).toContain("PI_SUBAGENT_CHILD");
    expect(SUBAGENT_ENV_HINT_KEYS).toContain("PI_SUBAGENT_RUN_ID");
    expect(SUBAGENT_ENV_HINT_KEYS).toContain("PI_SUBAGENT_CHILD_AGENT");
    expect(SUBAGENT_ENV_HINT_KEYS).toContain("PI_SUBAGENT_DEPTH");
    // HazAT/pi-interactive-subagents
    expect(SUBAGENT_ENV_HINT_KEYS).toContain("PI_SUBAGENT_NAME");
    expect(SUBAGENT_ENV_HINT_KEYS).toContain("PI_SUBAGENT_ID");
    expect(SUBAGENT_ENV_HINT_KEYS).toContain("PI_SUBAGENT_SESSION");
    expect(SUBAGENT_ENV_HINT_KEYS).toContain("PI_SUBAGENT_ACTIVITY_FILE");
  });

  test("returns false when env hint value is empty string", () => {
    vi.stubEnv("PI_IS_SUBAGENT", "");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("returns false when env hint value is whitespace only", () => {
    vi.stubEnv("PI_IS_SUBAGENT", "   ");
    expect(
      isSubagentExecutionContext(
        makeCtx(null),
        "/sessions/subagents",
        posixPathFlavor,
      ),
    ).toBe(false);
  });
});

describe("isSubagentExecutionContext — session dir detection", () => {
  const subagentRoot = "/home/user/.pi/agent/sessions/subagents";

  test("returns true when session dir is within subagent root", () => {
    const sessionDir = `${subagentRoot}/session-abc`;
    expect(
      isSubagentExecutionContext(
        makeCtx(sessionDir),
        subagentRoot,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("returns true when session dir equals subagent root", () => {
    expect(
      isSubagentExecutionContext(
        makeCtx(subagentRoot),
        subagentRoot,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("returns false when session dir is outside subagent root", () => {
    const sessionDir = "/home/user/.pi/agent/sessions/main-session";
    expect(
      isSubagentExecutionContext(
        makeCtx(sessionDir),
        subagentRoot,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("returns false when session dir is a sibling with shared prefix", () => {
    // "/sessions/subagents-extra" should not match root "/sessions/subagents"
    const sessionDir = `${subagentRoot}-extra/session-abc`;
    expect(
      isSubagentExecutionContext(
        makeCtx(sessionDir),
        subagentRoot,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("returns false when a `..` segment escapes the subagent root", () => {
    // Normalizes to /home/user/.pi/agent/sessions/evil/session-abc — outside.
    const sessionDir = `${subagentRoot}/../evil/session-abc`;
    expect(
      isSubagentExecutionContext(
        makeCtx(sessionDir),
        subagentRoot,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("returns true when a `..` segment resolves back inside the root", () => {
    // Normalizes to /home/user/.pi/agent/sessions/subagents/session-abc — inside.
    const sessionDir = `${subagentRoot}/nested/../session-abc`;
    expect(
      isSubagentExecutionContext(
        makeCtx(sessionDir),
        subagentRoot,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("returns false when session dir is under a different root", () => {
    const sessionDir = "/var/other/subagents/session-abc";
    expect(
      isSubagentExecutionContext(
        makeCtx(sessionDir),
        subagentRoot,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("returns false when getSessionDir returns null", () => {
    expect(
      isSubagentExecutionContext(makeCtx(null), subagentRoot, posixPathFlavor),
    ).toBe(false);
  });

  test("returns false when getSessionDir returns empty string", () => {
    expect(
      isSubagentExecutionContext(makeCtx(""), subagentRoot, posixPathFlavor),
    ).toBe(false);
  });
});

describe("isSubagentExecutionContext — session dir detection (win32 flavor)", () => {
  const subagentRoot = "C:\\Users\\dev\\.pi\\agent\\sessions\\subagents";

  test("returns true when session dir is within subagent root", () => {
    const sessionDir = `${subagentRoot}\\session-abc`;
    expect(
      isSubagentExecutionContext(
        makeCtx(sessionDir),
        subagentRoot,
        win32PathFlavor,
      ),
    ).toBe(true);
  });

  test("returns true when session dir equals subagent root (case-insensitive)", () => {
    expect(
      isSubagentExecutionContext(
        makeCtx(subagentRoot.toUpperCase()),
        subagentRoot,
        win32PathFlavor,
      ),
    ).toBe(true);
  });

  test("returns false when session dir is a sibling with shared prefix", () => {
    const sessionDir = `${subagentRoot}-extra\\session-abc`;
    expect(
      isSubagentExecutionContext(
        makeCtx(sessionDir),
        subagentRoot,
        win32PathFlavor,
      ),
    ).toBe(false);
  });

  test("returns false when a `..` segment escapes the subagent root", () => {
    const sessionDir = `${subagentRoot}\\..\\evil\\session-abc`;
    expect(
      isSubagentExecutionContext(
        makeCtx(sessionDir),
        subagentRoot,
        win32PathFlavor,
      ),
    ).toBe(false);
  });

  test("returns false when session dir is on a different drive", () => {
    const sessionDir =
      "D:\\Users\\dev\\.pi\\agent\\sessions\\subagents\\session-abc";
    expect(
      isSubagentExecutionContext(
        makeCtx(sessionDir),
        subagentRoot,
        win32PathFlavor,
      ),
    ).toBe(false);
  });
});

describe("isSubagentExecutionContext — registry detection", () => {
  const subagentRoot = "/home/user/.pi/agent/sessions/subagents";
  const outsideDir =
    "/home/user/projects/my-app/.pi/agent/sessions/parent/tasks";
  const childSessionId = "child-session-abc";

  test("returns true when session id is registered (no env vars, dir outside filesystem root)", () => {
    const registry = new SubagentSessionRegistry();
    registry.register(childSessionId, {});
    expect(
      isSubagentExecutionContext(
        makeCtx(outsideDir, childSessionId),
        subagentRoot,
        posixPathFlavor,
        registry,
      ),
    ).toBe(true);
  });

  test("returns true when registered session has a parentSessionId", () => {
    const registry = new SubagentSessionRegistry();
    registry.register(childSessionId, { parentSessionId: "parent-123" });
    expect(
      isSubagentExecutionContext(
        makeCtx(outsideDir, childSessionId),
        subagentRoot,
        posixPathFlavor,
        registry,
      ),
    ).toBe(true);
  });

  test("returns false when registry is provided but session id is not registered", () => {
    const registry = new SubagentSessionRegistry();
    expect(
      isSubagentExecutionContext(
        makeCtx(outsideDir, childSessionId),
        subagentRoot,
        posixPathFlavor,
        registry,
      ),
    ).toBe(false);
  });

  test("returns false when session id is empty and registry has no matching entry", () => {
    const registry = new SubagentSessionRegistry();
    expect(
      isSubagentExecutionContext(
        makeCtx(null, ""),
        subagentRoot,
        posixPathFlavor,
        registry,
      ),
    ).toBe(false);
  });

  test("registry check takes priority over env var detection", () => {
    // Registry says registered; env var not set — should still return true.
    const registry = new SubagentSessionRegistry();
    registry.register(childSessionId, {});
    // Confirm no env var is set
    expect(process.env.PI_IS_SUBAGENT).toBeUndefined();
    expect(
      isSubagentExecutionContext(
        makeCtx(outsideDir, childSessionId),
        subagentRoot,
        posixPathFlavor,
        registry,
      ),
    ).toBe(true);
  });

  test("unregistered session falls through to env var detection", () => {
    vi.stubEnv("PI_IS_SUBAGENT", "true");
    const registry = new SubagentSessionRegistry(); // empty — childSessionId not registered
    // Env var present → still true even without registry entry
    expect(
      isSubagentExecutionContext(
        makeCtx(outsideDir, childSessionId),
        subagentRoot,
        posixPathFlavor,
        registry,
      ),
    ).toBe(true);
  });

  test("no registry passed — existing behaviour unchanged", () => {
    // Ensure the parameter is truly optional (no registry arg)
    expect(
      isSubagentExecutionContext(makeCtx(null), subagentRoot, posixPathFlavor),
    ).toBe(false);
  });
});
