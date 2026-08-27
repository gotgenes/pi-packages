import type { DecisionSource } from "#src/authority/decision-source";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type {
  ForwardedAccessFacts,
  ForwardedSessionApproval,
} from "#src/authority/permission-forwarding";
import type { PromptPayload } from "#src/presentation/prompt-payload";
import { renderReviewLogFacts } from "#src/presentation/review-log-renderer";
import type { ReviewLogger } from "#src/session-logger";
import type { TerminalAuthorizer } from "./authorizer";

export type PermissionReviewSource = "tool_call" | "skill_input" | "skill_read";

/**
 * Provenance of a forwarded ask: who is really asking, one hop below.
 *
 * Present on {@link PromptPermissionDetails} only when the ask was forwarded
 * from a subagent. Structurally identical to the event's `ForwardedPromptContext`
 * so the details flow straight into `buildUiPrompt`, but declared here to keep
 * the prompter layer free of an events-module import.
 */
export interface ForwardedAskProvenance {
  requesterAgentName: string | null;
  requesterSessionId: string | null;
}

/** Details passed when prompting the user for a permission decision. */
export interface PromptPermissionDetails {
  requestId: string;
  source: PermissionReviewSource;
  agentName: string | null;
  /**
   * The complete structured description of this ask (ADR 0011 §2).
   *
   * Required: every ask carries one, and the type is what guarantees it rather
   * than a convention each gate has to remember. Every consumer — the dialog,
   * the wire, the broadcast, the review log, the agent-facing denial text — is
   * a render over it, so no two of them can disagree.
   */
  payload: PromptPayload;
  toolCallId?: string;
  toolName?: string;
  skillName?: string;
  path?: string;
  command?: string;
  target?: string;
  toolInputPreview?: string;
  /** Override label for the "for this session" dialog option. */
  sessionLabel?: string;
  /** Explicit display-surface override (a forwarded ask carries the child's original). */
  surface?: string | null;
  /** Explicit display-value override (a forwarded ask carries the child's original). */
  value?: string | null;
  /** Present iff this ask was forwarded from a subagent; drives the non-degraded broadcast + "(Subagent)" title. */
  forwarding?: ForwardedAskProvenance;
  /**
   * The session-approval suggestion for this ask. On the child's escalation it
   * rides into the forwarded request; on the serving node it lets the dialog
   * offer a whole-session grant scope. Absent when the gate computed no
   * suggestion.
   */
  sessionApproval?: ForwardedSessionApproval;
  /**
   * The child-fixed access facts the raising gate computed (surface + match
   * set). Rides through the runner to the escalation edge, which completes
   * them into a `ForwardedAccessIntent` by stamping `requesterCwd` and
   * `principal`. On a serving node these facts are projected back off the
   * forwarded request, so a forwarded ask reaches the `Authorizer` chain with
   * the same evidence as a local one; only a version-skew request that carried
   * no intent leaves this absent.
   */
  accessIntent?: ForwardedAccessFacts;
}

/**
 * Narrow seam onto {@link PermissionPrompter}.
 *
 * Kept separate from the concrete class so consumers (e.g. `AuthorizerSelection`)
 * can inject a plain `{ prompt: vi.fn() }` mock in tests — a private field on
 * the concrete class would create a nominal brand that a structural mock
 * cannot satisfy without a cast.
 */
export interface PermissionPrompterApi {
  prompt(
    authorizer: TerminalAuthorizer,
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision>;
}

/** Dependencies required by {@link PermissionPrompter}. */
export interface PermissionPrompterDeps {
  /** Write structured entries to the permission review log. */
  logger: ReviewLogger;
}

/**
 * Brackets the ask-path flow with review-log entries and delegates the
 * live decision to the selected {@link TerminalAuthorizer}:
 *   1. Review-log "waiting" entry.
 *   2. `authorizer.authorize(details)`.
 *   3. Review-log "approved" / "denied" entry.
 *
 * The UI/forwarding branching this class previously owned now lives on the
 * individual `Authorizer` implementations (`LocalUserAuthorizer`,
 * `ParentAuthorizer`, `DenyingAuthorizer`) — this class no longer threads
 * `ExtensionContext` per call.
 *
 * Yolo-mode auto-approval happens upstream: at the composition stage
 * (`PermissionManager.check`'s `rewriteAsksToYolo`) for a rule-driven ask, and
 * at `GateRunner`'s auto-approve fast path (`resolveYoloGrant`) for an ask
 * synthesized after resolution, which no rule rewrite can reach (#712) — an
 * `ask` never reaches this class under yolo, so it has no yolo-mode knowledge.
 */
export class PermissionPrompter implements PermissionPrompterApi {
  constructor(private readonly deps: PermissionPrompterDeps) {}

  async prompt(
    authorizer: TerminalAuthorizer,
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision> {
    this.writeReviewEntry("permission_request.waiting", details);

    const decision = await authorizer.authorize(details);

    this.writeReviewEntry(
      decision.approved
        ? "permission_request.approved"
        : "permission_request.denied",
      {
        ...details,
        resolution: decision.confirmationUnavailable
          ? "confirmation_unavailable"
          : decision.state,
        denialReason: decision.denialReason,
        decidedBy: decision.decidedBy,
      },
    );

    return decision;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * The `waiting` entry carries no `decidedBy` — nothing has decided yet, and
   * a `null` there would read as "decided by nobody" rather than "not yet".
   */
  private writeReviewEntry(
    event: string,
    details: PromptPermissionDetails & {
      resolution?: string;
      denialReason?: string;
      decidedBy?: DecisionSource;
    },
  ): void {
    this.deps.logger.review(event, {
      ...(details.decidedBy ? { decidedBy: details.decidedBy } : {}),
      requestId: details.requestId,
      source: details.source,
      agentName: details.agentName,
      ...renderReviewLogFacts(details.payload),
      toolCallId: details.toolCallId ?? null,
      toolName: details.toolName ?? null,
      skillName: details.skillName ?? null,
      path: details.path ?? null,
      command: details.command ?? null,
      target: details.target ?? null,
      toolInputPreview: details.toolInputPreview ?? null,
      resolution: details.resolution ?? null,
      denialReason: details.denialReason ?? null,
    });
  }
}
