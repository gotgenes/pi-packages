import {
  emitDecisionEvent,
  type PermissionDecisionEvent,
  type PermissionEventBus,
} from "./permission-events";
import type { SessionLogger } from "./session-logger";

/**
 * Broadcasts a terminal permission decision on the `permissions:decision`
 * channel.
 *
 * Narrow by design (ISP): a collaborator that only announces an outcome — the
 * serving session answering another session's forwarded request — depends on
 * this rather than on the review-log half it never writes.
 */
export interface DecisionBroadcaster {
  emitDecision(event: PermissionDecisionEvent): void;
}

/**
 * Reports a permission gate's outcome to the review log and the decision
 * channel. Groups the two side effects that always travel together:
 * writing a structured review-log entry and broadcasting a decision event.
 */
export interface DecisionReporter extends DecisionBroadcaster {
  writeReviewLog(event: string, details: Record<string, unknown>): void;
}

/**
 * Owns the `SessionLogger` and the event bus so neither the handler nor
 * the runner has to reach through the session to its logger or close over
 * the event bus directly.
 *
 * Built once in `PermissionGateHandler`'s constructor; shared between
 * `handleToolCall` (gate runner + bypass branch) and `handleInput`.
 *
 * Answers "who owns the event bus" — the reporter does, not the session.
 */
export class GateDecisionReporter implements DecisionReporter {
  constructor(
    private readonly logger: SessionLogger,
    private readonly events: PermissionEventBus,
  ) {}

  writeReviewLog(event: string, details: Record<string, unknown>): void {
    this.logger.review(event, details);
  }

  emitDecision(event: PermissionDecisionEvent): void {
    emitDecisionEvent(this.events, event);
  }
}
