/**
 * spawn-config.ts — Pure config resolution for the Agent tool.
 *
 * Extracts all config resolution logic from execute: type resolution,
 * invocation config merge, model resolution, max-turns normalization,
 * tag building, and detail-base construction.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { AgentTypeRegistry } from "#src/config/agent-types";
import { type LockableField, resolveAgentInvocationConfig } from "#src/config/invocation-config";
import { parseThinkingLevel, thinkingLevelError } from "#src/config/thinking-level";
import { normalizeMaxTurns } from "#src/lifecycle/turn-limits";
import type { ModelRegistry } from "#src/session/model-resolver";
import { resolveInvocationModel } from "#src/session/model-resolver";
import type { AgentInvocation, SubagentType, ThinkingLevel } from "#src/types";
import {
  type AgentDetails,
  buildInvocationTags,
  getDisplayName,
  getPromptModeLabel,
} from "#src/ui/display";

/** Model info extracted from the parent session context. */
export interface ModelInfo {
  parentModel: Model<any> | undefined;
  modelRegistry: ModelRegistry | undefined;
}

/** Identity: who is being spawned. */
export interface SpawnIdentity {
  subagentType: string;
  rawType: SubagentType;
  fellBack: boolean;
  displayName: string;
}

/** Execution: how the agent will run. */
export interface SpawnExecution {
  prompt: string;
  description: string;
  model: Model<any> | undefined;
  effectiveMaxTurns: number | undefined;
  thinking: ThinkingLevel | undefined;
  inheritContext: boolean;
  runInBackground: boolean;
  agentInvocation: AgentInvocation;
}

/** Presentation: display/UI values derived from identity and execution. */
export interface SpawnPresentation {
  modelName: string | undefined;
  agentTags: string[];
  detailBase: Pick<AgentDetails, "displayName" | "description" | "subagentType" | "modelName" | "tags">;
}

/** Fully resolved config for spawning an agent — composed of domain-aligned sub-interfaces. */
export interface ResolvedSpawnConfig {
  identity: SpawnIdentity;
  execution: SpawnExecution;
  presentation: SpawnPresentation;
  /** Model-visible advisories about how this spawn resolved. Both runners render them. */
  notes: string[];
}

/** Error result when model resolution fails. */
export interface SpawnConfigError {
  error: string;
}

/**
 * Resolve all config for an Agent tool invocation.
 *
 * Pure function — no SDK types, no side effects.
 * Returns either a fully resolved config or an error.
 */
export function resolveSpawnConfig(
  params: Record<string, unknown>,
  registry: AgentTypeRegistry,
  modelInfo: ModelInfo,
  settings: { readonly defaultMaxTurns: number | undefined },
): ResolvedSpawnConfig | SpawnConfigError {
  // Validated at the door, so the merge below and every layer past it receive a
  // level the SDK recognizes rather than one it would clamp to "off" (Refs #834).
  const thinkingParam = params.thinking;
  const thinkingFromParams = parseThinkingLevel(thinkingParam);
  if (thinkingParam != null && thinkingFromParams === undefined) {
    return { error: thinkingLevelError(thinkingParam) };
  }

  const rawType = params.subagent_type as SubagentType;
  const resolved = registry.resolveType(rawType);

  // A disabled type is rejected by SubagentManager.resolveSpawn, the choke point
  // every front door shares.
  const subagentType = resolved ?? "general-purpose";
  const fellBack = resolved === undefined;

  const displayName = getDisplayName(subagentType, registry);

  // Merge agent config defaults with tool-call params
  const customConfig = registry.resolveAgentConfig(subagentType);
  const resolvedConfig = resolveAgentInvocationConfig(customConfig, {
    ...params,
    thinking: thinkingFromParams,
  });

  // Resolve model
  const resolution = resolveInvocationModel(
    modelInfo.parentModel,
    resolvedConfig.modelInput,
    resolvedConfig.modelFromParams,
    modelInfo.modelRegistry,
  );
  if (resolution.error) return { error: resolution.error };
  const model = resolution.model;

  const thinking = resolvedConfig.thinking;
  const inheritContext = resolvedConfig.inheritContext;
  const runInBackground = resolvedConfig.runInBackground;

  // Compute display model name (only shown when different from parent)
  const parentModelId = modelInfo.parentModel?.id;
  const effectiveModelId = model?.id;
  const modelName =
    effectiveModelId && effectiveModelId !== parentModelId
      ? model.name.replace(/^Claude\s+/i, "").toLowerCase()
      : undefined;

  const effectiveMaxTurns = normalizeMaxTurns(
    resolvedConfig.maxTurns ?? settings.defaultMaxTurns,
  );

  const agentInvocation: AgentInvocation = {
    modelName,
    thinking,
    maxTurns: normalizeMaxTurns(resolvedConfig.maxTurns),
    inheritContext,
    runInBackground,
  };

  const modeLabel = getPromptModeLabel(subagentType, registry);
  const { tags: invocationTags } = buildInvocationTags(agentInvocation);
  const agentTags = modeLabel ? [modeLabel, ...invocationTags] : invocationTags;

  const detailBase = {
    displayName,
    description: params.description as string,
    subagentType,
    modelName,
    tags: agentTags.length > 0 ? agentTags : undefined,
  };

  return {
    identity: { subagentType, rawType, fellBack, displayName },
    notes: [
      ...buildFallbackNote(rawType, fellBack),
      ...buildLockNote(subagentType, resolvedConfig.discarded),
    ],
    execution: {
      prompt: params.prompt as string,
      description: params.description as string,
      model,
      effectiveMaxTurns,
      thinking,
      inheritContext,
      runInBackground,
      agentInvocation,
    },
    presentation: { modelName, agentTags, detailBase },
  };
}

/** Advise that the named type does not exist, so general-purpose ran instead. */
export function buildFallbackNote(rawType: SubagentType, fellBack: boolean): string[] {
  return fellBack ? [`Note: Unknown agent type "${rawType}" — using general-purpose.`] : [];
}

/**
 * Advise that the agent's `locked:` frontmatter threw away parameters this call passed.
 *
 * The caller cannot see an agent file, so a silent discard reads as the tool ignoring
 * a parameter its own schema documents — which is the defect #829 reports.
 */
function buildLockNote(agentName: string, discarded: readonly LockableField[]): string[] {
  if (discarded.length === 0) return [];
  const tail =
    discarded.length === 1
      ? `so the ${discarded[0]} parameter was ignored`
      : "so those parameters were ignored";
  return [`Note: agent "${agentName}" locks ${discarded.join(", ")}, ${tail}.`];
}
