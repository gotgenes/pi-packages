import { describe, expect, it } from "vitest";
import { makeAgentConfig } from "./make-agent-config";

describe("makeAgentConfig", () => {
  it("returns a fully-shaped AgentConfig with defaults", () => {
    expect(makeAgentConfig()).toEqual({
      name: "test-agent",
      description: "Test agent",
      toolNames: ["read", "grep"],
      systemPrompt: "You are a test agent.",
      promptMode: "replace",
      inheritContext: false,
      runInBackground: false,
    });
  });

  it("applies overrides while keeping other defaults", () => {
    const config = makeAgentConfig({ name: "twin", promptMode: "append", systemPrompt: "" });
    expect(config.name).toBe("twin");
    expect(config.promptMode).toBe("append");
    expect(config.systemPrompt).toBe("");
    expect(config.description).toBe("Test agent");
  });
});
