import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type {
  CreateSessionOptions,
  ResourceLoaderOptions,
} from "#src/lifecycle/create-subagent-session";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import { SubagentSession } from "#src/lifecycle/subagent-session";
import type { EnvInfo } from "#src/session/env";
import type { BranchEntryLike } from "#src/session/recorded-model";
import { makeModel } from "#test/helpers/make-model";
import { STUB_CTX, STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import {
  chainEntries,
  createAgentLookup,
  createChildLifecycleMock,
  createFactorySession,
  createReopenedSessionManager,
  createSubagentSessionDeps,
  createSubagentSessionIO,
  DEFAULT_AGENT_CONFIG,
  EARLIER_MODEL,
  EARLIER_SNAPSHOT,
  EARLIER_TRANSCRIPT,
  type ReopenedEntry,
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
  // A parent whose registry still knows the model the transcript selects.
  const SNAPSHOT = EARLIER_SNAPSHOT;

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

    await createSubagentSession({ snapshot: SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps());

    expect(io.openSessionManager).toHaveBeenCalledWith(TRANSCRIPT.file);
    expect(io.createSessionManager).not.toHaveBeenCalled();
    expect(reopened().newSession).not.toHaveBeenCalled();
    expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ sessionManager: reopened() }));
  });

  it("keeps writing to the transcript it continues", async () => {
    arrangeFactory();

    const sub = await createSubagentSession(
      { snapshot: SNAPSHOT, type: "Explore", transcript: TRANSCRIPT },
      defaultDeps(),
    );

    expect(sub.outputFile).toBe(TRANSCRIPT.file);
  });

  it("runs in the directory the transcript recorded, not the parent's", async () => {
    arrangeFactory();

    await createSubagentSession({ snapshot: SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps());

    expect(io.detectEnv).toHaveBeenCalledWith(exec, "/work/earlier");
    expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/work/earlier" }));
  });

  it("announces the child under the session id the transcript already carries", async () => {
    arrangeFactory();
    const lifecycle = createChildLifecycleMock();

    await createSubagentSession(
      {
        snapshot: SNAPSHOT,
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

      await createSubagentSession({ snapshot: SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps());

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
        createSubagentSession({ snapshot: SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps()),
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
        createSubagentSession({ snapshot: SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps()),
      ).rejects.toThrow(`Transcript ${TRANSCRIPT.file} no longer holds this child's session; it was not restored.`);
      expect(io.createSession).not.toHaveBeenCalled();
    });

    it("refuses a file with no header at all", async () => {
      arrangeFactory();
      reopensAs({ getHeader: vi.fn(() => null) });

      await expect(
        createSubagentSession({ snapshot: SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps()),
      ).rejects.toThrow("no longer holds this child's session");
      expect(io.createSession).not.toHaveBeenCalled();
    });

  });

  describe("a transcript whose raw history does not hold the child's whole conversation", () => {
    const prompt = { type: "message", id: "earlier-prompt", message: { role: "user" } };
    const reply = { type: "message", id: TRANSCRIPT.leafId, message: { role: "assistant", provider: EARLIER_MODEL.provider, model: EARLIER_MODEL.id } };

    /** Continue EARLIER_TRANSCRIPT reopened holding `entries`, expecting the refusal `message` before any session exists. */
    async function expectRefused(entries: ReopenedEntry[], message: string) {
      arrangeFactory();
      const reopenedWith = createReopenedSessionManager(entries);
      io.openSessionManager.mockReturnValueOnce(reopenedWith);

      await expect(
        createSubagentSession({ snapshot: SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps()),
      ).rejects.toThrow(message);
      expect(io.createSession).not.toHaveBeenCalled();
      // Pi's own walk never ran on it: it stops silently at a missing parent and never returns from a loop.
      expect(reopenedWith.getBranch).not.toHaveBeenCalled();
    }

    const cutShort = `Transcript ${TRANSCRIPT.file} no longer holds the conversation its last run left; it was not restored.`;
    const noConversation = `Transcript ${TRANSCRIPT.file} holds no conversation to continue; it was not restored.`;

    it.each([
      ["only the system prompt Pi recorded", [{ type: "message", message: { role: "system" } }]],
      ["a prompt the child never answered", [{ type: "message", message: { role: "system" } }, { type: "message", message: { role: "user" } }]],
    ])("refuses a branch to the recorded leaf holding %s", async (_label, before) => {
      const leaf = { type: "custom", id: TRANSCRIPT.leafId };
      await expectRefused(chainEntries([...before, leaf]), noConversation);
    });

    it("refuses a transcript cut short of the entry the child's last run left", async () => {
      await expectRefused(chainEntries([prompt]), cutShort);
    });

    it("refuses a tail cut off from its root by a missing entry, though it keeps the leaf, a prompt, and a reply", async () => {
      const [, kept, , ...tail] = chainEntries([
        { type: "message", message: { role: "user" } },
        { type: "message", message: { role: "assistant" } },
        { type: "message", message: { role: "user" } },
        { type: "message", message: { role: "user" } },
        reply,
      ]);
      // entry-0 (the root) and entry-2 are gone; what is left names parents the file no longer holds.
      await expectRefused([kept, ...tail], cutShort);
    });

    it("refuses a branch whose first entry is not a root", async () => {
      const [first, second] = chainEntries([prompt, reply]);
      await expectRefused([{ ...first, parentId: "never-written" }, second], cutShort);
    });

    it("refuses a branch that loops back on itself, instead of walking it forever", async () => {
      const [first, second] = chainEntries([prompt, reply]);
      await expectRefused([{ ...first, parentId: second.id }, second], cutShort);
    });

    it("refuses a branch Pi would continue that does not pass through the recorded leaf", async () => {
      // A second line of entries off the root, appended after the child's own: Pi continues from its last entry.
      const [root, leaf] = chainEntries([prompt, reply]);
      const elsewhere = { type: "message", id: "elsewhere", parentId: root.id, message: { role: "assistant" } };
      await expectRefused([root, leaf, elsewhere], cutShort);
    });

    it("refuses a transcript with no entries at all", async () => {
      await expectRefused([], cutShort);
    });

    it("continues a transcript that holds that entry with more after it", async () => {
      arrangeFactory();
      io.openSessionManager.mockReturnValueOnce(
        createReopenedSessionManager(chainEntries([prompt, reply, { type: "custom", id: "appended-after-the-record" }])),
      );

      await createSubagentSession({ snapshot: SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps());

      expect(io.createSession).toHaveBeenCalledOnce();
    });

    it("continues a compacted transcript whose raw history still holds the prompt and reply", async () => {
      arrangeFactory();
      // Pi projects this as the summary and what it kept: the prompt is in the raw history only.
      const compacted = chainEntries([
        prompt,
        { type: "message", message: { role: "assistant", provider: EARLIER_MODEL.provider, model: EARLIER_MODEL.id } },
        { type: "compaction", id: TRANSCRIPT.leafId },
      ]);
      io.openSessionManager.mockReturnValueOnce(createReopenedSessionManager(compacted));

      await createSubagentSession({ snapshot: SNAPSHOT, type: "Explore", transcript: TRANSCRIPT }, defaultDeps());

      expect(io.createSession).toHaveBeenCalledOnce();
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

    /**
     * Continue a transcript whose branch is the child's prompt, then `branch`,
     * ending on the entry its last run left, against `registry`.
     */
    function continueWithBranch(branch: BranchEntryLike[]) {
      arrangeFactory();
      const last = branch.length - 1;
      const entries = chainEntries([
        { type: "message", message: { role: "user" } },
        ...branch.map((entry, i) => (i === last ? { ...entry, id: TRANSCRIPT.leafId } : entry)),
      ]);
      io.openSessionManager.mockReturnValueOnce(createReopenedSessionManager(entries));
      return createSubagentSession(
        { snapshot: { ...SNAPSHOT, model: parentModel, modelRegistry: registry }, type: "Explore", transcript: TRANSCRIPT },
        defaultDeps(),
      );
    }

    const reply = (provider: string, model: string, api = "openai-responses") => ({
      type: "message",
      message: { role: "assistant", provider, model, api },
    });

    it("runs on the model of the last physical reply, over the agent's default", async () => {
      await continueWithBranch([reply("openai", "gpt-recorded")]);

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
      await continueWithBranch([reply("openai", "gpt-recorded"), { type: "model_change", provider: "openai", modelId: "gpt-recorded" }]);

      expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: physical }));
    });

    it("refuses a transcript whose model the parent no longer knows, rather than send it to another", async () => {
      await expect(continueWithBranch([reply("gone", "retired")])).rejects.toThrow(
          'The child\'s transcript selects "gone/retired", which is not available; the child was not restored.',
      );
      expect(io.createSession).not.toHaveBeenCalled();
    });

    it("refuses a transcript whose route the parent no longer knows, though it knows the model that answered under it", async () => {
      // Pi's rule, not finding router/retired, would pass over it for the physical reply.
      await expect(
        continueWithBranch([{ type: "model_change", provider: "router", modelId: "retired" }, reply("openai", "gpt-recorded")]),
      ).rejects.toThrow('The child\'s transcript selects "router/retired", which is not available; the child was not restored.');
      expect(io.createSession).not.toHaveBeenCalled();
    });

    it("refuses a transcript that selects no model at all", async () => {
      await expect(continueWithBranch([{ type: "message", message: { role: "assistant" } }])).rejects.toThrow(
        "The child's transcript selects no model, which is not available; the child was not restored.",
      );
      expect(io.createSession).not.toHaveBeenCalled();
    });

    it("runs on a model the caller chose, without needing the recorded one", async () => {
      arrangeFactory();
      const chosen = makeModel({ id: "chosen" });
      io.openSessionManager.mockReturnValueOnce(
        createReopenedSessionManager(
          chainEntries([
            { type: "message", message: { role: "user" } },
            { type: "message", id: TRANSCRIPT.leafId, message: { role: "assistant", provider: "gone", model: "retired" } },
          ]),
        ),
      );

      await createSubagentSession({ snapshot: SNAPSHOT, type: "Explore", transcript: TRANSCRIPT, model: chosen }, defaultDeps());

      expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: chosen }));
    });
  });

  it("leaves the thinking level to the transcript, over the agent's declared one", async () => {
    arrangeFactory();
    const declared = { ...DEFAULT_AGENT_CONFIG, thinking: "high" as const };

    await createSubagentSession(
      { snapshot: SNAPSHOT, type: "Explore", transcript: TRANSCRIPT },
      createSubagentSessionDeps({ io, exec, registry: createAgentLookup(declared), currentAgentConfig: () => declared }),
    );

    expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ thinkingLevel: undefined }));
  });

  it("treats its first run here as a resume: no parent-context prefix, no completed event", async () => {
    const session = arrangeFactory();
    const lifecycle = createChildLifecycleMock();

    const sub = await createSubagentSession(
      { snapshot: { ...SNAPSHOT, parentContext: "CTX\n" }, type: "Explore", transcript: TRANSCRIPT },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, lifecycle }),
    );
    await sub.runTurnLoop("Continue", {});

    expect(session.prompt).toHaveBeenCalledWith("Continue");
    expect(lifecycle.completed).not.toHaveBeenCalled();
  });

  describe("its agent type", () => {
    it("assembles the child under the type's current definition, not whatever the lookup falls back to", async () => {
      arrangeFactory();
      const reviewer = { ...DEFAULT_AGENT_CONFIG, name: "Reviewer", toolNames: ["read"], systemPrompt: "Review only." };
      const fallback = createAgentLookup({ toolNames: ["read", "bash", "edit", "write"] });

      await createSubagentSession(
        { snapshot: SNAPSHOT, type: "Reviewer", transcript: TRANSCRIPT },
        createSubagentSessionDeps({ io, exec, registry: fallback, currentAgentConfig: () => reviewer }),
      );

      expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ tools: ["read"] }));
      expect(io.assemblerIO.buildAgentPrompt).toHaveBeenCalledWith(reviewer, expect.anything(), expect.anything(), expect.anything(), expect.anything());
      expect(fallback.resolveAgentConfig).not.toHaveBeenCalled();
    });

    it("refuses a child whose type is no longer defined or is disabled, before any session exists", async () => {
      arrangeFactory();

      await expect(
        createSubagentSession(
          { snapshot: SNAPSHOT, type: "Reviewer", transcript: TRANSCRIPT },
          createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, currentAgentConfig: () => undefined }),
        ),
      ).rejects.toThrow(
        'Agent type "Reviewer" is no longer defined as the child ran under it, or is disabled; the child was not restored.',
      );
      expect(io.createSession).not.toHaveBeenCalled();
    });

    it.each([
      ["a built-in uncovered by deleting the project file", "builtin"],
      ["a global file uncovered by deleting the project file", "/home/user/.pi/agent/agents/Reviewer.md"],
      ["another project's file of the same name", "/elsewhere/.pi/agents/Reviewer.md"],
    ])("refuses a type now supplied by %s, which would grant other tools", async (_label, filePath) => {
      arrangeFactory();
      const ranUnder = { ...TRANSCRIPT, agentDefinition: "/project/.pi/agents/Reviewer.md" };
      const now = { ...DEFAULT_AGENT_CONFIG, name: "Reviewer", toolNames: ["read", "bash", "edit"], ...(filePath === "builtin" ? {} : { filePath }) };

      await expect(
        createSubagentSession(
          { snapshot: SNAPSHOT, type: "Reviewer", transcript: ranUnder },
          createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, currentAgentConfig: () => now }),
        ),
      ).rejects.toThrow('Agent type "Reviewer" is no longer defined as the child ran under it, or is disabled');
      expect(io.createSession).not.toHaveBeenCalled();
    });

    it("records the definition a new session was assembled under, for a later restore to require", async () => {
      arrangeFactory();
      const filePath = "/project/.pi/agents/Explore.md";

      const sub = await createSubagentSession(
        { snapshot: STUB_SNAPSHOT, type: "Explore" },
        createSubagentSessionDeps({ io, exec, registry: createAgentLookup({ filePath }) }),
      );

      expect(sub.agentDefinition).toBe(filePath);
    });

    it("continues under the same definition file, read as it is now", async () => {
      arrangeFactory();
      const filePath = "/project/.pi/agents/Reviewer.md";
      const now = { ...DEFAULT_AGENT_CONFIG, name: "Reviewer", toolNames: ["read"], filePath };

      await createSubagentSession(
        { snapshot: SNAPSHOT, type: "Reviewer", transcript: { ...TRANSCRIPT, agentDefinition: filePath } },
        createSubagentSessionDeps({ io, exec, registry: mockAgentLookup, currentAgentConfig: () => now }),
      );

      expect(io.createSession).toHaveBeenCalledWith(expect.objectContaining({ tools: ["read"] }));
    });

    it("refuses a type removed while the environment is detected, the last wait before assembly", async () => {
      arrangeFactory();
      const definitions = new Map([["Reviewer", { ...DEFAULT_AGENT_CONFIG, name: "Reviewer", toolNames: ["read"] }]]);
      const registry = new AgentTypeRegistry(() => definitions);
      const environment = Promise.withResolvers<EnvInfo>();
      io.detectEnv.mockReturnValueOnce(environment.promise);
      const creating = createSubagentSession(
        { snapshot: SNAPSHOT, type: "Reviewer", transcript: TRANSCRIPT },
        createSubagentSessionDeps({
          io,
          exec,
          registry,
          currentAgentConfig: (type) => {
            registry.reload();
            return registry.findEnabledConfig(type);
          },
        }),
      );

      definitions.clear();
      environment.resolve({ isGitRepo: false, branch: "", platform: "linux" });

      await expect(creating).rejects.toThrow('Agent type "Reviewer" is no longer defined as the child ran under it');
      expect(io.createSession).not.toHaveBeenCalled();
    });
  });
});
