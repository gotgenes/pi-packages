/**
 * subagent-manager.ts - Tracks subagents, background execution, resume support.
 *
 * Background agents are subject to a configurable concurrency limit (default: 4).
 * Excess agents are scheduled on a ConcurrencyLimiter and auto-started as running
 * agents complete. Foreground agents bypass the limiter (they block the parent anyway).
 */

import { randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import { debugLog } from "#src/debug";
import type { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import {
  LifecycleInterceptorRegistry,
  type SubagentExecutionAdmission,
  type SubagentExecutionOrigin,
  type SubagentLifecycleInterceptor,
  type SubagentLifecycleRegistration,
} from "#src/lifecycle/lifecycle-interceptor";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import { Subagent, type SubagentLifecycleObserver } from "#src/lifecycle/subagent";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import { SubagentState, type SubagentStatus } from "#src/lifecycle/subagent-state";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";

import type { RunConfig } from "#src/runtime";
import type { AgentInvocation, CompactionInfo, ParentSessionInfo, SubagentType, ThinkingLevel } from "#src/types";

/**
 * A lightweight snapshot of a subagent evicted by the 10-minute cleanup sweep.
 *
 * The sweep frees the heavy in-memory session (its message history included);
 * this descriptor retains only the fields the session navigator needs to label
 * the agent in the picker, plus the persisted `outputFile` to source its
 * transcript from disk. Carries no messages, so memory stays bounded.
 */
export interface EvictedSubagent {
  readonly id: string;
  readonly type: SubagentType;
  readonly description: string;
  readonly status: SubagentStatus;
  readonly startedAt: number;
  readonly completedAt: number | undefined;
  readonly toolUses: number;
  readonly outputFile: string;
}

/** Observer interface for agent lifecycle notifications. */
export interface SubagentManagerObserver {
  onSubagentStarted(record: Subagent): void;
  onSubagentCompleted(record: Subagent): void;
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
  observer?: SubagentManagerObserver;
}

export interface AgentSpawnConfig {
  description: string;
  model?: Model<any>;
  maxTurns?: number;
  inheritContext?: boolean;
  thinkingLevel?: ThinkingLevel;
  isBackground?: boolean;
  /**
   * Skip the maxConcurrent queue check for this spawn - start immediately even
   * if the configured concurrency limit would otherwise queue it. Useful for
   * callers (e.g. cross-extension RPC) that must not be deferred by the queue.
   */
  bypassQueue?: boolean;
  /** Resolved invocation snapshot captured for UI display. */
  invocation?: AgentInvocation;
  /** Parent abort signal - when aborted, the subagent is also stopped. */
  signal?: AbortSignal;
  /** Per-subagent lifecycle observer — replaces onSessionCreated callback. */
  observer?: SubagentLifecycleObserver;
  /** Parent session identity - grouped fields that travel together from the tool boundary. */
  parentSession?: ParentSessionInfo;
  /** Identity known to a service caller without changing its existing session setup. */
  lifecycleParentSession?: ParentSessionInfo;
  /** Which supported public entry path created this execution. */
  origin?: SubagentExecutionOrigin;
}

export class SubagentManager {
  private agents = new Map<string, Subagent>();
  /** Descriptors of agents removed by the cleanup sweep, keyed by id — navigable from disk. */
  private readonly evicted = new Map<string, EvictedSubagent>();
  private cleanupInterval: ReturnType<typeof setInterval>;
  private readonly observer?: SubagentManagerObserver;
  private readonly createSubagentSession: (params: CreateSubagentSessionParams) => Promise<SubagentSession>;
  private readonly limiter: ConcurrencyLimiter;
  private readonly baseCwd: string;
  private getRunConfig?: () => RunConfig;
  private _workspaceProvider?: WorkspaceProvider;
  private readonly lifecycleInterceptors = new LifecycleInterceptorRegistry();

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
    // Cleanup completed agents after 10 minutes (but keep sessions for resume)
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    this.cleanupInterval.unref();
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

  /** Register a generative lifecycle provider without exposing manager internals. */
  registerLifecycleInterceptor(
    interceptor: SubagentLifecycleInterceptor,
  ): SubagentLifecycleRegistration {
    return this.lifecycleInterceptors.register(interceptor);
  }

  /** Compose a per-agent lifecycle observer from manager and spawn-config concerns. */
  private buildObserver(options: AgentSpawnConfig): SubagentLifecycleObserver {
    return {
      onStarted: (agent) => {
        this.observer?.onSubagentStarted(agent);
      },
      onSessionCreated: options.observer?.onSessionCreated
        ? (agent) => options.observer!.onSessionCreated!(agent)
        : undefined,
      onRunFinished: (agent) => {
        if (options.isBackground) {
          try { this.observer?.onSubagentCompleted(agent); } catch (err) { debugLog("onSubagentCompleted observer", err); }
        }
      },
      onCompacted: (agent, info) => {
        this.observer?.onSubagentCompacted(agent, info);
      },
    };
  }

  /**
   * Spawn an agent and return its ID immediately (for background use).
   * If the concurrency limit is reached, the agent is queued.
   */
  spawn(
    snapshot: ParentSnapshot,
    type: SubagentType,
    prompt: string,
    options: AgentSpawnConfig,
  ): string {
    const id = randomUUID().slice(0, 17);
    const admission: SubagentExecutionAdmission = options.isBackground && !options.bypassQueue && this.limiter.isSaturated()
      ? "queued"
      : "immediate";
    const record = new Subagent({
      id,
      type,
      description: options.description,
      invocation: options.invocation,
      state: new SubagentState({
        status: options.isBackground ? "queued" : "running",
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
        lifecycleParentSession: options.lifecycleParentSession,
        signal: options.signal,
        lifecycleInterceptors: this.lifecycleInterceptors,
        executionPath: {
          phase: "initial",
          origin: options.origin ?? "service",
          mode: options.isBackground ? "background" : "foreground",
          admission,
        },
      },
    });
    this.agents.set(id, record);

    if (options.isBackground) {
      this.observer?.onSubagentCreated(record);
    }

    if (options.isBackground && !options.bypassQueue) {
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
   * Spawn an agent and wait for completion (foreground use).
   * Foreground agents bypass the concurrency queue.
   */
  async spawnAndWait(
    snapshot: ParentSnapshot,
    type: SubagentType,
    prompt: string,
    options: Omit<AgentSpawnConfig, "isBackground">,
  ): Promise<Subagent> {
    const id = this.spawn(snapshot, type, prompt, { ...options, isBackground: false });
    const record = this.agents.get(id)!;
    await record.promise;
    return record;
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

  /** Descriptors of agents evicted by the cleanup sweep, most recent first. */
  listEvicted(): EvictedSubagent[] {
    return [...this.evicted.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  abort(id: string): boolean {
    const record = this.agents.get(id);
    if (!record) return false;

    // A queued agent has not started; mark it stopped. Its scheduled thunk
    // becomes a no-op (status guard) when its slot finally opens.
    if (record.status === "queued") {
      record.markStopped();
      return true;
    }

    return record.abort();
  }

  /** Dispose a record's session and remove it from the map. */
  private removeRecord(id: string, record: Subagent): void {
    record.disposeSession();
    this.agents.delete(id);
  }

  private cleanup() {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [id, record] of this.agents) {
      if (record.status === "running" || record.status === "queued") continue;
      if ((record.completedAt ?? 0) >= cutoff) continue;
      // Retain a navigable descriptor before freeing the heavy session. Only an
      // agent with a persisted file can be sourced from disk after eviction.
      if (record.outputFile) this.evicted.set(id, toEvictedSubagent(record, record.outputFile));
      this.removeRecord(id, record);
    }
  }

  /**
   * Remove all completed/stopped/errored records immediately.
   * Called on session start/switch so tasks from a prior session don't persist.
   */
  clearCompleted(): void {
    for (const [id, record] of this.agents) {
      if (record.status === "running" || record.status === "queued") continue;
      this.removeRecord(id, record);
    }
    // Evicted descriptors belong to the session that swept them — a new session starts empty.
    this.evicted.clear();
  }

  /** Whether any agents are still running or queued. */
  // fallow-ignore-next-line unused-class-member
  hasRunning(): boolean {
    return [...this.agents.values()].some(
      r => r.status === "running" || r.status === "queued",
    );
  }

  /** Abort all running and queued agents immediately. */
  // fallow-ignore-next-line unused-class-member
  abortAll(): number {
    let count = 0;
    for (const record of this.agents.values()) {
      if (record.status === "queued") {
        record.markStopped();
        count++;
      } else if (record.abort()) {
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
      .filter(r => r.status === "running" || r.status === "queued")
      .map(r => r.promise)
      .filter((p): p is Promise<void> => p != null);
  }

  dispose() {
    clearInterval(this.cleanupInterval);
    // Lifecycle callbacks observe the shutdown signal before their registration
    // disposer runs. Existing no-provider teardown stays synchronous.
    void this.lifecycleInterceptors.dispose();
    // Drop pending thunks
    this.limiter.clear();
    for (const record of this.agents.values()) {
      record.disposeSession();
    }
    this.agents.clear();
    this.evicted.clear();
  }
}

/** Capture an evicted agent's navigable fields from its record. */
function toEvictedSubagent(record: Subagent, outputFile: string): EvictedSubagent {
  return {
    id: record.id,
    type: record.type,
    description: record.description,
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    toolUses: record.toolUses,
    outputFile,
  };
}
