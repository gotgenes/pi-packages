import { describe, expect, it } from "vitest";

import { ToolSurfaceBaseline } from "#src/exposure/tool-surface-baseline";

/** Policy double: every named tool is withheld, everything else is exposed. */
function denying(...denied: string[]) {
  return (toolName: string) => !denied.includes(toolName);
}

/** Every tool these tests name, whether active or not. */
const REGISTERED_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "ls",
  "grep",
  "task",
];

/** Observation double: pi keeps a tool registered when it deactivates it. */
function seen(
  active: string[],
  registered: readonly string[] = REGISTERED_TOOLS,
) {
  return { active, registered: new Set(registered) };
}

describe("ToolSurfaceBaseline", () => {
  describe("seeding from what Pi activated", () => {
    it("exposes every observed tool when the policy withholds nothing", () => {
      const baseline = new ToolSurfaceBaseline();

      const surface = baseline.resolveExposed(
        seen(["read", "bash", "ls"]),
        denying(),
      );

      expect(surface).toEqual({
        exposed: ["read", "bash", "ls"],
        withheld: [],
        restored: [],
        changed: false,
      });
    });

    it("never exposes a tool it has not observed active", () => {
      const baseline = new ToolSurfaceBaseline();

      baseline.resolveExposed(seen(["read", "bash"]), denying());
      const surface = baseline.resolveExposed(
        seen(["read", "bash"]),
        denying(),
      );

      expect(surface.exposed).toEqual(["read", "bash"]);
    });

    it("adopts a tool that becomes active mid-session", () => {
      const baseline = new ToolSurfaceBaseline();

      baseline.resolveExposed(seen(["read"]), denying());
      const surface = baseline.resolveExposed(
        seen(["read", "task"]),
        denying(),
      );

      expect(surface.exposed).toEqual(["read", "task"]);
    });
  });

  describe("withholding", () => {
    it("reports the withheld tool and leaves it out of the exposed set", () => {
      const baseline = new ToolSurfaceBaseline();

      const surface = baseline.resolveExposed(
        seen(["read", "ls", "bash"]),
        denying("ls"),
      );

      expect(surface.exposed).toEqual(["read", "bash"]);
      expect(surface.withheld).toEqual(["ls"]);
      expect(surface.changed).toBe(true);
    });

    it("reports no change while the same tool stays withheld", () => {
      const baseline = new ToolSurfaceBaseline();

      baseline.resolveExposed(seen(["read", "ls"]), denying("ls"));
      const surface = baseline.resolveExposed(seen(["read"]), denying("ls"));

      expect(surface.withheld).toEqual(["ls"]);
      expect(surface.changed).toBe(false);
    });
  });

  describe("restoring", () => {
    it("restores a withheld tool once the policy exposes it again", () => {
      const baseline = new ToolSurfaceBaseline();

      baseline.resolveExposed(seen(["read", "ls"]), denying("ls"));
      const surface = baseline.resolveExposed(seen(["read"]), denying());

      expect(surface.exposed).toEqual(["read", "ls"]);
      expect(surface.restored).toEqual(["ls"]);
      expect(surface.withheld).toEqual([]);
      expect(surface.changed).toBe(true);
    });

    it("restores the tool to its original position, not the end", () => {
      const baseline = new ToolSurfaceBaseline();

      baseline.resolveExposed(
        seen(["read", "ls", "bash", "write"]),
        denying("ls"),
      );
      const surface = baseline.resolveExposed(
        seen(["read", "bash", "write"]),
        denying(),
      );

      expect(surface.exposed).toEqual(["read", "ls", "bash", "write"]);
    });

    it("restores only the tools the relaxed policy now exposes", () => {
      const baseline = new ToolSurfaceBaseline();

      baseline.resolveExposed(
        seen(["read", "ls", "grep"]),
        denying("ls", "grep"),
      );
      const surface = baseline.resolveExposed(seen(["read"]), denying("grep"));

      expect(surface.exposed).toEqual(["read", "ls"]);
      expect(surface.restored).toEqual(["ls"]);
      expect(surface.withheld).toEqual(["grep"]);
    });
  });

  describe("deactivation by another party", () => {
    it("drops a tool that stopped being active without being withheld", () => {
      const baseline = new ToolSurfaceBaseline();

      baseline.resolveExposed(seen(["read", "task"]), denying());
      const surface = baseline.resolveExposed(seen(["read"]), denying());

      expect(surface.exposed).toEqual(["read"]);
      expect(surface.withheld).toEqual([]);
    });

    it("does not resurrect a dropped tool when the policy later relaxes", () => {
      const baseline = new ToolSurfaceBaseline();

      baseline.resolveExposed(seen(["read", "task"]), denying("task"));
      // Something else deactivates `read` while `task` is still withheld.
      baseline.resolveExposed(seen([]), denying("task"));
      const surface = baseline.resolveExposed(seen([]), denying());

      expect(surface.exposed).toEqual(["task"]);
    });
  });

  describe("tools that leave the registry", () => {
    it("forgets a withheld tool once pi no longer has it registered", () => {
      const baseline = new ToolSurfaceBaseline();

      baseline.resolveExposed(seen(["read", "ls"]), denying("ls"));
      baseline.resolveExposed(seen(["read"], ["read"]), denying("ls"));
      const surface = baseline.resolveExposed(
        seen(["read"], ["read"]),
        denying(),
      );

      expect(surface.exposed).toEqual(["read"]);
    });

    it("does not reactivate a withheld tool that pi re-registers inactive", () => {
      const baseline = new ToolSurfaceBaseline();

      baseline.resolveExposed(seen(["read", "ls"]), denying("ls"));
      baseline.resolveExposed(seen(["read"], ["read"]), denying("ls"));
      const surface = baseline.resolveExposed(
        seen(["read"], ["read", "ls"]),
        denying(),
      );

      expect(surface.exposed).toEqual(["read"]);
    });

    it("keeps every active tool even when the registry reports nothing", () => {
      const baseline = new ToolSurfaceBaseline();

      const surface = baseline.resolveExposed(
        { active: ["read", "bash"], registered: new Set<string>() },
        denying(),
      );

      expect(surface.exposed).toEqual(["read", "bash"]);
    });
  });

  describe("reset", () => {
    it("forgets the baseline so the next turn reseeds from Pi", () => {
      const baseline = new ToolSurfaceBaseline();
      baseline.resolveExposed(seen(["read", "ls"]), denying("ls"));

      baseline.reset();
      const surface = baseline.resolveExposed(seen(["read"]), denying());

      expect(surface.exposed).toEqual(["read"]);
      expect(surface.restored).toEqual([]);
    });
  });
});
