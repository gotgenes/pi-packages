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
import { emitChildSessionShutdown } from "#src/lifecycle/child-shutdown";
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
  private disposed = false;

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

  /** Drive the initial run's turn loop; emits `completed` on success. */
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

    // Prepend parent context if it was captured at spawn time.
    const effectivePrompt = this.meta.parentContext
      ? this.meta.parentContext + prompt
      : prompt;

    try {
      await session.prompt(effectivePrompt);
      failIfProviderErrored(session);
      this.meta.lifecycle.completed({
        sessionDir: this.meta.sessionDir,
        agentName: this.meta.agentName,
        aborted,
        steered: softLimitReached,
      });
    } finally {
      unsubTurns();
      collector.unsubscribe();
      cleanupAbort();
    }

    const responseText = collector.getText().trim() || getLastAssistantText(session);
    return { responseText, aborted, steered: softLimitReached };
  }

  /** Re-prompt the same session (resume); does not emit `completed`. */
  async resumeTurnLoop(prompt: string, signal?: AbortSignal): Promise<string> {
    const session = this._session;
    const collector = collectResponseText(session);
    const cleanupAbort = forwardAbortSignal(session, signal);

    try {
      await session.prompt(prompt);
      failIfProviderErrored(session);
    } finally {
      collector.unsubscribe();
      cleanupAbort();
    }

    return collector.getText().trim() || getLastAssistantText(session);
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
 *
 * Keyed on the *last* assistant message rather than any errored one in the
 * history: Pi removes a retried error from agent state before retrying, so a
 * message still in last position is one the retry budget did not rescue. A
 * hard abort and a user stop both yield `stopReason: "aborted"`, which is a
 * terminal outcome the run already reports through its own channel.
 */
function failIfProviderErrored(session: AgentSession): void {
  const failure = readTurnFailure(session);
  if (failure) throw new Error(failure);
}

/** The provider's error on the last turn, or undefined when it did not error. */
function readTurnFailure(session: AgentSession): string | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    if (msg.role !== "assistant") continue;
    if (msg.stopReason !== "error") return undefined;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || intentional: an empty errorMessage is as uninformative as an absent one, and ?? would pass it through
    return msg.errorMessage || PROVIDER_ERROR_WITHOUT_MESSAGE;
  }
  return undefined;
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
