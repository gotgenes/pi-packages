import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccessIntent } from "#src/access-intent/access-intent";
import { AuthorizerRegistry } from "#src/authority/authorizer-registry";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import { LocalPermissionsService } from "#src/permissions-service";
import type { PermissionsService } from "#src/service";
import {
  getPermissionsService,
  publishPermissionsService,
  unpublishPermissionsService,
} from "#src/service";
import { ToolAccessExtractorRegistry } from "#src/tool-access-extractor-registry";
import { ToolInputFormatterRegistry } from "#src/tool-input-formatter-registry";
import type { PermissionCheckResult, PermissionState } from "#src/types";

// ── helpers ────────────────────────────────────────────────────────────────

function makeService(
  overrides: Partial<PermissionsService> = {},
): PermissionsService {
  return {
    checkPermission: vi.fn(),
    getToolPermission: vi.fn(),
    registerToolInputFormatter: vi.fn(),
    registerToolAccessExtractor: vi.fn(),
    getToolAccessExtractor: vi.fn(),
    getToolInputFormatter: vi.fn(),
    registerAuthorizer: vi.fn(),
    ...overrides,
  };
}

/** The session id the service-adapter suites below publish under. */
const ADAPTER_SESSION = "adapter-session";

function unpublishAdapterService(): void {
  const current = getPermissionsService(ADAPTER_SESSION);
  if (current) {
    unpublishPermissionsService(ADAPTER_SESSION, current);
  }
}

// ── session-keyed accessor ─────────────────────────────────────────────────

describe("session-keyed accessor", () => {
  const parentSessionId = "parent-session";
  const childSessionId = "child-session";

  afterEach(() => {
    for (const sessionId of [parentSessionId, childSessionId]) {
      const current = getPermissionsService(sessionId);
      if (current) {
        unpublishPermissionsService(sessionId, current);
      }
    }
  });

  it("returns undefined for a session that published nothing", () => {
    expect(getPermissionsService(parentSessionId)).toBeUndefined();
  });

  it("returns the service published under that session id", () => {
    const service = makeService();
    publishPermissionsService(parentSessionId, service);
    expect(getPermissionsService(parentSessionId)).toBe(service);
  });

  it("keys each node's service separately", () => {
    const parent = makeService();
    const child = makeService();
    publishPermissionsService(parentSessionId, parent);
    publishPermissionsService(childSessionId, child);
    expect(getPermissionsService(parentSessionId)).toBe(parent);
    expect(getPermissionsService(childSessionId)).toBe(child);
  });

  it("replaces the entry when a session republishes", () => {
    const first = makeService();
    const second = makeService();
    publishPermissionsService(parentSessionId, first);
    publishPermissionsService(parentSessionId, second);
    expect(getPermissionsService(parentSessionId)).toBe(second);
  });

  it("removes the entry when it still holds the given service", () => {
    const service = makeService();
    publishPermissionsService(parentSessionId, service);
    unpublishPermissionsService(parentSessionId, service);
    expect(getPermissionsService(parentSessionId)).toBeUndefined();
  });

  it("leaves a fresh publication alone when a superseded generation unpublishes", () => {
    const superseded = makeService();
    const fresh = makeService();
    publishPermissionsService(parentSessionId, superseded);
    publishPermissionsService(parentSessionId, fresh);
    unpublishPermissionsService(parentSessionId, superseded);
    expect(getPermissionsService(parentSessionId)).toBe(fresh);
  });

  it("unpublish is safe to call for a session that published nothing", () => {
    expect(() =>
      unpublishPermissionsService(parentSessionId, makeService()),
    ).not.toThrow();
    expect(getPermissionsService(parentSessionId)).toBeUndefined();
  });
});

// ── module-scoped warning guards ───────────────────────────────────────────

/**
 * Each once-guard is module-scoped, so a case that asserts on it imports a
 * fresh copy of the module — which is also how a consumer sees it under jiti
 * isolation: one warning per consumer module copy per process.
 */
async function freshServiceModule() {
  vi.resetModules();
  return await import("#src/service");
}

describe("session-keyed accessors emit no warning", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("stays silent across a publish, resolve, and unpublish round trip", async () => {
    const emitWarning = vi
      .spyOn(process, "emitWarning")
      .mockImplementation(() => undefined);
    const service = await freshServiceModule();
    const published = makeService();

    service.publishPermissionsService("node-session", published);
    expect(service.getPermissionsService("node-session")).toBe(published);
    service.unpublishPermissionsService("node-session", published);

    expect(emitWarning).not.toHaveBeenCalled();
  });
});

// ── keyed accessor called without a session id ─────────────────────────────

describe("keyed accessor called without a session id", () => {
  /** The JS call shape a required parameter cannot prevent. */
  function callWithoutSessionId(
    get: (sessionId: string) => PermissionsService | undefined,
  ): PermissionsService | undefined {
    return (get as unknown as () => PermissionsService | undefined)();
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns undefined rather than another node's service", async () => {
    vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const service = await freshServiceModule();
    const published = makeService();
    service.publishPermissionsService("other-node", published);

    expect(callWithoutSessionId(service.getPermissionsService)).toBeUndefined();

    service.unpublishPermissionsService("other-node", published);
  });

  it("warns once, naming the keyed locator and the ready payload", async () => {
    const emitWarning = vi
      .spyOn(process, "emitWarning")
      .mockImplementation(() => undefined);
    const service = await freshServiceModule();

    callWithoutSessionId(service.getPermissionsService);
    callWithoutSessionId(service.getPermissionsService);

    expect(emitWarning).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("getPermissionsService(sessionId)"),
      { type: "Warning", code: "PI_PERMISSION_SYSTEM_WARN0001" },
    );
    expect(emitWarning).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("permissions:ready"),
      expect.anything(),
    );
    // The removed process-root reader is no longer an escape hatch to name.
    expect(emitWarning).toHaveBeenCalledExactlyOnceWith(
      expect.not.stringContaining("getRootPermissionsService"),
      expect.anything(),
    );
  });

  it("does not warn when a session id is passed", async () => {
    const emitWarning = vi
      .spyOn(process, "emitWarning")
      .mockImplementation(() => undefined);
    const service = await freshServiceModule();

    expect(service.getPermissionsService("node-session")).toBeUndefined();

    expect(emitWarning).not.toHaveBeenCalled();
  });
});

// ── service adapter delegation ─────────────────────────────────────────────

describe("service round-trip through the keyed locator", () => {
  afterEach(unpublishAdapterService);

  const fakeResult: PermissionCheckResult = {
    toolName: "bash",
    state: "allow",
    matchedPattern: "git *",
    source: "bash",
    origin: "global",
  };

  function makeResolver() {
    return {
      resolve: vi
        .fn<(intent: AccessIntent) => PermissionCheckResult>()
        .mockReturnValue(fakeResult),
      getToolPermission: vi
        .fn<(toolName: string, agentName?: string) => PermissionState>()
        .mockReturnValue("ask"),
    };
  }

  function publishLocalService(resolver: ReturnType<typeof makeResolver>) {
    publishPermissionsService(
      ADAPTER_SESSION,
      new LocalPermissionsService(
        resolver,
        {
          getPathNormalizer: () =>
            new PathNormalizer(posixPathFlavor, "/test/project"),
        },
        new ToolInputFormatterRegistry(),
        new ToolAccessExtractorRegistry(),
        new AuthorizerRegistry(),
      ),
    );
  }

  it("resolves a non-path query via a tool intent", () => {
    const resolver = makeResolver();
    publishLocalService(resolver);
    const result = getPermissionsService(ADAPTER_SESSION)!.checkPermission(
      "bash",
      "git push",
      "Explore",
    );
    expect(result).toBe(fakeResult);
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "bash",
      input: { command: "git push" },
      agentName: "Explore",
    });
  });

  it("resolves a path-surface query via an access-path intent", () => {
    const resolver = makeResolver();
    publishLocalService(resolver);
    getPermissionsService(ADAPTER_SESSION)!.checkPermission(
      "read",
      "/test/project/.env",
    );
    const intent = resolver.resolve.mock.calls[0][0];
    expect(intent.kind).toBe("access-path");
    if (intent.kind === "access-path") {
      expect(intent.surface).toBe("read");
    }
  });

  it("delegates getToolPermission through the resolver", () => {
    const resolver = makeResolver();
    resolver.getToolPermission.mockReturnValue("deny");
    publishLocalService(resolver);
    const result = getPermissionsService(ADAPTER_SESSION)!.getToolPermission(
      "write",
      "Explore",
    );
    expect(result).toBe("deny");
    expect(resolver.getToolPermission).toHaveBeenCalledWith("write", "Explore");
  });
});

// ── registerToolInputFormatter delegation ─────────────────────────────────

describe("registerToolInputFormatter delegation", () => {
  afterEach(unpublishAdapterService);

  it("delegates to the registry and returns its disposer", () => {
    const registry = new ToolInputFormatterRegistry();
    const formatter = () => "preview";

    const service = makeService({
      registerToolInputFormatter(toolName, fmt) {
        return registry.register(toolName, fmt);
      },
    });

    publishPermissionsService(ADAPTER_SESSION, service);
    const dispose = getPermissionsService(
      ADAPTER_SESSION,
    )!.registerToolInputFormatter("my-tool", formatter);

    // Registry received the registration
    expect(registry.get("my-tool")).toBe(formatter);

    // Disposer returned from service removes it from the registry
    dispose();
    expect(registry.get("my-tool")).toBeUndefined();
  });

  it("throws when a formatter is already registered for the tool name", () => {
    const registry = new ToolInputFormatterRegistry();
    registry.register("my-tool", () => undefined);

    const service = makeService({
      registerToolInputFormatter(toolName, fmt) {
        return registry.register(toolName, fmt);
      },
    });

    publishPermissionsService(ADAPTER_SESSION, service);
    expect(() =>
      getPermissionsService(ADAPTER_SESSION)!.registerToolInputFormatter(
        "my-tool",
        () => "",
      ),
    ).toThrow("my-tool");
  });
});

// ── registerToolAccessExtractor delegation (#352) ────────────────────────

describe("registerToolAccessExtractor delegation", () => {
  afterEach(unpublishAdapterService);

  it("delegates to the registry and returns its disposer", () => {
    const registry = new ToolAccessExtractorRegistry();
    const extractor = () => "/etc/hosts";

    const service = makeService({
      registerToolAccessExtractor(toolName, ext) {
        return registry.register(toolName, ext);
      },
    });

    publishPermissionsService(ADAPTER_SESSION, service);
    const dispose = getPermissionsService(
      ADAPTER_SESSION,
    )!.registerToolAccessExtractor("ffgrep", extractor);

    expect(registry.resolve("ffgrep")?.extractor).toBe(extractor);

    dispose();
    expect(registry.resolve("ffgrep")).toBeUndefined();
  });

  it("throws when an extractor is already registered for the tool name", () => {
    const registry = new ToolAccessExtractorRegistry();
    registry.register("ffgrep", () => undefined);

    const service = makeService({
      registerToolAccessExtractor(toolName, ext) {
        return registry.register(toolName, ext);
      },
    });

    publishPermissionsService(ADAPTER_SESSION, service);
    expect(() =>
      getPermissionsService(ADAPTER_SESSION)!.registerToolAccessExtractor(
        "ffgrep",
        () => "",
      ),
    ).toThrow("ffgrep");
  });
});
