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

import {
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import {
  type SubagentLifecycleOutcome,
  type SubagentTurnLifecycle,
} from "#src/lifecycle/lifecycle-interceptor";
import { normalizeMaxTurns } from "#src/lifecycle/turn-limits";
import { getSessionContextPercent, type SessionStatsLike } from "#src/lifecycle/usage";
import { extractText } from "#src/session/context";
import { getAgentConversation } from "#src/session/conversation";
import type { SessionMessage } from "#src/types";

/** Outcome of one turn loop. */
export interface TurnLoopResult {
  responseText: string;
  /** True if the agent was hard-aborted (max turns + grace exceeded). */
  aborted: boolean;
  /** True if the agent was steered to wrap up (soft turn limit) but finished in time. */
  steered: boolean;
  /** A lifecycle provider denied finalization; no child completion is emitted. */
  lifecycleAborted?: boolean;
}

/** Per-call options for the initial run's turn loop. */
export interface TurnLoopOptions {
  /** Per-call max-turns override — highest precedence. */
  maxTurns?: number;
  /** Runtime-config fallback when neither per-call nor per-agent limit is set. */
  defaultMaxTurns?: number;
  /** Grace turns after the soft-limit steer message before a hard abort. */
  graceTurns?: number;
  signal?: AbortSignal;
  /** Present only for an execution that captured active lifecycle providers. */
  lifecycle?: SubagentTurnLifecycle;
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
  /** Per-agent max-turns from the resolved agent config — middle precedence. */
  agentMaxTurns: number | undefined;
  /** Parent context prepended to the run prompt, captured at spawn time. */
  parentContext: string | undefined;
  lifecycle: ChildLifecyclePublisher;
}

/**
 * One child AgentSession plus its turn-driving and teardown — born complete.
 */
export class SubagentSession {
  constructor(
    private readonly _session: AgentSession,
    private readonly meta: SubagentSessionMeta,
  ) {}

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

  /** Stable child session identity for lifecycle provider metadata. */
  // fallow-ignore-next-line unused-class-member -- Subagent reads this through the lifecycle-only session boundary
  get sessionId(): string {
    return this.meta.sessionId;
  }

  /** Drive the initial run's turn loop; emits `completed` on accepted success. */
  async runTurnLoop(prompt: string, opts: TurnLoopOptions): Promise<TurnLoopResult> {
    const session = this._session;

    // Track turns for graceful max_turns enforcement.
    let turnCount = 0;
    const maxTurns = normalizeMaxTurns(
      opts.maxTurns ?? this.meta.agentMaxTurns ?? opts.defaultMaxTurns,
    );
    let softLimitReached = false;
    let aborted = false;

    const unsubTurns = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "turn_end") {
        turnCount++;
        if (maxTurns != null) {
          if (!softLimitReached && turnCount >= maxTurns) {
            softLimitReached = true;
            void session.steer(
              "You have reached your turn limit. Wrap up immediately - provide your final answer now.",
            );
          } else if (softLimitReached && turnCount >= maxTurns + (opts.graceTurns ?? 5)) {
            aborted = true;
            void session.abort();
          }
        }
      }
    });

    const collector = collectResponseText(session);
    const cleanupAbort = forwardAbortSignal(session, opts.signal);

    // Prepend parent context before lifecycle providers see the exact prompt.
    const effectivePrompt = this.meta.parentContext
      ? this.meta.parentContext + prompt
      : prompt;

    try {
      if (!opts.lifecycle) {
        // Preserve the released no-provider order byte-for-byte: completion is
        // published immediately after prompt resolution and before extraction.
        await session.prompt(effectivePrompt);
        this.publishCompleted(aborted, softLimitReached);
        const responseText = collector.getText().trim() || getLastAssistantText(session);
        return { responseText, aborted, steered: softLimitReached };
      }
      return await this.driveLifecycleTurns(
        effectivePrompt,
        opts.lifecycle,
        () => collector.getText().trim() || getLastAssistantText(session),
        () => ({ aborted, steered: softLimitReached }),
      );
    } finally {
      unsubTurns();
      collector.unsubscribe();
      cleanupAbort();
    }
  }

  /** Re-prompt the same session (resume); preserves the released no-provider path. */
  async resumeTurnLoop(prompt: string, signal?: AbortSignal): Promise<string> {
    const session = this._session;
    const collector = collectResponseText(session);
    const cleanupAbort = forwardAbortSignal(session, signal);

    try {
      await session.prompt(prompt);
      return collector.getText().trim() || getLastAssistantText(session);
    } finally {
      collector.unsubscribe();
      cleanupAbort();
    }
  }

  /**
   * Resume with active providers. This is separate from resumeTurnLoop so the
   * historical no-provider method signature and event behavior remain intact.
   */
  // fallow-ignore-next-line unused-class-member -- Subagent selects this only when a provider is registered
  async resumeLifecycleTurnLoop(
    prompt: string,
    signal: AbortSignal | undefined,
    lifecycle: SubagentTurnLifecycle,
  ): Promise<TurnLoopResult> {
    const collector = collectResponseText(this._session);
    const cleanupAbort = forwardAbortSignal(this._session, signal);
    try {
      return await this.driveLifecycleTurns(
        prompt,
        lifecycle,
        () => collector.getText().trim() || getLastAssistantText(this._session),
        () => ({ aborted: false, steered: false }),
      );
    } finally {
      collector.unsubscribe();
      cleanupAbort();
    }
  }

  private async driveLifecycleTurns(
    initialPrompt: string,
    lifecycle: SubagentTurnLifecycle,
    responseText: () => string,
    outcome: () => Readonly<{ aborted: boolean; steered: boolean }>,
  ): Promise<TurnLoopResult> {
    const start = await lifecycle.beforeStart(initialPrompt);
    if (start?.action === "abort") {
      return this.lifecycleAbort(start.reason, outcome());
    }

    let prompt = start?.prompt ?? initialPrompt;
    let continuationRound = 0;
    for (;;) {
      lifecycle.signal.throwIfAborted();
      await this._session.prompt(prompt);
      const turnOutcome = outcome();
      const proposedResult = responseText();
      const completion = await lifecycle.beforeComplete(
        proposedResult,
        toLifecycleOutcome(turnOutcome),
        continuationRound,
      );
      if (completion?.action === "abort") {
        return this.lifecycleAbort(completion.reason, turnOutcome);
      }
      if (completion?.action === "continue") {
        if (continuationRound >= lifecycle.maxContinuationRounds) {
          return this.lifecycleAbort(
            `Lifecycle continuation limit of ${lifecycle.maxContinuationRounds} reached`,
            turnOutcome,
          );
        }
        continuationRound++;
        prompt = completion.prompt;
        continue;
      }

      const finalResult = completion?.action === "complete"
        ? completion.result ?? proposedResult
        : proposedResult;
      this.publishCompleted(turnOutcome.aborted, turnOutcome.steered);
      return {
        responseText: finalResult,
        aborted: turnOutcome.aborted,
        steered: turnOutcome.steered,
      };
    }
  }

  private lifecycleAbort(
    reason: string,
    outcome: Readonly<{ aborted: boolean; steered: boolean }>,
  ): TurnLoopResult {
    // No child completion is emitted: the provider declined to accept a turn.
    return {
      responseText: reason,
      aborted: true,
      steered: outcome.steered,
      lifecycleAborted: true,
    };
  }

  private publishCompleted(aborted: boolean, steered: boolean): void {
    this.meta.lifecycle.completed({
      sessionDir: this.meta.sessionDir,
      agentName: this.meta.agentName,
      aborted,
      steered,
    });
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
    return this._session.messages as readonly unknown[];
  }

  /** The session's message history, typed for Pi's session-rendering machinery. */
  get agentMessages(): readonly SessionMessage[] {
    return this._session.messages;
  }

  /** Resolve a registered tool definition by name, for Pi's tool-execution components. */
  getToolDefinition(name: string): ToolDefinition | undefined {
    return this._session.getToolDefinition(name);
  }

  /** Tear down: session.dispose() + emit `disposed` (registry unregister). */
  dispose(): void {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- dispose may not exist on all session implementations
    this._session.dispose?.();
    this.meta.lifecycle.disposed({ sessionId: this.meta.sessionId });
  }
}

// ── Private turn-loop helpers ───────────────────────────────────────────────────

function toLifecycleOutcome(
  outcome: Readonly<{ aborted: boolean; steered: boolean }>,
): SubagentLifecycleOutcome {
  if (outcome.aborted) return "aborted";
  if (outcome.steered) return "steered";
  return "completed";
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
