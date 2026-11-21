/**
 * recorded-model.ts — The model a reopened child transcript selects.
 *
 * Pi restores a reopened session's model from its branch, not from the model
 * `buildSessionContext()` reports: a response names the physical model that
 * answered, so a virtual model (a router whose requests Pi redirects) is held
 * only by the `model_change` entry that selected it. This mirrors Pi's own rule
 * (`getBranchSelection` in `core/virtual-models.ts`, not exported), so a
 * continued child runs on the selection Pi itself would restore.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "#src/session/model-resolver";

/** The API id Pi gives a virtual model's catalog entry and a response routing failed to resolve. */
const VIRTUAL_MODEL_API = "pi-virtual";

/** The branch-entry fields the selection reads; Pi's `SessionEntry` satisfies it. */
export interface BranchEntryLike {
  readonly type: string;
  readonly provider?: string;
  readonly modelId?: string;
  readonly message?: {
    readonly role: string;
    readonly provider?: string;
    readonly model?: string;
    readonly api?: string;
  };
}

/** A model selection as a branch records it. */
export interface ModelSelection {
  provider: string;
  modelId: string;
}

/**
 * The model selection a branch records: the latest `model_change`, or the
 * latest physical response — unless a `model_change` before that response
 * selected a virtual model the registry still knows, which holds instead.
 */
export function branchModelSelection(
  branch: readonly BranchEntryLike[],
  registry: Pick<ModelRegistry, "find">,
): ModelSelection | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    const change = asModelChange(entry);
    if (change) return change;
    const message = entry.type === "message" ? entry.message : undefined;
    if (message?.role !== "assistant" || message.api === VIRTUAL_MODEL_API) continue;
    if (message.provider === undefined || message.model === undefined) continue;
    const earlier = lastModelChange(branch, i);
    const selected = earlier && registry.find(earlier.provider, earlier.modelId);
    return selected && isVirtual(selected) ? earlier : { provider: message.provider, modelId: message.model };
  }
  return undefined;
}

/** The model the branch's latest `model_change` selected: the route the child last chose, if it chose one. */
export function latestModelChange(branch: readonly BranchEntryLike[]): ModelSelection | undefined {
  return lastModelChange(branch, branch.length);
}

function lastModelChange(branch: readonly BranchEntryLike[], before: number): ModelSelection | undefined {
  for (let i = before - 1; i >= 0; i--) {
    const change = asModelChange(branch[i]);
    if (change) return change;
  }
  return undefined;
}

function asModelChange(entry: BranchEntryLike): ModelSelection | undefined {
  if (entry.type !== "model_change" || entry.provider === undefined || entry.modelId === undefined) return undefined;
  return { provider: entry.provider, modelId: entry.modelId };
}

function isVirtual(model: Model<any>): boolean {
  return model.api === VIRTUAL_MODEL_API;
}
