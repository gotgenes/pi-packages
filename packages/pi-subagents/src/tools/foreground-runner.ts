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
import type { ResolvedSpawnConfig } from "#src/tools/spawn-config";
import type { ParentSessionInfo, Subagent } from "#src/types";
import { type AgentDetails, describeActivity, formatMs } from "#src/ui/display";
import { SPINNER } from "#src/ui/glyphs";

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
 * Owns: spinner interval, streaming onUpdate callbacks, cleanup, and result formatting.
 */
export async function runForeground(
  manager: ForegroundManagerDeps,
  params: ForegroundParams,
  signal: AbortSignal | undefined,
  onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
) {
  const { identity, execution, presentation } = params.config;
  let spinnerFrame = 0;
  const startedAt = Date.now();

  let recordRef: Subagent | undefined;

  const streamUpdate = () => {
    const toolUses = recordRef?.toolUses ?? 0;
    const details: AgentDetails = {
      ...presentation.detailBase,
      toolUses,
      tokens: recordRef ? formatLifetimeTokens(recordRef) : "",
      // Read activity off the record; fall back to safe defaults before onSessionCreated fires
      turnCount: recordRef?.turnCount ?? 1,
      maxTurns: recordRef?.maxTurns ?? execution.effectiveMaxTurns,
      durationMs: Date.now() - startedAt,
      status: "running",
      activity: describeActivity(
        recordRef?.activeTools ?? new Map(),
        recordRef?.responseText ?? "",
      ),
      spinnerFrame: spinnerFrame % SPINNER.length,
    };
    onUpdate?.({
      content: [{ type: "text", text: `${toolUses} tool uses...` }],
      details,
    });
  };

  // Animate spinner at ~80ms (smooth rotation through 10 braille frames)
  const spinnerInterval = setInterval(() => {
    spinnerFrame++;
    streamUpdate();
  }, 80);

  streamUpdate();

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
    clearInterval(spinnerInterval);
    return textResult(err instanceof Error ? err.message : String(err));
  }

  clearInterval(spinnerInterval);

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
    // The ask-back affordance is not composed here: a failed run answers no
    // question, so this is the addenda tail minus the one that cannot apply.
    return textResult(
      `${noteText}Agent failed: ${record.error}\nAgent ID: ${record.id}` +
        renderRunUpdates(record.runUpdates) +
        renderWorkspaceNotice(record.workspaceNotice),
      details,
    );
  }

  const durationMs = (record.completedAt ?? Date.now()) - record.startedAt;
  const statsParts = [`${record.toolUses} tool uses`];
  if (tokenText) statsParts.push(tokenText);
  return textResult(
    `${noteText}Agent completed in ${formatMs(durationMs)} (${statsParts.join(", ")})${renderStatusNote(record.status)}.\n` +
      `Agent ID: ${record.id}\n\n` +
      renderOutcomeBody(record) +
      renderOutcomeAddenda(record),
    details,
  );
}
