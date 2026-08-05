import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccessIntent } from "#src/access-intent/access-intent";
import {
  AuthorizerRegistry,
  isAuthorizerAlreadyRegisteredError,
} from "#src/authority/authorizer-registry";
import { getSubagentSessionRegistry } from "#src/authority/subagent-registry";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import { LocalPermissionsService } from "#src/permissions-service";
import type { PermissionsService } from "#src/service";
import {
  getPermissionsService,
  isAuthorizerAlreadyRegisteredError as isAuthorizerAlreadyRegisteredErrorPublic,
  isRegisteredSubagentChild,
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

describe("additional public exports", () => {
  it("exports isRegisteredSubagentChild with process-global registry lookup", () => {
    const sessionId = "service-export-child";
    const ctx = {
      sessionManager: {
        getSessionDir: () => "",
        getSessionId: () => sessionId,
      },
    };
    const registry = getSubagentSessionRegistry();
    registry.register(sessionId, {});
    try {
      expect(isRegisteredSubagentChild(ctx)).toBe(true);
    } finally {
      registry.unregister(sessionId);
    }
  });

  it("exports isAuthorizerAlreadyRegisteredError for cross-module-safe duplicate detection", () => {
    const foreignError = {
      name: "AuthorizerAlreadyRegisteredError",
      code: "AUTHORIZER_ALREADY_REGISTERED",
      linkName: "model-judge",
    };
    expect(isAuthorizerAlreadyRegisteredErrorPublic(foreignError)).toBe(true);
    // Keep source and public exports aligned.
    expect(isAuthorizerAlreadyRegisteredErrorPublic(foreignError)).toBe(
      isAuthorizerAlreadyRegisteredError(foreignError),
    );
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
