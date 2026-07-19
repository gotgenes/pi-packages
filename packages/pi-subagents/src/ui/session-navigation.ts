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
import type { EvictedSubagent } from "#src/lifecycle/subagent-manager";
import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import type { AgentSessionEvent, SessionMessage, SubagentType } from "#src/types";
import { formatDuration, getDisplayName } from "#src/ui/display";

// ─────────────────────────────────────────────────────────────────────────────

/** The record fields the navigator reads to label and live-source a transcript. */
export interface NavigableSubagent {
  readonly id: string;
  readonly type: SubagentType;
  readonly description: string;
  readonly status: SubagentStatus;
  readonly startedAt: number;
  readonly completedAt: number | undefined;
  readonly toolUses: number;
  readonly activeTools: ReadonlyMap<string, string>;
  readonly responseText: string;
  readonly agentMessages: readonly SessionMessage[];
  readonly isParentResultRedacted: boolean;
  isSessionReady(): boolean;
  subscribeToUpdates(fn: (event: AgentSessionEvent) => void): (() => void) | undefined;
  getToolDefinition(name: string): ToolDefinition | undefined;
}

/**
 * A navigable entry plus the label shown in the picker.
 *
 * A `live` entry sources its transcript from the in-memory record; an `evicted`
 * entry sources it from the persisted session file (the record is gone).
 */
export type NavigationEntry =
  | { readonly kind: "live"; readonly label: string; readonly record: NavigableSubagent }
  | { readonly kind: "evicted"; readonly label: string; readonly outputFile: string };

/** The fields `buildLabel` reads — shared by a live record and an evicted descriptor. */
interface LabelFields {
  readonly type: SubagentType;
  readonly description: string;
  readonly status: SubagentStatus;
  readonly startedAt: number;
  readonly completedAt: number | undefined;
  readonly toolUses: number;
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
  /** Subscribe to changes; returns an unsubscribe, or undefined for a static snapshot. */
  subscribe(onChange: () => void): (() => void) | undefined;
  /** Running-agent streaming state, or undefined when not streaming. */
  streaming(): StreamingState | undefined;
  /** Resolve a registered tool definition by name, for Pi's tool-execution components. */
  getToolDefinition(name: string): ToolDefinition | undefined;
}

/**
 * Label every navigable subagent for the picker: live records with a viewable
 * session, then agents evicted by the cleanup sweep (deduped against live ids).
 */
export function listNavigableAgents(
  agents: readonly NavigableSubagent[],
  evicted: readonly EvictedSubagent[],
  registry: AgentConfigLookup,
): NavigationEntry[] {
  const live = agents
    .filter((record) => record.isSessionReady() && !record.isParentResultRedacted)
    .map((record): NavigationEntry => ({ kind: "live", record, label: buildLabel(record, registry) }));
  const liveIds = new Set(agents.map((record) => record.id));
  const evictedEntries = evicted
    .filter((descriptor) => !liveIds.has(descriptor.id))
    .map((descriptor): NavigationEntry => ({
      kind: "evicted",
      outputFile: descriptor.outputFile,
      label: buildLabel(descriptor, registry, true),
    }));
  return [...live, ...evictedEntries];
}

/**
 * Source a transcript from a persisted child-session JSONL snapshot.
 *
 * For an agent evicted from the manager's map by the 10-minute cleanup sweep:
 * the in-memory record (and its message history) is gone, but the session file
 * survives on disk. Reads the file, drops the `SessionHeader`, and resolves the
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
  const { messages } = buildSessionContext(sessionEntries);
  return {
    getMessages: () => messages,
    subscribe: () => undefined,
    streaming: () => undefined,
    getToolDefinition: () => undefined,
  };
}

/** Source a transcript live from an in-memory record (this slice's only source). */
export function liveSource(record: NavigableSubagent): TranscriptSource {
  return {
    getMessages: () => record.agentMessages,
    subscribe: (onChange) => record.subscribeToUpdates(() => onChange()),
    streaming: () =>
      record.status === "running"
        ? { activeTools: record.activeTools, responseText: record.responseText }
        : undefined,
    getToolDefinition: (name) => record.getToolDefinition(name),
  };
}

function buildLabel(fields: LabelFields, registry: AgentConfigLookup, evicted = false): string {
  const name = getDisplayName(fields.type, registry);
  const duration = formatDuration(fields.startedAt, fields.completedAt);
  const marker = evicted ? " · evicted (snapshot)" : "";
  return `${name} (${fields.description}) · ${fields.toolUses} tools · ${fields.status} · ${duration}${marker}`;
}
