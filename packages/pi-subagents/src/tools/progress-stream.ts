/**
 * progress-stream.ts — The inline progress a foreground run streams to its tool call.
 *
 * A foreground run blocks the parent's tool call, so the call's own `onUpdate`
 * is where the operator watches it: a spinner tick re-renders the record's
 * live tool uses, tokens, turn budget, and activity under the call.
 */

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { formatLifetimeTokens } from "#src/tools/helpers";
import type { SpawnPresentation } from "#src/tools/spawn-config";
import type { Subagent } from "#src/types";
import { type AgentDetails, describeActivity, modelLabel } from "#src/ui/display";
import { SPINNER } from "#src/ui/glyphs";

/** The record fields one update renders. */
export type StreamedRecord = Pick<
  Subagent,
  "toolUses" | "model" | "lifetimeUsage" | "turnBudget" | "activeTools" | "responseText"
>;

export interface ProgressStreamParams {
  /** The call's presentation, which every update carries under its live fields. */
  detailBase: SpawnPresentation["detailBase"];
  onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined;
  /** The record to render; undefined until the run's session exists. */
  getRecord: () => StreamedRecord | undefined;
}

/** Smooth rotation through the spinner's frames. */
const SPINNER_INTERVAL_MS = 80;

/**
 * Stream one update now and one per spinner tick, until the returned stop is
 * called. Stopping is idempotent, so a caller can stop from a `finally`.
 */
export function startProgressStream(params: ProgressStreamParams): () => void {
  const { detailBase, onUpdate, getRecord } = params;
  const startedAt = Date.now();
  let spinnerFrame = 0;

  const streamUpdate = () => {
    const record = getRecord();
    const toolUses = record?.toolUses ?? 0;
    const details: AgentDetails = {
      ...detailBase,
      modelName: modelLabel(record?.model) ?? detailBase.modelName,
      toolUses,
      tokens: record ? formatLifetimeTokens(record) : "",
      turnBudget: record?.turnBudget,
      durationMs: Date.now() - startedAt,
      status: "running",
      activity: describeActivity(record?.activeTools ?? new Map(), record?.responseText ?? ""),
      spinnerFrame: spinnerFrame % SPINNER.length,
    };
    onUpdate?.({
      content: [{ type: "text", text: `${toolUses} tool uses...` }],
      details,
    });
  };

  const interval = setInterval(() => {
    spinnerFrame++;
    streamUpdate();
  }, SPINNER_INTERVAL_MS);
  streamUpdate();

  return () => clearInterval(interval);
}
