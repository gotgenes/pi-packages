import type {
  AccessIntent,
  PathValuesAccessIntent,
  ResolvedAccessIntent,
} from "#src/access-intent/access-intent";
import { surfaceFamilyMembers } from "#src/access-intent/path-surfaces";
import type { SessionRules } from "#src/session-rules";
import type { SkillPermissionChecker } from "#src/skill-prompt-sanitizer";
import type { PermissionCheckResult, PermissionState } from "#src/types";
import type { ScopedPermissionManager } from "./permission-manager";
import { mostRestrictiveOf } from "./restrictiveness";
import type { Rule } from "./rule";

/**
 * Answers an {@link AccessIntent} a gate emits, applying the current session
 * rules internally.
 *
 * A single `resolve(intent)` entry point means adding a gate cannot widen the
 * resolver surface, and a test fixture cannot stub one resolution method and
 * forget another (the #393 false-green class) — #478.
 */
export interface ScopedPermissionResolver {
  resolve(intent: AccessIntent): PermissionCheckResult;
}

/**
 * Reduce a gate-emitted {@link AccessIntent} to the string-based
 * {@link ResolvedAccessIntent} the manager consumes.
 *
 * Tell-Don't-Ask: the resolver asks an `AccessPath` for its `matchValues()`,
 * so the low-level manager never imports the value object.
 *
 * This is the sole `matchValues()` unwrap site — the single place the lexical ∪
 * canonical alias set (#418) is derived. Keeping it here (not in the manager)
 * is the deliberate boundary formalized in ADR-0002
 * (`docs/decisions/0002-path-values-string-boundary.md`).
 *
 * Also accepts an already-resolved {@link PathValuesAccessIntent} (the
 * forwarded-serving wire's producer, #597) as a pure passthrough — it is
 * already a `ResolvedAccessIntent`, so there is nothing to unwrap.
 */
function toResolvedIntent(
  intent: AccessIntent | PathValuesAccessIntent,
): ResolvedAccessIntent {
  if (intent.kind === "access-path") {
    return {
      kind: "path-values",
      surface: intent.surface,
      values: intent.path.matchValues(),
      agentName: intent.agentName,
    };
  }
  return intent;
}

/**
 * Concrete collaborator that owns the resolution surface.
 *
 * Holds a `ScopedPermissionManager` and a `SessionRules` store, composing
 * them so callers never thread the session ruleset by hand.
 *
 * Constructor deps:
 * - `permissionManager` — the narrow session-scoped permission-checking interface
 * - `sessionRules` — narrowed to `getRuleset` (ISP: the resolver only reads, never records)
 */
export class PermissionResolver
  implements ScopedPermissionResolver, SkillPermissionChecker
{
  constructor(
    private readonly permissionManager: ScopedPermissionManager,
    private readonly sessionRules: Pick<SessionRules, "getRuleset">,
  ) {}

  /**
   * Answer a gate-emitted access intent, composing the current session ruleset
   * so callers never thread it by hand. Unwraps the `access-path` variant via
   * `matchValues()` before handing a string-based intent to the manager.
   *
   * Also accepts a pre-fixed `path-values` intent (the forwarded-serving wire,
   * #597) — a passthrough, since it is already a `ResolvedAccessIntent`. The
   * gate-facing {@link ScopedPermissionResolver} interface stays narrow
   * (`AccessIntent` only); this wider acceptance is available only through the
   * concrete `PermissionResolver` instance the composition root holds.
   *
   * An intent naming a bare surface family (`path`, `external_directory`) is
   * folded over the family's directional members, most-restrictive (ADR 0013
   * §10's fail-closed base case). The fold lives here rather than in the gates
   * because this is the one entry point the gates, `LocalPermissionsService`,
   * and `ServingPolicy` all share — a serving node resolving a forwarded child
   * request against an emptied bare surface would stop hard-denying what the
   * parent's config denies (the #712 defect class).
   */
  resolve(
    intent: AccessIntent | PathValuesAccessIntent,
  ): PermissionCheckResult {
    const resolved = toResolvedIntent(intent);
    const sessionRuleset = this.sessionRules.getRuleset();
    const members = surfaceFamilyMembers(resolved.surface);
    if (members === null) {
      return this.permissionManager.check(resolved, sessionRuleset);
    }
    const [first, ...rest] = members;
    const checkMember = (surface: string): PermissionCheckResult =>
      this.permissionManager.check({ ...resolved, surface }, sessionRuleset);
    return mostRestrictiveOf([
      checkMember(first),
      ...rest.map((surface) => checkMember(surface)),
    ]);
  }

  /**
   * Raw permission check without session rules — the no-session-rules path
   * consumed by `SkillInputGateInputs` / `SkillPermissionChecker`.
   *
   * Not on `ScopedPermissionResolver` (ISP: gates do not use this).
   */
  checkPermission(
    surface: string,
    input: unknown,
    agentName?: string,
    sessionRules?: Rule[],
  ): PermissionCheckResult {
    return this.permissionManager.check(
      { kind: "tool", surface, input, agentName },
      sessionRules,
    );
  }

  // Reached only through `LocalPermissionsService`'s structural resolver view,
  // which fallow cannot trace; `tsc` enforces it at that constructor. The
  // handler's exposure check moved to `isToolFullyDenied` in #815, leaving this
  // the published cross-extension catch-all query and nothing else.
  // fallow-ignore-next-line unused-class-member
  getToolPermission(toolName: string, agentName?: string): PermissionState {
    return this.permissionManager.getToolPermission(toolName, agentName);
  }

  isToolFullyDenied(toolName: string, agentName?: string): boolean {
    return this.permissionManager.isToolFullyDenied(toolName, agentName);
  }

  getConfigIssues(agentName?: string): string[] {
    return this.permissionManager.getConfigIssues(agentName);
  }
}
