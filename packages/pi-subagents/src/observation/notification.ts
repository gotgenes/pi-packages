import { debugLog } from "#src/debug";
import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import { getLifetimeTotal } from "#src/lifecycle/usage";
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

/** Escape XML special characters to prevent injection in structured notifications. */
export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Human-readable status label for agent completion. */
export function getStatusLabel(status: string, error?: string): string {
  switch (status) {
    case "error":
      return `Error: ${error ?? "unknown"}`;
    case "aborted":
      return "Aborted (max turns exceeded)";
    case "steered":
      return "Wrapped up (turn limit)";
    case "stopped":
      return "Stopped";
    default:
      return "Done";
  }
}

/** Format a structured <task-notification> XML block for the parent agent to parse. */
export function formatTaskNotification(record: Subagent, resultMaxLen: number): string {
  const status = getStatusLabel(record.status, record.error);
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
  return [
    "<task-notification>",
    `<task-id>${record.id}</task-id>`,
    toolCallId ? `<tool-use-id>${escapeXml(toolCallId)}</tool-use-id>` : null,
    outputFile ? `<output-file>${escapeXml(outputFile)}</output-file>` : null,
    `<status>${escapeXml(status)}</status>`,
    `<summary>Subagent "${escapeXml(record.description)}" ${record.status}</summary>`,
    `<result>${escapeXml(resultPreview)}</result>`,
    `<usage><total_tokens>${totalTokens}</total_tokens><tool_uses>${record.toolUses}</tool_uses>${ctxXml}${compactXml}<duration_ms>${durationMs}</duration_ms></usage>`,
    "</task-notification>",
  ]
    .filter(Boolean)
    .join("\n");
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
    resultPreview: record.result
      ? record.result.length > resultMaxLen
        ? record.result.slice(0, resultMaxLen) + "…"
        : record.result
      : "No output.",
  };
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

const NUDGE_HOLD_MS = 200;

export class NotificationManager implements NotificationSystem {
  private pendingNudges = new Map<string, ReturnType<typeof setTimeout>>();
  // pi.sendMessage is fire-and-forget: once a followUp is handed to Pi's queue
  // it cannot be recalled, yet it is only delivered when the parent's agent
  // loop ends. A parent that pulls the result (get_subagent_result) between
  // handoff and delivery would then receive the same result twice. So while
  // the parent is streaming, fired nudges are held here — where
  // record.consumed can still be consulted — and flushed on agent end.
  private heldNudges = new Map<string, Subagent>();
  private parentStreaming = false;

  constructor(
    private sendMessage: (
      msg: { customType: string; content: string; display: boolean; details?: unknown },
      opts?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
    ) => void,
  ) {}

  sendCompletion(record: Subagent): void {
    // Consumption is domain state on the record; the nudge is a pure
    // announcement. Skip if the parent already pulled the result (schedule-time
    // guard); emitIndividualNudge re-reads record.consumed at fire time for the
    // pull-during-hold race.
    if (record.consumed) return;
    this.scheduleNudge(record.id, () => this.emitIndividualNudge(record));
  }

  dispose(): void {
    for (const timer of this.pendingNudges.values()) clearTimeout(timer);
    this.pendingNudges.clear();
    this.heldNudges.clear();
  }

  /** Mark the parent agent loop as streaming; fired nudges are held until agent end. */
  onParentAgentStart(): void {
    this.parentStreaming = true;
  }

  /**
   * Flush nudges held during the parent's agent loop. Each held record
   * re-checks consumption via emitIndividualNudge, so results the parent
   * already pulled mid-turn are suppressed instead of delivered twice.
   */
  onParentAgentEnd(): void {
    this.parentStreaming = false;
    const held = [...this.heldNudges.values()];
    this.heldNudges.clear();
    for (const record of held) {
      try {
        this.emitIndividualNudge(record);
      } catch (err) {
        debugLog("notification render", err);
      }
    }
  }

  private cancelNudge(key: string): void {
    const timer = this.pendingNudges.get(key);
    if (timer != null) {
      clearTimeout(timer);
      this.pendingNudges.delete(key);
    }
  }

  private scheduleNudge(key: string, send: () => void, delay = NUDGE_HOLD_MS): void {
    this.cancelNudge(key);
    this.pendingNudges.set(
      key,
      setTimeout(() => {
        this.pendingNudges.delete(key);
        try {
          send();
        } catch (err) {
          debugLog("notification render", err);
        }
      }, delay),
    );
  }

  private emitIndividualNudge(record: Subagent): void {
    if (record.consumed) return;
    if (this.parentStreaming) {
      this.heldNudges.set(record.id, record);
      return;
    }

    const notification = formatTaskNotification(record, 500);
    const outputFile = record.outputFile;
    const transcriptLine = outputFile ? `\nFull transcript available at: ${outputFile}` : "";
    // The nudge only announces; the parent must pull to collect (and consume).
    const retrievalLine = `\nCall get_subagent_result("${record.id}") to collect the full result.`;

    this.sendMessage(
      {
        customType: "subagent-notification",
        content: notification + transcriptLine + retrievalLine,
        display: true,
        details: buildNotificationDetails(record, 500),
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  }
}
