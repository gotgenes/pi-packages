/**
 * runtime.ts — SubagentRuntime: composition root for all mutable extension state.
 *
 * Eliminates module-scope state in agent-runner.ts and closure-scoped state
 * in index.ts by consolidating them into a single, testable object.
 * Follows the same pattern as pi-permission-system's ExtensionRuntime.
 */

import { buildParentSnapshot, type ParentPromptOptions, type ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { PromptInheritance } from "#src/settings";
import type { ModelInfo } from "#src/tools/spawn-config";
import type { SessionContext } from "#src/types";

/**
 * Narrow config subset read by Agent when driving the turn loop (defaultMaxTurns, graceTurns).
 * Kept separate so callers can satisfy it without depending on the full runtime.
 */
export interface RunConfig {
  readonly defaultMaxTurns: number | undefined;
  readonly graceTurns: number;
  /** Whether a background child gets the `notify_parent` channel. */
  readonly midRunUpdates: boolean;
  /** Default prompt inheritance for agents without an explicit `inherit_prompt`. */
  readonly promptInheritance?: PromptInheritance;
  /** Per-provider inheritance overrides, keyed by provider id of the child's model. */
  readonly promptInheritanceProviders?: Record<string, PromptInheritance>;
}

/**
 * All mutable state owned by the pi-subagents extension.
 *
 * Created once inside `piSubagentsExtension()` via `createSubagentRuntime()`.
 * Tests construct a fresh runtime per test for full isolation.
 */
export class SubagentRuntime {
  // ── Session state (was closure-scoped in index.ts) ───────────────────────
  /** Active Pi session context — set on session_start, cleared on session_shutdown. */
  currentCtx: SessionContext | undefined = undefined;

  /** Latest system-prompt options pi assembled for the parent session, captured
   *  from `before_agent_start` so a snapshot can carry the parent's portable
   *  prompt parts without re-parsing the assembled string. */
  private lastPromptOptions: ParentPromptOptions | undefined = undefined;

  // ── Session-context methods ──────────────────────────────────────────────

  /** Store the active Pi session context (called from session_start). */
  setSessionContext(ctx: SessionContext): void {
    this.currentCtx = ctx;
  }

  /** Clear the session context (called from session_shutdown). */
  clearSessionContext(): void {
    this.currentCtx = undefined;
  }

  /** Store the parent's latest assembled system-prompt options (called from before_agent_start). */
  setSystemPromptOptions(options: ParentPromptOptions): void {
    this.lastPromptOptions = options;
  }

  /**
   * Build a parent snapshot from the current session context.
   * Only valid during an active session (currentCtx is defined).
   */
  buildSnapshot(inheritContext: boolean): ParentSnapshot {

    return buildParentSnapshot(this.currentCtx!, inheritContext, this.lastPromptOptions);
  }

  /** Extract model info from the current session context. */
  getModelInfo(): ModelInfo {
    return {
      parentModel: this.currentCtx?.model,
      modelRegistry: this.currentCtx?.modelRegistry,
    };
  }

  /** Extract session identity from the current session context. */
  getSessionInfo(): { parentSessionFile: string; parentSessionId: string } {
    return {
      parentSessionFile: this.currentCtx?.sessionManager.getSessionFile() ?? "",
      parentSessionId: this.currentCtx?.sessionManager.getSessionId() ?? "",
    };
  }
}

/**
 * Create a fully-initialized SubagentRuntime with default values.
 *
 * Call once at extension startup; pass the result to factories and handlers.
 */
export function createSubagentRuntime(): SubagentRuntime {
  return new SubagentRuntime();
}
