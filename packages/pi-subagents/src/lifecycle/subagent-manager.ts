/**
 * subagent-manager.ts - Tracks subagents, background execution, resume support.
 *
 * Background agents are subject to a configurable concurrency limit (default: 4).
 * Excess agents are scheduled on a ConcurrencyLimiter and auto-started as running
 * agents complete. Foreground agents bypass the limiter (they block the parent anyway).
 */

import { randomBytes, randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import { type BackgroundRequest, resolveBackgroundMode } from "#src/config/invocation-config";
import { debugLog } from "#src/debug";
import type { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import { Subagent, type SubagentLifecycleObserver } from "#src/lifecycle/subagent";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import { SubagentState } from "#src/lifecycle/subagent-state";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";

import type { RunConfig } from "#src/runtime";
import type {
  AgentConfig,
  BoundedJsonObjectV1,
  BoundedJsonValueV1,
  CompactionInfo,
  ContextRefV1,
  ControlResultAppendErrorCodeV1,
  ControlResultAppendOutcomeV1,
  ControlResultPayloadV1,
  LifecycleSnapshotV2ServiceResult,
  LifecycleSnapshotV2ServiceRow,
  ParentSessionInfo,
  SourceChildV2,
  SubagentLifecycleDeltaV2,
  SubagentType,
  ThinkingLevel,
} from "#src/types";

/**
 * The agent-registry slice the manager needs to resolve a spawn. Deliberately
 * narrower than AgentConfigLookup, whose slice serves session assembly (ISP).
 */
export interface SpawnTypeResolver {
  resolveType(name: string): string | undefined;
  isValidType(type: string): boolean;
  resolveAgentConfig(type: string): AgentConfig;
}

/** A spawn's resolved identity and mode — the invariants every front door shares. */
interface ResolvedSpawn {
  type: SubagentType;
  isBackground: boolean;
}

/** Bounded source projection limits for the manager-local lifecycle V2 seam. */
export const MAX_SOURCE_CHILDREN_PER_SNAPSHOT = 256;
export const MAX_SNAPSHOT_NODES = 2_048;
export const MAX_SNAPSHOT_UTF8_BYTES = 32 * 1024;
export const MAX_V2_STRING_UTF8_BYTES = 8 * 1024;

const MAX_CONTROL_RESULT_ENVELOPE_UTF8_BYTES = 64 * 1024;
const MAX_CONTROL_RESULT_CONTENT_UTF8_BYTES = 16 * 1024;
const MAX_CONTROL_RESULT_DETAILS_UTF8_BYTES = 16 * 1024;
const MAX_CONTROL_RESULT_JSON_DEPTH = 8;
const MAX_CONTROL_RESULT_JSON_NODES = 1_024;
const MAX_CONTROL_RESULT_JSON_PROPERTIES = 128;
const MAX_CONTROL_RESULT_JSON_ARRAY_ITEMS = 256;
const MAX_CONTROL_RESULT_JSON_STRING_UTF8_BYTES = 8 * 1024;
const MAX_CONTROL_RESULT_IN_FLIGHT = 128;
const UUID_V1_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const CONTEXT_REF_V1_PATTERN = /^ctx1_[A-Za-z0-9_-]{43}$/;

type LifecycleV2MutableFields = Pick<
  SourceChildV2,
  "description" | "model" | "lifecycle_state" | "started_at" | "finished_at" | "duration_ms" | "compaction"
>;
type LifecycleV2Listener = (row: LifecycleSnapshotV2ServiceRow, delta: SubagentLifecycleDeltaV2) => void;

interface LifecycleV2RecordState {
  runId: string;
  sequence: number;
  fields: LifecycleV2MutableFields;
}

interface ControlContextBindingV1 {
  readonly contextRef: ContextRefV1;
  readonly ownerSessionId: string;
  readonly parentEntryId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly childSession: SubagentSession;
  readonly inFlightResults: Map<string, string>;
  stopObservingPersistedResults: () => void;
}

type ControlPayloadValidation =
  | { kind: "valid"; payload: ControlResultPayloadV1 }
  | { kind: "invalid"; code: "INVALID_ENVELOPE" | "PAYLOAD_TOO_LARGE"; message: string };

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Accept only own enumerable data fields so a payload cannot run getters or preserve a custom prototype. */
function ownDataRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isObjectRecord(value)) return undefined;
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (Object.getOwnPropertySymbols(value).length > 0) return undefined;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (key === "__proto__") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return undefined;
    copy[key] = descriptor.value;
  }
  return copy;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

interface JsonValidationState {
  nodes: number;
  properties: number;
  seen: WeakSet<object>;
}

/** Clone bounded plain JSON before delivery so later caller mutation cannot change an accepted result. */
function cloneBoundedJsonValue(
  value: unknown,
  state: JsonValidationState,
  depth: number,
): BoundedJsonValueV1 | undefined {
  state.nodes++;
  if (state.nodes > MAX_CONTROL_RESULT_JSON_NODES || depth > MAX_CONTROL_RESULT_JSON_DEPTH) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    return Buffer.byteLength(value, "utf8") <= MAX_CONTROL_RESULT_JSON_STRING_UTF8_BYTES ? value : undefined;
  }
  if (isUnknownArray(value)) {
    if (
      Reflect.getPrototypeOf(value) !== Array.prototype
      || value.length > MAX_CONTROL_RESULT_JSON_ARRAY_ITEMS
      || Object.keys(value).length !== value.length
      || state.seen.has(value)
    ) {
      return undefined;
    }
    state.seen.add(value);
    const copy: BoundedJsonValueV1[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return undefined;
      const nested = cloneBoundedJsonValue(descriptor.value, state, depth + 1);
      if (nested === undefined) return undefined;
      copy.push(nested);
    }
    state.seen.delete(value);
    return copy;
  }
  if (!isObjectRecord(value) || state.seen.has(value)) return undefined;
  state.seen.add(value);
  const record = ownDataRecord(value);
  if (!record) return undefined;
  const keys = Object.keys(record);
  state.properties += keys.length;
  if (keys.length > MAX_CONTROL_RESULT_JSON_PROPERTIES || state.properties > MAX_CONTROL_RESULT_JSON_PROPERTIES) {
    return undefined;
  }
  const copy: BoundedJsonObjectV1 = {};
  for (const key of keys) {
    if (Buffer.byteLength(key, "utf8") > MAX_CONTROL_RESULT_JSON_STRING_UTF8_BYTES) return undefined;
    const nested = cloneBoundedJsonValue(record[key], state, depth + 1);
    if (nested === undefined) return undefined;
    copy[key] = nested;
  }
  state.seen.delete(value);
  return copy;
}

function isBoundedJsonObject(value: BoundedJsonValueV1 | undefined): value is BoundedJsonObjectV1 {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateControlResultPayload(value: unknown): ControlPayloadValidation {
  const payload = ownDataRecord(value);
  const allKeys = [
    "protocol", "result_id", "request_id", "target_session_epoch", "runtime_generation",
    "manifest_sha256", "status", "content", "details", "error",
  ];
  const okKeys = allKeys.filter((key) => key !== "error");
  if (!payload || (!hasExactKeys(payload, allKeys) && !hasExactKeys(payload, okKeys))) {
    return { kind: "invalid", code: "INVALID_ENVELOPE", message: "Control result has an unknown or missing field." };
  }
  const { result_id: resultId, request_id: requestId, target_session_epoch: targetSessionEpoch } = payload;
  const { runtime_generation: runtimeGeneration, manifest_sha256: manifestSha256, status, content } = payload;
  if (
    payload.protocol !== "mecha.control/v1"
    || typeof resultId !== "string" || !UUID_V1_PATTERN.test(resultId)
    || typeof requestId !== "string" || !UUID_V1_PATTERN.test(requestId)
    || typeof targetSessionEpoch !== "number" || !Number.isSafeInteger(targetSessionEpoch) || targetSessionEpoch < 0
    || typeof runtimeGeneration !== "string" || !UUID_V1_PATTERN.test(runtimeGeneration)
    || typeof manifestSha256 !== "string" || !SHA256_HEX_PATTERN.test(manifestSha256)
    || (status !== "ok" && status !== "error")
    || typeof content !== "string"
  ) {
    return { kind: "invalid", code: "INVALID_ENVELOPE", message: "Control result has an invalid field value." };
  }
  if (Buffer.byteLength(content, "utf8") > MAX_CONTROL_RESULT_CONTENT_UTF8_BYTES) {
    return { kind: "invalid", code: "PAYLOAD_TOO_LARGE", message: "Control result content exceeds the 16 KiB limit." };
  }
  if (!ownDataRecord(payload.details)) {
    return { kind: "invalid", code: "INVALID_ENVELOPE", message: "Control result details must be an object." };
  }
  const details = cloneBoundedJsonValue(payload.details, { nodes: 0, properties: 0, seen: new WeakSet() }, 0);
  if (!isBoundedJsonObject(details)) {
    return { kind: "invalid", code: "PAYLOAD_TOO_LARGE", message: "Control result details exceed structural limits." };
  }
  if (Buffer.byteLength(JSON.stringify(details), "utf8") > MAX_CONTROL_RESULT_DETAILS_UTF8_BYTES) {
    return { kind: "invalid", code: "PAYLOAD_TOO_LARGE", message: "Control result details exceed the 16 KiB limit." };
  }

  let error: ControlResultPayloadV1["error"];
  if (status === "error") {
    const candidate = ownDataRecord(payload.error);
    if (
      !candidate
      || !hasExactKeys(candidate, ["code", "message", "retryable"])
      || typeof candidate.code !== "string"
      || typeof candidate.message !== "string"
      || typeof candidate.retryable !== "boolean"
    ) {
      return { kind: "invalid", code: "INVALID_ENVELOPE", message: "An error result requires a closed error object." };
    }
    error = { code: candidate.code, message: candidate.message, retryable: candidate.retryable };
  } else if (payload.error !== undefined) {
    return { kind: "invalid", code: "INVALID_ENVELOPE", message: "An ok result cannot include an error object." };
  }

  const normalized: ControlResultPayloadV1 = {
    protocol: "mecha.control/v1",
    result_id: resultId,
    request_id: requestId,
    target_session_epoch: targetSessionEpoch,
    runtime_generation: runtimeGeneration,
    manifest_sha256: manifestSha256,
    status,
    content,
    details,
    ...(error === undefined ? {} : { error }),
  };
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > MAX_CONTROL_RESULT_ENVELOPE_UTF8_BYTES) {
    return { kind: "invalid", code: "PAYLOAD_TOO_LARGE", message: "Control result exceeds the 64 KiB envelope limit." };
  }
  return { kind: "valid", payload: normalized };
}

function canonicalControlJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (isUnknownArray(value)) return `[${value.map(canonicalControlJson).join(",")}]`;
  const record = ownDataRecord(value);
  if (!record) throw new Error("Validated control payload stopped being plain JSON.");
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalControlJson(record[key])}`).join(",")}}`;
}

function controlResultRejected(
  code: ControlResultAppendErrorCodeV1,
  message: string,
  retryable: boolean,
): ControlResultAppendOutcomeV1 {
  return { kind: "rejected", error: { code, message, retryable } };
}

function nestedValues(value: unknown): readonly unknown[] {
  if (isUnknownArray(value)) return value;
  if (isObjectRecord(value)) return Object.values(value);
  return [];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of nestedValues(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function countSnapshotNodes(value: unknown): number {
  if (value === null || typeof value !== "object") return 1;
  return 1 + nestedValues(value).reduce<number>((count, nested) => count + countSnapshotNodes(nested), 0);
}

function containsOversizedSourceString(value: unknown): boolean {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8") > MAX_V2_STRING_UTF8_BYTES;
  if (value === null || typeof value !== "object") return false;
  return nestedValues(value).some((nested) => containsOversizedSourceString(nested));
}

function isBoundedLifecycleV2Payload(value: unknown): boolean {
  return !containsOversizedSourceString(value)
    && countSnapshotNodes(value) <= MAX_SNAPSHOT_NODES
    && Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_SNAPSHOT_UTF8_BYTES;
}

function mutableFields(row: SourceChildV2): LifecycleV2MutableFields {
  return {
    description: row.description,
    model: row.model === null ? null : { ...row.model },
    lifecycle_state: row.lifecycle_state,
    started_at: row.started_at,
    finished_at: row.finished_at,
    duration_ms: row.duration_ms,
    compaction: { ...row.compaction },
  };
}

function changedMutableFields(
  previous: LifecycleV2MutableFields,
  current: LifecycleV2MutableFields,
): SubagentLifecycleDeltaV2["changes"] {
  const changes: SubagentLifecycleDeltaV2["changes"] = {};
  if (previous.description !== current.description) changes.description = current.description;
  if (JSON.stringify(previous.model) !== JSON.stringify(current.model)) changes.model = current.model;
  if (previous.lifecycle_state !== current.lifecycle_state) changes.lifecycle_state = current.lifecycle_state;
  if (previous.started_at !== current.started_at) changes.started_at = current.started_at;
  if (previous.finished_at !== current.finished_at) changes.finished_at = current.finished_at;
  if (previous.duration_ms !== current.duration_ms) changes.duration_ms = current.duration_ms;
  if (JSON.stringify(previous.compaction) !== JSON.stringify(current.compaction)) changes.compaction = { ...current.compaction };
  return changes;
}

function sourceStateOrder(row: SourceChildV2): number {
  if (row.lifecycle_state === "queued") return 0;
  if (row.lifecycle_state === "running") return 1;
  return 2;
}

function compareSourceChildren(left: SourceChildV2, right: SourceChildV2): number {
  return sourceStateOrder(left) - sourceStateOrder(right)
    || right.started_at.localeCompare(left.started_at)
    || left.task_id.localeCompare(right.task_id)
    || left.run_id.localeCompare(right.run_id);
}

function isNonEmptyBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= MAX_V2_STRING_UTF8_BYTES;
}

function truncateSourceString(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= MAX_V2_STRING_UTF8_BYTES) return value;
  return `${Buffer.from(value, "utf8").subarray(0, MAX_V2_STRING_UTF8_BYTES - 3).toString("utf8")}...`;
}

function createContextRefV1(): ContextRefV1 {
  const candidate = `ctx1_${randomBytes(32).toString("base64url")}`;
  if (!CONTEXT_REF_V1_PATTERN.test(candidate)) throw new Error("Unable to create a valid lifecycle context reference.");
  // The regex check narrows this freshly generated opaque token to ContextRefV1.
  return candidate as ContextRefV1;
}

/**
 * Session-retention windows (minutes). `SettingsManager` satisfies this
 * structurally; a live getter (`getRetentionPolicy`) lets the sweep read the
 * current values without a construction-time settings dependency.
 */
export interface RetentionPolicy {
  readonly consumedSessionRetentionMinutes: number;
  readonly unconsumedSessionRetentionMinutes: number;
}

const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  consumedSessionRetentionMinutes: 10,
  unconsumedSessionRetentionMinutes: 720,
};

/**
 * Only what the retention rule reads. Narrower than `Subagent` so the rule
 * stays a plain function over four facts, testable without spawning an agent.
 */
export interface RetentionCandidate {
  consumed: boolean;
  completedAt: number | undefined;
  consumedAt: number | undefined;
  pendingQuestion: string | undefined;
}

/** When a terminal record's session-release window opened, and how long it runs. */
export interface RetentionWindow {
  referenceAt: number;
  windowMinutes: number;
}

/**
 * Pick the retention window for one terminal record.
 *
 * A collected outcome releases on the short window, measured from the later of
 * completion and collection, so a late read still gets a full resume window; an
 * uncollected one holds until the long safety cap.
 *
 * A record carrying an unanswered question is not collected, whatever
 * `consumed` says: the parent has read the question but has not answered it,
 * and the answer is delivered by resuming the very session the short window
 * would release.
 */
export function resolveRetentionWindow(
  record: RetentionCandidate,
  policy: RetentionPolicy,
): RetentionWindow {
  if (record.consumed && record.pendingQuestion === undefined) {
    return {
      referenceAt: Math.max(record.completedAt ?? 0, record.consumedAt ?? 0),
      windowMinutes: policy.consumedSessionRetentionMinutes,
    };
  }
  return {
    referenceAt: record.completedAt ?? 0,
    windowMinutes: policy.unconsumedSessionRetentionMinutes,
  };
}

/** Observer interface for agent lifecycle notifications. */
export interface SubagentManagerObserver {
  onSubagentStarted(record: Subagent): void;
  onSubagentCompleted(record: Subagent): void;
  /** Fires when a resumed run reaches a terminal state (distinct from a fresh completion). */
  onSubagentResumed(record: Subagent): void;
  /**
   * Fires when a running child sends its parent a mid-run message.
   * Optional: the widget has no use for it, and a hook nobody supplies is a
   * vacant one.
   */
  onSubagentUpdate?(record: Subagent, message: string): void;
  /**
   * Fires when a teardown after the record's result was delivered reported
   * where its work went.
   * Optional for the same reason as `onSubagentUpdate`: the widget has no use
   * for it, and a hook nobody supplies is a vacant one.
   */
  onSubagentWorkspaceNotice?(record: Subagent, notice: string): void;
  onSubagentCompacted(record: Subagent, info: CompactionInfo): void;
  /** Fires synchronously after a background agent record is created (before run). */
  onSubagentCreated(record: Subagent): void;
}

export interface SubagentManagerOptions {
  /** Assembly factory that produces a born-complete SubagentSession per spawn. */
  createSubagentSession: (params: CreateSubagentSessionParams) => Promise<SubagentSession>;
  /** Concurrency limiter — schedules background run thunks FIFO against the limit. */
  limiter: ConcurrencyLimiter;
  /** Base working directory handed to a workspace provider (the parent cwd). */
  baseCwd: string;
  getRunConfig?: () => RunConfig;
  /** Live accessor for the session-retention windows; defaults applied when absent. */
  getRetentionPolicy?: () => RetentionPolicy;
  observer?: SubagentManagerObserver;
  /** Agent registry, consulted to canonicalize a spawn's type and resolve its config. */
  registry: SpawnTypeResolver;
}

export interface AgentSpawnConfig {
  description: string;
  model?: Model<any>;
  maxTurns?: number;
  inheritContext?: boolean;
  thinkingLevel?: ThinkingLevel;
  /**
   * Whether this door has committed to a background mode or is offering a
   * default the agent's frontmatter may override. Required so a new front door
   * cannot silently inherit another's policy.
   */
  background: BackgroundRequest;
  /**
   * Skip the maxConcurrent queue check for this spawn - start immediately even
   * if the configured concurrency limit would otherwise queue it. Useful for
   * callers (e.g. cross-extension RPC) that must not be deferred by the queue.
   */
  bypassQueue?: boolean;
  /** Parent abort signal - when aborted, the subagent is also stopped. */
  signal?: AbortSignal;
  /** Per-subagent lifecycle observer — replaces onSessionCreated callback. */
  observer?: SubagentLifecycleObserver;
  /** Parent session identity - grouped fields that travel together from the tool boundary. */
  parentSession?: ParentSessionInfo;
}

export class SubagentManager {
  private agents = new Map<string, Subagent>();
  private sweepInterval: ReturnType<typeof setInterval>;
  private readonly observer?: SubagentManagerObserver;
  private readonly createSubagentSession: (params: CreateSubagentSessionParams) => Promise<SubagentSession>;
  private readonly limiter: ConcurrencyLimiter;
  private readonly baseCwd: string;
  private getRunConfig?: () => RunConfig;
  private getRetentionPolicy?: () => RetentionPolicy;
  private readonly registry: SpawnTypeResolver;
  private readonly lifecycleV2States = new Map<string, LifecycleV2RecordState>();
  private readonly lifecycleV2Listeners = new Set<LifecycleV2Listener>();
  private readonly lifecycleV2SequenceByOwner = new Map<string, number>();
  private readonly lifecycleV2SnapshotIds = new Map<string, string>();
  private readonly controlContexts = new Map<ContextRefV1, ControlContextBindingV1>();
  private readonly controlContextByTaskId = new Map<string, ContextRefV1>();
  private _disposed = false;
  private _workspaceProvider?: WorkspaceProvider;

  /** The registered workspace provider, or undefined when none is registered. */
  get workspaceProvider(): WorkspaceProvider | undefined {
    return this._workspaceProvider;
  }

  constructor(options: SubagentManagerOptions) {
    this.createSubagentSession = options.createSubagentSession;
    this.limiter = options.limiter;
    this.baseCwd = options.baseCwd;
    this.observer = options.observer;
    this.getRunConfig = options.getRunConfig;
    this.getRetentionPolicy = options.getRetentionPolicy;
    this.registry = options.registry;
    // Periodically release the heavy session of terminal agents past their
    // retention window. The lightweight record (with its result) is kept for the
    // session lifetime, so get_subagent_result never misses in-session.
    this.sweepInterval = setInterval(() => this.sweep(), 60_000);
    this.sweepInterval.unref();
  }

  /**
   * Register the single workspace provider. Throws if one is already
   * registered (chaining is out of scope — see ADR 0002). Returns a disposer
   * that clears the slot only if this provider is still the active one.
   */
  registerWorkspaceProvider(provider: WorkspaceProvider): () => void {
    if (this._workspaceProvider) {
      throw new Error(
        "A WorkspaceProvider is already registered; only one is supported.",
      );
    }
    this._workspaceProvider = provider;
    return () => {
      if (this._workspaceProvider === provider) this._workspaceProvider = undefined;
    };
  }

  /** Subscribe to manager-local source deltas. Reads never invoke these listeners. */
  subscribeLifecycleV2(listener: LifecycleV2Listener): () => void {
    this.lifecycleV2Listeners.add(listener);
    return () => this.lifecycleV2Listeners.delete(listener);
  }

  /**
   * Return a frozen, bounded service snapshot for one parent session.
   * The opaque `context_ref` is intentionally service-only and is not a router field.
   */
  getLifecycleSnapshotV2(ownerSessionId: string): LifecycleSnapshotV2ServiceResult {
    if (!isNonEmptyBoundedString(ownerSessionId)) {
      throw new Error("Lifecycle V2 owner session ID must be a bounded non-empty string.");
    }
    const sequence = this.lifecycleV2SequenceByOwner.get(ownerSessionId) ?? 0;
    const envelope = {
      protocol: "mecha.children/v1" as const,
      snapshot_id: this.lifecycleSnapshotId(ownerSessionId),
      owner_session_id: ownerSessionId,
      sequence,
    };
    const candidates = Array.from(this.agents.values())
      .filter((agent) => agent.lifecycleOwnerSessionId === ownerSessionId)
      .map((agent) => this.projectLifecycleV2Row(agent))
      .filter((row): row is LifecycleSnapshotV2ServiceRow => row !== undefined)
      .sort(compareSourceChildren);
    const runs: LifecycleSnapshotV2ServiceRow[] = [];
    for (const candidate of candidates) {
      if (runs.length === MAX_SOURCE_CHILDREN_PER_SNAPSHOT) break;
      const candidateSnapshot: LifecycleSnapshotV2ServiceResult = { ...envelope, runs: [...runs, candidate] };
      if (!isBoundedLifecycleV2Payload(candidateSnapshot)) break;
      runs.push(candidate);
    }
    return deepFreeze({ ...envelope, runs });
  }

  /** Deliver an idempotent closed control result to one live child context. */
  async appendControlResultV1(
    contextRef: ContextRefV1,
    payload: ControlResultPayloadV1,
  ): Promise<ControlResultAppendOutcomeV1> {
    if (typeof contextRef !== "string" || !CONTEXT_REF_V1_PATTERN.test(contextRef)) {
      return controlResultRejected("INVALID_ENVELOPE", "Control context reference is invalid.", false);
    }
    const validated = validateControlResultPayload(payload);
    if (validated.kind === "invalid") return controlResultRejected(validated.code, validated.message, false);
    const binding = this.controlContexts.get(contextRef);
    if (!binding) {
      return controlResultRejected("STALE_CHILD_CONTEXT", "Child context is no longer live.", false);
    }
    const record = this.agents.get(binding.taskId);
    if (
      !record?.isRunning()
      || this.controlContextByTaskId.get(binding.taskId) !== contextRef
      || record.lifecycleOwnerSessionId !== binding.ownerSessionId
      || record.lifecycleParentEntryId !== binding.parentEntryId
      || record.subagentSession !== binding.childSession
      || record.getLifecycleRunV2().run_id !== binding.runId
    ) {
      this.invalidateControlContext(contextRef);
      return controlResultRejected("STALE_CHILD_CONTEXT", "Child context is no longer live.", false);
    }

    const resultId = validated.payload.result_id;
    const fingerprint = canonicalControlJson(validated.payload);
    const persisted = binding.childSession.findControlResultById(resultId);
    if (persisted !== undefined) {
      return canonicalControlJson(persisted) === fingerprint
        ? { kind: "already_present", result_id: resultId }
        : controlResultRejected("CONFLICT", "Result ID is already bound to a different payload.", false);
    }
    const inFlight = binding.inFlightResults.get(resultId);
    if (inFlight !== undefined) {
      return inFlight === fingerprint
        ? { kind: "already_present", result_id: resultId }
        : controlResultRejected("CONFLICT", "Result ID is already being delivered with a different payload.", false);
    }
    if (binding.inFlightResults.size >= MAX_CONTROL_RESULT_IN_FLIGHT) {
      return controlResultRejected("RESULT_DELIVERY_FAILED", "Too many control results are waiting for child persistence.", true);
    }

    binding.inFlightResults.set(resultId, fingerprint);
    try {
      await binding.childSession.appendControlResult(validated.payload);
      const afterAppend = binding.childSession.findControlResultById(resultId);
      if (afterAppend !== undefined) binding.inFlightResults.delete(resultId);
      return { kind: "accepted", result_id: resultId };
    } catch (error) {
      binding.inFlightResults.delete(resultId);
      debugLog("append control result", error);
      return controlResultRejected("RESULT_DELIVERY_FAILED", "Child control-result delivery failed.", true);
    }
  }

  /** Compose a per-agent lifecycle observer from manager and spawn-config concerns. */
  private buildObserver(options: AgentSpawnConfig): SubagentLifecycleObserver {
    return {
      onStarted: (agent) => {
        this.noteLifecycleV2Mutation(agent);
        this.observer?.onSubagentStarted(agent);
      },
      onSessionCreated: (agent) => {
        try {
          options.observer?.onSessionCreated?.(agent);
        } finally {
          this.createControlContext(agent);
          this.noteLifecycleV2Mutation(agent);
        }
      },
      // Terminal transitions are reported for every agent. Whether the parent
      // needs telling is the notification layer's decision, made from the
      // carrier claim; suppressing the observer here would also suppress the
      // lifecycle event and the session-history record, which are facts about
      // the run rather than announcements.
      onRunFinished: (agent) => {
        this.invalidateControlContextForTask(agent.id);
        this.noteLifecycleV2Mutation(agent);
        try { this.observer?.onSubagentCompleted(agent); } catch (err) { debugLog("onSubagentCompleted observer", err); }
      },
      onResumeStarted: (agent) => {
        this.invalidateControlContextForTask(agent.id);
        this.createControlContext(agent);
        this.noteLifecycleV2Mutation(agent);
      },
      onResumeFinished: (agent) => {
        this.invalidateControlContextForTask(agent.id);
        this.noteLifecycleV2Mutation(agent);
        try { this.observer?.onSubagentResumed(agent); } catch (err) { debugLog("onSubagentResumed observer", err); }
      },
      onUpdateSent: (agent, message) => {
        this.observer?.onSubagentUpdate?.(agent, message);
      },
      onWorkspaceNotice: (agent, notice) => {
        this.observer?.onSubagentWorkspaceNotice?.(agent, notice);
      },
      onCompactionTransition: (agent) => this.noteLifecycleV2Mutation(agent),
      onCompacted: (agent, info) => {
        this.observer?.onSubagentCompacted(agent, info);
      },
    };
  }

  /** Build a source child from current record state without exposing live session objects. */
  private projectSourceChildV2(agent: Subagent, sequence: number): SourceChildV2 | undefined {
    const ownerSessionId = agent.lifecycleOwnerSessionId;
    const parentEntryId = agent.lifecycleParentEntryId;
    if (!isNonEmptyBoundedString(ownerSessionId) || !isNonEmptyBoundedString(parentEntryId)) return undefined;
    const run = agent.getLifecycleRunV2();
    return {
      task_id: agent.id,
      run_id: run.run_id,
      parent_entry_id: parentEntryId,
      description: truncateSourceString(agent.description),
      lifecycle_state: agent.status,
      sequence,
      model: run.model === null ? null : {
        provider: truncateSourceString(run.model.provider),
        id: truncateSourceString(run.model.id),
        name: truncateSourceString(run.model.name),
      },
      started_at: run.started_at,
      finished_at: run.finished_at,
      duration_ms: run.duration_ms,
      compaction: { ...run.compaction },
    };
  }

  /** Compose the service-only row with its opaque live context reference. */
  private projectLifecycleV2Row(agent: Subagent): LifecycleSnapshotV2ServiceRow | undefined {
    const state = this.lifecycleV2States.get(agent.id);
    const source = this.projectSourceChildV2(agent, state?.sequence ?? 0);
    if (!state || state.runId !== source?.run_id) return undefined;
    return {
      ...source,
      context_ref: this.controlContextByTaskId.get(agent.id) ?? null,
    };
  }

  /** Publish a manager-local mutation only when its source row materially changed. */
  private noteLifecycleV2Mutation(agent: Subagent): void {
    if (this._disposed) return;
    const ownerSessionId = agent.lifecycleOwnerSessionId;
    if (!isNonEmptyBoundedString(ownerSessionId)) return;
    const previous = this.lifecycleV2States.get(agent.id);
    const source = this.projectSourceChildV2(agent, previous?.sequence ?? 0);
    if (!source) return;
    const fields = mutableFields(source);
    const isNewRun = previous?.runId !== source.run_id;
    const changes = isNewRun
      ? fields
      : changedMutableFields(previous.fields, fields);
    if (!isNewRun && Object.keys(changes).length === 0) return;

    const sequence = this.nextLifecycleV2Sequence(ownerSessionId);
    const current: SourceChildV2 = { ...source, sequence };
    this.lifecycleV2States.set(agent.id, {
      runId: current.run_id,
      sequence,
      fields,
    });

    const contextRef = this.controlContextByTaskId.get(agent.id) ?? null;
    const row: LifecycleSnapshotV2ServiceRow = { ...current, context_ref: contextRef };
    const delta: SubagentLifecycleDeltaV2 = {
      protocol: "mecha.children/v1",
      owner_session_id: ownerSessionId,
      sequence,
      task_id: current.task_id,
      run_id: current.run_id,
      parent_entry_id: current.parent_entry_id,
      context_ref: contextRef,
      changes,
    };
    if (!isBoundedLifecycleV2Payload({ row, delta })) {
      debugLog("lifecycle V2 manager mutation", "Dropped a source row that exceeded V2 bounds.");
      return;
    }
    const frozenRow = deepFreeze(row);
    const frozenDelta = deepFreeze(delta);
    for (const listener of this.lifecycleV2Listeners) {
      try {
        listener(frozenRow, frozenDelta);
      } catch (error) {
        debugLog("lifecycle V2 listener", error);
      }
    }
  }

  private nextLifecycleV2Sequence(ownerSessionId: string): number {
    const sequence = (this.lifecycleV2SequenceByOwner.get(ownerSessionId) ?? 0) + 1;
    this.lifecycleV2SequenceByOwner.set(ownerSessionId, sequence);
    return sequence;
  }

  private lifecycleSnapshotId(ownerSessionId: string): string {
    let snapshotId = this.lifecycleV2SnapshotIds.get(ownerSessionId);
    if (!snapshotId) {
      snapshotId = `snapshot1_${randomUUID()}`;
      this.lifecycleV2SnapshotIds.set(ownerSessionId, snapshotId);
    }
    return snapshotId;
  }

  /** Bind an active child session to an opaque control context for its current execution only. */
  private createControlContext(agent: Subagent): void {
    if (this._disposed || !agent.isRunning() || !agent.subagentSession) return;
    const ownerSessionId = agent.lifecycleOwnerSessionId;
    const parentEntryId = agent.lifecycleParentEntryId;
    if (!isNonEmptyBoundedString(ownerSessionId) || !isNonEmptyBoundedString(parentEntryId)) return;
    this.invalidateControlContextForTask(agent.id);
    const contextRef = createContextRefV1();
    const childSession = agent.subagentSession;
    const binding: ControlContextBindingV1 = {
      contextRef,
      ownerSessionId,
      parentEntryId,
      taskId: agent.id,
      runId: agent.getLifecycleRunV2().run_id,
      childSession,
      inFlightResults: new Map(),
      stopObservingPersistedResults: () => undefined,
    };
    binding.stopObservingPersistedResults = childSession.subscribe((event) => {
      if (event.type !== "message_end") return;
      // Pi 0.84.4 persists before this event for direct custom messages. Queue
      // the confirmation anyway so a deferred stream flush cannot race history.
      queueMicrotask(() => this.clearPersistedControlResultClaims(contextRef));
    });
    this.controlContexts.set(contextRef, binding);
    this.controlContextByTaskId.set(agent.id, contextRef);
  }

  private clearPersistedControlResultClaims(contextRef: ContextRefV1): void {
    const binding = this.controlContexts.get(contextRef);
    if (!binding) return;
    for (const resultId of binding.inFlightResults.keys()) {
      if (binding.childSession.findControlResultById(resultId) !== undefined) {
        binding.inFlightResults.delete(resultId);
      }
    }
  }

  private invalidateControlContextForTask(taskId: string): void {
    const contextRef = this.controlContextByTaskId.get(taskId);
    if (contextRef) this.invalidateControlContext(contextRef);
  }

  private invalidateControlContext(contextRef: ContextRefV1): void {
    const binding = this.controlContexts.get(contextRef);
    if (!binding) return;
    this.controlContexts.delete(contextRef);
    if (this.controlContextByTaskId.get(binding.taskId) === contextRef) {
      this.controlContextByTaskId.delete(binding.taskId);
    }
    binding.stopObservingPersistedResults();
  }

  /**
   * Spawn an agent and return its ID immediately (for background use).
   * If the concurrency limit is reached, the agent is queued.
   *
   * Throws when the named agent type is disabled.
   */
  spawn(
    snapshot: ParentSnapshot,
    type: SubagentType,
    prompt: string,
    options: AgentSpawnConfig,
  ): string {
    return this.create(snapshot, this.resolveSpawn(type, options.background), prompt, options);
  }

  /**
   * Spawn an agent and wait for completion (foreground use).
   * Foreground agents bypass the concurrency queue.
   *
   * The caller holds the result, which is a delivery commitment: the agent must
   * not be queued and must not be announced, whatever its frontmatter declares.
   *
   * Rejects when the named agent type is disabled.
   */
  async spawnAndWait(
    snapshot: ParentSnapshot,
    type: SubagentType,
    prompt: string,
    options: Omit<AgentSpawnConfig, "background">,
  ): Promise<Subagent> {
    const foreground: BackgroundRequest = { kind: "explicit", isBackground: false };
    const id = this.create(snapshot, this.resolveSpawn(type, foreground), prompt, {
      ...options,
      background: foreground,
    });
    const record = this.agents.get(id)!;
    // The caller holds the result, so this call is the carrier: claim the outcome
    // before awaiting it, so nothing announces what is already being delivered.
    record.claim();
    await record.promise;
    return record;
  }

  /**
   * Stamp the invariants every front door shares: a canonical agent type, a
   * rejection for a disabled one, and the effective background mode.
   */
  private resolveSpawn(type: string, background: BackgroundRequest): ResolvedSpawn {
    const canonical = this.registry.resolveType(type);
    if (canonical !== undefined && !this.registry.isValidType(canonical)) {
      throw new Error(`Agent type "${canonical}" is disabled`);
    }
    const resolvedType = canonical ?? "general-purpose";
    const agentConfig = this.registry.resolveAgentConfig(resolvedType);
    return { type: resolvedType, isBackground: resolveBackgroundMode(agentConfig, background) };
  }

  /** Create, register, and start (or queue) a record for an already-resolved spawn. */
  private create(
    snapshot: ParentSnapshot,
    resolved: ResolvedSpawn,
    prompt: string,
    options: AgentSpawnConfig,
  ): string {
    const { type, isBackground } = resolved;
    const id = randomUUID().slice(0, 17);
    const record = new Subagent({
      id,
      type,
      description: options.description,
      isBackground,
      state: new SubagentState({
        status: isBackground ? "queued" : "running",
        startedAt: Date.now(),
      }),
      execution: {
        createSubagentSession: this.createSubagentSession,
        snapshot,
        prompt,
        baseCwd: this.baseCwd,
        observer: this.buildObserver(options),
        getRunConfig: this.getRunConfig,
        getWorkspaceProvider: () => this._workspaceProvider,
        model: options.model,
        maxTurns: options.maxTurns,
        thinkingLevel: options.thinkingLevel,
        parentSession: options.parentSession,
        signal: options.signal,
      },
    });
    this.agents.set(id, record);
    this.noteLifecycleV2Mutation(record);

    if (isBackground) {
      this.observer?.onSubagentCreated(record);
    }

    if (isBackground && !options.bypassQueue) {
      // Schedule on the limiter — scheduleVia captures the limiter promise
      // eagerly, so a queued agent is awaitable from spawn; guardedRun guards
      // against abort-while-queued when the slot frees.
      record.scheduleVia((thunk) => this.limiter.schedule(thunk));
      return id;
    }

    record.start();
    return id;
  }

  /**
   * Resume an existing agent session with a new prompt.
   * Delegates to Subagent.resume(), which owns the observer subscription lifecycle.
   */
  async resume(
    id: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<Subagent | undefined> {
    const agent = this.agents.get(id);
    if (!agent?.isSessionReady()) return undefined;
    await agent.resume(prompt, signal);
    return agent;
  }

  getRecord(id: string): Subagent | undefined {
    return this.agents.get(id);
  }

  listAgents(): Subagent[] {
    return [...this.agents.values()].sort(
      (a, b) => b.startedAt - a.startedAt,
    );
  }

  abort(id: string): boolean {
    const record = this.agents.get(id);
    if (!record) return false;

    // A queued agent has not started; stop it through the same terminal funnel
    // a running agent's stop uses. Its scheduled thunk becomes a no-op (status
    // guard) when its slot finally opens.
    if (record.status === "queued") {
      record.stopQueued();
      this.noteLifecycleV2Mutation(record);
      return true;
    }

    const aborted = record.abort();
    if (aborted) this.noteLifecycleV2Mutation(record);
    return aborted;
  }

  /**
   * Remove a record from the map and tear its session down.
   * The map is updated first so the record is unreachable while its child's
   * extensions shut down.
   */
  private removeRecord(id: string, record: Subagent): Promise<void> {
    this.invalidateControlContextForTask(id);
    this.lifecycleV2States.delete(id);
    this.agents.delete(id);
    return record.disposeSession();
  }

  /**
   * Release the heavy session of any terminal agent past its retention window.
   * The record (with its result) is retained for the session lifetime; only the
   * live `AgentSession` is freed. `resolveRetentionWindow` owns which window
   * applies.
   */
  private sweep() {
    const policy = this.getRetentionPolicy?.() ?? DEFAULT_RETENTION_POLICY;
    const now = Date.now();
    for (const record of this.agents.values()) {
      if (record.isActive()) continue;
      if (!record.isSessionReady()) continue; // already released, or never had a session
      const { referenceAt, windowMinutes } = resolveRetentionWindow(record, policy);
      // Fire-and-forget: the sweep runs on an interval with no one to await it,
      // and Subagent.releaseSession() already swallows a failing teardown.
      if (now - referenceAt >= windowMinutes * 60_000) void record.releaseSession();
    }
  }

  /**
   * Remove all completed/stopped/errored records immediately.
   * Called on session start/switch so tasks from a prior session don't persist.
   */
  async clearCompleted(): Promise<void> {
    const teardowns: Promise<void>[] = [];
    for (const [id, record] of this.agents) {
      if (record.isActive()) continue;
      teardowns.push(this.removeRecord(id, record));
    }
    await Promise.all(teardowns);
  }

  /** Whether any agents are still running or queued. */
  // fallow-ignore-next-line unused-class-member
  hasRunning(): boolean {
    return [...this.agents.values()].some(r => r.isActive());
  }

  /** Abort all running and queued agents immediately. */
  abortAll(): number {
    let count = 0;
    for (const record of this.agents.values()) {
      if (record.status === "queued") {
        record.stopQueued();
        this.noteLifecycleV2Mutation(record);
        count++;
      } else if (record.abort()) {
        this.noteLifecycleV2Mutation(record);
        count++;
      }
    }
    // Drop pending thunks (their promises resolve).
    this.limiter.clear();
    return count;
  }

  /** Wait for all running and queued agents to complete (including queued ones). */
  // fallow-ignore-next-line unused-class-member
  async waitForAll(): Promise<void> {
    // Every spawned agent has a settled-on-completion promise (the limiter starts
    // queued ones as slots free), so a single allSettled covers the queued case.
    // The loop only catches agents spawned during the wait.
    let pending = this.pendingPromises();
    while (pending.length > 0) {
      await Promise.allSettled(pending);
      pending = this.pendingPromises();
    }
  }

  /** Promises of all running/queued agents that have one. */
  private pendingPromises(): Promise<void>[] {
    return [...this.agents.values()]
      .filter(r => r.isActive())
      .map(r => r.promise)
      .filter((p): p is Promise<void> => p != null);
  }

  /**
   * Tear down every record, resolving once each child's extensions have shut
   * down. The registry is emptied before the teardowns are awaited, so nothing
   * can reach a dying record; `allSettled` keeps one failing child from
   * abandoning its siblings.
   */
  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    clearInterval(this.sweepInterval);
    // Drop pending thunks
    this.limiter.clear();
    for (const record of this.agents.values()) this.invalidateControlContextForTask(record.id);
    const teardowns = [...this.agents.values()].map(record => record.disposeSession());
    this.agents.clear();
    this.lifecycleV2States.clear();
    this.lifecycleV2Listeners.clear();
    this.lifecycleV2SequenceByOwner.clear();
    this.lifecycleV2SnapshotIds.clear();
    await Promise.allSettled(teardowns);
  }
}
