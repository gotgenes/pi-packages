import type { DecisionSource } from "#src/authority/decision-source";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import type { PermissionDecisionEvent } from "#src/permission-events";
import type { PromptPayload } from "#src/presentation/prompt-payload";
import type { SessionApproval } from "#src/session-approval";
import type { PermissionCheckResult, PermissionState } from "#src/types";

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
  /**
   * The complete structured description of this ask (ADR 0011 §2).
   *
   * The descriptor's one presentation fact: every render over it — the dialog,
   * the agent-facing denial text, the review log — reads this and nothing
   * else, so a gate states its facts once.
   */
  payload: PromptPayload;
  /**
   * Session-approval suggestion for the "for this session" option.
   * Wraps either a single pattern or multiple patterns behind a unified
   * interface — the runner never needs to know which case applies.
   */
  sessionApproval?: SessionApproval;
  /**
   * Details passed to the interactive permission prompt.
   *
   * The runner stamps both `requestId` (which it mints) and `payload` (which
   * the descriptor owns), so neither is a gate's to supply twice.
   */
  promptDetails: Omit<PromptPermissionDetails, "requestId" | "payload">;
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
 * A decision event's facts, before the runner stamps the request id it minted.
 *
 * A gate knows what was decided but not which request it was deciding — the id
 * is minted in `GateRunner.run`. Producing this type rather than the full event
 * is what routes every emit through the runner's single stamping site.
 */
export type DecisionEventFacts = Omit<PermissionDecisionEvent, "requestId">;

/**
 * Early allow result — gate has determined the action without needing the runner.
 *
 * Used for cases like Pi infrastructure read bypass where the gate short-circuits
 * with a deterministic allow before reaching the permission check.
 */
export interface GateBypass {
  action: "allow";
  /**
   * What decided this short-circuit.
   *
   * The gate that bypasses *is* the decider, so it states its own provenance
   * and the runner relays it onto the log entry rather than inferring one from
   * the event name (#726). Required, so a bypass added later cannot omit it.
   */
  decidedBy: DecisionSource;
  /** Optional review log entry to emit. */
  log?: { event: string; details: Record<string, unknown> };
  /** Optional decision event to emit. */
  decision?: DecisionEventFacts;
}

/** Union of possible gate function return values. */
export type GateResult = GateDescriptor | GateBypass | null;

// ── Type guard helpers ─────────────────────────────────────────────────────

/** Check whether a GateResult is a GateBypass (early allow). */
export function isGateBypass(result: GateResult): result is GateBypass {
  return result !== null && "action" in result;
}

/** Check whether a GateResult is a GateDescriptor (needs runner). */
export function isGateDescriptor(result: GateResult): result is GateDescriptor {
  return result !== null && !("action" in result);
}
