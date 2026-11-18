import type {
  DenyWithReason,
  FlatPermissionConfig,
  PatternValue,
  PermissionState,
} from "#src/config/config-schema";
import type { RuleOrigin } from "#src/policy/rule";

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

/**
 * Why an indirection wrapper's floor did not apply after all (#803).
 *
 * `"core-reader"` — the command the wrapper runs is in the built-in pure-reader
 * core, so it is read-only for any argument feed and the floor's reason (an
 * unknown direction behind the wrapper) does not hold.
 *
 * `"execution-modifier"` — every wrapper layer (`time`, `timeout`, `nice`,
 * `stdbuf`, `setsid`) changes only how the visible inner command runs, so the
 * unit is decided by that command's own rule whatever it does (#963).
 *
 * `"no-command"` — the wrapper names no command at all, and its bare form runs
 * nothing (`env` alone prints the environment), so there is nothing for it to
 * hide and the unit is decided by its own rule, as `printenv` is.
 *
 * A named reason rather than a boolean, so the review log states *why* a
 * wrapper was let through, and so a later source (a chain verdict, a user
 * declaration) is an added member rather than a second flag. ADR 0013 §11
 * keeps both reasons package-audited; user declarations do not lift the floor.
 */
export type FloorExemption =
  | "core-reader"
  | "execution-modifier"
  | "no-command";

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
   * decides on `command`, and on `executedUnit`'s rules only when
   * {@link floorExemption} says the wrapper's floor has no reason to hold.
   */
  executedUnit?: string;
  /**
   * The spelling of the bash unit the winning rule matched, when the rule did
   * not also match the unit as typed — the absolute spelling of a relative
   * path argument, say (#910). Display-only: absent whenever the typed text
   * decided, and dropped by a floor that replaces {@link matchedPattern}.
   */
  matchedSpelling?: string;
  /**
   * Set when the winning bash unit is a wrapper the floor no longer covers,
   * naming why (#803, #963). Recorded in the review log so an allow the floor would
   * once have prompted for is auditable to the reason that let it through.
   */
  floorExemption?: FloorExemption;
  /**
   * The synthetic pattern of a floor that raised this ask on the bash chain —
   * on the deciding unit, or on another asking unit of the same command. Only
   * the child's parse knows it, so a forwarded ask carries it for the serving
   * node to clamp its own `allow` with.
   */
  floor?: string;
  /**
   * Every unit of the bash chain that resolved to `ask` and was not
   * session-granted, in chain order, each with its own floor. Set only on an
   * asking chain winner: the serving node of a forwarded ask judges each one,
   * since the winner alone would approve commands it never saw.
   */
  askingUnits?: readonly AskingBashUnit[];
}

/**
 * One unit of a bash chain the gate left asking, as the serving node of a
 * forwarded ask needs it: the unit as typed, the other spellings it was matched
 * in, and the floor that raised it — plus the rule it asked on, so an ask a
 * link narrows to this unit can name that rule.
 */
export interface AskingBashUnit {
  command: string;
  /**
   * The rule this unit resolved `ask` on, including a floor's sentinel.
   * Display-only: the serving node judges the unit against its own rules.
   */
  matchedPattern?: string;
  /**
   * The other spellings of `command` the child's shell runs identically, as
   * the child's program analysis produced them: home-expanded, and with path
   * arguments made absolute against the child's working directory. Child-fixed:
   * the serving node matches them as given and never recomputes them. Absent
   * when there are none.
   */
  spellings?: readonly string[];
  floor?: string;
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
