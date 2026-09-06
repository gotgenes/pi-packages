/**
 * record-observer.ts — Subscribes to session events and accumulates SubagentState stats.
 *
 * Replaces the scattered callback-wrapping logic in SubagentManager's startAgent()
 * and resume() with a single direct subscription. The observer targets the
 * SubagentState value object directly, so it carries no dependency on Subagent;
 * the caller forwards itself to its own lifecycle observer via onCompact.
 */

import type { SubagentState } from "#src/lifecycle/subagent-state";
import type { CompactionInfo, CompactionTransitionV2, SubscribableSession } from "#src/types";

export interface SubagentObserverOptions {
  onCompactionTransition?: (transition: CompactionTransitionV2) => void;
  onCompact?: (info: CompactionInfo) => void;
}

/**
 * Subscribe to session events and accumulate stats on the subagent state.
 *
 * Handles:
 * - `tool_execution_start` → `state.addActiveTool(name)`
 * - `tool_execution_end` → `state.removeActiveTool(name)`, `state.incrementToolUses()`
 * - `message_start` → `state.resetResponseText()`
 * - `message_update` (text_delta) → `state.appendResponseText(delta)`
 * - `message_end` (assistant, with usage) → `state.addUsage(…)`
 * - `turn_end` → `state.incrementTurnCount()`
 * - `compaction_start` → emit an explicit lifecycle transition
 * - `compaction_end` → update lifetime counts and emit the terminal transition
 *
 * @returns An unsubscribe function.
 */
export function subscribeSubagentObserver(
  session: SubscribableSession,
  state: SubagentState,
  options?: SubagentObserverOptions,
): () => void {
  return session.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      state.addActiveTool(event.toolName);
    }

    if (event.type === "tool_execution_end") {
      state.removeActiveTool(event.toolName);
      state.incrementToolUses();
    }

    if (event.type === "message_start") {
      state.resetResponseText();
    }

    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      state.appendResponseText(event.assistantMessageEvent.delta);
    }

    if (event.type === "turn_end") {
      state.incrementTurnCount();
    }

    if (event.type === "message_end" && event.message.role === "assistant") {
      const u = event.message.usage;
      state.addUsage({
        input: u.input,
        output: u.output,
        cacheWrite: u.cacheWrite,
      });
    }

    if (event.type === "compaction_start") {
      options?.onCompactionTransition?.({
        type: "start",
        started_at: new Date().toISOString(),
      });
    }

    if (event.type === "compaction_end") {
      if (!event.aborted && event.result) {
        state.incrementCompactions();
        options?.onCompactionTransition?.({ type: "completed" });
        options?.onCompact?.({
          reason: event.reason,
          tokensBefore: event.result.tokensBefore,
        });
      } else if (event.aborted) {
        options?.onCompactionTransition?.({ type: "aborted" });
      } else {
        options?.onCompactionTransition?.({ type: "failed" });
      }
    }
  });
}
