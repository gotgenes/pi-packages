import type { Model } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { AssemblerIO } from "#src/session/session-config";
import type { AgentConfig } from "#src/types";
import { makeModel } from "#test/helpers/make-model";

const mockResolveAgentConfig = vi.fn((): AgentConfig => ({
  name: "Explore",
  description: "Fast codebase exploration agent",
  toolNames: ["read"],
  systemPrompt: "You are Explore.",
  promptMode: "replace",
}));
const mockGetToolNamesForType = vi.fn((): string[] => ["read"]);
const mockBuildAgentPrompt: Mock<AssemblerIO["buildAgentPrompt"]> = vi.fn(
  () => "assembled system prompt",
);

/** Mock registry injected into assembleSessionConfig instead of module-level free functions. */
const mockAgentLookup: AgentConfigLookup = {
  resolveAgentConfig: mockResolveAgentConfig,
  getToolNamesForType: mockGetToolNamesForType,
};

import { assembleSessionConfig } from "#src/session/session-config";

const mockEnv = { isGitRepo: false, branch: "", platform: "linux" };

const mockRegistry = {
  find: vi.fn((): Model<any> | undefined => undefined),
  getAll: vi.fn((): Model<any>[] => []),
  getAvailable: vi.fn((): Model<any>[] => []),
};

const ctx = {
  cwd: "/tmp",
  parentSystemPrompt: "parent prompt",
  modelRegistry: mockRegistry,
};

/** IO stubs injected into assembleSessionConfig in place of module-level imports. */
const mockIO = {
  buildAgentPrompt: mockBuildAgentPrompt,
};

/** The Explore agent config used across the model/thinking resolution tests. */
function exploreConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { name: "Explore", description: "test", systemPrompt: "prompt", promptMode: "replace", ...overrides };
}

beforeEach(() => {
  mockResolveAgentConfig.mockClear();
  mockGetToolNamesForType.mockClear();
  mockBuildAgentPrompt.mockClear();
  mockRegistry.find.mockReset();
  mockRegistry.getAll.mockClear();
  mockRegistry.getAvailable.mockClear();
});

describe("assembleSessionConfig — default agent shape", () => {
  it("returns correct shape for Explore agent with defaults", () => {
    const result = assembleSessionConfig("Explore", ctx, {}, mockEnv, mockAgentLookup, mockIO);

    expect(result.effectiveCwd).toBe("/tmp");
    expect(result.systemPrompt).toBe("assembled system prompt");
    expect(result.toolNames).toEqual(["read"]);
    expect(result.model).toBeUndefined();
    expect(result.thinkingLevel).toBeUndefined();
  });

  it("uses options.cwd as effectiveCwd when provided", () => {
    const result = assembleSessionConfig("Explore", ctx, { cwd: "/tmp/worktree" }, mockEnv, mockAgentLookup, mockIO);

    expect(result.effectiveCwd).toBe("/tmp/worktree");
  });

  it("falls back to ctx.cwd when options.cwd is not set", () => {
    const result = assembleSessionConfig("Explore", ctx, {}, mockEnv, mockAgentLookup, mockIO);

    expect(result.effectiveCwd).toBe("/tmp");
  });

  it("systemPrompt reflects the parentSystemPrompt passed to buildAgentPrompt", () => {
    mockBuildAgentPrompt.mockImplementationOnce(
      (_config, _cwd, _env, inherited) => `assembled:${inherited?.systemPrompt}`,
    );

    const result = assembleSessionConfig("Explore", ctx, {}, mockEnv, mockAgentLookup, mockIO);

    expect(result.systemPrompt).toBe("assembled:parent prompt");
  });

  it("forwards the parent's cwd alongside its system prompt", () => {
    // The prompt builder needs the parent's cwd to redact the footer that text
    // claims — the child's own cwd is a separate argument.
    assembleSessionConfig(
      "Explore",
      ctx,
      { cwd: "/worktree" },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(mockBuildAgentPrompt).toHaveBeenCalledWith(
      mockResolveAgentConfig(),
      "/worktree",
      mockEnv,
      { systemPrompt: "parent prompt", cwd: "/tmp" },
    );
  });
});

describe("assembleSessionConfig — model resolution", () => {
  it("returns undefined model when no option, no config model, no parent", () => {
    const result = assembleSessionConfig("Explore", ctx, {}, mockEnv, mockAgentLookup, mockIO);

    expect(result.model).toBeUndefined();
  });

  it("options.model wins over config model and parent model", () => {
    const explicitModel = makeModel({ provider: "anthropic", id: "claude-opus-4" });
    mockResolveAgentConfig.mockReturnValueOnce(exploreConfig({ model: "anthropic/claude-haiku-4" }));

    const result = assembleSessionConfig(
      "Explore",
      { ...ctx, parentModel: makeModel({ provider: "anthropic", id: "claude-haiku-4" }) },
      { model: explicitModel },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBe(explicitModel);
  });

  it("config model string resolves via registry when available", () => {
    const resolvedModel = makeModel({ provider: "anthropic", id: "claude-opus-4" });
    mockResolveAgentConfig.mockReturnValueOnce(exploreConfig({ model: "anthropic/claude-opus-4" }));
    mockRegistry.find.mockReturnValueOnce(resolvedModel);
    mockRegistry.getAvailable.mockReturnValueOnce([
      makeModel({ provider: "anthropic", id: "claude-opus-4" }),
    ]);

    const result = assembleSessionConfig("Explore", ctx, {}, mockEnv, mockAgentLookup, mockIO);

    expect(mockRegistry.find).toHaveBeenCalledWith("anthropic", "claude-opus-4");
    expect(result.model).toBe(resolvedModel);
  });

  it("falls back to parentModel when config model string is not in registry", () => {
    const parentModel = makeModel({ provider: "anthropic", id: "claude-haiku-4" });
    mockResolveAgentConfig.mockReturnValueOnce(exploreConfig({ model: "anthropic/unknown-model" }));
    mockRegistry.find.mockReturnValueOnce(undefined);
    mockRegistry.getAvailable.mockReturnValueOnce([]);

    const result = assembleSessionConfig(
      "Explore",
      { ...ctx, parentModel },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBe(parentModel);
  });

  it("falls back to parentModel when config model is not available (not in getAvailable)", () => {
    const parentModel = makeModel({ provider: "anthropic", id: "claude-haiku-4" });
    const foundModel = makeModel({ provider: "anthropic", id: "claude-opus-4" });
    mockResolveAgentConfig.mockReturnValueOnce(exploreConfig({ model: "anthropic/claude-opus-4" }));
    // Model exists in registry but NOT in available set
    mockRegistry.find.mockReturnValueOnce(foundModel);
    mockRegistry.getAvailable.mockReturnValueOnce([]);

    const result = assembleSessionConfig(
      "Explore",
      { ...ctx, parentModel },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBe(parentModel);
  });

  it("falls back to parentModel when config model has no slash", () => {
    const parentModel = makeModel({ provider: "anthropic", id: "claude-haiku-4" });
    mockResolveAgentConfig.mockReturnValueOnce(exploreConfig({ model: "claude-opus-4" })); // no provider/ prefix

    const result = assembleSessionConfig(
      "Explore",
      { ...ctx, parentModel },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBe(parentModel);
  });

  it("returns parentModel when no config model and no option model", () => {
    const parentModel = makeModel({ provider: "anthropic", id: "claude-haiku-4" });

    const result = assembleSessionConfig(
      "Explore",
      { ...ctx, parentModel },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBe(parentModel);
  });
});

describe("assembleSessionConfig — unknown type fallback", () => {
  it("passes resolved config directly to buildAgentPrompt", () => {
    // resolveAgentConfig handles the fallback internally —
    // session-config just forwards whatever it returns
    mockResolveAgentConfig.mockReturnValueOnce({
      name: "general-purpose",
      description: "General-purpose",
      systemPrompt: "",
      promptMode: "append" as const,
    });

    mockBuildAgentPrompt.mockImplementationOnce(
      (config: { name: string }) => `resolved:${config.name}`,
    );

    const result = assembleSessionConfig("unknown-custom-agent", ctx, {}, mockEnv, mockAgentLookup, mockIO);

    expect(result.systemPrompt).toBe("resolved:general-purpose");
  });
});

describe("assembleSessionConfig — thinking level", () => {
  it("returns undefined thinkingLevel when neither option nor config sets it", () => {
    const result = assembleSessionConfig("Explore", ctx, {}, mockEnv, mockAgentLookup, mockIO);

    expect(result.thinkingLevel).toBeUndefined();
  });

  it("options.thinkingLevel wins over agentConfig.thinking", () => {
    mockResolveAgentConfig.mockReturnValueOnce(exploreConfig({ thinking: "low" }));

    const result = assembleSessionConfig(
      "Explore",
      ctx,
      { thinkingLevel: "high" },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.thinkingLevel).toBe("high");
  });

  it("agentConfig.thinking is used when no option is provided", () => {
    mockResolveAgentConfig.mockReturnValueOnce(exploreConfig({ thinking: "medium" }));

    const result = assembleSessionConfig("Explore", ctx, {}, mockEnv, mockAgentLookup, mockIO);

    expect(result.thinkingLevel).toBe("medium");
  });
});

describe("assembleSessionConfig — prompt inheritance scoping", () => {
  it("applies the provider rule for the resolved child model's provider", () => {
    mockResolveAgentConfig.mockReturnValueOnce(exploreConfig());
    const bridgeModel = makeModel({ id: "claude-opus-5", name: "Opus", provider: "claude-bridge" });
    assembleSessionConfig(
      "Explore",
      { ...ctx, promptInheritanceProviders: { "claude-bridge": "portable" } },
      { model: bridgeModel },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );
    expect(mockBuildAgentPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ promptInheritance: "portable" }),
      expect.any(String),
      mockEnv,
      expect.anything(),
    );
  });

  it("falls through to the default for unlisted providers", () => {
    mockResolveAgentConfig.mockReturnValueOnce(exploreConfig());
    const zaiModel = makeModel({ id: "glm-5.3", name: "GLM", provider: "zai" });
    assembleSessionConfig(
      "Explore",
      { ...ctx, promptInheritanceProviders: { "claude-bridge": "portable" }, promptInheritanceDefault: "full" },
      { model: zaiModel },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );
    expect(mockBuildAgentPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ promptInheritance: "full" }),
      expect.any(String),
      mockEnv,
      expect.anything(),
    );
  });

  it("frontmatter inherit_prompt wins over provider rules and defaults", () => {
    mockResolveAgentConfig.mockReturnValueOnce(exploreConfig({ promptInheritance: "portable" }));
    const zaiModel = makeModel({ id: "glm-5.3", name: "GLM", provider: "zai" });
    assembleSessionConfig(
      "Explore",
      { ...ctx, promptInheritanceDefault: "full", promptInheritanceProviders: { zai: "full" } },
      { model: zaiModel },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );
    expect(mockBuildAgentPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ promptInheritance: "portable" }),
      expect.any(String),
      mockEnv,
      expect.anything(),
    );
  });
});
