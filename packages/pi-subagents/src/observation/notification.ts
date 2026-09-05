import { debugLog } from "#src/debug";
import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import { getLifetimeTotal } from "#src/lifecycle/usage";
import {
  renderQuestionAffordance,
  renderStatusLabel,
  renderWorkspaceNotice,
} from "#src/observation/outcome-delivery";
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
 * Format a `<subagent-update>` block for a message a still-running child sent.
 *
 * A distinct element from `<task-notification>`: the child has not finished, so
 * the parent's next action is to steer it or leave it alone, never to collect a
 * result that does not exist yet.
 */
export function formatUpdateNotification(record: Subagent, message: string): string {
  return joinNotificationLines([
    "<subagent-update>",
    `<task-id>${record.id}</task-id>`,
    `<summary>Subagent "${escapeXml(record.description)}" sent an update</summary>`,
    `<message>${escapeXml(message)}</message>`,
    "</subagent-update>",
    `The agent is still running. Steer it with steer_subagent("${record.id}", "...") to redirect it, or let it continue.`,
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
  sendUpdate: (record: Subagent, message: string) => void;
  dispose: () => void;
}

/** Details the update renderer reads. */
export interface UpdateDetails {
  id: string;
  description: string;
  message: string;
}

/**
 * One announcement withheld for the parent's current run.
 *
 * A completion for an agent supersedes an earlier one for that agent; two
 * updates are two distinct facts and both survive.
 */
type PendingAnnouncement =
  | { kind: "completion"; record: Subagent }
  | { kind: "update"; record: Subagent; message: string };

export class NotificationManager implements NotificationSystem {
  // pi.sendMessage is fire-and-forget: while the parent's agent run is active,
  // a followUp is handed to a queue the extension cannot recall, yet it is only
  // delivered when the run drains that queue at turn end. A parent that pulls
  // the result in between would receive it twice. So nudges that arrive mid-run
  // are withheld here — where record.consumed is still consultable — and
  // flushed once the run settles.
  // Ordered rather than record-keyed: a completion for an agent supersedes an
  // earlier one for that agent, but announcements from different agents are
  // distinct facts, and arrival order is the only order the parent can make
  // sense of.
  private pending: PendingAnnouncement[] = [];
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
      this.withholdCompletion(record);
      return;
    }
    this.emitIndividualNudge(record);
  }

  /**
   * Queue a completion for the flush, superseding an earlier one for the same
   * agent in the position that one already holds — a re-completion is the same
   * fact told again, not a later one.
   */
  private withholdCompletion(record: Subagent): void {
    const entry: PendingAnnouncement = { kind: "completion", record };
    const existing = this.pending.findIndex(
      (queued) => queued.kind === "completion" && queued.record.id === record.id,
    );
    if (existing === -1) this.pending.push(entry);
    else this.pending[existing] = entry;
  }

  /**
   * Announce a message a still-running child sent its parent.
   *
   * Unlike a completion, this consults neither the carrier claim nor
   * consumption: both record that the child's *outcome* has an owner, and an
   * update is a new fact rather than that outcome told again. The disposal
   * latch and the parent-run withhold apply as they do to any announcement.
   */
  sendUpdate(record: Subagent, message: string): void {
    if (this.disposed) return;
    if (this.parentRunActive) {
      this.pending.push({ kind: "update", record, message });
      return;
    }
    this.emitUpdate(record, message);
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
    const withheld = this.pending.splice(0);
    for (const entry of withheld) {
      try {
        if (entry.kind === "update") this.emitUpdate(entry.record, entry.message);
        else this.emitIndividualNudge(entry.record);
      } catch (err) {
        debugLog("notification render", err);
      }
    }
  }

  /** Terminal: the manager stops announcing anything, now and afterwards. */
  dispose(): void {
    this.disposed = true;
    this.pending.length = 0;
  }

  private emitUpdate(record: Subagent, message: string): void {
    const details: UpdateDetails = {
      id: record.id,
      description: record.description,
      message,
    };
    this.sendMessage(
      {
        customType: "subagent-update",
        content: formatUpdateNotification(record, message),
        display: true,
        details,
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
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
    return (
      // Where the work went leads, so the parent reads it before the pointers.
      renderWorkspaceNotice(record.workspaceNotice) +
      `${transcriptLine}\nCall get_subagent_result("${record.id}") to collect the full result.` +
      renderQuestionAffordance(record.id, record.pendingQuestion)
    );
  }
}
