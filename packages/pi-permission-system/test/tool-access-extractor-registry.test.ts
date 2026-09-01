import { describe, expect, test } from "vitest";

import {
  type ToolAccessExtractor,
  ToolAccessExtractorRegistry,
} from "#src/tool-access-extractor-registry";

const noopExtractor: ToolAccessExtractor = () => "/tmp/x";

describe("ToolAccessExtractorRegistry", () => {
  describe("register", () => {
    test("stores an extractor so resolve() returns it as this node's own", () => {
      const registry = new ToolAccessExtractorRegistry();
      registry.register("my-tool", noopExtractor);
      expect(registry.resolve("my-tool")).toEqual({
        extractor: noopExtractor,
        origin: "local",
      });
    });

    test("returns a disposer that removes the extractor", () => {
      const registry = new ToolAccessExtractorRegistry();
      const dispose = registry.register("my-tool", noopExtractor);
      dispose();
      expect(registry.resolve("my-tool")).toBeUndefined();
    });

    test("throws when an extractor is already registered for the same tool name", () => {
      const registry = new ToolAccessExtractorRegistry();
      registry.register("my-tool", noopExtractor);
      expect(() => registry.register("my-tool", () => undefined)).toThrow(
        "my-tool",
      );
    });

    test("allows registering different tool names independently", () => {
      const registry = new ToolAccessExtractorRegistry();
      const extractorA: ToolAccessExtractor = () => "/a";
      const extractorB: ToolAccessExtractor = () => "/b";
      registry.register("tool-a", extractorA);
      registry.register("tool-b", extractorB);
      expect(registry.resolve("tool-a")?.extractor).toBe(extractorA);
      expect(registry.resolve("tool-b")?.extractor).toBe(extractorB);
    });
  });

  describe("disposer identity guard", () => {
    test("stale disposer does not evict a later registration", () => {
      const registry = new ToolAccessExtractorRegistry();
      const first: ToolAccessExtractor = () => "/first";
      const second: ToolAccessExtractor = () => "/second";

      const disposeFirst = registry.register("my-tool", first);
      disposeFirst(); // removes first

      registry.register("my-tool", second); // second registration is now valid
      disposeFirst(); // calling stale disposer again — must not remove second

      expect(registry.resolve("my-tool")?.extractor).toBe(second);
    });
  });

  describe("resolve", () => {
    test("returns undefined for an unregistered tool name", () => {
      const registry = new ToolAccessExtractorRegistry();
      expect(registry.resolve("unknown")).toBeUndefined();
    });

    test("the registered extractor is callable and returns its path", () => {
      const registry = new ToolAccessExtractorRegistry();
      const extractor: ToolAccessExtractor = (input) =>
        typeof input.target === "string" ? input.target : undefined;
      registry.register("ffgrep", extractor);
      expect(
        registry.resolve("ffgrep")?.extractor({ target: "/etc/hosts" }),
      ).toBe("/etc/hosts");
      expect(
        registry.resolve("ffgrep")?.extractor({ other: true }),
      ).toBeUndefined();
    });
  });
});
