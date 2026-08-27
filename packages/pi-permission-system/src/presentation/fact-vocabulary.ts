import {
  allEvidence,
  type PromptPayload,
} from "#src/presentation/prompt-payload";
import type { BashCommandContext } from "#src/types";

/**
 * The render vocabulary shared by every renderer over a {@link PromptPayload}.
 *
 * Which element an ask flags, what that element is called, and how a nested
 * execution context reads are all answers a render needs and none of them is
 * a payload fact — the payload carries `value`, `kind`, and `commandContext`,
 * and this module is where they acquire a name. It lives apart from any one
 * renderer so the dialog, the agent-facing text, and the review log cannot
 * disagree about what a given ask is flagging.
 */

/**
 * What the ask is flagging.
 *
 * The decision-relevant value for every shape but one: a bash ask that escaped
 * the working directory flags the paths it referenced, not the command that
 * referenced them — the command is the context, and the paths are what the
 * operator is ruling on.
 */
export function flaggedElements(payload: PromptPayload): readonly string[] {
  if (payload.kind === "bash_external_directory") {
    return allEvidence(payload, "external path").map((entry) => entry.text);
  }
  return payload.request.value === "" ? [] : [payload.request.value];
}

/**
 * What {@link flaggedElements} returns is called.
 *
 * Differs from {@link valueLabel} for exactly one shape: a bash ask that
 * escaped the working directory flags paths while its value is the command,
 * so the two nouns are for two different things.
 */
export function flaggedElementLabel(payload: PromptPayload): string {
  return payload.kind === "bash_external_directory"
    ? "path"
    : valueLabel(payload);
}

/** What the decision-relevant value is called, per ask shape. */
export function valueLabel(payload: PromptPayload): string {
  switch (payload.kind) {
    case "bash":
    case "bash_external_directory":
      return "command";
    case "mcp":
      return "target";
    case "tool":
      return "tool";
    case "path":
    case "external_directory":
      return "path";
    case "skill":
    case "skill_read":
      return "skill";
    case "forwarded":
      return forwardedValueLabel(payload.request.surface);
  }
}

/**
 * Labels the version-skew render only: a payload-bearing forwarded ask carries
 * the child's real `kind` and never reaches this arm (#745).
 *
 * Without a payload all that survives is the child's *display* projection — its
 * tool name as the surface — so the label is inferred from it and falls back to
 * a neutral one.
 */
function forwardedValueLabel(surface: string): string {
  switch (surface) {
    case "bash":
      return "command";
    case "skill":
      return "skill";
    default:
      return "value";
  }
}

/**
 * Human-readable label for a nested bash execution context, or `undefined` for
 * a current-shell (top-level) command.
 */
export function describeBashCommandContext(
  context: BashCommandContext | null,
): string | undefined {
  switch (context) {
    case "command_substitution":
      return "command substitution";
    case "process_substitution":
      return "process substitution";
    case "subshell":
      return "subshell";
    case null:
      return undefined;
  }
}
