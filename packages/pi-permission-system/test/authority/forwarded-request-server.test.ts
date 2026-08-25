import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  test,
  vi,
} from "vitest";
import { buildResolvedIntentFromMatchValues } from "#src/access-intent/input-normalizer";
import type { Authorizer } from "#src/authority/authorizer";
import { AuthorizerRegistry } from "#src/authority/authorizer-registry";
import { AuthorizerSelection } from "#src/authority/authorizer-selection";
import { encloseInDelegationEnvelope } from "#src/authority/delegation-envelope";
import {
  ForwardedRequestServer,
  type ForwardedRequestServerDeps,
} from "#src/authority/forwarded-request-server";
import type { ForwarderContext } from "#src/authority/forwarder-context";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type {
  ForwardedAccessIntent,
  ForwardedPermissionRequest,
  ForwardedPermissionResponse,
} from "#src/authority/permission-forwarding";
import {
  PermissionPrompter,
  type PromptPermissionDetails,
} from "#src/authority/permission-prompter";
import type { PermissionDecisionEvent } from "#src/permission-events";
import { PermissionResolver } from "#src/permission-resolver";
import type { PermissionQuery } from "#src/service";
import { SessionRules } from "#src/session-rules";
import type { PermissionCheckResult } from "#src/types";
import {
  makeAuthorizerSelectionDeps,
  registerLink,
} from "#test/helpers/authorizer-fixtures";
import { makeAuthorizerLog } from "#test/helpers/authorizer-log-fixtures";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";
import {
  createForwardingTempDir,
  type ForwardingTempDir,
  makeForwardedAccessIntent,
  makeForwarderContext,
  makeServerDeps,
  makeSubagentRegistry,
} from "#test/helpers/forwarding-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";
import { createManagerWithConfig } from "#test/helpers/manager-harness";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

let temp: ForwardingTempDir | undefined;

afterEach(() => {
  temp?.cleanup();
  temp = undefined;
  vi.unstubAllEnvs();
});

function readResponse(
  dir: ForwardingTempDir,
  requestId: string,
): ForwardedPermissionResponse {
  const raw = readFileSync(
    join(dir.location.responsesDir, `${requestId}.json`),
    "utf-8",
  );
  return JSON.parse(raw) as ForwardedPermissionResponse;
}

/**
 * An approving `AskEscalator` that records the details it was handed.
 *
 * The reconstructed `PromptPermissionDetails` is itself the subject of the
 * access-facts and bounded-delegation cases below: they assert its exact shape,
 * and hand it to the real delegation envelope — a collaborator the server never
 * touches, but one that reads the details the server builds.
 */
function makeCapturingEscalator() {
  const escalated: PromptPermissionDetails[] = [];
  return {
    escalate: vi.fn((details: PromptPermissionDetails) => {
      escalated.push(details);
      return Promise.resolve<PermissionPromptDecision>({
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      });
    }),
    /** The details of the most recent escalation. */
    lastDetails(): PromptPermissionDetails {
      const details = escalated.at(-1);
      if (!details) {
        throw new Error("no ask was escalated");
      }
      return details;
    },
  };
}

/** Drive one forwarded ask to escalation and return the details the server built. */
async function escalateForwardedAsk(
  request: Partial<ForwardedPermissionRequest>,
): Promise<PromptPermissionDetails> {
  temp = createForwardingTempDir("parent-session");
  temp.writeRequest(request);
  const escalator = makeCapturingEscalator();
  const server = new ForwardedRequestServer(
    makeServerDeps({
      forwardingDir: temp.forwardingDir,
      policy: { resolve: vi.fn(() => makeCheckResult({ state: "ask" })) },
      escalator,
    }),
  );

  await server.processInbox(
    makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
  );

  return escalator.lastDetails();
}

describe("processInbox — recorded-authority resolution", () => {
  test("auto-approves and writes an approved response when the serving policy allows", async () => {
    temp = createForwardingTempDir("parent-session");
    const accessIntent = makeForwardedAccessIntent({
      matchValues: ["git status"],
    });
    temp.writeRequest({
      id: "req-allow",
      source: "tool_call",
      surface: "bash",
      value: "git status",
      accessIntent,
    });

    const resolve = vi.fn(() =>
      makeCheckResult({
        state: "allow",
        matchedPattern: "git *",
        origin: "global",
      }),
    );
    const escalate = vi.fn();
    const logger = { review: vi.fn(), debug: vi.fn() };

    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        logger,
        policy: { resolve },
        escalator: { escalate },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(resolve).toHaveBeenCalledWith(accessIntent);
    expect(escalate).not.toHaveBeenCalled();
    // The serving node's own rule decided, and the response names it: the
    // child's log entry would otherwise say only that the parent approved.
    expect(readResponse(temp, "req-allow")).toMatchObject({
      approved: true,
      state: "approved",
      decidedBy: {
        kind: "rule",
        surface: "bash",
        pattern: "git *",
        origin: "global",
      },
    });
    expect(logger.review).toHaveBeenCalledWith(
      "forwarded_permission.auto_approved",
      expect.objectContaining({
        requestId: "req-allow",
        decidedBy: expect.objectContaining({ kind: "rule" }),
      }),
    );
  });

  test("auto-denies and writes a denied response when the serving policy denies", async () => {
    temp = createForwardingTempDir("parent-session");
    const accessIntent = makeForwardedAccessIntent({
      matchValues: ["rm -rf /"],
    });
    temp.writeRequest({
      id: "req-deny",
      source: "tool_call",
      surface: "bash",
      value: "rm -rf /",
      accessIntent,
    });

    const resolve = vi.fn(() =>
      makeCheckResult({
        state: "deny",
        matchedPattern: "rm *",
        origin: "project",
      }),
    );
    const escalate = vi.fn();
    const logger = { review: vi.fn(), debug: vi.fn() };

    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        logger,
        policy: { resolve },
        escalator: { escalate },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(resolve).toHaveBeenCalledWith(accessIntent);
    expect(escalate).not.toHaveBeenCalled();
    expect(readResponse(temp, "req-deny")).toMatchObject({
      approved: false,
      state: "denied",
      decidedBy: {
        kind: "rule",
        surface: "bash",
        pattern: "rm *",
        origin: "project",
      },
    });
    expect(logger.review).toHaveBeenCalledWith(
      "forwarded_permission.auto_denied",
      expect.objectContaining({
        requestId: "req-deny",
        decidedBy: expect.objectContaining({ kind: "rule" }),
      }),
    );
  });

  test("relays the escalated decision's own decider onto the response", async () => {
    temp = createForwardingTempDir("parent-session");
    temp.writeRequest({ id: "req-human", accessIntent: undefined });

    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        escalator: {
          escalate: vi.fn().mockResolvedValue({
            approved: true,
            state: "approved",
            decidedBy: { kind: "user", via: "dialog" },
          }),
        },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    // This is the reported case: the child could not tell a human approval at
    // the parent from the parent's policy auto-approving on its behalf.
    expect(readResponse(temp, "req-human")).toMatchObject({
      decidedBy: { kind: "user", via: "dialog" },
    });
  });

  test("attributes a failed escalation to the error, not to a denial anyone made", async () => {
    temp = createForwardingTempDir("parent-session");
    temp.writeRequest({ id: "req-boom", accessIntent: undefined });

    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        escalator: {
          escalate: vi.fn().mockRejectedValue(new Error("prompt exploded")),
        },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(readResponse(temp, "req-boom")).toMatchObject({
      approved: false,
      state: "denied",
      decidedBy: { kind: "gate_error", reason: "prompt exploded" },
    });
  });

  test("escalates an ask through the AskEscalator with the forwarded provenance details", async () => {
    temp = createForwardingTempDir("parent-session");
    const accessIntent = makeForwardedAccessIntent({
      matchValues: ["git push"],
    });
    temp.writeRequest({
      id: "req-ask",
      source: "tool_call",
      surface: "bash",
      value: "git push",
      accessIntent,
      payload: makePromptPayload({
        kind: "bash",
        request: {
          ...makePromptPayload().request,
          surface: "bash",
          toolName: "bash",
          value: "git push",
        },
      }),
    });

    const resolve = vi.fn(() => makeCheckResult({ state: "ask" }));
    const escalate = vi.fn().mockResolvedValue({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });

    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        policy: { resolve },
        escalator: { escalate },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(resolve).toHaveBeenCalledWith(accessIntent);
    expect(escalate).toHaveBeenCalledWith({
      requestId: "req-ask",
      source: "tool_call",
      agentName: "Explore",
      surface: "bash",
      value: "git push",
      forwarding: {
        requesterAgentName: "Explore",
        requesterSessionId: "child-session",
      },
      accessIntent: {
        surface: "bash",
        matchValues: ["git push"],
        boundaryValue: null,
      },
      payload: {
        kind: "bash",
        request: {
          requester: {
            agentName: "Explore",
            forwarded: true,
            sessionId: "child-session",
          },
          surface: "bash",
          toolName: "bash",
          invokedToolName: null,
          value: "git push",
          matchedPattern: null,
          commandContext: null,
          executedUnit: null,
        },
        evidence: [],
        annotations: [],
      },
    });
    expect(readResponse(temp, "req-ask")).toMatchObject({
      approved: true,
      state: "approved",
    });
  });

  test("keeps requester cwd and principal out of the escalated payload (#635)", async () => {
    temp = createForwardingTempDir("parent-session");
    temp.writeRequest({
      id: "req-ask",
      surface: "bash",
      value: "git push",
      accessIntent: makeForwardedAccessIntent({
        requesterCwd: "/child/cwd",
        principal: { sessionId: "child-session", agentName: "Explore" },
      }),
    });

    const escalate = vi.fn().mockResolvedValue({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });
    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        policy: { resolve: () => makeCheckResult({ state: "ask" }) },
        escalator: { escalate },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    // The payload is a disclosure boundary too: requester identity reaches an
    // Authorizer through `details.forwarding`, never smuggled in as evidence.
    const serialized = JSON.stringify(escalate.mock.calls[0][0].payload);
    expect(serialized).not.toContain("/child/cwd");
    expect(serialized).not.toContain("principal");
  });

  test("floors a request with no fields at all (fully legacy) to escalation without consulting the policy", async () => {
    temp = createForwardingTempDir("parent-session");
    // Legacy / version-skew request: no source/surface/value/accessIntent.
    temp.writeRequest({ id: "req-legacy" });

    const resolve = vi.fn(() => makeCheckResult({ state: "allow" }));
    const escalate = vi.fn().mockResolvedValue({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });

    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        policy: { resolve },
        escalator: { escalate },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(escalate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-legacy",
        source: "tool_call",
        surface: null,
        value: null,
      }),
    );
  });

  test("floors a version-skew request with display fields but no accessIntent to escalation without consulting the policy", async () => {
    temp = createForwardingTempDir("parent-session");
    // An older child populated the display fields but never computed the
    // structured intent (ADR 0008 §4: accessIntent is the sole resolution
    // path — a request missing it floors to `ask`, never a silent grant).
    temp.writeRequest({
      id: "req-skew",
      source: "tool_call",
      surface: "bash",
      value: "git push",
    });

    const resolve = vi.fn(() => makeCheckResult({ state: "allow" }));
    const escalate = vi.fn().mockResolvedValue({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });

    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        policy: { resolve },
        escalator: { escalate },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(escalate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-skew",
        surface: "bash",
        value: "git push",
      }),
    );
  });

  test("denies when the escalator rejects", async () => {
    temp = createForwardingTempDir("parent-session");
    temp.writeRequest({
      id: "req-throw",
      surface: "bash",
      value: "git push",
      accessIntent: makeForwardedAccessIntent({ matchValues: ["git push"] }),
    });

    const resolve = vi.fn(() => makeCheckResult({ state: "ask" }));
    const escalate = vi.fn().mockRejectedValue(new Error("ui gone"));
    const logger = { review: vi.fn(), debug: vi.fn() };

    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        logger,
        policy: { resolve },
        escalator: { escalate },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(readResponse(temp, "req-throw")).toMatchObject({
      approved: false,
      state: "denied",
    });
    expect(logger.review).toHaveBeenCalledWith(
      "permission_forwarding.error",
      expect.objectContaining({
        message: expect.stringContaining("escalate"),
      }),
    );
  });
});

describe("processInbox — child-fixed access facts on the escalated ask", () => {
  test("carries the request's access facts onto the escalated ask details", async () => {
    const details = await escalateForwardedAsk({
      id: "req-path-facts",
      source: "tool_call",
      // The display projection is the child's *tool* name, which is what the UI
      // shows — never the gate surface the rule fired on.
      surface: "write",
      value: "/worktree/issue-42/src/foo.ts",
      accessIntent: makeForwardedAccessIntent({
        surface: "path",
        matchValues: [
          "/worktree/issue-42/src/foo.ts",
          "src/foo.ts",
          "/canonical/src/foo.ts",
        ],
        boundaryValue: "/canonical/src/foo.ts",
      }),
    });

    // Exactly the three fact fields: `requesterCwd` and `principal` stay on the
    // wire object and never reach an Authorizer. A link that needs requester
    // identity reads `details.forwarding`.
    expect(details.accessIntent).toEqual({
      surface: "path",
      matchValues: [
        "/worktree/issue-42/src/foo.ts",
        "src/foo.ts",
        "/canonical/src/foo.ts",
      ],
      boundaryValue: "/canonical/src/foo.ts",
    });
  });

  test("omits accessIntent entirely for a version-skew request that carried none", async () => {
    const details = await escalateForwardedAsk({
      id: "req-skew-facts",
      source: "tool_call",
      surface: "bash",
      value: "git push",
    });

    // Absence, not an explicit `undefined`: the delegation envelope's
    // `accessIntent?.surface ?? surface` fallback reads the display surface only
    // when the key is genuinely absent.
    expect(details).not.toHaveProperty("accessIntent");
  });
});

describe("processInbox — the child's payload on the escalated ask", () => {
  test("escalates the child's own payload with the requester re-stamped as forwarded", async () => {
    const childPayload = makePromptPayload({
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
      evidence: [
        { label: "full command", text: "git push --force", detail: null },
      ],
    });

    const details = await escalateForwardedAsk({
      id: "req-child-payload",
      requesterAgentName: "Explore",
      requesterSessionId: "child-session",
      source: "tool_call",
      surface: "bash",
      value: "git push",
      payload: childPayload,
    });

    // The child's kind and facts pass through untouched — a forwarded bash ask
    // renders `command : …` exactly as a local one does. Only the requester is
    // re-stamped: the serving node is the only party that knows the ask arrived
    // over the wire, and the request's own provenance is authoritative (#292).
    expect(details.payload).toEqual({
      ...childPayload,
      request: {
        ...childPayload.request,
        requester: {
          agentName: "Explore",
          forwarded: true,
          sessionId: "child-session",
        },
      },
    });
  });

  test("escalates a degraded forwarded payload for a request carrying none", async () => {
    const details = await escalateForwardedAsk({
      id: "req-skew-payload",
      requesterAgentName: "scout",
      requesterSessionId: "child-session",
      source: "tool_call",
      surface: "read",
      value: "/tmp/x",
      // `JSON.stringify` drops the key, so the written request genuinely
      // carries no payload — an older child's request.
      payload: undefined,
    });

    // `kind: "forwarded"` now means exactly one thing: this ask arrived without
    // a payload, so it is rendered from the display fields it does carry.
    expect(details.payload).toEqual({
      kind: "forwarded",
      request: {
        requester: {
          agentName: "scout",
          forwarded: true,
          sessionId: "child-session",
        },
        surface: "read",
        toolName: null,
        invokedToolName: null,
        value: "/tmp/x",
        matchedPattern: null,
        commandContext: null,
        executedUnit: null,
      },
      evidence: [],
      annotations: [],
    });
  });
});

describe("processInbox — bounded delegation over forwarded asks", () => {
  const query: PermissionQuery = {
    checkPermission: vi.fn(),
    getToolPermission: vi.fn(),
  };
  const log = makeAuthorizerLog();
  const allowingLink: Authorizer["authorize"] = () =>
    Promise.resolve({ kind: "allow" });

  test("caps a link's allow on a forwarded path ask to defer", async () => {
    const details = await escalateForwardedAsk({
      id: "req-envelope-path",
      source: "tool_call",
      surface: "write",
      value: "/worktree/issue-42/.ssh/config",
      accessIntent: makeForwardedAccessIntent({
        surface: "path",
        matchValues: ["/worktree/issue-42/.ssh/config"],
        boundaryValue: "/worktree/issue-42/.ssh/config",
      }),
    });

    const enclosed = encloseInDelegationEnvelope(allowingLink);

    // The gate surface, not the displayed tool name, decides exclusion — so a
    // forwarded path ask is capped exactly like the same ask made locally.
    expect(await enclosed(details, query, log)).toEqual({ kind: "defer" });
  });

  test("passes a link's allow on a forwarded bash ask through", async () => {
    const details = await escalateForwardedAsk({
      id: "req-envelope-bash",
      source: "tool_call",
      surface: "bash",
      value: "npm test",
      accessIntent: makeForwardedAccessIntent({ matchValues: ["npm test"] }),
    });

    const enclosed = encloseInDelegationEnvelope(allowingLink);

    expect(await enclosed(details, query, log)).toEqual({ kind: "allow" });
  });
});

describe("processInbox — the serving node's chain adjudicates a forwarded ask", () => {
  /** A serving node with UI: its terminal is the human prompt. */
  function makeServingCtx(): ExtensionContext {
    return {
      hasUI: true,
      mode: "tui",
      ui: { select: vi.fn(), input: vi.fn(), custom: vi.fn() },
    } as unknown as ExtensionContext;
  }

  test("a link registered on the serving node decides the forwarded ask before its terminal", async () => {
    temp = createForwardingTempDir("parent-session");
    temp.writeRequest({
      id: "req-chain",
      source: "tool_call",
      surface: "bash",
      value: "rm -rf /tmp/scratch",
      accessIntent: makeForwardedAccessIntent({
        matchValues: ["rm -rf /tmp/scratch"],
      }),
    });

    const registry = new AuthorizerRegistry();
    registerLink(registry, "model-judge", {
      kind: "deny",
      reason: "destructive",
    });
    const requestPermissionDecision = vi.fn().mockResolvedValue({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });
    const logger = makeAuthorizerLog();
    // The real chain owner, wired exactly as index.ts wires it: the same
    // AuthorizerSelection is both the gate's AskEscalator and the forwarded
    // request server's, so a child's ask is judged by the serving node's chain.
    const selection = new AuthorizerSelection(
      makeAuthorizerSelectionDeps({
        prompter: new PermissionPrompter({ logger }),
        authorizerRegistry: registry,
        getAuthorizerChain: () => ["model-judge"],
        requestPermissionDecision,
        logger,
      }),
    );
    selection.activate(makeServingCtx());

    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        logger,
        policy: { resolve: vi.fn(() => makeCheckResult({ state: "ask" })) },
        escalator: selection,
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    // The link's deny is what the child receives, and the human terminal was
    // never reached — the chain adjudicated the forwarded ask. The child can
    // now see that from its own record: the link is named on the wire.
    expect(readResponse(temp, "req-chain")).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "destructive",
      responderSessionId: "parent-session",
      respondedAt: expect.any(Number),
      decidedBy: {
        kind: "authorizer",
        name: "model-judge",
        verdict: "deny",
        reason: "destructive",
      },
    });
    expect(requestPermissionDecision).not.toHaveBeenCalled();
  });
});

describe("processInbox — grant-scope selection", () => {
  test("records a whole-session grant into the serving recorder and translates the response to a plain approve", async () => {
    temp = createForwardingTempDir("parent-session");
    temp.writeRequest({
      id: "req-whole",
      source: "tool_call",
      surface: "bash",
      value: "git push",
      accessIntent: makeForwardedAccessIntent({ matchValues: ["git push"] }),
      sessionApproval: { surface: "bash", patterns: ["git *"] },
    });

    const resolve = vi.fn(() => makeCheckResult({ state: "ask" }));
    const escalate = vi.fn().mockResolvedValue({
      approved: true,
      state: "approved_for_serving_session",
      decidedBy: { kind: "user", via: "dialog" },
    });
    const recordSessionApproval = vi.fn();

    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        policy: { resolve },
        escalator: { escalate },
        recorder: { recordSessionApproval },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(recordSessionApproval).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "bash", patterns: ["git *"] }),
    );
    // Translated: the child receives a plain approve and records nothing.
    // The translation rewrites the scope, never the decider.
    expect(readResponse(temp, "req-whole")).toMatchObject({
      approved: true,
      state: "approved",
      decidedBy: { kind: "user", via: "dialog" },
    });
  });

  test("offers the request's sessionApproval to the escalated dialog details", async () => {
    temp = createForwardingTempDir("parent-session");
    temp.writeRequest({
      id: "req-scope-details",
      source: "tool_call",
      surface: "bash",
      value: "git push",
      accessIntent: makeForwardedAccessIntent({ matchValues: ["git push"] }),
      sessionApproval: { surface: "bash", patterns: ["git *"] },
    });

    const resolve = vi.fn(() => makeCheckResult({ state: "ask" }));
    const escalate = vi.fn().mockResolvedValue({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });

    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        policy: { resolve },
        escalator: { escalate },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(escalate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionApproval: { surface: "bash", patterns: ["git *"] },
      }),
    );
  });

  test("passes a subagent-only grant through untouched without recording on the serving node", async () => {
    temp = createForwardingTempDir("parent-session");
    temp.writeRequest({
      id: "req-subagent",
      source: "tool_call",
      surface: "bash",
      value: "git push",
      accessIntent: makeForwardedAccessIntent({ matchValues: ["git push"] }),
      sessionApproval: { surface: "bash", patterns: ["git *"] },
    });

    const resolve = vi.fn(() => makeCheckResult({ state: "ask" }));
    const escalate = vi.fn().mockResolvedValue({
      approved: true,
      state: "approved_for_session",
      decidedBy: DECIDED_BY_HUMAN,
    });
    const recordSessionApproval = vi.fn();

    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        policy: { resolve },
        escalator: { escalate },
        recorder: { recordSessionApproval },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(recordSessionApproval).not.toHaveBeenCalled();
    // Passed through: the child records its own pattern (today's behavior).
    expect(readResponse(temp, "req-subagent")).toMatchObject({
      approved: true,
      state: "approved_for_session",
    });
  });
});

describe("processInbox — one-hop canary", () => {
  test("warns when the requester is a registered subagent whose parent is not this serving session", async () => {
    temp = createForwardingTempDir("parent-session");
    temp.writeRequest({ id: "req-hop", surface: "bash", value: "git push" });

    const logger = { review: vi.fn(), debug: vi.fn() };
    const registry = makeSubagentRegistry("child-session", {
      parentSessionId: "some-other-session",
    });

    const server = new ForwardedRequestServer(
      makeServerDeps({ forwardingDir: temp.forwardingDir, logger, registry }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(logger.review).toHaveBeenCalledWith(
      "permission_forwarding.warning",
      expect.objectContaining({
        message: expect.stringContaining("one-hop"),
      }),
    );
  });

  test("stays silent for an unregistered (external file-based) requester", async () => {
    temp = createForwardingTempDir("parent-session");
    temp.writeRequest({ id: "req-ext", surface: "bash", value: "git push" });

    const logger = { review: vi.fn(), debug: vi.fn() };
    const registry = makeSubagentRegistry("child-session"); // no entry

    const server = new ForwardedRequestServer(
      makeServerDeps({ forwardingDir: temp.forwardingDir, logger, registry }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(logger.review).not.toHaveBeenCalledWith(
      "permission_forwarding.warning",
      expect.anything(),
    );
  });

  test("stays silent for a registered one-hop child whose parent is this serving session", async () => {
    temp = createForwardingTempDir("parent-session");
    temp.writeRequest({ id: "req-ok", surface: "bash", value: "git push" });

    const logger = { review: vi.fn(), debug: vi.fn() };
    const registry = makeSubagentRegistry("child-session", {
      parentSessionId: "parent-session",
    });

    const server = new ForwardedRequestServer(
      makeServerDeps({ forwardingDir: temp.forwardingDir, logger, registry }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(logger.review).not.toHaveBeenCalledWith(
      "permission_forwarding.warning",
      expect.anything(),
    );
  });
});

describe("processInbox — inbox mechanics", () => {
  test("recreates a missing responses/ directory and still writes the response", async () => {
    // Simulate the race: requests/ exists with a pending file, but
    // responses/ was removed by a concurrent cleanup pass (#398).
    temp = createForwardingTempDir("parent-session", {
      createResponsesDir: false,
    });
    temp.writeRequest({
      id: "req-race",
      surface: "bash",
      value: "cat x",
      accessIntent: makeForwardedAccessIntent({ matchValues: ["cat x"] }),
    });

    const logger = { review: vi.fn(), debug: vi.fn() };
    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        logger,
        policy: { resolve: vi.fn(() => makeCheckResult({ state: "allow" })) },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(logger.review).not.toHaveBeenCalledWith(
      "permission_forwarding.error",
      expect.anything(),
    );
    expect(readResponse(temp, "req-race")).toMatchObject({
      approved: true,
      state: "approved",
    });
  });

  test("ignores and deletes a request targeting a different session", async () => {
    temp = createForwardingTempDir("parent-session");
    temp.writeRequest({
      id: "req-mismatch",
      targetSessionId: "other-session",
      surface: "bash",
      value: "git push",
      accessIntent: makeForwardedAccessIntent({ matchValues: ["git push"] }),
    });

    const resolve = vi.fn(() => makeCheckResult({ state: "allow" }));
    const server = new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: temp.forwardingDir,
        policy: { resolve },
      }),
    );

    await server.processInbox(
      makeForwarderContext({ hasUI: true, sessionId: "parent-session" }),
    );

    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("processInbox — terminal decision broadcast", () => {
  let dir: ForwardingTempDir;
  let emitDecision: Mock<(event: PermissionDecisionEvent) => void>;

  beforeEach(() => {
    dir = createForwardingTempDir("parent-session");
    // The module-level handle is what the shared `afterEach` cleans up.
    temp = dir;
    emitDecision = vi.fn<(event: PermissionDecisionEvent) => void>();
  });

  /** The serving session's server, with this describe's decision capture wired in. */
  function makeServer(
    overrides: Partial<ForwardedRequestServerDeps> = {},
  ): ForwardedRequestServer {
    return new ForwardedRequestServer(
      makeServerDeps({
        forwardingDir: dir.forwardingDir,
        broadcaster: { emitDecision },
        ...overrides,
      }),
    );
  }

  /** An escalator answering with one fixed decision. */
  function escalatorAnswering(decision: PermissionPromptDecision) {
    return { escalate: vi.fn().mockResolvedValue(decision) };
  }

  /** The decisions broadcast on the serving session's bus. */
  function broadcastDecisions(): PermissionDecisionEvent[] {
    return emitDecision.mock.calls.map(([event]) => event);
  }

  /** The serving context every case below drains its inbox under. */
  function servingContext(): ForwarderContext {
    return makeForwarderContext({ hasUI: true, sessionId: "parent-session" });
  }

  test("broadcasts an approval carrying the ask's id, projection, and provenance", async () => {
    dir.writeRequest({
      id: "req-ask",
      source: "tool_call",
      surface: "bash",
      value: "git push",
    });
    const server = makeServer({
      escalator: escalatorAnswering({
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      }),
    });

    await server.processInbox(servingContext());

    // Asserted whole: the bus is the narrowest renderer, so a field added here
    // later — `decidedBy` above all (#726) — must be a deliberate contract
    // change rather than something that leaks in with a spread.
    expect(broadcastDecisions()).toEqual([
      {
        requestId: "req-ask",
        surface: "bash",
        value: "git push",
        agentName: "Explore",
        result: "allow",
        resolution: "user_approved",
        origin: null,
        matchedPattern: null,
        forwarding: {
          requesterAgentName: "Explore",
          requesterSessionId: "child-session",
        },
      },
    ]);
  });

  test("broadcasts a denial as user_denied", async () => {
    dir.writeRequest({ id: "req-deny", surface: "bash", value: "rm -rf /" });
    const server = makeServer({
      escalator: escalatorAnswering({
        approved: false,
        state: "denied",
        decidedBy: DECIDED_BY_HUMAN,
      }),
    });

    await server.processInbox(servingContext());

    expect(broadcastDecisions()).toMatchObject([
      { requestId: "req-deny", result: "deny", resolution: "user_denied" },
    ]);
  });

  test("broadcasts the human's grant scope, not the scope written to the wire", async () => {
    dir.writeRequest({
      id: "req-serving-grant",
      surface: "bash",
      value: "git push",
      sessionApproval: { surface: "bash", patterns: ["git *"] },
    });
    const server = makeServer({
      escalator: escalatorAnswering({
        approved: true,
        state: "approved_for_serving_session",
        decidedBy: DECIDED_BY_HUMAN,
      }),
    });

    await server.processInbox(servingContext());

    // The grant-scope translation rewrites the response to a plain `approved`
    // so the child records nothing; the broadcast still reports what the human
    // actually chose.
    expect(broadcastDecisions()).toMatchObject([
      { result: "allow", resolution: "user_approved_for_session" },
    ]);
    expect(readResponse(dir, "req-serving-grant")).toMatchObject({
      state: "approved",
    });
  });

  test("broadcasts a subagent-scoped grant as user_approved_for_session", async () => {
    dir.writeRequest({
      id: "req-child-grant",
      surface: "bash",
      value: "git push",
    });
    const server = makeServer({
      escalator: escalatorAnswering({
        approved: true,
        state: "approved_for_session",
        decidedBy: DECIDED_BY_HUMAN,
      }),
    });

    await server.processInbox(servingContext());

    expect(broadcastDecisions()).toMatchObject([
      { result: "allow", resolution: "user_approved_for_session" },
    ]);
  });

  test("broadcasts an unreachable authority as confirmation_unavailable", async () => {
    dir.writeRequest({
      id: "req-unavailable",
      surface: "bash",
      value: "git push",
    });
    const server = makeServer({
      escalator: escalatorAnswering({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        denialReason: "no serving session",
        decidedBy: { kind: "unavailable", reason: "no serving session" },
      }),
    });

    await server.processInbox(servingContext());

    expect(broadcastDecisions()).toMatchObject([
      { result: "deny", resolution: "confirmation_unavailable" },
    ]);
  });

  test("broadcasts a failed escalation as gate_error", async () => {
    dir.writeRequest({ id: "req-broken", surface: "bash", value: "git push" });
    const server = makeServer({
      escalator: {
        escalate: vi.fn().mockRejectedValue(new Error("dialog exploded")),
      },
    });

    await server.processInbox(servingContext());

    // The prompt broadcast is already out by the time the dialog can fail, so
    // this is the terminal event a consumer waiting on that prompt needs.
    expect(broadcastDecisions()).toMatchObject([
      { requestId: "req-broken", result: "deny", resolution: "gate_error" },
    ]);
  });

  test("broadcasts nothing when recorded authority resolves the request", async () => {
    dir.writeRequest({
      id: "req-silent",
      surface: "bash",
      value: "git status",
      accessIntent: makeForwardedAccessIntent({ matchValues: ["git status"] }),
    });
    const server = makeServer({
      policy: { resolve: vi.fn(() => makeCheckResult({ state: "allow" })) },
    });

    await server.processInbox(servingContext());

    expect(broadcastDecisions()).toEqual([]);
  });

  test("falls back to the payload's facts when the request carries no projection", async () => {
    dir.writeRequest({ id: "req-skew" });
    const server = makeServer({
      escalator: escalatorAnswering({
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      }),
    });

    await server.processInbox(servingContext());

    // A version-skewed child sends no display projection; the payload's own
    // request facts are non-nullable, so they answer instead of a sentinel.
    expect(broadcastDecisions()).toMatchObject([
      { surface: "read", value: "read" },
    ]);
  });
});

// ── ServingPolicy over the real resolver ───────────────────────────────────

describe("ServingPolicy resolves a forwarded request against real recorded authority", () => {
  // Every other test in this file stubs `policy`, so none of them exercises
  // the composition the serving side actually runs. This one rebuilds it —
  // `buildResolvedIntentFromMatchValues` + a real `PermissionResolver` over a
  // filesystem-backed `PermissionManager`, exactly as `index.ts` wires it —
  // because the surface-family fold is what keeps a parent's recorded `path`
  // deny answering a child's bare-surface request. Resolving an emptied bare
  // surface would fall through to the universal default and escalate a hard
  // deny into an approvable prompt (#712, #806).
  function servingPolicyOver(permission: Record<string, unknown>): {
    resolve: (intent: ForwardedAccessIntent) => PermissionCheckResult;
    cleanup: () => void;
  } {
    const { manager, cleanup } = createManagerWithConfig(permission);
    const resolver = new PermissionResolver(manager, new SessionRules());
    return {
      resolve: (intent) =>
        resolver.resolve(
          buildResolvedIntentFromMatchValues(
            intent.surface,
            intent.matchValues,
            intent.principal.agentName,
          ),
        ),
      cleanup,
    };
  }

  /**
   * The child-fixed match set a real child sends for `/secrets/id_rsa`: an
   * out-of-cwd absolute path has no cwd-relative alias, so `matchValues()`
   * yields the one entry.
   */
  const secretMatchValues = ["/secrets/id_rsa"];

  test("hard-denies a bare-surface child request the parent's bare path config denies", () => {
    const policy = servingPolicyOver({
      "*": "allow",
      path: { "/secrets/*": "deny" },
    });
    try {
      const result = policy.resolve(
        makeForwardedAccessIntent({
          surface: "path",
          matchValues: secretMatchValues,
          boundaryValue: "/secrets/id_rsa",
        }),
      );
      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("/secrets/*");
    } finally {
      policy.cleanup();
    }
  });

  test("hard-denies when only one direction of the parent's config denies", () => {
    const policy = servingPolicyOver({
      "*": "allow",
      path_write: { "/secrets/*": "deny" },
    });
    try {
      const result = policy.resolve(
        makeForwardedAccessIntent({
          surface: "path",
          matchValues: secretMatchValues,
          boundaryValue: "/secrets/id_rsa",
        }),
      );
      expect(result.state).toBe("deny");
      expect(result.toolName).toBe("path_write");
    } finally {
      policy.cleanup();
    }
  });

  test("answers a child that already named a direction on that surface alone", () => {
    const policy = servingPolicyOver({
      "*": "allow",
      external_directory: { "*": "ask" },
      external_directory_read: { "/dev-root/*": "allow" },
    });
    try {
      const forRead = policy.resolve(
        makeForwardedAccessIntent({
          surface: "external_directory_read",
          matchValues: ["/dev-root/x"],
          boundaryValue: "/dev-root/x",
        }),
      );
      expect(forRead.state).toBe("allow");

      const forWrite = policy.resolve(
        makeForwardedAccessIntent({
          surface: "external_directory_write",
          matchValues: ["/dev-root/x"],
          boundaryValue: "/dev-root/x",
        }),
      );
      expect(forWrite.state).toBe("ask");
    } finally {
      policy.cleanup();
    }
  });

  test("leaves an unmatched path request without a pattern, so no gate fires (#58)", () => {
    const policy = servingPolicyOver({ "*": "allow", read: "allow" });
    try {
      const result = policy.resolve(
        makeForwardedAccessIntent({
          surface: "path",
          matchValues: ["/some/file.ts"],
          boundaryValue: "/some/file.ts",
        }),
      );
      expect(result.matchedPattern).toBeUndefined();
    } finally {
      policy.cleanup();
    }
  });
});
