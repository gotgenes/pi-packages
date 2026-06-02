/**
 * Composition-root tests for `piPermissionSystemExtension(pi)`.
 *
 * These run the real factory via the `makeFakePi()` harness and assert the
 * wiring contracts that unit tests cannot see: handler-registration
 * completeness, shared-instance contracts across factory invocations, teardown,
 * service↔gate registry sharing, and `ready`-after-publish ordering.
 *
 * Every test runs the factory, which mutates two process-global `Symbol.for()`
 * slots and reads `PI_CODING_AGENT_DIR`. The shared `beforeEach`/`afterEach`
 * isolate the agent dir to a tmpdir and clear both global slots so factory runs
 * do not leak across tests.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  createEventBus,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGlobalConfigPath } from "#src/config-paths";
import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";
import piPermissionSystemExtension from "#src/index";
import { PERMISSIONS_READY_CHANNEL } from "#src/permission-events";
import {
  createPermissionForwardingLocation,
  type ForwardedPermissionRequest,
} from "#src/permission-forwarding";
import { getPermissionsService } from "#src/service";
import { SUBAGENT_CHILD_SESSION_CREATED } from "#src/subagent-lifecycle-events";
import { getSubagentSessionRegistry } from "#src/subagent-registry";
import { makeFakePi } from "#test/helpers/make-fake-pi";

const SERVICE_KEY = Symbol.for("@gotgenes/pi-permission-system:service");
const SUBAGENT_REGISTRY_KEY = Symbol.for(
  "@gotgenes/pi-permission-system:subagent-registry",
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
  // Drop both process-global slots so factory runs do not leak across tests.
  const store = globalThis as Record<symbol, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Symbol-keyed global property
  delete store[SERVICE_KEY];
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Symbol-keyed global property
  delete store[SUBAGENT_REGISTRY_KEY];
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

/** Build a minimal subagent `ctx` (no UI) for driving tool-call gates. */
function makeChildCtx(cwd: string, sessionId: string): unknown {
  return {
    cwd,
    hasUI: false,
    sessionManager: {
      getEntries: (): unknown[] => [],
      getSessionId: (): string => sessionId,
      getSessionDir: (): string => cwd,
    },
    ui: {
      notify: (): void => {},
      setStatus: (): void => {},
      select: async (): Promise<string | undefined> => undefined,
      input: async (): Promise<string | undefined> => undefined,
    },
  };
}

/**
 * Build a UI-present `ctx` that records the titles passed to `ui.select`, and
 * approves every prompt. The ask-prompt message (which embeds the tool-input
 * preview) is the first line of the select title.
 */
function makeUiCtx(cwd: string, capturedTitles: string[]): { ctx: unknown } {
  const ctx = {
    cwd,
    hasUI: true,
    sessionManager: {
      getEntries: (): unknown[] => [],
      getSessionId: (): string => "ui-session",
      getSessionDir: (): string => cwd,
    },
    ui: {
      notify: (): void => {},
      setStatus: (): void => {},
      select: async (title: string): Promise<string | undefined> => {
        capturedTitles.push(title);
        return "Yes";
      },
      input: async (): Promise<string | undefined> => undefined,
    },
  };
  return { ctx };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
});

describe("shutdown teardown chain", () => {
  it("unpublishes the service and unsubscribes the lifecycle on shutdown", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-teardown-cwd-"));
    const pi = makeFakePi();
    piPermissionSystemExtension(pi as unknown as ExtensionAPI);

    // The service is published at session_start, not at factory init.
    await fireSessionStart(pi, makeChildCtx(cwd, "top-session"));
    expect(getPermissionsService()).toBeDefined();

    await pi.fire("session_shutdown");

    // Service slot cleared.
    expect(getPermissionsService()).toBeUndefined();

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
    getPermissionsService()!.registerToolInputFormatter(
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

describe("ready emitted after service publication", () => {
  // Ordering contracts exist only at the composition root: a consumer reacting
  // to permissions:ready must be able to resolve the service immediately. The
  // service is published and ready fires at session_start (not factory init).
  it("publishes the service before emitting permissions:ready", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-perm-ready-cwd-"));
    const seen: string[] = [];
    const pi = makeFakePi();
    pi.events.on(PERMISSIONS_READY_CHANNEL, () => {
      seen.push(getPermissionsService() ? "present" : "missing");
    });

    piPermissionSystemExtension(pi as unknown as ExtensionAPI);

    // ready is not emitted at load; only after session_start publishes.
    expect(seen).toEqual([]);

    await fireSessionStart(pi, makeChildCtx(cwd, "top-session"));

    expect(seen).toEqual(["present"]);

    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("multi-instance global service interplay", () => {
  // The fix (#302) scopes the process-global service slot to the publishing
  // instance. The parent publishes at its session_start; an in-process child
  // (registered by session id) skips publishing, and its identity-scoped
  // teardown is a no-op — so the parent's service is the one that resolves
  // throughout the child's lifecycle and survives the child's shutdown.
  it("keeps the parent's service published across the child's lifecycle", async () => {
    const parentCwd = mkdtempSync(join(tmpdir(), "pi-perm-parent-cwd-"));
    const childCwd = mkdtempSync(join(tmpdir(), "pi-perm-child-cwd-"));
    const childSessionId = "child-session-mi";

    const parentPi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(parentPi as unknown as ExtensionAPI);
    const childPi = makeFakePi({ events: createEventBus() });
    piPermissionSystemExtension(childPi as unknown as ExtensionAPI);

    // The parent is not a registered child, so it publishes its service.
    await fireSessionStart(
      parentPi,
      makeChildCtx(parentCwd, "parent-session-mi"),
    );
    const parentService = getPermissionsService();
    expect(parentService).toBeDefined();

    // The child is registered in the shared global registry before its own
    // session_start, so it detects itself and skips publishing.
    getSubagentSessionRegistry().register(childSessionId, {
      parentSessionId: "parent-session-mi",
    });
    await fireSessionStart(childPi, makeChildCtx(childCwd, childSessionId));

    // Mid-run: the slot resolves the parent's service, never the child's.
    expect(getPermissionsService()).toBe(parentService);

    // The child's shutdown is a no-op for the slot it never owned.
    await childPi.fire("session_shutdown");
    expect(getPermissionsService()).toBe(parentService);

    rmSync(parentCwd, { recursive: true, force: true });
    rmSync(childCwd, { recursive: true, force: true });
  });
});
