import type { PermissionCheckResult } from "#src/types";
import type { GateRunner } from "./runner";
import { describeSkillInputGate } from "./skill-input";
import type { GateOutcome } from "./types";

// ── Interfaces ────────────────────────────────────────────────────────────────

/**
 * Narrow interface the pipeline needs from its session-side dependency.
 *
 * A raw `checkPermission` (no session rules) — preserves the skill-input
 * semantics established in #326 where the skill-input gate intentionally
 * bypasses session-rule resolution.
 *
 * `PermissionSession` satisfies this structurally at the construction call
 * site; no `implements` clause is needed and would create a layer-inversion
 * import from the domain module into the handler layer.
 */
export interface SkillInputGateInputs {
  checkPermission(
    surface: string,
    input: unknown,
    agentName?: string,
  ): PermissionCheckResult;
}

/**
 * Narrow UI seam: warn the user when a skill is denied.
 *
 * The handler builds this per-event from `ctx`, encapsulating the `hasUI`
 * guard so the pipeline never touches `ExtensionContext` directly
 * (Tell-Don't-Ask: the pipeline tells the notifier to warn; the notifier
 * decides whether a UI is present).
 */
export interface GateNotifier {
  warn(message: string): void;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Owns the skill-input gate assembly: raw permission pre-check, deny notify,
 * `describeSkillInputGate` descriptor, and `runner.run(...)`.
 *
 * Constructed once in the composition root and injected into
 * `PermissionGateHandler`, mirroring `ToolCallGatePipeline` for the `input`
 * path.
 *
 * `evaluate` is not `async` because it has no `await` of its own — it returns
 * `runner.run(...)` directly (`@typescript-eslint/require-await` would reject
 * an `async` body with no `await`).
 */
export class SkillInputGatePipeline {
  constructor(private readonly inputs: SkillInputGateInputs) {}

  evaluate(
    skillName: string,
    agentName: string | null,
    notifier: GateNotifier,
    runner: GateRunner,
  ): Promise<GateOutcome> {
    const check = this.inputs.checkPermission(
      "skill",
      { name: skillName },
      agentName ?? undefined,
    );
    if (check.state === "deny") {
      notifier.warn(formatSkillDenyNotice(skillName, agentName));
    }
    return runner.run(
      describeSkillInputGate(skillName, agentName, check),
      agentName,
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format the deny warning shown in the UI when a skill is blocked.
 *
 * Intentionally untagged (no `[pi-permission-system]` prefix) — this is a
 * UI notify distinct from the agent-facing deny reasons the runner routes
 * through `renderPolicyDenial`.
 */
export function formatSkillDenyNotice(
  skillName: string,
  agentName: string | null,
): string {
  return agentName
    ? `Skill '${skillName}' is not permitted for agent '${agentName}'.`
    : `Skill '${skillName}' is not permitted by the current skill policy.`;
}
