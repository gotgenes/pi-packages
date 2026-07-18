import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { AgentSpawnConfig } from "#src/lifecycle/subagent-manager";
import { textResult } from "#src/tools/helpers";
import type { ResolvedSpawnConfig } from "#src/tools/spawn-config";
import type { ParentSessionInfo, Subagent } from "#src/types";

/** Narrow manager interface for the background spawner. */
export interface BackgroundManagerDeps {
  spawn(snapshot: ParentSnapshot, type: string, prompt: string, opts: AgentSpawnConfig): string;
  getRecord(id: string): Subagent | undefined;
}

/** All values the background spawner needs beyond the resolved config. */
export interface BackgroundParams {
  config: ResolvedSpawnConfig;
  snapshot: ParentSnapshot;
  parentSession: ParentSessionInfo;
  settings: { readonly maxConcurrent: number };
}

/**
 * Spawn a background agent and return the tool result immediately.
 * Owns: launch message formatting.
 */
export function spawnBackground(
  manager: BackgroundManagerDeps,
  params: BackgroundParams,
) {
  const { identity, execution, presentation } = params.config;

  let id: string;
  try {
    id = manager.spawn(params.snapshot, identity.subagentType, execution.prompt, {
      parentSession: params.parentSession,
      description: execution.description,
      model: execution.model,
      maxTurns: execution.effectiveMaxTurns,
      inheritContext: execution.inheritContext,
      thinkingLevel: execution.thinking,
      isBackground: true,
      origin: "tool",
      invocation: execution.agentInvocation,
    });
  } catch (err) {
    return textResult(err instanceof Error ? err.message : String(err));
  }

  const record = manager.getRecord(id);

  const isQueued = record?.status === "queued";
  return textResult(
    `Agent ${isQueued ? "queued" : "started"} in background.\n` +
      `Agent ID: ${id}\n` +
      `Type: ${identity.displayName}\n` +
      `Description: ${execution.description}\n` +
      (record?.outputFile ? `Output file: ${record.outputFile}\n` : "") +
      (isQueued
        ? `Position: queued (max ${params.settings.maxConcurrent} concurrent)\n`
        : "") +
      `\nYou will be notified when this agent completes.\n` +
      `Use get_subagent_result to retrieve full results, or steer_subagent to send it messages.\n` +
      `Do not duplicate this agent's work.`,
    {
      ...presentation.detailBase,
      toolUses: 0,
      tokens: "",
      durationMs: 0,
      status: "background" as const,
      agentId: id,
    },
  );
}
