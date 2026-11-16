/**
 * make-agent-config.ts — Test fixture builder for `AgentConfig`.
 *
 * Fills every field a test does not vary with a neutral default, so a fixture
 * names only what its test reads.
 */
import type { AgentConfig } from "#src/types";

export function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "test-agent",
    description: "Test agent",
    toolNames: ["read", "grep"],
    systemPrompt: "You are a test agent.",
    promptMode: "replace",
    inheritContext: false,
    runInBackground: false,
    ...overrides,
  };
}
