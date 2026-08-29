/**
 * service-adapter.ts — Adapter that wraps SubagentManager to satisfy SubagentsService.
 *
 * Handles model resolution at the API boundary, record serialization
 * (stripping non-serializable fields), and session gating.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { AgentSpawnConfig } from "#src/lifecycle/subagent-manager";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import type { SpawnOptions, SubagentRecord, SubagentsService } from "#src/service/service";
import type { ModelRegistry } from "#src/session/model-resolver";
import type { SessionContext, Subagent, ThinkingLevel } from "#src/types";

/** Narrow interface for the SubagentManager — avoids coupling to the concrete class. */
export interface SubagentManagerLike {
  spawn(snapshot: ParentSnapshot, type: string, prompt: string, options: AgentSpawnConfig): string;
  getRecord(id: string): Subagent | undefined;
  listAgents(): Subagent[];
  abort(id: string): boolean;
  waitForAll(): Promise<void>;
  hasRunning(): boolean;
  registerWorkspaceProvider(provider: WorkspaceProvider): () => void;
}

/**
 * Narrow runtime interface consumed by the service adapter.
 * `SubagentRuntime` satisfies this structurally; tests use plain stubs.
 */
export interface ServiceRuntimeLike {
  readonly currentCtx: SessionContext | undefined;
  buildSnapshot(inheritContext: boolean): ParentSnapshot;
  /** Parent session identity, so an SDK-spawned child nests under its parent. */
  getSessionInfo(): { parentSessionFile: string; parentSessionId: string };
}

/** Adapter that wraps SubagentManager to satisfy SubagentsService. */
export class SubagentsServiceAdapter implements SubagentsService {
  constructor(
    private readonly manager: SubagentManagerLike,
    private readonly resolveModel: (input: string, registry: ModelRegistry) => Model<any> | string,
    private readonly runtime: ServiceRuntimeLike,
  ) {}

  spawn(type: string, prompt: string, options?: SpawnOptions): string {
    if (!this.runtime.currentCtx) {
      throw new Error("No active session — cannot spawn agents outside a session.");
    }

    const model = this.resolveModelOption(options?.model);
    const description = options?.description ?? prompt.slice(0, 80);

    const snapshot = this.runtime.buildSnapshot(options?.inheritContext ?? false);
    const { parentSessionFile, parentSessionId } = this.runtime.getSessionInfo();
    return this.manager.spawn(snapshot, type, prompt, {
      description,
      model,
      // No toolCallId — an SDK spawn has no originating tool call, and
      // Subagent.toolCallId reporting undefined there is the truth.
      parentSession: { parentSessionFile, parentSessionId },
      maxTurns: options?.maxTurns,
      // SpawnOptions widens this to `string` for the public surface; the tool door
      // casts the same way in resolveAgentInvocationConfig. Neither door validates — see #834.
      thinkingLevel: options?.thinkingLevel as ThinkingLevel | undefined,
      inheritContext: options?.inheritContext,
      bypassQueue: options?.bypassQueue,
      // A caller that names `foreground` has committed; one that omits it has
      // not, so the agent's own frontmatter decides and background is the
      // SDK-door default.
      background:
        options?.foreground === undefined
          ? { kind: "default", isBackground: true }
          : { kind: "explicit", isBackground: !options.foreground },
    });
  }

  getRecord(id: string): SubagentRecord | undefined {
    const record = this.manager.getRecord(id);
    return record ? toSubagentRecord(record) : undefined;
  }

  listAgents(): SubagentRecord[] {
    return this.manager.listAgents().map(toSubagentRecord);
  }

  abort(id: string): boolean {
    return this.manager.abort(id);
  }

  async steer(id: string, message: string): Promise<boolean> {
    const record = this.manager.getRecord(id);
    if (!record) {
      return false;
    }
    const outcome = await record.steer(message);
    return outcome.kind !== "rejected";
  }

  async waitForAll(): Promise<void> {
    return this.manager.waitForAll();
  }

  hasRunning(): boolean {
    return this.manager.hasRunning();
  }

  registerWorkspaceProvider(provider: WorkspaceProvider): () => void {
    return this.manager.registerWorkspaceProvider(provider);
  }

  /** Resolve an optional model-string override against the current session's registry. */
  private resolveModelOption(modelInput: string | undefined): Model<any> | undefined {
    if (!modelInput) return undefined;
    const registry = this.runtime.currentCtx?.modelRegistry;
    if (!registry) {
      throw new Error("No model registry available.");
    }
    const resolved = this.resolveModel(modelInput, registry);
    if (typeof resolved === "string") {
      throw new Error(resolved);
    }
    return resolved;
  }
}

/**
 * Convert an internal Subagent to a serializable SubagentRecord.
 *
 * The allowlist is explicit because the snapshot admits only discrete facts —
 * identity, resolved spawn decisions, cumulative metrics, and pointers to
 * durable artifacts. Live objects, momentary activity, and package-internal
 * bookkeeping stay out; see
 * `docs/decisions/0005-subagent-record-admission-policy.md`.
 */
export function toSubagentRecord(record: Subagent): SubagentRecord {
  const out: SubagentRecord = {
    id: record.id,
    type: record.type,
    description: record.description,
    status: record.status,
    isBackground: record.isBackground,
    toolUses: record.toolUses,
    turnCount: record.turnCount,
    startedAt: record.startedAt,
    lifetimeUsage: record.lifetimeUsage,
    compactionCount: record.compactionCount,
  };

  if (record.result !== undefined) out.result = record.result;
  if (record.error !== undefined) out.error = record.error;
  if (record.completedAt !== undefined) out.completedAt = record.completedAt;
  if (record.maxTurns !== undefined) out.maxTurns = record.maxTurns;
  if (record.outputFile !== undefined) out.outputFile = record.outputFile;

  return out;
}
