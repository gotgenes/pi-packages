/**
 * session-navigation.ts — Pure selection and transcript-sourcing for native session navigation.
 *
 * Splits the unit-testable core of the `/subagents:sessions` command from its TUI
 * wiring (`session-navigator.ts`): which subagents are navigable and how a picked
 * agent's transcript is sourced (live, in this slice).
 *
 * The `TranscriptSource` seam decouples *how messages are sourced* (live record
 * here; a file snapshot in a follow-up) from *how they render* — the renderer
 * (`session-navigator.ts`, which mounts Pi's per-entry components) talks only to
 * this seam. Rendering lives in the SDK/TUI module because the per-entry
 * components require a `TUI`, `cwd`, and markdown theme.
 */

import { buildSessionContext, parseSessionEntries, type SessionEntry, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentConfigLookup } from "#src/config/agent-types";
import { isRunningStatus, type SubagentStatus } from "#src/lifecycle/subagent-state";
import type { PersistedRunSummary } from "#src/persisted-record";
import type { AgentSessionEvent, SessionMessage, SubagentType } from "#src/types";
import { formatRunDuration, getDisplayName, getPromptModeLabel, type ModelIdentity, type RunTiming } from "#src/ui/display";

// ─────────────────────────────────────────────────────────────────────────────

/** The record fields the navigator reads to label and live-source a transcript. */
export interface NavigableSubagent {
  readonly id: string;
  readonly type: SubagentType;
  readonly description: string;
  readonly status: SubagentStatus;
  readonly startedAt: number;
  readonly completedAt: number | undefined;
  /** Whether the current run was stopped before the limiter admitted it. */
  readonly stoppedWhileQueued: boolean;
  readonly toolUses: number;
  readonly activeTools: ReadonlyMap<string, string>;
  readonly responseText: string;
  readonly agentMessages: readonly SessionMessage[];
  /** Persisted transcript path, retained after the live session is released. */
  readonly outputFile: string | undefined;
  /** The model the agent runs, when known. */
  readonly model: ModelIdentity | undefined;
  /** The thinking level the agent runs at, when known. */
  readonly thinkingLevel: string | undefined;
  isSessionReady(): boolean;
  subscribeToUpdates(fn: (event: AgentSessionEvent) => void): (() => void) | undefined;
  getToolDefinition(name: string): ToolDefinition | undefined;
}

/**
 * A navigable entry plus the label shown in the picker.
 *
 * A `live` entry sources its transcript from the in-memory record; a `snapshot`
 * entry sources it from the persisted session file (the session was released by
 * the retention sweep, but the record and its transcript pointer survive).
 */
export type NavigationEntry =
  | { readonly kind: "live"; readonly label: string; readonly heading: EntryHeading; readonly record: NavigableSubagent }
  | { readonly kind: "snapshot"; readonly label: string; readonly heading: EntryHeading; readonly outputFile: string };

/** Who produced a transcript, for the pane's header. Fixed for the life of the entry. */
export interface EntryHeading {
  readonly name: string;
  /** `twin` for an append-mode agent; undefined otherwise. */
  readonly modeLabel: string | undefined;
  readonly description: string;
}

/** The fields `buildLabel` reads — shared by the live and snapshot (released-session) label paths. */
interface LabelFields extends RunTiming {
  readonly type: SubagentType;
  readonly description: string;
  readonly toolUses: number;
}

/** The model and thinking level a transcript's session runs at. */
export interface SessionModel {
  readonly model: ModelIdentity | undefined;
  readonly thinkingLevel: string | undefined;
}

/** Running-agent streaming state, surfaced by a live source. */
export interface StreamingState {
  readonly activeTools: ReadonlyMap<string, string>;
  readonly responseText: string;
}

/** Liveness-agnostic transcript source consumed by the renderer. */
export interface TranscriptSource {
  /** Current message history. */
  getMessages(): readonly SessionMessage[];
  /**
   * Subscribe to changes; returns an unsubscribe, or undefined for a static
   * snapshot. The session event is forwarded so a consumer can route on it —
   * a streaming delta and a settled message warrant very different work.
   */
  subscribe(onChange: (event?: AgentSessionEvent) => void): (() => void) | undefined;
  /** Running-agent streaming state, or undefined when not streaming. */
  streaming(): StreamingState | undefined;
  /** Resolve a registered tool definition by name, for Pi's tool-execution components. */
  getToolDefinition(name: string): ToolDefinition | undefined;
  /** Model and thinking level, read at call time: a live child can switch either mid-run. */
  sessionModel(): SessionModel;
}

/**
 * Label every navigable subagent for the picker: records with a live session
 * source their transcript in-memory (`live`); records whose session the
 * retention sweep released but which retain a transcript pointer source it from
 * disk (`snapshot`). Records with neither are not navigable. Live entries first.
 *
 * `persisted` carries the runs the parent session recorded, which outlive the
 * manager's records across a `/reload` or `/resume`. One the manager no longer
 * holds is listed as a snapshot after the manager's own entries; the manager's
 * record wins for any run it still holds.
 */
export function listNavigableAgents(
  agents: readonly NavigableSubagent[],
  registry: AgentConfigLookup,
  persisted: readonly PersistedRunSummary[],
): NavigationEntry[] {
  const live: NavigationEntry[] = [];
  const snapshots: NavigationEntry[] = [];
  for (const record of agents) {
    const heading = buildHeading(record, registry);
    if (record.isSessionReady()) {
      live.push({ kind: "live", record, heading, label: buildLabel(record, registry) });
    } else if (record.outputFile) {
      snapshots.push({ kind: "snapshot", outputFile: record.outputFile, heading, label: buildLabel(record, registry, true) });
    }
  }
  const held = new Set(agents.map((record) => record.id));
  for (const run of persisted) {
    if (held.has(run.id) || !run.outputFile) continue;
    const label = buildLabel(run, registry, true);
    snapshots.push({ kind: "snapshot", outputFile: run.outputFile, heading: buildHeading(run, registry), label });
  }
  return [...live, ...snapshots];
}

/**
 * Source a transcript from a persisted child-session JSONL snapshot.
 *
 * For an agent whose live session the retention sweep released: the in-memory
 * message history is gone, but the session file survives on disk (and the
 * record retains its path). Reads the file, drops the `SessionHeader`, and resolves the
 * message list via Pi's own parser. A static snapshot — no subscription, no
 * streaming, no live tool registry. `readFile` is injected so this module makes
 * no `fs` calls.
 */
export function fileSnapshotSource(
  outputFile: string,
  readFile: (path: string) => string,
): TranscriptSource {
  const entries = parseSessionEntries(readFile(outputFile));
  const sessionEntries = entries.filter((entry): entry is SessionEntry => entry.type !== "session");
  const { messages, model, thinkingLevel } = buildSessionContext(sessionEntries);
  // Pi also reads the model off each assistant message, so a file whose messages
  // predate those fields yields a model object with neither set.
  const recorded: SessionModel = {
    model: model?.provider && model.modelId ? { provider: model.provider, id: model.modelId } : undefined,
    thinkingLevel,
  };
  return {
    getMessages: () => messages,
    subscribe: () => undefined,
    streaming: () => undefined,
    getToolDefinition: () => undefined,
    sessionModel: () => recorded,
  };
}

/** Source a transcript live from an in-memory record (this slice's only source). */
export function liveSource(record: NavigableSubagent): TranscriptSource {
  return {
    getMessages: () => record.agentMessages,
    subscribe: (onChange) => record.subscribeToUpdates(onChange),
    streaming: () =>
      isRunningStatus(record.status)
        ? { activeTools: record.activeTools, responseText: record.responseText }
        : undefined,
    getToolDefinition: (name) => record.getToolDefinition(name),
    sessionModel: () => ({ model: record.model, thinkingLevel: record.thinkingLevel }),
  };
}

function buildHeading(fields: Pick<LabelFields, "type" | "description">, registry: AgentConfigLookup): EntryHeading {
  return {
    name: getDisplayName(fields.type, registry),
    modeLabel: getPromptModeLabel(fields.type, registry),
    description: fields.description,
  };
}

function buildLabel(fields: LabelFields, registry: AgentConfigLookup, released = false): string {
  const name = getDisplayName(fields.type, registry);
  const duration = formatRunDuration(fields);
  const marker = released ? " · session released (snapshot)" : "";
  return `${name} (${fields.description}) · ${fields.toolUses} tools · ${fields.status} · ${duration}${marker}`;
}
