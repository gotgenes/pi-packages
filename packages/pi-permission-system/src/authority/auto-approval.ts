import type { SessionAutoApproveToggle } from "#src/config/config-modal";
import { EXTENSION_ID } from "#src/config/extension-config";
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

/** Where the auto-approve indicator is shown: the session's status bar. */
export interface AutoApproveStatusSink {
  ui: { setStatus(key: string, text: string | undefined): void };
}

/**
 * The session-lifecycle half of auto-approve: read the launch flag when a
 * session starts, and take the indicator down when it ends.
 */
export interface AutoApproveLifecycle {
  applyLaunchFlag(sink: AutoApproveStatusSink): void;
  clearStatus(sink: AutoApproveStatusSink): void;
}

/** The status-bar text shown while any auto-approve scope is on. */
const AUTO_APPROVE_STATUS = "auto-approve";

/** The status-bar key this extension owns. */
const STATUS_KEY = EXTENSION_ID;

/**
 * One session's auto-approve state (ADR 0016 §5): which scopes are on, and
 * what turned each on.
 *
 * In memory only, and built inside the extension factory, so a session switch
 * (which re-invokes the factory) starts it empty; nothing here is ever read
 * from or written to a file.
 */
export class AutoApproval
  implements AutoApproveGrants, AutoApproveLifecycle, SessionAutoApproveToggle
{
  private readonly scopes = new Map<string, ScopeEntry>();

  /**
   * @param readLaunchFlag Whether the process was launched with
   *   `--auto-approve`. A reader rather than a value: Pi fills a flag's value
   *   only after the extension factory has run.
   */
  constructor(private readonly readLaunchFlag: () => boolean = () => false) {}

  /**
   * Turn on this node's own and forwarded asks when the process was launched
   * with `--auto-approve`, then show the indicator. Called as a session starts,
   * before forwarding is, so a headless node knows it can serve.
   */
  applyLaunchFlag(sink: AutoApproveStatusSink): void {
    if (this.readLaunchFlag()) {
      this.enable({ kind: "own" }, "flag");
      this.enable({ kind: "forwarded" }, "flag");
    }
    this.syncStatus(sink);
  }

  /** Show the indicator while any scope is on, and clear it otherwise. */
  syncStatus(sink: AutoApproveStatusSink): void {
    sink.ui.setStatus(
      STATUS_KEY,
      this.isActive() ? AUTO_APPROVE_STATUS : undefined,
    );
  }

  /** Take the indicator down, as the session ends. */
  clearStatus(sink: AutoApproveStatusSink): void {
    sink.ui.setStatus(STATUS_KEY, undefined);
  }

  /** Turn `scope` on, recording `setter` as what did. */
  enable(scope: AutoApproveScope, setter: AutoApproveSetter): void {
    this.scopes.set(scopeKey(scope), { scope, setter });
  }

  /**
   * The modal's toggle: on turns this node's own and forwarded asks on, off
   * turns every scope off; either way the command is the setter.
   */
  setAll(on: boolean, sink: AutoApproveStatusSink): void {
    if (on) {
      this.enable({ kind: "own" }, "command");
      this.enable({ kind: "forwarded" }, "command");
    } else {
      this.disable();
    }
    this.syncStatus(sink);
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
