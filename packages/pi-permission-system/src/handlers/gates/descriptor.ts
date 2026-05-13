import type {
  CustomPatternApprovalTarget,
  PermissionPromptDecision,
} from "../../permission-dialog";
import type { PermissionDecisionEvent } from "../../permission-events";
import type { PromptPermissionDetails } from "../../permission-prompter";
import type { Rule } from "../../rule";
import type { PermissionCheckResult, PermissionState } from "../../types";

// ── Descriptor types ───────────────────────────────────────────────────────

/**
 * Pure output of a gate function — describes what to check and how to present it.
 *
 * The gate runner (`runGateCheck`) uses this descriptor to execute the
 * mechanical check→log→emit→approve cycle without the gate needing to know
 * about logging, event emission, or session-rule recording.
 */
export interface GateDescriptor {
  /** Permission surface to check (e.g. "bash", "external_directory", "skill"). */
  surface: string;
  /** Input passed to checkPermission. */
  input: unknown;
  /** Message strings/factories for each outcome. */
  messages: {
    denyReason: string;
    unavailableReason: string;
    userDeniedReason: (decision: PermissionPromptDecision) => string;
  };
  /**
   * Session-approval suggestion for "for this session" option.
   * Single pattern or multiple patterns (bash external-directory gate).
   */
  sessionApproval?:
    | { surface: string; pattern: string }
    | { surface: string; patterns: string[] };
  /** Details passed to the interactive permission prompt (requestId is added by the runner). */
  promptDetails: Omit<PromptPermissionDetails, "requestId">;
  /** Extra context fields written to the review log alongside gate outcomes. */
  logContext: Record<string, unknown>;
  /** Surface and value for the decision event (may differ from the check surface). */
  decision: {
    surface: string;
    value: string;
  };
  /**
   * When set, the gate has already resolved the permission state
   * (e.g. from a skill entry match). The runner uses this directly
   * instead of calling checkPermission.
   */
  preResolved?: {
    state: PermissionState;
  };
  /**
   * When set, the runner uses this pre-computed check result directly
   * instead of calling checkPermission. Used when the orchestrator has
   * already performed the check (e.g. to build messages from the result).
   */
  preCheck?: PermissionCheckResult;
}

/**
 * Early allow result — gate has determined the action without needing the runner.
 *
 * Used for cases like Pi infrastructure read bypass where the gate short-circuits
 * with a deterministic allow before reaching the permission check.
 */
export interface GateBypass {
  action: "allow";
  /** Optional review log entry to emit. */
  log?: { event: string; details: Record<string, unknown> };
  /** Optional decision event to emit. */
  decision?: PermissionDecisionEvent;
}

/** Union of possible gate function return values. */
export type GateResult = GateDescriptor | GateBypass | null;

// ── Runner dependency interface ────────────────────────────────────────────

/**
 * Infrastructure dependencies for the gate runner.
 *
 * Built once in the orchestrator and reused for all gates.
 * Handles all side effects: permission checks, logging, event emission,
 * session-rule recording.
 */
export interface GateRunnerDeps {
  checkPermission(
    surface: string,
    input: unknown,
    agentName?: string,
    sessionRules?: Rule[],
  ): PermissionCheckResult;
  getSessionRuleset(): Rule[];
  approveSessionRule(surface: string, pattern: string): void;
  persistCustomPattern(
    target: CustomPatternApprovalTarget,
    surface: string,
    pattern: string,
    action: "allow" | "ask",
  ): string;
  refreshConfig(): void;
  writeReviewLog(event: string, details: Record<string, unknown>): void;
  emitDecision(event: PermissionDecisionEvent): void;
  canConfirm(): boolean;
  promptPermission(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision>;
}

// ── Type guard helpers ─────────────────────────────────────────────────────

/** Check whether a GateResult is a GateBypass (early allow). */
export function isGateBypass(result: GateResult): result is GateBypass {
  return result !== null && "action" in result;
}

/** Check whether a GateResult is a GateDescriptor (needs runner). */
export function isGateDescriptor(result: GateResult): result is GateDescriptor {
  return result !== null && !("action" in result);
}
