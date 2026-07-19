import { vi } from "vitest";
import type { NavigableSubagent } from "#src/ui/session-navigation";

/**
 * Builds a fully-populated NavigableSubagent for session-navigation tests.
 * Defaults to a completed agent with a ready session; override any field.
 */
export function makeNavigable(overrides: Partial<NavigableSubagent> = {}): NavigableSubagent {
  return {
    id: "agent-1",
    type: "general-purpose",
    description: "Test task",
    status: "completed",
    startedAt: 1000,
    completedAt: 4000,
    toolUses: 2,
    activeTools: new Map(),
    responseText: "",
    agentMessages: [],
    isParentResultRedacted: false,
    isSessionReady: () => true,
    subscribeToUpdates: vi.fn(() => () => {}),
    getToolDefinition: vi.fn(() => undefined),
    ...overrides,
  };
}
