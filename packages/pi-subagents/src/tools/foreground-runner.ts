import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { AgentSpawnConfig } from "#src/lifecycle/subagent-manager";
import {
  renderOutcomeAddenda,
  renderOutcomeBody,
  renderRunUpdates,
  renderStatusNote,
  renderWorkspaceNotice,
} from "#src/observation/outcome-delivery";
import {
  buildDetails,
  formatLifetimeTokens,
  renderSpawnNotes,
  textResult,
} from "#src/tools/helpers";
import { startProgressStream } from "#src/tools/progress-stream";
import type { ResolvedSpawnConfig } from "#src/tools/spawn-config";
import type { ParentSessionInfo, Subagent } from "#src/types";
import { type AgentDetails, formatMs } from "#src/ui/display";

/** Narrow manager interface for the foreground runner. */
export interface ForegroundManagerDeps {
  spawnAndWait(
    snapshot: ParentSnapshot,
    type: string,
    prompt: string,
    opts: Omit<AgentSpawnConfig, "background">,
  ): Promise<Subagent>;
}

/** All values the foreground runner needs beyond the resolved config. */
export interface ForegroundParams {
  config: ResolvedSpawnConfig;
  snapshot: ParentSnapshot;
  parentSession: ParentSessionInfo;
}

/**
 * Run an agent synchronously in the foreground, streaming spinner updates.
 * Owns: the progress stream's lifetime around the run, and result formatting.
 */
export async function runForeground(
  manager: ForegroundManagerDeps,
  params: ForegroundParams,
  signal: AbortSignal | undefined,
  onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
) {
  const { identity, execution, presentation } = params.config;
  let recordRef: Subagent | undefined;
  const stopStream = startProgressStream({
    detailBase: presentation.detailBase,
    onUpdate,
    getRecord: () => recordRef,
  });

  let record: Subagent;
  try {
    record = await manager.spawnAndWait(
      params.snapshot,
      identity.subagentType,
      execution.prompt,
      {
        description: execution.description,
        model: execution.model,
        maxTurns: execution.effectiveMaxTurns,
        inheritContext: execution.inheritContext,
        thinkingLevel: execution.thinking,
        signal,
        parentSession: params.parentSession,
        observer: {
          onSessionCreated: (agent) => {
            recordRef = agent;
          },
        },
      },
    );
  } catch (err) {
    return textResult(err instanceof Error ? err.message : String(err));
  } finally {
    stopStream();
  }

  // Foreground-return delivery edge: the result is handed back in this tool
  // result, so the outcome is collected. Mark it consumed.
  record.markConsumed();

  const tokenText = formatLifetimeTokens(record);
  const details = buildDetails(presentation.detailBase, record, { tokens: tokenText });

  const noteText = renderSpawnNotes(params.config.notes);

  if (record.status === "error") {
    // A failed run has no result text, so this return is the only carrier that
    // can say where its workspace saved the work — or what the child flagged
    // before the failure, which is the one place those findings survive.
    // The transcript pointer rides here for the same reason: with no result to
    // read, it is the parent's only route to what the child did before it died.
    // The success branch omits it deliberately — that return carries the result.
    // The ask-back affordance is not composed here: a failed run answers no
    // question, so this is the addenda tail minus the one that cannot apply.
    const transcriptLine = record.outputFile
      ? `\nFull transcript available at: ${record.outputFile}`
      : "";
    return textResult(
      `${noteText}Agent failed: ${record.error}\nAgent ID: ${record.id}${transcriptLine}` +
        renderRunUpdates(record.runUpdates) +
        renderWorkspaceNotice(record.workspaceNotice),
      details,
    );
  }

  const durationMs = (record.completedAt ?? Date.now()) - record.startedAt;
  const statsParts = [`${record.toolUses} tool uses`];
  if (tokenText) statsParts.push(tokenText);
  return textResult(
    `${noteText}Agent completed in ${formatMs(durationMs)} (${statsParts.join(", ")})${renderStatusNote(record)}.\n` +
      `Agent ID: ${record.id}\n\n` +
      renderOutcomeBody(record) +
      renderOutcomeAddenda(record),
    details,
  );
}
