import { join } from "node:path";
import type { DecisionSource } from "#src/authority/decision-source";
import {
  type ForwarderContext,
  getSessionId,
} from "#src/authority/forwarder-context";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import {
  type ForwardedAccessFacts,
  type ForwardedAccessIntent,
  type ForwardedPermissionRequest,
  type ForwardedPermissionResponse,
  isForwardedPermissionRequestForSession,
  type PermissionForwardingLocation,
} from "#src/authority/permission-forwarding";
import type { SubagentSessionRegistry } from "#src/authority/subagent-registry";
import type { DecisionBroadcaster } from "#src/decision-reporter";
import type {
  PermissionDecisionEvent,
  PermissionDecisionResolution,
} from "#src/permission-events";
import { buildForwardedAskPayload } from "#src/presentation/forwarded-ask-payload";
import { SessionApproval } from "#src/session-approval";
import type { SessionApprovalRecorder } from "#src/session-approval-recorder";
import type { DebugReviewLogger } from "#src/session-logger";
import type { PermissionCheckResult } from "#src/types";
import type { AskEscalator } from "./authorizer-selection";
import {
  cleanupPermissionForwardingLocationIfEmpty,
  ensureDirectoryExists,
  formatUnknownErrorMessage,
  getExistingPermissionForwardingLocation,
  listRequestFiles,
  logPermissionForwardingError,
  logPermissionForwardingWarning,
  readForwardedPermissionRequest,
  safeDeleteFile,
  writeJsonFileAtomic,
} from "./forwarding-io";
import type { PromptPermissionDetails } from "./permission-prompter";

/**
 * Narrow seam describing what `ForwardingManager` needs from the server: a
 * single method that drains this session's forwarded-permission inbox.
 *
 * Depending on the interface (not the concrete `ForwardedRequestServer`)
 * keeps the manager's unit tests free of casts — they inject a plain
 * `{ processInbox: vi.fn() }` mock.
 */
export interface InboxProcessor {
  processInbox(ctx: ForwarderContext): Promise<void>;
}

/**
 * Recorded-authority view the serving node resolves a forwarded request
 * against: answer one {@link ForwardedAccessIntent} query on the serving
 * session's composed ruleset, agent-scoped to the requester
 * (`principal.agentName`, ADR 0008 §3) — the child-fixed `matchValues` are
 * used as-is, never re-derived through this session's `PathNormalizer`/cwd.
 *
 * Narrow by design (ISP): the server needs one decision, not the whole
 * resolver. The composition root satisfies it with
 * `buildResolvedIntentFromMatchValues` plus `resolver.resolve`, the same
 * `resolve` entry point `LocalPermissionsService` composes.
 */
export interface ServingPolicy {
  resolve(intent: ForwardedAccessIntent): PermissionCheckResult;
}

/** Constructor config for `ForwardedRequestServer`. */
export interface ForwardedRequestServerDeps {
  forwardingDir: string;
  logger: DebugReviewLogger;
  /** Recorded-authority resolution for a forwarded `ForwardedAccessIntent`. */
  policy: ServingPolicy;
  /** Escalation seam to the serving session's selected `Authorizer` on `ask`. */
  escalator: AskEscalator;
  /**
   * Terminal-decision broadcast for an ask this session served.
   *
   * A forwarded ask is prompted here but gated in the requesting session — on
   * another event bus for an out-of-process child — so without this the
   * parent's own consumers observe a prompt that never ends (#610).
   */
  broadcaster: DecisionBroadcaster;
  /**
   * The serving session's `SessionRules`. Records a whole-session grant when a
   * human approves a forwarded request for the entire serving session.
   */
  recorder: SessionApprovalRecorder;
  /** In-process subagent registry, read only by the one-hop canary. */
  registry?: SubagentSessionRegistry;
}

// ── Module-private helpers ────────────────────────────────────────────────

/**
 * Map a forwarded request onto the escalated ask's details, carrying the
 * forwarded provenance (requester agent/session + the child's original display
 * projection) so `LocalUserAuthorizer` emits a non-degraded broadcast (#292),
 * plus the child-fixed access facts so the serving node's `Authorizer` chain
 * judges a forwarded ask on the same evidence as a local one (ADR 0008; #635).
 *
 * The display `surface` and the fact `surface` are distinct and both belong
 * here: the former is the child's tool name (what the UI shows), the latter the
 * gate surface the rule fired on (what the bounded-delegation checkpoint
 * excludes on).
 */
function buildForwardedAskDetails(
  request: ForwardedPermissionRequest,
): PromptPermissionDetails {
  const payload = buildForwardedAskPayload(request);
  return {
    requestId: request.id,
    source: request.source ?? "tool_call",
    agentName: request.requesterAgentName || null,
    payload,
    surface: request.surface ?? null,
    value: request.value ?? null,
    forwarding: {
      requesterAgentName: request.requesterAgentName || null,
      requesterSessionId: request.requesterSessionId || null,
    },
    // Carries the child's suggestion so LocalUserAuthorizer can offer the
    // whole-session grant scope; absent for a legacy/version-skew request.
    ...(request.sessionApproval
      ? { sessionApproval: request.sessionApproval }
      : {}),
    // Absent for a version-skew request that carried no intent — which the
    // delegation envelope reads as "surface undetermined" and fail-safes to
    // excluded, so absence must stay absence rather than become `undefined`.
    ...(request.accessIntent
      ? { accessIntent: toAccessFacts(request.accessIntent) }
      : {}),
  };
}

/**
 * Project the wire intent down to the child-fixed access facts an `Authorizer`
 * may see.
 *
 * Field-by-field rather than a spread, because this is a disclosure boundary:
 * `requesterCwd` and `principal` are requester identity for the serving node's
 * own resolution (ADR 0008 §3) and stay off the ask details. A link that needs
 * requester identity reads `details.forwarding`. `ForwardedAccessIntent`
 * extends `ForwardedAccessFacts`, so a spread would type-check while widening
 * disclosure at runtime; the explicit return type makes any future field on
 * `ForwardedAccessFacts` a compile error here until it is deliberately
 * projected or deliberately withheld.
 */
function toAccessFacts(intent: ForwardedAccessIntent): ForwardedAccessFacts {
  return {
    surface: intent.surface,
    matchValues: intent.matchValues,
    boundaryValue: intent.boundaryValue,
  };
}

/**
 * Build the terminal `permissions:decision` for an ask this session served.
 *
 * Rendered from the same {@link PromptPermissionDetails} the `ui_prompt`
 * broadcast was built from, so prompt and decision carry one projection by
 * construction rather than by convention — which is what makes them joinable
 * beyond the shared request id.
 *
 * `origin` and `matchedPattern` are `null` by construction: an escalated
 * request is one recorded authority did *not* decide, so no rule won. The
 * decider stays off the bus, which discloses request facts and verdicts only
 * (ADR 0011 §6, #726).
 */
function buildServedDecisionEvent(
  details: PromptPermissionDetails,
  decision: PermissionPromptDecision,
): PermissionDecisionEvent {
  const facts = details.payload.request;
  return {
    requestId: details.requestId,
    // The child's display projection, falling back to the payload's own facts
    // for a version-skewed request that carried none. Both are non-nullable
    // there, so the event's non-null contract holds without a sentinel.
    surface: details.surface ?? facts.surface,
    value: details.value ?? facts.value,
    agentName: details.agentName,
    result: decision.approved ? "allow" : "deny",
    resolution: servedResolution(decision),
    origin: null,
    matchedPattern: null,
    forwarding: details.forwarding ?? null,
  };
}

/**
 * Name how a served ask resolved, reading the decision's own stamp rather than
 * re-deriving it from the outcome: the site that decided already recorded what
 * it was (#726).
 *
 * The grant scope is reported as the human chose it. {@link applyGrantScope}
 * rewrites a whole-serving-session grant to a plain approval on the wire, but
 * that translation is about what the *child* records, not about what was
 * allowed here.
 */
function servedResolution(
  decision: PermissionPromptDecision,
): PermissionDecisionResolution {
  if (decision.decidedBy.kind === "gate_error") {
    return "gate_error";
  }
  if (decision.confirmationUnavailable) {
    return "confirmation_unavailable";
  }
  if (!decision.approved) {
    return "user_denied";
  }
  return decision.state === "approved_for_session" ||
    decision.state === "approved_for_serving_session"
    ? "user_approved_for_session"
    : "user_approved";
}

// ── ForwardedRequestServer ────────────────────────────────────────────────

/**
 * Owner of the serving-down role of the forwarded-permission behavior:
 * draining this session's forwarded-permission inbox and answering each
 * request the same way the session resolves a local action — resolving its
 * `ForwardedAccessIntent` against recorded authority (`ServingPolicy`), then
 * escalation to its selected `Authorizer` (`AskEscalator`) on `ask` (ADR
 * 0008).
 */
export class ForwardedRequestServer implements InboxProcessor {
  private readonly forwardingDir: string;
  private readonly logger: DebugReviewLogger;
  private readonly policy: ServingPolicy;
  private readonly escalator: AskEscalator;
  private readonly broadcaster: DecisionBroadcaster;
  private readonly recorder: SessionApprovalRecorder;
  private readonly registry: SubagentSessionRegistry | undefined;

  constructor(deps: ForwardedRequestServerDeps) {
    this.forwardingDir = deps.forwardingDir;
    this.logger = deps.logger;
    this.policy = deps.policy;
    this.escalator = deps.escalator;
    this.broadcaster = deps.broadcaster;
    this.recorder = deps.recorder;
    this.registry = deps.registry;
  }

  /** Drain and respond to this session's forwarded-permission inbox. */
  async processInbox(ctx: ForwarderContext): Promise<void> {
    const currentSessionId = getSessionId(ctx);
    const location = getExistingPermissionForwardingLocation(
      this.forwardingDir,
      currentSessionId,
    );
    if (!location) {
      return;
    }

    const requestFiles = listRequestFiles(this.logger, location.requestsDir);
    if (requestFiles.length === 0) {
      return;
    }

    // Defensively recreate responses/ before writing any response — a
    // concurrent cleanup pass may have removed it between the requestsDir
    // existence check above and the write inside processSingleForwardedRequest
    // (the ENOENT write loop reported in issue #398).
    if (
      !ensureDirectoryExists(
        this.logger,
        location.responsesDir,
        "permission forwarding responses",
      )
    ) {
      return;
    }

    for (const fileName of requestFiles) {
      const requestPath = join(location.requestsDir, fileName);
      const request = readForwardedPermissionRequest(this.logger, requestPath);
      if (!request) {
        safeDeleteFile(
          this.logger,
          requestPath,
          `${location.label} forwarded permission request`,
        );
        continue;
      }

      await this.processSingleForwardedRequest(
        request,
        location,
        requestPath,
        currentSessionId,
      );
    }

    cleanupPermissionForwardingLocationIfEmpty(this.logger, location);
  }

  // ── Private methods ────────────────────────────────────────────────────

  private async processSingleForwardedRequest(
    request: ForwardedPermissionRequest,
    location: PermissionForwardingLocation,
    requestPath: string,
    currentSessionId: string,
  ): Promise<void> {
    if (!isForwardedPermissionRequestForSession(request, currentSessionId)) {
      logPermissionForwardingWarning(
        this.logger,
        `Ignoring forwarded permission request '${request.id}' because it targets session '${request.targetSessionId}' instead of '${currentSessionId}'`,
      );
      safeDeleteFile(
        this.logger,
        requestPath,
        `${location.label} forwarded permission request`,
      );
      return;
    }

    this.warnOnMultiHop(request, currentSessionId);

    const forwardedPermissionLogDetails = {
      requestId: request.id,
      source: location.label,
      requesterAgentName: request.requesterAgentName,
      requesterSessionId: request.requesterSessionId,
      targetSessionId: request.targetSessionId,
      requestPath,
    };

    const decision = await this.resolveDecision(
      request,
      forwardedPermissionLogDetails,
    );

    this.recordForwardedDecision(
      request,
      location,
      requestPath,
      currentSessionId,
      this.applyGrantScope(request, decision, forwardedPermissionLogDetails),
    );
  }

  /**
   * Apply the human's grant-scope choice on a forwarded approval.
   *
   * A whole-session grant (`approved_for_serving_session`) records the child's
   * suggested pattern into this serving node's `SessionRules` — the single
   * source of truth for the scope — and is then translated to a plain
   * `approved` so the child records nothing (its next identical action
   * re-forwards and resolves as recorded authority). Every other decision
   * passes through unchanged (`approved_for_session` → the child records).
   *
   * The translation rewrites the grant's *scope*, never its decider: the human
   * who chose the wider scope is still the one who decided (#726).
   */
  private applyGrantScope(
    request: ForwardedPermissionRequest,
    decision: PermissionPromptDecision,
    logDetails: Record<string, unknown>,
  ): PermissionPromptDecision {
    if (decision.state !== "approved_for_serving_session") {
      return decision;
    }
    if (request.sessionApproval) {
      this.recorder.recordSessionApproval(
        SessionApproval.multiple(
          request.sessionApproval.surface,
          request.sessionApproval.patterns,
        ),
      );
      this.logger.review("forwarded_permission.session_recorded", {
        ...logDetails,
        surface: request.sessionApproval.surface,
        patterns: request.sessionApproval.patterns,
      });
    }
    return {
      approved: true,
      state: "approved",
      decidedBy: decision.decidedBy,
    };
  }

  /**
   * Persist the served decision: write the response file the child polls for,
   * log the outcome, and delete the drained request. The symmetric "respond"
   * half to {@link resolveDecision}'s "decide" half.
   */
  private recordForwardedDecision(
    request: ForwardedPermissionRequest,
    location: PermissionForwardingLocation,
    requestPath: string,
    currentSessionId: string,
    decision: PermissionPromptDecision,
  ): void {
    const responsePath = join(location.responsesDir, `${request.id}.json`);
    this.logger.review(
      decision.approved
        ? "forwarded_permission.approved"
        : "forwarded_permission.denied",
      {
        requestId: request.id,
        source: location.label,
        requesterAgentName: request.requesterAgentName,
        requesterSessionId: request.requesterSessionId,
        targetSessionId: request.targetSessionId,
        responsePath,
        resolution: decision.state,
        denialReason: decision.denialReason ?? null,
        decidedBy: decision.decidedBy,
      },
    );
    try {
      writeJsonFileAtomic(this.logger, responsePath, {
        approved: decision.approved,
        state: decision.state,
        denialReason: decision.denialReason,
        responderSessionId: currentSessionId,
        respondedAt: Date.now(),
        // Carried onto the wire so the requester can name what decided inside
        // this session, not merely that this session answered (#726).
        decidedBy: decision.decidedBy,
      } satisfies ForwardedPermissionResponse);
    } catch (error) {
      logPermissionForwardingError(
        this.logger,
        `Failed to write ${location.label} forwarded permission response '${responsePath}'`,
        error,
      );
      return;
    }

    safeDeleteFile(
      this.logger,
      requestPath,
      `${location.label} forwarded permission request`,
    );
  }

  /**
   * Resolve the request the same way the session resolves a local action:
   * recorded authority first (a request carrying an `accessIntent` — the
   * child-fixed facts, ADR 0008 §2 — resolves against the serving node's
   * composed ruleset — `allow`, including yolo-rewritten, auto-approves;
   * `deny` auto-denies), then escalate `ask` (or a request missing
   * `accessIntent`, the version-skew floor, ADR 0008 §4) to the selected
   * `Authorizer`.
   */
  private async resolveDecision(
    request: ForwardedPermissionRequest,
    logDetails: Record<string, unknown>,
  ): Promise<PermissionPromptDecision> {
    const check = request.accessIntent
      ? this.policy.resolve(request.accessIntent)
      : null;

    if (check && check.state !== "ask") {
      // The rule is carried in full rather than left to the event name: the
      // response file has no surface, pattern, or origin column for the
      // requester's record to lean on.
      const decidedBy: DecisionSource = {
        kind: "rule",
        surface: request.accessIntent?.surface ?? check.toolName,
        pattern: check.matchedPattern ?? null,
        origin: check.origin,
      };
      const approved = check.state === "allow";
      this.logger.review(
        approved
          ? "forwarded_permission.auto_approved"
          : "forwarded_permission.auto_denied",
        { ...logDetails, decidedBy },
      );
      return approved
        ? { approved: true, state: "approved", decidedBy }
        : { approved: false, state: "denied", decidedBy };
    }

    this.logger.review("forwarded_permission.prompted", logDetails);
    const details = buildForwardedAskDetails(request);
    const decision = await this.escalateAsk(details);
    // Announced before the grant-scope translation and before the response is
    // written: the ask this session broadcast is over once someone here has
    // answered it, whatever becomes of the file the child polls for (#610).
    this.broadcaster.emitDecision(buildServedDecisionEvent(details, decision));
    return decision;
  }

  /**
   * Escalate a forwarded ask to the serving session's selected `Authorizer`,
   * failing closed instead of throwing: an escalation that breaks is nobody's
   * denial, so the node records itself as the decider.
   *
   * Separate from {@link resolveDecision} so the ask's details outlive the
   * call — every record of the served ask is a render over that one object.
   */
  private async escalateAsk(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision> {
    try {
      return await this.escalator.escalate(details);
    } catch (error) {
      const reason = formatUnknownErrorMessage(error);
      logPermissionForwardingError(
        this.logger,
        `Failed to escalate forwarded permission request '${details.requestId}'`,
        error,
      );
      return {
        approved: false,
        state: "denied",
        decidedBy: { kind: "gate_error", reason },
      };
    }
  }

  /**
   * One-hop canary: forwarding is depth-1 (child → root). If the requester is
   * itself a registered subagent whose parent is not this serving session, the
   * request came through more than one hop (or was misrouted) — resolution is
   * still well-defined, so keep serving, but warn loudly so a future
   * recursion-guard break is visible rather than silent. Unregistered
   * (external file-based) requesters have no recorded parent and are silent.
   */
  private warnOnMultiHop(
    request: ForwardedPermissionRequest,
    currentSessionId: string,
  ): void {
    const requesterInfo = this.registry?.get(request.requesterSessionId);
    if (
      requesterInfo?.parentSessionId &&
      requesterInfo.parentSessionId !== currentSessionId
    ) {
      logPermissionForwardingWarning(
        this.logger,
        `Forwarded permission request '${request.id}' violates the one-hop ` +
          `invariant: requester '${request.requesterSessionId}' is a registered ` +
          `subagent whose parent '${requesterInfo.parentSessionId}' is not this ` +
          `serving session '${currentSessionId}' (multi-hop or misrouted).`,
      );
    }
  }
}
