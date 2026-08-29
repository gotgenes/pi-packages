import { describe, expect, it, vi } from "vitest";
import { type BackgroundParams, spawnBackground } from "#src/tools/background-spawner";
import { createToolDeps } from "#test/helpers/make-deps";
import { createResolvedSpawnConfig } from "#test/helpers/make-spawn-config";
import { createTestSubagent } from "#test/helpers/make-subagent";
import { createMockSession, createSubagentSessionStub, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

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
    expect(result.content[0].text).toContain("agent-1");
    expect(result.content[0].text).toContain("my task");
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
    expect(result.content[0].text).toContain("queued");
    expect(result.content[0].text).toContain("max 4 concurrent");
  });

  it("mentions 'started' in result when record is running", () => {
    const { manager } = createToolDeps();
    const result = spawnBackground(manager, makeParams());
    expect(result.content[0].text).toContain("started");
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
    expect(result.content[0].text).toContain("/sessions/bg.jsonl");
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
    expect(result.content[0].text).toContain("spawn failed");
  });
});
