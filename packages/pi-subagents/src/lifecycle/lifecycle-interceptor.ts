/**
 * lifecycle-interceptor.ts — Ordered, generative lifecycle interception.
 *
 * Unlike the child lifecycle events, this registry is intentionally small: it
 * exists only because callers need the core to consume prompt/result decisions.
 * It owns ordering, cancellation, registration lifetime, and the finite
 * continuation bound; it does not expose sessions, records, models, or queues.
 */

/** The fixed bound prevents a provider from turning completion into an unbounded loop. */
export const MAX_LIFECYCLE_CONTINUATION_ROUNDS = 3;

export type SubagentExecutionPhase = "initial" | "resume";
export type SubagentExecutionOrigin = "tool" | "service";
export type SubagentExecutionMode = "foreground" | "background";
export type SubagentExecutionAdmission = "immediate" | "queued";
export type SubagentLifecycleOutcome = "completed" | "steered" | "aborted";

/** Immutable identifiers for one initial or resumed execution attempt. */
export interface SubagentLifecycleIdentity {
  readonly agentId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly agentType: string;
  readonly parentSessionId?: string;
}

/** How this execution entered the core; queue admission is captured before it starts. */
export interface SubagentLifecycleExecutionPath {
  readonly phase: SubagentExecutionPhase;
  readonly origin: SubagentExecutionOrigin;
  readonly mode: SubagentExecutionMode;
  readonly admission: SubagentExecutionAdmission;
}

export interface SubagentLifecycleStartContext {
  readonly identity: SubagentLifecycleIdentity;
  readonly execution: SubagentLifecycleExecutionPath;
  /** The exact next value that will be passed to AgentSession.prompt(). */
  readonly prompt: string;
  readonly signal: AbortSignal;
}

export type SubagentLifecycleStartDecision =
  | { readonly action: "continue"; readonly prompt?: string }
  | { readonly action: "abort"; readonly reason: string };

export interface SubagentLifecycleCompletionContext {
  readonly identity: SubagentLifecycleIdentity;
  readonly execution: SubagentLifecycleExecutionPath;
  /** Candidate text before workspace teardown, state mutation, and events. */
  readonly proposedResult: string;
  readonly outcome: SubagentLifecycleOutcome;
  readonly continuationRound: number;
  readonly maxContinuationRounds: number;
  readonly signal: AbortSignal;
}

export type SubagentLifecycleCompletionDecision =
  | { readonly action: "complete"; readonly result?: string }
  | { readonly action: "continue"; readonly prompt: string }
  | { readonly action: "abort"; readonly reason: string };

/**
 * A provider can observe and transform boundaries but never receives the live
 * AgentSession. Omitted callbacks are no-ops, making one provider useful for a
 * single boundary without creating a second registration kind.
 */
export interface SubagentLifecycleInterceptor {
  beforeStart?(
    context: SubagentLifecycleStartContext,
  ): SubagentLifecycleStartDecision | undefined | Promise<SubagentLifecycleStartDecision | undefined>;
  beforeComplete?(
    context: SubagentLifecycleCompletionContext,
  ): SubagentLifecycleCompletionDecision | undefined | Promise<SubagentLifecycleCompletionDecision | undefined>;
  /** Called exactly once after unregistration or registry shutdown. */
  dispose?(): void | Promise<void>;
}

/** Idempotent registration handle returned by the public service. */
export interface SubagentLifecycleRegistration {
  dispose(): Promise<void>;
}

/** Internal bridge from the registry to the object that owns AgentSession.prompt(). */
export interface SubagentTurnLifecycle {
  readonly signal: AbortSignal;
  readonly maxContinuationRounds: number;
  beforeStart(prompt: string): Promise<SubagentLifecycleStartDecision | undefined>;
  beforeComplete(
    proposedResult: string,
    outcome: SubagentLifecycleOutcome,
    continuationRound: number,
  ): Promise<SubagentLifecycleCompletionDecision | undefined>;
}

export class LifecycleInterceptorError extends Error {
  constructor(phase: "beforeStart" | "beforeComplete", cause: unknown) {
    // Keep callback details out of a record's public error text. The original
    // cause remains available to a local debugger without becoming API data.
    super(`Lifecycle interceptor failed during ${phase}`, { cause });
    this.name = "LifecycleInterceptorError";
  }
}

type RegistrationRecord = {
  readonly interceptor: SubagentLifecycleInterceptor;
  active: boolean;
  inFlight: number;
  finalizer?: Promise<void>;
  readonly idleWaiters: Array<() => void>;
};

/**
 * Package-private ordered provider registry. The service exposes only its
 * registration method; executions receive a narrow callback bridge, never this
 * object or a manager/session reference.
 */
export class LifecycleInterceptorRegistry {
  private readonly registrations: RegistrationRecord[] = [];
  private readonly shutdownController = new AbortController();
  private shutdownPromise?: Promise<void>;

  // fallow-ignore-next-line unused-class-member -- lifecycle execution checks this through its narrow internal registry type
  hasInterceptors(): boolean {
    return !this.shutdownController.signal.aborted &&
      this.registrations.some((record) => record.active);
  }

  register(interceptor: SubagentLifecycleInterceptor): SubagentLifecycleRegistration {
    if (this.shutdownController.signal.aborted) {
      throw new Error("Subagent lifecycle registry is disposed");
    }
    if (typeof interceptor !== "object") {
      throw new TypeError("A lifecycle interceptor object is required");
    }

    const record: RegistrationRecord = {
      interceptor,
      active: true,
      inFlight: 0,
      idleWaiters: [],
    };
    this.registrations.push(record);
    return Object.freeze({ dispose: () => this.disposeRegistration(record) });
  }

  /**
   * Create callback-local control for one run. Identity and path are frozen
   * once so every start/completion/continuation callback observes identical
   * metadata. The execution signal also ends when the service is disposed.
   */
  createTurnLifecycle(input: Readonly<{
    identity: SubagentLifecycleIdentity;
    execution: SubagentLifecycleExecutionPath;
    signal: AbortSignal;
  }>): SubagentTurnLifecycle {
    const identity = Object.freeze({ ...input.identity });
    const execution = Object.freeze({ ...input.execution });
    const signal = AbortSignal.any([input.signal, this.shutdownController.signal]);
    return Object.freeze({
      signal,
      maxContinuationRounds: MAX_LIFECYCLE_CONTINUATION_ROUNDS,
      beforeStart: (prompt: string) => this.applyStart(identity, execution, prompt, signal),
      beforeComplete: (
        proposedResult: string,
        outcome: SubagentLifecycleOutcome,
        continuationRound: number,
      ) =>
        this.applyCompletion(
          identity,
          execution,
          proposedResult,
          outcome,
          continuationRound,
          signal,
        ),
    });
  }

  /** Abort callback waits, unregister every provider, and dispose each once. */
  dispose(): Promise<void> {
    this.shutdownPromise ??= this.shutdown();
    return this.shutdownPromise;
  }

  private async shutdown(): Promise<void> {
    this.shutdownController.abort(new DOMException("Subagent lifecycle registry disposed", "AbortError"));
    for (const record of this.registrations) this.unregister(record);
    const finalizers = this.registrations.flatMap((record) =>
      record.finalizer === undefined ? [] : [record.finalizer],
    );
    await Promise.all(finalizers);
  }

  /**
   * Unregistration is immediate for future snapshots. Provider disposal waits
   * until callbacks already captured by a boundary finish, but the returned
   * handle deliberately does not wait for that finalizer: an interceptor may
   * unregister another interceptor while the same ordered snapshot is running.
   */
  private disposeRegistration(record: RegistrationRecord): Promise<void> {
    this.unregister(record);
    return Promise.resolve();
  }

  private unregister(record: RegistrationRecord): void {
    record.active = false;
    record.finalizer ??= (async () => {
      await this.waitForIdle(record);
      await record.interceptor.dispose?.();
    })();
  }

  private async waitForIdle(record: RegistrationRecord): Promise<void> {
    if (record.inFlight === 0) return;
    await new Promise<void>((resolve) => record.idleWaiters.push(resolve));
  }

  private releaseInvocation(record: RegistrationRecord): void {
    record.inFlight--;
    if (record.inFlight !== 0) return;
    for (const resolve of record.idleWaiters.splice(0)) resolve();
  }

  private snapshot(): readonly RegistrationRecord[] {
    const snapshot = this.registrations.filter((record) => record.active);
    // Pin the current boundary before invoking the first callback. A disposer
    // therefore cannot tear down a later provider that this stable snapshot
    // still has to call; it only excludes future boundaries.
    for (const record of snapshot) record.inFlight++;
    return snapshot;
  }

  private async applyStart(
    identity: SubagentLifecycleIdentity,
    execution: SubagentLifecycleExecutionPath,
    initialPrompt: string,
    signal: AbortSignal,
  ): Promise<SubagentLifecycleStartDecision | undefined> {
    let prompt = initialPrompt;
    let transformed = false;
    const snapshot = this.snapshot();
    try {
      for (const record of snapshot) {
        if (!record.interceptor.beforeStart) continue;
        const decision = await this.invoke(
          "beforeStart",
          () => record.interceptor.beforeStart!(Object.freeze({ identity, execution, prompt, signal })),
          signal,
        );
        const normalized = normalizeStartDecision(decision);
        if (normalized === undefined) continue;
        if (normalized.action === "abort") return normalized;
        if (normalized.prompt !== undefined) {
          prompt = normalized.prompt;
          transformed = true;
        }
      }
      return transformed ? { action: "continue", prompt } : undefined;
    } finally {
      for (const record of snapshot) this.releaseInvocation(record);
    }
  }

  private async applyCompletion(
    identity: SubagentLifecycleIdentity,
    execution: SubagentLifecycleExecutionPath,
    initialResult: string,
    outcome: SubagentLifecycleOutcome,
    continuationRound: number,
    signal: AbortSignal,
  ): Promise<SubagentLifecycleCompletionDecision | undefined> {
    let result = initialResult;
    let transformed = false;
    const snapshot = this.snapshot();
    try {
      for (const record of snapshot) {
        if (!record.interceptor.beforeComplete) continue;
        const decision = await this.invoke(
          "beforeComplete",
          () => record.interceptor.beforeComplete!(Object.freeze({
            identity,
            execution,
            proposedResult: result,
            outcome,
            continuationRound,
            maxContinuationRounds: MAX_LIFECYCLE_CONTINUATION_ROUNDS,
            signal,
          })),
          signal,
        );
        const normalized = normalizeCompletionDecision(decision);
        if (normalized === undefined) continue;
        if (normalized.action !== "complete") return normalized;
        if (normalized.result !== undefined) {
          result = normalized.result;
          transformed = true;
        }
      }
      return transformed ? { action: "complete", result } : undefined;
    } finally {
      for (const record of snapshot) this.releaseInvocation(record);
    }
  }

  private async invoke<T>(
    phase: "beforeStart" | "beforeComplete",
    callback: () => T | Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) throw abortError(signal);
    try {
      return await awaitWithSignal(Promise.resolve().then(callback), signal);
    } catch (error) {
      const cancellation = currentAbortError(signal);
      if (cancellation) throw cancellation;
      throw new LifecycleInterceptorError(phase, error);
    }
  }
}

function awaitWithSignal<T>(value: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener("abort", abort, { once: true });
    void value.then(
      (result) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(abortError(signal));
        else resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(signal.aborted ? abortError(signal) : toError(error));
      },
    );
  });
}

function currentAbortError(signal: AbortSignal): Error | undefined {
  return signal.aborted ? abortError(signal) : undefined;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("The lifecycle execution was aborted");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Lifecycle interceptor rejected");
}

function normalizeStartDecision(
  decision: unknown,
): SubagentLifecycleStartDecision | undefined {
  if (decision === undefined) return undefined;
  if (decision === null || typeof decision !== "object") {
    throw new TypeError("Lifecycle beforeStart must return a decision object or undefined");
  }
  const value = decision as { action?: unknown; prompt?: unknown; reason?: unknown };
  if (value.action === "continue") {
    if (value.prompt !== undefined && typeof value.prompt !== "string") {
      throw new TypeError("Lifecycle beforeStart continuation prompt must be a string");
    }
    return value.prompt === undefined
      ? { action: "continue" }
      : { action: "continue", prompt: value.prompt };
  }
  if (value.action === "abort" && typeof value.reason === "string" && value.reason.length > 0) {
    return { action: "abort", reason: value.reason };
  }
  throw new TypeError("Lifecycle beforeStart returned an invalid decision");
}

function normalizeCompletionDecision(
  decision: unknown,
): SubagentLifecycleCompletionDecision | undefined {
  if (decision === undefined) return undefined;
  if (decision === null || typeof decision !== "object") {
    throw new TypeError("Lifecycle beforeComplete must return a decision object or undefined");
  }
  const value = decision as { action?: unknown; result?: unknown; prompt?: unknown; reason?: unknown };
  if (value.action === "complete") {
    if (value.result !== undefined && typeof value.result !== "string") {
      throw new TypeError("Lifecycle completion result must be a string");
    }
    return value.result === undefined
      ? { action: "complete" }
      : { action: "complete", result: value.result };
  }
  if (value.action === "continue" && typeof value.prompt === "string" && value.prompt.length > 0) {
    return { action: "continue", prompt: value.prompt };
  }
  if (value.action === "abort" && typeof value.reason === "string" && value.reason.length > 0) {
    return { action: "abort", reason: value.reason };
  }
  throw new TypeError("Lifecycle beforeComplete returned an invalid decision");
}
