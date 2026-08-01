import type {
  PersistentApprovalScope,
  PersistentApprovalTarget,
} from "#src/persistent-approval-service";
import type { PermissionPromptDecision } from "./permission-dialog";

export interface PermissionRuleProposalData {
  surface: string;
  patterns: readonly string[];
}

export interface PersistentPermissionChoice {
  kind: "persist";
  scope: PersistentApprovalScope;
  proposal: PermissionRuleProposalData;
  target: PersistentApprovalTarget;
  /** True only after the exact durable rule summary was rendered and confirmed. */
  summaryShown: boolean;
}

export type InteractivePermissionChoice =
  | PermissionPromptDecision
  | PersistentPermissionChoice;

export function isPersistentPermissionChoice(
  choice: InteractivePermissionChoice,
): choice is PersistentPermissionChoice {
  return "kind" in choice;
}
