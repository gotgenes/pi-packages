import { stripBashCommentLines } from "#src/bash-arity";
import type { PathNormalizer } from "#src/path-normalizer";
import { getNonEmptyString, toRecord } from "#src/value-guards";
import type { AccessIntent, ResolvedAccessIntent } from "./access-intent";
import { createMcpPermissionTargets } from "./mcp-targets";
import { PATH_SURFACES, surfaceFamilyOf } from "./path-surfaces";
import { classifyToolKind } from "./tool-kind";

/**
 * Build the {@link AccessIntent} an external policy query (the `Symbol.for()`
 * service and the event-bus RPC) feeds to the resolver from a `(surface, value)`
 * pair.
 *
 * For a path-shaped surface (`path`, `external_directory`, or a path-bearing
 * tool) carrying a non-empty value, it builds an `AccessPath` and emits an
 * `access-path` intent, so the resolver matches the lexical aliases ∪ canonical
 * (symlink-resolved) set — at parity with the gates (#486, #502). Every other
 * surface, and any value-less surface-level query, keeps the `tool` intent so
 * the manager's `normalizeInput` `["*"]` fallback is preserved.
 */
export function buildAccessIntentForSurface(
  surface: string,
  value: string | undefined,
  normalizer: PathNormalizer,
  agentName: string | undefined,
): AccessIntent {
  const pathValue = getNonEmptyString(value);
  if (pathValue !== null && PATH_SURFACES.has(surface)) {
    return {
      kind: "access-path",
      surface,
      path: normalizer.forPath(pathValue),
      agentName,
    };
  }
  return {
    kind: "tool",
    surface,
    input: buildInputForSurface(surface, value),
    agentName,
  };
}

/**
 * Build a {@link ResolvedAccessIntent} directly from a forwarded request's
 * child-fixed match values (ADR 0008 §2), for the forwarded-serving wire
 * (#597).
 *
 * Unlike {@link buildAccessIntentForSurface}, this never touches a
 * `PathNormalizer` and never rebuilds an `AccessPath` — a path-shaped surface
 * gets a `path-values` intent carrying `matchValues` as-is (the values the
 * child already fixed), and every other surface gets a `tool` intent built
 * from its single portable value. `agentName` is always the requester's
 * `principal.agentName` (ADR 0008 §3, agent-scoped serving).
 */
export function buildResolvedIntentFromMatchValues(
  surface: string,
  matchValues: readonly string[],
  agentName: string,
): ResolvedAccessIntent {
  if (PATH_SURFACES.has(surface)) {
    return {
      kind: "path-values",
      surface,
      values: [...matchValues],
      agentName,
    };
  }
  return {
    kind: "tool",
    surface,
    input: buildInputForSurface(surface, matchValues[0]),
    agentName,
  };
}

/**
 * Construct a surface-appropriate input object from a raw value string for the
 * `tool`-intent branch of {@link buildAccessIntentForSurface} (the non-path
 * surfaces and value-less path queries).
 *
 * This is the inverse of `normalizeInput()` — it builds the minimal input
 * object that the manager expects for a given surface, from a single string
 * value.
 *
 * Note: MCP inputs are complex (server name + tool name derivation). Callers
 * providing an MCP surface receive a best-effort policy evaluation using the
 * value as a pre-qualified target string. Pass the fully-qualified target
 * (e.g. "exa:search" or "exa") directly.
 */
function buildInputForSurface(
  surface: string,
  value: string | undefined,
): unknown {
  const v = value ?? "";
  if (surface === "bash") return { command: v };
  if (surface === "skill") return { name: v };
  if (surfaceFamilyOf(surface) === "external_directory") return { path: v };
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

/**
 * Map a raw tool invocation to the surface/values/extras triple needed by
 * `checkPermission()`.
 *
 * Handles bash, skill, mcp, and extension surfaces. Path-bearing tool surfaces
 * (`path`, `external_directory`, `read`, `write`, `edit`, `grep`, `find`,
 * `ls`) now route through the access-path gate (#502) and service/RPC builder
 * (#503) before reaching the manager, so they never arrive here with a real
 * path value — all fall through to the extension catch-all `["*"]`.
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
): NormalizedInput {
  switch (classifyToolKind(toolName)) {
    // --- Skill ---
    case "skill": {
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
    case "bash": {
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
    case "mcp": {
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

    // --- All other surfaces (path-bearing tools and extension tools) ---
    // Path-bearing tools with a present path never reach here — the gate emits
    // an access-path intent (#502). Missing-path and extension-tool cases both
    // collapse to the surface catch-all.
    case "path":
    case "extension":
      return {
        surface: toolName,
        values: ["*"],
        resultExtras: {},
      };
  }
}
