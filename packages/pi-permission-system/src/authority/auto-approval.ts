import type { TerminalAuthorizer } from "./authorizer";
import type {
  AutoApproveScopeKind,
  AutoApproveSetter,
  DecisionSource,
} from "./decision-source";
import type { PermissionPromptDecision } from "./permission-dialog";
import type { PromptPermissionDetails } from "./permission-prompter";

/**
 * Which asks one auto-approve scope covers: this node's own asks, every ask a
 * child forwarded here, or the forwarded asks of one requesting agent.
 */
export type AutoApproveScope =
  | { kind: "own" }
  | { kind: "forwarded" }
  | { kind: "agent"; agentName: string };

/** The decider an auto-approve scope stamps on the ask it covers. */
export type AutoApproveGrant = Extract<
  DecisionSource,
  { kind: "auto_approve" }
>;

/** The part of an ask that decides which scope covers it. */
type AskProvenance = Pick<PromptPermissionDetails, "forwarding">;

/**
 * The coverage question the authorizer selection asks per ask: the grant to
 * allow it under when a scope covers it, or `null` when none does.
 */
export interface AutoApproveGrants {
  grantFor(details: AskProvenance): AutoApproveGrant | null;
}

interface ScopeEntry {
  scope: AutoApproveScope;
  setter: AutoApproveSetter;
}

/**
 * One session's auto-approve state (ADR 0016 §5): which scopes are on, and
 * what turned each on.
 *
 * In memory only, and built inside the extension factory, so a session switch
 * (which re-invokes the factory) starts it empty; nothing here is ever read
 * from or written to a file.
 */
export class AutoApproval implements AutoApproveGrants {
  private readonly scopes = new Map<string, ScopeEntry>();

  /** Turn `scope` on, recording `setter` as what did. */
  enable(scope: AutoApproveScope, setter: AutoApproveSetter): void {
    this.scopes.set(scopeKey(scope), { scope, setter });
  }

  /** Turn `scope` off, or every scope when none is named. */
  disable(scope?: AutoApproveScope): void {
    if (scope === undefined) {
      this.scopes.clear();
      return;
    }
    this.scopes.delete(scopeKey(scope));
  }

  /**
   * The decider for an ask a scope covers, or `null`.
   *
   * An ask without forwarding provenance is this node's own; a forwarded ask
   * is covered by its requesting agent's scope first, so the record names the
   * narrower grant when both are on.
   */
  grantFor(details: AskProvenance): AutoApproveGrant | null {
    const forwarding = details.forwarding;
    if (forwarding === undefined) {
      return this.decidedBy("own");
    }
    const agentName = forwarding.requesterAgentName;
    const byAgent =
      agentName === null
        ? undefined
        : this.scopes.get(scopeKey({ kind: "agent", agentName }));
    if (byAgent !== undefined) {
      return toDecidedBy(byAgent);
    }
    return this.decidedBy("forwarded");
  }

  /** Whether any scope covers asks forwarded to this node. */
  answersForwardedAsks(): boolean {
    for (const { scope } of this.scopes.values()) {
      if (scope.kind !== "own") return true;
    }
    return false;
  }

  /** Whether any scope is on. */
  isActive(): boolean {
    return this.scopes.size > 0;
  }

  /** The scopes that are on and what set each, for an operator to read. */
  describe(): string {
    if (this.scopes.size === 0) return "off";
    return [...this.scopes.values()]
      .map(({ scope, setter }) => `${scopeLabel(scope)} (${setter})`)
      .join(", ");
  }

  private decidedBy(kind: "own" | "forwarded"): AutoApproveGrant | null {
    const entry = this.scopes.get(kind);
    return entry === undefined ? null : toDecidedBy(entry);
  }
}

/**
 * The auto-approve terminal: the mirror of `DenyingAuthorizer`, allowing every
 * ask it is handed under the grant that selected it.
 *
 * Selected per ask, for an ask a scope covers, so it is reached only after
 * every chain link deferred. It records no session grant and prompts nobody.
 */
export class AutoApprovingAuthorizer implements TerminalAuthorizer {
  constructor(private readonly decidedBy: AutoApproveGrant) {}

  authorize(): Promise<PermissionPromptDecision> {
    return Promise.resolve({
      approved: true,
      state: "approved",
      decidedBy: this.decidedBy,
    });
  }
}

function scopeKey(scope: AutoApproveScope): string {
  return scope.kind === "agent" ? `agent:${scope.agentName}` : scope.kind;
}

function scopeLabel(scope: AutoApproveScope): string {
  return scope.kind === "agent" ? `agent ${scope.agentName}` : scope.kind;
}

function toDecidedBy({ scope, setter }: ScopeEntry): AutoApproveGrant {
  const kind: AutoApproveScopeKind = scope.kind;
  return { kind: "auto_approve", setter, scope: kind };
}
