import {
  type CapabilityDirection,
  PATH_BEARING_TOOLS,
  surfaceFamilyOf,
} from "#src/access-intent/path-surfaces";
import type { ApprovalGrant } from "./approval-grant";
import { prefix, stripBashCommentLines } from "./bash-arity";

/** The suggestion returned for a "Yes, for this session" dialog option. */
export interface SessionApprovalSuggestion {
  /** The permission surface this approval applies to. */
  surface: string;
  /** The wildcard pattern to store as a session rule. */
  pattern: string;
  /** Human-readable label for the "for session" dialog option. */
  label: string;
}

/**
 * Suggest a bash session-approval pattern from a command string.
 *
 * Uses the arity table (`src/bash-arity.ts`) to identify the semantically
 * meaningful prefix tokens for the command, then produces a wildcard pattern:
 *
 * - Single bare token (no args): exact command (`ls`).
 * - Arity prefix covers all tokens: trailing wildcard (`npm run build*`).
 * - Arity prefix shorter than token list: space + wildcard (`git checkout *`).
 * - Unknown command: first token + space wildcard (`mytool *`).
 */
export function suggestBashPattern(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "";
  // Strip leading shell comment lines so the suggestion is based on the
  // actual command, not a `# description` prefix agents often prepend.
  const stripped = stripBashCommentLines(trimmed);
  if (!stripped) return "";
  const tokens = stripped.split(/\s+/);
  if (tokens.length === 1) return stripped;
  const meaningful = prefix(tokens);
  if (meaningful.length >= tokens.length) {
    return `${stripped}*`;
  }
  return `${meaningful.join(" ")} *`;
}

/**
 * Suggest an MCP session-approval pattern from a resolved target string.
 *
 * - Qualified target (`server:tool`) → `server:*`
 * - Munged target (`server_tool`) → `server_*`
 * - Bare target (no separator) → `*`
 */
export function suggestMcpPattern(target: string): string {
  const trimmed = target.trim();

  const colonIndex = trimmed.indexOf(":");
  if (colonIndex > 0) {
    return `${trimmed.slice(0, colonIndex)}:*`;
  }

  const underscoreIndex = trimmed.indexOf("_");
  if (underscoreIndex > 0) {
    return `${trimmed.slice(0, underscoreIndex)}_*`;
  }

  return "*";
}

/** Scope labels for the forwarded-approval two-step scope select. */
export interface ForwardedScopeLabels {
  /** Least-privilege default: record on the requesting subagent only. */
  subagentLabel: string;
  /** Record on the serving node — covers the parent and all subagents. */
  servingSessionLabel: string;
}

/**
 * What an approval's grants cover, as one phrase.
 *
 * A single grant names its pattern; several name their count, because only the
 * external-directory gate aggregates an ask over many paths and there is no
 * pattern that describes them all. Requires at least one grant — an approval
 * with none is never offered as a session option.
 */
export function describeGrantTarget(grants: readonly ApprovalGrant[]): string {
  return grants.length === 1
    ? `"${grants[0].pattern}"`
    : `${grants.length} paths`;
}

/** The two session-option labels for an ask whose grants prove one direction. */
export interface DirectionalSessionLabels {
  /** The proven-direction grant — the least-privilege default. */
  sessionLabel: string;
  /** The both-directions grant, offered beside it (#813). */
  widenedLabel: string;
}

const DIRECTION_NOUNS: Record<CapabilityDirection, string> = {
  read: "reads",
  write: "writes",
};

/**
 * Label the two widths a directional ask's session grant can take.
 *
 * Both rows name the direction and the target, so the choice between them
 * contrasts on a stated axis rather than on "wider" (#813).
 */
export function buildDirectionalSessionLabels(
  direction: CapabilityDirection,
  target: string,
): DirectionalSessionLabels {
  return {
    sessionLabel: `Yes, allow ${DIRECTION_NOUNS[direction]} to ${target} for this session`,
    widenedLabel: `Yes, allow ${DIRECTION_NOUNS.read} and ${DIRECTION_NOUNS.write} to ${target} for this session`,
  };
}

/**
 * Build the two scope labels shown when a human grants a forwarded request
 * "for this session."
 *
 * The subagent option names the requester (least privilege); the whole-session
 * option restates what is being granted session-wide — every grant, not the
 * first of them (the residual #810 deferred here).
 *
 * The surface is named as the grants' shared **family**, never a directional
 * member: these labels are built before the dialog runs, so a direction here
 * could contradict a width the human chooses inside it. Grants that share no
 * family name no surface at all.
 */
export function buildForwardedScopeLabels(
  agentName: string | null,
  grants: readonly ApprovalGrant[],
): ForwardedScopeLabels {
  const subagentLabel = agentName
    ? `This subagent ('${agentName}') only`
    : "This subagent only";
  const family = sharedSurfaceFamilyOf(grants);
  const granted = family
    ? `${family} ${describeGrantTarget(grants)}`
    : describeGrantTarget(grants);
  return {
    subagentLabel,
    servingSessionLabel: `The whole session — allow ${granted} for parent and all subagents`,
  };
}

/** The family every grant belongs to, or `null` when they disagree. */
function sharedSurfaceFamilyOf(
  grants: readonly ApprovalGrant[],
): string | null {
  if (grants.length === 0) return null;
  const family = surfaceFamilyOf(grants[0].surface);
  return grants.every((grant) => surfaceFamilyOf(grant.surface) === family)
    ? family
    : null;
}

/** Surface-aware human-readable labels for the session-approval option. */
function buildLabel(pattern: string, surface: string): string {
  switch (surface) {
    case "bash":
      return `Yes, allow bash "${pattern}" for this session`;
    case "mcp":
      return `Yes, allow mcp tool "${pattern}" for this session`;
    case "skill":
      return `Yes, allow skill "${pattern}" for this session`;
    case "external_directory":
      return `Yes, allow access to external directory "${pattern}" for this session`;
    case "path":
      return `Yes, allow path "${pattern}" for this session`;
    default:
      // Path-bearing tools with a specific path pattern show the pattern.
      if (PATH_BEARING_TOOLS.has(surface) && pattern !== "*") {
        return `Yes, allow ${surface} "${pattern}" for this session`;
      }
      // Tool surfaces with catch-all or extension tools.
      return `Yes, allow tool "${surface}" for this session`;
  }
}

/**
 * Suggest a session-approval pattern from a surface's own value vocabulary —
 * a bash command, an MCP target, a skill name.
 *
 * Returns a `SessionApprovalSuggestion` with the surface, the wildcard pattern
 * to store in `SessionRules`, and a human-readable dialog label. Any surface
 * with no vocabulary of its own falls back to the catch-all wildcard, which is
 * also what a path-bearing tool invoked without a path resolves to.
 *
 * A path surface goes through {@link suggestPathSessionPattern} instead: its
 * pattern is a path-language product, and this module holds no path semantics.
 */
export function suggestSessionPattern(
  surface: string,
  value: string,
): SessionApprovalSuggestion {
  let pattern: string;

  switch (surface) {
    case "bash":
      pattern = suggestBashPattern(value);
      break;
    case "mcp":
      pattern = suggestMcpPattern(value);
      break;
    case "skill":
      pattern = value;
      break;
    default:
      // Extension tools, and path-bearing tools invoked without a path.
      pattern = "*";
      break;
  }

  return { surface, pattern, label: buildLabel(pattern, surface) };
}

/**
 * Build the suggestion for a path surface from a pattern the caller already
 * derived through its `PathNormalizer` (#655).
 *
 * The derivation belongs to the normalizer, which owns the session's
 * `PathFlavor`; this module labels the result and must not re-interpret the
 * separators it is handed.
 */
export function suggestPathSessionPattern(
  surface: string,
  approvalPattern: string,
): SessionApprovalSuggestion {
  return {
    surface,
    pattern: approvalPattern,
    label: buildLabel(approvalPattern, surface),
  };
}
