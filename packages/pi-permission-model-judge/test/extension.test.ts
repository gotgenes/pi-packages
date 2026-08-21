import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type {
  PermissionsReadyEvent,
  PermissionsService,
  PromptPermissionDetails,
} from "@gotgenes/pi-permission-system";
import {
  publishPermissionsService,
  unpublishPermissionsService,
} from "@gotgenes/pi-permission-system";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGlobalConfigPath, type LoadConfigResult } from "#src/config-loader";
import { createModelJudgeExtension } from "#src/extension";
import type { CompleteFn } from "#src/model-review";
import { assistantToolCall } from "#test/fixtures/assistant-message";
import { makePromptDetails } from "#test/fixtures/permission-details";

const READY_CHANNEL = "permissions:ready";

/** The session id of the node under test — the key its service publishes under. */
const SESSION_ID = "session-under-test";

const CONFIG_RESULT: LoadConfigResult = {
  config: {
    provider: "anthropic",
    model: "claude-haiku",
    instructions: "Flag doubled path segments.",
    typoPatterns: [
      "packages/pi-permission-system/packages/pi-permission-system",
    ],
    timeoutMs: 5000,
  },
  issues: [],
};

const MODEL = { provider: "anthropic", id: "claude-haiku" } as Model<any>;

interface FakePi {
  lifecycle: Map<string, (event: unknown, ctx: unknown) => void>;
  events: Map<string, (data: unknown) => void>;
  api: {
    on: ReturnType<typeof vi.fn>;
    events: { on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> };
  };
}

function makeFakePi(): FakePi {
  const lifecycle = new Map<string, (event: unknown, ctx: unknown) => void>();
  const events = new Map<string, (data: unknown) => void>();
  return {
    lifecycle,
    events,
    api: {
      on: vi.fn(
        (name: string, handler: (event: unknown, ctx: unknown) => void) => {
          lifecycle.set(name, handler);
        },
      ),
      events: {
        on: vi.fn((channel: string, handler: (data: unknown) => void) => {
          events.set(channel, handler);
          return () => events.delete(channel);
        }),
        emit: vi.fn(),
      },
    },
  };
}

function makeService(): PermissionsService & {
  registerAuthorizer: ReturnType<typeof vi.fn>;
  disposer: ReturnType<typeof vi.fn>;
} {
  const disposer = vi.fn();
  return {
    checkPermission: vi.fn(),
    getToolPermission: vi.fn(),
    registerToolInputFormatter: vi.fn(() => () => {}),
    registerToolAccessExtractor: vi.fn(() => () => {}),
    registerAuthorizer: vi.fn(() => disposer),
    disposer,
  };
}

/** The authorize callback shape `registerAuthorizer` receives. */
type RegisteredAuthorizer = (
  details: PromptPermissionDetails,
  query: unknown,
  log: { review: () => void; debug: () => void },
) => Promise<unknown>;

function ctxWithRegistry(cwd = "/project"): {
  cwd: string;
  modelRegistry: {
    find: () => Model<any>;
    getApiKeyAndHeaders: () => Promise<{ ok: true; apiKey: string }>;
  };
} {
  return {
    cwd,
    modelRegistry: {
      find: () => MODEL,
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "sk-test" }),
    },
  };
}

let service: ReturnType<typeof makeService>;

beforeEach(() => {
  service = makeService();
});

afterEach(() => {
  unpublishPermissionsService(SESSION_ID, service);
  vi.restoreAllMocks();
});

/** Announce a node the way `PermissionServiceLifecycle` does. */
function emitReady(pi: FakePi, sessionId: string | null = SESSION_ID): void {
  const event: PermissionsReadyEvent = { sessionId, adjudicatesLocally: true };
  pi.events.get(READY_CHANNEL)?.(event);
}

/**
 * The ordinary session bring-up: the permission system publishes its service,
 * this extension loads its config at `session_start`, and the ready event
 * announces the node.
 *
 * Tests that exist to pin a *different* ordering spell the sequence out
 * instead of calling this.
 */
function bringUpSession(pi: FakePi, cwd?: string): void {
  publishPermissionsService(SESSION_ID, service);
  pi.lifecycle.get("session_start")?.({}, ctxWithRegistry(cwd));
  emitReady(pi);
}

describe("createModelJudgeExtension", () => {
  it("registers the model-judge link from the ready handler", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });

    bringUpSession(pi);

    expect(service.registerAuthorizer).toHaveBeenCalledTimes(1);
    expect(service.registerAuthorizer.mock.calls[0]?.[0]).toBe("model-judge");
  });

  it("registers on the latch emission when ready fired before this session_start", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });

    // pps published and emitted ready before this extension's session_start
    // ran, so there is no config yet and nothing to register.
    publishPermissionsService(SESSION_ID, service);
    emitReady(pi);
    expect(service.registerAuthorizer).not.toHaveBeenCalled();

    // session_start loads the config, and the latch emission at the node's
    // first before_agent_start carries the registration.
    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());
    expect(service.registerAuthorizer).not.toHaveBeenCalled();

    emitReady(pi);
    expect(service.registerAuthorizer).toHaveBeenCalledTimes(1);
  });

  it("registers only once when ready repeats", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });
    bringUpSession(pi);
    emitReady(pi);
    expect(service.registerAuthorizer).toHaveBeenCalledTimes(1);
  });

  it("registers into the node the ready payload names, not another node", () => {
    const otherService = makeService();
    publishPermissionsService("other-session", otherService);
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });

    bringUpSession(pi);

    expect(service.registerAuthorizer).toHaveBeenCalledTimes(1);
    expect(otherService.registerAuthorizer).not.toHaveBeenCalled();
    unpublishPermissionsService("other-session", otherService);
  });

  it("registers nothing when the ready payload carries no session id", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });
    publishPermissionsService(SESSION_ID, service);
    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());

    emitReady(pi, null);

    expect(service.registerAuthorizer).not.toHaveBeenCalled();
  });

  it("registers nothing when config is absent", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => ({ config: undefined, issues: [] }),
      complete: vi.fn(),
    });
    bringUpSession(pi);
    expect(service.registerAuthorizer).not.toHaveBeenCalled();
  });

  it("registers nothing when no service is published", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });
    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());
    emitReady(pi);
    expect(service.registerAuthorizer).not.toHaveBeenCalled();
  });

  it("disposes the registration on session_shutdown", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });
    bringUpSession(pi);

    pi.lifecycle.get("session_shutdown")?.({}, ctxWithRegistry());
    expect(service.disposer).toHaveBeenCalledTimes(1);
  });

  it("registers an authorize callback that denies a matched typo path", async () => {
    const pi = makeFakePi();
    const complete: CompleteFn = vi.fn(async () => denyReply());
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete,
    });
    bringUpSession(pi);

    const authorize = service.registerAuthorizer.mock
      .calls[0]?.[1] as RegisteredAuthorizer;
    const verdict = await authorize(
      makePromptDetails({
        path: "/x/packages/pi-permission-system/packages/pi-permission-system/a.ts",
      }),
      {},
      { review: vi.fn(), debug: vi.fn() },
    );
    expect(verdict).toEqual({
      kind: "deny",
      reason: "Doubled; use pi-packages.",
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

/**
 * The production seam: `createModelJudgeExtension` with no injected
 * `loadConfig`, so the global scope is resolved the way it is in a real
 * session.
 */
describe("global config scope", () => {
  const SCOPED_INSTRUCTIONS = "Judge paths using the scoped global config.";
  const SCOPED_PATTERN = "scoped-agent-dir-marker";

  let root: string;
  let projectCwd: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "model-judge-scope-"));
    const agentDir = join(root, "agent");
    projectCwd = join(root, "project");
    mkdirSync(projectCwd, { recursive: true });

    const globalConfigPath = getGlobalConfigPath(agentDir);
    mkdirSync(dirname(globalConfigPath), { recursive: true });
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        provider: "anthropic",
        model: "claude-haiku",
        instructions: SCOPED_INSTRUCTIONS,
        typoPatterns: [SCOPED_PATTERN],
      }),
    );
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("reads the global config from the directory PI_CODING_AGENT_DIR names", async () => {
    const pi = makeFakePi();
    const complete: CompleteFn = vi.fn(async () => denyReply());
    createModelJudgeExtension(pi.api as never, { complete });
    bringUpSession(pi, projectCwd);

    const authorize = service.registerAuthorizer.mock
      .calls[0]?.[1] as RegisteredAuthorizer;
    await authorize(
      makePromptDetails({ path: `/x/${SCOPED_PATTERN}/a.ts` }),
      {},
      { review: vi.fn(), debug: vi.fn() },
    );

    // Asserting on the loaded `instructions` — which `reviewPath` sends as the
    // system prompt — is what makes this a real red. Asserting only that the
    // link registered passes on a machine that happens to have a config at the
    // hardcoded `~/.pi/agent`, and fails on one that does not.
    expect(complete).toHaveBeenCalledWith(
      MODEL,
      expect.objectContaining({ systemPrompt: SCOPED_INSTRUCTIONS }),
      expect.objectContaining({ toolChoice: "any" }),
    );
  });
});

function denyReply(): AssistantMessage {
  return assistantToolCall({
    verdict: "deny",
    reason: "Doubled; use pi-packages.",
  });
}
