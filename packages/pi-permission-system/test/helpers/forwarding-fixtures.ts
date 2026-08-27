/**
 * Shared fixtures for the forwarding subsystem's test files.
 *
 * Collapses the temp forwarding-directory scaffolding, the forwarded-request
 * writer, and the `ParentAuthorizerDeps` / `ForwardedRequestServerDeps` /
 * `ForwarderContext` / UI-decision builders that the split-out per-class test
 * files repeated per test.
 *
 * Consumed by test/authority/approval-escalator.test.ts (the escalation-up
 * role, ParentAuthorizer since #555) and test/authority/forwarded-request-server.test.ts
 * (the serving-down role) — both extracted from `PermissionForwarder` by Phase 8
 * Step 6 (#530).
 * The `{ emit, on }` events mock is not duplicated here — reuse `makeEvents`
 * from `#test/helpers/handler-fixtures`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import type { ParentAuthorizerDeps } from "#src/authority/approval-escalator";
import type { AskEscalator } from "#src/authority/authorizer-selection";
import type { ForwardedRequestServerDeps } from "#src/authority/forwarded-request-server";
import type { ForwarderContext } from "#src/authority/forwarder-context";
import {
  ForwardingLivenessJudge,
  ServingHeartbeatStore,
  type TargetServingLookup,
} from "#src/authority/forwarding-liveness";
import {
  createPermissionForwardingLocation,
  type ForwardedAccessIntent,
  type ForwardedPermissionRequest,
  PERMISSION_FORWARDING_TIMEOUT_MS,
  type PermissionForwardingLocation,
} from "#src/authority/permission-forwarding";
import {
  type ServingLookup,
  ServingSessionRegistry,
} from "#src/authority/serving-registry";
import {
  type SubagentSessionInfo,
  SubagentSessionRegistry,
} from "#src/authority/subagent-registry";
import { makeCheckResult } from "#test/helpers/handler-fixtures";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

/** Handle over a temp forwarding directory; register `cleanup` in `afterEach`. */
export interface ForwardingTempDir {
  /** Absolute path passed as `forwardingDir` to `ParentAuthorizerDeps` / `ForwardedRequestServerDeps`. */
  forwardingDir: string;
  /** The session's request/response location under `forwardingDir`. */
  location: PermissionForwardingLocation;
  /** Writes a `ForwardedPermissionRequest` JSON into `location.requestsDir`. */
  writeRequest(
    overrides?: Partial<ForwardedPermissionRequest>,
  ): ForwardedPermissionRequest;
  /** `rmSync(root, { recursive, force })`. */
  cleanup(): void;
}

/**
 * Creates a temp forwarding directory for `sessionId`.
 *
 * Always creates `requests/`; pass `{ createResponsesDir: false }` to omit
 * `responses/` (the missing-`responses/` race test relies on this).
 */
export function createForwardingTempDir(
  sessionId: string,
  options: { createResponsesDir?: boolean } = {},
): ForwardingTempDir {
  const root = mkdtempSync(join(tmpdir(), "permission-forwarding-"));
  const forwardingDir = join(root, "forwarding");
  const location = createPermissionForwardingLocation(forwardingDir, sessionId);
  mkdirSync(location.requestsDir, { recursive: true });
  if (options.createResponsesDir ?? true) {
    mkdirSync(location.responsesDir, { recursive: true });
  }

  return {
    forwardingDir,
    location,
    writeRequest(overrides = {}) {
      const request: ForwardedPermissionRequest = {
        id: "req-forwarded",
        createdAt: Date.now(),
        requesterSessionId: "child-session",
        targetSessionId: sessionId,
        requesterAgentName: "Explore",
        payload: makePromptPayload(),
        ...overrides,
      };
      writeFileSync(
        join(location.requestsDir, `${request.id}.json`),
        JSON.stringify(request),
        "utf-8",
      );
      return request;
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Builds `ForwardedRequestServerDeps` with a policy that defers to escalation
 * (`ask`) and an approving escalator.
 *
 * Override `policy` / `escalator` with captured `vi.fn()` mocks to assert the
 * resolve-then-escalate flow (e.g. `policy: { resolve }` returning
 * `makeCheckResult({ state: "allow" })`, `escalator: { escalate }`).
 */
export function makeServerDeps(
  overrides: Partial<ForwardedRequestServerDeps> = {},
): ForwardedRequestServerDeps {
  return {
    forwardingDir: "/tmp/forwarding",
    logger: { review: vi.fn(), debug: vi.fn() },
    policy: { resolve: vi.fn(() => makeCheckResult({ state: "ask" })) },
    escalator: {
      escalate: vi.fn<AskEscalator["escalate"]>(() =>
        Promise.resolve({
          approved: true,
          state: "approved",
          decidedBy: { kind: "user", via: "dialog" },
        }),
      ),
    },
    broadcaster: { emitDecision: vi.fn() },
    recorder: { recordSessionApproval: vi.fn() },
    ...overrides,
  };
}

/**
 * Builds `ParentAuthorizerDeps` with a silent logger.
 *
 * `forwardingDir` and `registry` are the two a test almost always supplies
 * (from `createForwardingTempDir` and `makeSubagentRegistry`); everything else
 * defaults so a new dep lands here once rather than at every construction site.
 *
 * `serving` defaults to a lookup that reports every target as serving, so a
 * test exercising the ordinary round trip is not accidentally fast-failed; a
 * test targeting the unserved path passes {@link makeLivenessJudge}.
 * `getTimeoutMs` defaults to the production value — override it with a small
 * number to exercise the timeout without waiting it out.
 */
export function makeParentAuthorizerDeps(
  overrides: Partial<ParentAuthorizerDeps> = {},
): ParentAuthorizerDeps {
  return {
    forwardingDir: "/tmp/forwarding",
    logger: { review: vi.fn(), debug: vi.fn() },
    serving: alwaysServing,
    getTimeoutMs: () => PERMISSION_FORWARDING_TIMEOUT_MS,
    ...overrides,
  };
}

/** A `TargetServingLookup` answering "yes" for any target (the non-fast-fail default). */
const alwaysServing: TargetServingLookup = {
  isServing: () => true,
  describe: () => ({ channel: "none", state: null, servingIds: [] }),
};

/**
 * Builds the real judge over an in-process registry and the heartbeat records
 * under `forwardingDir`.
 *
 * The production collaborator rather than a fake, because what these tests are
 * about is which channel answers for which target — a hand-written double would
 * be free to disagree with the routing under test.
 */
export function makeLivenessJudge(options: {
  forwardingDir: string;
  registry?: ServingLookup;
  isProcessAlive?: (pid: number) => boolean;
}): ForwardingLivenessJudge {
  return new ForwardingLivenessJudge({
    registry: options.registry ?? new ServingSessionRegistry(),
    heartbeats: new ServingHeartbeatStore({
      forwardingDir: options.forwardingDir,
      logger: { review: vi.fn(), debug: vi.fn() },
      ...(options.isProcessAlive
        ? { isProcessAlive: options.isProcessAlive }
        : {}),
    }),
  });
}

/** Publishes a serving heartbeat for `sessionId`, as a live parent would. */
export function publishServingHeartbeat(
  forwardingDir: string,
  sessionId: string,
  pid?: number,
): void {
  new ServingHeartbeatStore({
    forwardingDir,
    logger: { review: vi.fn(), debug: vi.fn() },
    ...(pid === undefined ? {} : { pid }),
  }).markServing(sessionId);
}

/**
 * Builds a well-formed `ForwardedAccessIntent` (ADR 0008 §2) for request /
 * policy fixtures. Defaults model a child in a worktree: a cwd-relative alias
 * alongside the absolute one, so a relative parent rule stays relevant across
 * cwds.
 */
export function makeForwardedAccessIntent(
  overrides: Partial<ForwardedAccessIntent> = {},
): ForwardedAccessIntent {
  return {
    surface: "bash",
    matchValues: ["git status"],
    boundaryValue: null,
    requesterCwd: "/worktree/issue-42",
    principal: { sessionId: "child-session", agentName: "Explore" },
    ...overrides,
  };
}

/**
 * Builds a `ForwarderContext`.
 *
 * The `sessionId` shortcut populates `getSessionId`; an explicit
 * `sessionManager` override merges last for tests stubbing other readers.
 */
export function makeForwarderContext(
  overrides: {
    hasUI?: boolean;
    ui?: ForwarderContext["ui"];
    cwd?: string;
    sessionId?: string;
    sessionManager?: Partial<ForwarderContext["sessionManager"]>;
  } = {},
): ForwarderContext {
  return {
    hasUI: overrides.hasUI ?? false,
    ui: overrides.ui ?? { select: vi.fn(), input: vi.fn() },
    cwd: overrides.cwd ?? "/repo",
    sessionManager: {
      getSessionId: vi.fn(() => overrides.sessionId ?? ""),
      getSessionDir: vi.fn(() => ""),
      getEntries: vi.fn(() => []),
      ...overrides.sessionManager,
    },
  };
}

/**
 * Builds a `SubagentSessionRegistry`, optionally pre-registering `childSessionId`.
 *
 * Omit `entry` for an empty registry (the "session not in registry" case);
 * pass `{}` to register `childSessionId` with no `parentSessionId`.
 */
export function makeSubagentRegistry(
  childSessionId: string,
  entry?: SubagentSessionInfo,
): SubagentSessionRegistry {
  const registry = new SubagentSessionRegistry();
  if (entry) {
    registry.register(childSessionId, entry);
  }
  return registry;
}
