import { applyPermissionGate } from "../../permission-gate";
import type { PermissionCheckResult } from "../../types";
import type { GateDescriptor, GateRunnerDeps } from "./descriptor";
import { deriveResolution } from "./helpers";
import type { GateOutcome } from "./types";

/**
 * Execute the full check→log→emit→approve cycle for a gate descriptor.
 *
 * This is the single site for:
 * - Permission checking (or using pre-resolved state)
 * - Session-hit fast path
 * - Interactive prompt orchestration
 * - Decision event emission
 * - Session-rule recording
 *
 * Gate functions produce descriptors; this runner executes them.
 */
export async function runGateCheck(
  descriptor: GateDescriptor,
  agentName: string | null,
  toolCallId: string,
  deps: GateRunnerDeps,
): Promise<GateOutcome> {
  // 1. Resolve permission state — pre-check, pre-resolved, or via checkPermission
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
    check = deps.checkPermission(
      descriptor.surface,
      descriptor.input,
      agentName ?? undefined,
      deps.getSessionRuleset(),
    );
  }

  // 2. Session-hit fast path
  if (check.source === "session") {
    deps.writeReviewLog("permission_request.session_approved", {
      ...descriptor.logContext,
      agentName,
      resolution: "session_approved",
      sessionApprovalPattern: check.matchedPattern,
    });
    deps.emitDecision({
      surface: descriptor.decision.surface,
      value: descriptor.decision.value,
      result: "allow",
      resolution: "session_approved",
      origin: check.origin ?? null,
      agentName: agentName ?? null,
      matchedPattern: check.matchedPattern ?? null,
    });
    return { action: "allow" };
  }

  // 3. Apply the deny/ask/allow gate
  const canConfirm = deps.canConfirm();

  // Resolve the first pattern for applyPermissionGate's sessionApproval param
  const singleSessionApproval = descriptor.sessionApproval
    ? "pattern" in descriptor.sessionApproval
      ? {
          surface: descriptor.sessionApproval.surface,
          pattern: descriptor.sessionApproval.pattern,
        }
      : descriptor.sessionApproval.patterns.length > 0
        ? {
            surface: descriptor.sessionApproval.surface,
            pattern: descriptor.sessionApproval.patterns[0],
          }
        : undefined
    : undefined;

  let autoApproved = false;
  const gateResult = await applyPermissionGate({
    state: check.state,
    canConfirm,
    sessionApproval: singleSessionApproval,
    promptForApproval: async () => {
      const decision = await deps.promptPermission({
        requestId: toolCallId,
        ...descriptor.promptDetails,
      });
      autoApproved = decision.autoApproved === true;
      return decision;
    },
    writeLog: deps.writeReviewLog,
    logContext: { ...descriptor.logContext, agentName },
    messages: descriptor.messages,
  });

  // 4. Determine whether session approval was granted
  const hasSessionApproval =
    gateResult.action === "allow" && gateResult.sessionApproval !== undefined;
  const hasCustomPatternApproval =
    gateResult.action === "allow" &&
    gateResult.customPatternApproval !== undefined;

  // 5. Emit decision event
  deps.emitDecision({
    surface: descriptor.decision.surface,
    value: descriptor.decision.value,
    result: gateResult.action === "allow" ? "allow" : "deny",
    resolution: deriveResolution(
      check.state,
      gateResult.action,
      hasSessionApproval,
      canConfirm,
      autoApproved,
      hasCustomPatternApproval,
    ),
    origin: check.origin ?? null,
    agentName: agentName ?? null,
    matchedPattern: check.matchedPattern ?? null,
  });

  // 6. Record session approval(s)
  if (gateResult.action === "allow" && hasSessionApproval) {
    if (descriptor.sessionApproval) {
      if ("patterns" in descriptor.sessionApproval) {
        for (const pattern of descriptor.sessionApproval.patterns) {
          deps.approveSessionRule(descriptor.sessionApproval.surface, pattern);
        }
      } else {
        deps.approveSessionRule(
          descriptor.sessionApproval.surface,
          descriptor.sessionApproval.pattern,
        );
      }
    }
  }

  if (gateResult.action === "allow" && gateResult.customPatternApproval) {
    const customPattern = gateResult.customPatternApproval;
    const surface = descriptor.promptDetails.surface ?? descriptor.surface;

    if (customPattern.target === "session") {
      deps.approveSessionRule(surface, customPattern.pattern);
      deps.writeReviewLog("permission_request.custom_pattern_recorded", {
        ...descriptor.logContext,
        agentName,
        surface,
        resolution: "approved_with_custom_pattern",
        customPattern: customPattern.pattern,
        customPatternTarget: "session",
      });
    } else {
      const configPath = deps.persistCustomPattern(
        customPattern.target,
        surface,
        customPattern.pattern,
        descriptor.promptDetails.defaultPersistAction ?? "allow",
      );
      deps.approveSessionRule(surface, customPattern.pattern);
      deps.refreshConfig();
      deps.writeReviewLog("permission_request.custom_pattern_recorded", {
        ...descriptor.logContext,
        agentName,
        surface,
        resolution: "approved_with_custom_pattern",
        customPattern: customPattern.pattern,
        customPatternTarget: customPattern.target,
        configPath,
      });
    }
  }

  if (gateResult.action === "block") {
    return { action: "block", reason: gateResult.reason };
  }

  return { action: "allow" };
}
