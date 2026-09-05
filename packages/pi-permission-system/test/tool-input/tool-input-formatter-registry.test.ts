import { describe, expect, test } from "vitest";

import {
  type ToolInputFormatter,
  ToolInputFormatterRegistry,
} from "#src/tool-input/tool-input-formatter-registry";

const noopFormatter: ToolInputFormatter = () => "preview";

describe("ToolInputFormatterRegistry", () => {
  describe("register", () => {
    test("stores a formatter so get() returns it", () => {
      const registry = new ToolInputFormatterRegistry();
      registry.register("my-tool", noopFormatter);
      expect(registry.get("my-tool")).toBe(noopFormatter);
    });

    test("returns a disposer that removes the formatter", () => {
      const registry = new ToolInputFormatterRegistry();
      const dispose = registry.register("my-tool", noopFormatter);
      dispose();
      expect(registry.get("my-tool")).toBeUndefined();
    });

    test("throws when a formatter is already registered for the same tool name", () => {
      const registry = new ToolInputFormatterRegistry();
      registry.register("my-tool", noopFormatter);
      expect(() => registry.register("my-tool", () => undefined)).toThrow(
        "my-tool",
      );
    });

    test("allows registering different tool names independently", () => {
      const registry = new ToolInputFormatterRegistry();
      const formatterA: ToolInputFormatter = () => "a";
      const formatterB: ToolInputFormatter = () => "b";
      registry.register("tool-a", formatterA);
      registry.register("tool-b", formatterB);
      expect(registry.get("tool-a")).toBe(formatterA);
      expect(registry.get("tool-b")).toBe(formatterB);
    });
  });

  describe("disposer identity guard", () => {
    test("stale disposer does not evict a later registration", () => {
      const registry = new ToolInputFormatterRegistry();
      const first: ToolInputFormatter = () => "first";
      const second: ToolInputFormatter = () => "second";

      const disposeFirst = registry.register("my-tool", first);
      disposeFirst(); // removes first

      registry.register("my-tool", second); // second registration is now valid
      disposeFirst(); // calling stale disposer again — must not remove second

      expect(registry.get("my-tool")).toBe(second);
    });
  });

  describe("get", () => {
    test("returns undefined for an unregistered tool name", () => {
      const registry = new ToolInputFormatterRegistry();
      expect(registry.get("unknown")).toBeUndefined();
    });

    test("the registered formatter is callable and returns its result", () => {
      const registry = new ToolInputFormatterRegistry();
      const fmt: ToolInputFormatter = (input) =>
        typeof input.cmd === "string" ? `runs ${input.cmd}` : undefined;
      registry.register("run", fmt);
      expect(registry.get("run")?.({ cmd: "ls" })).toBe("runs ls");
      expect(registry.get("run")?.({ other: true })).toBeUndefined();
    });
  });
});
