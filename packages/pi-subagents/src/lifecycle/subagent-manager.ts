/**
 * subagent-manager.ts - Tracks subagents, background execution, resume support.
 *
 * Background runs, spawned or resumed, are subject to a configurable concurrency
 * limit (default: 4). Excess runs are scheduled on a ConcurrencyLimiter and
 * auto-started as running ones complete. Foreground runs bypass the limiter:
 * the subagent tool runs one assistant message's calls one at a time, so the
 * parent holds at most one foreground run per message. The manager itself does
 * not bound concurrent spawnAndWait callers.
 */

import { randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import { type BackgroundRequest, resolveBackgroundMode } from "#src/config/invocation-config";
import { debugLog } from "#src/debug";
import type { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import {
  type ResumeRefusal,
  type ResumeRunOptions,
  type RunScheduler,
  Subagent,
  type SubagentLifecycleObserver,
} from "#src/lifecycle/subagent";
import type { RunKind, RunOutcome, RunOutcomeInit } from "#src/lifecycle/subagent-run";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import { isActiveStatus, SubagentState } from "#src/lifecycle/subagent-state";
import type { TurnBudget } from "#src/lifecycle/turn-limits";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import {
  type ChildRestoreRecord,
  type PersistedRunSummary,
  type RestorableRun,
  readRestorableRun,
  type SessionEntryLike,
} from "#src/persisted-record";
import type { RunConfig } from "#src/runtime";
import type { ChildTranscriptHeader } from "#src/session/transcript-header";
import type { AgentConfig, CompactionInfo, ParentSessionInfo, SubagentType, ThinkingLevel } from "#src/types";

/**
 * The agent-registry slice the manager needs to resolve a spawn. Deliberately
 * narrower than AgentConfigLookup, whose slice serves session assembly (ISP).
 */
export interface SpawnTypeResolver {
  resolveType(name: string): string | undefined;
  isValidType(type: string): boolean;
  resolveAgentConfig(type: string): AgentConfig;
  /** Re-read the agent definitions from their source, as a restore does before it decides on a type. */
  reload(): void;
}

/**
 * Why a resume was refused, across every front door.
 *
 * Widens the record's own vocabulary by the refusals that are not facts about a
 * record: an id no record answers to, and a settled child an earlier manager
 * ran whose agent type is no longer defined, or is disabled, so restoring it
 * would run it under a definition it never had.
 */
export type ResumeRefusalReason = ResumeRefusal | "unknown-agent" | "agent-type-unavailable";

/**
 * What a resume attempt produced: the record whose run was restarted, or the
 * reason nothing was started.
 *
 * A resumed run that *failed* is still `resumed` — the record carries the
 * error. `refused` means the turn loop never ran.
 */
export type ResumeOutcome =
  | { kind: "resumed"; record: Subagent }
  | { kind: "refused"; reason: ResumeRefusalReason };

/**
 * What starting a resume produced: the record now running it (or queued for a
 * concurrency slot, which its status says), or the reason nothing was started.
 *
 * The run itself continues on the record; its `promise` settles when the
 * resumed run reaches a terminal state.
 */
export type ResumeStart =
  | { kind: "started"; record: Subagent }
  | { kind: "refused"; reason: ResumeRefusalReason };

/** Per-call knobs for a resume; both doors pass their own. */
export type ResumeCallOptions = ResumeRunOptions;

/** A spawn's resolved identity and mode — the invariants every front door shares. */
interface ResolvedSpawn {
  type: SubagentType;
  isBackground: boolean;
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
  /**
   * Fires when a run starts: the initial run, or a resume from whichever front
   * door asked for it. A consumer that tracks the widget's live set has to learn
   * that a settled record went back to running, and the only alternative is
   * polling.
   */
  onSubagentRunStarted(record: Subagent, kind: RunKind): void;
  /**
   * Fires when a run reaches a terminal state, whatever that state is. Names the
   * run that ended, which a resume may already have replaced.
   */
  onSubagentRunFinished(record: Subagent, run: RunOutcome): void;
  /**
   * Fires when a running child sends its parent a mid-run message.
   * Optional: the widget has no use for it, and a hook nobody supplies is a
   * vacant one.
   */
  onSubagentUpdate?(record: Subagent, run: RunOutcome, message: string): void;
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

/**
 * Where the manager looks for a settled child of the current parent session
 * that it holds no record for: one an earlier manager ran, before a `/reload`
 * or a restart replaced it. Read at the moment of a resume, never cached, so it
 * always answers for whichever parent session is current.
 */
export interface ChildHistory {
  /** The parent session's entries, which hold a `subagents:record` per finished run. */
  entries(): readonly SessionEntryLike[];
  /** The parent as it is now, which a reopened child is assembled against; undefined outside a session. */
  snapshot(): ParentSnapshot | undefined;
  /** The current parent session's identity, which a reopened child reports to lifecycle consumers. */
  parentSession(): ParentSessionInfo;
  /** The session id, spawning parent, and working directory a child transcript records, or undefined when it cannot be read. */
  transcriptHeader(transcript: string): ChildTranscriptHeader | undefined;
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
  /** Where a resume finds a settled child an earlier manager ran; none restores nothing. */
  history?: ChildHistory;
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
  /** Background runs, spawned or resumed, wait for and hold a slot on the limiter. */
  private readonly admitBackground: RunScheduler = (thunk) => this.limiter.schedule(thunk);
  private readonly baseCwd: string;
  private getRunConfig?: () => RunConfig;
  private getRetentionPolicy?: () => RetentionPolicy;
  private readonly registry: SpawnTypeResolver;
  private readonly history?: ChildHistory;
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
    this.history = options.history;
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

  /** Compose a per-agent lifecycle observer from manager and spawn-config concerns. */
  private buildObserver(options: Pick<AgentSpawnConfig, "observer">): SubagentLifecycleObserver {
    return {
      onRunStarted: (agent, kind) => {
        try { this.observer?.onSubagentRunStarted(agent, kind); } catch (err) { debugLog("onSubagentRunStarted observer", err); }
      },
      onSessionCreated: options.observer?.onSessionCreated
        ? (agent) => options.observer!.onSessionCreated!(agent)
        : undefined,
      // Terminal transitions are reported for every agent. Whether the parent
      // needs telling is the notification layer's decision, made from the
      // carrier claim; suppressing the observer here would also suppress the
      // lifecycle event and the session-history record, which are facts about
      // the run rather than announcements.
      onRunFinished: (agent, run) => {
        try { this.observer?.onSubagentRunFinished(agent, run); } catch (err) { debugLog("onSubagentRunFinished observer", err); }
      },
      onUpdateSent: (agent, run, message) => {
        this.observer?.onSubagentUpdate?.(agent, run, message);
      },
      onWorkspaceNotice: (agent, notice) => {
        this.observer?.onSubagentWorkspaceNotice?.(agent, notice);
      },
      onCompacted: (agent, info) => {
        this.observer?.onSubagentCompacted(agent, info);
      },
    };
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
   * Foreground agents bypass the concurrency queue; concurrent callers each start
   * a run at once (the subagent tool serializes its own calls, not this method).
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

    if (isBackground) {
      this.observer?.onSubagentCreated(record);
    }

    if (isBackground && !options.bypassQueue) {
      // Schedule on the limiter — scheduleVia captures the limiter promise
      // eagerly, so a queued agent is awaitable from spawn; guardedRun guards
      // against abort-while-queued when the slot frees.
      record.scheduleVia(this.admitBackground);
      return id;
    }

    record.start();
    return id;
  }

  /**
   * Resume an existing agent session with a new prompt.
   *
   * The refusal policy lives here rather than in a caller, so every front door
   * declines the same resumes for the same reasons; a door owns only how it
   * words the answer. Delegates to Subagent.resume(), which owns the observer
   * subscription lifecycle.
   *
   * Resolves when the resumed run reaches a terminal state, so a background
   * resume's wait spans any time it spends queued for a concurrency slot.
   */
  async resume(id: string, prompt: string, options: ResumeCallOptions): Promise<ResumeOutcome> {
    const start = this.startResume(id, prompt, options);
    if (start.kind === "refused") return start;
    await start.record.promise;
    return { kind: "resumed", record: start.record };
  }

  /**
   * Start a resume without waiting for it, handing back the record now running
   * it, or queued for a concurrency slot when it is a background resume and the
   * limit is reached. Refuses synchronously, for the same reasons `resume` does.
   *
   * A background resume is admitted through the limiter like a background
   * spawn; a foreground one starts at once, like a foreground spawn.
   */
  startResume(id: string, prompt: string, options: ResumeCallOptions): ResumeStart {
    const agent = this.agents.get(id) ?? this.restore(id);
    if (typeof agent === "string") return { kind: "refused", reason: agent };
    const refusal = agent.resumeRefusal;
    if (refusal) return { kind: "refused", reason: refusal };
    // Each resume's caller decides who carries its outcome: the resume's run is
    // born claimed when the caller asks, and unclaimed otherwise, whatever
    // carriers held the runs before it.
    // Published as agent.promise, which always resolves; it rejects only for a
    // missing session, which resumeRefusal has already refused as no-session.
    void agent.resume(
      prompt,
      {
        background: options.background,
        signal: options.signal,
        claimOutcome: options.claimOutcome,
      },
      options.background ? this.admitBackground : undefined,
    );
    return { kind: "started", record: agent };
  }

  /**
   * Rebuild the record of a settled child this manager never ran, from what its
   * parent session recorded, so a resume continues the child's own transcript
   * under its original id. Registered only once it is resumable.
   *
   * The child is restored as the agent type it ran as, held to the turn limit
   * it ran under, with the metrics it had accumulated. One whose type is gone
   * or disabled is refused rather than run under another definition, and one
   * that ran in a provider workspace is not restored: an earlier manager's
   * teardown disposed every workspace it held.
   */
  private restore(id: string): Subagent | ResumeRefusalReason {
    const source = this.findRestorable(id);
    if (typeof source === "string") return source;
    const { run, header, snapshot, parentSession } = source;
    const record = new Subagent({
      id,
      type: source.type,
      description: run.summary.description,
      isBackground: false,
      execution: {
        createSubagentSession: this.createSubagentSession,
        snapshot,
        prompt: "",
        baseCwd: this.baseCwd,
        observer: this.buildObserver({}),
        getRunConfig: this.getRunConfig,
        getWorkspaceProvider: () => this._workspaceProvider,
        maxTurns: restoredMaxTurns(run.turnBudget),
        parentSession,
        transcript: { file: run.outputFile, header, leafId: run.transcriptLeafId },
      },
      state: new SubagentState({
        toolUses: run.summary.toolUses,
        lifetimeUsage: run.lifetimeUsage,
        compactionCount: run.compactionCount,
      }),
      outcome: restoredOutcome(run.summary),
    });
    this.agents.set(id, record);
    return record;
  }

  /**
   * What a restore continues the child `id` from, or why it is refused: an id
   * the current parent session never recorded, or a fork's inherited child, is
   * `unknown-agent`; a run with no transcript that is provably still the
   * child's is `no-session`; then the agent type and the workspace decide.
   */
  private findRestorable(id: string): RestoreSource | ResumeRefusalReason {
    const history = this.history;
    const snapshot = history?.snapshot();
    if (!history || !snapshot) return "unknown-agent";
    const recorded = readRestorableRun(history.entries(), id);
    if (recorded.kind === "unrecorded") return "unknown-agent";
    const parentSession = history.parentSession();
    const transcript = provenTranscript(recorded, history, parentSession.parentSessionId);
    if (typeof transcript === "string") return transcript;
    const type = this.restorableType(transcript.run.summary.type);
    if (type === undefined) return "agent-type-unavailable";
    if (transcript.run.providerWorkspace) return "workspace-disposed";
    return { ...transcript, type, snapshot, parentSession };
  }

  /**
   * The canonical name of an agent type a child may still run as, read afresh
   * from its source, or undefined when it is gone or disabled. Every front door
   * gets the same answer, whether or not anything else reloaded the registry.
   */
  private restorableType(type: string): SubagentType | undefined {
    this.registry.reload();
    const canonical = this.registry.resolveType(type);
    return canonical !== undefined && this.registry.isValidType(canonical) ? canonical : undefined;
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
      return true;
    }

    return record.abort();
  }

  /**
   * Remove a record from the map and tear its session down.
   * The map is updated first so the record is unreachable while its child's
   * extensions shut down.
   */
  private removeRecord(id: string, record: Subagent): Promise<void> {
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

  /**
   * Abort all running and queued agents immediately, returning the agents this
   * call stopped, in registry order. An agent already finished is left out.
   */
  abortAll(): Subagent[] {
    const stopped: Subagent[] = [];
    for (const record of this.agents.values()) {
      if (record.status === "queued") {
        record.stopQueued();
        stopped.push(record);
      } else if (record.abort()) {
        stopped.push(record);
      }
    }
    // Drop pending thunks (their promises resolve).
    this.limiter.clear();
    return stopped;
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
    clearInterval(this.sweepInterval);
    // Drop pending thunks
    this.limiter.clear();
    const teardowns = [...this.agents.values()].map(record => record.disposeSession());
    this.agents.clear();
    await Promise.allSettled(teardowns);
  }
}

/** A settled child a restore continues, and what it is continued against. */
interface RestoreSource {
  run: RestorableRun;
  header: ChildTranscriptHeader;
  type: SubagentType;
  snapshot: ParentSnapshot;
  parentSession: ParentSessionInfo;
}

/**
 * The child's recorded run with the transcript header that proves its file is
 * still the child's own, or why the transcript cannot be continued. A file
 * naming another parent is a fork's inherited child (`unknown-agent`): forks
 * inherit run entries, not ownership of the transcripts they name. A file that
 * is missing, unreadable, or another session (a sibling's put in its place),
 * and a run recorded before the session id was, are `no-session`: nothing shows
 * the file is the child's.
 */
function provenTranscript(
  recorded: Exclude<ChildRestoreRecord, { kind: "unrecorded" }>,
  history: ChildHistory,
  parentSessionId: string | undefined,
): Pick<RestoreSource, "run" | "header"> | ResumeRefusalReason {
  const file = recorded.kind === "restorable" ? recorded.run.outputFile : recorded.outputFile;
  const header = file === undefined ? undefined : history.transcriptHeader(file);
  if (header && header.parentSession !== parentSessionId) return "unknown-agent";
  if (recorded.kind !== "restorable" || header?.id !== recorded.run.sessionId) return "no-session";
  return { run: recorded.run, header };
}

/**
 * The outcome a restored record starts from: its last run's, which the manager
 * that ran it delivered. An entry describes the run that ended, so its status
 * is terminal; one that reads active anyway is taken as stopped, so the
 * restored record starts settled whatever the entry claims.
 */
function restoredOutcome(run: PersistedRunSummary): RunOutcomeInit {
  return {
    status: isActiveStatus(run.status) ? "stopped" : run.status,
    stoppedWhileQueued: run.stoppedWhileQueued,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    consumedAt: run.completedAt ?? run.startedAt,
  };
}

/**
 * The turn limit a restored child runs under: the ceiling its runs last
 * recorded, or 0 — unlimited, over the agent's own and the run default — when
 * that budget named none. When no run of it ever reached its turn loop there is
 * no budget at all, and the child gets what a fresh spawn of its type would.
 */
function restoredMaxTurns(budget: TurnBudget | undefined): number | undefined {
  if (budget === undefined) return undefined;
  return budget.maxTurns ?? 0;
}
