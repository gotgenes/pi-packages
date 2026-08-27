import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  getActiveAgentName,
  getActiveAgentNameFromSystemPrompt,
} from "#src/active-agent";
import {
  type ForwarderContext,
  getCwd,
  getSessionId,
} from "#src/authority/forwarder-context";
import {
  cleanupPermissionForwardingLocationIfEmpty,
  ensurePermissionForwardingLocation,
  logPermissionForwardingError,
  logPermissionForwardingWarning,
  readForwardedPermissionResponse,
  safeDeleteFile,
  sleep,
  writeJsonFileAtomic,
} from "#src/authority/forwarding-io";
import type { TargetServingLookup } from "#src/authority/forwarding-liveness";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import {
  type ForwardedAccessFacts,
  type ForwardedPermissionRequest,
  type ForwardedPermissionResponse,
  type ForwardedPromptDisplay,
  type ForwardedSessionApproval,
  PERMISSION_FORWARDING_POLL_INTERVAL_MS,
  PERMISSION_FORWARDING_SERVING_GRACE_MS,
  type PermissionForwardingLocation,
  type PermissionForwardingTarget,
  resolvePermissionForwardingTarget,
  SUBAGENT_PARENT_SESSION_ENV_CANDIDATES,
} from "#src/authority/permission-forwarding";
import type { SubagentSessionRegistry } from "#src/authority/subagent-registry";
import { createPermissionRequestId } from "#src/permission-request-id";
import { buildUiPrompt } from "#src/permission-ui-prompt";
import type { PromptPayload } from "#src/presentation/prompt-payload";
import type { DebugReviewLogger } from "#src/session-logger";
import { toRecord } from "#src/value-guards";
import type { TerminalAuthorizer } from "./authorizer";
import type { PromptPermissionDetails } from "./permission-prompter";

// ── Module-private helpers ────────────────────────────────────────────────

function getContextSystemPrompt(ctx: ForwarderContext): string | undefined {
  const getSystemPrompt = toRecord(ctx).getSystemPrompt;
  if (typeof getSystemPrompt !== "function") {
    return undefined;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- getSystemPrompt is a Pi SDK accessor returning any
    const systemPrompt = getSystemPrompt.call(ctx);
    return typeof systemPrompt === "string" ? systemPrompt : undefined;
  } catch (error) {
    // No deps available in this helper — warning silently dropped.
    logPermissionForwardingWarning(
      null,
      "Failed to read context system prompt for forwarded permission metadata",
      error,
    );
    return undefined;
  }
}

// ── ParentAuthorizer ────────────────────────────────────────────────────

/**
 * The facts a forwarded request relays unchanged from the child's ask: the
 * prompt payload, the optional display projection, and the optional
 * session-approval suggestion.
 *
 * Bundled into one object so the two-hop private chain
 * (`waitForForwardedApproval` → `buildForwardedRequest`) threads a single
 * relayed value instead of three positional optionals.
 */
interface ForwardedRequestFacts {
  /**
   * The requester's own permission request id, adopted as the forwarded
   * request's id so one id runs from the child's gate to the serving node's
   * decision instead of a third being minted here.
   */
  requestId: string;
  /** The child's complete prompt payload, relayed for the serving node to render. */
  payload: PromptPayload;
  display?: ForwardedPromptDisplay;
  sessionApproval?: ForwardedSessionApproval;
  /** The child-fixed access facts; the edge completes them into a `ForwardedAccessIntent`. */
  accessIntent?: ForwardedAccessFacts;
}

/** Constructor config for {@link ParentAuthorizer}. */
export interface ParentAuthorizerDeps {
  forwardingDir: string;
  /** In-process subagent session registry for forwarding target resolution. */
  registry?: SubagentSessionRegistry;
  /** Whether the resolved target is draining its inbox, on whichever channel can say. */
  serving: TargetServingLookup;
  /** How long to wait for the target's answer, read live so config edits apply. */
  getTimeoutMs: () => number;
  logger: DebugReviewLogger;
}

/**
 * Deny because no authority ever ruled — the request was never delivered,
 * never answered, or answered unreadably.
 *
 * `confirmationUnavailable` is what keeps this out of the "User denied …"
 * message (#719): a user who was never asked denied nothing. `denialReason`
 * names which path gave up, and the gate renders it to the model.
 *
 * The provenance record reuses that same string rather than restating it, so
 * what the model is told and what the log attributes cannot drift (#726).
 */
function abandon(denialReason: string): PermissionPromptDecision {
  return {
    approved: false,
    state: "denied",
    confirmationUnavailable: true,
    denialReason,
    decidedBy: { kind: "unavailable", reason: denialReason },
  };
}

/**
 * Adopt the responder's answer, recording the hop it came through.
 *
 * The requester's own terminal entry has to answer two questions, and they are
 * different: *which session* answered, and *what within it* decided. Nesting
 * keeps both rather than flattening the responder's source into this node's
 * record, where it would read as a local decision (#726).
 *
 * A responder that sent no usable source yields `decision: null` — the hop is
 * still a fact, and an older parent is not an error.
 */
function relayDecision(
  response: ForwardedPermissionResponse,
): PermissionPromptDecision {
  return {
    ...response,
    decidedBy: {
      kind: "forwarded",
      responderSessionId: response.responderSessionId,
      decision: response.decidedBy ?? null,
    },
  };
}

/** Ids this node is willing to use as a request/response filename. */
const FILENAME_SAFE_REQUEST_ID = /^[A-Za-z0-9._-]+$/;

/**
 * The id to write on the forwarded request: the requester's own, or a fresh
 * mint when that id could not safely name a file.
 *
 * At a relay hop the adopted id came from a request file on disk, which the
 * tolerant reader validates only as a string — so this is the boundary that
 * keeps an inbound id from choosing an outbound path.
 */
function forwardableRequestId(requesterRequestId: string): string {
  return FILENAME_SAFE_REQUEST_ID.test(requesterRequestId)
    ? requesterRequestId
    : createPermissionRequestId();
}

/**
 * Authorizer for a subagent session: escalate the ask up the tree to the
 * parent's authority.
 *
 * Owns the escalation-up role of the forwarded-permission behavior: builds
 * and persists a request file, then polls for the parent session's
 * response. `ctx` is bound once at construction — `selectAuthorizer` only
 * constructs a `ParentAuthorizer` for a context it has already confirmed has
 * no UI and is a subagent, so `authorize` never re-derives that dispatch
 * (formerly `ApprovalEscalator.requestApproval`'s `hasUI` / `!isSubagent`
 * arms, both dead once every caller routes through `selectAuthorizer`).
 */
export class ParentAuthorizer implements TerminalAuthorizer {
  private readonly forwardingDir: string;
  private readonly registry: SubagentSessionRegistry | undefined;
  private readonly serving: TargetServingLookup;
  private readonly getTimeoutMs: () => number;
  private readonly logger: DebugReviewLogger;

  constructor(
    private readonly ctx: ForwarderContext,
    deps: ParentAuthorizerDeps,
  ) {
    this.forwardingDir = deps.forwardingDir;
    this.registry = deps.registry;
    this.serving = deps.serving;
    this.getTimeoutMs = deps.getTimeoutMs;
    this.logger = deps.logger;
  }

  authorize(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision> {
    const uiPrompt = buildUiPrompt(details);
    return this.waitForForwardedApproval(this.ctx, {
      requestId: details.requestId,
      payload: details.payload,
      display: {
        source: uiPrompt.source,
        surface: uiPrompt.surface,
        value: uiPrompt.value,
      },
      sessionApproval: details.sessionApproval,
      accessIntent: details.accessIntent,
    });
  }

  // ── Private methods ────────────────────────────────────────────────────

  private async waitForForwardedApproval(
    ctx: ForwarderContext,
    facts: ForwardedRequestFacts,
  ): Promise<PermissionPromptDecision> {
    const requesterSessionId = getSessionId(ctx);
    const target = resolvePermissionForwardingTarget({
      hasUI: ctx.hasUI,
      // Invariant: selectAuthorizer only selects ParentAuthorizer for a
      // no-UI subagent context, so this is always true — no detection dep
      // needed to re-derive it here.
      isSubagent: true,
      currentSessionId: requesterSessionId,
      env: process.env,
      sessionId: requesterSessionId,
      registry: this.registry,
    });

    if (!target) {
      logPermissionForwardingError(
        this.logger,
        `Permission forwarding target session could not be resolved. ` +
          `Checked env vars: ${SUBAGENT_PARENT_SESSION_ENV_CANDIDATES.join(", ")}. ` +
          `If you are using a subagent extension (nicobailon/pi-subagents, HazAT/pi-interactive-subagents, etc.), ` +
          `ask its maintainer to set PI_SUBAGENT_PARENT_SESSION in the child process environment ` +
          `(see https://github.com/gotgenes/pi-permission-system/issues/143).`,
      );
      return abandon(
        "Could not resolve a parent session to forward this permission request to",
      );
    }

    const location = ensurePermissionForwardingLocation(
      this.logger,
      this.forwardingDir,
      target.sessionId,
    );
    if (!location) {
      logPermissionForwardingError(
        this.logger,
        `Permission forwarding is unavailable because session-scoped directories could not be prepared for '${target.sessionId}'`,
      );
      return abandon(
        `Permission forwarding directories could not be prepared for session '${target.sessionId}'`,
      );
    }

    const request = this.buildForwardedRequest(
      ctx,
      facts,
      requesterSessionId,
      target.sessionId,
    );
    const requestPath = join(location.requestsDir, `${request.id}.json`);
    const responsePath = join(location.responsesDir, `${request.id}.json`);

    this.logger.review("forwarded_permission.request_created", {
      requestId: request.id,
      requesterAgentName: request.requesterAgentName,
      requesterSessionId: request.requesterSessionId,
      targetSessionId: target.sessionId,
      requestPath,
      responsePath,
    });

    try {
      writeJsonFileAtomic(this.logger, requestPath, request);
    } catch (error) {
      logPermissionForwardingError(
        this.logger,
        `Failed to write forwarded permission request '${requestPath}'`,
        error,
      );
      cleanupPermissionForwardingLocationIfEmpty(this.logger, location);
      return abandon("The forwarded permission request could not be written");
    }

    return this.pollForForwardedResponse(
      location,
      request,
      requestPath,
      responsePath,
      target,
    );
  }

  private buildForwardedRequest(
    ctx: ForwarderContext,
    facts: ForwardedRequestFacts,
    requesterSessionId: string,
    targetSessionId: string,
  ): ForwardedPermissionRequest {
    const requestId = forwardableRequestId(facts.requestId);
    const requesterAgentName =
      getActiveAgentName(ctx) ??
      getActiveAgentNameFromSystemPrompt(getContextSystemPrompt(ctx)) ??
      "unknown";
    // Complete the child-fixed facts into a full ForwardedAccessIntent: the
    // gate fixed the access facts; the edge stamps the requester identity it
    // alone knows (cwd + principal). The parent resolves against this intent
    // and never re-derives the match set (ADR 0008).
    const accessIntent = facts.accessIntent
      ? {
          ...facts.accessIntent,
          requesterCwd: getCwd(ctx),
          principal: {
            sessionId: requesterSessionId,
            agentName: requesterAgentName,
          },
        }
      : undefined;
    return {
      id: requestId,
      createdAt: Date.now(),
      requesterSessionId,
      targetSessionId,
      requesterAgentName,
      payload: facts.payload,
      ...(facts.display
        ? {
            source: facts.display.source,
            surface: facts.display.surface,
            value: facts.display.value,
          }
        : {}),
      ...(facts.sessionApproval
        ? { sessionApproval: facts.sessionApproval }
        : {}),
      ...(accessIntent ? { accessIntent } : {}),
    };
  }

  private async pollForForwardedResponse(
    location: PermissionForwardingLocation,
    request: ForwardedPermissionRequest,
    requestPath: string,
    responsePath: string,
    target: PermissionForwardingTarget,
  ): Promise<PermissionPromptDecision> {
    const { id: requestId, requesterAgentName, targetSessionId } = request;
    const timeoutMs = this.getTimeoutMs();
    const deadline = Date.now() + timeoutMs;
    let unservedSince: number | null = null;

    while (Date.now() < deadline) {
      if (existsSync(responsePath)) {
        const response = readForwardedPermissionResponse(
          this.logger,
          responsePath,
        );
        const relayed = response ? relayDecision(response) : null;
        this.logger.review("forwarded_permission.response_received", {
          requestId,
          approved: response?.approved ?? null,
          state: response?.state ?? null,
          denialReason: response?.denialReason ?? null,
          responderSessionId: response?.responderSessionId ?? null,
          targetSessionId,
          responsePath,
          decidedBy: relayed?.decidedBy,
        });
        this.discardRequest(location, requestPath, responsePath);
        return (
          relayed ??
          abandon("The parent session's permission response could not be read")
        );
      }

      unservedSince = this.checkServingLiveness(target, unservedSince);
      if (
        unservedSince !== null &&
        Date.now() - unservedSince >= PERMISSION_FORWARDING_SERVING_GRACE_MS
      ) {
        const observation = this.serving.describe(target);
        this.logger.review("forwarded_permission.no_serving_session", {
          requestId,
          requesterSessionId: request.requesterSessionId,
          targetSessionId,
          // Which channel answered, and what it saw: the difference between a
          // parent that exited, one that was killed, and one polling under a
          // different session id is the whole diagnosis of a stalled forward.
          servingChannel: observation.channel,
          servingState: observation.state,
          servingSessionIds: observation.servingIds,
        });
        this.discardRequest(location, requestPath);
        return abandon(
          `Session '${target.sessionId}' is not serving forwarded permission requests`,
        );
      }

      await sleep(PERMISSION_FORWARDING_POLL_INTERVAL_MS);
    }

    logPermissionForwardingWarning(
      this.logger,
      `Timed out waiting for forwarded permission response '${responsePath}'`,
    );
    this.logger.review("forwarded_permission.response_timed_out", {
      requestId,
      requesterAgentName,
      targetSessionId,
      responsePath,
    });
    this.discardRequest(location, requestPath);
    return abandon(
      `Session '${target.sessionId}' did not answer within ${timeoutMs / 1000}s`,
    );
  }

  /**
   * Track how long the target has looked unserved, or `null` while it looks fine.
   *
   * Which channel can answer for this target is the judge's decision, not this
   * one's: a target it cannot judge answers `null`, which resets the window
   * exactly as "serving" does, so an unjudgeable target waits out the timeout.
   */
  private checkServingLiveness(
    target: PermissionForwardingTarget,
    unservedSince: number | null,
  ): number | null {
    return this.serving.isServing(target) === false
      ? (unservedSince ?? Date.now())
      : null;
  }

  /**
   * Drop this exchange's files and, if nothing else is pending, its directories.
   *
   * Deleting the request is what makes an abandonment final: a request left
   * behind would be answered by the parent long after the child gave up.
   */
  private discardRequest(
    location: PermissionForwardingLocation,
    requestPath: string,
    responsePath?: string,
  ): void {
    if (responsePath) {
      safeDeleteFile(
        this.logger,
        responsePath,
        "forwarded permission response",
      );
    }
    safeDeleteFile(this.logger, requestPath, "forwarded permission request");
    cleanupPermissionForwardingLocationIfEmpty(this.logger, location);
  }
}
