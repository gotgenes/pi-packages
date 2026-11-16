/**
 * subagent-session.ts — The born-complete child-session value object (issue #265).
 *
 * A SubagentSession wraps one SDK AgentSession plus its turn-driving and teardown.
 * It is born complete: `createSubagentSession()` returns a fully usable instance
 * (session created, extensions bound, recursion guard applied), so the only thing
 * left for `Subagent` to do is coordinate — drive the turn loop, steer, dispose.
 *
 * Turn driving lives here, on the object that owns the AgentSession, rather than
 * reaching through `subagentSession.session` from `Subagent` (Law of Demeter).
 */

import type { Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { emitChildSessionShutdown } from "#src/lifecycle/child-shutdown";
import {
  type TurnBudget,
  type TurnBudgetAction,
  TurnBudgetTracker,
  type TurnLimits,
  type TurnOutcome,
} from "#src/lifecycle/turn-limits";
import { getSessionContextPercent, type SessionStatsLike } from "#src/lifecycle/usage";
import { extractText } from "#src/session/context";
import { getAgentConversation } from "#src/session/conversation";
import type { SessionMessage, ThinkingLevel } from "#src/types";

/** Outcome of one turn loop. */
export interface TurnLoopResult {
  responseText: string;
  /** The run's turn budget as the loop ended. */
  turnBudget: TurnBudget;
}

/** Per-call options for one run's turn loop. */
export interface TurnLoopOptions {
  signal?: AbortSignal;
  /** Receives the run's budget at the start and after every turn boundary that changes it. */
  onTurnBudget?: (budget: TurnBudget) => void;
}

/** Session-level facts known at creation, supplied by the factory. */
export interface SubagentSessionMeta {
  /** Path to the persisted session JSONL file, if the session was persisted. */
  outputFile: string | undefined;
  /** Child session id — the registry key carried on session-created/disposed events. */
  sessionId: string;
  /** Child session directory — carried on the completed event as transcript location. */
  sessionDir: string;
  agentName: string;
  /** The limits every run of this session is held to, resolved at creation. */
  turnLimits: TurnLimits;
  /** Parent context prepended to the first run's prompt, captured at spawn time. */
  parentContext: string | undefined;
  lifecycle: ChildLifecyclePublisher;
}

/**
 * One child AgentSession plus its turn-driving and teardown — born complete.
 */
export class SubagentSession {
  private disposed = false;

  /**
   * Set as the session's first run starts, settled or not: only that run
   * carries the parent context and announces the child's completion.
   */
  private hasRun = false;

  /**
   * How the session's last assistant turn ended, tracked for the session's
   * whole life rather than per call.
   *
   * Per call is not enough: a `prompt()` can resolve without running a turn at
   * all, and the failure a *previous* call observed may never have reached
   * `session.messages` for a later one to re-derive — Pi's overflow recovery
   * strips it and restores nothing when its compaction fails (#898).
   */
  private readonly turnFailure: ReturnType<typeof collectTurnFailure>;

  constructor(
    private readonly _session: AgentSession,
    private readonly meta: SubagentSessionMeta,
  ) {
    this.turnFailure = collectTurnFailure(_session);
  }

  /**
   * Wrapped session — for lifecycle-internal use only.
   * @internal consumers outside lifecycle/ use the delegate methods below.
   */
  get session(): AgentSession {
    return this._session;
  }

  get outputFile(): string | undefined {
    return this.meta.outputFile;
  }

  /** The model the child is running now — a failover or `/model` switch shows here. */
  get model(): Model<any> | undefined {
    return this._session.model;
  }

  /** The child's current thinking level. */
  get thinkingLevel(): ThinkingLevel {
    return this._session.thinkingLevel;
  }

  /**
   * Drive one run's turn loop under a fresh budget at the session's limits:
   * the initial run, or a resume, whose parent asked for more work and for
   * which an exhausted run's remainder would be none.
   *
   * The session's first run prefixes the parent context captured at spawn and
   * emits `completed` once its prompt resolves; a later run does neither.
   */
  async runTurnLoop(prompt: string, opts: TurnLoopOptions): Promise<TurnLoopResult> {
    const firstRun = !this.hasRun;
    this.hasRun = true;
    const tracker = new TurnBudgetTracker(this.meta.turnLimits);
    const responseText = await this.promptForAnswer(firstRun ? this.withParentContext(prompt) : prompt, tracker, opts);
    if (firstRun) {
      this.meta.lifecycle.completed({
        sessionDir: this.meta.sessionDir,
        agentName: this.meta.agentName,
        turnBudget: tracker.budget,
      });
    }
    return { responseText, turnBudget: tracker.budget };
  }

  private withParentContext(prompt: string): string {
    return this.meta.parentContext ? this.meta.parentContext + prompt : prompt;
  }

  /**
   * Prompt the session for one run's answer, held to the tracker's budget.
   *
   * A signal that already fired takes no turn and has no answer. Forwarding it
   * would not stop the prompt: Pi's `abort()` is a no-op while no run is active,
   * so it cannot cancel a prompt started after it. Nor does the history answer
   * for it — on a resume, the last assistant text is the previous run's.
   */
  private async promptForAnswer(
    prompt: string,
    tracker: TurnBudgetTracker,
    opts: TurnLoopOptions,
  ): Promise<string> {
    if (opts.signal?.aborted) return "";
    const session = this._session;
    const unsubTurns = this.enforceTurnBudget(tracker, opts.onTurnBudget);
    const collector = collectResponseText(session);
    const cleanupAbort = forwardAbortSignal(session, opts.signal);

    try {
      await session.prompt(prompt);
      failIfProviderErrored(this.turnFailure.getFailure());
    } finally {
      unsubTurns();
      collector.unsubscribe();
      cleanupAbort();
    }

    return collector.getText().trim() || getLastAssistantText(session);
  }

  /**
   * Hold the session to the tracker's budget: state it up front when the whole
   * budget is wrap-up turns, then act on each turn boundary and report the
   * budget as it changes. Returns the unsubscribe for the turn listener.
   */
  private enforceTurnBudget(
    tracker: TurnBudgetTracker,
    report: ((budget: TurnBudget) => void) | undefined,
  ): () => void {
    if (tracker.warnBeforeFirstTurn()) this.sendBudgetWarning(tracker);
    report?.(tracker.budget);
    return this._session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "turn_end") {
        this.actOnTurnBudget(tracker, tracker.onTurnEnd(turnOutcome(event)));
        report?.(tracker.budget);
      } else if (event.type === "turn_start") {
        const action = tracker.onTurnStart();
        this.actOnTurnBudget(tracker, action);
        if (action) report?.(tracker.budget);
      }
    });
  }

  private actOnTurnBudget(tracker: TurnBudgetTracker, action: TurnBudgetAction): void {
    if (action === "warn") this.sendBudgetWarning(tracker);
    else if (action === "stop") void this._session.abort();
  }

  /**
   * Tell the child how many turns it has left, as context for its next turn.
   *
   * A context-only custom message rather than a steer: Pi appends it to the
   * transcript at the turn's end and forces no turn, where a queued steer keeps
   * the agent loop going even after a turn that made no tool calls, replacing a
   * final answer with a reply to the warning.
   */
  private sendBudgetWarning(tracker: TurnBudgetTracker): void {
    void this._session.sendCustomMessage(
      {
        customType: TURN_BUDGET_WARNING_TYPE,
        content: budgetWarningText(tracker.remaining ?? 0),
        display: true,
      },
      { triggerTurn: false },
    );
  }

  /** Deliver a steer to the live session. */
  async steer(message: string): Promise<void> {
    await this._session.steer(message);
  }

  /** Return the session's conversation as formatted text. */
  getConversation(): string {
    return getAgentConversation(this._session);
  }

  /** Return the session context window utilization (0-100), or null when unavailable. */
  getContextPercent(): number | null {
    return getSessionContextPercent(this._session);
  }

  /** Subscribe to session events. Satisfies `SubscribableSession`. */
  subscribe(fn: (event: AgentSessionEvent) => void): () => void {
    return this._session.subscribe(fn);
  }

  /** Return session token statistics. Satisfies `SessionLike`. */
  getSessionStats(): SessionStatsLike {
    return this._session.getSessionStats();
  }

  /** The session's message history. */
  get messages(): readonly unknown[] {
    return this._session.messages;
  }

  /** The session's message history, typed for Pi's session-rendering machinery. */
  get agentMessages(): readonly SessionMessage[] {
    return this._session.messages;
  }

  /** Resolve a registered tool definition by name, for Pi's tool-execution components. */
  getToolDefinition(name: string): ToolDefinition | undefined {
    return this._session.getToolDefinition(name);
  }

  /**
   * Tear down: child `session_shutdown` + session.dispose() + emit `disposed`
   * (registry unregister).
   *
   * The order is load-bearing. The shutdown emit runs first because
   * `AgentSession.dispose()` invalidates the extension runner, after which every
   * handler's context throws (#709). The `disposed` event runs last because it
   * unregisters the child from the permission system, so a shutdown handler
   * still resolves against a live registration.
   *
   * Idempotent: the guard is set before the first await, so concurrent callers
   * (a retention sweep racing a manager teardown) emit and dispose exactly once.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.turnFailure.unsubscribe();
    await emitChildSessionShutdown(this._session);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- dispose may not exist on all session implementations
    this._session.dispose?.();
    this.meta.lifecycle.disposed({ sessionId: this.meta.sessionId });
  }
}

// ── Private turn-loop helpers ───────────────────────────────────────────────────

/**
 * What a failed turn reports when the provider named no reason. An empty
 * `errorMessage` is as uninformative as an absent one, so both land here.
 */
const PROVIDER_ERROR_WITHOUT_MESSAGE = "provider reported an error with no message";

/**
 * Throw when the run's last turn ended in a provider error.
 *
 * Pi does not throw on a provider failure: the agent loop appends an assistant
 * message with `stopReason: "error"` and an `errorMessage`, then ends the turn
 * normally. Without this read a failed turn is indistinguishable from a quiet
 * one, and the run reports a successful, empty completion (#889).
 */
function failIfProviderErrored(failure: string | undefined): void {
  if (failure) throw new Error(failure);
}

/**
 * Subscribe to a session and record how its last assistant message ended.
 *
 * Read live rather than scanned back from `session.messages` once the run has
 * settled: Pi's overflow recovery removes the failed message from agent state
 * before attempting compaction and restores nothing when that compaction fails,
 * so a run's own error may no longer be in the history by the time it ends
 * (#898). `message_end` is emitted before any of that runs.
 *
 * Last-one-wins rather than latched: a successful auto-retry emits a later,
 * clean `message_end`, and that run recovered. A hard abort and a user stop
 * both yield `stopReason: "aborted"`, which is a terminal outcome the run
 * already reports through its own channel.
 *
 * Subscribed for the session's whole life, and seeded from whatever history it
 * already had. `prompt()` can resolve without running a turn at all — an
 * extension command matched, an `input` handler reported the prompt handled, a
 * message was queued while streaming — and a resume is not refused for an agent
 * whose earlier run failed. Such a call observes no event of its own, so the
 * answer has to be one the collector was already holding: what an earlier call
 * observed, or, for turns that predate the subscription, what the history says.
 */
function collectTurnFailure(session: AgentSession) {
  let failure = readLastTurnFailure(session);
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") return;
    failure =
      event.message.stopReason === "error"
        ? // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || intentional: an empty errorMessage is as uninformative as an absent one, and ?? would pass it through
          event.message.errorMessage || PROVIDER_ERROR_WITHOUT_MESSAGE
        : undefined;
  });
  return { getFailure: () => failure, unsubscribe };
}

/** How the session's last assistant message ended, read from its history. */
function readLastTurnFailure(session: AgentSession): string | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    if (msg.role !== "assistant") continue;
    if (msg.stopReason !== "error") return undefined;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || intentional: an empty errorMessage is as uninformative as an absent one, and ?? would pass it through
    return msg.errorMessage || PROVIDER_ERROR_WITHOUT_MESSAGE;
  }
  return undefined;
}

/** The custom-message type the turn-budget warning is sent as. */
const TURN_BUDGET_WARNING_TYPE = "subagents:turn-budget-warning";

/** The warning a child reads with `remaining` turns left, this coming one included. */
function budgetWarningText(remaining: number): string {
  const turns = remaining === 1 ? "1 turn" : `${remaining} turns`;
  return (
    `Turn budget: you have ${turns} left, including this one. ` +
    "The harness stops you after that. Finish your work and give your final answer within that budget."
  );
}

/** How a `turn_end` bears on the budget: whether it failed, and whether the agent loop continues. */
function turnOutcome(event: Extract<AgentSessionEvent, { type: "turn_end" }>): TurnOutcome {
  const stopReason = event.message.role === "assistant" ? event.message.stopReason : undefined;
  return {
    failed: stopReason === "error" || stopReason === "aborted",
    ranTools: event.toolResults.length > 0,
  };
}

/**
 * Subscribe to a session and collect the last assistant message text.
 * Returns an object with a `getText()` getter and an `unsubscribe` function.
 */
function collectResponseText(session: AgentSession) {
  let text = "";
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_start") {
      text = "";
    }
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      text += event.assistantMessageEvent.delta;
    }
  });
  return { getText: () => text, unsubscribe };
}

/** Get the last assistant text from the completed session history. */
function getLastAssistantText(session: AgentSession): string {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    if (msg.role !== "assistant") continue;
    const text = extractText(msg.content).trim();
    if (text) return text;
  }
  return "";
}

/**
 * Wire an AbortSignal to abort a session.
 * Returns a cleanup function to remove the listener.
 */
function forwardAbortSignal(
  session: AgentSession,
  signal?: AbortSignal,
): () => void {
  if (!signal) return () => {};
  const onAbort = (): void => {
    void session.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}
