import type { AgentConfig, ThinkingLevel } from "#src/types";

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
  thinking?: string;
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
    thinking: (agentConfig?.thinking ?? params.thinking) as ThinkingLevel | undefined,
    maxTurns: agentConfig?.maxTurns ?? params.max_turns,
    inheritContext: agentConfig?.inheritContext ?? params.inherit_context ?? false,
    runInBackground: agentConfig?.runInBackground ?? params.run_in_background ?? false,
  };
}
