/* eslint-disable @typescript-eslint/no-deprecated -- these cases pin the
   zero-arg accessor's behavior, which the deprecation window preserves
   unchanged until its removal in a future major (ADR 0012 decision 7). */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccessIntent } from "#src/access-intent/access-intent";
import { AuthorizerRegistry } from "#src/authority/authorizer-registry";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import { LocalPermissionsService } from "#src/permissions-service";
import type { PermissionsService } from "#src/service";
import {
  getPermissionsService,
  getPermissionsServiceForSession,
  publishPermissionsService,
  publishPermissionsServiceForSession,
  unpublishPermissionsService,
  unpublishPermissionsServiceForSession,
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
    registerAuthorizer: vi.fn(),
    ...overrides,
  };
}

// ── globalThis accessor ────────────────────────────────────────────────────

describe("globalThis accessor", () => {
  afterEach(() => {
    const current = getPermissionsService();
    if (current) {
      unpublishPermissionsService(current);
    }
  });

  it("returns undefined when nothing has been published", () => {
    expect(getPermissionsService()).toBeUndefined();
  });

  it("returns the published service", () => {
    const service = makeService();
    publishPermissionsService(service);
    expect(getPermissionsService()).toBe(service);
  });

  it("overwrites a previously published service", () => {
    const first = makeService();
    const second = makeService();
    publishPermissionsService(first);
    publishPermissionsService(second);
    expect(getPermissionsService()).toBe(second);
  });

  it("removes the slot when it still holds the given service", () => {
    const service = makeService();
    publishPermissionsService(service);
    unpublishPermissionsService(service);
    expect(getPermissionsService()).toBeUndefined();
  });

  it("does not remove the slot when a different service occupies it", () => {
    const parent = makeService();
    const child = makeService();
    publishPermissionsService(parent);
    // A child instance never published `parent`; unpublishing its own service
    // must be a no-op that leaves the parent's slot intact.
    unpublishPermissionsService(child);
    expect(getPermissionsService()).toBe(parent);
  });

  it("unpublish is safe to call when nothing was published", () => {
    expect(() => unpublishPermissionsService(makeService())).not.toThrow();
    expect(getPermissionsService()).toBeUndefined();
  });
});

// ── session-keyed accessor ─────────────────────────────────────────────────

describe("session-keyed accessor", () => {
  const parentSessionId = "parent-session";
  const childSessionId = "child-session";

  afterEach(() => {
    for (const sessionId of [parentSessionId, childSessionId]) {
      const current = getPermissionsServiceForSession(sessionId);
      if (current) {
        unpublishPermissionsServiceForSession(sessionId, current);
      }
    }
  });

  it("returns undefined for a session that published nothing", () => {
    expect(getPermissionsServiceForSession(parentSessionId)).toBeUndefined();
  });

  it("returns the service published under that session id", () => {
    const service = makeService();
    publishPermissionsServiceForSession(parentSessionId, service);
    expect(getPermissionsServiceForSession(parentSessionId)).toBe(service);
  });

  it("keys each node's service separately", () => {
    const parent = makeService();
    const child = makeService();
    publishPermissionsServiceForSession(parentSessionId, parent);
    publishPermissionsServiceForSession(childSessionId, child);
    expect(getPermissionsServiceForSession(parentSessionId)).toBe(parent);
    expect(getPermissionsServiceForSession(childSessionId)).toBe(child);
  });

  it("does not populate the legacy root slot", () => {
    publishPermissionsServiceForSession(parentSessionId, makeService());
    expect(getPermissionsService()).toBeUndefined();
  });

  it("replaces the entry when a session republishes", () => {
    const first = makeService();
    const second = makeService();
    publishPermissionsServiceForSession(parentSessionId, first);
    publishPermissionsServiceForSession(parentSessionId, second);
    expect(getPermissionsServiceForSession(parentSessionId)).toBe(second);
  });

  it("removes the entry when it still holds the given service", () => {
    const service = makeService();
    publishPermissionsServiceForSession(parentSessionId, service);
    unpublishPermissionsServiceForSession(parentSessionId, service);
    expect(getPermissionsServiceForSession(parentSessionId)).toBeUndefined();
  });

  it("leaves a fresh publication alone when a superseded generation unpublishes", () => {
    const superseded = makeService();
    const fresh = makeService();
    publishPermissionsServiceForSession(parentSessionId, superseded);
    publishPermissionsServiceForSession(parentSessionId, fresh);
    unpublishPermissionsServiceForSession(parentSessionId, superseded);
    expect(getPermissionsServiceForSession(parentSessionId)).toBe(fresh);
  });

  it("unpublish is safe to call for a session that published nothing", () => {
    expect(() =>
      unpublishPermissionsServiceForSession(parentSessionId, makeService()),
    ).not.toThrow();
    expect(getPermissionsServiceForSession(parentSessionId)).toBeUndefined();
  });
});

// ── zero-arg accessor deprecation ───────────────────────────────────────

describe("zero-arg accessor deprecation", () => {
  /**
   * The once-guard is module-scoped, so each case imports a fresh copy of the
   * module — which is also how a consumer sees it under jiti isolation: one
   * warning per consumer module copy per process.
   */
  async function freshServiceModule() {
    vi.resetModules();
    return await import("#src/service");
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("warns once, naming the keyed replacement", async () => {
    const emitWarning = vi
      .spyOn(process, "emitWarning")
      .mockImplementation(() => undefined);
    const service = await freshServiceModule();

    service.getPermissionsService();
    service.getPermissionsService();

    expect(emitWarning).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("getPermissionsServiceForSession"),
      { type: "DeprecationWarning", code: "PI_PERMISSION_SYSTEM_DEP0001" },
    );
  });

  it("still resolves the process-root service", async () => {
    vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const service = await freshServiceModule();
    const published = makeService();

    service.publishPermissionsService(published);

    expect(service.getPermissionsService()).toBe(published);
    service.unpublishPermissionsService(published);
  });

  it("does not warn from the package's own publish/unpublish path", async () => {
    const emitWarning = vi
      .spyOn(process, "emitWarning")
      .mockImplementation(() => undefined);
    const service = await freshServiceModule();
    const published = makeService();

    service.publishPermissionsService(published);
    service.unpublishPermissionsService(published);

    expect(emitWarning).not.toHaveBeenCalled();
  });

  it("does not warn for the session-keyed accessors", async () => {
    const emitWarning = vi
      .spyOn(process, "emitWarning")
      .mockImplementation(() => undefined);
    const service = await freshServiceModule();
    const published = makeService();

    service.publishPermissionsServiceForSession("node-session", published);
    expect(service.getPermissionsServiceForSession("node-session")).toBe(
      published,
    );
    service.unpublishPermissionsServiceForSession("node-session", published);

    expect(emitWarning).not.toHaveBeenCalled();
  });
});

// ── service adapter delegation ─────────────────────────────────────────────

describe("service round-trip through the global slot", () => {
  afterEach(() => {
    const current = getPermissionsService();
    if (current) {
      unpublishPermissionsService(current);
    }
  });

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
    const result = getPermissionsService()!.checkPermission(
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
    getPermissionsService()!.checkPermission("read", "/test/project/.env");
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
    const result = getPermissionsService()!.getToolPermission(
      "write",
      "Explore",
    );
    expect(result).toBe("deny");
    expect(resolver.getToolPermission).toHaveBeenCalledWith("write", "Explore");
  });
});

// ── registerToolInputFormatter delegation ─────────────────────────────────

describe("registerToolInputFormatter delegation", () => {
  afterEach(() => {
    const current = getPermissionsService();
    if (current) {
      unpublishPermissionsService(current);
    }
  });

  it("delegates to the registry and returns its disposer", () => {
    const registry = new ToolInputFormatterRegistry();
    const formatter = () => "preview";

    const service = makeService({
      registerToolInputFormatter(toolName, fmt) {
        return registry.register(toolName, fmt);
      },
    });

    publishPermissionsService(service);
    const dispose = getPermissionsService()!.registerToolInputFormatter(
      "my-tool",
      formatter,
    );

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

    publishPermissionsService(service);
    expect(() =>
      getPermissionsService()!.registerToolInputFormatter("my-tool", () => ""),
    ).toThrow("my-tool");
  });
});

// ── registerToolAccessExtractor delegation (#352) ────────────────────────

describe("registerToolAccessExtractor delegation", () => {
  afterEach(() => {
    const current = getPermissionsService();
    if (current) {
      unpublishPermissionsService(current);
    }
  });

  it("delegates to the registry and returns its disposer", () => {
    const registry = new ToolAccessExtractorRegistry();
    const extractor = () => "/etc/hosts";

    const service = makeService({
      registerToolAccessExtractor(toolName, ext) {
        return registry.register(toolName, ext);
      },
    });

    publishPermissionsService(service);
    const dispose = getPermissionsService()!.registerToolAccessExtractor(
      "ffgrep",
      extractor,
    );

    expect(registry.get("ffgrep")).toBe(extractor);

    dispose();
    expect(registry.get("ffgrep")).toBeUndefined();
  });

  it("throws when an extractor is already registered for the tool name", () => {
    const registry = new ToolAccessExtractorRegistry();
    registry.register("ffgrep", () => undefined);

    const service = makeService({
      registerToolAccessExtractor(toolName, ext) {
        return registry.register(toolName, ext);
      },
    });

    publishPermissionsService(service);
    expect(() =>
      getPermissionsService()!.registerToolAccessExtractor("ffgrep", () => ""),
    ).toThrow("ffgrep");
  });
});
