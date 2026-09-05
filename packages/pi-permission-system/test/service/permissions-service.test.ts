import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AccessIntent } from "#src/access-intent/access-intent";
import type { AuthorizerRegistrar } from "#src/authority/authorizer-registry";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";
import { LocalPermissionsService } from "#src/service/permissions-service";
import {
  type ToolAccessExtractorLookup,
  type ToolAccessExtractorRegistrar,
  ToolAccessExtractorRegistry,
} from "#src/tool-input/tool-access-extractor-registry";
import {
  type ToolInputFormatter,
  type ToolInputFormatterLookup,
  type ToolInputFormatterRegistrar,
  ToolInputFormatterRegistry,
} from "#src/tool-input/tool-input-formatter-registry";
import type { PermissionCheckResult, PermissionState } from "#src/types";

import { makeCheckResult } from "#test/helpers/handler-fixtures";

// Mock node:fs so realpathSync (the canonical alias) is controllable.
const realpathSync = vi.hoisted(() =>
  vi.fn<(path: string) => string>((p) => p),
);
vi.mock("node:fs", () => ({
  realpathSync,
  default: { realpathSync },
}));

// Mock the advisory bash resolver so the service test asserts delegation; the
// decomposition behavior itself is covered in bash-advisory-check.test.ts.
const resolveBashAdvisoryCheck = vi.hoisted(() =>
  vi.fn<
    (
      command: string,
      agentName: string | undefined,
      resolver: unknown,
    ) => PermissionCheckResult
  >(),
);
vi.mock("#src/service/bash-advisory-check", () => ({
  resolveBashAdvisoryCheck,
}));

// ── helpers ────────────────────────────────────────────────────────────────

interface FakeResolver {
  resolve: Mock<(intent: AccessIntent) => PermissionCheckResult>;
  getToolPermission: Mock<
    (toolName: string, agentName?: string) => PermissionState
  >;
  isToolFullyDenied: Mock<(toolName: string, agentName?: string) => boolean>;
}

function makeResolver(): FakeResolver {
  return {
    resolve: vi
      .fn<(intent: AccessIntent) => PermissionCheckResult>()
      .mockReturnValue(makeCheckResult()),
    getToolPermission: vi
      .fn<(toolName: string, agentName?: string) => PermissionState>()
      .mockReturnValue("ask"),
    isToolFullyDenied: vi
      .fn<(toolName: string, agentName?: string) => boolean>()
      .mockReturnValue(false),
  };
}

function makeFormatterRegistry(): ToolInputFormatterRegistrar &
  ToolInputFormatterLookup {
  return {
    register: vi
      .fn<ToolInputFormatterRegistrar["register"]>()
      .mockReturnValue(vi.fn()),
    get: vi.fn<ToolInputFormatterLookup["get"]>(),
  };
}

function makeAccessExtractorRegistry(): ToolAccessExtractorRegistrar &
  ToolAccessExtractorLookup {
  return {
    register: vi
      .fn<ToolAccessExtractorRegistrar["register"]>()
      .mockReturnValue(vi.fn()),
    resolve: vi.fn<ToolAccessExtractorLookup["resolve"]>(),
  };
}

function makeAuthorizerRegistry(): AuthorizerRegistrar {
  return {
    register: vi.fn<AuthorizerRegistrar["register"]>().mockReturnValue(vi.fn()),
  };
}

function makeService(overrides?: {
  resolver?: FakeResolver;
  formatterRegistry?: ToolInputFormatterRegistrar & ToolInputFormatterLookup;
  accessExtractorRegistry?: ToolAccessExtractorRegistrar &
    ToolAccessExtractorLookup;
  authorizerRegistry?: AuthorizerRegistrar;
}) {
  const resolver = overrides?.resolver ?? makeResolver();
  // The published service always answers against the parent session's cwd.
  const session = { getPathNormalizer: () => normalizer };
  const formatterRegistry =
    overrides?.formatterRegistry ?? makeFormatterRegistry();
  const accessExtractorRegistry =
    overrides?.accessExtractorRegistry ?? makeAccessExtractorRegistry();
  const authorizerRegistry =
    overrides?.authorizerRegistry ?? makeAuthorizerRegistry();
  const service = new LocalPermissionsService(
    resolver,
    session,
    formatterRegistry,
    accessExtractorRegistry,
    authorizerRegistry,
  );
  return {
    service,
    resolver,
    formatterRegistry,
    accessExtractorRegistry,
    authorizerRegistry,
  };
}

const normalizer = new PathNormalizer(posixPathFlavor, "/test/project");

// ── tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  realpathSync.mockReset();
  realpathSync.mockImplementation((p: string) => p);
  resolveBashAdvisoryCheck.mockReset();
  resolveBashAdvisoryCheck.mockReturnValue(
    makeCheckResult({ toolName: "bash" }),
  );
});

describe("checkPermission", () => {
  it("resolves a non-path surface through a tool intent", () => {
    const { service, resolver } = makeService();
    service.checkPermission("skill", "my-skill", "my-agent");
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "skill",
      input: { name: "my-skill" },
      agentName: "my-agent",
    });
  });

  it("routes a bash query through the advisory decomposition resolver", () => {
    const { service, resolver } = makeService();
    const expected = makeCheckResult({ state: "deny", toolName: "bash" });
    resolveBashAdvisoryCheck.mockReturnValue(expected);
    const result = service.checkPermission(
      "bash",
      "cd /repo && npm install x",
      "my-agent",
    );
    expect(resolveBashAdvisoryCheck).toHaveBeenCalledWith(
      "cd /repo && npm install x",
      "my-agent",
      resolver,
    );
    expect(result).toBe(expected);
  });

  it("passes an empty string to the advisory resolver for a value-less bash query", () => {
    const { service, resolver } = makeService();
    service.checkPermission("bash");
    expect(resolveBashAdvisoryCheck).toHaveBeenCalledWith(
      "",
      undefined,
      resolver,
    );
  });

  it("resolves an external_directory path query through an access-path intent matching the canonical alias", () => {
    realpathSync.mockImplementation((p: string) =>
      p === "/test/project/link" ? "/test/project/real" : p,
    );
    const { service, resolver } = makeService();
    service.checkPermission("external_directory", "link");
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    const intent = resolver.resolve.mock.calls[0][0];
    expect(intent.kind).toBe("access-path");
    if (intent.kind === "access-path") {
      expect(intent.surface).toBe("external_directory");
      expect(intent.path.matchValues()).toContain("/test/project/real");
    }
  });

  it("resolves a path-bearing tool query (read) through an access-path intent", () => {
    const { service, resolver } = makeService();
    service.checkPermission("read", "/test/project/.env");
    const intent = resolver.resolve.mock.calls[0][0];
    expect(intent.kind).toBe("access-path");
    if (intent.kind === "access-path") {
      expect(intent.surface).toBe("read");
      expect(intent.path.value()).toBe("/test/project/.env");
    }
  });

  it("falls back to a tool intent for a value-less path query", () => {
    const { service, resolver } = makeService();
    service.checkPermission("path");
    const intent = resolver.resolve.mock.calls[0][0];
    expect(intent.kind).toBe("tool");
  });

  it("returns the result from resolver.resolve", () => {
    const expected = makeCheckResult({ state: "deny", toolName: "skill" });
    const resolver = makeResolver();
    resolver.resolve.mockReturnValue(expected);
    const { service } = makeService({ resolver });
    const result = service.checkPermission("skill", "my-skill");
    expect(result).toBe(expected);
  });
});

describe("getToolPermission", () => {
  it("delegates to resolver.getToolPermission", () => {
    const resolver = makeResolver();
    resolver.getToolPermission.mockReturnValue("deny");
    const { service } = makeService({ resolver });
    const result = service.getToolPermission("write", "my-agent");
    expect(resolver.getToolPermission).toHaveBeenCalledWith(
      "write",
      "my-agent",
    );
    expect(result).toBe("deny");
  });

  it("omits agentName when not provided", () => {
    const { service, resolver } = makeService();
    service.getToolPermission("read");
    expect(resolver.getToolPermission).toHaveBeenCalledWith("read", undefined);
  });
});

describe("isToolFullyDenied", () => {
  it("delegates to resolver.isToolFullyDenied", () => {
    const resolver = makeResolver();
    resolver.isToolFullyDenied.mockReturnValue(true);
    const { service } = makeService({ resolver });
    const result = service.isToolFullyDenied("write", "my-agent");
    expect(resolver.isToolFullyDenied).toHaveBeenCalledWith(
      "write",
      "my-agent",
    );
    expect(result).toBe(true);
  });

  it("omits agentName when not provided", () => {
    const { service, resolver } = makeService();
    service.isToolFullyDenied("read");
    expect(resolver.isToolFullyDenied).toHaveBeenCalledWith("read", undefined);
  });
});

describe("registerToolInputFormatter", () => {
  it("delegates to formatterRegistry.register and returns the unsubscribe function", () => {
    const unsub = vi.fn();
    const { service, formatterRegistry } = makeService();
    vi.mocked(formatterRegistry.register).mockReturnValue(unsub);
    const formatter: ToolInputFormatter = vi.fn();
    const result = service.registerToolInputFormatter("my-tool", formatter);
    expect(formatterRegistry.register).toHaveBeenCalledWith(
      "my-tool",
      formatter,
    );
    expect(result).toBe(unsub);
  });
});

describe("registerToolAccessExtractor", () => {
  it("delegates to accessExtractorRegistry.register and returns the unsubscribe function", () => {
    const unsub = vi.fn();
    const { service, accessExtractorRegistry } = makeService();
    vi.mocked(accessExtractorRegistry.register).mockReturnValue(unsub);
    const extractor = vi.fn();
    const result = service.registerToolAccessExtractor("ffgrep", extractor);
    expect(accessExtractorRegistry.register).toHaveBeenCalledWith(
      "ffgrep",
      extractor,
    );
    expect(result).toBe(unsub);
  });
});

describe("reading a registration back", () => {
  it("answers the extractor this node's registry holds", () => {
    const accessExtractorRegistry = new ToolAccessExtractorRegistry();
    const { service } = makeService({ accessExtractorRegistry });
    const extractor = () => "/etc/hosts";

    service.registerToolAccessExtractor("ffgrep", extractor);

    expect(service.getToolAccessExtractor("ffgrep")).toBe(extractor);
  });

  it("answers the formatter this node's registry holds", () => {
    const formatterRegistry = new ToolInputFormatterRegistry();
    const { service } = makeService({ formatterRegistry });
    const formatter = () => "preview";

    service.registerToolInputFormatter("my-tool", formatter);

    expect(service.getToolInputFormatter("my-tool")).toBe(formatter);
  });

  it("answers undefined for a tool with no registration", () => {
    const { service } = makeService({
      accessExtractorRegistry: new ToolAccessExtractorRegistry(),
      formatterRegistry: new ToolInputFormatterRegistry(),
    });

    expect(service.getToolAccessExtractor("unregistered")).toBeUndefined();
    expect(service.getToolInputFormatter("unregistered")).toBeUndefined();
  });

  it("stops answering once the registration is disposed", () => {
    const accessExtractorRegistry = new ToolAccessExtractorRegistry();
    const { service } = makeService({ accessExtractorRegistry });

    const dispose = service.registerToolAccessExtractor(
      "ffgrep",
      () => "/etc/hosts",
    );
    dispose();

    expect(service.getToolAccessExtractor("ffgrep")).toBeUndefined();
  });

  it("unwraps the resolution rather than exposing its origin", () => {
    const { service, accessExtractorRegistry } = makeService();
    const extractor = vi.fn();
    vi.mocked(accessExtractorRegistry.resolve).mockReturnValue({
      extractor,
      origin: "inherited",
    });

    // The cross-extension surface answers the capability, not which node
    // supplied it — provenance is the gates' concern, not a caller's.
    expect(service.getToolAccessExtractor("ffgrep")).toBe(extractor);
  });
});

describe("registerAuthorizer", () => {
  it("delegates to authorizerRegistry.register and returns the unsubscribe function", () => {
    const unsub = vi.fn();
    const { service, authorizerRegistry } = makeService();
    vi.mocked(authorizerRegistry.register).mockReturnValue(unsub);
    const authorize = vi.fn();
    const result = service.registerAuthorizer("model-judge", authorize);
    expect(authorizerRegistry.register).toHaveBeenCalledWith(
      "model-judge",
      authorize,
    );
    expect(result).toBe(unsub);
  });
});
