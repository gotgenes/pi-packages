/**
 * display.ts — Pure formatting helpers and display utilities for agent UI.
 *
 * All functions are stateless and dependency-free (no SDK runtime imports, no widget lifecycle).
 * Consumed by the widget, the menu, tool modules, and the notification renderer.
 */

import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import type { TurnBudget } from "#src/lifecycle/turn-limits";
import type { AgentInvocation, SubagentType } from "#src/types";
import { GLYPHS } from "#src/ui/glyphs";

// ---- Types ----

/** A model as the UI names it. The SDK's `Model` satisfies it structurally. */
export interface ModelIdentity {
  readonly provider: string;
  readonly id: string;
}

export type Theme = {
  fg(color: ThemeColor, text: string): string;
  bold(text: string): string;
};

/** Metadata attached to Agent tool results for custom rendering. */
export interface AgentDetails {
  displayName: string;
  description: string;
  subagentType: string;
  toolUses: number;
  tokens: string;
  durationMs: number;
  status: "queued" | "running" | "completed" | "aborted" | "stopped" | "error" | "background";
  /** Human-readable description of what the agent is currently doing. */
  activity?: string;
  /** Current spinner frame index (for animated running indicator). */
  spinnerFrame?: number;
  /** The `provider/id` of the model the agent runs (e.g. "anthropic/claude-haiku-4-5"). */
  modelName?: string;
  /** Notable config tags (e.g. ["thinking: high", "inherit context"]). */
  tags?: string[];
  agentId?: string;
  error?: string;
  /** The run's turn budget; absent until its turn loop starts. */
  turnBudget?: TurnBudget;
}

// ---- Constants ----

/** Statuses that indicate an error/non-success outcome (used for linger behavior and icon rendering). */
export const ERROR_STATUSES = new Set(["error", "aborted", "stopped"]);

/** Tool name → human-readable action for activity descriptions. */
const TOOL_DISPLAY: Record<string, string> = {
  read: "reading",
  bash: "running command",
  edit: "editing",
  write: "writing",
  grep: "searching",
  find: "finding files",
  ls: "listing",
};

// ---- Pure formatters ----

/** Format a token count compactly: "33.8k token", "1.2M token". */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M token`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k token`;
  return `${count} token`;
}

/**
 * Token count with optional context-fill % and compaction-count annotations.
 * Thresholds for percent: <70% dim, 70–85% warning, ≥85% error.
 * Compaction count rendered as `⇊N` in dim (see `glyphs.ts`).
 *
 *   "12.3k token"               — no annotations
 *   "12.3k token (45%)"         — percent only
 *   "12.3k token (⇊2)"          — compactions only (e.g. right after compact)
 *   "12.3k token (45% · ⇊2)"    — both
 */
export function formatSessionTokens(
  tokens: number,
  percent: number | null,
  theme: Theme,
  compactions = 0,
): string {
  const tokenStr = formatTokens(tokens);
  const annot: string[] = [];
  if (percent !== null) {
    const color = percent >= 85 ? "error" : percent >= 70 ? "warning" : "dim";
    annot.push(theme.fg(color, `${Math.round(percent)}%`));
  }
  if (compactions > 0) {
    annot.push(theme.fg("dim", `${GLYPHS.compactions}${compactions}`));
  }
  if (annot.length === 0) return tokenStr;
  const sep = theme.fg("dim", " · ");
  return `${tokenStr} ${theme.fg("dim", "(")}${annot.join(sep)}${theme.fg("dim", ")")}`;
}

/** Format a turn budget as turns used against the ceiling: "↻5≤30", or "↻5" when unlimited. */
export function formatTurnBudget(budget: TurnBudget): string {
  return budget.maxTurns != null
    ? `${GLYPHS.turns}${budget.used}≤${budget.maxTurns}`
    : `${GLYPHS.turns}${budget.used}`;
}

/** Format milliseconds as human-readable duration. */
export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** A model as `provider/id`, the syntax the Agent tool's `model` argument accepts. */
export function formatModel(model: ModelIdentity): string {
  return `${model.provider}/${model.id}`;
}

/** A model's `provider/id` label, or undefined while the model is unknown. */
export function modelLabel(model: ModelIdentity | undefined): string | undefined {
  return model ? formatModel(model) : undefined;
}

/** The run facts a duration reads. A run's outcome and a navigator record both satisfy it. */
export interface RunTiming {
  readonly status: SubagentStatus;
  readonly startedAt: number;
  readonly completedAt: number | undefined;
  readonly stoppedWhileQueued: boolean;
}

/**
 * A started run's duration; for a run the limiter never admitted, its time in
 * the queue, so no carrier calls waiting for a slot running time. A run
 * stopped while queued keeps the time it waited, frozen at the stop.
 */
export function formatRunDuration(run: RunTiming): string {
  if (run.status === "queued" || run.stoppedWhileQueued) {
    return `queued ${formatMs((run.completedAt ?? Date.now()) - run.startedAt)}`;
  }
  return formatDuration(run.startedAt, run.completedAt);
}

/** Format duration from start/completed timestamps. */
function formatDuration(startedAt: number, completedAt?: number): string {
  if (completedAt) return formatMs(completedAt - startedAt);
  return `${formatMs(Date.now() - startedAt)} (running)`;
}

// ---- Display helpers ----

/** Get display name for any agent type (built-in or custom). */
export function getDisplayName(type: SubagentType, registry: AgentConfigLookup): string {
  const config = registry.resolveAgentConfig(type);
  return config.displayName ?? config.name;
}

/** Short label for prompt mode: "twin" for append, nothing for replace (the default). */
export function getPromptModeLabel(type: SubagentType, registry: AgentConfigLookup): string | undefined {
  const config = registry.resolveAgentConfig(type);
  return config.promptMode === "append" ? "twin" : undefined;
}

/** Mode label is not included — callers add it where they want it. */
export function buildInvocationTags(
  invocation: AgentInvocation | undefined,
): { tags: string[] } {
  const tags: string[] = [];
  if (!invocation) return { tags };
  if (invocation.thinking) tags.push(`thinking: ${invocation.thinking}`);
  if (invocation.inheritContext) tags.push("inherit context");
  if (invocation.runInBackground) tags.push("background");
  if (invocation.maxTurns != null) tags.push(`max turns: ${invocation.maxTurns}`);
  return { tags };
}

/** Truncate text to a single line, max `len` chars. */
function truncateLine(text: string, len = 60): string {
  const line = text.split("\n").find(l => l.trim())?.trim() ?? "";
  if (line.length <= len) return line;
  return line.slice(0, len) + "…";
}

/** Build a human-readable activity string from currently-running tools or response text. */
export function describeActivity(activeTools: ReadonlyMap<string, string>, responseText?: string): string {
  if (activeTools.size > 0) {
    const groups = new Map<string, number>();
    for (const toolName of activeTools.values()) {
      const action = TOOL_DISPLAY[toolName] ?? toolName;
      groups.set(action, (groups.get(action) ?? 0) + 1);
    }

    const parts: string[] = [];
    for (const [action, count] of groups) {
      if (count > 1) {
        parts.push(`${action} ${count} ${action === "searching" ? "patterns" : "files"}`);
      } else {
        parts.push(action);
      }
    }
    return parts.join(", ") + "…";
  }

  // No tools active — show truncated response text if available
  if (responseText && responseText.trim().length > 0) {
    return truncateLine(responseText);
  }

  return "thinking…";
}
