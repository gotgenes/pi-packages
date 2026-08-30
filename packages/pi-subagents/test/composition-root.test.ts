/**
 * Composition-root tests for `subagentsExtension(pi)`.
 *
 * These assert the wiring contract that unit tests cannot see: what the root's
 * `io.createSession` hands to the SDK. The replay logic itself is covered by
 * `test/session/provider-inheritance.test.ts`, but those tests pass whether or
 * not the root calls it — only this file fails if the wiring is removed.
 */
import { describe, expect, it, vi } from "vitest";

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
import { createMockSession, createSubagentSessionStub, toSubagentSession } from "./helpers/mock-session";

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

/** Run the extension far enough to capture the deps bag the root assembled. */
async function captureSessionFactoryIO(parentRegistry: unknown) {
  vi.mocked(createSubagentSession).mockResolvedValue(
    toSubagentSession(createSubagentSessionStub(createMockSession(), "/sessions/child.jsonl")),
  );
  const { pi, tools, fire } = makePi();
  subagentsExtension(pi);
  await fire(
    "session_start",
    {},
    {
      hasUI: false,
      ui: { setStatus: vi.fn(), setWidget: vi.fn() },
      cwd: "/tmp",
      model: undefined,
      modelRegistry: parentRegistry,
      sessionManager: {
        getSessionId: vi.fn(() => "session-1"),
        getSessionFile: vi.fn(() => "/sessions/parent.jsonl"),
        getBranch: vi.fn(() => []),
      },
      getSystemPrompt: vi.fn(() => "parent prompt"),
    } as any,
  );

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
