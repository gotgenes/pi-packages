import type { AgentConfig, ThinkingLevel } from "#src/types";

/**
 * The fields a `subagent` tool caller may pass, spelled as the frontmatter key an
 * agent author writes rather than the camelCase `AgentConfig` property.
 */
export const LOCKABLE_FIELDS = [
  "model",
  "thinking",
  "max_turns",
  "inherit_context",
  "run_in_background",
] as const;

/** One field an agent file may withhold from its callers. */
export type LockableField = (typeof LOCKABLE_FIELDS)[number];

/**
 * An agent file's claim over the fields a caller may not override.
 *
 * `true` locks every field the file sets, which is the pre-#829 blanket behavior. A
 * list locks exactly the fields it names, whether or not the file supplies a value —
 * so an author can deny an override without pinning one.
 */
export type LockDeclaration = true | readonly LockableField[];

/** True when `name` is a field an agent file may lock. */
export function isLockableField(name: string): name is LockableField {
  return (LOCKABLE_FIELDS as readonly string[]).includes(name);
}

/**
 * A front door's answer to "should this agent run in the background?".
 *
 * `explicit` is a commitment the door has already acted on — the foreground
 * runner holds the result promise, or the tool door merged frontmatter itself
 * and routed on the answer. `default` is a door with no commitment, so the
 * agent's own `runInBackground` frontmatter fills it.
 */
export type BackgroundRequest =
	| { kind: "explicit"; isBackground: boolean }
	| { kind: "default"; isBackground: boolean };

/** Resolve the effective background mode. Explicit answers are honored verbatim. */
export function resolveBackgroundMode(
	agentConfig: Pick<AgentConfig, "runInBackground">,
	request: BackgroundRequest,
): boolean {
	return request.kind === "explicit"
		? request.isBackground
		: (agentConfig.runInBackground ?? request.isBackground);
}

interface AgentInvocationParams {
  model?: string;
  /** Already validated by the door — see `parseThinkingLevel`. */
  thinking?: ThinkingLevel;
  max_turns?: number;
  run_in_background?: boolean;
  inherit_context?: boolean;
}

export function resolveAgentInvocationConfig(
  agentConfig: AgentConfig | undefined,
  params: AgentInvocationParams,
): {
  modelInput?: string;
  modelFromParams: boolean;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  inheritContext: boolean;
  runInBackground: boolean;
} {
  return {
    modelInput: agentConfig?.model ?? params.model,
    modelFromParams: agentConfig?.model == null && params.model != null,
    thinking: agentConfig?.thinking ?? params.thinking,
    maxTurns: agentConfig?.maxTurns ?? params.max_turns,
    inheritContext: agentConfig?.inheritContext ?? params.inherit_context ?? false,
    runInBackground: agentConfig?.runInBackground ?? params.run_in_background ?? false,
  };
}
