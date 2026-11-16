/**
 * agent-widget.ts — Persistent widget showing running/completed agents above the editor.
 *
 * Displays a tree of agents with animated spinners, live stats, and activity descriptions.
 * Uses the callback form of setWidget for themed rendering.
 */

import type { TuiMode } from "@earendil-works/pi-tui";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { Subagent } from "#src/lifecycle/subagent";
import type { SubagentManager, SubagentManagerObserver } from "#src/lifecycle/subagent-manager";
import type { RunKind } from "#src/lifecycle/subagent-run";
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
  readonly terminal: { readonly columns: number; readonly rows: number };
  /**
   * The active renderer's mode. Pi hands widget factories a proxy that follows
   * the current renderer, so this stays current across a `/fullscreen` switch.
   */
  readonly mode: TuiMode;
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

/**
 * How often the widget re-renders while a subagent animates, per TUI mode.
 *
 * The widget is the only thing asking Pi for a frame while the parent idles,
 * and every frame walks the whole component tree, transcript included. Measured
 * against real session transcripts mounted on Pi's own renderers (pi-tui 1.0.0):
 *
 * - Fullscreen diffs only the visible rows and Pi's components cache their
 *   lines, so a frame costs under 1 ms even at 18k transcript lines (~1% of a
 *   core at 80 ms). It ticks at Pi's own `Loader` cadence.
 * - Regular mode's frame cost scales with the transcript (~9 ms at 18k lines),
 *   so 80 ms would cost ~11% of a core for as long as an agent runs; it keeps
 *   250 ms (~3.5%).
 *
 * An unknown mode (no TUI captured yet) takes the conservative regular cadence.
 */
const FULLSCREEN_ANIMATION_MS = 80;
const REGULAR_ANIMATION_MS = 250;

function animationIntervalMs(mode: TuiMode | undefined): number {
  return mode === "fullscreen" ? FULLSCREEN_ANIMATION_MS : REGULAR_ANIMATION_MS;
}

// ---- Widget manager ----

export class AgentWidget implements SubagentManagerObserver {
  private uiCtx: UICtx | undefined;
  private widgetFrame = 0;
  /** The pending one-shot animation tick; each tick's `update()` re-arms it while an agent runs. */
  private widgetTimer: ReturnType<typeof setTimeout> | undefined;
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

  /** Set the UI context (captured at session_start). */
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
   * Called on each new turn (turn_start).
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

  /**
   * A run started, initial or resumed — render, which (re-)arms the animation loop.
   * The record's previous run, if any, has finished lingering or never will, so
   * forget its age: this run's finished row lingers from zero like the first's.
   */
  onSubagentRunStarted(record: Subagent, _kind: RunKind) {
    this.finishedTurnAge.delete(record.id);
    this.update();
  }

  /** A background subagent was created (queued) — render so the count shows. */
  onSubagentCreated(_record: Subagent) {
    this.update();
  }

  /** A run finished — render so the finished state is seeded and the refreshed result shown. */
  onSubagentRunFinished(_record: Subagent, _kind: RunKind) {
    this.update();
  }

  /** A subagent's session compacted — render to refresh the compaction count. */
  onSubagentCompacted(_record: Subagent, _info: CompactionInfo) {
    this.update();
  }

  /**
   * Single owner of the animation timer's existence. Idempotent in both
   * directions, so a caller states the wanted state rather than checking first.
   */
  private setTimerRunning(shouldRun: boolean): void {
    if (shouldRun) {
      this.widgetTimer ??= setTimeout(() => {
        this.widgetTimer = undefined;
        this.update();
      }, animationIntervalMs(this.tui?.mode));
      return;
    }
    if (this.widgetTimer) {
      clearTimeout(this.widgetTimer);
      this.widgetTimer = undefined;
    }
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
   *
   * The predicate reads the mode of the record's current run, so an agent
   * resumed in the background shows in the widget regardless of the mode it was
   * spawned in, and one resumed in the foreground streams inline instead. It
   * formerly re-derived it from a per-call display snapshot only the tool door
   * ever built — so every SDK-spawned agent was filtered out permanently (#724).
   */
  private listBackgroundAgents(): Subagent[] {
    return this.manager.listAgents().filter(record => record.isBackground);
  }

  /** Project a live Subagent record onto a pure-data WidgetAgent snapshot. */
  private toWidgetAgent(record: Subagent): WidgetAgent {
    return {
      id: record.id,
      type: record.type,
      status: record.status,
      description: record.description,
      toolUses: record.toolUses,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      error: record.error,
      lifetimeUsage: record.lifetimeUsage,
      compactionCount: record.compactionCount,
      turnBudget: record.turnBudget,
      activeTools: record.activeTools,
      responseText: record.responseText,
      contextPercent: record.getContextPercent(),
      model: record.model,
    };
  }

  /** Delegate rendering to the pure widget-renderer module. */
  private renderWidget(tui: TuiSurface, theme: Theme): string[] {
    return renderWidgetLines({
      agents: this.listBackgroundAgents().map(r => this.toWidgetAgent(r)),
      registry: this.registry,
      spinnerFrame: this.widgetFrame,
      terminalWidth: tui.terminal.columns,
      terminalHeight: tui.terminal.rows,
      theme,
      shouldShowFinished: (id, status) => this.shouldShowFinished(id, status),
    });
  }

  /**
   * Unregister the widget, clear the status bar, stop the animation timer, and
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
    this.setTimerRunning(false);
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

    // Only a running agent has content that changes between ticks: a finished
    // line's duration is fixed and the queued line is a count, so animating
    // either would ask Pi to re-render its whole component tree for a
    // byte-identical result. Armed after registration, so the next tick's
    // interval can read the TUI the factory just captured.
    this.setTimerRunning(state.runningCount > 0);
  }

  /**
   * Release everything the widget acquired: the animation timer and both
   * registrations on the session's `UICtx`.
   *
   * Disposal is final. Dropping the `UICtx` makes `update()` return at its
   * first line, so a notification arriving afterwards — the terminal transition
   * an abort drives synchronously — cannot re-register what this released.
   * `setUICtx()` re-arms the widget if a context ever arrives again.
   */
  dispose() {
    this.setTimerRunning(false);
    if (this.uiCtx) {
      this.uiCtx.setWidget("agents", undefined);
      this.uiCtx.setStatus("subagents", undefined);
    }
    this.uiCtx = undefined;
    this.widgetRegistered = false;
    this.tui = undefined;
    this.lastStatusText = undefined;
  }
}
