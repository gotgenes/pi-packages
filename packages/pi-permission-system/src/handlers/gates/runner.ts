import type { AskEscalator } from "#src/authority/authorizer-selection";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { DecisionReporter } from "#src/decision-reporter";
import {
  formatDenyReason,
  formatUnavailableReason,
  formatUserDeniedReason,
} from "#src/denial-messages";
import { applyPermissionGate } from "#src/permission-gate";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import { SessionApproval } from "#src/session-approval";
import type { SessionApprovalRecorder } from "#src/session-approval-recorder";
import type { PermissionCheckResult } from "#src/types";
import type { GateDescriptor, GateResult } from "./descriptor";
import { isGateBypass } from "./descriptor";
import { buildDecisionEvent, deriveResolution } from "./helpers";
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
  ) {}

  /**
   * Execute a gate: null → allow; bypass → log/emit side effects then allow;
   * descriptor → full check→log→emit→approve cycle.
   */
  async run(
    gate: GateResult,
    agentName: string | null,
    toolCallId: string,
  ): Promise<GateOutcome> {
    if (!gate) {
      return { action: "allow" };
    }
    if (isGateBypass(gate)) {
      if (gate.log) {
        this.reporter.writeReviewLog(gate.log.event, gate.log.details);
      }
      if (gate.decision) {
        this.reporter.emitDecision(gate.decision);
      }
      return { action: "allow" };
    }
    return this.runDescriptor(gate, agentName, toolCallId);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async runDescriptor(
    descriptor: GateDescriptor,
    agentName: string | null,
    toolCallId: string,
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

    // 2. Session-hit fast path
    if (check.source === "session") {
      this.reporter.writeReviewLog("permission_request.session_approved", {
        ...descriptor.logContext,
        agentName,
        resolution: "session_approved",
        sessionApprovalPattern: check.matchedPattern,
      });
      this.reporter.emitDecision(
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

    // 2b. Yolo fast-path — a composition-stage ask→allow rewrite records
    // origin "yolo" on the matched rule. Auto-approve without prompting,
    // preserving today's single auto_approved review entry + decision event
    // so review-log parity holds (#526).
    if (check.state === "allow" && check.origin === "yolo") {
      this.reporter.writeReviewLog("permission_request.auto_approved", {
        ...descriptor.logContext,
        agentName,
        resolution: "auto_approved",
      });
      this.reporter.emitDecision(
        buildDecisionEvent(
          descriptor.decision,
          check,
          agentName,
          "allow",
          deriveResolution(check.state, "allow", false, false, true),
        ),
      );
      return { action: "allow" };
    }

    // 3. Apply the deny/ask/allow gate — always escalate on ask; the selected
    // Authorizer answers (the DenyingAuthorizer by denying with a marker).

    // Construct messages from the centralized formatter.
    const messages = {
      denyReason: formatDenyReason(descriptor.denialContext),
      unavailableReason: formatUnavailableReason(descriptor.denialContext),
      userDeniedReason: (decision: PermissionPromptDecision) =>
        formatUserDeniedReason(descriptor.denialContext, decision.denialReason),
    };

    let autoApproved = false;
    let confirmationUnavailable = false;
    const gateResult = await applyPermissionGate({
      state: check.state,
      sessionApproval: descriptor.sessionApproval?.toGateApproval(),
      promptForApproval: async () => {
        const decision = await this.prompter.escalate({
          requestId: toolCallId,
          ...descriptor.promptDetails,
          ...(descriptor.sessionApproval
            ? { sessionApproval: descriptor.sessionApproval.toForwardedData() }
            : {}),
        });
        autoApproved = decision.autoApproved === true;
        confirmationUnavailable = decision.confirmationUnavailable === true;
        return decision;
      },
      writeLog: (event, details) =>
        this.reporter.writeReviewLog(event, details),
      logContext: { ...descriptor.logContext, agentName },
      messages,
    });

    // 4. Determine whether session approval was granted
    const hasSessionApproval =
      gateResult.action === "allow" && gateResult.sessionApproval !== undefined;

    // 5. Emit decision event
    this.reporter.emitDecision(
      buildDecisionEvent(
        descriptor.decision,
        check,
        agentName,
        gateResult.action === "allow" ? "allow" : "deny",
        deriveResolution(
          check.state,
          gateResult.action,
          hasSessionApproval,
          confirmationUnavailable,
          autoApproved,
        ),
      ),
    );

    // 6. Record session approval — tell the store; it owns the per-pattern loop
    // hasSessionApproval already implies gateResult.action === "allow"
    if (hasSessionApproval && gateResult.sessionApproval) {
      this.recorder.recordSessionApproval(
        SessionApproval.multiple(
          gateResult.sessionApproval.surface,
          gateResult.sessionApproval.patterns,
        ),
      );
    }

    if (gateResult.action === "block") {
      return { action: "block", reason: gateResult.reason };
    }

    return { action: "allow" };
  }
}
