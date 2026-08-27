import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupPermissionForwardingLocationIfEmpty,
  ensureDirectoryExists,
  formatUnknownErrorMessage,
  isErrnoCode,
  logPermissionForwardingError,
  logPermissionForwardingWarning,
  readForwardedPermissionRequest,
  readForwardedPermissionResponse,
  tryRemoveDirectoryIfEmpty,
  writeJsonFileAtomic,
} from "#src/authority/forwarding-io";
import {
  createPermissionForwardingLocation,
  type ForwardedAccessIntent,
  type ForwardedPermissionRequest,
} from "#src/authority/permission-forwarding";
import type { DebugReviewLogger } from "#src/session-logger";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

// ── helpers ────────────────────────────────────────────────────────────────

function makeLogger(): DebugReviewLogger {
  return {
    review: vi.fn(),
    debug: vi.fn(),
  };
}

// ── formatUnknownErrorMessage ──────────────────────────────────────────────

describe("formatUnknownErrorMessage", () => {
  it("returns the error message for Error instances", () => {
    expect(formatUnknownErrorMessage(new Error("oops"))).toBe("oops");
  });

  it("converts non-Error values to string", () => {
    expect(formatUnknownErrorMessage("raw string")).toBe("raw string");
    expect(formatUnknownErrorMessage(42)).toBe("42");
  });

  it("falls back to String(error) for Error with empty message", () => {
    // error.message is falsy (""), so the function falls through to String(error)
    const e = new Error("");
    expect(formatUnknownErrorMessage(e)).toBe("Error");
  });
});

// ── isErrnoCode ────────────────────────────────────────────────────────────

describe("isErrnoCode", () => {
  it("returns true when code matches", () => {
    expect(isErrnoCode({ code: "ENOENT" }, "ENOENT")).toBe(true);
  });

  it("returns false when code does not match", () => {
    expect(isErrnoCode({ code: "EACCES" }, "ENOENT")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isErrnoCode(null, "ENOENT")).toBe(false);
  });

  it("returns false when no code property", () => {
    expect(isErrnoCode({}, "ENOENT")).toBe(false);
  });
});

// ── logPermissionForwardingWarning ─────────────────────────────────────────

describe("logPermissionForwardingWarning", () => {
  it("calls logger.review with the warning event", () => {
    const logger = makeLogger();
    logPermissionForwardingWarning(logger, "something went wrong");
    expect(logger.review).toHaveBeenCalledWith(
      "permission_forwarding.warning",
      { message: "something went wrong" },
    );
  });

  it("calls logger.debug with the warning event", () => {
    const logger = makeLogger();
    logPermissionForwardingWarning(logger, "something went wrong");
    expect(logger.debug).toHaveBeenCalledWith("permission_forwarding.warning", {
      message: "something went wrong",
    });
  });

  it("includes formatted error when an error is provided", () => {
    const logger = makeLogger();
    logPermissionForwardingWarning(logger, "bad thing", new Error("fs fail"));
    expect(logger.review).toHaveBeenCalledWith(
      "permission_forwarding.warning",
      { message: "bad thing", error: "fs fail" },
    );
  });

  it("does not throw when logger is null", () => {
    expect(() => logPermissionForwardingWarning(null, "ignored")).not.toThrow();
  });

  it("does not call anything when logger is null", () => {
    // Verify the null-logger path is a true no-op — cannot easily spy on null,
    // but we can verify the call succeeds silently.
    expect(() =>
      logPermissionForwardingWarning(null, "msg", new Error("err")),
    ).not.toThrow();
  });
});

// ── logPermissionForwardingError ───────────────────────────────────────────

describe("logPermissionForwardingError", () => {
  it("calls logger.review with the error event", () => {
    const logger = makeLogger();
    logPermissionForwardingError(logger, "critical failure");
    expect(logger.review).toHaveBeenCalledWith("permission_forwarding.error", {
      message: "critical failure",
    });
  });

  it("calls logger.debug with the error event", () => {
    const logger = makeLogger();
    logPermissionForwardingError(logger, "critical failure");
    expect(logger.debug).toHaveBeenCalledWith("permission_forwarding.error", {
      message: "critical failure",
    });
  });

  it("includes formatted error when an error is provided", () => {
    const logger = makeLogger();
    logPermissionForwardingError(logger, "io error", new Error("ENOENT"));
    expect(logger.review).toHaveBeenCalledWith("permission_forwarding.error", {
      message: "io error",
      error: "ENOENT",
    });
  });

  it("does not throw when logger is null", () => {
    expect(() => logPermissionForwardingError(null, "ignored")).not.toThrow();
  });
});

// ── file permissions ───────────────────────────────────────────────────────

describe("forwarding artifact permissions", () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes a forwarded request owner-only", () => {
    root = mkdtempSync(join(tmpdir(), "io-modes-"));
    const filePath = join(root, "req.json");

    writeJsonFileAtomic(null, filePath, { id: "req-1" });

    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it("creates a forwarding directory owner-only", () => {
    root = mkdtempSync(join(tmpdir(), "io-modes-"));
    const dirPath = join(root, "sessions", "parent", "requests");

    expect(ensureDirectoryExists(null, dirPath, "requests")).toBe(true);

    expect(statSync(dirPath).mode & 0o777).toBe(0o700);
  });
});

// ── readForwardedPermissionRequest ─────────────────────────────────────────

describe("readForwardedPermissionRequest — accessIntent field", () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function baseRequest(): ForwardedPermissionRequest {
    return {
      id: "req-1",
      createdAt: 1000,
      requesterSessionId: "child-session",
      targetSessionId: "parent-session",
      requesterAgentName: "researcher",
      surface: "read",
    };
  }

  function writeAndRead(raw: unknown): ForwardedPermissionRequest | null {
    root = mkdtempSync(join(tmpdir(), "io-read-"));
    const filePath = join(root, "req.json");
    writeJsonFileAtomic(null, filePath, raw);
    return readForwardedPermissionRequest(null, filePath);
  }

  it("round-trips a well-formed access intent (path surface)", () => {
    const accessIntent: ForwardedAccessIntent = {
      surface: "path",
      matchValues: ["/worktree/issue-42/src/foo.ts", "src/foo.ts"],
      boundaryValue: "/worktree/issue-42/src/foo.ts",
      requesterCwd: "/worktree/issue-42",
      principal: { sessionId: "child-session", agentName: "researcher" },
    };
    const parsed = writeAndRead({ ...baseRequest(), accessIntent });
    expect(parsed?.accessIntent).toEqual(accessIntent);
  });

  it("round-trips a non-path access intent (skill surface, null boundary)", () => {
    const accessIntent: ForwardedAccessIntent = {
      surface: "skill",
      matchValues: ["deep-research"],
      boundaryValue: null,
      requesterCwd: "/repo",
      principal: { sessionId: "child-session", agentName: "unknown" },
    };
    const parsed = writeAndRead({ ...baseRequest(), accessIntent });
    expect(parsed?.accessIntent).toEqual(accessIntent);
  });

  it("carries only strings on matchValues (the ADR-0002 wire boundary)", () => {
    const accessIntent: ForwardedAccessIntent = {
      surface: "external_directory",
      matchValues: ["/etc/hosts", "/private/etc/hosts"],
      boundaryValue: "/private/etc/hosts",
      requesterCwd: "/repo",
      principal: { sessionId: "child-session", agentName: "researcher" },
    };
    const parsed = writeAndRead({ ...baseRequest(), accessIntent });
    expect(
      parsed?.accessIntent?.matchValues.every((v) => typeof v === "string"),
    ).toBe(true);
    expect(
      parsed?.accessIntent?.boundaryValue === null ||
        typeof parsed?.accessIntent?.boundaryValue === "string",
    ).toBe(true);
  });

  it("reads a request with no access intent as undefined (version skew)", () => {
    const parsed = writeAndRead(baseRequest());
    expect(parsed?.accessIntent).toBeUndefined();
    // Display/routing fields still reconstruct.
    expect(parsed?.surface).toBe("read");
    expect(parsed?.requesterAgentName).toBe("researcher");
  });

  it("drops a malformed access intent to undefined (non-string match value)", () => {
    const parsed = writeAndRead({
      ...baseRequest(),
      accessIntent: {
        surface: "path",
        matchValues: ["/ok", 42],
        boundaryValue: null,
        requesterCwd: "/repo",
        principal: { sessionId: "child-session", agentName: "researcher" },
      },
    });
    expect(parsed?.accessIntent).toBeUndefined();
  });

  it("drops a malformed access intent to undefined (missing principal)", () => {
    const parsed = writeAndRead({
      ...baseRequest(),
      accessIntent: {
        surface: "path",
        matchValues: ["/ok"],
        boundaryValue: null,
        requesterCwd: "/repo",
      },
    });
    expect(parsed?.accessIntent).toBeUndefined();
  });
});

describe("readForwardedPermissionRequest — payload field", () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function baseRequest(): ForwardedPermissionRequest {
    return {
      id: "req-1",
      createdAt: 1000,
      requesterSessionId: "child-session",
      targetSessionId: "parent-session",
      requesterAgentName: "researcher",
    };
  }

  function writeAndRead(raw: unknown): ForwardedPermissionRequest | null {
    root = mkdtempSync(join(tmpdir(), "io-payload-"));
    const filePath = join(root, "req.json");
    writeJsonFileAtomic(null, filePath, raw);
    return readForwardedPermissionRequest(null, filePath);
  }

  it("round-trips the child's complete prompt payload", () => {
    const payload = makePromptPayload({
      kind: "bash",
      request: {
        requester: { agentName: "Explore", forwarded: false, sessionId: null },
        surface: "bash",
        toolName: "bash",
        invokedToolName: null,
        value: "git push",
        matchedPattern: "git *",
        commandContext: null,
        executedUnit: null,
      },
      evidence: [{ label: "command", text: "git push", detail: null }],
    });
    const parsed = writeAndRead({ ...baseRequest(), payload });
    expect(parsed?.payload).toEqual(payload);
  });

  it("reads a request with no payload as undefined (version skew)", () => {
    const parsed = writeAndRead(baseRequest());
    expect(parsed?.payload).toBeUndefined();
    expect(parsed?.requesterAgentName).toBe("researcher");
  });

  it("drops a payload with an unrecognized kind", () => {
    const parsed = writeAndRead({
      ...baseRequest(),
      payload: { ...makePromptPayload(), kind: "telepathy" },
    });
    expect(parsed?.payload).toBeUndefined();
  });

  it("drops a payload whose request facts are malformed", () => {
    const payload = makePromptPayload();
    const parsed = writeAndRead({
      ...baseRequest(),
      payload: { ...payload, request: { ...payload.request, value: 42 } },
    });
    expect(parsed?.payload).toBeUndefined();
  });

  it("drops a payload whose requester is malformed", () => {
    const payload = makePromptPayload();
    const parsed = writeAndRead({
      ...baseRequest(),
      payload: {
        ...payload,
        request: { ...payload.request, requester: { forwarded: true } },
      },
    });
    expect(parsed?.payload).toBeUndefined();
  });

  it("drops a payload whose evidence entries are malformed", () => {
    const parsed = writeAndRead({
      ...baseRequest(),
      payload: {
        ...makePromptPayload(),
        evidence: [{ label: "command", text: null, detail: null }],
      },
    });
    expect(parsed?.payload).toBeUndefined();
  });

  it("drops a payload whose annotations are malformed", () => {
    const parsed = writeAndRead({
      ...baseRequest(),
      payload: { ...makePromptPayload(), annotations: [{ source: "judge" }] },
    });
    expect(parsed?.payload).toBeUndefined();
  });

  it("accepts a legacy message-only request and reconstructs no message", () => {
    // An older child writes `message` and no `payload`. The required-core gate
    // no longer demands the field, so the request is served (from its display
    // fields) rather than rejected outright — and the sentence is not salvaged.
    const parsed = writeAndRead({
      ...baseRequest(),
      message: "Allow this path access?",
      surface: "read",
      value: "/tmp/x",
    });
    expect(parsed).not.toHaveProperty("message");
    expect(parsed?.surface).toBe("read");
    expect(parsed?.value).toBe("/tmp/x");
    expect(parsed?.payload).toBeUndefined();
  });
});

describe("readForwardedPermissionResponse — decidedBy field", () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeAndRead(raw: unknown) {
    root = mkdtempSync(join(tmpdir(), "io-decided-by-"));
    const filePath = join(root, "res.json");
    writeJsonFileAtomic(null, filePath, raw);
    return readForwardedPermissionResponse(null, filePath);
  }

  function baseResponse() {
    return {
      approved: true,
      state: "approved",
      responderSessionId: "parent-session",
      respondedAt: 1000,
    };
  }

  it("round-trips the responder's decider", () => {
    const decidedBy = { kind: "user", via: "dialog" } as const;

    // The reader rebuilds an allowlist of known fields, so an added one is
    // silently dropped until it is listed — which is invisible to tsc.
    expect(writeAndRead({ ...baseResponse(), decidedBy })?.decidedBy).toEqual(
      decidedBy,
    );
  });

  it("round-trips a nested forwarded decider from a relay hop", () => {
    const decidedBy = {
      kind: "forwarded",
      responderSessionId: "root-session",
      decision: {
        kind: "rule",
        surface: "bash",
        pattern: "*",
        origin: "global",
      },
    } as const;

    expect(writeAndRead({ ...baseResponse(), decidedBy })?.decidedBy).toEqual(
      decidedBy,
    );
  });

  it("drops a malformed decider without rejecting the response", () => {
    const parsed = writeAndRead({
      ...baseResponse(),
      decidedBy: { kind: "user", via: "smoke-signal" },
    });

    // The decision itself still has to reach the child; only its unusable
    // provenance is discarded.
    expect(parsed?.approved).toBe(true);
    expect(parsed?.decidedBy).toBeUndefined();
  });

  it("leaves decidedBy absent for an older responder", () => {
    expect(writeAndRead(baseResponse())?.decidedBy).toBeUndefined();
  });
});

// ── tryRemoveDirectoryIfEmpty ──────────────────────────────────────────────

describe("tryRemoveDirectoryIfEmpty", () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns true when the directory does not exist", () => {
    root = mkdtempSync(join(tmpdir(), "io-test-"));
    const absent = join(root, "nonexistent");
    expect(tryRemoveDirectoryIfEmpty(null, absent, "test")).toBe(true);
  });

  it("returns true and removes an empty directory", () => {
    root = mkdtempSync(join(tmpdir(), "io-test-"));
    const dir = join(root, "empty");
    mkdirSync(dir);
    expect(tryRemoveDirectoryIfEmpty(null, dir, "test")).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it("returns false and leaves a non-empty directory in place", () => {
    root = mkdtempSync(join(tmpdir(), "io-test-"));
    const dir = join(root, "nonempty");
    mkdirSync(dir);
    writeFileSync(join(dir, "file.json"), "{}", "utf-8");
    expect(tryRemoveDirectoryIfEmpty(null, dir, "test")).toBe(false);
    expect(existsSync(dir)).toBe(true);
  });
});

// ── cleanupPermissionForwardingLocationIfEmpty ─────────────────────────────

describe("cleanupPermissionForwardingLocationIfEmpty", () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("preserves responses/ when requests/ is non-empty (the concurrent-request race)", () => {
    root = mkdtempSync(join(tmpdir(), "io-cleanup-"));
    const forwardingDir = join(root, "forwarding");
    const location = createPermissionForwardingLocation(
      forwardingDir,
      "parent-session",
    );
    // Simulate: requests/ has a pending file, responses/ is momentarily empty
    mkdirSync(location.requestsDir, { recursive: true });
    mkdirSync(location.responsesDir, { recursive: true });
    writeFileSync(join(location.requestsDir, "req-b.json"), "{}", "utf-8");
    // responses/ is empty (sibling subagent A already cleaned up its response)

    cleanupPermissionForwardingLocationIfEmpty(null, location);

    // requests/ is non-empty → should NOT be removed
    expect(existsSync(location.requestsDir)).toBe(true);
    // responses/ must survive — removing it causes the ENOENT write loop
    expect(existsSync(location.responsesDir)).toBe(true);
    // sessionRoot must also survive while subdirs are present
    expect(existsSync(location.sessionRootDir)).toBe(true);
  });

  it("removes both subdirs and sessionRoot when both are empty (normal serial cleanup)", () => {
    root = mkdtempSync(join(tmpdir(), "io-cleanup-"));
    const forwardingDir = join(root, "forwarding");
    const location = createPermissionForwardingLocation(
      forwardingDir,
      "parent-session",
    );
    mkdirSync(location.requestsDir, { recursive: true });
    mkdirSync(location.responsesDir, { recursive: true });
    // Both empty — normal end-of-lifecycle state

    cleanupPermissionForwardingLocationIfEmpty(null, location);

    expect(existsSync(location.requestsDir)).toBe(false);
    expect(existsSync(location.responsesDir)).toBe(false);
    expect(existsSync(location.sessionRootDir)).toBe(false);
  });

  it("leaves responses/ in place when it is non-empty even if requests/ is empty", () => {
    root = mkdtempSync(join(tmpdir(), "io-cleanup-"));
    const forwardingDir = join(root, "forwarding");
    const location = createPermissionForwardingLocation(
      forwardingDir,
      "parent-session",
    );
    mkdirSync(location.requestsDir, { recursive: true });
    mkdirSync(location.responsesDir, { recursive: true });
    writeFileSync(join(location.responsesDir, "resp.json"), "{}", "utf-8");
    // requests/ is empty, responses/ has a stale response

    cleanupPermissionForwardingLocationIfEmpty(null, location);

    // requests/ is empty so it gets removed
    expect(existsSync(location.requestsDir)).toBe(false);
    // responses/ is non-empty → survives
    expect(existsSync(location.responsesDir)).toBe(true);
    // sessionRoot survives because responses/ is still present
    expect(existsSync(location.sessionRootDir)).toBe(true);
  });
});
