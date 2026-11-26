/**
 * The message a session shutdown leaves in the parent session when it stops
 * subagents. Pi cannot defer or cancel a shutdown, and the completion nudges
 * are silenced before the aborts, so without it the parent and the user never
 * learn that the work was lost.
 */

/** What the notice reads from each stopped agent; a `Subagent` satisfies it structurally. */
export interface StoppedAgent {
  readonly id: string;
  readonly type: string;
  readonly description: string;
  readonly stoppedWhileQueued: boolean;
  readonly outputFile: string | undefined;
}

/** A displayed custom message, rendered by Pi's default custom-message component. */
export interface ShutdownNotice {
  readonly customType: "subagent-shutdown-notice";
  readonly content: string;
  readonly display: true;
}

/** What caused the shutdown, by Pi's `session_shutdown` reason. */
const CAUSES: ReadonlyMap<string, string> = new Map([
  ["reload", "`/reload`"],
  ["quit", "Quitting Pi"],
  ["new", "Starting a new session"],
  ["resume", "Switching sessions"],
  ["fork", "Forking the session"],
]);

/** The cause for a reason this version does not know, or a missing one. */
const UNKNOWN_CAUSE = "Ending the session";

/** Build the notice for the agents a shutdown stopped, in the order they were stopped. */
export function buildShutdownNotice(reason: string | undefined, stopped: readonly StoppedAgent[]): ShutdownNotice {
  const cause = (reason === undefined ? undefined : CAUSES.get(reason)) ?? UNKNOWN_CAUSE;
  const content = [
    `${cause} stopped these subagents before they finished, so their results will not arrive:`,
    ...stopped.map(describeStoppedAgent),
    "Spawn them again if the work is still needed.",
  ].join("\n");
  return { customType: "subagent-shutdown-notice", content, display: true };
}

function describeStoppedAgent(agent: StoppedAgent): string {
  const state = agent.stoppedWhileQueued ? "was queued." : "was running.";
  const transcript = agent.outputFile === undefined ? "" : ` Transcript: \`${agent.outputFile}\``;
  return `- \`${agent.id}\` (${agent.type}) "${agent.description}": ${state}${transcript}`;
}
