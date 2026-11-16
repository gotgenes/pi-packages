import { buildResolvedIntentFromMatchValues } from "#src/access-intent/input-normalizer";
import type { ServingPolicy } from "#src/authority/forwarded-request-server";
import type { ForwardedAccessIntent } from "#src/authority/permission-forwarding";
import type { AskingBashUnit, PermissionCheckResult } from "#src/types";
import type { PermissionResolver } from "./permission-resolver";
import { mostRestrictiveOf } from "./restrictiveness";

/**
 * The serving node's recorded authority over a forwarded request: the
 * child-fixed facts (ADR 0008) resolved against this node's composed ruleset,
 * agent-scoped to the requester (`principal.agentName`, §3), with the floor the
 * child raised honored.
 *
 * A bash chain is judged unit by unit: the child names its winner in
 * `matchValues`, but this answer approves the whole tool call, so every unit the
 * child left asking (`askingUnits`) is resolved with its own floor and the most
 * restrictive answer decides (#1030). Each unit is matched in the spellings the
 * child fixed for it (the home-expanded form, path arguments made absolute
 * against the child's cwd), never recomputed here, since only the child's parse
 * knows them (#1019). A request without units (an older child, or an ask raised
 * without a chain) is judged on its single value.
 *
 * The `matchValues` are used as the child fixed them, never re-derived through
 * this session's `PathNormalizer`/cwd. The resolver's surface-family fold is
 * what keeps a parent's bare `path` deny answering a child's request, which is
 * why this goes through `resolve` rather than the manager directly (#712, #806).
 */
export class ResolverServingPolicy implements ServingPolicy {
  constructor(
    private readonly resolver: Pick<PermissionResolver, "resolve">,
    private readonly isYoloEnabled: () => boolean,
  ) {}

  resolve(intent: ForwardedAccessIntent): PermissionCheckResult {
    const units = intent.askingUnits ?? [];
    const first = units.at(0);
    if (first === undefined) return this.resolveValue(intent);
    const judge = (unit: AskingBashUnit): PermissionCheckResult =>
      this.resolveUnit(unit, intent.principal.agentName);
    return mostRestrictiveOf([judge(first), ...units.slice(1).map(judge)]);
  }

  /**
   * Judge one unit the child left asking, with that unit's own floor.
   *
   * Resolved as the same `bash-command` intent the child's gate emitted for
   * it, spellings included, so a serving rule matches the unit exactly as a
   * local one would. A unit from an older child carries none and is matched as
   * typed.
   */
  private resolveUnit(
    unit: AskingBashUnit,
    agentName: string,
  ): PermissionCheckResult {
    const check = this.resolver.resolve({
      kind: "bash-command",
      surface: "bash",
      command: unit.command,
      spellings: unit.spellings ?? [],
      agentName,
    });
    return honorChildFloor(check, unit.floor, this.isYoloEnabled());
  }

  /**
   * Judge the intent's single child-fixed value, with the chain-level floor.
   */
  private resolveValue(intent: ForwardedAccessIntent): PermissionCheckResult {
    const check = this.resolver.resolve(
      buildResolvedIntentFromMatchValues(
        intent.surface,
        intent.matchValues,
        intent.principal.agentName,
      ),
    );
    return honorChildFloor(check, intent.floor, this.isYoloEnabled());
  }
}

/**
 * Clamp this node's `allow` with the floor the child raised, as the child's
 * own gate clamped its own (#1029).
 *
 * Only the child's parse knows a bash unit was a wrapper or failed to parse,
 * so without this a permissive serving rule answers exactly the ask the floor
 * exists to raise. The floor leaves three answers standing, each for the
 * reason it stands locally: a `deny` or `ask` decides before any floor is
 * consulted; a session grant names a command the user already approved, which
 * the local gate honors through its session fast path; and yolo approves every
 * synthetic ask, keeping the floor's sentinel as the reported pattern.
 */
function honorChildFloor(
  check: PermissionCheckResult,
  floor: string | undefined,
  yoloEnabled: boolean,
): PermissionCheckResult {
  if (
    floor === undefined ||
    check.state !== "allow" ||
    check.source === "session"
  ) {
    return check;
  }
  return yoloEnabled
    ? { ...check, origin: "yolo", matchedPattern: floor }
    : { ...check, state: "ask", matchedPattern: floor };
}
