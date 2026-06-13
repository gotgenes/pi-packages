import { stripBashCommentLines } from "./bash-arity";
import { getNonEmptyString, toRecord } from "./common";
import { createMcpPermissionTargets } from "./mcp-targets";
import { getPathPolicyValues, PATH_BEARING_TOOLS } from "./path-utils";

/**
 * Construct a surface-appropriate input object from a raw value string.
 *
 * This is the inverse of `normalizeInput()` — it builds the minimal input
 * object that `PermissionManager.checkPermission()` expects for a given
 * surface, from a single string value.
 *
 * Used by the event-bus RPC handler and the `Symbol.for()` service accessor
 * so external callers can query policy with `(surface, value)` instead of
 * constructing a full tool-call input payload.
 *
 * Note: MCP inputs are complex (server name + tool name derivation). Callers
 * providing an MCP surface receive a best-effort policy evaluation using the
 * value as a pre-qualified target string. Pass the fully-qualified target
 * (e.g. "exa:search" or "exa") directly.
 */
export function buildInputForSurface(
  surface: string,
  value: string | undefined,
): unknown {
  const v = value ?? "";
  if (surface === "bash") return { command: v };
  if (surface === "skill") return { name: v };
  if (surface === "external_directory") return { path: v };
  // MCP and tool surfaces: normalizeInput handles them from the surface alone.
  return {};
}

/**
 * Surface-normalized representation of a tool invocation used by
 * `checkPermission()` to feed a single `evaluateFirst()` call.
 */
export interface NormalizedInput {
  /** The permission surface for `evaluate()` (e.g. "bash", "mcp", "skill"). */
  surface: string;
  /**
   * Candidate lookup values in priority order (most-specific first).
   * Most surfaces produce a single-element array; MCP produces a
   * multi-candidate list derived from the invocation input.
   */
  values: string[];
  /**
   * Surface-specific fields forwarded verbatim into `PermissionCheckResult`
   * (e.g. `{ command }` for bash, `{ target }` for mcp).
   */
  resultExtras: Record<string, unknown>;
}

const SPECIAL_PERMISSION_KEYS = new Set(["external_directory", "path"]);

/**
 * Map a raw tool invocation to the surface/values/extras triple needed by
 * `checkPermission()`.
 *
 * @param toolName - Normalized (trimmed) tool name from the tool-call event.
 * @param input    - Raw input payload from the tool-call event.
 * @param configuredMcpServerNames - Ordered list of MCP server names from the
 *   global MCP config, used to derive server-qualified MCP targets.
 */
export function normalizeInput(
  toolName: string,
  input: unknown,
  configuredMcpServerNames: readonly string[],
  cwd?: string,
): NormalizedInput {
  // --- Special surfaces (path, external_directory) ---
  if (SPECIAL_PERMISSION_KEYS.has(toolName)) {
    return {
      surface: toolName,
      values: normalizePathSurfaceValues(input, cwd),
      resultExtras: {},
    };
  }

  // --- Skill ---
  if (toolName === "skill") {
    const record = toRecord(input);
    const skillName = record.name;
    const lookupValue = typeof skillName === "string" ? skillName : "*";
    return {
      surface: "skill",
      values: [lookupValue],
      resultExtras: {},
    };
  }

  // --- Bash ---
  if (toolName === "bash") {
    const record = toRecord(input);
    const command = typeof record.command === "string" ? record.command : "";
    // Strip leading shell comment lines so pattern matching operates on the
    // actual command, not a `# description` prefix agents often prepend.
    // Fall back to the raw command when stripping leaves nothing, so an
    // all-comment command still evaluates against its literal text.
    const matchValue = stripBashCommentLines(command) || command;
    return {
      surface: "bash",
      values: [matchValue],
      resultExtras: { command },
    };
  }

  // --- MCP ---
  if (toolName === "mcp") {
    const mcpTargets = [
      ...createMcpPermissionTargets(input, configuredMcpServerNames),
      "mcp",
    ];
    const fallbackTarget = mcpTargets[0] ?? "mcp";
    return {
      surface: "mcp",
      values: mcpTargets,
      resultExtras: { target: fallbackTarget },
    };
  }

  // --- Path-bearing tools (read, write, edit, grep, find, ls) ---
  if (PATH_BEARING_TOOLS.has(toolName)) {
    return {
      surface: toolName,
      values: normalizePathSurfaceValues(input, cwd),
      resultExtras: {},
    };
  }

  // --- Extension tools (non-path-bearing) ---
  return {
    surface: toolName,
    values: ["*"],
    resultExtras: {},
  };
}

/**
 * Extract and normalize the path lookup values shared by every path surface
 * (`path`, `external_directory`, and the path-bearing tools).
 *
 * Missing, empty, or whitespace-only paths collapse to the surface catch-all
 * `"*"`. When CWD is known, a relative path also produces a normalized
 * absolute policy value and a project-relative alias while keeping its legacy
 * relative value, so values match home- and cwd-anchored patterns
 * symmetrically with how the patterns themselves are expanded (#350).
 *
 * Only `input.path` is read — policy values are never sourced from any other
 * (potentially attacker-controlled) field on the raw tool input.
 */
function normalizePathSurfaceValues(input: unknown, cwd?: string): string[] {
  const path = getNonEmptyString(toRecord(input).path);
  if (path === null) return ["*"];
  const values = getPathPolicyValues(path, cwd ? { cwd } : {});
  return values.length > 0 ? values : ["*"];
}
