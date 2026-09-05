import type { AskEscalator } from "#src/authority/authorizer-selection";
import { resolutionFor } from "#src/authority/decision-resolution";
import type { DecisionSource } from "#src/authority/decision-source";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { DecisionReporter } from "#src/logging/decision-reporter";
import { createPermissionRequestId } from "#src/permission-request-id";
import { applyPermissionGate } from "#src/policy/permission-gate";
import type { ScopedPermissionResolver } from "#src/policy/permission-resolver";
import {
  renderPolicyDenial,
  renderRefusal,
} from "#src/presentation/agent-renderer";
import { renderReviewLogFacts } from "#src/presentation/review-log-renderer";
import type { SessionApprovalRecorder } from "#src/session-approval-recorder";
import type { PermissionCheckResult } from "#src/types";
import type {
  DecisionEventFacts,
  GateDescriptor,
  GateResult,
} from "./descriptor";
import { isGateBypass } from "./descriptor";
import { buildDecisionEvent, resolveYoloGrant } from "./helpers";
import type { GateOutcome } from "./types";

// ── GateRunner class ───────────────────────────────────────────────────────

/**
 * Executes permission gate checks for a single gate result (null, bypass, or
 * descriptor).
 *
 * Constructed once per handler with its four role collaborators and reused
 * for every gate in a tool-call pipeline. The `run` method absorbs the null /
 * bypass / descriptor dispatch that previously lived as an anonymous closure
 * in `PermissionGateHandler.handleToolCall`.
 */
export class GateRunner {
  constructor(
    private readonly resolver: ScopedPermissionResolver,
    private readonly recorder: SessionApprovalRecorder,
    private readonly prompter: AskEscalator,
    private readonly reporter: DecisionReporter,
    /**
     * Live yolo reader, read per gate so a mid-session config change takes
     * effect — the same closure `PermissionManager` receives.
     */
    private readonly isYoloEnabled: () => boolean,
  ) {}

  /**
   * Execute a gate: null → allow; bypass → log/emit side effects then allow;
   * descriptor → full check→log→emit→approve cycle.
   *
   * The request id is minted here, before the branch, so a request that never
   * prompts is identified exactly as one that does.
   */
  async run(gate: GateResult, agentName: string | null): Promise<GateOutcome> {
    if (!gate) {
      return { action: "allow" };
    }
    const requestId = createPermissionRequestId();
    if (isGateBypass(gate)) {
      if (gate.log) {
        this.reporter.writeReviewLog(gate.log.event, {
          ...gate.log.details,
          requestId,
          decidedBy: gate.decidedBy,
        });
      }
      if (gate.decision) {
        this.emitDecision(requestId, gate.decision);
      }
      return { action: "allow" };
    }
    return this.runDescriptor(gate, agentName, requestId);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * The one place a decision event acquires its request id, so no emit path
   * can be added that forgets it.
   */
  private emitDecision(requestId: string, facts: DecisionEventFacts): void {
    this.reporter.emitDecision({ requestId, ...facts });
  }

  private async runDescriptor(
    descriptor: GateDescriptor,
    agentName: string | null,
    requestId: string,
  ): Promise<GateOutcome> {
    // 1. Resolve permission state — pre-check, pre-resolved, or via resolver
    let check: PermissionCheckResult;
    if (descriptor.preCheck) {
      check = descriptor.preCheck;
    } else if (descriptor.preResolved) {
      check = {
        state: descriptor.preResolved.state,
        toolName: descriptor.surface,
        source: "tool",
        origin: "builtin",
      };
    } else {
      check = this.resolver.resolve({
        kind: "tool",
        surface: descriptor.surface,
        input: descriptor.input,
        agentName: agentName ?? undefined,
      });
    }

    // The fields every review-log write for this gate shares, whatever the
    // resolution — built once so a field added here reaches all of them. The
    // payload's request facts are stamped here rather than by each gate, for
    // the same reason `requestId` is: a gate cannot forget what it never
    // supplies (ADR 0011 §6).
    const logContext = {
      ...descriptor.logContext,
      ...renderReviewLogFacts(descriptor.payload),
      agentName,
      requestId,
    };

    // Each resolution below states its own decider. The provenance is built
    // at the branch that decides rather than merged into `logContext`: that
    // context holds what every resolution of this gate shares, and who decided
    // is by definition not shared (#726).

    // 2. Session-hit fast path
    if (check.source === "session") {
      this.reporter.writeReviewLog("permission_request.session_approved", {
        ...logContext,
        resolution: "session_approved",
        sessionApprovalPattern: check.matchedPattern,
        decidedBy: {
          kind: "session_approval",
          surface: descriptor.surface,
          pattern: check.matchedPattern ?? null,
        },
      });
      this.emitDecision(
        requestId,
        buildDecisionEvent(
          descriptor.decision,
          check,
          agentName,
          "allow",
          "session_approved",
        ),
      );
      return { action: "allow" };
    }

    // 2b. Yolo fast-path — the composition-stage ask→allow rewrite (origin
    // "yolo" on the matched rule, #526) or, under yolo, an ask synthesized
    // after resolution (#712). Auto-approve without prompting, preserving the
    // single auto_approved review entry + decision event so log parity holds.
    const yoloGrant = resolveYoloGrant(check, this.isYoloEnabled());
    if (yoloGrant) {
      // The pattern that raised the ask, sentinel included: "yolo allowed it"
      // alone does not say why it was asked in the first place. One record for
      // both the review entry and the broadcast, so they cannot disagree.
      const decidedByYolo: DecisionSource = {
        kind: "yolo",
        pattern: check.matchedPattern ?? null,
      };
      this.reporter.writeReviewLog("permission_request.auto_approved", {
        ...logContext,
        resolution: "auto_approved",
        decidedBy: decidedByYolo,
      });
      this.emitDecision(
        requestId,
        buildDecisionEvent(
          descriptor.decision,
          yoloGrant,
          agentName,
          "allow",
          resolutionFor(decidedByYolo, { approved: true, forSession: false }),
        ),
      );
      return { action: "allow" };
    }

    // 3. Apply the deny/ask/allow gate — always escalate on ask; the selected
    // Authorizer answers (the DenyingAuthorizer by denying with a marker).

    // The agent-facing renders of this ask. The rule reason is the operator's
    // deny-with-reason text, which lives on the resolved check rather than the
    // payload: no human render wants it, because a deny never prompts.
    const { payload } = descriptor;
    const messages = {
      denyReason: renderPolicyDenial(payload, check.reason ?? null),
      refusedReason: (decision: PermissionPromptDecision) =>
        renderRefusal(
          payload,
          decision.decidedBy,
          decision.denialReason ?? null,
        ),
    };

    // The rule that resolved this gate, and the decider for every arm that
    // never escalates: `allow` and `deny` are recorded authority answering.
    const decidedByRule: DecisionSource = {
      kind: "rule",
      surface: descriptor.surface,
      pattern: check.matchedPattern ?? null,
      origin: check.origin,
    };
    const gateResult = await applyPermissionGate({
      state: check.state,
      canGrantForSession: descriptor.sessionApproval?.isRecordable ?? false,
      promptForApproval: async () => {
        const decision = await this.prompter.escalate({
          requestId,
          payload,
          ...descriptor.promptDetails,
          ...(descriptor.sessionApproval
            ? { sessionApproval: descriptor.sessionApproval.toForwardedData() }
            : {}),
        });
        return decision;
      },
      writeLog: (event, details) =>
        this.reporter.writeReviewLog(event, details),
      logContext,
      decidedByRule,
      messages,
    });

    // 4. Determine whether session approval was granted, and at what width
    const sessionGrant =
      gateResult.action === "allow" ? gateResult.sessionGrant : undefined;

    // 5. Emit decision event
    this.emitDecision(
      requestId,
      buildDecisionEvent(
        descriptor.decision,
        check,
        agentName,
        gateResult.action === "allow" ? "allow" : "deny",
        resolutionFor(gateResult.decidedBy, {
          approved: gateResult.action === "allow",
          forSession: sessionGrant !== undefined,
        }),
      ),
    );

    // 6. Record session approval — tell the store; it owns the per-pattern loop
    // A present grant already implies gateResult.action === "allow".
    if (sessionGrant && descriptor.sessionApproval) {
      this.recorder.recordSessionApproval(
        descriptor.sessionApproval.atWidth(sessionGrant.width),
      );
    }

    if (gateResult.action === "block") {
      return { action: "block", reason: gateResult.reason };
    }

    return { action: "allow" };
  }
}
