import { describe, expect, it } from "vitest";
import { createResolvedSpawnConfig } from "#test/helpers/make-spawn-config";

describe("createResolvedSpawnConfig", () => {
  it("produces a foreground-shaped config by default", () => {
    expect(createResolvedSpawnConfig()).toEqual({
      identity: {
        subagentType: "general-purpose",
        rawType: "general-purpose",
        fellBack: false,
        displayName: "Agent",
      },
      notes: [],
      execution: {
        prompt: "do the task",
        description: "task",
        model: undefined,
        effectiveMaxTurns: undefined,
        thinking: undefined,
        inheritContext: false,
        runInBackground: false,
        agentInvocation: {
          modelName: undefined,
          thinking: undefined,
          maxTurns: undefined,
          inheritContext: false,
          runInBackground: false,
        },
      },
      presentation: {
        modelName: undefined,
        agentTags: [],
        detailBase: {
          displayName: "Agent",
          description: "task",
          subagentType: "general-purpose",
          modelName: undefined,
          tags: undefined,
        },
      },
    });
  });

  it("applies the scalar overrides", () => {
    const config = createResolvedSpawnConfig({
      displayName: "General-purpose",
      prompt: "do something",
      description: "bg task",
      runInBackground: true,
    });
    expect(config.identity.displayName).toBe("General-purpose");
    expect(config.execution.prompt).toBe("do something");
    expect(config.execution.description).toBe("bg task");
  });

  it("mirrors runInBackground into agentInvocation", () => {
    const config = createResolvedSpawnConfig({ runInBackground: true });
    expect(config.execution.runInBackground).toBe(true);
    expect(config.execution.agentInvocation.runInBackground).toBe(true);
  });

  it("defaults rawType to subagentType but keeps an explicit fallback rawType", () => {
    expect(createResolvedSpawnConfig().identity.rawType).toBe("general-purpose");
    const fallback = createResolvedSpawnConfig({ fellBack: true, rawType: "unknown-type" });
    expect(fallback.identity.fellBack).toBe(true);
    expect(fallback.identity.rawType).toBe("unknown-type");
  });

  it("derives the unknown-type note from fellBack and rawType", () => {
    expect(createResolvedSpawnConfig({ fellBack: true, rawType: "unknown-type" }).notes).toEqual([
      'Note: Unknown agent type "unknown-type" — using general-purpose.',
    ]);
  });

  it("mirrors displayName, description, subagentType, and model into presentation.detailBase", () => {
    const config = createResolvedSpawnConfig({
      subagentType: "Explore",
      displayName: "Explore",
      description: "scan repo",
      model: "haiku",
    });
    expect(config.presentation.modelName).toBe("haiku");
    expect(config.presentation.detailBase).toEqual({
      displayName: "Explore",
      description: "scan repo",
      subagentType: "Explore",
      modelName: "haiku",
      tags: undefined,
    });
  });
});
