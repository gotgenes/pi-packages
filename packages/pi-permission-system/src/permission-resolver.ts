import type {
  AccessIntent,
  ResolvedAccessIntent,
} from "./access-intent/access-intent";
import type { ScopedPermissionManager } from "./permission-manager";
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
  /**
   * Returns true when at least one explicit `path`-surface rule is configured.
   * Gates use this as a fast-path skip to avoid `fs.realpath()` calls on every
   * tool invocation when no path rules are present.
   *
   * Optional so that lightweight mock resolvers in tests that don't exercise
   * symlink resolution are not required to implement it — the gate defaults to
   * `false` (skip resolution) when the method is absent.
   */
  hasPathRules?(agentName?: string): boolean;
}

/**
 * Reduce a gate-emitted {@link AccessIntent} to the string-based
 * {@link ResolvedAccessIntent} the manager consumes.
 *
 * Tell-Don't-Ask: the resolver asks an `AccessPath` for its `matchValues()`,
 * so the low-level manager never imports the value object.
 */
function toResolvedIntent(intent: AccessIntent): ResolvedAccessIntent {
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
   */
  resolve(intent: AccessIntent): PermissionCheckResult {
    return this.permissionManager.check(
      toResolvedIntent(intent),
      this.sessionRules.getRuleset(),
    );
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

  hasPathRules(agentName?: string): boolean {
    return this.permissionManager.hasPathRules?.(agentName) ?? false;
  }
}
