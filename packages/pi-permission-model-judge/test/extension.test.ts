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
import type { Mock, MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getGlobalConfigPath,
  getProjectConfigPath,
  type LoadConfigResult,
} from "#src/config-loader";
import { createModelJudgeExtension } from "#src/extension";
import type { CompleteFn } from "#src/model-review";
import { assistantToolCall } from "#test/fixtures/assistant-message";
import { makeModel } from "#test/fixtures/model";
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

const MODEL = makeModel();

interface FakePi {
  lifecycle: Map<string, (event: unknown, ctx: unknown) => void>;
  events: Map<string, (data: unknown) => void>;
  api: {
    on: Mock<
      (name: string, handler: (event: unknown, ctx: unknown) => void) => void
    >;
    events: {
      on: Mock<
        (channel: string, handler: (data: unknown) => void) => () => void
      >;
      emit: Mock<(channel: string, data: unknown) => void>;
    };
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
  registerAuthorizer: Mock<PermissionsService["registerAuthorizer"]>;
  disposer: Mock<() => void>;
} {
  const disposer = vi.fn();
  return {
    checkPermission: vi.fn(),
    getToolPermission: vi.fn(),
    isToolFullyDenied: vi.fn(),
    getToolAccessExtractor: vi.fn(),
    getToolInputFormatter: vi.fn(),
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

/** How a test session differs from a trusted, UI-less default. */
interface SessionOverrides {
  trusted?: boolean;
  hasUI?: boolean;
}

/**
 * The `session_start` context: trusted and UI-less unless overridden, so a
 * test that does not care about trust or the notification sink sees the
 * console path with the project layer in scope.
 */
function ctxWithRegistry(
  cwd = "/project",
  overrides: SessionOverrides = {},
): {
  cwd: string;
  hasUI: boolean;
  isProjectTrusted: () => boolean;
  ui: { notify: Mock<(message: string, type?: string) => void> };
  modelRegistry: {
    find: () => Model<any>;
    getApiKeyAndHeaders: () => Promise<{ ok: true; apiKey: string }>;
  };
} {
  const trusted = overrides.trusted ?? true;
  return {
    cwd,
    hasUI: overrides.hasUI ?? false,
    isProjectTrusted: () => trusted,
    ui: { notify: vi.fn() },
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
function bringUpSession(
  pi: FakePi,
  cwd?: string,
  overrides?: SessionOverrides,
): ReturnType<typeof ctxWithRegistry> {
  publishPermissionsService(SESSION_ID, service);
  const ctx = ctxWithRegistry(cwd, overrides);
  pi.lifecycle.get("session_start")?.({}, ctx);
  emitReady(pi);
  return ctx;
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

describe("an unresolvable permission service", () => {
  let warned: MockInstance<Console["warn"]>;

  beforeEach(() => {
    warned = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("warns once when the ready payload carries no session id", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });
    publishPermissionsService(SESSION_ID, service);
    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());

    emitReady(pi, null);
    emitReady(pi, null);

    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned.mock.calls[0]?.[0]).toContain("27.0.0");
  });

  it("warns when the node published no service", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });
    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());

    emitReady(pi);

    expect(warned).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the session simply has no config", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => ({ config: undefined, issues: [] }),
      complete: vi.fn(),
    });
    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());

    emitReady(pi, null);

    expect(warned).not.toHaveBeenCalled();
  });

  it("warns again in the next session", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });
    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());
    emitReady(pi);
    pi.lifecycle.get("session_shutdown")?.({}, ctxWithRegistry());

    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());
    emitReady(pi);

    expect(warned).toHaveBeenCalledTimes(2);
  });
});

describe("session_start warnings", () => {
  const ISSUE_RESULT: LoadConfigResult = {
    config: undefined,
    issues: [
      { path: "model", message: "Required", sourcePath: "/g/config.json" },
    ],
  };
  const ISSUE_WARNING =
    "[pi-permission-model-judge] config issue at /g/config.json — model: Required";

  let warned: MockInstance<Console["warn"]>;

  beforeEach(() => {
    warned = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("reports a config issue as a warning notification when the session has a UI", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => ISSUE_RESULT,
      complete: vi.fn(),
    });

    const ctx = bringUpSession(pi, undefined, { hasUI: true });

    expect(ctx.ui.notify).toHaveBeenCalledWith(ISSUE_WARNING, "warning");
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(warned).not.toHaveBeenCalled();
  });

  it("reports a config issue on the console when the session has no UI", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => ISSUE_RESULT,
      complete: vi.fn(),
    });

    const ctx = bringUpSession(pi, undefined, { hasUI: false });

    expect(warned).toHaveBeenCalledWith(ISSUE_WARNING);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });
});

describe("project trust", () => {
  it("loads the config with the project scope when the project is trusted", () => {
    const pi = makeFakePi();
    const loadConfig = vi.fn(
      (_cwd: string, _projectTrusted: boolean): LoadConfigResult =>
        CONFIG_RESULT,
    );
    createModelJudgeExtension(pi.api as never, {
      loadConfig,
      complete: vi.fn(),
    });

    bringUpSession(pi, "/project", { trusted: true });

    expect(loadConfig).toHaveBeenCalledWith("/project", true);
  });

  it("loads the config without the project scope when the project is untrusted", () => {
    const pi = makeFakePi();
    const loadConfig = vi.fn(
      (_cwd: string, _projectTrusted: boolean): LoadConfigResult =>
        CONFIG_RESULT,
    );
    createModelJudgeExtension(pi.api as never, {
      loadConfig,
      complete: vi.fn(),
    });

    bringUpSession(pi, "/project", { trusted: false });

    expect(loadConfig).toHaveBeenCalledWith("/project", false);
  });

  describe("the skipped project config warning", () => {
    const SKIPPED_PATH =
      "/p/.pi/extensions/pi-permission-model-judge/config.json";
    const SKIPPED_WARNING =
      "[pi-permission-model-judge] project is not trusted — skipping its model-judge config at /p/.pi/extensions/pi-permission-model-judge/config.json. Only the global config applies; grant project trust to load it.";

    let warned: MockInstance<Console["warn"]>;

    beforeEach(() => {
      warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("warns on the console when the session has no UI", () => {
      const pi = makeFakePi();
      createModelJudgeExtension(pi.api as never, {
        loadConfig: () => ({
          ...CONFIG_RESULT,
          untrustedProjectConfigPath: SKIPPED_PATH,
        }),
        complete: vi.fn(),
      });

      bringUpSession(pi, "/p", { trusted: false, hasUI: false });

      expect(warned).toHaveBeenCalledWith(SKIPPED_WARNING);
      expect(warned).toHaveBeenCalledTimes(1);
    });

    it("warns through a notification when the session has a UI", () => {
      const pi = makeFakePi();
      createModelJudgeExtension(pi.api as never, {
        loadConfig: () => ({
          ...CONFIG_RESULT,
          untrustedProjectConfigPath: SKIPPED_PATH,
        }),
        complete: vi.fn(),
      });

      const ctx = bringUpSession(pi, "/p", { trusted: false, hasUI: true });

      expect(ctx.ui.notify).toHaveBeenCalledWith(SKIPPED_WARNING, "warning");
      expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
      expect(warned).not.toHaveBeenCalled();
    });

    it("stays silent when no project config was skipped", () => {
      const pi = makeFakePi();
      createModelJudgeExtension(pi.api as never, {
        loadConfig: () => CONFIG_RESULT,
        complete: vi.fn(),
      });

      const ctx = bringUpSession(pi, "/p", { trusted: false, hasUI: true });

      expect(ctx.ui.notify).not.toHaveBeenCalled();
      expect(warned).not.toHaveBeenCalled();
    });
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

  describe("a project config beside the global one", () => {
    const PROJECT_INSTRUCTIONS = "Judge paths using the project config.";

    beforeEach(() => {
      const projectConfigPath = getProjectConfigPath(projectCwd);
      mkdirSync(dirname(projectConfigPath), { recursive: true });
      writeFileSync(
        projectConfigPath,
        JSON.stringify({ instructions: PROJECT_INSTRUCTIONS }),
      );
    });

    /** Review one matched path so `complete` reveals the loaded instructions. */
    async function reviewMatchedPath(): Promise<void> {
      const authorize = service.registerAuthorizer.mock
        .calls[0]?.[1] as RegisteredAuthorizer;
      await authorize(
        makePromptDetails({ path: `/x/${SCOPED_PATTERN}/a.ts` }),
        {},
        { review: vi.fn(), debug: vi.fn() },
      );
    }

    it("applies the project instructions when the project is trusted", async () => {
      const pi = makeFakePi();
      const complete: CompleteFn = vi.fn(async () => denyReply());
      createModelJudgeExtension(pi.api as never, { complete });
      bringUpSession(pi, projectCwd, { trusted: true });

      await reviewMatchedPath();

      expect(complete).toHaveBeenCalledWith(
        MODEL,
        expect.objectContaining({ systemPrompt: PROJECT_INSTRUCTIONS }),
        expect.objectContaining({ toolChoice: "any" }),
      );
    });

    it("names the real skipped project file when the project is untrusted", () => {
      const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pi = makeFakePi();
      createModelJudgeExtension(pi.api as never, { complete: vi.fn() });

      bringUpSession(pi, projectCwd, { trusted: false });

      expect(warned).toHaveBeenCalledWith(
        `[pi-permission-model-judge] project is not trusted — skipping its model-judge config at ${getProjectConfigPath(projectCwd)}. Only the global config applies; grant project trust to load it.`,
      );
    });

    it("keeps the global instructions when the project is untrusted", async () => {
      const pi = makeFakePi();
      const complete: CompleteFn = vi.fn(async () => denyReply());
      createModelJudgeExtension(pi.api as never, { complete });
      bringUpSession(pi, projectCwd, { trusted: false });

      await reviewMatchedPath();

      expect(complete).toHaveBeenCalledWith(
        MODEL,
        expect.objectContaining({ systemPrompt: SCOPED_INSTRUCTIONS }),
        expect.objectContaining({ toolChoice: "any" }),
      );
    });
  });
});

function denyReply(): AssistantMessage {
  return assistantToolCall({
    verdict: "deny",
    reason: "Doubled; use pi-packages.",
  });
}
