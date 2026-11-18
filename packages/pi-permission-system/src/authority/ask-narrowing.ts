import { suggestBashChainSessionPatterns } from "#src/presentation/pattern-suggest";
import { narrowBashAskPayload } from "#src/presentation/tool-ask-payload";
import { SessionApproval } from "#src/session/session-approval";
import type { AskingBashUnit } from "#src/types";
import type { ForwardedAccessFacts } from "./permission-forwarding";
import type { PromptPermissionDetails } from "./permission-prompter";

/**
 * What is left of an ask once some of its bash chain's asking units are
 * decided: nothing it names (`unchanged`), nothing at all (`settled`), or a
 * narrower ask over the rest (`narrowed`).
 */
export type NarrowedAsk =
  | { kind: "unchanged" }
  | { kind: "settled"; allowedUnits: readonly string[] }
  | {
      kind: "narrowed";
      details: PromptPermissionDetails;
      allowedUnits: readonly string[];
      remainingUnits: readonly string[];
    };

/**
 * Narrow a bash chain's ask to the asking units not named in `units`.
 *
 * Units are named by command text, so every unit with that text is decided:
 * identical text is an identical command. A name the ask does not list is
 * ignored, so a caller can never decide a unit the ask never asked about.
 *
 * The narrowed details describe the ask the gate would have raised had the
 * decided units never asked: the first unit left is the value, its own rule
 * the matched rule, and the session option grants a pattern per unit left.
 * Every field is rewritten only where the original carried it, so a forwarded
 * ask stays forwarded-shaped. Pure over data, so it serves a local ask and one
 * a serving node rebuilt from the wire alike.
 */
export function narrowAsk(
  details: PromptPermissionDetails,
  units: readonly string[],
): NarrowedAsk {
  // Asking units describe a bash chain, and only on the bash surface do they
  // name what the ask is about; a malformed or forged request that carries
  // them on another surface is not narrowed.
  if (details.accessIntent?.surface !== "bash") return { kind: "unchanged" };
  const asking = details.accessIntent.askingUnits ?? [];
  const named = new Set(units);
  const allowed = asking.filter((unit) => named.has(unit.command));
  if (allowed.length === 0) return { kind: "unchanged" };
  const allowedUnits = allowed.map((unit) => unit.command);
  const remaining = asking.filter((unit) => !named.has(unit.command));
  const head = remaining.at(0);
  if (head === undefined) return { kind: "settled", allowedUnits };
  return {
    kind: "narrowed",
    details: narrowedDetails(details, head, remaining),
    allowedUnits,
    remainingUnits: remaining.map((unit) => unit.command),
  };
}

function narrowedDetails(
  details: PromptPermissionDetails,
  head: AskingBashUnit,
  remaining: readonly AskingBashUnit[],
): PromptPermissionDetails {
  const {
    sessionApproval: offeredApproval,
    sessionLabel,
    command,
    value,
    accessIntent,
    ...rest
  } = details;
  const suggestion = suggestBashChainSessionPatterns(
    remaining.map((unit) => unit.command),
  );
  // Narrowing only ever shrinks the session option: an ask that offered none
  // gains none.
  const grantable =
    offeredApproval !== undefined && suggestion.patterns.length > 0;
  return {
    ...rest,
    payload: narrowBashAskPayload(details.payload, remaining),
    ...(accessIntent === undefined
      ? {}
      : { accessIntent: narrowedAccessFacts(accessIntent, head, remaining) }),
    ...(grantable
      ? {
          sessionApproval: SessionApproval.forPatterns(
            suggestion.surface,
            suggestion.patterns,
          ).toForwardedData(),
        }
      : {}),
    ...(grantable && sessionLabel !== undefined
      ? { sessionLabel: suggestion.label }
      : {}),
    ...(command === undefined ? {} : { command: head.command }),
    ...(value === undefined
      ? {}
      : { value: value === null ? null : head.command }),
  };
}

/**
 * The access facts of the narrowed ask: the head unit is the value, and the
 * floor is the first one a unit still asking raised, as the gate carries it.
 */
function narrowedAccessFacts(
  facts: ForwardedAccessFacts,
  head: AskingBashUnit,
  remaining: readonly AskingBashUnit[],
): ForwardedAccessFacts {
  const { floor: _floor, askingUnits: _askingUnits, ...rest } = facts;
  const floor = remaining.find((unit) => unit.floor !== undefined)?.floor;
  return {
    ...rest,
    matchValues: [head.command],
    ...(floor === undefined ? {} : { floor }),
    askingUnits: [...remaining],
  };
}
