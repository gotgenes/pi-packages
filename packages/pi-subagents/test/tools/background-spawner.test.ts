import { describe, expect, it, vi } from "vitest";
import { type BackgroundParams, renderBackgroundLaunch, spawnBackground } from "#src/tools/background-spawner";
import { createToolDeps } from "#test/helpers/make-deps";
import { createResolvedSpawnConfig } from "#test/helpers/make-spawn-config";
import { createTestSubagent } from "#test/helpers/make-subagent";
import { createMockSession, createSubagentSessionStub, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import { textOf } from "#test/helpers/text-of";

function makeConfig(overrides: Parameters<typeof createResolvedSpawnConfig>[0] = {}) {
  return createResolvedSpawnConfig({
    displayName: "General-purpose",
    prompt: "do something",
    description: "bg task",
    runInBackground: true,
    ...overrides,
  });
}

function makeParams(overrides: Partial<BackgroundParams> = {}): BackgroundParams {
  return {
    config: makeConfig(),
    snapshot: STUB_SNAPSHOT,
    parentSession: { parentSessionFile: "/sessions/parent.jsonl", parentSessionId: "session-1", toolCallId: "tc-1" },
    settings: { maxConcurrent: 4 },
    ...overrides,
  };
}

describe("renderBackgroundLaunch", () => {
  const detailBase = {
    displayName: "Explore",
    description: "answer",
    subagentType: "Explore",
    modelName: undefined,
    tags: undefined,
  };

  it("renders a resumed launch with its output file", () => {
    const result = renderBackgroundLaunch({
      headline: "Agent resumed in background.",
      id: "agent-7",
      displayName: "Explore",
      description: "answer",
      detailBase,
      outputFile: "/sessions/agent-7.jsonl",
    });

    expect(textOf(result)).toBe(
      "Agent resumed in background.\n" +
        "Agent ID: agent-7\n" +
        "Type: Explore\n" +
        "Description: answer\n" +
        "Output file: /sessions/agent-7.jsonl\n" +
        "\nYou will be notified when this agent completes.\n" +
        "Use get_subagent_result to retrieve full results, or steer_subagent to send it messages.\n" +
        "Do not duplicate this agent's work.",
    );
    expect(result.details).toEqual({
      ...detailBase,
      toolUses: 0,
      tokens: "",
      durationMs: 0,
      status: "background",
      agentId: "agent-7",
    });
  });

  it("omits the notes, output file, and queue position it was not given", () => {
    const result = renderBackgroundLaunch({
      headline: "Agent resumed in background.",
      id: "agent-7",
      displayName: "Explore",
      description: "answer",
      detailBase,
    });

    expect(textOf(result)).toBe(
      "Agent resumed in background.\n" +
        "Agent ID: agent-7\n" +
        "Type: Explore\n" +
        "Description: answer\n" +
        "\nYou will be notified when this agent completes.\n" +
        "Use get_subagent_result to retrieve full results, or steer_subagent to send it messages.\n" +
        "Do not duplicate this agent's work.",
    );
  });
});

describe("spawnBackground", () => {
  /**
   * The door declares a commitment rather than a default, because
   * resolveSpawnConfig already merged the agent's frontmatter and AgentTool
   * routed here on the result. The distinction is not observable today — the
   * tool only reaches this door when the merged value was already true, where
   * both request kinds resolve alike — but it is the contract #829 builds on to
   * make a caller's explicit override win, so a silent flip to "default" must
   * fail here rather than in that issue's work.
   */
  it("commits explicitly to background rather than deferring to frontmatter", () => {
    const { manager } = createToolDeps();

    spawnBackground(manager, makeParams());

    expect(manager.spawn).toHaveBeenCalledWith(
      expect.anything(), // snapshot
      expect.any(String),
      "do something",
      expect.objectContaining({ background: { kind: "explicit", isBackground: true } }),
    );
  });

  it("passes parentSession.toolCallId to manager.spawn", () => {
    const { manager } = createToolDeps();
    spawnBackground(manager, makeParams({ parentSession: { toolCallId: "tc-99" } }));
    const spawnOpts = (manager.spawn as ReturnType<typeof vi.fn>).mock.calls[0][3];
    expect(spawnOpts.parentSession?.toolCallId).toBe("tc-99");
  });

  it("returns text result with agent ID and description", () => {
    const { manager } = createToolDeps();
    const result = spawnBackground(
      manager,
      makeParams({
        config: makeConfig({ description: "my task" }),
      }),
    );
    expect(textOf(result)).toContain("agent-1");
    expect(textOf(result)).toContain("my task");
  });

  it("mentions 'queued' in result when record status is queued", () => {
    const deps = createToolDeps({
      manager: {
        ...createToolDeps().manager,
        spawn: vi.fn().mockReturnValue("bg-2"),
        getRecord: vi.fn().mockReturnValue(createTestSubagent({ status: "queued" })),
      },
    });
    const result = spawnBackground(deps.manager, makeParams({ settings: { maxConcurrent: 4 } }));
    expect(textOf(result)).toContain("queued");
    expect(textOf(result)).toContain("max 4 concurrent");
  });

  it("mentions 'started' in result when record is running", () => {
    const { manager } = createToolDeps();
    const result = spawnBackground(manager, makeParams());
    expect(textOf(result)).toContain("started");
  });

  it("includes output file path in result when present", () => {
    const record = createTestSubagent({ status: "running" });
    record.subagentSession = toSubagentSession(createSubagentSessionStub(createMockSession(), "/sessions/bg.jsonl"));
    const deps = createToolDeps({
      manager: {
        ...createToolDeps().manager,
        spawn: vi.fn().mockReturnValue("bg-3"),
        getRecord: vi.fn().mockReturnValue(record),
      },
    });
    const result = spawnBackground(deps.manager, makeParams());
    expect(textOf(result)).toContain("/sessions/bg.jsonl");
  });

  it("leads the result with the spawn's notes", () => {
    const { manager } = createToolDeps();
    const result = spawnBackground(
      manager,
      makeParams({ config: makeConfig({ fellBack: true, rawType: "unknown-type" }) }),
    );
    expect(textOf(result)).toMatch(
      /^Note: Unknown agent type "unknown-type" — using general-purpose\.\n\nAgent (started|queued) in background\./,
    );
  });

  it("leads the result with the launch message when there are no notes", () => {
    const { manager } = createToolDeps();
    const result = spawnBackground(manager, makeParams());
    expect(textOf(result)).toMatch(/^Agent (started|queued) in background\./);
  });

  describe("launch message", () => {
    it("renders the started launch with its output file", () => {
      const record = createTestSubagent({ status: "running" });
      record.subagentSession = toSubagentSession(createSubagentSessionStub(createMockSession(), "/sessions/bg.jsonl"));
      const deps = createToolDeps({
        manager: { ...createToolDeps().manager, spawn: vi.fn().mockReturnValue("bg-3"), getRecord: vi.fn().mockReturnValue(record) },
      });

      const result = spawnBackground(deps.manager, makeParams());

      expect(textOf(result)).toBe(
        "Agent started in background.\n" +
          "Agent ID: bg-3\n" +
          "Type: General-purpose\n" +
          "Description: bg task\n" +
          "Output file: /sessions/bg.jsonl\n" +
          "\nYou will be notified when this agent completes.\n" +
          "Use get_subagent_result to retrieve full results, or steer_subagent to send it messages.\n" +
          "Do not duplicate this agent's work.",
      );
      expect(result.details).toEqual({
        displayName: "General-purpose",
        description: "bg task",
        subagentType: "general-purpose",
        modelName: undefined,
        tags: undefined,
        toolUses: 0,
        tokens: "",
        durationMs: 0,
        status: "background",
        agentId: "bg-3",
      });
    });

    it("renders the queued launch with its queue position", () => {
      const deps = createToolDeps({
        manager: {
          ...createToolDeps().manager,
          spawn: vi.fn().mockReturnValue("bg-2"),
          getRecord: vi.fn().mockReturnValue(createTestSubagent({ status: "queued" })),
        },
      });

      const result = spawnBackground(deps.manager, makeParams({ settings: { maxConcurrent: 4 } }));

      expect(textOf(result)).toBe(
        "Agent queued in background.\n" +
          "Agent ID: bg-2\n" +
          "Type: General-purpose\n" +
          "Description: bg task\n" +
          "Position: queued (max 4 concurrent)\n" +
          "\nYou will be notified when this agent completes.\n" +
          "Use get_subagent_result to retrieve full results, or steer_subagent to send it messages.\n" +
          "Do not duplicate this agent's work.",
      );
    });
  });

  it("returns error text when manager.spawn throws", () => {
    const deps = createToolDeps({
      manager: {
        ...createToolDeps().manager,
        spawn: vi.fn().mockImplementation(() => { throw new Error("spawn failed"); }),
        getRecord: vi.fn(),
      },
    });
    const result = spawnBackground(deps.manager, makeParams());
    expect(textOf(result)).toContain("spawn failed");
  });
});
