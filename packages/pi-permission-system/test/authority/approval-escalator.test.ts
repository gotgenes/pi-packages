import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { ParentAuthorizer } from "#src/authority/approval-escalator";
import {
  type ForwardedPermissionRequest,
  PERMISSION_FORWARDING_SERVING_GRACE_MS,
} from "#src/authority/permission-forwarding";
import { ServingSessionRegistry } from "#src/authority/serving-registry";
import {
  createForwardingTempDir,
  makeForwarderContext,
  makeLivenessJudge,
  makeParentAuthorizerDeps,
  makeSubagentRegistry,
  publishServingHeartbeat,
} from "#test/helpers/forwarding-fixtures";
import {
  makePromptDetails,
  makePromptPayload,
} from "#test/helpers/prompt-details-fixtures";

// ── Local poll helper ────────────────────────────────────────────────────
//
// The reverse direction of `ForwardingTempDir.writeRequest`: waits for the
// request file ParentAuthorizer.authorize writes, so the test can respond
// as the parent session would. Real timers/filesystem, matching how
// composition-root.test.ts's forwarding round trip already behaves.

async function waitForRequestFile(
  requestsDir: string,
): Promise<ForwardedPermissionRequest> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    let files: string[] = [];
    try {
      files = readdirSync(requestsDir).filter((f) => f.endsWith(".json"));
    } catch {
      files = [];
    }
    const requestFile = files[0];
    if (requestFile) {
      return JSON.parse(
        readFileSync(join(requestsDir, requestFile), "utf-8"),
      ) as ForwardedPermissionRequest;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for a request file in ${requestsDir}`);
}

// ── ParentAuthorizer ──────────────────────────────────────────────────────

/**
 * Drive one forwarded exchange to completion: escalate, wait for the request
 * file, answer it with `response`, and resolve.
 */
async function exchangeWith(
  temp: ReturnType<typeof createForwardingTempDir>,
  response: Record<string, unknown>,
) {
  const authorizer = new ParentAuthorizer(
    makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
    makeParentAuthorizerDeps({
      forwardingDir: temp.forwardingDir,
      registry: makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      }),
    }),
  );
  const decisionPromise = authorizer.authorize(
    makePromptDetails({ requestId: "perm-child-request" }),
  );
  const request = await waitForRequestFile(temp.location.requestsDir);
  writeFileSync(
    join(temp.location.responsesDir, `${request.id}.json`),
    JSON.stringify(response),
    "utf-8",
  );
  return decisionPromise;
}

describe("ParentAuthorizer provenance relay", () => {
  test("nests the responder's own decider under the forwarding hop", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      // The reported case: a human at the parent, or the parent's policy?
      // The child's own terminal entry has to answer that.
      await expect(
        exchangeWith(temp, {
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
          decidedBy: { kind: "user", via: "dialog" },
        }),
      ).resolves.toMatchObject({
        decidedBy: {
          kind: "forwarded",
          responderSessionId: "parent-session",
          decision: { kind: "user", via: "dialog" },
        },
      });
    } finally {
      temp.cleanup();
    }
  });

  test("still names the responding session when an older parent sends no decider", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      await expect(
        exchangeWith(temp, {
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
      ).resolves.toMatchObject({
        decidedBy: {
          kind: "forwarded",
          responderSessionId: "parent-session",
          decision: null,
        },
      });
    } finally {
      temp.cleanup();
    }
  });

  test("discards a malformed decider rather than relaying a corrupt one", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      await expect(
        exchangeWith(temp, {
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
          decidedBy: { kind: "user", via: "smoke-signal" },
        }),
      ).resolves.toMatchObject({
        decidedBy: {
          kind: "forwarded",
          responderSessionId: "parent-session",
          decision: null,
        },
      });
    } finally {
      temp.cleanup();
    }
  });
});

describe("ParentAuthorizer", () => {
  test("writes a forwarded request carrying the display fields and resolves with the parent's response", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      });
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry,
        }),
      );

      const decisionPromise = authorizer.authorize(
        makePromptDetails({
          requestId: "perm-child-request",
          agentName: "Explore",
          toolName: "bash",
          command: "git push",
        }),
      );

      const request = await waitForRequestFile(temp.location.requestsDir);
      expect(request.targetSessionId).toBe("parent-session");
      expect(request.requesterSessionId).toBe("child-session");
      expect(request.source).toBe("tool_call");
      expect(request.surface).toBe("bash");
      expect(request.value).toBe("git push");

      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );

      // toMatchObject: the response also carries a live respondedAt timestamp
      // and the responderSessionId/denialReason passthrough fields.
      await expect(decisionPromise).resolves.toMatchObject({
        approved: true,
        state: "approved",
      });
    } finally {
      temp.cleanup();
    }
  });

  test("persists the details' sessionApproval suggestion onto the forwarded request", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      });
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry,
        }),
      );

      const decisionPromise = authorizer.authorize(
        makePromptDetails({
          requestId: "perm-child-request",
          agentName: "Explore",
          toolName: "bash",
          command: "git push",
          sessionApproval: { surface: "bash", patterns: ["git *"] },
        }),
      );

      const request = await waitForRequestFile(temp.location.requestsDir);
      expect(request.sessionApproval).toEqual({
        surface: "bash",
        patterns: ["git *"],
      });

      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );
      await decisionPromise;
    } finally {
      temp.cleanup();
    }
  });

  test("stamps the child-fixed access intent with requester identity onto the forwarded request", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      });
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({
          hasUI: false,
          sessionId: "child-session",
          cwd: "/worktree/issue-42",
        }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry,
        }),
      );

      const decisionPromise = authorizer.authorize(
        makePromptDetails({
          requestId: "perm-child-request",
          agentName: "Explore",
          toolName: "read",
          path: "src/foo.ts",
          accessIntent: {
            surface: "path",
            matchValues: ["/worktree/issue-42/src/foo.ts", "src/foo.ts"],
            boundaryValue: "/worktree/issue-42/src/foo.ts",
          },
        }),
      );

      const request = await waitForRequestFile(temp.location.requestsDir);
      // The display fields still ride the same request alongside the structured
      // intent (the #292/#557 non-degraded-broadcast contract must not regress).
      expect(request.source).toBe("tool_call");
      expect(request.surface).toBe("read");
      expect(request.value).toBe("src/foo.ts");
      // requesterCwd comes from ctx.cwd; principal mirrors the request's own
      // computed identity fields (sessionId, requesterAgentName).
      expect(request.accessIntent).toEqual({
        surface: "path",
        matchValues: ["/worktree/issue-42/src/foo.ts", "src/foo.ts"],
        boundaryValue: "/worktree/issue-42/src/foo.ts",
        requesterCwd: "/worktree/issue-42",
        principal: {
          sessionId: request.requesterSessionId,
          agentName: request.requesterAgentName,
        },
      });

      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );
      await decisionPromise;
    } finally {
      temp.cleanup();
    }
  });

  test("relays the details' prompt payload onto the forwarded request", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      });
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry,
        }),
      );

      const payload = makePromptPayload({
        kind: "bash",
        request: {
          requester: {
            agentName: "Explore",
            forwarded: false,
            sessionId: null,
          },
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
      const decisionPromise = authorizer.authorize(
        makePromptDetails({
          requestId: "perm-child-request",
          agentName: "Explore",
          toolName: "bash",
          command: "git push",
          payload,
        }),
      );

      const request = await waitForRequestFile(temp.location.requestsDir);
      expect(request.payload).toEqual(payload);

      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );
      await decisionPromise;
    } finally {
      temp.cleanup();
    }
  });

  test("omits accessIntent from the request when the details carry none", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      });
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry,
        }),
      );

      const decisionPromise = authorizer.authorize(
        makePromptDetails({
          requestId: "perm-child-request",
          agentName: "Explore",
          toolName: "read",
        }),
      );

      const request = await waitForRequestFile(temp.location.requestsDir);
      expect(request.accessIntent).toBeUndefined();

      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );
      await decisionPromise;
    } finally {
      temp.cleanup();
    }
  });

  test("omits sessionApproval from the request when the details carry none", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      });
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry,
        }),
      );

      const decisionPromise = authorizer.authorize(
        makePromptDetails({
          requestId: "perm-child-request",
          agentName: "Explore",
          toolName: "read",
        }),
      );

      const request = await waitForRequestFile(temp.location.requestsDir);
      expect(request.sessionApproval).toBeUndefined();

      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );
      await decisionPromise;
    } finally {
      temp.cleanup();
    }
  });

  test("returns denied when the response marks the request denied", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      });
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry,
        }),
      );

      const decisionPromise = authorizer.authorize(
        makePromptDetails({
          requestId: "perm-child-request",
          agentName: "Explore",
          toolName: "read",
        }),
      );

      const request = await waitForRequestFile(temp.location.requestsDir);
      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: false,
          state: "denied",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );

      // toMatchObject: see the approved-path test for why this isn't toEqual.
      await expect(decisionPromise).resolves.toMatchObject({
        approved: false,
        state: "denied",
      });
    } finally {
      temp.cleanup();
    }
  });

  test("adopts the requester's request id as the forwarded request id", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
        }),
      );

      const decisionPromise = authorizer.authorize(
        makePromptDetails({ requestId: "perm-child-request" }),
      );

      const request = await waitForRequestFile(temp.location.requestsDir);
      expect(request.id).toBe("perm-child-request");

      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({ approved: true, state: "approved" }),
        "utf-8",
      );
      await decisionPromise;
    } finally {
      temp.cleanup();
    }
  });

  test("mints a fresh id when the requester's is not filename-safe", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
        }),
      );

      const decisionPromise = authorizer.authorize(
        makePromptDetails({ requestId: "../../escape" }),
      );

      const request = await waitForRequestFile(temp.location.requestsDir);
      expect(request.id).toMatch(/^perm-/);

      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({ approved: true, state: "approved" }),
        "utf-8",
      );
      await decisionPromise;
    } finally {
      temp.cleanup();
    }
  });
});

// ── Abandonment ─────────────────────────────────────────────────────
//
// Every path where ParentAuthorizer gives up without a human having ruled must
// be distinguishable from a user denial — `confirmationUnavailable` selects the
// "no authority could answer" block message, and `denialReason` says which
// path (#719).

const forwardedAsk = makePromptDetails({
  requestId: "perm-child-request",
  agentName: "Explore",
  toolName: "bash",
});

/**
 * The shape every abandonment resolves to.
 *
 * `denialReason` and the provenance `reason` are the same value by
 * construction: the string that names which path gave up is the string the
 * record attributes it to, so the two cannot drift (#726).
 */
function unavailableDecision(denialReason: unknown) {
  return {
    approved: false,
    state: "denied",
    confirmationUnavailable: true,
    denialReason,
    decidedBy: { kind: "unavailable", reason: denialReason },
  };
}

describe("ParentAuthorizer abandonment", () => {
  test("reports an unresolvable target as unavailable, not user-denied", async () => {
    const authorizer = new ParentAuthorizer(
      makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
      makeParentAuthorizerDeps({
        registry: makeSubagentRegistry("child-session"),
      }),
    );

    await expect(authorizer.authorize({ ...forwardedAsk })).resolves.toEqual(
      unavailableDecision(
        "Could not resolve a parent session to forward this permission request to",
      ),
    );
  });

  test("reports unusable forwarding directories as unavailable", async () => {
    const root = mkdtempSync(join(tmpdir(), "permission-forwarding-blocked-"));
    try {
      // A file where the forwarding root must be a directory: every mkdir
      // beneath it fails with ENOTDIR.
      const forwardingDir = join(root, "forwarding");
      writeFileSync(forwardingDir, "not a directory", "utf-8");

      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
        }),
      );

      await expect(authorizer.authorize({ ...forwardedAsk })).resolves.toEqual(
        unavailableDecision(
          "Permission forwarding directories could not be prepared for session 'parent-session'",
        ),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports an unwritable request as unavailable", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      // Deny writes into requests/ so writeJsonFileAtomic's temp write fails.
      chmodSync(temp.location.requestsDir, 0o500);

      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
        }),
      );

      await expect(authorizer.authorize({ ...forwardedAsk })).resolves.toEqual(
        unavailableDecision(
          "The forwarded permission request could not be written",
        ),
      );
      // The directories it created for an exchange that never happened are
      // cleaned up, so the chmod'd directory is already gone.
      expect(existsSync(temp.location.requestsDir)).toBe(false);
    } finally {
      if (existsSync(temp.location.requestsDir)) {
        chmodSync(temp.location.requestsDir, 0o700);
      }
      temp.cleanup();
    }
  });

  test("reports an unreadable response as unavailable, not as the parent's denial", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
        }),
      );

      const decisionPromise = authorizer.authorize({ ...forwardedAsk });
      const request = await waitForRequestFile(temp.location.requestsDir);
      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        "{ not json",
        "utf-8",
      );

      await expect(decisionPromise).resolves.toEqual(
        unavailableDecision(
          "The parent session's permission response could not be read",
        ),
      );
    } finally {
      temp.cleanup();
    }
  });

  test("reports an unanswered request as timed out, not user-denied", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
          getTimeoutMs: () => 400,
        }),
      );

      await expect(authorizer.authorize({ ...forwardedAsk })).resolves.toEqual(
        unavailableDecision(
          "Session 'parent-session' did not answer within 0.4s",
        ),
      );
    } finally {
      temp.cleanup();
    }
  });

  test("abandons quickly when an in-process target is not serving", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
          // Nobody has marked themselves as serving.
          serving: makeLivenessJudge({ forwardingDir: temp.forwardingDir }),
          getTimeoutMs: () => 60_000,
        }),
      );

      const started = Date.now();
      await expect(authorizer.authorize({ ...forwardedAsk })).resolves.toEqual(
        unavailableDecision(
          "Session 'parent-session' is not serving forwarded permission requests",
        ),
      );
      expect(Date.now() - started).toBeLessThan(60_000);
    } finally {
      temp.cleanup();
    }
  });

  test("keeps waiting while the in-process target is serving", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = new ServingSessionRegistry();
      registry.markServing("parent-session");
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
          serving: makeLivenessJudge({
            forwardingDir: temp.forwardingDir,
            registry,
          }),
          getTimeoutMs: () => 60_000,
        }),
      );

      const decisionPromise = authorizer.authorize({ ...forwardedAsk });
      const request = await waitForRequestFile(temp.location.requestsDir);
      // Well past the unserved grace window: a serving target must not be
      // abandoned no matter how long the human deliberates.
      await new Promise((resolve) =>
        setTimeout(resolve, PERMISSION_FORWARDING_SERVING_GRACE_MS + 250),
      );
      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );

      await expect(decisionPromise).resolves.toMatchObject({
        approved: true,
        state: "approved",
      });
    } finally {
      temp.cleanup();
    }
  });

  test("abandons quickly when an out-of-process target published no heartbeat", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "parent-session");
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          // No registry entry, so the target resolves from the environment: a
          // parent in another process, reachable only through the filesystem.
          registry: makeSubagentRegistry("child-session"),
          serving: makeLivenessJudge({ forwardingDir: temp.forwardingDir }),
          getTimeoutMs: () => 60_000,
        }),
      );

      const started = Date.now();
      await expect(authorizer.authorize({ ...forwardedAsk })).resolves.toEqual(
        unavailableDecision(
          "Session 'parent-session' is not serving forwarded permission requests",
        ),
      );
      expect(Date.now() - started).toBeLessThan(60_000);
    } finally {
      vi.unstubAllEnvs();
      temp.cleanup();
    }
  });

  test("abandons quickly when an out-of-process target's process is gone", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "parent-session");
      publishServingHeartbeat(temp.forwardingDir, "parent-session", 4242);
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session"),
          serving: makeLivenessJudge({
            forwardingDir: temp.forwardingDir,
            isProcessAlive: () => false,
          }),
          getTimeoutMs: () => 60_000,
        }),
      );

      await expect(authorizer.authorize({ ...forwardedAsk })).resolves.toEqual(
        unavailableDecision(
          "Session 'parent-session' is not serving forwarded permission requests",
        ),
      );
    } finally {
      vi.unstubAllEnvs();
      temp.cleanup();
    }
  });

  test("keeps waiting while an out-of-process target's heartbeat is fresh", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "parent-session");
      publishServingHeartbeat(temp.forwardingDir, "parent-session");
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session"),
          serving: makeLivenessJudge({ forwardingDir: temp.forwardingDir }),
          getTimeoutMs: () => 60_000,
        }),
      );

      const decisionPromise = authorizer.authorize({ ...forwardedAsk });
      const request = await waitForRequestFile(temp.location.requestsDir);
      // Well past the grace window: a live parent must not be abandoned no
      // matter how long the human deliberates.
      await new Promise((resolve) =>
        setTimeout(resolve, PERMISSION_FORWARDING_SERVING_GRACE_MS + 250),
      );
      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );

      await expect(decisionPromise).resolves.toMatchObject({
        approved: true,
        state: "approved",
      });
    } finally {
      vi.unstubAllEnvs();
      temp.cleanup();
    }
  });

  test("records which channel answered and what it saw when it gives up", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "parent-session");
      publishServingHeartbeat(temp.forwardingDir, "other-parent");
      const logger = { review: vi.fn(), debug: vi.fn() };
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session"),
          serving: makeLivenessJudge({ forwardingDir: temp.forwardingDir }),
          getTimeoutMs: () => 60_000,
          logger,
        }),
      );

      await authorizer.authorize({ ...forwardedAsk });

      expect(logger.review).toHaveBeenCalledWith(
        "forwarded_permission.no_serving_session",
        expect.objectContaining({
          requesterSessionId: "child-session",
          targetSessionId: "parent-session",
          servingChannel: "heartbeat",
          servingState: "absent",
          servingSessionIds: ["other-parent"],
        }),
      );
    } finally {
      vi.unstubAllEnvs();
      temp.cleanup();
    }
  });

  test("deletes the request it abandoned so the parent cannot answer it later", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
          getTimeoutMs: () => 400,
        }),
      );

      await authorizer.authorize({ ...forwardedAsk });

      expect(existsSync(temp.location.requestsDir)).toBe(false);
    } finally {
      temp.cleanup();
    }
  });
});
