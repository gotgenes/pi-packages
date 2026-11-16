import { debugLog } from "#src/debug";
import type { SubagentManagerObserver } from "#src/lifecycle/subagent-manager";
import type { RunKind } from "#src/lifecycle/subagent-run";
import type { CompactionInfo, Subagent } from "#src/types";

/**
 * Fans out SubagentManager lifecycle notifications to multiple observers.
 *
 * Lets the manager keep its single-observer contract while several independent
 * consumers (event/notification dispatch, the reactive widget) subscribe.
 * Each delegate is isolated: a throw in one does not suppress the others.
 */
export class CompositeSubagentObserver implements SubagentManagerObserver {
  private readonly delegates: SubagentManagerObserver[];

  constructor(delegates: SubagentManagerObserver[]) {
    this.delegates = [...delegates];
  }

  /** Register an additional observer (breaks the widget↔manager construction cycle). */
  add(observer: SubagentManagerObserver): void {
    this.delegates.push(observer);
  }

  onSubagentRunStarted(record: Subagent, kind: RunKind): void {
    this.dispatch((o) => o.onSubagentRunStarted(record, kind), "onSubagentRunStarted");
  }

  onSubagentCreated(record: Subagent): void {
    this.dispatch((o) => o.onSubagentCreated(record), "onSubagentCreated");
  }

  onSubagentRunFinished(record: Subagent, kind: RunKind): void {
    this.dispatch((o) => o.onSubagentRunFinished(record, kind), "onSubagentRunFinished");
  }

  onSubagentUpdate(record: Subagent, message: string): void {
    this.dispatch((o) => o.onSubagentUpdate?.(record, message), "onSubagentUpdate");
  }

  /**
   * Required here even though `SubagentManagerObserver` declares it optional:
   * the manager's observer is always this composite, so a member it does not
   * enumerate is dropped silently — no compiler error, no runtime error, and
   * the announcement simply never fires.
   */
  onSubagentWorkspaceNotice(record: Subagent, notice: string): void {
    this.dispatch(
      (o) => o.onSubagentWorkspaceNotice?.(record, notice),
      "onSubagentWorkspaceNotice",
    );
  }

  onSubagentCompacted(record: Subagent, info: CompactionInfo): void {
    this.dispatch((o) => o.onSubagentCompacted(record, info), "onSubagentCompacted");
  }

  private dispatch(call: (o: SubagentManagerObserver) => void, label: string): void {
    for (const o of this.delegates) {
      try {
        call(o);
      } catch (err) {
        debugLog(`CompositeSubagentObserver.${label}`, err);
      }
    }
  }
}
