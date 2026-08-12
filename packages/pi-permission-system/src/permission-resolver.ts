import type {
  AccessIntent,
  PathValuesAccessIntent,
  ResolvedAccessIntent,
} from "./access-intent/access-intent";
import type {
  PermissionResolutionContext,
  ScopedPermissionManager,
} from "./permission-manager";
import type { Rule } from "./rule";
import type { SessionRules } from "./session-rules";
import type { SkillPermissionChecker } from "./skill-prompt-sanitizer";
import type { PermissionCheckResult, PermissionState } from "./types";

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
   */
  resolve(
    intent: AccessIntent | PathValuesAccessIntent,
    context?: PermissionResolutionContext,
  ): PermissionCheckResult {
    const resolvedIntent = toResolvedIntent(intent);
    const rules = this.sessionRules.getRuleset();
    return context
      ? this.permissionManager.check(resolvedIntent, rules, context)
      : this.permissionManager.check(resolvedIntent, rules);
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

  getToolPermission(toolName: string, agentName?: string): PermissionState {
    return this.permissionManager.getToolPermission(toolName, agentName);
  }

  getConfigIssues(agentName?: string): string[] {
    return this.permissionManager.getConfigIssues(agentName);
  }
}
