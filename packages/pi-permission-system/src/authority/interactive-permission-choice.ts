import type {
  PersistentApprovalScope,
  PersistentApprovalTarget,
} from "#src/persistence/persistent-approval-service";
import type { ApprovalGrant } from "#src/session/approval-grant";
import type { DecisionSource } from "./decision-source";
import type {
  PermissionPromptDecision,
  UnattributedDecision,
} from "./permission-dialog";

/**
 * The rule a prompt proposes to record: one grant per pattern, each on the
 * surface the gate proved for it (#810). The human may edit the patterns
 * before choosing how long the rule lives.
 */
export interface PermissionRuleProposalData {
  grants: readonly ApprovalGrant[];
}

/**
 * The human chose to write the rule to a config file.
 *
 * A private choice rather than a decision state: the public `Authorizer`
 * verdict and the forwarded wire both stay `allow | deny | defer`, so nothing
 * outside the local dialog can construct a durable write. Only
 * `LocalUserAuthorizer` turns this into a decision, and only after the write
 * succeeded.
 */
export interface UnattributedPersistentChoice {
  kind: "persist";
  scope: PersistentApprovalScope;
  proposal: PermissionRuleProposalData;
  target: PersistentApprovalTarget;
  /** True only after the exact durable rule summary was rendered and confirmed. */
  summaryShown: boolean;
}

export type PersistentPermissionChoice = UnattributedPersistentChoice & {
  decidedBy: DecisionSource;
};

/** What a presenter (dialog model or `select` fallback) returns. */
export type UnattributedChoice =
  | UnattributedDecision
  | UnattributedPersistentChoice;

/** A presenter's choice once the dispatcher has named the human surface. */
export type InteractivePermissionChoice =
  | PermissionPromptDecision
  | PersistentPermissionChoice;

export function isPersistentPermissionChoice<
  T extends UnattributedChoice | InteractivePermissionChoice,
>(choice: T): choice is Extract<T, UnattributedPersistentChoice> {
  return "kind" in choice;
}
