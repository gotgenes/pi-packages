import { describe, expect, it } from "vitest";

import { makeStatefulToolRegistry } from "#test/helpers/handler-fixtures";

describe("makeStatefulToolRegistry", () => {
  describe("feedback loop", () => {
    it("reports the seeded active set before anything is written", () => {
      const registry = makeStatefulToolRegistry({ active: ["read", "ls"] });
      expect(registry.getActive()).toEqual(["read", "ls"]);
    });

    it("reads back the last accepted setActive argument", () => {
      const registry = makeStatefulToolRegistry({ active: ["read", "ls"] });
      registry.setActive(["read"]);
      expect(registry.getActive()).toEqual(["read"]);
    });

    it("reactivates a name it withheld earlier, since the tool stays registered", () => {
      const registry = makeStatefulToolRegistry({ active: ["read", "ls"] });
      registry.setActive(["read"]);
      registry.setActive(["read", "ls"]);
      expect(registry.getActive()).toEqual(["read", "ls"]);
    });
  });

  describe("registry membership", () => {
    it("lists every registered tool from getAll, active or not", () => {
      const registry = makeStatefulToolRegistry({
        active: ["read"],
        registered: ["read", "grep"],
      });
      expect(registry.getAll()).toEqual([{ name: "read" }, { name: "grep" }]);
    });

    it("ignores a setActive name that is not registered", () => {
      const registry = makeStatefulToolRegistry({ active: ["read"] });
      registry.setActive(["read", "never-registered"]);
      expect(registry.getActive()).toEqual(["read"]);
    });

    it("ignores a name whose tool has since been unregistered", () => {
      const registry = makeStatefulToolRegistry({ active: ["read", "ls"] });
      registry.setActive(["read"]);
      registry.unregister("ls");
      registry.setActive(["read", "ls"]);
      expect(registry.getActive()).toEqual(["read"]);
    });

    it("does not activate a tool that register() only adds to the registry", () => {
      const registry = makeStatefulToolRegistry({ active: ["read"] });
      registry.register("grep");
      expect(registry.getActive()).toEqual(["read"]);
      expect(registry.getAll()).toEqual([{ name: "read" }, { name: "grep" }]);
    });
  });
});
