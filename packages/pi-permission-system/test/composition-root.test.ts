/**
 * Composition-root tests for `piPermissionSystemExtension(pi)`.
 *
 * These run the real factory via the `makeFakePi()` harness and assert the
 * wiring contracts that unit tests cannot see: handler-registration
 * completeness, shared-instance contracts across factory invocations, teardown,
 * service↔gate registry sharing, and `ready`-after-publish ordering.
 *
 * Every test runs the factory, which mutates three process-global
 * `Symbol.for()` slots and reads `PI_CODING_AGENT_DIR`. The shared
 * `beforeEach`/`afterEach` isolate the agent dir to a tmpdir and clear every
 * global slot so factory runs do not leak across tests.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  createEventBus,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPermissionForwardingLocation,
  type ForwardedPermissionRequest,
} from "#src/authority/permission-forwarding";
import { getServingSessionRegistry } from "#src/authority/serving-registry";
import { SUBAGENT_CHILD_SESSION_CREATED } from "#src/authority/subagent-lifecycle-events";
import { getSubagentSessionRegistry } from "#src/authority/subagent-registry";
import {
  getGlobalConfigPath,
  getGlobalLogsDir,
  REVIEW_LOG_FILENAME,
} from "#src/config-paths";
import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";
import piPermissionSystemExtension from "#src/index";
import {
  PERMISSIONS_READY_CHANNEL,
  type PermissionsReadyEvent,
} from "#src/permission-events";
import { getPermissionsService } from "#src/service";
import { publishServingHeartbeat } from "#test/helpers/forwarding-fixtures";
import { makeFakePi } from "#test/helpers/make-fake-pi";

const SUBAGENT_REGISTRY_KEY = Symbol.for(
  "@gotgenes/pi-permission-system:subagent-registry",
);
const SERVING_REGISTRY_KEY = Symbol.for(
  "@gotgenes/pi-permission-system:serving-registry",
);
const SESSION_SERVICES_KEY = Symbol.for(
  "@gotgenes/pi-permission-system:session-services",
);

/** The six events the factory must register a handler for. */
const EXPECTED_HANDLERS = [
  "before_agent_start",
  "input",
  "resources_discover",
  "session_shutdown",
  "session_start",
  "tool_call",
];

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-perm-comp-root-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
});

afterEach(() => {
  // Drop every process-global slot so factory runs do not leak across tests.
  const store = globalThis as Record<symbol, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Symbol-keyed global property
  delete store[SUBAGENT_REGISTRY_KEY];
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Symbol-keyed global property
  delete store[SERVING_REGISTRY_KEY];
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Symbol-keyed global property
  delete store[SESSION_SERVICES_KEY];
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Write the global config file under the stubbed agent dir. */
function writeGlobalConfig(config: Record<string, unknown>): void {
  const globalConfigPath = getGlobalConfigPath(agentDir);
  mkdirSync(dirname(globalConfigPath), { recursive: true });
  writeFileSync(
    globalConfigPath,
    `${JSON.stringify({ ...DEFAULT_EXTENSION_CONFIG, ...config }, null, 2)}\n`,
    "utf8",
  );
}

/** Write a project config file under `<cwd>/.pi/extensions/pi-permission-system`. */
function writeProjectConfig(
  cwd: string,
  config: Record<string, unknown>,
): void {
  const dir = join(cwd, ".pi", "extensions", "pi-permission-system");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
}

/** A `ui.select` implementation for a test ctx. */
type CtxSelect = (
  title: string,
  options: string[],
) => Promise<string | undefined>;

/**
 * Build a test `ctx` with the scaffolding every composition-root ctx shares —
 * `cwd`, a trusted project, a minimal `sessionManager`, and a `ui` whose
 * `notify`/`setStatus`/`input` are inert. Callers vary only `hasUI` and the
 * `select` behavior that drives (or declines) a prompt.
 */
function makeBaseCtx(
  cwd: string,
  sessionId: string,
  options: {
    hasUI?: boolean;
    select?: CtxSelect;
    isProjectTrusted?: boolean;
  } = {},
): unknown {
  const trusted = options.isProjectTrusted ?? true;
  return {
    cwd,
    hasUI: options.hasUI ?? true,
    isProjectTrusted: (): boolean => trusted,
    sessionManager: {
      getEntries: (): unknown[] => [],
      getSessionId: (): string => sessionId,
      getSessionDir: (): string => cwd,
    },
    ui: {
      notify: (): void => {},
      setStatus: (): void => {},
      select:
        options.select ?? (async (): Promise<string | undefined> => undefined),
      input: async (): Promise<string | undefined> => undefined,
    },
  };
}

/** Build a minimal subagent `ctx` (no UI) for driving tool-call gates. */
function makeChildCtx(cwd: string, sessionId: string): unknown {
  return makeBaseCtx(cwd, sessionId, { hasUI: false });
}

/**
 * Build a UI-present `ctx` that records the titles passed to `ui.select`, and
 * approves every prompt. The ask-prompt message (which embeds the tool-input
 * preview) is the first line of the select title.
 */
function makeUiCtx(cwd: string, capturedTitles: string[]): { ctx: unknown } {
  const ctx = makeBaseCtx(cwd, "ui-session", {
    select: async (title: string): Promise<string | undefined> => {
      capturedTitles.push(title);
      return "Yes";
    },
  });
  return { ctx };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Read the review-log entries written under the stubbed agent dir. */
function readReviewLog(): { event: string }[] {
  const path = join(getGlobalLogsDir(agentDir), REVIEW_LOG_FILENAME);
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { event: string });
}

/** Drive the registered `session_start` handler with a ctx. */
function fireSessionStart(
  pi: ReturnType<typeof makeFakePi>,
  ctx: unknown,
): Promise<unknown> {
  return pi.fire("session_start", { reason: "start" }, ctx);
}

/**
 * Simulate the parent UI session responding to a forwarded permission request.
 *
 * Polls the parent's requests directory for the child's request file, then
 * writes an approval response so the child's forwarding poll resolves quickly
 * instead of waiting out the 10-minute timeout.
 */
async function approveForwardedRequest(
  forwardingDir: string,
  parentSessionId: string,
): Promise<ForwardedPermissionRequest> {
  const location = createPermissionForwardingLocation(
    forwardingDir,
    parentSessionId,
  );
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    let files: string[] = [];
    try {
      files = readdirSync(location.requestsDir).filter((f) =>
        f.endsWith(".json"),
      );
    } catch {
      files = [];
    }
    const requestFile = files[0];
    if (requestFile) {
      const request = JSON.parse(
        readFileSync(join(location.requestsDir, requestFile), "utf8"),
      ) as ForwardedPermissionRequest;
      mkdirSync(location.responsesDir, { recursive: true });
      writeFileSync(
        join(location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: parentSessionId,
          respondedAt: Date.now(),
        }),
        "utf8",
      );
      return request;
    }
    await sleep(5);
  }
  throw new Error("Timed out waiting for the forwarded permission request");
}

describe("event-handler registration completeness", () => {
  it("registers a handler for every required event exactly once", () => {
    const pi = makeFakePi();
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);

    expect([...pi.handlers.keys()].sort()).toEqual(EXPECTED_HANDLERS);
  });
});

describe("subagent registry sharing across factory instances", () => {
  // The #296 regression class: two factory invocations on *different* event
  // buses must still resolve the same process-global SubagentSessionRegistry,
  // so a child registered via the parent's bus detects itself as a subagent and
  // forwards (rather than blocking) an external-directory `ask`.
  it("lets a child instance forward an ask it received via the parent's bus", async () => {
    writeGlobalConfig({
      permission: { "*": "allow", external_directory: "ask" },
    });

    const childCwd = mkdtempSync(join(tmpdir(), "pi-perm-child-cwd-"));
    const externalDir = mkdtempSync(join(tmpdir(), "pi-perm-external-"));
    const forwardingDir = join(agentDir, "sessions", "permission-forwarding");
    const parentSessionId = "parent-session-1";
    const childSessionId = "child-session-1";

    // Two factory instances, each wired to its own event bus (as in production:
    // every session's ResourceLoader creates a separate bus).
    const parentBus = createEventBus();
    const childBus = createEventBus();
    piPermissionSystemExtension(
      makeFakePi({ events: parentBus }) as unknown as ExtensionAPI,
    );
    const childPi = makeFakePi({
      events: childBus,
      toolNames: ["read"],
    });
    piPermissionSystemExtension(childPi as unknown as ExtensionAPI);

    // The child session is announced on the *parent's* bus only; the parent's
    // lifecycle subscription writes it into the shared global registry.
    parentBus.emit(SUBAGENT_CHILD_SESSION_CREATED, {
      sessionId: childSessionId,
      parentSessionId,
    });

    // This test answers the forwarded request by hand instead of running the
    // parent's poll timer, so state what that timer would have published:
    // the parent is draining its inbox. Without it the child correctly
    // abandons the request as unserved (#719).
    getServingSessionRegistry().markServing(parentSessionId);

    // The child fires an external-directory read with no UI. With the shared
    // registry it detects itself as a subagent and forwards; the simulated
    // parent approves.
    const firePromise = childPi.fire(
      "tool_call",
      {
        toolName: "read",
        toolCallId: "child-external-read",
        input: { path: join(externalDir, "secret.txt") },
      },
      makeChildCtx(childCwd, childSessionId),
    );

    const request = await approveForwardedRequest(
      forwardingDir,
      parentSessionId,
    );
    expect(request.targetSessionId).toBe(parentSessionId);
    expect(request.requesterSessionId).toBe(childSessionId);
    // The child persists the original display fields so the parent emits a
    // non-degraded `permissions:ui_prompt` event (forwarded non-degradation).
    expect(request.source).toBe("tool_call");
    expect(request.surface).toBe("read");
    expect(request.value).toBe(join(externalDir, "secret.txt"));

    const result = (await firePromise) as { block?: true };
    expect(result.block).toBeUndefined();

    rmSync(childCwd, { recursive: true, force: true });
    rmSync(externalDir, { recursive: true, force: true });
  });

  // The #719 failure mode: the child forwards correctly, but nothing drains
  // the parent's inbox. Before the serving registry it waited out the full
  // ten-minute timeout and reported the block as a user denial.
  it("blocks promptly when no session is draining the parent's inbox", async () => {
    writeGlobalConfig({
      permission: { "*": "allow", external_directory: "ask" },
    });

    const childCwd = mkdtempSync(join(tmpdir(), "pi-perm-child-cwd-"));
    const externalDir = mkdtempSync(join(tmpdir(), "pi-perm-external-"));
    const parentSessionId = "parent-session-2";
    const childSessionId = "child-session-2";

    const parentBus = createEventBus();
    piPermissionSystemExtension(
      makeFakePi({ events: parentBus }) as unknown as ExtensionAPI,
    );
    const childPi = makeFakePi({
      events: createEventBus(),
      toolNames: ["read"],
    });
    piPermissionSystemExtension(childPi as unknown as ExtensionAPI);

    parentBus.emit(SUBAGENT_CHILD_SESSION_CREATED, {
      sessionId: childSessionId,
      parentSessionId,
    });
    // Deliberately no markServing: nobody is polling the parent's inbox.

    const result = (await childPi.fire(
      "tool_call",
      {
        toolName: "read",
        toolCallId: "child-external-read",
        input: { path: join(externalDir, "secret.txt") },
      },
      makeChildCtx(childCwd, childSessionId),
    )) as { block?: true; reason?: string };

    expect(result.block).toBe(true);
    expect(result.reason).toContain("no interactive UI is available");
    expect(result.reason).toContain(
      `Session '${parentSessionId}' is not serving forwarded permission requests.`,
    );
    expect(result.reason).not.toContain("User denied");

    rmSync(childCwd, { recursive: true, force: true });
    rmSync(externalDir, { recursive: true, force: true });
  });
});

describe("out-of-process forwarding liveness", () => {
  // A child spawned as its own `pi` process resolves its parent from the
  // environment and shares no `globalThis` with it, so the serving registry the
  // tests above rely on is invisible to it. The filesystem heartbeat is the
  // only signal it has (#721, #735 scenario 1).
  const externalAsk = {
    permission: { "*": "allow", external_directory: "ask" },
  };

  function fireChildRead(childCwd: string, externalDir: string) {
    const childPi = makeFakePi({
      events: createEventBus(),
      toolNames: ["read"],
    });
    piPermissionSystemExtension(childPi as unknown as ExtensionAPI);
    return childPi.fire(
      "tool_call",
      {
        toolName: "read",
        toolCallId: "child-external-read",
        input: { path: join(externalDir, "secret.txt") },
      },
      makeChildCtx(childCwd, "child-session-oop"),
    );
  }

  it("blocks promptly when the out-of-process parent published no heartbeat", async () => {
    writeGlobalConfig(externalAsk);
    const childCwd = mkdtempSync(join(tmpdir(), "pi-perm-child-cwd-"));
    const externalDir = mkdtempSync(join(tmpdir(), "pi-perm-external-"));
    const parentSessionId = "parent-session-oop-gone";
    // The env-var path a process-based subagent extension uses: the hint makes
    // the child detect itself, and the parent id names a session that exited.
    vi.stubEnv("PI_SUBAGENT_CHILD", "1");
    vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", parentSessionId);

    const result = (await fireChildRead(childCwd, externalDir)) as {
      block?: true;
      reason?: string;
    };

    expect(result.block).toBe(true);
    expect(result.reason).toContain(
      `Session '${parentSessionId}' is not serving forwarded permission requests.`,
    );
    expect(result.reason).not.toContain("User denied");

    rmSync(childCwd, { recursive: true, force: true });
    rmSync(externalDir, { recursive: true, force: true });
  });

  it("waits for an out-of-process parent whose heartbeat is fresh", async () => {
    writeGlobalConfig(externalAsk);
    const childCwd = mkdtempSync(join(tmpdir(), "pi-perm-child-cwd-"));
    const externalDir = mkdtempSync(join(tmpdir(), "pi-perm-external-"));
    const forwardingDir = join(agentDir, "sessions", "permission-forwarding");
    const parentSessionId = "parent-session-oop-live";
    vi.stubEnv("PI_SUBAGENT_CHILD", "1");
    vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", parentSessionId);
    // What the parent's poll timer would have published; this test answers the
    // request by hand instead of running that timer.
    publishServingHeartbeat(forwardingDir, parentSessionId);

    const firePromise = fireChildRead(childCwd, externalDir);
    const request = await approveForwardedRequest(
      forwardingDir,
      parentSessionId,
    );
    expect(request.targetSessionId).toBe(parentSessionId);

    const result = (await firePromise) as { block?: true };
    expect(result.block).toBeUndefined();

    rmSync(childCwd, { recursive: true, force: true });
    rmSync(externalDir, { recursive: true, force: true });
  });

  it("forwards for a child that sets only the adapter convention's parent-session variable", async () => {
    writeGlobalConfig(externalAsk);
    const childCwd = mkdtempSync(join(tmpdir(), "pi-perm-child-cwd-"));
    const externalDir = mkdtempSync(join(tmpdir(), "pi-perm-external-"));
    const forwardingDir = join(agentDir, "sessions", "permission-forwarding");
    const parentSessionId = "parent-session-oop-convention";
    // The entire out-of-process obligation of the subagent adapter convention
    // (ADR 0012 decision 5) — no per-extension hint variable beside it.
    vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", parentSessionId);
    publishServingHeartbeat(forwardingDir, parentSessionId);

    const firePromise = fireChildRead(childCwd, externalDir);
    const request = await approveForwardedRequest(
      forwardingDir,
      parentSessionId,
    );
    expect(request.targetSessionId).toBe(parentSessionId);

    const result = (await firePromise) as { block?: true };
    expect(result.block).toBeUndefined();

    rmSync(childCwd, { recursive: true, force: true });
    rmSync(externalDir, { recursive: true, force: true });
  });
});

describe("shutdown teardown chain", () => {
  it("unpublishes the service and unsubscribes the lifecycle on shutdown", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-teardown-cwd-"));
    const pi = makeFakePi();
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);

    // The service is published at session_start, not at factory init.
    await fireSessionStart(pi, makeChildCtx(cwd, "top-session"));
    expect(getPermissionsService("top-session")).toBeDefined();

    await pi.fire("session_shutdown");

    // Keyed entry cleared.
    expect(getPermissionsService("top-session")).toBeUndefined();

    // Lifecycle unsubscribed: a post-shutdown session-created must not register.
    pi.events.emit(SUBAGENT_CHILD_SESSION_CREATED, {
      sessionId: "late-child",
      parentSessionId: "p-late",
    });
    expect(getSubagentSessionRegistry().has("late-child")).toBe(false);

    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("service and gate share one formatter registry", () => {
  // A formatter registered through the published service must be consulted by
  // the live gate handler — proving both reference the same
  // ToolInputFormatterRegistry instance the factory created once.
  it("surfaces a service-registered formatter in the gate's ask prompt", async () => {
    writeGlobalConfig({
      permission: { "*": "allow", demo: "ask" },
    });

    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-ui-cwd-"));
    const pi = makeFakePi({ toolNames: ["demo"] });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);

    const capturedTitles: string[] = [];
    const { ctx } = makeUiCtx(cwd, capturedTitles);
    // The service is published at session_start; publish before resolving it.
    await fireSessionStart(pi, ctx);

    const previewMarker = "PREVIEW::shared-registry-proof";
    getPermissionsService("ui-session")!.registerToolInputFormatter(
      "demo",
      () => previewMarker,
    );
    const result = (await pi.fire(
      "tool_call",
      { toolName: "demo", toolCallId: "demo-ask", input: { foo: "bar" } },
      ctx,
    )) as { block?: true };

    // The gate prompted (not blocked) and the prompt embedded the formatter's
    // preview — so the gate consulted the same registry the service wrote to.
    expect(result.block).toBeUndefined();
    expect(capturedTitles.some((t) => t.includes(previewMarker))).toBe(true);

    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("service and gate share one access extractor registry", () => {
  // An extractor registered through the published service must be consulted by
  // the live gate handler — proving both reference the same
  // ToolAccessExtractorRegistry instance the factory created once (#352).
  it("path-gates a custom-shaped tool via a service-registered extractor", async () => {
    writeGlobalConfig({
      permission: { "*": "allow", path: { "*.env": "deny" } },
    });

    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-ext-cwd-"));
    const pi = makeFakePi({ toolNames: ["ffgrep"] });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);

    const { ctx } = makeUiCtx(cwd, []);
    await fireSessionStart(pi, ctx);

    // ffgrep carries its path under a non-standard key; without the extractor
    // the default input.path convention would miss it.
    getPermissionsService("ui-session")!.registerToolAccessExtractor(
      "ffgrep",
      (input) => (typeof input.target === "string" ? input.target : undefined),
    );

    const result = (await pi.fire(
      "tool_call",
      { toolName: "ffgrep", toolCallId: "ff-1", input: { target: ".env" } },
      ctx,
    )) as { block?: true };

    // The path deny fired — so the gate extracted ffgrep's path through the
    // same registry the service wrote to.
    expect(result.block).toBe(true);

    rmSync(cwd, { recursive: true, force: true });
  });

  // The quiet half of #699: a child runs its own gates, so an extractor a
  // sibling registers in the child has to land in the child's registry. While
  // every node shared the parent's service, that registration went to the
  // parent — where the child's gates never look — and path gating for a
  // custom-path tool silently weakened inside the child, with no error at all.
  it("path-gates a child's own tool call via an extractor registered in that child", async () => {
    writeGlobalConfig({
      permission: { "*": "allow", path: { "*.env": "deny" } },
    });

    const parentCwd = mkdtempSync(join(tmpdir(), "pi-perm-parent-ext-"));
    const childCwd = mkdtempSync(join(tmpdir(), "pi-perm-child-ext-"));
    const parentSessionId = "parent-session-ext";
    const childSessionId = "child-session-ext";

    const parentPi = makeFakePi({
      toolNames: ["ffgrep"],
      events: createEventBus(),
    });
    piPermissionSystemExtension(parentPi as unknown as ExtensionAPI);
    const childPi = makeFakePi({
      toolNames: ["ffgrep"],
      events: createEventBus(),
    });
    piPermissionSystemExtension(childPi as unknown as ExtensionAPI);

    await fireSessionStart(parentPi, makeBaseCtx(parentCwd, parentSessionId));
    getSubagentSessionRegistry().register(childSessionId, { parentSessionId });
    const childCtx = makeChildCtx(childCwd, childSessionId);
    await fireSessionStart(childPi, childCtx);

    // The child's sibling extension registers into the child's own service.
    getPermissionsService(childSessionId)!.registerToolAccessExtractor(
      "ffgrep",
      (input) => (typeof input.target === "string" ? input.target : undefined),
    );

    const result = (await childPi.fire(
      "tool_call",
      {
        toolName: "ffgrep",
        toolCallId: "ff-child-1",
        input: { target: ".env" },
      },
      childCtx,
    )) as { block?: true };

    expect(result.block).toBe(true);

    rmSync(parentCwd, { recursive: true, force: true });
    rmSync(childCwd, { recursive: true, force: true });
  });
});

describe("service and chain share one authorizer registry", () => {
  // A link registered through the published service must be consulted by the
  // live ask gate when the operator names it in authorizerChain — proving both
  // the registerAuthorizer surface and AuthorizerSelection reference the same
  // AuthorizerRegistry instance the factory created once (#599).
  it("consults a service-registered, config-named link at the ask gate", async () => {
    writeGlobalConfig({
      permission: { "*": "ask" },
      authorizerChain: ["typo-judge"],
    });

    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-auth-cwd-"));
    const pi = makeFakePi({ toolNames: ["demo"] });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);

    const capturedTitles: string[] = [];
    const { ctx } = makeUiCtx(cwd, capturedTitles);
    await fireSessionStart(pi, ctx);

    // Registered after session_start via the published service; link resolution
    // is per-ask (ADR 0007 §4), so it is honored on the first ask.
    getPermissionsService("ui-session")!.registerAuthorizer("typo-judge", () =>
      Promise.resolve({ kind: "deny", reason: "typo path" }),
    );

    const result = (await pi.fire(
      "tool_call",
      { toolName: "demo", toolCallId: "d-1", input: {} },
      ctx,
    )) as { block?: true };

    // The link denied before the (approving) UI terminal was reached — so the
    // gate escalated through the same registry the service wrote to, and the
    // config named it (opt-in activation).
    expect(result.block).toBe(true);
    expect(capturedTitles).toEqual([]);

    rmSync(cwd, { recursive: true, force: true });
  });

  it("ignores a registered link the operator did not name (opt-in)", async () => {
    writeGlobalConfig({ permission: { "*": "ask" } }); // authorizerChain omitted

    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-auth-optin-"));
    const pi = makeFakePi({ toolNames: ["demo"] });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);

    const capturedTitles: string[] = [];
    const { ctx } = makeUiCtx(cwd, capturedTitles);
    await fireSessionStart(pi, ctx);

    getPermissionsService("ui-session")!.registerAuthorizer("typo-judge", () =>
      Promise.resolve({ kind: "deny", reason: "typo path" }),
    );

    const result = (await pi.fire(
      "tool_call",
      { toolName: "demo", toolCallId: "d-2", input: {} },
      ctx,
    )) as { block?: true };

    // Registration alone grants no authority: the un-named link is dormant, so
    // the ask reached the approving UI terminal.
    expect(result.block).toBeUndefined();
    expect(capturedTitles).toHaveLength(1);

    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("ready emitted after service publication", () => {
  // Ordering contracts exist only at the composition root: a consumer reacting
  // to permissions:ready must be able to resolve the service immediately. The
  // service is published and ready fires at session_start (not factory init).
  it("publishes the service before emitting permissions:ready", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-ready-cwd-"));
    const seenKeyed: string[] = [];
    const pi = makeFakePi();
    pi.events.on(PERMISSIONS_READY_CHANNEL, (data) => {
      // The payload's own sessionId must already resolve: it is the key a
      // consumer registers through the moment this handler runs.
      const { sessionId } = data as PermissionsReadyEvent;
      seenKeyed.push(
        sessionId !== null && getPermissionsService(sessionId)
          ? "present"
          : "missing",
      );
    });

    piPermissionSystemExtension(pi as unknown as ExtensionAPI);

    // ready is not emitted at load; only after session_start publishes.
    expect(seenKeyed).toEqual([]);

    await fireSessionStart(pi, makeChildCtx(cwd, "top-session"));

    expect(seenKeyed).toEqual(["present"]);

    rmSync(cwd, { recursive: true, force: true });
  });

  // ADR 0012 decision 3, the ready latch: before_agent_start runs after every
  // extension's session_start and before any tool call, so re-emitting there
  // makes the ready event alone a sufficient registration site — a consumer
  // whose own session_start ran after ours no longer needs a second path.
  it("re-emits permissions:ready once at the first before_agent_start", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-latch-cwd-"));
    const payloads: PermissionsReadyEvent[] = [];
    const resolvable: string[] = [];
    const pi = makeFakePi();
    pi.events.on(PERMISSIONS_READY_CHANNEL, (data) => {
      const payload = data as PermissionsReadyEvent;
      payloads.push(payload);
      resolvable.push(
        payload.sessionId !== null && getPermissionsService(payload.sessionId)
          ? "present"
          : "missing",
      );
    });

    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    const ctx = makeBaseCtx(cwd, "latch-session");
    await fireSessionStart(pi, ctx);

    await pi.fire("before_agent_start", { systemPrompt: "" }, ctx);
    await pi.fire("before_agent_start", { systemPrompt: "" }, ctx);

    // One emission at session_start, one at the *first* before_agent_start —
    // the second turn adds none.
    expect(payloads).toEqual([
      { sessionId: "latch-session", adjudicatesLocally: true },
      { sessionId: "latch-session", adjudicatesLocally: true },
    ]);
    // The service resolves at both emissions, not only the first.
    expect(resolvable).toEqual(["present", "present"]);

    rmSync(cwd, { recursive: true, force: true });
  });

  it("re-arms the latch for the next session generation", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-latch-reload-"));
    let emissions = 0;
    const pi = makeFakePi();
    pi.events.on(PERMISSIONS_READY_CHANNEL, () => {
      emissions += 1;
    });

    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    const ctx = makeBaseCtx(cwd, "latch-reload-session");
    await fireSessionStart(pi, ctx);
    await pi.fire("before_agent_start", { systemPrompt: "" }, ctx);
    expect(emissions).toBe(2);

    // A reload runs session_start again: the new generation announces at
    // session_start and once more at its first turn.
    await fireSessionStart(pi, ctx);
    await pi.fire("before_agent_start", { systemPrompt: "" }, ctx);
    await pi.fire("before_agent_start", { systemPrompt: "" }, ctx);
    expect(emissions).toBe(4);

    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("single source of truth for session state", () => {
  // Regression guard for the split-brain bug: before the fix, the gate path
  // recorded session approvals into a private SessionRules instance that the
  // service never saw. After the fix, both readers use the same SessionRules
  // the gate writes into.
  it("gate session-approval is visible to the service", async () => {
    writeGlobalConfig({
      permission: { "*": "allow", demo: "ask" },
    });

    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-sot-cwd-"));
    const pi = makeFakePi({ toolNames: ["demo"] });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);

    // UI ctx that approves the gate prompt for this session (options[1]).
    // Return the second option label-agnostically — always the "for this
    // session" choice regardless of the exact label text.
    const ctx = makeBaseCtx(cwd, "sot-session", {
      select: async (
        _title: string,
        options: string[],
      ): Promise<string | undefined> => options[1],
    });

    await fireSessionStart(pi, ctx);

    // Drive a tool_call on "demo"; the gate prompts and the mock selects
    // options[1], recording a session-scoped approval.
    await pi.fire(
      "tool_call",
      {
        toolName: "demo",
        toolCallId: "demo-for-session",
        input: { foo: "bar" },
      },
      ctx,
    );

    // Service accessor must see the session approval.
    // Before the fix this was "ask" — the service read an empty SessionRules.
    const serviceResult =
      getPermissionsService("sot-session")!.checkPermission("demo");
    expect(serviceResult.state).toBe("allow");

    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("service path queries evaluate the supplied path (#503)", () => {
  // Before #503 the service path query dropped the value (buildInputForSurface
  // returned {} for the `path` surface), so the query collapsed to ["*"] and a
  // path-specific rule never fired. The query now builds an AccessPath, so the
  // supplied path flows through the resolver → manager and matches `path` rules
  // end-to-end.
  it("resolves a path-surface query against a deny rule on the supplied path", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-svc-path-cwd-"));
    const target = join(cwd, "secrets.env");
    writeGlobalConfig({ permission: { path: { [target]: "deny" } } });

    const pi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    await fireSessionStart(pi, makeChildCtx(cwd, "svc-path-session"));

    const result = getPermissionsService("svc-path-session")!.checkPermission(
      "path",
      target,
    );
    expect(result.state).toBe("deny");

    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("project trust gates project-scoped config (#644)", () => {
  it("does not let an untrusted project's `bash: allow` override global `bash: deny`", async () => {
    writeGlobalConfig({ permission: { "*": "ask", bash: "deny" } });
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-untrusted-cwd-"));
    writeProjectConfig(cwd, { permission: { bash: "allow" } });

    const pi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    await fireSessionStart(
      pi,
      makeBaseCtx(cwd, "untrusted-session", { isProjectTrusted: false }),
    );

    // Global `deny` survives: the untrusted project scope was never loaded.
    expect(
      getPermissionsService("untrusted-session")!.checkPermission(
        "bash",
        "echo hi",
      ).state,
    ).toBe("deny");

    rmSync(cwd, { recursive: true, force: true });
  });

  it("lets a trusted project's `bash: allow` override global `bash: deny`", async () => {
    writeGlobalConfig({ permission: { "*": "ask", bash: "deny" } });
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-trusted-cwd-"));
    writeProjectConfig(cwd, { permission: { bash: "allow" } });

    const pi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    await fireSessionStart(
      pi,
      makeBaseCtx(cwd, "trusted-session", { isProjectTrusted: true }),
    );

    // The trusted project override applies (last-match-wins).
    expect(
      getPermissionsService("trusted-session")!.checkPermission(
        "bash",
        "echo hi",
      ).state,
    ).toBe("allow");

    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("bash bare-token path gating (#509, #645)", () => {
  // A bash bare-filename argument (`cat id_rsa`) once bypassed the `path`
  // surface entirely: the broad classifier accepted only tokens starting with
  // `.`, containing `/` or `..`, or a Windows drive-letter absolute. #509
  // closed that for a token whose *spelling* matched a specific `path` rule;
  // #645 replaced spelling-matching with an existence probe, so candidacy comes
  // from the filesystem and a symlink is matched by rules naming its target.

  async function fireBashToolCall(
    pi: ReturnType<typeof makeFakePi>,
    ctx: unknown,
    command: string,
  ): Promise<{ block?: true; reason?: string }> {
    return (await pi.fire(
      "tool_call",
      { name: "bash", input: { command }, toolCallId: "tc-1" },
      ctx,
    )) as { block?: true; reason?: string };
  }

  it("denies an existing bare filename matching a specific path deny rule", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-bare-token-cwd-"));
    writeFileSync(join(cwd, "id_rsa"), "key");
    writeGlobalConfig({
      permission: { "*": "allow", path: { id_rsa: "deny" } },
    });

    const pi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    const ctx = makeChildCtx(cwd, "bare-token-session-deny");
    await fireSessionStart(pi, ctx);

    const result = await fireBashToolCall(pi, ctx, "cat id_rsa");
    expect(result.block).toBe(true);

    rmSync(cwd, { recursive: true, force: true });
  });

  it("denies an existing bare filename matching a wildcard path deny rule", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-bare-token-cwd-"));
    writeFileSync(join(cwd, "key.pem"), "key");
    writeGlobalConfig({
      permission: { "*": "allow", path: { "*.pem": "deny" } },
    });

    const pi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    const ctx = makeChildCtx(cwd, "bare-token-session-wildcard");
    await fireSessionStart(pi, ctx);

    const result = await fireBashToolCall(pi, ctx, "cat key.pem");
    expect(result.block).toBe(true);

    rmSync(cwd, { recursive: true, force: true });
  });

  it("denies a bare symlink whose target matches a path deny rule (#645)", async () => {
    // The operator's case: the rule names the target, not the link. Matching a
    // token's spelling could never catch this; canonicalization after the probe
    // does.
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-bare-symlink-cwd-"));
    writeFileSync(join(cwd, ".some.secret"), "s3cret");
    symlinkSync(join(cwd, ".some.secret"), join(cwd, "a_sym"));
    writeGlobalConfig({
      permission: { "*": "allow", path: { "*.some.secret": "deny" } },
    });

    const pi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    const ctx = makeChildCtx(cwd, "bare-symlink-session-deny");
    await fireSessionStart(pi, ctx);

    const result = await fireBashToolCall(pi, ctx, "cat a_sym");
    expect(result.block).toBe(true);

    rmSync(cwd, { recursive: true, force: true });
  });

  it("leaves a bare token that does not match any path rule unaffected", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-bare-token-cwd-"));
    writeGlobalConfig({
      permission: { "*": "allow", path: { id_rsa: "deny" } },
    });

    const pi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    const ctx = makeChildCtx(cwd, "bare-token-session-unaffected");
    await fireSessionStart(pi, ctx);

    const result = await fireBashToolCall(pi, ctx, "git status");
    expect(result.block).toBeUndefined();

    rmSync(cwd, { recursive: true, force: true });
  });

  it("leaves a bare token naming no file unaffected even under a path deny rule (#645)", async () => {
    // The probe's precision: `id_rsa` matches the rule by spelling, but names
    // nothing here, so it is not an operand and is not gated.
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-bare-absent-cwd-"));
    writeGlobalConfig({
      permission: { "*": "allow", path: { id_rsa: "deny" } },
    });

    const pi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    const ctx = makeChildCtx(cwd, "bare-token-session-absent");
    await fireSessionStart(pi, ctx);

    const result = await fireBashToolCall(pi, ctx, "cat id_rsa");
    expect(result.block).toBeUndefined();

    rmSync(cwd, { recursive: true, force: true });
  });

  it("leaves an existing bare file unrestricted when no explicit path rule matches (#58)", async () => {
    // The universal-fallback guard is what keeps probe promotion from becoming
    // a prompt firehose: a promoted token matching only the synthesized default
    // is unrestricted, so a real file with no rule naming it stays allowed.
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-bare-norule-cwd-"));
    writeFileSync(join(cwd, "README"), "docs");
    writeGlobalConfig({
      permission: { "*": "allow", path: { id_rsa: "deny" } },
    });

    const pi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    const ctx = makeChildCtx(cwd, "bare-token-session-norule");
    await fireSessionStart(pi, ctx);

    const result = await fireBashToolCall(pi, ctx, "cat README");
    expect(result.block).toBeUndefined();

    rmSync(cwd, { recursive: true, force: true });
  });

  it("denies a bare symlink escaping the working tree under external_directory deny (#645)", async () => {
    // The issue's headline repro:
    //   printf 'test' > /tmp/…-secret ; ln -s /tmp/…-secret outside-link
    //   cat outside-link            (under a permissive `cat *` bash rule)
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-escape-cwd-"));
    const outside = mkdtempSync(join(tmpdir(), "pi-perm-escape-target-"));
    const secret = join(outside, "pi-permission-test-secret");
    writeFileSync(secret, "test");
    symlinkSync(secret, join(cwd, "outside-link"));
    writeGlobalConfig({
      permission: {
        "*": "allow",
        bash: { "cat *": "allow" },
        external_directory: "deny",
      },
    });

    const pi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    const ctx = makeChildCtx(cwd, "bare-escape-session-deny");
    await fireSessionStart(pi, ctx);

    const result = await fireBashToolCall(pi, ctx, "cat outside-link");
    expect(result.block).toBe(true);

    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("denies a path embedded in a long option under external_directory deny (#645)", async () => {
    // The issue's second repro: `grep --file=/tmp/…` under an allowing
    // `grep *` bash rule. The flag token never reached the path surfaces.
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-flagpath-cwd-"));
    const outside = mkdtempSync(join(tmpdir(), "pi-perm-flagpath-target-"));
    const patterns = join(outside, "pi-permission-patterns");
    writeFileSync(patterns, "secret\n");
    writeGlobalConfig({
      permission: {
        "*": "allow",
        bash: { "grep *": "allow" },
        external_directory: "deny",
      },
    });

    const pi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);
    const ctx = makeChildCtx(cwd, "flag-path-session-deny");
    await fireSessionStart(pi, ctx);

    const result = await fireBashToolCall(
      pi,
      ctx,
      `grep --file=${patterns} target`,
    );
    expect(result.block).toBe(true);

    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("session-keyed service publication", () => {
  // ADR 0012 decision 2: registrations never cross a node boundary. Each node
  // publishes under its own session id, so a sibling extension loaded into an
  // in-process child registers into the child's own registries — the ones the
  // child's gates and chain read — instead of reaching the parent's service.
  it("gives an in-process child its own service, so a sibling's link registration does not collide", async () => {
    const parentCwd = mkdtempSync(join(tmpdir(), "pi-perm-parent-keyed-"));
    const childCwd = mkdtempSync(join(tmpdir(), "pi-perm-child-keyed-"));
    const parentSessionId = "parent-session-keyed";
    const childSessionId = "child-session-keyed";

    const parentPi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(parentPi as unknown as ExtensionAPI);
    const childPi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(childPi as unknown as ExtensionAPI);

    await fireSessionStart(parentPi, makeChildCtx(parentCwd, parentSessionId));
    getSubagentSessionRegistry().register(childSessionId, { parentSessionId });
    await fireSessionStart(childPi, makeChildCtx(childCwd, childSessionId));

    const parentService = getPermissionsService(parentSessionId);
    const childService = getPermissionsService(childSessionId);
    expect(parentService).toBeDefined();
    expect(childService).toBeDefined();
    expect(childService).not.toBe(parentService);

    // The reported #699 symptom: the parent owns the link name, and the
    // child's sibling registers the same name into the child's own service.
    parentService!.registerAuthorizer("model-judge", () =>
      Promise.resolve({ kind: "defer" as const }),
    );
    expect(() =>
      childService!.registerAuthorizer("model-judge", () =>
        Promise.resolve({ kind: "defer" as const }),
      ),
    ).not.toThrow();

    rmSync(parentCwd, { recursive: true, force: true });
    rmSync(childCwd, { recursive: true, force: true });
  });

  it("announces the node's session id and chain role on permissions:ready", async () => {
    const parentCwd = mkdtempSync(join(tmpdir(), "pi-perm-parent-ready-"));
    const childCwd = mkdtempSync(join(tmpdir(), "pi-perm-child-ready-"));
    const parentSessionId = "parent-session-ready";
    const childSessionId = "child-session-ready";

    const parentReady: unknown[] = [];
    const parentPi = makeFakePi({ events: createEventBus() });
    parentPi.events.on(PERMISSIONS_READY_CHANNEL, (data) => {
      parentReady.push(data);
    });
    piPermissionSystemExtension(parentPi as unknown as ExtensionAPI);

    const childReady: unknown[] = [];
    const childPi = makeFakePi({ events: createEventBus() });
    childPi.events.on(PERMISSIONS_READY_CHANNEL, (data) => {
      childReady.push(data);
    });
    piPermissionSystemExtension(childPi as unknown as ExtensionAPI);

    // A UI-bearing parent adjudicates locally; a headless registered child
    // relays its asks to the parent, so its chain does not run.
    await fireSessionStart(parentPi, makeBaseCtx(parentCwd, parentSessionId));
    getSubagentSessionRegistry().register(childSessionId, { parentSessionId });
    await fireSessionStart(childPi, makeChildCtx(childCwd, childSessionId));

    expect(parentReady).toEqual([
      { sessionId: parentSessionId, adjudicatesLocally: true },
    ]);
    expect(childReady).toEqual([
      { sessionId: childSessionId, adjudicatesLocally: false },
    ]);

    rmSync(parentCwd, { recursive: true, force: true });
    rmSync(childCwd, { recursive: true, force: true });
  });

  // ADR 0012 decision 4: a relaying node has no chain to consult a link with,
  // so the registration is honored and the vacancy recorded — never silent.
  it("records a link registered on a relaying child in the review log", async () => {
    const parentCwd = mkdtempSync(join(tmpdir(), "pi-perm-parent-vacant-"));
    const childCwd = mkdtempSync(join(tmpdir(), "pi-perm-child-vacant-"));
    const parentSessionId = "parent-session-vacant";
    const childSessionId = "child-session-vacant";

    const parentPi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(parentPi as unknown as ExtensionAPI);
    const childPi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(childPi as unknown as ExtensionAPI);

    await fireSessionStart(parentPi, makeBaseCtx(parentCwd, parentSessionId));
    getSubagentSessionRegistry().register(childSessionId, { parentSessionId });
    await fireSessionStart(childPi, makeChildCtx(childCwd, childSessionId));

    getPermissionsService(parentSessionId)!.registerAuthorizer(
      "model-judge",
      () => Promise.resolve({ kind: "defer" as const }),
    );
    getPermissionsService(childSessionId)!.registerAuthorizer(
      "model-judge",
      () => Promise.resolve({ kind: "defer" as const }),
    );

    const events = readReviewLog().map((entry) => entry.event);
    expect(events).toContain("authorizer_link_vacant");
    expect(
      events.filter((event) => event === "authorizer_link_vacant"),
    ).toHaveLength(1);

    rmSync(parentCwd, { recursive: true, force: true });
    rmSync(childCwd, { recursive: true, force: true });
  });

  it("removes only its own keyed entry when a node shuts down", async () => {
    const parentCwd = mkdtempSync(join(tmpdir(), "pi-perm-parent-teardown-"));
    const childCwd = mkdtempSync(join(tmpdir(), "pi-perm-child-teardown-"));
    const parentSessionId = "parent-session-teardown";
    const childSessionId = "child-session-teardown";

    const parentPi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(parentPi as unknown as ExtensionAPI);
    const childPi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(childPi as unknown as ExtensionAPI);

    await fireSessionStart(parentPi, makeChildCtx(parentCwd, parentSessionId));
    getSubagentSessionRegistry().register(childSessionId, { parentSessionId });
    await fireSessionStart(childPi, makeChildCtx(childCwd, childSessionId));
    const parentService = getPermissionsService(parentSessionId);

    await childPi.fire("session_shutdown");

    expect(getPermissionsService(childSessionId)).toBeUndefined();
    expect(getPermissionsService(parentSessionId)).toBe(parentService);

    rmSync(parentCwd, { recursive: true, force: true });
    rmSync(childCwd, { recursive: true, force: true });
  });
});

describe("session approvals do not leak across same-cwd session switches", () => {
  // Pi caches the extension *import* (the jiti module, factory function) for
  // same-cwd `/new` / `/resume` / `/fork` / `/import` switches
  // (earendil-works/pi#5905). The factory is still re-invoked per switch, and
  // `session_shutdown` still fires — so a session-scoped "allow for this
  // session" grant must not survive into the next session.
  //
  // Two factory invocations against the same cwd model the cached-import
  // switch: invocation #1 records an approval and shuts down; invocation #2 is
  // the re-invoked cached factory. The new session must start with an empty
  // SessionRules. Two independent mechanisms keep it empty, and the grant only
  // leaks if *both* break together: `session_shutdown` clears the first
  // instance's rules, and the re-invoked factory builds a fresh SessionRules
  // (no module-scoped state bridges the switch — the per-session reset the
  // fresh-jiti load used to provide is gone once the import is cached).

  /** A UI ctx that approves the gate's "for this session" option (options[1]). */
  function makeSessionApprovingCtx(cwd: string, sessionId: string): unknown {
    return makeBaseCtx(cwd, sessionId, {
      select: async (
        _title: string,
        options: string[],
      ): Promise<string | undefined> => options[1],
    });
  }

  it("starts the next same-cwd session with an empty session ruleset", async () => {
    writeGlobalConfig({
      permission: { "*": "allow", demo: "ask" },
    });

    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-switch-cwd-"));

    // ── Session #1: approve `demo` for the session, then shut down ──────────
    const firstPi = makeFakePi({ toolNames: ["demo"] });
    piPermissionSystemExtension(firstPi as unknown as ExtensionAPI);

    const firstCtx = makeSessionApprovingCtx(cwd, "switch-session-1");
    await fireSessionStart(firstPi, firstCtx);

    // The gate prompts and the mock selects options[1], recording a
    // session-scoped approval the service can read back.
    await firstPi.fire(
      "tool_call",
      { toolName: "demo", toolCallId: "demo-approve", input: { foo: "bar" } },
      firstCtx,
    );
    expect(
      getPermissionsService("switch-session-1")!.checkPermission("demo").state,
    ).toBe("allow");

    // The switch tears down the old session before the new one starts.
    await firstPi.fire("session_shutdown");

    // ── Session #2: the re-invoked cached factory, same cwd ────────────────
    const secondPi = makeFakePi({ toolNames: ["demo"] });
    piPermissionSystemExtension(secondPi as unknown as ExtensionAPI);

    await fireSessionStart(secondPi, makeChildCtx(cwd, "switch-session-2"));

    // The previous session's approval must not be visible: `demo` is back to
    // its configured `ask`, not the carried-over `allow`.
    expect(
      getPermissionsService("switch-session-2")!.checkPermission("demo").state,
    ).toBe("ask");

    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("forwarded grant-scope selection round-trip", () => {
  // A UI-present serving ctx whose `select` drives the two-step forwarded
  // dialog: the main prompt picks "for this session" (options[1]); the scope
  // prompt (options include a "The whole session …" label) returns the chosen
  // scope. Every `select` options array is recorded so a test can prove the
  // human was (or was not) re-prompted.
  function makeServingCtx(
    cwd: string,
    sessionId: string,
    selectLog: string[][],
    scope: "whole" | "subagent",
  ): unknown {
    return makeBaseCtx(cwd, sessionId, {
      select: async (
        _title: string,
        options: string[],
      ): Promise<string | undefined> => {
        selectLog.push(options);
        const wholeOption = options.find((o) =>
          o.startsWith("The whole session"),
        );
        if (wholeOption) {
          return scope === "whole" ? wholeOption : options[0];
        }
        return options[1];
      },
    });
  }

  it("records a whole-session grant on the serving node so later forwards and the parent's own action resolve without a second prompt", async () => {
    writeGlobalConfig({ permission: { "*": "allow", demo: "ask" } });

    const parentCwd = mkdtempSync(join(tmpdir(), "pi-perm-parent-"));
    const childCwd = mkdtempSync(join(tmpdir(), "pi-perm-child-"));
    const parentSessionId = "parent-whole-1";
    const childSessionId = "child-whole-1";
    const selectLog: string[][] = [];

    const parentBus = createEventBus();
    const parentPi = makeFakePi({ events: parentBus, toolNames: ["demo"] });
    piPermissionSystemExtension(parentPi as unknown as ExtensionAPI);
    const childPi = makeFakePi({
      events: createEventBus(),
      toolNames: ["demo"],
    });
    piPermissionSystemExtension(childPi as unknown as ExtensionAPI);

    // The parent starts serving (its poll drains the inbox using the UI ctx).
    const parentCtx = makeServingCtx(
      parentCwd,
      parentSessionId,
      selectLog,
      "whole",
    );
    await fireSessionStart(parentPi, parentCtx);
    parentBus.emit(SUBAGENT_CHILD_SESSION_CREATED, {
      sessionId: childSessionId,
      parentSessionId,
    });

    // 1. First child `demo` forwards; the human grants the whole session.
    const firstResult = (await childPi.fire(
      "tool_call",
      { toolName: "demo", toolCallId: "demo-1", input: {} },
      makeChildCtx(childCwd, childSessionId),
    )) as { block?: true };
    expect(firstResult.block).toBeUndefined();
    // One serve = main dialog + scope dialog.
    expect(selectLog).toHaveLength(2);

    // 2. A second child `demo` re-forwards and the serving node auto-approves
    // from its recorded whole-session grant — no new human prompt.
    const secondResult = (await childPi.fire(
      "tool_call",
      { toolName: "demo", toolCallId: "demo-2", input: {} },
      makeChildCtx(childCwd, childSessionId),
    )) as { block?: true };
    expect(secondResult.block).toBeUndefined();
    expect(selectLog).toHaveLength(2);

    // 3. The parent's own `demo` is session-approved by the same grant.
    const parentResult = (await parentPi.fire(
      "tool_call",
      { toolName: "demo", toolCallId: "demo-parent", input: {} },
      parentCtx,
    )) as { block?: true };
    expect(parentResult.block).toBeUndefined();
    expect(selectLog).toHaveLength(2);

    await parentPi.fire("session_shutdown");
    rmSync(parentCwd, { recursive: true, force: true });
    rmSync(childCwd, { recursive: true, force: true });
  });

  it("contains a subagent-only grant to the requesting child so the parent's own action still prompts", async () => {
    writeGlobalConfig({ permission: { "*": "allow", demo: "ask" } });

    const parentCwd = mkdtempSync(join(tmpdir(), "pi-perm-parent-"));
    const childCwd = mkdtempSync(join(tmpdir(), "pi-perm-child-"));
    const parentSessionId = "parent-sub-1";
    const childSessionId = "child-sub-1";
    const selectLog: string[][] = [];

    const parentBus = createEventBus();
    const parentPi = makeFakePi({ events: parentBus, toolNames: ["demo"] });
    piPermissionSystemExtension(parentPi as unknown as ExtensionAPI);
    const childPi = makeFakePi({
      events: createEventBus(),
      toolNames: ["demo"],
    });
    piPermissionSystemExtension(childPi as unknown as ExtensionAPI);

    const parentCtx = makeServingCtx(
      parentCwd,
      parentSessionId,
      selectLog,
      "subagent",
    );
    await fireSessionStart(parentPi, parentCtx);
    parentBus.emit(SUBAGENT_CHILD_SESSION_CREATED, {
      sessionId: childSessionId,
      parentSessionId,
    });

    // 1. First child `demo` forwards; the human grants this subagent only.
    const firstResult = (await childPi.fire(
      "tool_call",
      { toolName: "demo", toolCallId: "demo-1", input: {} },
      makeChildCtx(childCwd, childSessionId),
    )) as { block?: true };
    expect(firstResult.block).toBeUndefined();
    expect(selectLog).toHaveLength(2);

    // 2. The child recorded the grant locally: its next `demo` resolves as a
    // session approval with no forward, so the serving node is not consulted.
    const secondResult = (await childPi.fire(
      "tool_call",
      { toolName: "demo", toolCallId: "demo-2", input: {} },
      makeChildCtx(childCwd, childSessionId),
    )) as { block?: true };
    expect(secondResult.block).toBeUndefined();
    expect(selectLog).toHaveLength(2);

    // 3. The parent holds no grant, so its own `demo` prompts again.
    const parentResult = (await parentPi.fire(
      "tool_call",
      { toolName: "demo", toolCallId: "demo-parent", input: {} },
      parentCtx,
    )) as { block?: true };
    expect(parentResult.block).toBeUndefined();
    expect(selectLog.length).toBeGreaterThan(2);

    await parentPi.fire("session_shutdown");
    rmSync(parentCwd, { recursive: true, force: true });
    rmSync(childCwd, { recursive: true, force: true });
  });
});

describe("yolo grants asks synthesized after resolution", () => {
  // The composition-stage ask→allow rewrite cannot reach a floor applied to a
  // parsed command unit, so under yolo the wrapper and unparseable sentinels
  // used to prompt anyway (#712). These drive the real factory end to end.
  async function runBashCommand(
    config: Record<string, unknown>,
    command: string,
  ): Promise<{ blocked: boolean; prompts: string[] }> {
    writeGlobalConfig(config);
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-yolo-cwd-"));
    const pi = makeFakePi({ toolNames: ["bash"] });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);

    const prompts: string[] = [];
    const { ctx } = makeUiCtx(cwd, prompts);
    await fireSessionStart(pi, ctx);

    const result = (await pi.fire(
      "tool_call",
      { toolName: "bash", toolCallId: "yolo-1", input: { command } },
      ctx,
    )) as { block?: true };

    rmSync(cwd, { recursive: true, force: true });
    return { blocked: result.block === true, prompts };
  }

  const permissiveBash = {
    permission: { "*": "allow", bash: { "*": "allow" } },
  };

  // The inner command must be one the pure-reader core does not cover, or the
  // wrapper is exempt from the floor and there is no synthesized ask left for
  // yolo to reconcile — which would make both tests below pass for the wrong
  // reason (#803).
  const flooredWrapper = "git status | xargs rm -rf";

  it("auto-approves an indirection wrapper under yolo", async () => {
    const outcome = await runBashCommand(
      { ...permissiveBash, yoloMode: true },
      flooredWrapper,
    );

    expect(outcome).toEqual({ blocked: false, prompts: [] });
  });

  it("still floors an indirection wrapper to a prompt with yolo off", async () => {
    const outcome = await runBashCommand(
      { ...permissiveBash, yoloMode: false },
      flooredWrapper,
    );

    expect(outcome.blocked).toBe(false);
    expect(outcome.prompts).toHaveLength(1);
    expect(outcome.prompts[0]).toContain("<indirection-bash-wrapper>");
  });

  it("never raises the ask for a wrapper running a pure reader", async () => {
    // The relief #803 ships, end to end through the real extension: no floor is
    // synthesized, so yolo has nothing to reconcile and the user sees nothing.
    const outcome = await runBashCommand(
      { ...permissiveBash, yoloMode: false },
      "git status | xargs grep foo",
    );

    expect(outcome).toEqual({ blocked: false, prompts: [] });
  });

  it("auto-approves an unparseable command under yolo", async () => {
    const outcome = await runBashCommand(
      { ...permissiveBash, yoloMode: true },
      "> out.txt",
    );

    expect(outcome).toEqual({ blocked: false, prompts: [] });
  });

  it("blocks a denied wrapper under yolo", async () => {
    const outcome = await runBashCommand(
      {
        permission: { "*": "allow", bash: { "*": "allow", "xargs*": "deny" } },
        yoloMode: true,
      },
      "git status | xargs grep foo",
    );

    expect(outcome).toEqual({ blocked: true, prompts: [] });
  });

  it("blocks a denied unparseable command under yolo", async () => {
    const outcome = await runBashCommand(
      { permission: { "*": "allow", bash: { "*": "deny" } }, yoloMode: true },
      "> out.txt",
    );

    expect(outcome).toEqual({ blocked: true, prompts: [] });
  });
});

describe("directional external-directory relief (#806)", () => {
  // The change's user-visible payoff: an `external_directory_read` grant
  // silences a read outside the working tree while a write to the same path
  // still prompts. Drives the real factory end to end.
  async function runPathTool(
    config: Record<string, unknown>,
    toolName: string,
    path: string,
  ): Promise<{ blocked: boolean; prompts: string[] }> {
    writeGlobalConfig(config);
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-directional-cwd-"));
    const pi = makeFakePi({ toolNames: ["read", "write", "edit"] });
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);

    const prompts: string[] = [];
    const { ctx } = makeUiCtx(cwd, prompts);
    await fireSessionStart(pi, ctx);

    const result = (await pi.fire(
      "tool_call",
      { toolName, toolCallId: "dir-1", input: { path } },
      ctx,
    )) as { block?: true };

    rmSync(cwd, { recursive: true, force: true });
    return { blocked: result.block === true, prompts };
  }

  const externalRoot = "/tmp/pi-perm-directional-target";
  const externalPath = `${externalRoot}/notes.md`;
  const readRelief = {
    permission: {
      "*": "allow",
      external_directory: { "*": "ask" },
      external_directory_read: { [`${externalRoot}/*`]: "allow" },
    },
  };

  it("silences a read the directional grant covers", async () => {
    const outcome = await runPathTool(readRelief, "read", externalPath);
    expect(outcome).toEqual({ blocked: false, prompts: [] });
  });

  it("still prompts for a write to the same path", async () => {
    const outcome = await runPathTool(readRelief, "write", externalPath);
    expect(outcome.blocked).toBe(false);
    expect(outcome.prompts).toHaveLength(1);
  });

  it("still prompts for an edit, which reads and writes", async () => {
    const outcome = await runPathTool(readRelief, "edit", externalPath);
    expect(outcome.blocked).toBe(false);
    expect(outcome.prompts).toHaveLength(1);
  });

  it("prompts for a read the grant does not cover", async () => {
    const outcome = await runPathTool(
      readRelief,
      "read",
      "/tmp/pi-perm-directional-elsewhere/notes.md",
    );
    expect(outcome.blocked).toBe(false);
    expect(outcome.prompts).toHaveLength(1);
  });

  it("keeps a bare external_directory config prompting every direction", async () => {
    const bare = {
      permission: { "*": "allow", external_directory: { "*": "ask" } },
    };
    for (const toolName of ["read", "write", "edit"]) {
      const outcome = await runPathTool(bare, toolName, externalPath);
      expect(outcome.prompts).toHaveLength(1);
    }
  });
});
