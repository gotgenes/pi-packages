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

/** The per-call values the Agent tool door resolved from its caller and the agent file. */
export interface AgentInvocationConfig {
  modelInput?: string;
  /**
   * True when the winning model string came from the caller.
   *
   * Decides whether an unresolvable string surfaces as an error or falls back to the
   * parent model silently: the caller is present to read an error, an agent file's
   * author is not.
   */
  modelFromParams: boolean;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  inheritContext: boolean;
  runInBackground: boolean;
}

/**
 * Merge an agent file's frontmatter with the `subagent` tool call's parameters.
 *
 * The caller wins by default and the agent file fills what the caller left unset. The
 * upstream guard this inverts existed because the *model* guesses harness knobs it does
 * not understand — an agent author who wants that guard back declares `locked:`, which
 * is the only case where a caller's value is discarded (Refs #829).
 */
export function resolveAgentInvocationConfig(
  agentConfig: AgentConfig,
  params: AgentInvocationParams,
): AgentInvocationConfig {
  const locked = agentConfig.locked;
  const model = resolveField("model", agentConfig.model, params.model, locked);

  return {
    modelInput: model.value,
    modelFromParams: model.source === "caller",
    thinking: resolveField("thinking", agentConfig.thinking, params.thinking, locked).value,
    maxTurns: resolveField("max_turns", agentConfig.maxTurns, params.max_turns, locked).value,
    inheritContext:
      resolveField("inherit_context", agentConfig.inheritContext, params.inherit_context, locked)
        .value ?? false,
    runInBackground:
      resolveField(
        "run_in_background",
        agentConfig.runInBackground,
        params.run_in_background,
        locked,
      ).value ?? false,
  };
}

/** One field's precedence outcome; `source` names the side that supplied the value. */
interface FieldResolution<T> {
  value: T | undefined;
  source: "caller" | "agent" | "none";
}

/** Apply the precedence rule to a single field. */
function resolveField<T>(
  field: LockableField,
  agentValue: T | undefined,
  callerValue: T | undefined,
  locked: LockDeclaration | undefined,
): FieldResolution<T> {
  if (!isLocked(field, agentValue, locked) && callerValue !== undefined) {
    return { value: callerValue, source: "caller" };
  }
  return agentValue !== undefined
    ? { value: agentValue, source: "agent" }
    : { value: undefined, source: "none" };
}

/**
 * Whether an agent file withholds `field` from its callers.
 *
 * The two declaration forms differ deliberately on a field the file leaves unset:
 * `true` means "what I set is mine", so it locks nothing it did not supply, while a
 * list names fields outright and denies an override with no value of its own.
 */
function isLocked(
  field: LockableField,
  agentValue: unknown,
  locked: LockDeclaration | undefined,
): boolean {
  if (locked === undefined) return false;
  return locked === true ? agentValue !== undefined : locked.includes(field);
}
