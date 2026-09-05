import type { SessionApproval } from "./session-approval";

/** Records a granted session-scoped approval into the session ruleset. */
export interface SessionApprovalRecorder {
  recordSessionApproval(approval: SessionApproval): void;
}
