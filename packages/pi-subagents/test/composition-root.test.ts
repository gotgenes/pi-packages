/**
 * Composition-root tests for `subagentsExtension(pi)`.
 *
 * These assert the wiring contract that unit tests cannot see: what the root's
 * `io.createSession` hands to the SDK. The replay logic itself is covered by
 * `test/session/provider-inheritance.test.ts`, but those tests pass whether or
 * not the root calls it — only this file fails if the wiring is removed.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  interface Recorded {
    native: unknown[];
    configured: Array<[string, unknown]>;
  }
  const childRegistrations: Recorded = { native: [], configured: [] };
  const childRuntime = { marker: "child-runtime" };
  return {
    childRegistrations,
    childRuntime,
    createRuntime: vi.fn(async (_paths: { authPath: string; modelsPath: string }): Promise<unknown> => childRuntime),
    createAgentSession: vi.fn(
      async (_options: Record<string, unknown>): Promise<unknown> => ({
        session: { marker: "session" },
      }),
    ),
    // Stands in for `new ModelRegistry(runtime)`; records what the root replays.
    ModelRegistry: vi.fn(function (this: Record<string, unknown>, runtime: unknown) {
      this.runtimeGivenToRegistry = runtime;
      this.registerProvider = (a: unknown, b?: unknown) => {
        if (b === undefined) childRegistrations.native.push(a);
        else childRegistrations.configured.push([a as string, b]);
      };
    }),
  };
});

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual =
    await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
      "@earendil-works/pi-coding-agent",
    );
  return {
    ...actual,
    createAgentSession: sdk.createAgentSession,
    ModelRegistry: sdk.ModelRegistry,
    ModelRuntime: { create: sdk.createRuntime },
  };
});

vi.mock("#src/lifecycle/create-subagent-session", async () => {
  const actual = await vi.importActual<typeof import("#src/lifecycle/create-subagent-session")>(
    "#src/lifecycle/create-subagent-session",
  );
  return { ...actual, createSubagentSession: vi.fn() };
});

import subagentsExtension from "#src/index";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import { getSubagentsService } from "#src/service/service";
import { makeWorkspace, makeWorkspaceProvider } from "./helpers/make-workspace";
import { createMockSession, createSubagentSessionStub, toSubagentSession } from "./helpers/mock-session";
import { turnLoopResult } from "./helpers/turn-loop-result";

function makePi() {
  const tools = new Map<string, any>();
  const handlers = new Map<string, any[]>();
  return {
    pi: {
      registerMessageRenderer: vi.fn(),
      registerTool: vi.fn((tool: any) => tools.set(tool.name, tool)),
      registerCommand: vi.fn(),
      on: vi.fn((event: string, handler: any) => {
        const registered = handlers.get(event);
        if (registered) registered.push(handler);
        else handlers.set(event, [handler]);
      }),
      events: { emit: vi.fn(), on: vi.fn(() => vi.fn()) },
      appendEntry: vi.fn(),
      sendMessage: vi.fn(),
      exec: vi.fn(),
      getAllTools: vi.fn((): { name: string }[] => []),
    } as any,
    tools,
    handlers,
    /**
     * Invoke every handler registered for `event`, in registration order.
     *
     * Pi fans an event out to all of one extension's handlers for it — "A single
     * extension may register multiple handlers for the same event" (the SDK's
     * `ExtensionRunner`). A fixture keyed one-handler-per-event would keep only the
     * last registration, hiding a second one instead of exercising it.
     */
    fire: async (event: string, ...args: any[]) => {
      for (const handler of handlers.get(event) ?? []) {
        await handler(...args);
      }
    },
  };
}

/** The parent registry the root reads runtime registrations from. */
function makeParentRegistry() {
  const native = { id: "native-bridge" };
  const config = { api: "anthropic-messages", apiKey: "not-used" };
  return {
    native,
    config,
    registry: {
      find: vi.fn(),
      getAvailable: vi.fn(() => []),
      getRegisteredProviderIds: vi.fn(() => ["claude-bridge", "native-bridge"]),
      getRegisteredNativeProvider: vi.fn((id: string) => (id === "native-bridge" ? native : undefined)),
      getRegisteredProviderConfig: vi.fn((id: string) => (id === "claude-bridge" ? config : undefined)),
    } as any,
  };
}

/**
 * A child session whose turn loop runs until it is aborted. Like a real
 * session, the loop ends only once the abort has unwound it, which Pi does on a
 * later pass of the event loop, not synchronously inside the abort.
 */
function createRunningChildStub(
  outputFile = "/sessions/child.jsonl",
  transcript: Parameters<typeof createSubagentSessionStub>[2] = {},
) {
  const stub = createSubagentSessionStub(createMockSession(), outputFile, transcript);
  stub.runTurnLoop.mockImplementation(
    (_prompt: string, { signal }: { signal: AbortSignal }) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            setTimeout(() => {
              resolve(turnLoopResult({ responseText: "" }));
            }, 0);
          },
          { once: true },
        );
      }),
  );
  return stub;
}

/** A UI context that records what the widget registers on it. */
function makeRecordingUI() {
  return { setStatus: vi.fn(), setWidget: vi.fn() };
}

/** The session context Pi hands a `session_start` handler. */
function makeSessionStartCtx(
  parentRegistry: unknown,
  ui: ReturnType<typeof makeRecordingUI>,
  hasUI = false,
  entries: unknown[] = [],
) {
  return {
    hasUI,
    ui,
    cwd: "/tmp",
    model: undefined,
    modelRegistry: parentRegistry,
    sessionManager: {
      getSessionId: vi.fn(() => "session-1"),
      getSessionFile: vi.fn(() => "/sessions/parent.jsonl"),
      getBranch: vi.fn(() => []),
      getEntries: vi.fn(() => entries),
    },
    getSystemPrompt: vi.fn(() => "parent prompt"),
  } as any;
}

/** Run the extension far enough to capture the deps bag the root assembled. */
async function captureSessionFactoryIO(parentRegistry: unknown) {
  vi.mocked(createSubagentSession).mockResolvedValue(
    toSubagentSession(createSubagentSessionStub(createMockSession(), "/sessions/child.jsonl")),
  );
  const { pi, tools, fire } = makePi();
  subagentsExtension(pi);
  await fire("session_start", {}, makeSessionStartCtx(parentRegistry, makeRecordingUI()));

  await tools.get("subagent").execute(
    "tool-call-1",
    {
      prompt: "hi",
      description: "child",
      subagent_type: "general-purpose",
      run_in_background: true,
    },
    undefined,
    undefined,
  );

  expect(createSubagentSession).toHaveBeenCalled();
  const [, deps] = vi.mocked(createSubagentSession).mock.calls[0];
  return deps;
}

describe("composition root: io.createSession", () => {
  it("gives the child its own model runtime carrying the parent's runtime-registered providers", async () => {
    sdk.childRegistrations.native.length = 0;
    sdk.childRegistrations.configured.length = 0;
    sdk.createAgentSession.mockClear();
    const { registry, native, config } = makeParentRegistry();

    const io = (await captureSessionFactoryIO(registry)).io;
    await io.createSession({
      cwd: "/tmp/child",
      agentDir: "/mock/agent-dir",
      sessionManager: {} as any,
      settingsManager: {} as any,
      modelRegistry: registry,
      tools: [],
      resourceLoader: {} as any,
    });

    // The child is handed a runtime, not the registry the SDK now ignores.
    expect(sdk.createAgentSession).toHaveBeenCalledTimes(1);
    const [options] = sdk.createAgentSession.mock.calls[0];
    expect(options.modelRuntime).toBe(sdk.childRuntime);
    expect(options).not.toHaveProperty("modelRegistry");

    // Both registration forms are replayed onto the child's own registry.
    expect(sdk.childRegistrations.native).toEqual([native]);
    expect(sdk.childRegistrations.configured).toEqual([["claude-bridge", config]]);
  });

  it("derives the child runtime's auth and models paths from the session's agent dir", async () => {
    sdk.createRuntime.mockClear();
    const { registry } = makeParentRegistry();

    const io = (await captureSessionFactoryIO(registry)).io;
    await io.createSession({
      cwd: "/tmp/child",
      agentDir: "/mock/agent-dir",
      sessionManager: {} as any,
      settingsManager: {} as any,
      modelRegistry: registry,
      tools: [],
      resourceLoader: {} as any,
    });

    expect(sdk.createRuntime).toHaveBeenCalledWith({
      authPath: "/mock/agent-dir/auth.json",
      modelsPath: "/mock/agent-dir/models.json",
    });
  });
});

describe("composition root: message renderers", () => {
  // The shutdown notice (`subagent-shutdown-notice`) is deliberately absent: it
  // is short, carries no result to collapse, and renders with Pi's default.
  it("registers a renderer for every result-carrying message type the extension sends", () => {
    const { pi } = makePi();
    subagentsExtension(pi);

    const registered = vi
      .mocked(pi.registerMessageRenderer)
      .mock.calls.map((call: unknown[]) => call[0] as string);

    expect(registered).toEqual([
      "subagent-notification",
      "subagent-update",
      "subagent-workspace-notice",
    ]);
  });
});

describe("composition root: widget activation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the widget for an agent spawned with no model tool call", async () => {
    vi.mocked(createSubagentSession).mockResolvedValue(
      toSubagentSession(createSubagentSessionStub(createMockSession(), "/sessions/child.jsonl")),
    );
    const { pi, fire } = makePi();
    subagentsExtension(pi);

    const ui = makeRecordingUI();
    await fire("session_start", {}, makeSessionStartCtx(makeParentRegistry().registry, ui, true));

    // The reported path: a command handler spawning through the published
    // service, so nothing in the parent loop ever emits a tool call.
    getSubagentsService()!.spawn("general-purpose", "hi", { description: "child" });

    expect(ui.setWidget).toHaveBeenCalled();

    await fire("session_shutdown", {}, {});
  });

  it("ages a finished agent out of the widget on the parent's next turn", async () => {
    vi.mocked(createSubagentSession).mockResolvedValue(
      toSubagentSession(createSubagentSessionStub(createMockSession(), "/sessions/child.jsonl")),
    );
    const { pi, fire } = makePi();
    subagentsExtension(pi);

    const ui = makeRecordingUI();
    await fire("session_start", {}, makeSessionStartCtx(makeParentRegistry().registry, ui, true));

    getSubagentsService()!.spawn("general-purpose", "hi", { description: "child" });
    await vi.advanceTimersByTimeAsync(300);

    // The run finished within this turn, so the row is seeded at age 0 and still shown.
    expect(ui.setWidget).toHaveBeenLastCalledWith("agents", expect.any(Function), expect.anything());

    await fire("turn_start", {}, { signal: undefined });

    expect(ui.setWidget).toHaveBeenLastCalledWith("agents", undefined);

    await fire("session_shutdown", {}, {});
  });

  it("no longer subscribes to tool_execution_start", () => {
    const { pi, handlers } = makePi();

    subagentsExtension(pi);

    expect(handlers.has("tool_execution_start")).toBe(false);
  });
});

describe("composition root: widget teardown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Run the extension and drive one background agent to completion, leaving the
   * widget registered and its interval live.
   *
   * The agent must be **terminal** before the shutdown. An agent still running
   * at shutdown is aborted by the lifecycle handler, and the terminal
   * transition that abort settles notifies the widget in the middle of the
   * teardown, so what the widget shows afterwards would depend on that
   * `update()` as well as on the wiring. A completed agent produces no such
   * notification (`disposeSession()` notifies no observer), so the teardown is
   * observable only if it was actually wired.
   */
  async function completeAgentIntoWidget() {
    vi.mocked(createSubagentSession).mockResolvedValue(
      toSubagentSession(createSubagentSessionStub(createMockSession(), "/sessions/child.jsonl")),
    );
    const { pi, fire } = makePi();
    subagentsExtension(pi);

    const ui = makeRecordingUI();
    await fire("session_start", {}, makeSessionStartCtx(makeParentRegistry().registry, ui, true));
    getSubagentsService()!.spawn("general-purpose", "hi", { description: "child" });
    await vi.advanceTimersByTimeAsync(300);

    // The run finished within this turn, so the row lingers and the widget stays up.
    expect(ui.setWidget).toHaveBeenLastCalledWith("agents", expect.any(Function), expect.anything());
    return { ui, fire };
  }

  it("stops the widget's update interval on session_shutdown", async () => {
    const { fire } = await completeAgentIntoWidget();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await fire("session_shutdown", {}, {});

    expect(vi.getTimerCount()).toBe(0);
  });

  it("unregisters the widget and status entry on session_shutdown", async () => {
    const { ui, fire } = await completeAgentIntoWidget();

    await fire("session_shutdown", {}, {});

    expect(ui.setWidget).toHaveBeenLastCalledWith("agents", undefined);
    expect(ui.setStatus).toHaveBeenLastCalledWith("subagents", undefined);
  });
});

describe("composition root: prompt-inheritance wiring", () => {
  /**
   * Run the extension through one parent turn and one spawn, and return what
   * the root handed `createSubagentSession`.
   *
   * Only this file fails if the `before_agent_start` capture or the resolver
   * entry is dropped from the deps bag — the unit tests for each half pass
   * whether or not the root wires them together.
   */
  async function spawnAfterParentTurn(systemPromptOptions?: unknown) {
    // The module mock is shared across this file, so drop earlier tests' calls
    // before reading back the one this spawn makes.
    vi.mocked(createSubagentSession).mockClear();
    vi.mocked(createSubagentSession).mockResolvedValue(
      toSubagentSession(createSubagentSessionStub(createMockSession(), "/sessions/child.jsonl")),
    );
    const { pi, tools, fire } = makePi();
    subagentsExtension(pi);
    await fire("session_start", {}, makeSessionStartCtx(makeParentRegistry().registry, makeRecordingUI()));
    if (systemPromptOptions !== undefined) {
      await fire("before_agent_start", { systemPromptOptions });
    }

    await tools.get("subagent").execute(
      "tool-call-1",
      {
        prompt: "hi",
        description: "child",
        subagent_type: "general-purpose",
        run_in_background: true,
      },
      undefined,
      undefined,
    );

    return vi.mocked(createSubagentSession).mock.calls[0];
  }

  it("captures the parent's prompt options and renders them into the spawn snapshot", async () => {
    // Pi hands over the whole options object, project context included, so the
    // exact assertion is what pins that the snapshot leaves that block behind
    // for each child to resolve against its own directory (#918).
    const [params] = await spawnAfterParentTurn({
      customPrompt: "You are a specialist.",
      contextFiles: [{ path: "/repo/AGENTS.md", content: "Repo rules." }],
    });

    expect(params.snapshot.portablePrompt).toBe("You are a specialist.");
  });

  it("leaves the snapshot's portable parts absent when the parent has run no turn", async () => {
    const [params] = await spawnAfterParentTurn();

    expect(params.snapshot.portablePrompt).toBeUndefined();
  });

  describe("the session factory's inheritance resolver", () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "pi-root-inherit-"));
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(
        join(projectDir, ".pi", "subagents.json"),
        JSON.stringify({ promptInheritance: { "claude-bridge": "portable" } }),
      );
      // The root reads settings from process.cwd(), so point it at the fixture.
      vi.spyOn(process, "cwd").mockReturnValue(projectDir);
    });

    afterEach(() => {
      vi.mocked(process.cwd).mockRestore();
      rmSync(projectDir, { recursive: true, force: true });
    });

    it("answers portable for a provider the operator configured", async () => {
      const [, deps] = await spawnAfterParentTurn();

      expect(deps.resolvePromptInheritance("claude-bridge")).toBe("portable");
    });

    it("answers full for a provider the operator did not configure", async () => {
      const [, deps] = await spawnAfterParentTurn();

      expect(deps.resolvePromptInheritance("anthropic")).toBe("full");
    });
  });

  describe("the session factory's project-context loader", () => {
    let workspace: string;

    beforeEach(() => {
      workspace = mkdtempSync(join(tmpdir(), "pi-root-context-"));
      writeFileSync(join(workspace, "AGENTS.md"), "Worktree rules.");
    });

    afterEach(() => {
      rmSync(workspace, { recursive: true, force: true });
    });

    it("reads the directory it is asked about, not the parent's", async () => {
      const [, deps] = await spawnAfterParentTurn();

      expect(deps.io.assemblerIO.loadProjectContext(workspace)).toContain(
        `<project_instructions path="${join(workspace, "AGENTS.md")}">`,
      );
    });
  });
});

describe("composition root: parent tool list", () => {
  it("reads the parent's registered tools when a child asks, not when the extension loads", async () => {
    vi.mocked(createSubagentSession).mockClear();
    vi.mocked(createSubagentSession).mockResolvedValue(
      toSubagentSession(createSubagentSessionStub(createMockSession(), "/sessions/child.jsonl")),
    );
    const { pi, tools, fire } = makePi();
    subagentsExtension(pi);
    await fire("session_start", {}, makeSessionStartCtx(makeParentRegistry().registry, makeRecordingUI()));
    await tools.get("subagent").execute(
      "tool-call-1",
      { prompt: "hi", description: "child", subagent_type: "general-purpose", run_in_background: true },
      undefined,
      undefined,
    );
    const [, deps] = vi.mocked(createSubagentSession).mock.calls[0];

    // An MCP server connects in the background, so its tools register after load.
    vi.mocked(pi.getAllTools).mockReturnValue([{ name: "read" }, { name: "mcp__github__get_issue" }]);

    expect(deps.listParentToolNames()).toEqual(["read", "mcp__github__get_issue"]);
  });
});

describe("composition root: shutdown notice", () => {
  it("tells the parent session which running agents a reload stopped", async () => {
    const stub = createRunningChildStub();
    vi.mocked(createSubagentSession).mockResolvedValue(toSubagentSession(stub));
    const { pi, fire } = makePi();
    subagentsExtension(pi);
    await fire("session_start", {}, makeSessionStartCtx(makeParentRegistry().registry, makeRecordingUI()));

    const service = getSubagentsService()!;
    const id = service.spawn("general-purpose", "hi", { description: "child" });
    await vi.waitFor(() => {
      expect(service.getRecord(id)?.outputFile).toBe("/sessions/child.jsonl");
    });

    await fire("session_shutdown", { type: "session_shutdown", reason: "reload" }, {});

    expect(pi.sendMessage).toHaveBeenCalledWith(
      {
        customType: "subagent-shutdown-notice",
        content: [
          "`/reload` stopped these subagents before they finished, so their results will not arrive:",
          `- \`${id}\` (general-purpose) "child": was running. Transcript: \`/sessions/child.jsonl\``,
          "Spawn them again if the work is still needed.",
        ].join("\n"),
        display: true,
      },
      { triggerTurn: false },
    );
  });
});

describe("composition root: stopped record at shutdown", () => {
  it("persists a running child's stopped record before the shutdown handler resolves", async () => {
    const stub = createRunningChildStub();
    vi.mocked(createSubagentSession).mockResolvedValue(toSubagentSession(stub));
    const { pi, fire } = makePi();
    subagentsExtension(pi);
    await fire("session_start", {}, makeSessionStartCtx(makeParentRegistry().registry, makeRecordingUI()));

    const service = getSubagentsService()!;
    const id = service.spawn("general-purpose", "hi", { description: "child" });
    await vi.waitFor(() => {
      expect(stub.runTurnLoop).toHaveBeenCalled();
    });
    expect(service.getRecord(id)?.status).toBe("running");
    expect(pi.appendEntry).not.toHaveBeenCalled();

    await fire("session_shutdown", { type: "session_shutdown", reason: "reload" }, {});

    expect(pi.appendEntry).toHaveBeenCalledExactlyOnceWith(
      "subagents:record",
      expect.objectContaining({ id, status: "stopped", stoppedWhileQueued: false }),
    );
  });
});

describe("composition root: a settled child across a reload", () => {
  let tasksDir: string;
  /** The global agent directory, empty unless a test defines agents there, so the host's own agents stay out. */
  let agentDir: string;

  beforeEach(() => {
    tasksDir = mkdtempSync(join(tmpdir(), "pi-root-restore-"));
    agentDir = mkdtempSync(join(tmpdir(), "pi-root-restore-agent-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tasksDir, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  });

  function createParent() {
    const parent = SessionManager.create("/tmp", tasksDir);
    parent.appendMessage({ role: "user", content: "Delegate this", timestamp: 1 });
    return parent;
  }

  function contextFor(parent: SessionManager) {
    return { ...makeSessionStartCtx(makeParentRegistry().registry, makeRecordingUI()), sessionManager: parent };
  }

  /** The entry the child's run leaves last in its transcript, which its record names. */
  const CHILD_LEAF = "child-last-entry";

  /**
   * Persist a completed run into the parent and shut down its extension instance.
   * `workspace` registers a provider that prepares the child a directory first.
   * The child's session reports the id its transcript's header names, and the
   * definition the factory would have assembled it under: `definition`, or the
   * built-in one.
   */
  async function runChildThenReload(
    parent: SessionManager,
    transcript: string,
    options: { type?: string; workspace?: string; definition?: string } = {},
  ): Promise<string> {
    const sessionId = JSON.parse(readFileSync(transcript, "utf8").split("\n")[0]).id as string;
    const agentDefinition = options.definition ?? "builtin";
    vi.mocked(createSubagentSession).mockClear();
    vi.mocked(createSubagentSession).mockResolvedValue(
      toSubagentSession(createSubagentSessionStub(createMockSession(), transcript, { sessionId, leafId: CHILD_LEAF, agentDefinition })),
    );
    const { pi, tools, fire } = makePi();
    vi.mocked(pi.appendEntry).mockImplementation((customType: string, data: unknown) => {
      parent.appendCustomEntry(customType, data);
    });
    subagentsExtension(pi);
    await fire("session_start", {}, contextFor(parent));
    if (options.workspace !== undefined) {
      getSubagentsService()!.registerWorkspaceProvider(makeWorkspaceProvider(makeWorkspace(options.workspace)));
    }
    const result = await tools.get("subagent").execute(
      "tool-call-1",
      { prompt: "Map the configs", description: "configs", subagent_type: options.type ?? "general-purpose" },
      undefined,
      undefined,
    );
    await fire("session_shutdown", {});
    const id = /Agent ID: (\S+)/.exec(result.content[0].text)?.[1];
    if (!id) throw new Error(`no agent id in: ${result.content[0].text}`);
    return id;
  }

  /** Start a fresh extension instance on the supplied parent and attempt to resume `id`. */
  async function resumeAfterReload(parent: SessionManager, id: string, type = "general-purpose") {
    vi.mocked(createSubagentSession).mockClear();
    const resumed = createSubagentSessionStub(createMockSession());
    resumed.runTurnLoop.mockResolvedValue({
      responseText: "Picked up where I left off.",
      turnBudget: { used: 1, phase: "within" },
    });
    vi.mocked(createSubagentSession).mockResolvedValue(toSubagentSession(resumed));
    const { pi, tools, fire } = makePi();
    subagentsExtension(pi);
    await fire("session_start", {}, contextFor(parent));
    return tools.get("subagent").execute(
      "tool-call-2",
      { prompt: "Now the fallback", description: "configs", subagent_type: type, resume: id },
      undefined,
      undefined,
    );
  }

  it.each(["original", "fork"])("lets the %s parent resume its own child after reopening", async (kind) => {
    const parent = createParent();
    if (kind === "fork") parent.createBranchedSession(parent.getLeafId()!);
    const transcript = join(tasksDir, "child.jsonl");
    // The child ran in the parent's own directory, as the session context's cwd says.
    const header = { id: "child-session", parentSession: parent.getSessionId(), cwd: "/tmp" };
    writeFileSync(transcript, `${JSON.stringify({ type: "session", ...header })}\n`);
    const id = await runChildThenReload(parent, transcript);

    const result = await resumeAfterReload(SessionManager.open(parent.getSessionFile()!), id);

    expect(createSubagentSession).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: "general-purpose", transcript: { file: transcript, header, leafId: CHILD_LEAF, agentDefinition: "builtin" } }),
      expect.anything(),
    );
    expect(result.content[0].text).toBe(`Agent ID: ${id}\n\nPicked up where I left off.`);
  });

  it("resumes a child that /reload stopped mid-run, as the shutdown notice says it can", async () => {
    const parent = createParent();
    const transcript = join(tasksDir, "child.jsonl");
    const header = { id: "child-session", parentSession: parent.getSessionId(), cwd: "/tmp" };
    writeFileSync(transcript, `${JSON.stringify({ type: "session", ...header })}\n`);
    const stub = createRunningChildStub(transcript, { sessionId: header.id, leafId: CHILD_LEAF, agentDefinition: "builtin" });
    stub.holdsContinuableTranscript.mockReturnValue(true);
    vi.mocked(createSubagentSession).mockClear();
    vi.mocked(createSubagentSession).mockResolvedValue(toSubagentSession(stub));
    const { pi, tools, fire } = makePi();
    vi.mocked(pi.appendEntry).mockImplementation((customType: string, data: unknown) => {
      parent.appendCustomEntry(customType, data);
    });
    subagentsExtension(pi);
    await fire("session_start", {}, contextFor(parent));
    const started = await tools.get("subagent").execute(
      "tool-call-1",
      { prompt: "Map the configs", description: "configs", subagent_type: "general-purpose", run_in_background: true },
      undefined,
      undefined,
    );
    const id = /Agent ID: (\S+)/.exec(started.content[0].text)?.[1];
    await vi.waitFor(() => {
      expect(stub.runTurnLoop).toHaveBeenCalled();
    });

    await fire("session_shutdown", { type: "session_shutdown", reason: "reload" }, {});

    expect(vi.mocked(pi.sendMessage).mock.calls[0][0].content).toContain(
      `"configs": was running; resume it by calling subagent with resume: "${id}".`,
    );
    const result = await resumeAfterReload(parent, id!);
    expect(createSubagentSession).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ transcript: { file: transcript, header, leafId: CHILD_LEAF, agentDefinition: "builtin" } }),
      expect.anything(),
    );
    expect(result.content[0].text).toBe(`Agent ID: ${id}\n\nPicked up where I left off.`);
  });

  it("refuses inherited children through both the tool and service without opening or changing the transcript", async () => {
    const parent = createParent();
    const transcript = join(tasksDir, "original-child.jsonl");
    const contents = `${JSON.stringify({ type: "session", id: "original-child", cwd: "/tmp", parentSession: parent.getSessionId() })}\n`;
    writeFileSync(transcript, contents);
    const id = await runChildThenReload(parent, transcript);

    const fork = SessionManager.open(parent.getSessionFile()!);
    fork.createBranchedSession(fork.getLeafId()!);
    expect(fork.getEntries()).toEqual(parent.getEntries());
    const result = await resumeAfterReload(fork, id);
    expect(result.content[0].text).toContain(`Agent not found: "${id}"`);
    expect(await getSubagentsService()!.resume(id, "continue")).toEqual({ kind: "refused", reason: "unknown-agent" });
    expect(createSubagentSession).not.toHaveBeenCalled();
    expect(readFileSync(transcript, "utf8")).toBe(contents);

    const originalResult = await resumeAfterReload(SessionManager.open(parent.getSessionFile()!), id);
    expect(originalResult.content[0].text).toBe(`Agent ID: ${id}\n\nPicked up where I left off.`);
  });

  it.each([
    ["in a directory of its own", "/ws/child"],
    ["at the parent's own directory", "/tmp"],
  ])("refuses a child a provider's workspace held %s, opening nothing", async (_label, workspace) => {
    const parent = createParent();
    const transcript = join(tasksDir, "child.jsonl");
    writeFileSync(transcript, `${JSON.stringify({ type: "session", id: "child-session", parentSession: parent.getSessionId(), cwd: workspace })}\n`);
    const id = await runChildThenReload(parent, transcript, { workspace });

    const result = await resumeAfterReload(parent, id);

    expect(createSubagentSession).not.toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/isolated workspace that no longer exists/);
  });

  describe("a child whose agent type has changed since", () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "pi-root-restore-agents-"));
      mkdirSync(join(projectDir, ".pi", "agents"), { recursive: true });
      writeReviewer("");
      // The root loads custom agents from process.cwd(), so point it at the fixture.
      vi.spyOn(process, "cwd").mockReturnValue(projectDir);
    });

    afterEach(() => {
      vi.mocked(process.cwd).mockRestore();
      rmSync(projectDir, { recursive: true, force: true });
    });

    /** A read-only custom agent, with any extra frontmatter lines. */
    function writeReviewer(frontmatter: string) {
      writeFileSync(reviewerFile(), `---\ndescription: Reviews without editing\ntools: read\n${frontmatter}---\n\nReview only.`);
    }

    /** The project file the reviewer agent is defined in, which a run under it records. */
    function reviewerFile() {
      return join(projectDir, ".pi", "agents", "reviewer.md");
    }

    /** Resume `id` through the tool and the service, expecting both to refuse it as agent-type-unavailable, opening nothing. */
    async function expectRefusedThroughBothDoors(parent: SessionManager, id: string, type: string) {
      const result = await resumeAfterReload(parent, id, type);
      expect(result.content[0].text).toMatch(/ran as an agent type that is no longer defined, is disabled, or is now defined elsewhere/);
      expect(await getSubagentsService()!.resume(id, "continue")).toEqual({ kind: "refused", reason: "agent-type-unavailable" });
      expect(createSubagentSession).not.toHaveBeenCalled();
    }

    it("refuses it once deleting its read-only project file uncovers the built-in of the same name", async () => {
      const explore = join(projectDir, ".pi", "agents", "Explore.md");
      writeFileSync(explore, "---\ndescription: Explores by reading\ntools: read\n---\n\nRead only.");
      const parent = createParent();
      const transcript = join(tasksDir, "explore.jsonl");
      writeFileSync(transcript, `${JSON.stringify({ type: "session", id: "explore-session", parentSession: parent.getSessionId(), cwd: "/tmp" })}\n`);
      const id = await runChildThenReload(parent, transcript, { type: "Explore", definition: explore });
      // The built-in Explore, which grants bash, now answers to the name.
      rmSync(explore);

      await expectRefusedThroughBothDoors(parent, id, "Explore");
    });

    it("refuses it once deleting its project file uncovers a global file of the same name", async () => {
      mkdirSync(join(agentDir, "agents"));
      writeFileSync(join(agentDir, "agents", "reviewer.md"), "---\ndescription: Reviews and fixes\ntools: read, bash, edit\n---\n\nFix it.");
      const parent = createParent();
      const transcript = join(tasksDir, "reviewer.jsonl");
      writeFileSync(transcript, `${JSON.stringify({ type: "session", id: "reviewer-session", parentSession: parent.getSessionId(), cwd: "/tmp" })}\n`);
      const id = await runChildThenReload(parent, transcript, { type: "reviewer", definition: reviewerFile() });
      rmSync(reviewerFile());

      await expectRefusedThroughBothDoors(parent, id, "reviewer");
    });

    it.each([
      ["deleted", () => { rmSync(join(projectDir, ".pi", "agents", "reviewer.md")); }],
      ["disabled", () => { writeReviewer("enabled: false\n"); }],
    ])("refuses it once %s, through both the tool and the service, opening nothing", async (_label, change) => {
      const parent = createParent();
      const transcript = join(tasksDir, "reviewer.jsonl");
      writeFileSync(transcript, `${JSON.stringify({ type: "session", id: "reviewer-session", parentSession: parent.getSessionId(), cwd: "/tmp" })}\n`);
      const id = await runChildThenReload(parent, transcript, { type: "reviewer", definition: reviewerFile() });
      change();

      const result = await resumeAfterReload(parent, id);

      expect(result.content[0].text).toBe(
        `Agent "${id}" ran as an agent type that is no longer defined, is disabled, or is now defined elsewhere; ` +
          "resume is unavailable because it would run under a definition it never had. " +
          "Spawn a new agent of an available type instead.",
      );
      expect(await getSubagentsService()!.resume(id, "continue")).toEqual({
        kind: "refused",
        reason: "agent-type-unavailable",
      });
      expect(createSubagentSession).not.toHaveBeenCalled();
    });

    it("refuses it through the service alone, though no subagent call has re-read the definitions since", async () => {
      const parent = createParent();
      const transcript = join(tasksDir, "reviewer.jsonl");
      writeFileSync(transcript, `${JSON.stringify({ type: "session", id: "reviewer-session", parentSession: parent.getSessionId(), cwd: "/tmp" })}\n`);
      const id = await runChildThenReload(parent, transcript, { type: "reviewer", definition: reviewerFile() });
      vi.mocked(createSubagentSession).mockClear();
      const { pi, fire } = makePi();
      subagentsExtension(pi);
      await fire("session_start", {}, contextFor(parent));
      // Disabled after this instance loaded its definitions.
      writeReviewer("enabled: false\n");

      expect(await getSubagentsService()!.resume(id, "continue")).toEqual({
        kind: "refused",
        reason: "agent-type-unavailable",
      });
      expect(createSubagentSession).not.toHaveBeenCalled();
    });

    it("restores it while the type is still defined and enabled", async () => {
      const parent = createParent();
      const transcript = join(tasksDir, "reviewer.jsonl");
      writeFileSync(transcript, `${JSON.stringify({ type: "session", id: "reviewer-session", parentSession: parent.getSessionId(), cwd: "/tmp" })}\n`);
      const id = await runChildThenReload(parent, transcript, { type: "reviewer", definition: reviewerFile() });

      const result = await resumeAfterReload(parent, id);

      expect(createSubagentSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "reviewer" }), expect.anything());
      expect(result.content[0].text).toBe(`Agent ID: ${id}\n\nPicked up where I left off.`);
    });
  });
});
