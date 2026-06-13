import { prefix, stripBashCommentLines } from "./bash-arity";
import { PATH_BEARING_TOOLS } from "./path-utils";
import { deriveApprovalPattern } from "./session-rules";

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
 * Suggest a session-approval pattern for the given permission surface and value.
 *
 * Returns a `SessionApprovalSuggestion` with the surface, the wildcard pattern
 * to store in `SessionRules`, and a human-readable dialog label.
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
    case "external_directory":
      pattern = deriveApprovalPattern(value);
      break;
    case "path":
      pattern = deriveApprovalPattern(value);
      break;
    default:
      // Path-bearing tools: derive a directory-scoped pattern from the path.
      if (PATH_BEARING_TOOLS.has(surface) && value !== "*") {
        pattern = deriveApprovalPattern(value);
        break;
      }
      // Extension tools / fallback.
      pattern = "*";
      break;
  }

  return { surface, pattern, label: buildLabel(pattern, surface) };
}
