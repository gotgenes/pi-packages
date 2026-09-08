import type { Model } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { AssemblerContext, AssemblerIO } from "#src/session/session-config";
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

const ctx: AssemblerContext = {
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
      {
        systemPrompt: "parent prompt",
        cwd: "/tmp",
        strategy: "full",
        portablePrompt: undefined,
      },
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

describe("assembleSessionConfig — prompt inheritance", () => {
  /** The strategy `buildAgentPrompt` was told to use for this assembly. */
  function strategyPassedToPrompt(): string | undefined {
    return mockBuildAgentPrompt.mock.calls[0]?.[3]?.strategy;
  }

  /** The provider `resolvePromptInheritance` was asked about. */
  const resolvePromptInheritance = vi.fn(
    (_provider: string | undefined): "full" | "portable" => "full",
  );

  beforeEach(() => {
    resolvePromptInheritance.mockClear();
    resolvePromptInheritance.mockImplementation(() => "full");
  });

  it("asks about the provider of the child's own resolved model", () => {
    const parentModel = makeModel({ provider: "anthropic", id: "sonnet" });
    const childModel = makeModel({ provider: "claude-bridge", id: "opus" });

    assembleSessionConfig(
      "Explore",
      { ...ctx, parentModel, resolvePromptInheritance },
      { model: childModel },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(resolvePromptInheritance).toHaveBeenCalledWith("claude-bridge");
  });

  it("asks about the provider named by the agent's own model string", () => {
    // The third resolution path: no per-spawn override, and the agent file
    // names a model whose provider differs from the parent's.
    const bridgeModel = makeModel({ provider: "claude-bridge", id: "opus" });
    mockRegistry.find.mockReturnValueOnce(bridgeModel);
    mockRegistry.getAvailable.mockReturnValueOnce([bridgeModel]);
    mockResolveAgentConfig.mockReturnValueOnce(
      exploreConfig({ model: "claude-bridge/opus" }),
    );

    assembleSessionConfig(
      "Explore",
      {
        ...ctx,
        parentModel: makeModel({ provider: "anthropic", id: "sonnet" }),
        resolvePromptInheritance,
      },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(resolvePromptInheritance).toHaveBeenCalledWith("claude-bridge");
  });

  it("passes the resolved strategy to the prompt builder", () => {
    resolvePromptInheritance.mockImplementation(() => "portable");

    assembleSessionConfig(
      "Explore",
      {
        ...ctx,
        parentModel: makeModel({ provider: "claude-bridge", id: "opus" }),
        resolvePromptInheritance,
      },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(strategyPassedToPrompt()).toBe("portable");
  });

  it("hands the prompt builder the parent's portable parts", () => {
    assembleSessionConfig(
      "Explore",
      { ...ctx, parentPortablePrompt: "<project_context>…</project_context>" },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(mockBuildAgentPrompt.mock.calls[0]?.[3]?.portablePrompt).toBe(
      "<project_context>…</project_context>",
    );
  });

  it("falls back to full when no resolver is supplied", () => {
    assembleSessionConfig("Explore", ctx, {}, mockEnv, mockAgentLookup, mockIO);

    expect(strategyPassedToPrompt()).toBe("full");
  });
});
