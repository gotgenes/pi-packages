import { describe, expect, it } from "vitest";
import type { TypeListRegistry } from "#src/tools/helpers";
import { buildAgentGuidelines, buildDetails, buildTypeListText, formatLifetimeTokens, getModelLabelFromConfig, textResult } from "#src/tools/helpers";
import type { AgentDetails } from "#src/ui/display";
import { createTestSubagent } from "#test/helpers/make-subagent";

/** Build a minimal TypeListRegistry stub for tests. */
function makeRegistry(opts: {
  defaults?: string[];
  users?: string[];
  resolve?: (name: string) => {
    description: string;
    model: string | undefined;
    enabled?: boolean;
    toolGuideline?: string;
  };
}): TypeListRegistry {
  return {
    getDefaultAgentNames: () => opts.defaults ?? [],
    getUserAgentNames: () => opts.users ?? [],
    resolveAgentConfig: (name: string) =>
      ({ ...opts.resolve?.(name) ?? { description: "", model: undefined } }) as ReturnType<TypeListRegistry["resolveAgentConfig"]>,
    getToolNamesForType: () => [],
  };
}

describe("textResult", () => {
  it("wraps a message in the tool result shape", () => {
    const result = textResult("hello");
    expect(result).toEqual({
      content: [{ type: "text", text: "hello" }],
      details: undefined,
    });
  });

  it("includes details when provided", () => {
    const details: AgentDetails = {
      displayName: "Agent",
      description: "",
      subagentType: "general-purpose",
      toolUses: 0,
      tokens: "",
      durationMs: 0,
      status: "completed",
    };
    const result = textResult("done", details);
    expect(result.details).toBe(details);
  });
});

describe("formatLifetimeTokens", () => {
  it("returns formatted string when tokens > 0", () => {
    const result = formatLifetimeTokens({ lifetimeUsage: { input: 500, output: 500, cacheWrite: 0 } });
    expect(result).toBe("1.0k token");
  });

  it('returns "" when total is zero', () => {
    const result = formatLifetimeTokens({ lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 } });
    expect(result).toBe("");
  });

  it("formats large token counts with k suffix", () => {
    const result = formatLifetimeTokens({ lifetimeUsage: { input: 15000, output: 18800, cacheWrite: 0 } });
    expect(result).toBe("33.8k token");
  });
});

describe("getModelLabelFromConfig", () => {
  it("strips provider prefix", () => {
    expect(getModelLabelFromConfig("anthropic/claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("strips trailing date suffix", () => {
    expect(getModelLabelFromConfig("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });

  it("strips both provider prefix and date suffix", () => {
    expect(getModelLabelFromConfig("anthropic/claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });

  it("returns the string as-is when no prefix or suffix", () => {
    expect(getModelLabelFromConfig("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("handles model with multiple slashes", () => {
    expect(getModelLabelFromConfig("provider/sub/model-name")).toBe("model-name");
  });
});

describe("buildTypeListText", () => {
  it("lists default agents with their descriptions", () => {
    const registry = makeRegistry({
      defaults: ["general-purpose"],
      resolve: () => ({ description: "General purpose agent", model: undefined }),
    });
    const result = buildTypeListText(registry, "/home/.pi");
    expect(result).toContain("- general-purpose: General purpose agent");
  });

  it("includes model suffix for default agents that have a model set", () => {
    const registry = makeRegistry({
      defaults: ["Explore"],
      resolve: () => ({ description: "Fast explorer", model: "anthropic/claude-haiku-4-5" }),
    });
    const result = buildTypeListText(registry, "/home/.pi");
    expect(result).toContain("- Explore: Fast explorer (claude-haiku-4-5)");
  });

  it("includes agentDir in the trailing hint line", () => {
    const registry = makeRegistry({});
    const result = buildTypeListText(registry, "/home/user/.pi");
    expect(result).toContain("/home/user/.pi");
  });

  it("adds Custom agents section when user agents are present", () => {
    const registry = makeRegistry({
      defaults: ["general-purpose"],
      users: ["my-agent"],
      resolve: (name) =>
        name === "general-purpose"
          ? { description: "General purpose", model: undefined }
          : { description: "My custom agent", model: undefined },
    });
    const result = buildTypeListText(registry, "/home/.pi");
    expect(result).toContain("Custom agents:");
    expect(result).toContain("- my-agent: My custom agent");
  });

  it("excludes disabled agents from the default agents list", () => {
    const registry = makeRegistry({
      defaults: ["general-purpose", "Plan"],
      resolve: (name) =>
        name === "Plan"
          ? { description: "Planning agent", model: undefined, enabled: false }
          : { description: "General purpose agent", model: undefined },
    });
    const result = buildTypeListText(registry, "/home/.pi");
    expect(result).toContain("- general-purpose: General purpose agent");
    expect(result).not.toContain("Plan");
  });

  it("excludes disabled agents from the custom agents list", () => {
    const registry = makeRegistry({
      defaults: ["general-purpose"],
      users: ["my-agent", "disabled-custom"],
      resolve: (name) =>
        name === "disabled-custom"
          ? { description: "disabled custom agent", model: undefined, enabled: false }
          : { description: "My custom agent", model: undefined },
    });
    const result = buildTypeListText(registry, "/home/.pi");
    expect(result).toContain("- my-agent: My custom agent");
    expect(result).not.toContain("disabled-custom");
  });

  it("omits Custom agents section when no user agents exist", () => {
    const registry = makeRegistry({
      defaults: ["general-purpose"],
      resolve: () => ({ description: "General purpose", model: undefined }),
    });
    const result = buildTypeListText(registry, "/home/.pi");
    expect(result).not.toContain("Custom agents:");
  });

  it("omits the Default agents header when no default agents exist", () => {
    const registry = makeRegistry({
      users: ["my-agent"],
      resolve: () => ({ description: "My custom agent", model: undefined }),
    });
    const result = buildTypeListText(registry, "/home/.pi");
    expect(result).not.toContain("Default agents:");
  });
});

describe("buildAgentGuidelines", () => {
  it("returns the enabled default agents' guideline lines in registry order", () => {
    const registry = makeRegistry({
      defaults: ["general-purpose", "Explore", "Plan"],
      resolve: (name) => ({
        description: `${name} agent`,
        model: undefined,
        toolGuideline: `- Use ${name} for stuff.`,
      }),
    });
    expect(buildAgentGuidelines(registry)).toEqual([
      "- Use general-purpose for stuff.",
      "- Use Explore for stuff.",
      "- Use Plan for stuff.",
    ]);
  });

  it("omits a disabled default agent's guideline line", () => {
    const registry = makeRegistry({
      defaults: ["general-purpose", "Explore"],
      resolve: (name) => ({
        description: `${name} agent`,
        model: undefined,
        enabled: name === "Explore" ? false : undefined,
        toolGuideline: `- Use ${name} for stuff.`,
      }),
    });
    expect(buildAgentGuidelines(registry)).toEqual(["- Use general-purpose for stuff."]);
  });

  it("omits default agents that declare no guideline", () => {
    const registry = makeRegistry({
      defaults: ["general-purpose", "custom-default"],
      resolve: (name) => ({
        description: `${name} agent`,
        model: undefined,
        toolGuideline: name === "general-purpose" ? "- Use general-purpose for stuff." : undefined,
      }),
    });
    expect(buildAgentGuidelines(registry)).toEqual(["- Use general-purpose for stuff."]);
  });

  it("returns an empty array when all default agents are disabled", () => {
    const registry = makeRegistry({
      defaults: ["general-purpose", "Explore"],
      resolve: (name) => ({
        description: `${name} agent`,
        model: undefined,
        enabled: false,
        toolGuideline: `- Use ${name} for stuff.`,
      }),
    });
    expect(buildAgentGuidelines(registry)).toEqual([]);
  });
});

describe("buildDetails", () => {
  const base = {
    displayName: "TestAgent",
    description: "does stuff",
    subagentType: "general-purpose",
    modelName: undefined,
    tags: undefined,
  };
  const record = {
    toolUses: 3,
    startedAt: 1000,
    completedAt: 5000,
    status: "completed",
    error: undefined,
    id: "agent-42",
    lifetimeUsage: { input: 100, output: 50, cacheWrite: 0 },
  };

  it("maps record fields to AgentDetails shape", () => {
    const details = buildDetails(base, record);
    expect(details.toolUses).toBe(3);
    expect(details.durationMs).toBe(4000);
    expect(details.status).toBe("completed");
    expect(details.agentId).toBe("agent-42");
  });

  it("reads turnCount and maxTurns from the record", () => {
    // Use createTestSubagent to get a record with the live-activity getters
    const recordWithActivity = createTestSubagent({ turnCount: 7, maxTurns: 10 });
    const details = buildDetails(base, recordWithActivity);
    expect(details.turnCount).toBe(7);
    expect(details.maxTurns).toBe(10);
  });

  it("leaves turnCount/maxTurns undefined when the record has no such fields", () => {
    // Plain object — optional fields absent → undefined in details
    const details = buildDetails(base, record);
    expect(details.turnCount).toBeUndefined();
    expect(details.maxTurns).toBeUndefined();
  });

  it("applies overrides on top of computed fields", () => {
    const details = buildDetails(base, record, { tokens: "99.9k token" });
    expect(details.tokens).toBe("99.9k token");
  });

  it("uses Date.now() for durationMs when completedAt is absent", () => {
    const openRecord = { ...record, completedAt: undefined };
    const before = Date.now();
    const details = buildDetails(base, openRecord);
    const after = Date.now();
    expect(details.durationMs).toBeGreaterThanOrEqual(before - openRecord.startedAt);
    expect(details.durationMs).toBeLessThanOrEqual(after - openRecord.startedAt);
  });
});
