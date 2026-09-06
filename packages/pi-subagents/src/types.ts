/**
 * types.ts — Type definitions for the subagent system.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { AgentSessionEvent, SessionContext as SdkSessionContext } from "@earendil-works/pi-coding-agent";
import type { LockDeclaration } from "#src/config/invocation-config";
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
  /** Fields a `subagent` tool caller may not override. Omitted — every field is overridable. */
  locked?: LockDeclaration;
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
    getLeafId?(): string | null;
    getLeafEntry?(): unknown;
    getEntry?(id: string): unknown;
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
	readonly parentSessionFile?: string;
	/** Session ID of the parent agent (stored in the child session's parentSession header). */
	readonly parentSessionId?: string;
	/** Persisted parent-session entry containing the tool call that created this child. */
	readonly parentEntryId?: string;
	/** Tool call ID for background notification wiring. Exposed on the record via Subagent.toolCallId. */
	readonly toolCallId?: string;
}

/** Source-backed model identity for the lifecycle V2 wire format. */
export interface SourceModelV2 {
	provider: string;
	id: string;
	name: string;
}

/** Lifecycle states emitted by the source package. */
export type SourceLifecycleStateV2 =
	| "queued"
	| "running"
	| "completed"
	| "steered"
	| "aborted"
	| "stopped"
	| "error";

/** Per-execution compaction state emitted by the source package. */
export interface SourceCompactionV2 {
	state: "idle" | "compacting";
	count: number;
	started_at: string | null;
	last_outcome: "completed" | "failed" | "aborted" | null;
}

/** Current execution fields used to compose a lifecycle V2 source child. */
export interface SubagentLifecycleRunV2 {
	task_id: string;
	run_id: string;
	model: SourceModelV2 | null;
	started_at: string;
	finished_at: string | null;
	duration_ms: number | null;
	compaction: SourceCompactionV2;
}

/** Complete source-backed child row for a lifecycle V2 snapshot. */
export interface SourceChildV2 extends SubagentLifecycleRunV2 {
	parent_entry_id: string;
	description: string;
	lifecycle_state: SourceLifecycleStateV2;
	sequence: number;
}

/** An opaque manager-local binding to one live child session. */
export type ContextRefV1 = `ctx1_${string}`;

/** JSON values allowed in bounded control-result details. */
export type BoundedJsonValueV1 = null | boolean | number | string | BoundedJsonObjectV1 | BoundedJsonValueV1[];
export interface BoundedJsonObjectV1 {
	[key: string]: BoundedJsonValueV1;
}

/** A closed control completion delivered to one live child session. */
export interface ControlResultPayloadV1 {
	protocol: "mecha.control/v1";
	result_id: string;
	request_id: string;
	target_session_epoch: number;
	runtime_generation: string;
	manifest_sha256: string;
	status: "ok" | "error";
	content: string;
	details: BoundedJsonObjectV1;
	error?: {
		code: string;
		message: string;
		retryable: boolean;
	};
}

export type ControlResultAppendErrorCodeV1 =
	| "INVALID_ENVELOPE"
	| "PAYLOAD_TOO_LARGE"
	| "STALE_CHILD_CONTEXT"
	| "CONFLICT"
	| "RESULT_DELIVERY_FAILED";

export type ControlResultAppendOutcomeV1 =
	| { kind: "accepted"; result_id: string }
	| { kind: "already_present"; result_id: string }
	| {
		kind: "rejected";
		error: { code: ControlResultAppendErrorCodeV1; message: string; retryable: boolean };
	};

/** Service-only V2 row. Router snapshots use SourceChildV2 without this live reference. */
export interface LifecycleSnapshotV2ServiceRow extends SourceChildV2 {
	context_ref: ContextRefV1 | null;
}

/** Router-safe source snapshot envelope for lifecycle V2. */
export interface SubagentLifecycleSnapshotV2 {
	protocol: "mecha.children/v1";
	snapshot_id: string;
	owner_session_id: string;
	sequence: number;
	runs: SourceChildV2[];
}

/** In-process snapshot with an opaque live-session reference for each active child. */
export interface LifecycleSnapshotV2ServiceResult extends Omit<SubagentLifecycleSnapshotV2, "runs"> {
	runs: LifecycleSnapshotV2ServiceRow[];
}

/** Manager-local source delta. The context reference is not a router field. */
export interface SubagentLifecycleDeltaV2 {
	protocol: "mecha.children/v1";
	owner_session_id: string;
	sequence: number;
	task_id: string;
	run_id: string;
	parent_entry_id: string;
	context_ref: ContextRefV1 | null;
	changes: Partial<Pick<SourceChildV2, "description" | "model" | "lifecycle_state" | "started_at" | "finished_at" | "duration_ms" | "compaction">>;
}

/** Explicit source compaction transition. */
export type CompactionTransitionV2 =
	| { type: "start"; started_at: string }
	| { type: "completed" }
	| { type: "failed" }
	| { type: "aborted" };

/** Compaction event info passed through lifecycle observers. */
export type CompactionInfo = { reason: "manual" | "threshold" | "overflow"; tokensBefore: number };
