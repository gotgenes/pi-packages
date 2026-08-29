/**
 * types.ts — Type definitions for the subagent system.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { AgentSessionEvent, SessionContext as SdkSessionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentThinkingLevel } from "#src/config/thinking-level";
import type { ModelRegistry } from "#src/session/model-resolver";


export type { SteerOutcome } from "#src/lifecycle/subagent";
export { Subagent } from "#src/lifecycle/subagent";
export type { AgentSessionEvent };

/**
 * The thinking levels this package accepts.
 *
 * Wider than pi-ai's `ThinkingLevel`, which omits `off` — Pi honors it, and agent
 * frontmatter has always documented it.
 */
export type ThinkingLevel = SubagentThinkingLevel;

/**
 * One message in a child session's history, typed from Pi's `SessionContext`.
 *
 * Derived from the barrel-exported `SessionContext` (whose `messages` field is
 * `AgentMessage[]`) so the package needs no direct dependency on
 * `@earendil-works/pi-agent-core`, which is not re-exported from the public barrel.
 */
export type SessionMessage = SdkSessionContext["messages"][number];

/**
 * Narrow session interface for event subscription.
 * Used by record-observer — only the subscribe method is needed.
 */
export interface SubscribableSession {
  subscribe(fn: (event: AgentSessionEvent) => void): () => void;
}

/** Agent type: any string name (built-in defaults or user-defined). */
export type SubagentType = string;

/** UI display and agent listing — name, display name, description, prompt mode. */
export interface AgentIdentity {
  name: string;
  displayName?: string;
  description: string;
  promptMode: "replace" | "append";
}

/** Prompt assembly — name, prompt mode, system prompt. */
export interface AgentPromptConfig {
  name: string;
  promptMode: "replace" | "append";
  systemPrompt: string;
}

/** Unified agent configuration — used for both default and user-defined agents. */
export interface AgentConfig extends AgentIdentity, AgentPromptConfig {
  /** The agent's tool allowlist. Entries name built-in or extension-registered tools; omitted means every built-in. */
  toolNames?: string[];
  model?: string;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  /** Default for spawn: fork parent conversation. undefined = caller decides. */
  inheritContext?: boolean;
  /** Default for spawn: run in background. undefined = caller decides. */
  runInBackground?: boolean;
  /** One-line usage guideline for the subagent tool's Guidelines: block. Omitted — no guideline line. */
  toolGuideline?: string;
  /** true = this is an embedded default agent (informational) */
  isDefault?: boolean;
  /** false = agent is hidden from the registry */
  enabled?: boolean;
  /** Where this agent was loaded from */
  source?: "default" | "project" | "global";
}

export interface AgentInvocation {
  /** Short display name, e.g. "haiku" — only set when different from parent. */
  modelName?: string;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  inheritContext?: boolean;
  runInBackground?: boolean;
}

/**
 * Narrow shell-exec callback replacing `ExtensionAPI` in `detectEnv()`.
 * Matches the shape of `pi.exec()` without carrying an SDK dependency.
 */
/**
 * Narrow interface capturing the ExtensionContext fields SubagentRuntime needs.
 * Avoids coupling runtime to the full SDK ExtensionContext surface (ISP).
 */
export interface SessionContext {
  readonly cwd: string;
  readonly model: Model<any> | undefined;
  readonly modelRegistry: ModelRegistry;
  getSystemPrompt(): string;
  readonly sessionManager: {
    getSessionFile(): string | undefined;
    getSessionId(): string;
    getBranch(): unknown[];
  };
}

/**
 * Narrow shell-exec callback replacing `ExtensionAPI` in `detectEnv()`.
 * Matches the shape of `pi.exec()` without carrying an SDK dependency.
 */
export type ShellExec = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string; code: number }>;

/** Parent session identity — grouped fields that travel together from the tool boundary. */
export interface ParentSessionInfo {
	/** Path to the parent session's JSONL file (for deriving the subagent session directory). */
	parentSessionFile?: string;
	/** Session ID of the parent agent (stored in the child session's parentSession header). */
	parentSessionId?: string;
	/** Tool call ID for background notification wiring. Exposed on the record via Subagent.toolCallId. */
	toolCallId?: string;
}

/** Compaction event info passed through lifecycle observers. */
export type CompactionInfo = { reason: "manual" | "threshold" | "overflow"; tokensBefore: number };
