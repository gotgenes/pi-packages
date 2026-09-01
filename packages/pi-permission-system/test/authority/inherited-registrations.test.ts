import { describe, expect, it, vi } from "vitest";

import {
  AncestorNodes,
  InheritingToolAccessExtractorLookup,
  InheritingToolInputFormatterLookup,
  type NodeIdentity,
  type ParentChainRegistry,
  type PermissionsServiceLocator,
} from "#src/authority/inherited-registrations";
import type { PermissionsService } from "#src/service";
import {
  type ToolAccessExtractor,
  ToolAccessExtractorRegistry,
} from "#src/tool-access-extractor-registry";
import {
  type ToolInputFormatter,
  ToolInputFormatterRegistry,
} from "#src/tool-input-formatter-registry";

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

function nodeIdentity(sessionId: string | null): NodeIdentity {
  return { currentSessionId: () => sessionId };
}

/** A registry over a child → parent map, matching the real one's read shape. */
function registryOf(parents: Record<string, string>): ParentChainRegistry {
  return {
    get: (sessionId) =>
      sessionId in parents
        ? { parentSessionId: parents[sessionId] }
        : undefined,
  };
}

function locatorOf(
  services: Record<string, PermissionsService>,
): PermissionsServiceLocator {
  return (sessionId) => services[sessionId];
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("AncestorNodes", () => {
  describe("findFirst", () => {
    it("answers from the immediate parent", () => {
      const parent = makeService();
      const ancestors = new AncestorNodes(
        nodeIdentity("child"),
        registryOf({ child: "parent" }),
        locatorOf({ parent }),
      );

      expect(
        ancestors.findFirst((s) => (s === parent ? "hit" : undefined)),
      ).toBe("hit");
    });

    it("keeps walking to a grandparent when the parent declines", () => {
      const grandparent = makeService();
      const parent = makeService();
      const ancestors = new AncestorNodes(
        nodeIdentity("child"),
        registryOf({ child: "parent", parent: "grandparent" }),
        locatorOf({ parent, grandparent }),
      );

      expect(
        ancestors.findFirst((s) => (s === grandparent ? "hit" : undefined)),
      ).toBe("hit");
    });

    it("walks past a hop that published no service", () => {
      // A node with no service still names its own parent in the registry, so
      // an unpublished intermediate must not end the walk.
      const grandparent = makeService();
      const ancestors = new AncestorNodes(
        nodeIdentity("child"),
        registryOf({ child: "parent", parent: "grandparent" }),
        locatorOf({ grandparent }),
      );

      expect(
        ancestors.findFirst((s) => (s === grandparent ? "hit" : undefined)),
      ).toBe("hit");
    });

    it("answers undefined when this node has no session id", () => {
      const locate = vi.fn<PermissionsServiceLocator>();
      const ancestors = new AncestorNodes(
        nodeIdentity(null),
        registryOf({ child: "parent" }),
        locate,
      );

      expect(ancestors.findFirst(() => "hit")).toBeUndefined();
      expect(locate).not.toHaveBeenCalled();
    });

    it("answers undefined for a root node with no registry entry", () => {
      const locate = vi.fn<PermissionsServiceLocator>();
      const ancestors = new AncestorNodes(
        nodeIdentity("root"),
        registryOf({}),
        locate,
      );

      expect(ancestors.findFirst(() => "hit")).toBeUndefined();
      expect(locate).not.toHaveBeenCalled();
    });

    it("answers undefined when no ancestor answers", () => {
      const ancestors = new AncestorNodes(
        nodeIdentity("child"),
        registryOf({ child: "parent" }),
        locatorOf({ parent: makeService() }),
      );

      expect(
        ancestors.findFirst((): string | undefined => undefined),
      ).toBeUndefined();
    });

    it("terminates on a cycle in the parent chain", () => {
      const ancestors = new AncestorNodes(
        nodeIdentity("a"),
        registryOf({ a: "b", b: "a" }),
        locatorOf({ a: makeService(), b: makeService() }),
      );

      expect(
        ancestors.findFirst((): string | undefined => undefined),
      ).toBeUndefined();
    });

    it("resolves each hop through the locator rather than caching a service", () => {
      const parent = makeService();
      const locate = vi.fn<PermissionsServiceLocator>().mockReturnValue(parent);
      const ancestors = new AncestorNodes(
        nodeIdentity("child"),
        registryOf({ child: "parent" }),
        locate,
      );

      ancestors.findFirst(() => "hit");
      ancestors.findFirst(() => "hit");

      expect(locate).toHaveBeenCalledTimes(2);
      expect(locate).toHaveBeenCalledWith("parent");
    });
  });
});

describe("InheritingToolAccessExtractorLookup", () => {
  const extractor: ToolAccessExtractor = () => "/etc/hosts";

  it("answers this node's own registration as local", () => {
    const local = new ToolAccessExtractorRegistry();
    local.register("ffgrep", extractor);
    const findFirst = vi.fn();
    const lookup = new InheritingToolAccessExtractorLookup(local, {
      findFirst,
    } as unknown as AncestorNodes);

    expect(lookup.resolve("ffgrep")).toEqual({ extractor, origin: "local" });
    // A local hit must not reach across the node boundary at all.
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("answers an ancestor's registration as inherited", () => {
    const parent = makeService({
      getToolAccessExtractor: vi.fn().mockReturnValue(extractor),
    });
    const lookup = new InheritingToolAccessExtractorLookup(
      new ToolAccessExtractorRegistry(),
      new AncestorNodes(
        nodeIdentity("child"),
        registryOf({ child: "parent" }),
        locatorOf({ parent }),
      ),
    );

    expect(lookup.resolve("ffgrep")).toEqual({
      extractor,
      origin: "inherited",
    });
    expect(parent.getToolAccessExtractor).toHaveBeenCalledWith("ffgrep");
  });

  it("answers undefined when neither this node nor an ancestor has one", () => {
    const lookup = new InheritingToolAccessExtractorLookup(
      new ToolAccessExtractorRegistry(),
      new AncestorNodes(
        nodeIdentity("child"),
        registryOf({ child: "parent" }),
        locatorOf({ parent: makeService() }),
      ),
    );

    expect(lookup.resolve("ffgrep")).toBeUndefined();
  });
});

describe("InheritingToolInputFormatterLookup", () => {
  const formatter: ToolInputFormatter = () => "preview";

  it("answers this node's own registration without consulting an ancestor", () => {
    const local = new ToolInputFormatterRegistry();
    local.register("my-tool", formatter);
    const findFirst = vi.fn();
    const lookup = new InheritingToolInputFormatterLookup(local, {
      findFirst,
    } as unknown as AncestorNodes);

    expect(lookup.get("my-tool")).toBe(formatter);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("answers an ancestor's registration", () => {
    const parent = makeService({
      getToolInputFormatter: vi.fn().mockReturnValue(formatter),
    });
    const lookup = new InheritingToolInputFormatterLookup(
      new ToolInputFormatterRegistry(),
      new AncestorNodes(
        nodeIdentity("child"),
        registryOf({ child: "parent" }),
        locatorOf({ parent }),
      ),
    );

    expect(lookup.get("my-tool")).toBe(formatter);
    expect(parent.getToolInputFormatter).toHaveBeenCalledWith("my-tool");
  });

  it("answers undefined when neither this node nor an ancestor has one", () => {
    const lookup = new InheritingToolInputFormatterLookup(
      new ToolInputFormatterRegistry(),
      new AncestorNodes(
        nodeIdentity("child"),
        registryOf({ child: "parent" }),
        locatorOf({ parent: makeService() }),
      ),
    );

    expect(lookup.get("my-tool")).toBeUndefined();
  });
});
