import type {
  DenyWithReason,
  FlatPermissionConfig,
  PatternValue,
  PermissionState,
} from "./config-schema";
import type { RuleOrigin } from "./rule";

// The config-file shape types are derived from the zod schema
// (config-schema.ts) — the single source of truth — and re-exported here so
// existing importers keep their import path.
export type {
  DenyWithReason,
  FlatPermissionConfig,
  PatternValue,
  PermissionState,
  RuleOrigin,
};

/**
 * Per-scope permission config shape after loading and validation.
 * Holds only the flat permission map — all policy is expressed there.
 */
export interface ScopeConfig {
  permission?: FlatPermissionConfig;
  /**
   * True when the scope's config file was present but failed to load or
   * validate (JSON parse error or schema rejection). Absent and valid files
   * leave this unset. Drives the fail-closed allow→ask clamp for non-global
   * scopes (#646).
   */
  invalid?: boolean;
}

/**
 * Execution context of a bash command nested inside a substitution or subshell.
 * Absent for current-shell (top-level) commands.
 */
export type BashCommandContext =
  | "command_substitution"
  | "process_substitution"
  | "subshell";

export interface PermissionCheckResult {
  toolName: string;
  state: PermissionState;
  /** Custom denial reason from a deny-with-reason pattern, when present. */
  reason?: string;
  matchedPattern?: string;
  command?: string;
  target?: string;
  source: "tool" | "bash" | "mcp" | "skill" | "special" | "default" | "session";
  /** Which source contributed the winning rule. */
  origin: RuleOrigin;
  /**
   * Execution context of the offending nested command, when the winning bash
   * unit came from a substitution or subshell. Absent for current-shell
   * (top-level) commands.
   */
  commandContext?: BashCommandContext;
  /**
   * The command the winning bash unit actually runs, when it is a wrapper whose
   * inner command differs from the unit text (#713). Display-only: the gate
   * still decides on `command`, so this never widens or narrows a decision.
   */
  executedUnit?: string;
}

export function isPermissionState(value: unknown): value is PermissionState {
  return value === "allow" || value === "deny" || value === "ask";
}

/**
 * Narrow type guard: a raw value representing a DenyWithReason object.
 * Accepts `{ action: "deny" }` and `{ action: "deny", reason: "…" }`.
 * Rejects a non-string `reason` to keep malformed config out of the rule set.
 */
export function isDenyWithReason(value: unknown): value is DenyWithReason {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.action === "deny" &&
    (record.reason === undefined || typeof record.reason === "string")
  );
}
