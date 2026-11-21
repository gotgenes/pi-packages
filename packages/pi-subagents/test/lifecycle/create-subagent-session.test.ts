import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateSessionOptions,
  ResourceLoaderOptions,
} from "#src/lifecycle/create-subagent-session";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import { SubagentSession } from "#src/lifecycle/subagent-session";
import type { BranchEntryLike } from "#src/session/recorded-model";
import { makeModel } from "#test/helpers/make-model";
import { STUB_CTX, STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import {
  createAgentLookup,
  createChildLifecycleMock,
  createFactorySession,
  createReopenedSessionManager,
  createSubagentSessionDeps,
  createSubagentSessionIO,
  EARLIER_TRANSCRIPT,
} from "#test/helpers/subagent-session-io";

/**
 * The context a custom tool's `execute` receives, derived from the call it
 * feeds so the stub fits whichever context type the installed SDK declares.
 */
type ExecuteCtx = Parameters<NonNullable<CreateSessionOptions["customTools"]>[number]["execute"]>[4];

/** Mock AgentConfigLookup. */
const mockAgentLookup = createAgentLookup();

let io: ReturnType<typeof createSubagentSessionIO>;

const exec = vi.fn();

beforeEach(() => {
  io = createSubagentSessionIO();
});

/** Arrange: build a factory session and wire it as the created session. Returns it for assertions. */
function arrangeFactory() {
  const session = createFactorySession();
  io.createSession.mockResolvedValue({ session });
  return session;
}

/** The standard deps bag for the default `io`/`exec`/`registry` wiring. */
function defaultDeps() {
  return createSubagentSessionDeps({ io, exec, registry: mockAgentLookup });
}

describe("createSubagentSession — assembly", () => {
  let session: ReturnType<typeof createFactorySession>;

  beforeEach(() => {
    session = createFactorySession();
    io.createSession.mockResolvedValue({ session });
  });

  it("returns a born-complete SubagentSession wrapping the created session", async () => {
    const sub = await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    expect(sub).toBeInstanceOf(SubagentSession);
    expect(sub.session).toBe(session);
  });

  it("holds the session to the agent's maxTurns over the run config's default", async () => {
    const sub = await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnLimits: { defaultMaxTurns: 9, wrapUpTurns: 3 } },
      createSubagentSessionDeps({ io, exec, registry: createAgentLookup({ maxTurns: 7 }) }),
    );

    const result = await sub.runTurnLoop("go", {});

    expect(result.turnBudget).toEqual({ maxTurns: 7, used: 0, phase: "within" });
  });

  it("exposes the persisted session file as outputFile", async () => {
    const sub = await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    expect(sub.outputFile).toBe("/sessions/child.jsonl");
  });

  it("binds extensions before returning", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    expect(session.bindExtensions).toHaveBeenCalledTimes(1);
    expect(session.bindExtensions).toHaveBeenCalledWith({});
  });

  it("passes the effective cwd and agentDir to the loader, settings, and session", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", cwd: "/tmp/worktree" },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    expect(io.getAgentDir).toHaveBeenCalledTimes(1);
    expect(io.createResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/tmp/worktree", agentDir: "/mock/agent-dir" }),
    );
    expect(io.createSettingsManager).toHaveBeenCalledWith("/tmp/worktree", "/mock/agent-dir");
    expect(io.createSessionManager).toHaveBeenCalledWith("/tmp/worktree", "/mock/session-dir/tasks");
    expect(io.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/tmp/worktree", agentDir: "/mock/agent-dir" }),
    );
  });

  it("gives the resource loader the derived settings view, not the session's own", async () => {
    const sessionSettings = { marker: "session" };
    const loaderSettings = { marker: "loader" };
    io.createSettingsManager.mockReturnValue(sessionSettings);
    io.createLoaderSettingsManager.mockReturnValue(loaderSettings);

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    expect(io.createLoaderSettingsManager).toHaveBeenCalledWith(sessionSettings);
    expect(io.createResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({ settingsManager: loaderSettings }),
    );
    expect(io.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ settingsManager: sessionSettings }),
    );
  });

  it("creates the session's settings manager exactly once and reuses it", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    expect(io.createSettingsManager).toHaveBeenCalledTimes(1);
    expect(io.createLoaderSettingsManager).toHaveBeenCalledTimes(1);
  });

  it("suppresses AGENTS.md/CLAUDE.md/APPEND_SYSTEM.md for subagents", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    expect(io.createResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        noContextFiles: true,
        appendSystemPromptOverride: expect.any(Function),
      }),
    );
    const loaderOpts = io.createResourceLoader.mock.calls[0][0];
    expect(loaderOpts.appendSystemPromptOverride()).toEqual([]);
  });

  it("calls newSession with parentSession when parentSessionId is provided", async () => {
    await createSubagentSession(
      {
        snapshot: STUB_SNAPSHOT,
        type: "Explore",
        parentSession: { parentSessionFile: "/sessions/parent.jsonl", parentSessionId: "parent-id-123" },
      },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    const sm = io.createSessionManager.mock.results[0].value;
    expect(sm.newSession).toHaveBeenCalledWith({ parentSession: "parent-id-123" });
  });
});

describe("createSubagentSession — lifecycle ordering", () => {
  let session: ReturnType<typeof createFactorySession>;
  let lifecycle: ReturnType<typeof createChildLifecycleMock>;

  beforeEach(() => {
    session = createFactorySession();
    io.createSession.mockResolvedValue({ session });
    lifecycle = createChildLifecycleMock();
  });

  it("emits spawning before session-created", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, lifecycle }),
    );

    expect(lifecycle.spawning).toHaveBeenCalledOnce();
    const spawnOrder = lifecycle.spawning.mock.invocationCallOrder[0];
    const createdOrder = lifecycle.sessionCreated.mock.invocationCallOrder[0];
    expect(spawnOrder).toBeLessThan(createdOrder);
  });

  it("emits session-created before bindExtensions()", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, lifecycle }),
    );

    expect(lifecycle.sessionCreated).toHaveBeenCalledOnce();
    const createdOrder = lifecycle.sessionCreated.mock.invocationCallOrder[0];
    const bindOrder = session.bindExtensions.mock.invocationCallOrder[0];
    expect(createdOrder).toBeLessThan(bindOrder);
  });

  it("emits bound after bindExtensions()", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, lifecycle }),
    );

    expect(lifecycle.bound).toHaveBeenCalledOnce();
    const bindOrder = session.bindExtensions.mock.invocationCallOrder[0];
    const boundOrder = lifecycle.bound.mock.invocationCallOrder[0];
    expect(bindOrder).toBeLessThan(boundOrder);
  });

  it("carries the session id and parent session id in bound", async () => {
    await createSubagentSession(
      {
        snapshot: STUB_SNAPSHOT,
        type: "Explore",
        parentSession: {
          parentSessionFile: "/sessions/parent.jsonl",
          parentSessionId: "parent-session-42",
        },
      },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, lifecycle }),
    );

    expect(lifecycle.bound).toHaveBeenCalledWith({
      sessionId: "child-session-id",
      parentSessionId: "parent-session-42",
    });
  });

  it("carries the session id and parent session id in session-created", async () => {
    io.deriveSessionDir.mockReturnValue("/custom/session/dir");

    await createSubagentSession(
      {
        snapshot: STUB_SNAPSHOT,
        type: "Explore",
        parentSession: {
          parentSessionFile: "/sessions/parent.jsonl",
          parentSessionId: "parent-session-42",
        },
      },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, lifecycle }),
    );

    expect(lifecycle.sessionCreated).toHaveBeenCalledWith({
      sessionId: "child-session-id",
      parentSessionId: "parent-session-42",
    });
  });

  it("does not emit completed or disposed during creation", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, lifecycle }),
    );

    expect(lifecycle.completed).not.toHaveBeenCalled();
    expect(lifecycle.disposed).not.toHaveBeenCalled();
  });
});

describe("createSubagentSession — dispose on creation failure", () => {
  it("disposes the session and emits disposed when bindExtensions throws, then rethrows", async () => {
    const session = createFactorySession();
    session.bindExtensions = vi.fn().mockRejectedValue(new Error("bind failed"));
    io.createSession.mockResolvedValue({ session });
    io.deriveSessionDir.mockReturnValue("/custom/session/dir");
    const lifecycle = createChildLifecycleMock();

    await expect(
      createSubagentSession(
        { snapshot: STUB_SNAPSHOT, type: "Explore" },
        createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, lifecycle }),
      ),
    ).rejects.toThrow("bind failed");

    // session-created fired, so disposed must fire to avoid a registry leak.
    expect(lifecycle.sessionCreated).toHaveBeenCalledOnce();
    expect(lifecycle.disposed).toHaveBeenCalledOnce();
    expect(lifecycle.disposed).toHaveBeenCalledWith({ sessionId: "child-session-id" });
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it("does not emit bound when bindExtensions throws", async () => {
    const session = createFactorySession();
    session.bindExtensions = vi.fn().mockRejectedValue(new Error("bind failed"));
    io.createSession.mockResolvedValue({ session });
    const lifecycle = createChildLifecycleMock();

    await expect(
      createSubagentSession(
        { snapshot: STUB_SNAPSHOT, type: "Explore" },
        createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, lifecycle }),
      ),
    ).rejects.toThrow("bind failed");

    // The child never ran, so there is nothing to report about what its
    // extensions installed.
    expect(lifecycle.bound).not.toHaveBeenCalled();
  });

  it("shuts down the extensions that did initialize before the bind failed", async () => {
    const session = createFactorySession();
    session.bindExtensions = vi.fn().mockRejectedValue(new Error("bind failed"));
    io.createSession.mockResolvedValue({ session });

    await expect(
      createSubagentSession(
        { snapshot: STUB_SNAPSHOT, type: "Explore" },
        createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
      ),
    ).rejects.toThrow("bind failed");

    expect(session.extensionRunner.emit).toHaveBeenCalledWith({
      type: "session_shutdown",
      reason: "quit",
    });
  });
});

describe("createSubagentSession — recursion guard", () => {
  // A child loads this extension too, so it registers the spawn tools during
  // bindExtensions. They are denied at the SDK boundary, which holds for the
  // child's whole life — a post-bind active-set filter would be undone by the
  // next tool-registry refresh (#725).

  it("denies this extension's spawn tools when creating the child session", async () => {
    arrangeFactory();

    await createSubagentSession({ snapshot: STUB_SNAPSHOT, type: "Explore" }, defaultDeps());

    expect(io.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeTools: ["subagent", "get_subagent_result", "steer_subagent"],
      }),
    );
  });

  it("leaves the child's active tool set untouched after bind", async () => {
    const session = arrangeFactory();

    await createSubagentSession({ snapshot: STUB_SNAPSHOT, type: "Explore" }, defaultDeps());

    expect(session.setActiveToolsByName).not.toHaveBeenCalled();
  });
});

describe("createSubagentSession — the core's own child tools", () => {
  // The SDK applies `tools` as an allowlist *before* building the registry and
  // runs every `customTools` entry through it, so a custom tool whose name is
  // missing from the allowlist is dropped with no error (#725). Both halves are
  // asserted separately so dropping either one fails a test.

  describe("when the run supplies an ask-back recorder", () => {
    it("appends ask_parent to the allowlist the agent declared", async () => {
      arrangeFactory();

      await createSubagentSession(
        { snapshot: STUB_SNAPSHOT, type: "Explore", askParent: vi.fn() },
        defaultDeps(),
      );

      expect(io.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ tools: ["read", "ask_parent"] }),
      );
    });

    it("passes the ask_parent definition as a custom tool", async () => {
      arrangeFactory();

      await createSubagentSession(
        { snapshot: STUB_SNAPSHOT, type: "Explore", askParent: vi.fn() },
        defaultDeps(),
      );

      const opts = io.createSession.mock.calls[0][0] as CreateSessionOptions;
      expect(opts.customTools?.map((tool) => tool.name)).toEqual(["ask_parent"]);
    });

    it("appends over an agent that declared no tools at all", async () => {
      arrangeFactory();

      await createSubagentSession(
        { snapshot: STUB_SNAPSHOT, type: "Explore", askParent: vi.fn() },
        createSubagentSessionDeps({ io, exec, registry: createAgentLookup({ toolNames: [] }) }),
      );

      expect(io.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ tools: ["ask_parent"] }),
      );
    });

    it("routes a call on the installed tool to the supplied recorder", async () => {
      arrangeFactory();
      const askParent = vi.fn<(question: string) => void>();

      await createSubagentSession(
        { snapshot: STUB_SNAPSHOT, type: "Explore", askParent },
        defaultDeps(),
      );

      const opts = io.createSession.mock.calls[0][0] as CreateSessionOptions;
      await opts.customTools?.[0]?.execute(
        "tc-1",
        { question: "Which config wins?" },
        new AbortController().signal,
        () => {},
        STUB_CTX as ExecuteCtx,
      );
      expect(askParent).toHaveBeenCalledWith("Which config wins?");
    });
  });

  describe("when the run supplies no callbacks", () => {
    it("leaves the agent's declared allowlist alone", async () => {
      arrangeFactory();

      await createSubagentSession({ snapshot: STUB_SNAPSHOT, type: "Explore" }, defaultDeps());

      expect(io.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ tools: ["read"] }),
      );
    });

    it("installs no custom tools", async () => {
      arrangeFactory();

      await createSubagentSession({ snapshot: STUB_SNAPSHOT, type: "Explore" }, defaultDeps());

      const opts = io.createSession.mock.calls[0][0] as CreateSessionOptions;
      expect(opts.customTools).toEqual([]);
    });
  });
});

describe("createSubagentSession — prompt inheritance", () => {
  /** The inherited-prompt argument the assembler handed the prompt builder. */
  function inheritedArgument() {
    return io.assemblerIO.buildAgentPrompt.mock.calls[0]?.[3];
  }

  it("hands the prompt builder the snapshot's portable parts", async () => {
    arrangeFactory();

    await createSubagentSession(
      {
        snapshot: { ...STUB_SNAPSHOT, portablePrompt: "You are a specialist." },
        type: "Explore",
      },
      defaultDeps(),
    );

    expect(inheritedArgument()?.portablePrompt).toBe("You are a specialist.");
  });

  it("applies the strategy the deps' resolver returns", async () => {
    arrangeFactory();

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      createSubagentSessionDeps({
        io,
        exec,
        registry: mockAgentLookup,
        resolvePromptInheritance: () => "portable",
      }),
    );

    expect(inheritedArgument()?.strategy).toBe("portable");
  });
});

/** The names of the built-ins the child's resource loader was handed. */
function loadedBuiltinNames(): string[] | undefined {
  const opts = io.createResourceLoader.mock.calls[0]?.[0] as ResourceLoaderOptions | undefined;
  return opts?.extensionFactories?.map((extension) =>
    typeof extension === "function" ? "<factory>" : extension.name,
  );
}

describe("createSubagentSession — Pi built-in extensions", () => {
  it("hands the loader the built-ins the agent's tools call for", async () => {
    arrangeFactory();

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      createSubagentSessionDeps({
        io,
        exec,
        registry: createAgentLookup({ toolNames: ["read", "codemode", "mcp__github__get_issue"] }),
      }),
    );

    expect(loadedBuiltinNames()).toEqual(["codemode", "mcp"]);
  });

  it("hands the loader no built-ins when the agent's tools call for none", async () => {
    arrangeFactory();

    await createSubagentSession({ snapshot: STUB_SNAPSHOT, type: "Explore" }, defaultDeps());

    expect(loadedBuiltinNames()).toEqual([]);
  });
});

describe("createSubagentSession — MCP tool patterns", () => {
  const PARENT_TOOLS = ["read", "mcp__github__a", "mcp__github__b", "mcp__gitlab__c"];

  function depsDeclaring(toolNames: string[], parentTools: string[]) {
    return createSubagentSessionDeps({
      io,
      exec,
      registry: createAgentLookup({ toolNames }),
      listParentToolNames: () => parentTools,
    });
  }

  it("admits the parent's tools a pattern matches, and loads MCP for them", async () => {
    arrangeFactory();

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      depsDeclaring(["read", "mcp__github__*"], PARENT_TOOLS),
    );

    expect(io.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ tools: ["read", "mcp__github__a", "mcp__github__b"] }),
    );
    expect(loadedBuiltinNames()).toEqual(["mcp"]);
  });

  it("admits nothing and loads no MCP for a pattern the parent's tools do not match", async () => {
    arrangeFactory();

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore" },
      depsDeclaring(["read", "mcp__github__*"], ["read", "mcp__gitlab__c"]),
    );

    expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ tools: ["read"] }));
    expect(loadedBuiltinNames()).toEqual([]);
  });
});

describe("createSubagentSession — continuing an earlier transcript", () => {
  const TRANSCRIPT = EARLIER_TRANSCRIPT;

  /** The session manager the factory reopened the transcript with. */
  function reopened() {
    return io.openSessionManager.mock.results[0]?.value;
  }

  /** Arm the next reopening to hand back a session manager with these overrides. */
  function reopensAs(overrides: Partial<ReturnType<typeof createReopenedSessionManager>>) {
    io.openSessionManager.mockReturnValueOnce({ ...createReopenedSessionManager(), ...overrides });
  }

  it("reopens the transcript rather than starting a new session", async () => {
    arrangeFactory();

    await createSubagentSession({ snapshot: STUB_SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps());

    expect(io.openSessionManager).toHaveBeenCalledWith(TRANSCRIPT.file);
    expect(io.createSessionManager).not.toHaveBeenCalled();
    expect(reopened().newSession).not.toHaveBeenCalled();
    expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ sessionManager: reopened() }));
  });

  it("keeps writing to the transcript it continues", async () => {
    arrangeFactory();

    const sub = await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", transcript: TRANSCRIPT },
      defaultDeps(),
    );

    expect(sub.outputFile).toBe(TRANSCRIPT.file);
  });

  it("runs in the directory the transcript recorded, not the parent's", async () => {
    arrangeFactory();

    await createSubagentSession({ snapshot: STUB_SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps());

    expect(io.detectEnv).toHaveBeenCalledWith(exec, "/work/earlier");
    expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/work/earlier" }));
  });

  it("announces the child under the session id the transcript already carries", async () => {
    arrangeFactory();
    const lifecycle = createChildLifecycleMock();

    await createSubagentSession(
      {
        snapshot: STUB_SNAPSHOT,
        type: "Explore",
        transcript: TRANSCRIPT,
        parentSession: { parentSessionId: "parent-id" },
      },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, lifecycle }),
    );

    expect(lifecycle.sessionCreated).toHaveBeenCalledWith({
      sessionId: "earlier-child-session-id",
      parentSessionId: "parent-id",
    });
  });

  describe("a transcript checked read-only before it is opened", () => {
    it("reads the file's header before opening it", async () => {
      arrangeFactory();

      await createSubagentSession({ snapshot: STUB_SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps());

      expect(io.readTranscriptHeader).toHaveBeenCalledExactlyOnceWith(TRANSCRIPT.file);
      expect(io.readTranscriptHeader.mock.invocationCallOrder[0]).toBeLessThan(io.openSessionManager.mock.invocationCallOrder[0]);
    });

    it.each([
      ["no usable header (missing, empty, or not a session)", undefined],
      ["another session's id", { ...EARLIER_TRANSCRIPT.header, id: "someone-else" }],
      ["another parent", { ...EARLIER_TRANSCRIPT.header, parentSession: "other-parent" }],
      ["another directory", { ...EARLIER_TRANSCRIPT.header, cwd: "/work/elsewhere" }],
    ])("refuses a file with %s without opening it", async (_label, header) => {
      arrangeFactory();
      io.readTranscriptHeader.mockReturnValueOnce(header);

      await expect(
        createSubagentSession({ snapshot: STUB_SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps()),
      ).rejects.toThrow(`Transcript ${TRANSCRIPT.file} no longer holds this child's session; it was not restored.`);
      expect(io.openSessionManager).not.toHaveBeenCalled();
      expect(io.createSession).not.toHaveBeenCalled();
    });
  });

  describe("a transcript that no longer holds the child once opened", () => {
    it.each([
      ["a new session in its place (the file was missing)", { id: "fresh-session-id", cwd: "/work/earlier", parentSession: undefined }],
      ["another session's id", { id: "someone-else", cwd: "/work/earlier", parentSession: "parent-id" }],
      ["another parent", { id: "earlier-child-session-id", cwd: "/work/earlier", parentSession: "other-parent" }],
      ["another directory", { id: "earlier-child-session-id", cwd: "/work/elsewhere", parentSession: "parent-id" }],
    ])("refuses %s before any session exists", async (_label, header) => {
      arrangeFactory();
      reopensAs({ getHeader: vi.fn(() => header) });

      await expect(
        createSubagentSession({ snapshot: STUB_SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps()),
      ).rejects.toThrow(`Transcript ${TRANSCRIPT.file} no longer holds this child's session; it was not restored.`);
      expect(io.createSession).not.toHaveBeenCalled();
    });

    it("refuses a file with no header at all", async () => {
      arrangeFactory();
      reopensAs({ getHeader: vi.fn(() => null) });

      await expect(
        createSubagentSession({ snapshot: STUB_SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps()),
      ).rejects.toThrow("no longer holds this child's session");
      expect(io.createSession).not.toHaveBeenCalled();
    });

    it("refuses a transcript with no conversation to continue", async () => {
      arrangeFactory();
      reopensAs({ buildSessionContext: vi.fn(() => ({ messages: [] })) });

      await expect(
        createSubagentSession({ snapshot: STUB_SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps()),
      ).rejects.toThrow(`Transcript ${TRANSCRIPT.file} holds no conversation to continue; it was not restored.`);
      expect(io.createSession).not.toHaveBeenCalled();
    });
  });

  describe("the model it continues on", () => {
    const physical = makeModel({ provider: "openai", id: "gpt-recorded" });
    const router = makeModel({ provider: "router", id: "auto", api: "pi-virtual" });
    const parentModel = makeModel({ id: "parent-model" });
    const registry = {
      find: (provider: string, modelId: string) =>
        [physical, router].find((model) => model.provider === provider && model.id === modelId),
      getAll: () => [physical, router],
    };

    /** Continue a transcript whose branch holds `branch`, against `registry`. */
    async function continueWithBranch(branch: BranchEntryLike[]) {
      arrangeFactory();
      reopensAs({ getBranch: vi.fn(() => branch) });
      await createSubagentSession(
        { snapshot: { ...STUB_SNAPSHOT, model: parentModel, modelRegistry: registry }, type: "Explore", transcript: TRANSCRIPT },
        defaultDeps(),
      );
    }

    const reply = (provider: string, model: string, api = "openai-responses") => ({
      type: "message",
      message: { role: "assistant", provider, model, api },
    });

    it("runs on the model of the last physical reply, over the agent's default", async () => {
      await continueWithBranch([{ type: "message", message: { role: "user" } }, reply("openai", "gpt-recorded")]);

      expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: physical }));
    });

    it("keeps a virtual model selected, though a physical model answered under it", async () => {
      await continueWithBranch([
        { type: "model_change", provider: "router", modelId: "auto" },
        reply("openai", "gpt-recorded"),
      ]);

      expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: router }));
    });

    it("runs on a model selected after the last reply", async () => {
      await continueWithBranch([reply("router", "auto", "pi-virtual"), { type: "model_change", provider: "openai", modelId: "gpt-recorded" }]);

      expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: physical }));
    });

    it("falls back to the agent's model when the recorded one is no longer known", async () => {
      await continueWithBranch([reply("gone", "retired")]);

      expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: parentModel }));
    });
  });

  it("leaves the thinking level to the transcript, over the agent's declared one", async () => {
    arrangeFactory();

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", transcript: TRANSCRIPT },
      createSubagentSessionDeps({ io, exec, registry: createAgentLookup({ thinking: "high" }) }),
    );

    expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ thinkingLevel: undefined }));
  });

  it("treats its first run here as a resume: no parent-context prefix, no completed event", async () => {
    const session = arrangeFactory();
    const lifecycle = createChildLifecycleMock();

    const sub = await createSubagentSession(
      { snapshot: { ...STUB_SNAPSHOT, parentContext: "CTX\n" }, type: "Explore", transcript: TRANSCRIPT },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, lifecycle }),
    );
    await sub.runTurnLoop("Continue", {});

    expect(session.prompt).toHaveBeenCalledWith("Continue");
    expect(lifecycle.completed).not.toHaveBeenCalled();
  });
});
