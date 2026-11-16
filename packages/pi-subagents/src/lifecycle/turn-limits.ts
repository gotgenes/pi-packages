/**
 * turn-limits.ts — The turn-budget policy for subagent execution.
 *
 * Owns the budget's shape, the limit normalization the subagent tool's
 * spawn-config resolution shares, and the tracker that decides, turn by turn,
 * when the turn loop in SubagentSession warns the child or stops it. The
 * decisions live here, apart from the session, so the policy is testable
 * without one.
 */

/** What the harness has done about a run's turn limit, in the order it happens. */
export type TurnBudgetPhase = "within" | "warned" | "exhausted";

/**
 * A run's turn limit and its use. Present only when a limit exists.
 *
 * `phase` is recorded rather than derived from the counts: whether the harness
 * warned or stopped the run is an event, and an agent that answered on its last
 * permitted turn has the same counts as one the harness cut off.
 */
export interface TurnBudget {
  /** The ceiling; absent for an unlimited run. */
  maxTurns?: number;
  /** Successful turns completed in this run. */
  used: number;
  phase: TurnBudgetPhase;
}

/** What the turn loop must do after a turn boundary: warn the child, stop it, or nothing. */
export type TurnBudgetAction = "warn" | "stop" | undefined;

/** How one turn ended, as far as the budget is concerned. */
export interface TurnOutcome {
  /** The response errored or was aborted; such a turn does not spend budget. */
  failed: boolean;
  /** The turn ran tools, so the agent loop goes on to another turn. */
  ranTools: boolean;
}

/**
 * Counts a run's successful turns and decides when the harness warns the child
 * about its remaining budget and when it stops the run at the ceiling.
 *
 * The warning goes out once `wrapUpTurns` turns remain (`warnAt = maxTurns −
 * wrapUpTurns`, floored at 0), but only after a turn that ran tools: such a
 * turn guarantees another one, which is where the child reads the warning. A
 * warning after a final answer would sit in the transcript unread until a
 * resume, by then stale.
 *
 * The ceiling stops the run after turn `maxTurns` when that turn ran tools; a
 * ceiling turn without tool calls is the child's answer, and the run ends on
 * its own. A turn that starts past the ceiling anyway (a steer queued on the
 * final turn forces one) is stopped as it starts.
 */
export class TurnBudgetTracker {
  private readonly maxTurns: number | undefined;
  private readonly warnAt: number | undefined;
  private used = 0;
  private phase: TurnBudgetPhase = "within";

  constructor(limits: TurnLimits) {
    this.maxTurns = limits.maxTurns;
    this.warnAt = limits.maxTurns == null ? undefined : Math.max(0, limits.maxTurns - limits.wrapUpTurns);
  }

  /** Whether the budget must be stated before the first turn; records the warning when it must. */
  warnBeforeFirstTurn(): boolean {
    if (this.warnAt !== 0 || this.phase !== "within") return false;
    this.phase = "warned";
    return true;
  }

  /** Account for a turn that just ended. */
  onTurnEnd(turn: TurnOutcome): TurnBudgetAction {
    if (turn.failed) return undefined;
    this.used++;
    if (this.maxTurns == null || this.warnAt == null || !turn.ranTools) return undefined;
    if (this.used >= this.maxTurns) {
      this.phase = "exhausted";
      return "stop";
    }
    if (this.phase === "within" && this.used >= this.warnAt) {
      this.phase = "warned";
      return "warn";
    }
    return undefined;
  }

  /** Account for a turn about to start. */
  onTurnStart(): TurnBudgetAction {
    if (this.maxTurns == null || this.phase === "exhausted" || this.used < this.maxTurns) return undefined;
    this.phase = "exhausted";
    return "stop";
  }

  /** Turns left before the ceiling; undefined for an unlimited run. */
  get remaining(): number | undefined {
    return this.maxTurns == null ? undefined : this.maxTurns - this.used;
  }

  /** A snapshot of the budget, safe to hand to the record. */
  get budget(): TurnBudget {
    return this.maxTurns == null
      ? { used: this.used, phase: this.phase }
      : { maxTurns: this.maxTurns, used: this.used, phase: this.phase };
  }
}

/**
 * A run that finished on its own after the harness warned it about its turn
 * limit: the one outcome every presentation qualifies with a turn-limit caveat.
 * Takes the two fields it reads, so any outcome-shaped object satisfies it.
 */
export function wrappedUpAtTurnLimit(outcome: { status: string; turnBudget?: TurnBudget }): boolean {
  return outcome.status === "completed" && outcome.turnBudget?.phase === "warned";
}

/**
 * The fewest turns a run may have: a subagent's result is its final response,
 * so it needs one turn to work and one to answer.
 */
export const MIN_MAX_TURNS = 2;

/** Normalize max turns. undefined or 0 = unlimited, otherwise at least MIN_MAX_TURNS. */
export function normalizeMaxTurns(n: number | undefined): number | undefined {
  if (n == null || n === 0) return undefined;
  return Math.max(MIN_MAX_TURNS, n);
}

/** The turn-limit inputs a run's caller supplies; the agent's own limit comes from its config. */
export interface TurnLimitRequest {
  /** Per-call max-turns override: highest precedence. */
  maxTurns?: number;
  /** Runtime-config fallback when neither the call nor the agent sets a limit. */
  defaultMaxTurns?: number;
  /** Turns left when the child is warned about its budget (`wrapUpTurns` setting). */
  wrapUpTurns?: number;
}

/** The limits every run of one session is held to. */
export interface TurnLimits {
  maxTurns?: number;
  wrapUpTurns: number;
}

/** Wrap-up turns when the run config names none; matches the setting's default. */
const DEFAULT_WRAP_UP_TURNS = 2;

/**
 * Resolve a session's turn limits: the per-call limit, then the agent's, then
 * the runtime default, normalized; and the requested wrap-up turns.
 */
export function resolveTurnLimits(
  request: TurnLimitRequest | undefined,
  agentMaxTurns: number | undefined,
): TurnLimits {
  return {
    maxTurns: normalizeMaxTurns(request?.maxTurns ?? agentMaxTurns ?? request?.defaultMaxTurns),
    wrapUpTurns: request?.wrapUpTurns ?? DEFAULT_WRAP_UP_TURNS,
  };
}

/** Whether a configured limit is a real one below the minimum, which normalizeMaxTurns raises. */
export function isBelowMinimumTurns(n: number | undefined): n is number {
  return n != null && n !== 0 && n < MIN_MAX_TURNS;
}
