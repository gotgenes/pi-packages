/**
 * agent-widget.ts — Persistent widget showing running/completed agents above the editor.
 *
 * Displays a tree of agents with animated spinners, live stats, and activity descriptions.
 * Uses the callback form of setWidget for themed rendering.
 */

import { AgentTypeRegistry } from "#src/config/agent-types";
import type { Subagent } from "#src/lifecycle/subagent";
import type { SubagentManager, SubagentManagerObserver } from "#src/lifecycle/subagent-manager";
import type { CompactionInfo } from "#src/types";
import { ERROR_STATUSES, type Theme } from "#src/ui/display";
import { renderWidgetLines, type WidgetAgent } from "#src/ui/widget-renderer";

// ---- Types ----

/** Minimal agent shape needed for widget lifecycle decisions. */
interface AgentSummary {
  readonly id: string;
  readonly status: string;
  readonly completedAt?: number;
}

/** Lightweight state snapshot used by AgentWidget.update() to decide what to show. */
export interface WidgetState {
  readonly runningCount: number;
  readonly queuedCount: number;
  readonly hasFinished: boolean;
  /** True when runningCount > 0 || queuedCount > 0. Included for call-site readability. */
  readonly hasActive: boolean;
}

/**
 * Count agents by status and return a lightweight state snapshot.
 * Pure function — no IO, no side effects. Exported for direct unit testing.
 */
export function assembleWidgetState(
  agents: readonly AgentSummary[],
  shouldShowFinished: (agentId: string, status: string) => boolean,
): WidgetState {
  let runningCount = 0;
  let queuedCount = 0;
  let hasFinished = false;
  for (const a of agents) {
    if (a.status === "running") { runningCount++; }
    else if (a.status === "queued") { queuedCount++; }
    else if (a.completedAt && shouldShowFinished(a.id, a.status)) { hasFinished = true; }
  }
  const hasActive = runningCount > 0 || queuedCount > 0;
  return { runningCount, queuedCount, hasFinished, hasActive };
}

/** The slice of the TUI the widget factory callback touches. */
export interface TuiSurface {
  readonly terminal: { readonly columns: number };
  requestRender(): void;
}

export type UICtx = {
  setStatus(key: string, text: string | undefined): void;
  setWidget(
    key: string,
    content: undefined | ((tui: TuiSurface, theme: Theme) => { render(): string[]; invalidate(): void }),
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
};

// ---- Widget manager ----

export class AgentWidget implements SubagentManagerObserver {
  private uiCtx: UICtx | undefined;
  private widgetFrame = 0;
  private widgetInterval: ReturnType<typeof setInterval> | undefined;
  /** Tracks how many turns each finished agent has survived. Key: agent ID, Value: turns since finished. */
  private finishedTurnAge = new Map<string, number>();
  /** How many extra turns errors/aborted agents linger (completed agents clear after 1 turn). */
  private static readonly ERROR_LINGER_TURNS = 2;

  /** Whether the widget callback is currently registered with the TUI. */
  private widgetRegistered = false;
  /** Cached TUI reference from widget factory callback, used for requestRender(). */
  private tui: TuiSurface | undefined;
  /** Last status bar text, used to avoid redundant setStatus calls. */
  private lastStatusText: string | undefined;

  constructor(
    private manager: SubagentManager,
    private registry: AgentTypeRegistry,
  ) {}

  /** Set the UI context (grabbed from first tool execution). */
  setUICtx(ctx: UICtx) {
    if (ctx !== this.uiCtx) {
      // UICtx changed — the widget registered on the old context is gone.
      // Force re-registration on next update().
      this.uiCtx = ctx;
      this.widgetRegistered = false;
      this.tui = undefined;
      this.lastStatusText = undefined;
    }
  }

  /**
   * Called on each new turn (tool_execution_start).
   * Ages finished agents and clears those that have lingered long enough.
   */
  onTurnStart() {
    // Age all finished agents
    for (const [id, age] of this.finishedTurnAge) {
      this.finishedTurnAge.set(id, age + 1);
    }
    // Trigger a widget refresh (will filter out expired agents)
    this.update();
  }

  // ---- SubagentManagerObserver: react to lifecycle, self-drive the timer ----

  /** A subagent started running — ensure the update loop is live and render. */
  onSubagentStarted(_record: Subagent) {
    this.startLoop();
  }

  /** A background subagent was created (queued) — ensure the loop is live and render. */
  onSubagentCreated(_record: Subagent) {
    this.startLoop();
  }

  /** A subagent completed — render so the finished state is seeded and shown. */
  onSubagentCompleted(_record: Subagent) {
    this.update();
  }

  /** A subagent's session compacted — render to refresh the compaction count. */
  onSubagentCompacted(_record: Subagent, _info: CompactionInfo) {
    this.update();
  }

  /** Start the update timer (if not already running) and render immediately. */
  private startLoop() {
    this.ensureTimer();
    this.update();
  }

  /** Ensure the widget update timer is running. */
  private ensureTimer() {
    this.widgetInterval ??= setInterval(() => this.update(), 80);
  }

  /** Check if a finished agent should still be shown in the widget. */
  private shouldShowFinished(agentId: string, status: string): boolean {
    const age = this.finishedTurnAge.get(agentId) ?? 0;
    const maxAge = ERROR_STATUSES.has(status) ? AgentWidget.ERROR_LINGER_TURNS : 1;
    return age < maxAge;
  }

  /**
   * Background agents only — the widget's sole audience (ADR-0004 Decision A).
   * Foreground runs are rendered by the `subagent` tool's inline `onUpdate` stream,
   * so funneling both `listAgents()` call sites through this accessor applies the
   * background predicate exactly once at the source.
   */
  private listBackgroundAgents(): Subagent[] {
    return this.manager.listAgents().filter(record => record.invocation?.runInBackground === true);
  }

  /** Project a live Subagent record onto a pure-data WidgetAgent snapshot. */
  private toWidgetAgent(record: Subagent): WidgetAgent {
    const presentation = record.parentResultPresentation;
    return {
      id: record.id,
      type: record.type,
      status: record.status,
      description: presentation.description,
      toolUses: record.toolUses,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      error: presentation.error,
      lifetimeUsage: record.lifetimeUsage,
      compactionCount: record.compactionCount,
      turnCount: record.turnCount,
      maxTurns: record.maxTurns,
      activeTools: record.activeTools,
      responseText: presentation.result ?? "",
      contextPercent: record.getContextPercent(),
    };
  }

  /** Delegate rendering to the pure widget-renderer module. */
  private renderWidget(tui: TuiSurface, theme: Theme): string[] {
    return renderWidgetLines({
      agents: this.listBackgroundAgents().map(r => this.toWidgetAgent(r)),
      registry: this.registry,
      spinnerFrame: this.widgetFrame,
      terminalWidth: tui.terminal.columns,
      theme,
      shouldShowFinished: (id, status) => this.shouldShowFinished(id, status),
    });
  }

  /**
   * Unregister the widget, clear the status bar, stop the interval timer, and
   * purge stale `finishedTurnAge` entries for agents no longer in `backgroundAgents`.
   * Called only from `update`'s idle path — not from `dispose`.
   */
  private clearWidget(backgroundAgents: readonly AgentSummary[]): void {
    if (this.widgetRegistered) {
      this.uiCtx!.setWidget("agents", undefined);
      this.widgetRegistered = false;
      this.tui = undefined;
    }
    if (this.lastStatusText !== undefined) {
      this.uiCtx!.setStatus("subagents", undefined);
      this.lastStatusText = undefined;
    }
    if (this.widgetInterval) { clearInterval(this.widgetInterval); this.widgetInterval = undefined; }
    for (const [id] of this.finishedTurnAge) {
      if (!backgroundAgents.some(a => a.id === id)) this.finishedTurnAge.delete(id);
    }
  }

  /**
   * Compute the status bar text from the current widget state and call
   * `setStatus` only when it differs from the last cached value.
   */
  private updateStatusBar(state: WidgetState): void {
    let newStatusText: string | undefined;
    if (state.hasActive) {
      const statusParts: string[] = [];
      if (state.runningCount > 0) statusParts.push(`${state.runningCount} running`);
      if (state.queuedCount > 0) statusParts.push(`${state.queuedCount} queued`);
      const total = state.runningCount + state.queuedCount;
      newStatusText = `${statusParts.join(", ")} agent${total === 1 ? "" : "s"}`;
    }
    if (newStatusText !== this.lastStatusText) {
      this.uiCtx!.setStatus("subagents", newStatusText);
      this.lastStatusText = newStatusText;
    }
  }

  /**
   * Seed linger tracking for any newly-observed finished agent.
   * The widget owns detection of completions it observes via `listAgents()`,
   * so no external bookkeeping call is needed.
   * Idempotent — only seeds when an entry is absent, so repeated updates within
   * a turn neither reset nor advance the age.
   */
  private seedFinishedAgents(agents: readonly AgentSummary[]): void {
    for (const a of agents) {
      if (a.completedAt && !this.finishedTurnAge.has(a.id)) {
        this.finishedTurnAge.set(a.id, 0);
      }
    }
  }

  /** Force an immediate widget update. */
  update() {
    if (!this.uiCtx) return;

    const backgroundAgents = this.listBackgroundAgents();
    this.seedFinishedAgents(backgroundAgents);
    const state = assembleWidgetState(backgroundAgents, (id, status) => this.shouldShowFinished(id, status));

    if (!state.hasActive && !state.hasFinished) {
      this.clearWidget(backgroundAgents);
      return;
    }

    this.updateStatusBar(state);
    this.widgetFrame++;

    // Register widget callback once; subsequent updates use requestRender()
    // which re-invokes render() without replacing the component (avoids layout thrashing).
    if (!this.widgetRegistered) {
      this.uiCtx.setWidget("agents", (tui, theme) => {
        this.tui = tui;
        return {
          render: () => this.renderWidget(tui, theme),
          invalidate: () => {
            // Theme changed — force re-registration so factory captures fresh theme.
            this.widgetRegistered = false;
            this.tui = undefined;
          },
        };
      }, { placement: "aboveEditor" });
      this.widgetRegistered = true;
    } else {
      // Widget already registered — just request a re-render of existing components.
      this.tui?.requestRender();
    }
  }

  // fallow-ignore-next-line unused-class-member
  dispose() {
    if (this.widgetInterval) {
      clearInterval(this.widgetInterval);
      this.widgetInterval = undefined;
    }
    if (this.uiCtx) {
      this.uiCtx.setWidget("agents", undefined);
      this.uiCtx.setStatus("subagents", undefined);
    }
    this.widgetRegistered = false;
    this.tui = undefined;
    this.lastStatusText = undefined;
  }
}
