import { buildFallbackNote, type ResolvedSpawnConfig } from "#src/tools/spawn-config";

/** Flat options for {@link createResolvedSpawnConfig}; only the scalars tests vary. */
export interface ResolvedSpawnConfigOptions {
  subagentType?: string;
  rawType?: string;
  fellBack?: boolean;
  displayName?: string;
  prompt?: string;
  description?: string;
  model?: string;
  runInBackground?: boolean;
}

/**
 * Build a `ResolvedSpawnConfig` for tool tests from flat options.
 *
 * Derives the mirrored regions the hand-built fixtures duplicate:
 * `execution.runInBackground` → `execution.agentInvocation.runInBackground`, and
 * `displayName`/`description`/`subagentType`/`model` → `presentation.detailBase`.
 * Flat options sidestep the `Partial<ResolvedSpawnConfig>` deep-merge trap.
 */
export function createResolvedSpawnConfig(
  options: ResolvedSpawnConfigOptions = {},
): ResolvedSpawnConfig {
  const subagentType = options.subagentType ?? "general-purpose";
  const displayName = options.displayName ?? "Agent";
  const description = options.description ?? "task";
  const runInBackground = options.runInBackground ?? false;
  const modelName = options.model;
  const rawType = options.rawType ?? subagentType;
  const fellBack = options.fellBack ?? false;

  return {
    identity: { subagentType, rawType, fellBack, displayName },
    notes: buildFallbackNote(rawType, fellBack),
    execution: {
      prompt: options.prompt ?? "do the task",
      description,
      model: undefined,
      effectiveMaxTurns: undefined,
      thinking: undefined,
      inheritContext: false,
      runInBackground,
      agentInvocation: {
        modelName,
        thinking: undefined,
        maxTurns: undefined,
        inheritContext: false,
        runInBackground,
      },
    },
    presentation: {
      modelName,
      agentTags: [],
      detailBase: { displayName, description, subagentType, modelName, tags: undefined },
    },
  };
}
