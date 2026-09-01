import { debugLog } from "#src/debug";
import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import { getLifetimeTotal } from "#src/lifecycle/usage";
import { renderStatusLabel } from "#src/observation/outcome-delivery";
import type { Subagent } from "#src/types";

/** Details attached to custom notification messages for visual rendering. */
export interface NotificationDetails {
  id: string;
  description: string;
  status: SubagentStatus;
  toolUses: number;
  turnCount: number;
  maxTurns?: number;
  totalTokens: number;
  durationMs: number;
  outputFile?: string;
  error?: string;
  resultPreview: string;
}

// ---- Pure helpers (exported for unit testing) ----

/**
 * Escape XML special characters to prevent injection in structured
 * notifications. Quotes are escaped too, so values stay safe if they are ever
 * placed in attribute position, not only element content.
 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Format a structured <task-notification> XML block for the parent agent to parse. */
export function formatTaskNotification(record: Subagent, resultMaxLen: number): string {
  if (record.stoppedWhileQueued) return formatNeverStartedNotification(record);

  const status = renderStatusLabel(record.status, record.error);
  const durationMs = record.completedAt ? record.completedAt - record.startedAt : 0;
  const totalTokens = getLifetimeTotal(record.lifetimeUsage);
  const contextPercent = record.getContextPercent();
  const ctxXml = contextPercent !== null ? `<context_percent>${Math.round(contextPercent)}</context_percent>` : "";
  const compactXml = record.compactionCount ? `<compactions>${record.compactionCount}</compactions>` : "";

  const resultPreview = record.result
    ? record.result.length > resultMaxLen
      ? record.result.slice(0, resultMaxLen) + "\n...(truncated, use get_subagent_result for full output)"
      : record.result
    : "No output.";

  const toolCallId = record.toolCallId;
  const outputFile = record.outputFile;
  return joinNotificationLines([
    "<task-notification>",
    `<task-id>${record.id}</task-id>`,
    toolCallId ? `<tool-use-id>${escapeXml(toolCallId)}</tool-use-id>` : null,
    outputFile ? `<output-file>${escapeXml(outputFile)}</output-file>` : null,
    `<status>${escapeXml(status)}</status>`,
    `<summary>Subagent "${escapeXml(record.description)}" ${record.status}</summary>`,
    `<result>${escapeXml(resultPreview)}</result>`,
    `<usage><total_tokens>${totalTokens}</total_tokens><tool_uses>${record.toolUses}</tool_uses>${ctxXml}${compactXml}<duration_ms>${durationMs}</duration_ms></usage>`,
    "</task-notification>",
  ]);
}

/**
 * Format the block for an agent stopped before the limiter admitted it. Such an
 * agent never ran, so it has no result and no usage — reporting either (even as
 * zeroes) would point the parent at work that does not exist.
 */
function formatNeverStartedNotification(record: Subagent): string {
  const toolCallId = record.toolCallId;
  return joinNotificationLines([
    "<task-notification>",
    `<task-id>${record.id}</task-id>`,
    toolCallId ? `<tool-use-id>${escapeXml(toolCallId)}</tool-use-id>` : null,
    "<status>Stopped before starting</status>",
    `<summary>Subagent "${escapeXml(record.description)}" was stopped while queued and never started</summary>`,
    "</task-notification>",
  ]);
}

/** Join notification lines, dropping the ones a conditional element omitted. */
function joinNotificationLines(lines: (string | null)[]): string {
  return lines.filter(Boolean).join("\n");
}

/** Build notification details for the custom message renderer. */
export function buildNotificationDetails(
  record: Subagent,
  resultMaxLen: number,
): NotificationDetails {
  const totalTokens = getLifetimeTotal(record.lifetimeUsage);

  return {
    id: record.id,
    description: record.description,
    status: record.status,
    toolUses: record.toolUses,
    turnCount: record.turnCount,
    maxTurns: record.maxTurns,
    totalTokens,
    durationMs: record.completedAt ? record.completedAt - record.startedAt : 0,
    outputFile: record.outputFile,
    error: record.error,
    resultPreview: buildResultPreview(record, resultMaxLen),
  };
}

/** The renderer's preview text: the (truncated) result, or why there is none. */
function buildResultPreview(record: Subagent, resultMaxLen: number): string {
  if (record.stoppedWhileQueued) return "Never started — stopped while queued.";
  if (!record.result) return "No output.";
  return record.result.length > resultMaxLen
    ? record.result.slice(0, resultMaxLen) + "…"
    : record.result;
}

/** Build event data for lifecycle events from a Subagent. */
export function buildEventData(record: Subagent) {
  const durationMs = record.completedAt ? record.completedAt - record.startedAt : Date.now() - record.startedAt;
  const u = record.lifetimeUsage;
  const total = getLifetimeTotal(u);
  const tokens =
    total > 0
      ? { input: u.input, output: u.output, total }
      : undefined;
  return {
    id: record.id,
    type: record.type,
    description: record.description,
    result: record.result,
    error: record.error,
    status: record.status,
    toolUses: record.toolUses,
    durationMs,
    tokens,
  };
}

// ---- Notification system factory ----

export interface NotificationSystem {
  sendCompletion: (record: Subagent) => void;
  dispose: () => void;
}

export class NotificationManager implements NotificationSystem {
  // pi.sendMessage is fire-and-forget: while the parent's agent run is active,
  // a followUp is handed to a queue the extension cannot recall, yet it is only
  // delivered when the run drains that queue at turn end. A parent that pulls
  // the result in between would receive it twice. So nudges that arrive mid-run
  // are withheld here — where record.consumed is still consultable — and
  // flushed once the run settles.
  private pendingNudges = new Map<string, Subagent>();
  private parentRunActive = false;
  private disposed = false;

  constructor(
    private sendMessage: (
      msg: { customType: string; content: string; display: boolean; details?: unknown },
      opts?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
    ) => void,
  ) {}

  sendCompletion(record: Subagent): void {
    // The session is gone. It is the aborts fired during shutdown that reach
    // here, and with no parent run active a nudge would go straight out as an
    // unrecallable followUp.
    if (this.disposed) return;
    // A carrier has committed to delivering this outcome, so announcing it would
    // duplicate a delivery the parent is already getting. Structural and decided
    // at the parent's request, so unlike the consumption check below it cannot
    // race the turn.
    if (record.claimed) return;
    // Consumption is domain state on the record; the nudge is a pure
    // announcement. Skip if the parent already pulled the result (enqueue-time
    // guard); emitIndividualNudge re-reads record.consumed when the nudge is
    // actually emitted, which is what makes the flush a fresh re-check.
    if (record.consumed) return;
    if (this.parentRunActive) {
      // Keyed by id, so a re-completion in the same run collapses to one nudge.
      this.pendingNudges.set(record.id, record);
      return;
    }
    this.emitIndividualNudge(record);
  }

  /** The parent's agent run became active; nudges are withheld until it settles. */
  onParentAgentStart(): void {
    this.parentRunActive = true;
  }

  /**
   * The parent's agent run settled. Flush the nudges withheld during it, each
   * re-checking consumption, so a result the parent pulled mid-run is dropped
   * rather than announced a second time.
   */
  onParentAgentSettled(): void {
    this.parentRunActive = false;
    const withheld = [...this.pendingNudges.values()];
    this.pendingNudges.clear();
    for (const record of withheld) {
      try {
        this.emitIndividualNudge(record);
      } catch (err) {
        debugLog("notification render", err);
      }
    }
  }

  /** Terminal: the manager stops announcing anything, now and afterwards. */
  dispose(): void {
    this.disposed = true;
    this.pendingNudges.clear();
  }

  private emitIndividualNudge(record: Subagent): void {
    if (record.claimed) return;
    if (record.consumed) return;

    const notification = formatTaskNotification(record, 500);
    // A never-started agent has no transcript and nothing to collect.
    const pointerLines = record.stoppedWhileQueued ? "" : this.buildPointerLines(record);

    this.sendMessage(
      {
        customType: "subagent-notification",
        content: notification + pointerLines,
        display: true,
        details: buildNotificationDetails(record, 500),
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  }

  /**
   * The trailing pointer lines: where the transcript lives, and how to collect
   * the result. The nudge only announces; the parent must pull to collect (and
   * consume).
   */
  private buildPointerLines(record: Subagent): string {
    const outputFile = record.outputFile;
    const transcriptLine = outputFile ? `\nFull transcript available at: ${outputFile}` : "";
    return `${transcriptLine}\nCall get_subagent_result("${record.id}") to collect the full result.`;
  }
}
