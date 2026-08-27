import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DecisionRecorder } from "#src/decision-audit";
import type { DecisionReporter } from "#src/decision-reporter";
import { createPermissionRequestId } from "#src/permission-request-id";
import { toRecord } from "#src/value-guards";
import type { GateOutcome } from "./gates/types";

/** The SDK-facing result shape for a `tool_call` handler. */
type ToolCallResult = { block?: true; reason?: string };

/**
 * Narrow debug surface for the per-call decision trace. The concrete logger
 * self-gates on `debugLog`, so the boundary emits unconditionally and the
 * entry is dropped when the toggle is off (no per-call spam in normal use).
 */
export interface DecisionTracer {
  debug(event: string, details?: Record<string, unknown>): void;
}

/**
 * The only `tool_call` handler the SDK sees.
 *
 * Guarantees fail-closed: it owns the `try/catch → block` and is the sole place
 * an internal {@link GateOutcome} is translated to the SDK result shape, so
 * "we didn't decide" can never silently mean "allow."
 *
 * The SDK's `emitToolCall` (`@earendil-works/pi-coding-agent`
 * `dist/core/extensions/runner.js`) awaits the registered handler with **no**
 * try/catch — unlike `emitUserBash` directly below it, which catches and
 * continues. A thrown gate therefore yields no `{ block: true }` and the
 * command runs ungated with nothing logged. This boundary absorbs that throw,
 * blocks, and writes a `gate_error` review-log entry.
 *
 * Fail-closed = **block** (not `ask`) for an unexpected exception: the command
 * may be unknown and the prompt infrastructure itself may be what threw, so a
 * hard block is the unambiguous safe outcome.
 */
export function createFailClosedToolCall(
  gate: (event: unknown, ctx: ExtensionContext) => Promise<GateOutcome>,
  reporter: DecisionReporter,
  audit: DecisionRecorder,
  tracer: DecisionTracer,
): (event: unknown, ctx: ExtensionContext) => Promise<ToolCallResult> {
  return async (event, ctx) => {
    try {
      const outcome = await gate(event, ctx);
      audit.recordDecision(outcome.action);
      tracer.debug("permission.decision", {
        toolName: bestEffortToolName(event),
        action: outcome.action,
        ...(outcome.action === "block" ? { reason: outcome.reason } : {}),
      });
      return outcome.action === "block"
        ? { block: true, reason: outcome.reason }
        : {};
    } catch (error) {
      recordGateError(reporter, audit, event, error);
      return { block: true, reason: formatGateErrorReason(error) };
    }
  };
}

/**
 * Record a gate error without ever throwing.
 *
 * The block below this must be reached: the SDK does not catch a throwing
 * handler, so an exception escaping the recording work would leave the command
 * ungated. The request id is minted here rather than borrowed — the throw may
 * have come from anywhere in the pipeline, so no gate's id is available — and
 * shared by both records, so the terminal broadcast joins the review entry.
 *
 * The broadcast carries what the raw event yields and nothing inferred: no
 * rule won, and the boundary holds no session, so `origin`, `matchedPattern`,
 * and `agentName` are `null` (#753).
 */
function recordGateError(
  reporter: DecisionReporter,
  audit: DecisionRecorder,
  event: unknown,
  error: unknown,
): void {
  try {
    audit.recordError();
    const reason = errorMessage(error);
    const requestId = createPermissionRequestId();
    const toolName = bestEffortToolName(event);
    const command = bestEffortCommand(event);
    reporter.writeReviewLog("permission_request.blocked", {
      requestId,
      toolName,
      command,
      resolution: "gate_error",
      error: reason,
      // The boundary decided, by failing closed -- no rule and no human did.
      decidedBy: { kind: "gate_error", reason },
    });
    reporter.emitDecision({
      requestId,
      surface: toolName,
      value: command ?? toolName,
      result: "deny",
      resolution: "gate_error",
      origin: null,
      agentName: null,
      matchedPattern: null,
    });
  } catch {
    // The block is the guarantee; its bookkeeping is not.
  }
}

// ── Defensive event readers (never throw) ──────────────────────────────────

/** Best-effort tool name from a raw event; never throws. */
function bestEffortToolName(event: unknown): string {
  const record = toRecord(event);
  const name = record.name ?? record.toolName;
  return typeof name === "string" && name ? name : "<unknown>";
}

/** Best-effort bash command from a raw event; never throws. */
function bestEffortCommand(event: unknown): string | undefined {
  const record = toRecord(event);
  const input = toRecord(record.input ?? record.arguments);
  return typeof input.command === "string" ? input.command : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatGateErrorReason(error: unknown): string {
  return `Permission gate failed and blocked the tool call (fail-closed): ${errorMessage(error)}`;
}
